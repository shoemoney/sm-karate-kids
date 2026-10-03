#!/usr/bin/env python3
"""
Is any `var(--x)` in this stylesheet reading a token that does not exist?

A custom property that is never declared — and read without a fallback —
resolves to NOTHING. Not to a default, not to the initial value of whatever
property it lands in: the whole declaration is invalid at computed-value time.
That is not a subtle degradation. `background: var(--coach-plate)` on an
undeclared `--coach-plate` computes to `rgba(0, 0, 0, 0)`: the element has no
background at all.

It has now cost this repo TWICE, and the first time took sixteen rounds to find:

  - round 16 — `--font-display` was never defined, so `.result-headline`,
    `.boot-title` and the boot subtitle rendered in the browser default. The
    game's own name, the round name and the result headline, all wrong, for
    sixteen rounds. A vision model reported it as "a broken glyph in QUALIFIER",
    which is what a wrong typeface looks like and not what a missing token is.
  - round 157 — `--coach-plate` was never defined, so the first-run coach's
    strip had no plate and its lesson text sat directly on the tatami. Found
    only because round 157's other fix made the coach render at all.

Sixteen rounds for one, and it is not a rare accident: it is what happens when
a token is renamed in one place and not another, and `tools/css-literals.py`
cannot see it — that tool counts literals, and an undefined token has none.

Every `var()` here is checked against the union of every custom property the
file declares, on ANY selector. A token declared inside `body.high-contrast` is
still a defined token; a token declared inside a media query is still defined.
The only thing this asks is "does the name exist", which is the whole failure.

Tokens set at runtime from JS (`style.setProperty`) cannot be seen here and do
not exist in this project — `style.css` is the only stylesheet.

Exit: 0 every var() reads a declared token · 1 at least one does not · 2 malformed
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "apps/game/src/styles.css"

COMMENTS = re.compile(r"/\*.*?\*/", re.S)

# `var(--name` and `var(--name, fallback)`. The fallback is stripped: a var()
# with a fallback is SAFE — it degrades to something the author chose — so it is
# reported separately and never fails the run.
USE = re.compile(r"var\(\s*(--[\w-]+)\s*([,)])")
DECLARE = re.compile(r"(?<![\w-])(--[\w-]+)\s*:")
AT_RULE_VAR = re.compile(r"@property\s+(--[\w-]+)")


def blank_comments(src: str) -> str:
    """Comment text out, keeping every newline it contained.

    Comments are deleted rather than skipped, because a comment span usually
    ends mid-line: replacing it with only its own newlines removes the line it
    was written on and every position after it slides. Same technique, and the
    same ground-truth check, as css-literals.py.
    """
    return COMMENTS.sub(lambda m: "\n" * m.group(0).count("\n"), src)


def main() -> int:
    raw = CSS.read_text()
    src = blank_comments(raw)
    if len(src.splitlines()) != len(raw.splitlines()):
        print("FATAL: line count changed during comment stripping — positions would lie")
        return 2
    lines = src.splitlines()

    declared = set(DECLARE.findall(src)) | set(AT_RULE_VAR.findall(src))
    if not declared:
        print("FATAL: no custom properties found — the file shape changed")
        return 2

    undos: list[tuple[str, int]] = []
    safe: list[tuple[str, int]] = []
    for i, line in enumerate(lines, 1):
        for name, terminator in USE.findall(line):
            # A var() WITH a fallback is safe whether or not the token exists —
            # it resolves to the author's own choice. The first draft tested
            # membership first and reported `var(--peak, 0.5)` as a failure,
            # because `--peak` is undeclared. It is not: the declaration is valid
            # and computes to 0.5. An instrument that flags a working fallback
            # teaches its reader to ignore it, which is how a real one at line
            # 2168 would have been dismissed alongside it.
            if terminator == ",":
                safe.append((name, i))
            elif name not in declared:
                undos.append((name, i))

    print(f"file      {CSS.relative_to(ROOT)}")
    print(f"declared  {len(declared)} custom properties")
    print(f"read      {len(undos) + len(safe)} var() uses — {len(safe)} with a fallback, {len(undos)} without")
    print()

    if safe:
        print("  reads WITH a fallback — these degrade to the author's own choice, so they are safe:")
        for name, ln in sorted(set(safe), key=lambda t: t[1]):
            print(f"    {ln:5d}  {name}")
        print()

    if undos:
        print("  reads WITHOUT a fallback, of a token that is NOT declared:")
        for name, ln in undos:
            print(f"    {ln:5d}  {name}")
        print()
        print(f"  FAIL — {len(undos)} var() use(s) resolve to nothing")
        return 1

    print("  every var() reads a declared token")
    return 0


if __name__ == "__main__":
    sys.exit(main())
