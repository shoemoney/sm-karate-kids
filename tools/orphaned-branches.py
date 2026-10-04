#!/usr/bin/env python3
"""Does every `body.<class>` branch in the stylesheet have a way to happen?

r170. The round card carried four rules qualified `body.no-backdrop-filter` —
a fallback plate for renderers without `backdrop-filter`. No source file has
ever put that class on `<body>`; `git log -S` over `main.ts` and `index.html`
returns nothing. So the branches could not fire, and every renderer — including
every renderer that lacks the feature the branch exists for — painted the
blurred-translucent plate instead.

That is this repo's ninth-or-tenth instance of one shape, and the shape is
worth naming because it has three separate names in this log: *a mechanism that
is not consulted is not a gate* (r161), *the mechanism its own header
describes, documented, orphaned* (r162), and *a state that becomes reachable is
not a state that has been reviewed* (r158). All three are the same thing: a
branch that exists in the source, looks correct, and cannot be taken.

So this is the gate for the class, and it is static on purpose. The obvious
browser probe — load the page, set the class, compare pixels — is what
`pixel-identity.mjs` was doing, and it is precisely the trap: **the instrument
manufactures the state it then measures.** It applied `no-backdrop-filter` to
`<body>` by hand so it could read `--scrim-icon-btn-fallback`, then reported
that it had verified the fallback, for a fallback no player could reach.

Nor can the fallback now be painted from this repo's Chromium: measured,
`--disable-blink-features=CSSBackdropFilter` is a no-op, so
`CSS.supports('backdrop-filter','blur(1px)')` stays true with the flag set and
the two arms are indistinguishable. A probe on that difference would be rounds
90, 93 and 95 — a metric agreeing with a no-op. So reachability is checked
against the source, which is where the reachability has to come from anyway.

WHAT IT CHECKS
  1. Comments are stripped first, preserving line numbers. A class named in
     prose is not a branch — and r153 shipped two wrong counts into this very
     document because a filter skipped comment *start* lines and missed the
     wrapped continuation. `tools/orphaned-branches-mutation.sh` asserts the
     stripping does not move a line number.
  2. Every `body.<class>` selector in `styles.css` is collected.
  3. Each class must appear as a quoted literal somewhere in the app source
     (`apps/game/src/**`, `apps/game/index.html`) — which is what `classList.
     add('high-contrast')` and friends look like. A bare identifier match would
     accept `// turn on high-contrast someday`, so the quotes are the point.
  4. Classes no source can set are the failure.

EXIT
  0  every body branch is reachable from source
  1  at least one body branch cannot happen
  2  unreadable / missing input — operator error, deliberately NOT a failure,
     so a moved stylesheet never reads as an orphaned branch
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "apps" / "game" / "src" / "styles.css"
SRC_DIRS = [ROOT / "apps" / "game" / "src"]
SRC_FILES = [ROOT / "apps" / "game" / "index.html"]

# Extensions that can put a class on <body>. A .css or .md file cannot, so
# allowing them would let prose in a comment satisfy the gate.
CODE_EXT = {".ts", ".tsx", ".js", ".mjs", ".html"}

BODY_CLASS = re.compile(r"body\.([A-Za-z][A-Za-z0-9_-]*)")


def strip_comments(text: str) -> str:
    """Remove `/* ... */`, replacing each with newlines so line numbers hold.

    Deliberately not a per-line filter. r153's colour-literal counter skipped
    lines beginning with `*` and missed the wrapped continuation of a comment,
    and shipped an inflated count into the plan; the replacement then shipped a
    different inflated count. Newline-preserving removal cannot have that shape
    of bug, and the harness asserts it.
    """
    out = []
    i = 0
    n = len(text)
    while i < n:
        if text.startswith("/*", i):
            end = text.find("*/", i + 2)
            if end == -1:
                out.append("\n" * text[i:].count("\n"))
                break
            out.append("\n" * text[i : end + 2].count("\n"))
            i = end + 2
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def source_files() -> list[Path]:
    files = list(SRC_FILES)
    for d in SRC_DIRS:
        if not d.is_dir():
            continue
        for p in sorted(d.rglob("*")):
            if p.is_file() and p.suffix in CODE_EXT:
                files.append(p)
    return files


def main() -> int:
    if not CSS.is_file():
        print(f"EXIT 2  cannot read {CSS}", file=sys.stderr)
        return 2

    raw = CSS.read_text(encoding="utf-8")
    if not raw.strip():
        print(f"EXIT 2  {CSS} is empty", file=sys.stderr)
        return 2
    css = strip_comments(raw)
    if len(css.splitlines()) != len(raw.splitlines()):
        print("EXIT 2  comment stripping moved a line number", file=sys.stderr)
        return 2

    files = source_files()
    if not files:
        print("EXIT 2  no app source files found", file=sys.stderr)
        return 2
    blobs: dict[Path, str] = {}
    for p in files:
        try:
            blobs[p] = p.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            print(f"EXIT 2  cannot read {p}", file=sys.stderr)
            return 2

    branches: dict[str, list[int]] = {}
    for lineno, line in enumerate(css.splitlines(), start=1):
        # `body` must be a selector, not a declaration value. Declarations in
        # this file are indented and never read `body.<class>`, but a value
        # could in principle, so require the match to start a compound selector
        # — preceded by start-of-line, a comma, or a combinator/descendant gap.
        for m in BODY_CLASS.finditer(line):
            start = m.start()
            before = line[:start].rstrip()
            if before and before[-1] not in ",>+~":
                continue
            branches.setdefault(m.group(1), []).append(lineno)

    if not branches:
        print("EXIT 2  no body.<class> branch found — is this still the right file?", file=sys.stderr)
        return 2

    unreachable: list[tuple[str, list[int]]] = []
    for cls in sorted(branches):
        quoted = re.compile(r"['\"]" + re.escape(cls) + r"['\"]")
        if not any(quoted.search(b) for b in blobs.values()):
            unreachable.append((cls, branches[cls]))

    print(f"file      {CSS.relative_to(ROOT)}")
    print(f"source    {len(files)} app source file(s)")
    print()
    print("body.<class> branches, and whether source can set the class")
    print("  class                        lines          source")
    for cls in sorted(branches):
        hits = sum(len(re.findall(r"['\"]" + re.escape(cls) + r"['\"]", b)) for b in blobs.values())
        lines = ",".join(str(x) for x in branches[cls][:6])
        if len(branches[cls]) > 6:
            lines += f",+{len(branches[cls]) - 6}"
        mark = "reachable" if hits else "NEVER SET"
        # Printed as the full `body.<class>` selector, not the bare class, so both
        # places this tool names a branch agree — and so the row can be matched
        # mechanically by the mutation harness.
        print(f"  body.{cls:<26} {lines:<14} {hits} ref(s)  {mark}")

    print()
    if unreachable:
        print(f"  {len(branches) - len(unreachable)}/{len(branches)} body branches are reachable from source")
        print()
        print("NEVER SET — a branch no source file can take:")
        for cls, lines in unreachable:
            print(f"  body.{cls}  (styles.css line(s) {','.join(str(x) for x in lines)})")
        print()
        print("Either the branch is dead and its fallback belongs behind an")
        print("@supports feature query, or the code that sets the class was never")
        print("written. Both are defects; only one of them is a missing feature.")
        return 1

    print(f"  {len(branches)}/{len(branches)} body branches are reachable from source")
    return 0


if __name__ == "__main__":
    sys.exit(main())