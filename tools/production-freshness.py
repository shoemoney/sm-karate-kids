#!/usr/bin/env python3
"""How far behind the real origin is this tree, and what is missing because of it.

WHY THIS EXISTS. Round 160 found the live site serving a build 63 commits and
three days old. The gate for exactly that had existed for nineteen rounds
(`tools/verify-deploy.sh`) and had been **correct the whole time**. It simply had
never been run against the origin the game ships from: r159 deployed to, and
verified, `arcade.shoemoney.ai/smkk/`, and then in the same commit repointed the
gate at `arcade.shoemoney.com/karate-kids/` without running it once.

That is not the r141 defect — the gate did not lie. It is r141 one level up: a
gate that is right and never consulted. Nothing in `pnpm check` can call it,
because `pnpm check` must stay runnable offline. So the round that repointed it
had nothing to remind it, and 63 commits went past.

WHAT THIS ADDS OVER verify-deploy.sh. That script answers one question — are the
served bytes the built bytes — and answers it well. It cannot answer "then how
far behind are we, and which shipped fixes are missing", so a red result from it
is actionable only by a human who goes and looks. This reports the distance, in
commits and in named defects, off the wire.

ARMS, and what each is allowed to claim:

  1. reachability, and a local build to compare against
  2. served index.html vs local dist/index.html, by sha256
  3. every asset the SERVED html names, fetched and sha256'd against local
  4. the served markup pinned to the newest revision of apps/game/index.html it
     matches, and the commit distance from there to HEAD
  5. `var()` reads in the SERVED css with no declaration and no fallback
  6. `//# sourceMappingURL=` references in the SERVED bundles, resolved against
     the origin, so a shipped artifact that points at a file it does not ship
     is visible

ARMS 5 AND 6 DO NOT CHANGE THE EXIT CODE, deliberately. Both report defects in
a served artifact whose bytes may be perfectly current, and "STALE" means
something specific here — the origin disagrees with the local build. Calling a
dangling reference stale would be a lie, and calling the run OK without saying
so is the r141 shape. So they print loudly, and tools/prod-freshness-note.sh
carries them into the next round's prompt.

HONEST LIMIT OF ARM 4, stated here because the number is tempting and wrong to
overclaim: this pins the served **markup**, not the served **bundle**. index.html
is nine revisions deep in this repo and unchanged across stretches of dozens of
commits, so a match bounds the release from above — it does not prove the arcade
built the rest of its tree from that same commit. Arm 4 says "the markup is at or
older than X". It does not say "production is commit X", and this tool must never
print that.

EXIT CODES, because "the network is down" and "the deploy is stale" are different
sentences and an operator must not have to guess which one a red means:

  0  the served bytes are the built bytes
  1  STALE — the origin answers and disagrees with the local build
  2  INCONCLUSIVE — the origin could not be read, or there is no build to
     compare against. This is exit 2 rather than exit 1 on purpose: reporting an
     unreachable host as a stale deploy sends someone hunting a deploy problem
     they do not have, which is standing rule 4 wearing a badge.

USAGE
  python3 tools/production-freshness.py [--origin URL] [--build DIR] [--repo DIR]
"""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_ORIGIN = 'https://arcade.shoemoney.com/karate-kids/'
TIMEOUT = 30

# Arm 4's normalizer. Vite rewrites the dev tags in apps/game/index.html into
# hashed <script>/<link> tags on build, and its injection also shifts a blank
# line, so both sides are stripped to the markup and collapsed to one space
# before comparison. An earlier draft of this probe compared the served *built*
# html against the *source* html while only neutralizing the asset hash, matched
# nothing, and would have reported "production matches no revision of this file"
# for every origin ever deployed.
INJECTED = re.compile(r'^\s*<(script|link)\b.*?\b(module|stylesheet)\b.*?>\s*$', re.M)
ASSET = re.compile(r'(?:"|\'|=|,)(?:\./)?assets/([A-Za-z0-9_.-]+)')

