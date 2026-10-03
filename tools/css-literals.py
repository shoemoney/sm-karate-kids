#!/usr/bin/env python3
"""
Count the colour literals that live outside :root and body.high-contrast.

The completion plan recorded **ten** (r153). **Zero as of r157** — nine tokens,
because the settings switch's OFF track was written twice: once as a default and
once as a high-contrast override. Each token sits on :root at the value it
already had, so default mode is unchanged pixel for pixel, and each re-points
inside `body.high-contrast`, which is the half the count could never show.

r153's stated lesson was that the filter had to skip comment lines and had
missed the wrapped continuations. Skipping lines is the wrong tool: a wrapped
comment body line need not start with `*`, and the first draft of THIS tool
made exactly that mistake in the opposite direction — it emitted comment
*content* as if it were code and reported 201 literals, all attributed to
line 1. A wrong instrument is worse than no instrument here, because 201 looks
like a finding and 10 is the number people will quote.

So: comments are DELETED, not skipped, with newlines preserved so line numbers
stay true. Then literals are attributed to a real line, and the enclosing
selector is tracked by brace depth.

Rule 3: a number nobody can reproduce is not a result. Run this and you get
the lines, not a bare count.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "apps/game/src/styles.css"

# The ratchet. Ten until r157, zero since — the count was always a ratchet and
# not a target. A new literal anywhere outside the two allowed blocks exits 1,
# which is the half of rule 3 a reviewer can see; the other half, that
# `body.high-contrast` can now actually REACH all ten, is proven separately by
# tools/contrast-reach.py. Only css-literals-mutation.sh moves this number.
EXPECTED = 0

# Only the BARE token definition and the BARE contrast block are allowed to
# hold literals.
#
# The first draft matched these as substrings, which silently excused
# `body.high-contrast .setting-row input[type=checkbox] { background: #3a2d22 }`
# — a high-contrast *override* carrying a hardcoded wood tone, which is the
# exact rule-3 violation the plan's table names. It reported 9 where the plan
# says 10 and the file says 10. Matched EXACTLY, so a descendant of a token
# block has to be judged on its own.
ALLOWED_SELECTORS = (":root", "body.high-contrast")

# `/* ... */` non-greedy, DOTALL. Comment text becomes the SAME number of
# newlines it had, so every line number after a comment is still correct.
COMMENTS = re.compile(r"/\*.*?\*/", re.S)
UNTERMINATED = re.compile(r"/\*.*\Z", re.S)
HEX = re.compile(r"#[0-9a-fA-F]{3,8}\b")
FUNC = re.compile(r"\b(?:rgba?|hsla?)\s*\(")


def blank_comments(src: str) -> str:
    """Remove comment text; keep every newline INSIDE the comment span.

    Validated against ground truth before being trusted: a comment that ends
    mid-line contributes the newlines it contains, which keeps the total line
    count and every literal's line number identical to the raw file
    (2987 in, 2987 out; #3a2d22 at 2033, #352a20 at 1982, #cfc4b4 at 2678 —
    all matching the raw file exactly).

    Two wrong versions came first, and both were found by checking against the
    raw file rather than by reading the code: adding an extra newline for a
    span not ending at a line boundary (line count grew by 200 and every
    position after the first comment slid), and matching the allowed
    selectors as substrings (which excused a hardcoded wood tone inside a
    high-contrast override and reported 9 where the file has 10).
    """
    def to_newlines(m: re.Match) -> str:
        return "\n" * m.group(0).count("\n")
    src = COMMENTS.sub(to_newlines, src)
    src = UNTERMINATED.sub(to_newlines, src)
    return src


def main() -> int:
    raw = CSS.read_text()
    src = blank_comments(raw)
    if len(src.splitlines()) != len(raw.splitlines()):
        print("FATAL: line count changed during comment stripping — positions would lie")
        return 2
    lines = src.splitlines()

    hits = []
    selector_stack: list[str] = []
    open_sel = None
    for n, line in enumerate(lines, 1):
        # Track the enclosing selector by brace count on the comment-free text.
        rest = line
        if open_sel is None:
            m = re.search(r"([^{}]+)\{", line)
            if m:
                open_sel = m.group(1).strip()
                rest = line[m.end():]
        # Rule 3 verbatim: "No colour literal may appear outside :root /
        # body.high-contrast." A DESCENDANT of that block is outside it — which
        # is why the plan counts `body.high-contrast .setting-row
        # input[...]{ background: #3a2d22 }` as a violation. Matching on a
        # whitespace token excused it, because `body.high-contrast` IS the first
        # token of that selector; that test had to go.
        #
        # The allowance is for the bare selector exactly, with nothing after it.
        allowed = open_sel is not None and open_sel in ALLOWED_SELECTORS

        if not allowed:
            for f in HEX.findall(line) + FUNC.findall(line):
                hits.append((n, f, line.strip()[:100]))

        opens = rest.count("{")
        closes = rest.count("}")
        if opens > closes and open_sel is not None:
            selector_stack.append(open_sel)
        if closes and open_sel is not None:
            for _ in range(closes):
                if selector_stack:
                    selector_stack.pop()
                open_sel = selector_stack[-1] if selector_stack else None
        if open_sel is None and closes == 0:
            # Simple single-line rule: selector resets when its brace closes.
            if "{" in line and "}" in line:
                open_sel = None

    total = len(HEX.findall(src)) + len(FUNC.findall(src))
    print(f"file       {CSS.relative_to(ROOT)}")
    print(f"comments   {len(COMMENTS.findall(raw))} blocks removed; line numbering verified identical")
    print(f"literals   {total} in comment-free source, {len(hits)} outside token/high-contrast blocks")
    print()
    for n, f, text in hits:
        kind = "alpha" if f.lower().startswith(("rgb", "hsl")) else "hex"
        print(f"  {n:5d}  {kind:5s} {f:10s} {text}")
    print()
    print(f"  ratchet expects {EXPECTED}; this run says {len(hits)}")
    return 0 if len(hits) == EXPECTED else 1


if __name__ == "__main__":
    sys.exit(main())