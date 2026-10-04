#!/usr/bin/env python3
"""
Can `body.high-contrast` reach every colour decision in the HUD?

Two questions, one file, no browser.

1. REACH. `tools/css-literals.py` counts colour literals outside `:root` /
   `body.high-contrast`. Zero proves the file obeys rule 3. It cannot show the
   other half: a literal-free file still leaves every value *pinned* if it is a
   literal, and — the part r157 found — a value can be a perfectly good token
   that `body.high-contrast` never re-points. A token nobody overrides is a
   value the mode cannot reach, and rule 4 ("a decorative alpha is itself a
   token, SO CONTRAST MODE CAN FLATTEN IT") is the reason tokens exist at all.

2. CENSUS. Every colour token on `:root`, and whether the contrast block reaches
   it. r157 measured **eleven** it never did, on top of the ten inline literals
   that were not even tokens.

This is a static read of the source, which is the right instrument HERE and the
wrong one everywhere else in this repo. Rule 3 is a rule about the file, and the
file is the whole subject. What a static read cannot supply is a *contrast ratio*
— that needs painted pixels, and `tools/keyhint-contrast.mjs` is the tool for it.
The distinction matters: r152 stalled for a round on a colour literal for exactly
this reason, and was right to, because it wanted a measurement this file does not
contain.

Rule 3: a number nobody can reproduce is not a result. Run this and you get the
tokens, not a bare count.

Exit: 0 clean · 1 a pinned value or a token the mode cannot reach · 2 malformed
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "apps/game/src/styles.css"

COMMENTS = re.compile(r"/\*.*?\*/", re.S)

# A token counts as a COLOUR token if its value names a colour: a hex, a colour
# function, or a reference to one of the palette families. Deliberately generous
# — a token wrongly included here shows up in the report, and a token wrongly
# excluded is invisible, which is the failure mode that matters.
COLOUR = re.compile(
    r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|var\(--(?:text|gold|cool|aka|shiro|fighter)[-\w]*\)"
)

# The ten sites r153 counted, as (name, property, selector fragment, token).
#
# Anchored on the DECLARATION rather than on a line number, because r157 deleted
# the lines they were anchored to — which is how the old css-literals harness
# ended up asserting a literal at line 2033 that no longer exists. A line number
# is a moment; a (selector, property) pair is a fact about the file.
#
# The token is asserted, not assumed: a rule that still inlines its own literal,
# or that points at a DIFFERENT token, fails here rather than being counted.
SITES = [
    ("coach strip plate", "background", ".coach-strip", "--coach-plate"),
    ("hud icon button", "background", ".hud-actions .icon-btn", "--scrim-icon-btn"),
    # r170: this was anchored on `no-backdrop-filter .hud-actions`, because the
    # fallback used to be selected by a body class no source file could set — the
    # rule existed and could never fire. It now lives behind an `@supports`
    # feature query, which is the only selector text it has. So this entry shares
    # its selector with the row above, and the two are told apart by the TOKEN,
    # which is the thing being asserted anyway. The boundary is safe: the match
    # requires `,` or `)` after the token name, so `--scrim-icon-btn` cannot match
    # inside `var(--scrim-icon-btn-fallback)`.
    ("hud icon btn fallback", "background", ".hud-actions .icon-btn", "--scrim-icon-btn-fallback"),
    ("tech-ref list fade", "background", "#tech-ref::after", "--fade-void"),
    ("settings sheet scrim", "box-shadow", "#settings-sheet", "--scrim-panel"),
    ("settings switch OFF track", "background", '.setting-row input[type="checkbox"]', "--switch-track-off"),
    ("settings switch knob shadow", "box-shadow", 'checkbox"]::before', "--shadow-knob"),
    ("round card ink", "color", ".result-detail", "--result-ink"),
    ("round score text shadow", "text-shadow", ".result-score", "--text-shadow-soft"),
]

RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")


def blank_comments(src: str) -> str:
    """Comment text out, keeping every newline it contained.

    Same technique and the same ground-truth check as css-literals.py: a comment
    span usually ends mid-line, so replacing it with only its own newlines
    DELETES the line it was written on and every position after it slides.
    """
    return COMMENTS.sub(lambda m: "\n" * m.group(0).count("\n"), src)


def block(src: str, selector: str) -> str:
    """The body of a top-level rule, by its exact bare selector."""
    start = src.index(f"\n{selector} {{")
    return src[start: src.index("\n}\n", start)]


def decls(body: str) -> dict[str, str]:
    return dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", body))


def main() -> int:
    raw = CSS.read_text()
    src = blank_comments(raw)
    if len(src.splitlines()) != len(raw.splitlines()):
        print("FATAL: line count changed during comment stripping — positions would lie")
        return 2

    root = decls(block(src, ":root"))
    hc = decls(block(src, "body.high-contrast"))
    if not root or not hc:
        print("FATAL: could not read :root / body.high-contrast — file shape changed")
        return 2

    verdict = 0

    # ---- 1. REACH: the ten sites -------------------------------------------
    print(f"file      {CSS.relative_to(ROOT)}")
    print()
    print("the ten inline literals, as tokens")
    print(f"  {'site':30s} {'token':26s} {'reads':6s} {':root':7s} {'re-pointed':11s}")
    rules = [(m.group(1).strip(), m.group(2), src[: m.start()].count("\n") + 1)
             for m in RULE.finditer(src)]
    for name, prop, sel, token in SITES:
        # The declaration for `prop` must contain var(--token) SOMEWHERE in its
        # value, not immediately after the colon. Four of the nine sites put the
        # token at the end of a shorthand — `box-shadow: 0 1px 2px var(--x)` —
        # or nested inside a gradient, and a check that demanded `prop: var(`
        # reported those four as ANCHOR GONE, which is the tool being wrong
        # about a file that is correct. Requiring it first is also what the
        # first draft did, and it is why 4 of 9 said "this tool is stale".
        decl = re.compile(rf"(?<![\w-]){re.escape(prop)}\s*:\s*([^;{{]+)")
        hit = None
        for s, body, ln in rules:
            if sel not in s:
                continue
            m = decl.search(body)
            if m and re.search(rf"var\(\s*{re.escape(token)}\s*[,)]", m.group(1)):
                hit = ln
                break
        reads = hit is not None
        in_root = token in root
        re_pointed = token in hc
        mark = lambda ok: "yes" if ok else "NO"
        if not (reads and in_root and re_pointed):
            verdict = 1
        print(f"  {name:30s} {token:26s} {mark(reads):6s} {mark(in_root):7s} {mark(re_pointed):11s}"
              + (f"  line {hit}" if hit else "  <-- ANCHOR GONE, this tool is stale"))

    # ---- 2. CENSUS: every colour token ------------------------------------
    colours = [k for k, v in root.items() if COLOUR.search(v)]
    unreachable = [k for k in colours if k not in hc]
    print()
    print("census — colour tokens on :root that body.high-contrast never overrides")
    print(f"  colour tokens            {len(colours)}")
    print(f"  reached by the mode      {len(colours) - len(unreachable)}")
    print(f"  NEVER reached            {len(unreachable)}")
    for k in unreachable:
        print(f"    {k:24s} {root[k].strip()[:64]}")

    print()
    if verdict:
        print(f"  FAIL — {verdict} of the ten sites are not reachable from high-contrast")
    else:
        print("  reach — all ten re-point inside body.high-contrast")
    return verdict


if __name__ == "__main__":
    sys.exit(main())