# Same grammar as tools/undefined-vars.py: a read WITH a fallback is safe and
# degrades to the author's own choice, so only a bare read can be a defect. An
# instrument that flags working fallbacks cries wolf and gets deleted.
TOKEN_DECL = re.compile(r'(--[\w-]+)\s*:')
TOKEN_USE = re.compile(r'var\(\s*(--[\w-]+)\s*([,)])')

# Arm 6. Vite appends `//# sourceMappingURL=<name>` to a bundle when it is built
# with sourcemaps, and that pointer is the ONLY way the bundle names its map —
# the served html never does. So a release that strips the map leaves a shipped
# artifact referencing a file it does not ship, and neither arm 2 nor arm 3 can
# see it: the bytes match the build exactly, which is the whole point.
SOURCE_MAP_REF = re.compile(r'//[#@]\s*sourceMappingURL=(\S+)')


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str) -> bytes | None:
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
            return response.read() if response.status == 200 else None
    except (urllib.error.URLError, OSError, ValueError):
        return None


def normalize_markup(text: str) -> str:
    return ' '.join(INJECTED.sub('', text).split())


def run_git(repo: Path, *args: str) -> str | None:
    try:
        done = subprocess.run(['git', '-C', str(repo), *args], capture_output=True,
                              text=True, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout if done.returncode == 0 else None


def git_dirty(repo: Path) -> bool:
    status = run_git(repo, 'status', '--porcelain')
    return bool(status and status.strip())


def pin_markup(repo: Path, served_html: str) -> tuple[str, int, str] | None:
    """Newest revision of apps/game/index.html whose markup the served html matches."""
    log = run_git(repo, 'log', '--format=%H', '--', 'apps/game/index.html')
    if not log:
        return None
    target = normalize_markup(served_html)
    for sha in log.split():
        blob = run_git(repo, 'show', f'{sha}:apps/game/index.html')
        if blob is None or normalize_markup(blob) != target:
            continue
        count = run_git(repo, 'rev-list', '--count', f'{sha}..HEAD')
        subject = run_git(repo, 'log', '-1', '--format=%ad %s', '--date=short', sha)
        return sha, int(count.strip()) if count and count.strip().isdigit() else -1, (subject or '').strip()
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--origin', default=DEFAULT_ORIGIN)
    parser.add_argument('--build', default=None, help='default: <repo>/apps/game/dist')
    parser.add_argument('--repo', default=None, help='default: the directory above tools/')
    args = parser.parse_args()

    repo = Path(args.repo).resolve() if args.repo else Path(__file__).resolve().parent.parent
    build = Path(args.build).resolve() if args.build else repo / 'apps' / 'game' / 'dist'
    origin = args.origin if args.origin.endswith('/') else args.origin + '/'

    print(f'production freshness: {origin}')
    print(f'  repo   {repo}')
    print(f'  build  {build}')

    # --- arm 1: is there anything to compare against, and can we read the origin
    local_html = build / 'index.html'
    if not local_html.is_file():
        print(f'INCONCLUSIVE: no local build at {local_html}')
        print('  A gate pointed at an absent dist must not report the origin as stale —')
        print('  that sends an operator hunting a deploy problem they do not have.')
        return 2

    served_html_bytes = fetch(origin)
    if served_html_bytes is None or not served_html_bytes.strip():
        print(f'INCONCLUSIVE: {origin} did not answer 200 with a body')
        print('  Unreachable is not stale. Exit 2, never exit 1.')
        return 2
    served_html = served_html_bytes.decode('utf-8', 'replace')

    built_at = local_html.stat().st_mtime
    print(f'  built   {time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(built_at))}')

    # --- arm 2: the contract itself
    html_match = sha256(served_html_bytes) == sha256(local_html.read_bytes())
    print(f'  html    {"identical to the local build" if html_match else "DIFFERS from the local build"}')

    # --- arm 3: every asset the served html names, over the wire
    #
    # The served names are taken AS SERVED and never filtered down to the ones
    # that happen to exist locally. An earlier draft did filter, and that is the
    # r154 shape exactly: on a stale deploy the served bundle has a different
    # hash, so the filter removed every name, the tool printed "names none that
    # exist locally", and the one case the tool exists to catch was the one case
    # it could not describe. A local counterpart that is absent is a result, not
    # a reason to skip the row.
    names = sorted(set(ASSET.findall(served_html)))
    if not names:
        print('  assets  the served html names no assets at all — that is not a deploy, that is a page')
        return 2
    asset_rows, asset_ok = [], True
    served_js: dict[str, bytes] = {}
    for name in names:
        served = fetch(origin + 'assets/' + name)
        local_file = build / 'assets' / name
        if not local_file.is_file():
            asset_ok = False
            asset_rows.append((name, None, 'absent locally', False))
            continue
        local = local_file.read_bytes()
        same = served is not None and sha256(served) == sha256(local)
        asset_ok &= same
        # Kept for arm 6. The served body is the only place a bundle's
        # sourceMappingURL can be read from, and re-fetching it later would be a
        # second request that could answer differently from the one compared.
        if same and name.endswith('.js'):
            served_js[name] = served
        asset_rows.append((name, len(local), sha256(local)[:12], same))
    for name, size, digest, same in asset_rows:
        print(f'  asset   assets/{name} {"?" if size is None else f"{size:>8}"} bytes '
              f'sha256:{digest} {"ok" if same else "MISMATCH"}')
    local_names = sorted(p.name for p in (build / 'assets').iterdir()) if (build / 'assets').is_dir() else []
    for extra in sorted(set(local_names) - set(names)):
        print(f'  asset   assets/{extra} {len((build / "assets" / extra).read_bytes()):>8} bytes '
              f'sha256:{sha256((build / "assets" / extra).read_bytes())[:12]} not named by the served html')

    # --- arm 4: how far behind, bounded by the markup
    pin = pin_markup(repo, served_html) if not html_match else None
    if pin:
        sha, behind, subject = pin
        print(f'  pinned  served markup matches apps/game/index.html at {sha[:9]} ({subject})')
        print(f'          {behind} commit(s) behind HEAD — an UPPER BOUND on the drift,')
        print(f'          because that file is unchanged across stretches of commits.')
    elif not html_match:
        print('  pinned  served markup matches NO revision of apps/game/index.html')

    # --- arm 5: no-ops live in the served stylesheet
    css_name = next((n for n in ASSET.findall(served_html) if n.endswith('.css')), None)
    if css_name:
        served_css = fetch(origin + 'assets/' + css_name)
        if served_css:
            css = served_css.decode('utf-8', 'replace')
            declared = set(TOKEN_DECL.findall(css))
            bare = {n for n, sep in TOKEN_USE.findall(css) if sep == ')'}
            undefined = sorted(bare - declared)
            print(f'  css     {css_name}: {len(declared)} tokens declared')
            if undefined:
                print(f'          READ BUT NEVER DECLARED, no fallback: {", ".join(undefined)}')
                print('          each computes to nothing — these are live no-ops in production')

    # --- arm 6: a shipped artifact that points at a file the origin does not serve
    #
    # Measured at r164, off the wire: the served bundle ended in
    # `//# sourceMappingURL=index-CEpXIazX.js.map` and that URL answered 404. The
    # build emitted both the map and the pointer; the release removed the file;
    # nothing in either tree owns the disagreement. Byte-identity could not see
    # it, because the bytes were identical — that is what made it worth an arm.
    for name, blob in sorted(served_js.items()):
        for ref in SOURCE_MAP_REF.findall(blob.decode('utf-8', 'replace')):
            target = ref.split('?')[0].split('#')[0]
            if not target or target.startswith('data:'):
                continue  # an inline map travels inside the bundle and resolves
            url = target if target.startswith('http') else origin + 'assets/' + target
            if fetch(url) is None:
                print(f'  DANGLING assets/{name} references {target}, which the origin does not serve')
                print('          the served bytes match the build, so no other arm can see this:')
                print('          the artifact ships a pointer to a file it does not ship')

    verdict_ok = html_match and asset_ok
    if git_dirty(repo):
        print('  note    the repo has uncommitted changes; the served build cannot be from this tree')
    print()
    print('OK  the served bytes are the built bytes' if verdict_ok
          else 'STALE  the origin answers and disagrees with the local build')
    return 0 if verdict_ok else 1


if __name__ == '__main__':
    sys.exit(main())
