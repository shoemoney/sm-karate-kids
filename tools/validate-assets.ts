#!/usr/bin/env -S pnpm exec tsx
/**
 * Asset validator.
 *
 * Walks apps/game/public/ and enforces the PRD's asset-provenance and
 * no-ROM-data rules (see docs/asset-provenance.md). Every binary asset must:
 *   - exist and be non-empty
 *   - be under 512 KB
 *   - have a provenance entry in the nearest PROVENANCE.json under public/
 *   - that entry must have non-empty source/license/holder and an
 *     `approved: true` flag
 *
 * No file anywhere under apps/game/public/ may use a forbidden ROM-adjacent
 * extension (.rom, .bin, .zip, .7z).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(REPO_ROOT, 'apps/game/public');
const GENERATED_DIR = join(PUBLIC_DIR, 'generated');
const GENERATED_PROVENANCE = join(GENERATED_DIR, 'PROVENANCE.json');
const ART_MANIFEST = join(REPO_ROOT, 'tools/art-manifest.tsv');
const SRC_DIR = join(REPO_ROOT, 'apps/game/src');
const INDEX_HTML = join(REPO_ROOT, 'apps/game/index.html');


const MAX_ASSET_BYTES = 512 * 1024;
const FORBIDDEN_EXTENSIONS = new Set(['.rom', '.bin', '.zip', '.7z']);

interface ProvenanceEntry {
  source?: unknown;
  license?: unknown;
  holder?: unknown;
  approved?: unknown;
}

function pass(label: string): void {
  console.log(`✅ ${label}`);
}

function fail(label: string, detail: string): never {
  console.error(`❌ ${label}`);
  console.error(`   ${detail}`);
  process.exit(1);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Does `manifestDir` contain `assetDir`? A manifest at the public root has no
 * directory name (`dirname` returns '.'), and it is an ancestor of everything.
 */
function isAncestorDir(manifestDir: string, assetDir: string): boolean {
  if (manifestDir === '.' || manifestDir === '') return true;
  return manifestDir === assetDir || assetDir.startsWith(`${manifestDir}/`);
}

/**
 * Resolve the provenance entry that governs `key`, implementing the precedence
 * docs/asset-provenance.md states twice: the NEAREST ANCESTOR manifest wins, and
 * a manifest that is not an ancestor is still consulted as a fallback (which is
 * how `brand/PROVENANCE.json` covers `fighters/`).
 *
 * This used to be `for (const m of manifests.values()) entry ??= m[key]` —
 * "first manifest that happens to carry the key". That is a different rule, and
 * it resolved by `readdirSync` order, which is neither alphabetical nor
 * guaranteed. A sibling directory sorting earlier silently outranked the
 * manifest that actually governs the asset: with `brand/` and `fighters/` both
 * carrying `fighters/shiro-0.webp`, brand's `approved: true` won and
 * fighters' `approved: false` was never read. Provenance is the gate that stands
 * between generated art and shipping, so a resolution rule that can be talked
 * out of by a directory name is the wrong rule for it.
 *
 * Nearest-ancestor also fails closed: the deeper manifest wins, so the entry
 * closest to the asset is the one that has to approve it.
 */
function resolveEntry(
  key: string,
  manifests: Map<string, Record<string, ProvenanceEntry>>,
): ProvenanceEntry | undefined {
  const assetDir = dirname(key);
  // Ancestors first, deepest directory first. Ties break on the manifest path
  // so the answer is a property of the tree, not of the filesystem.
  const ancestors = [...manifests.keys()]
    .filter((manifest) => isAncestorDir(dirname(manifest), assetDir))
    .sort((a, b) => dirname(b).length - dirname(a).length || a.localeCompare(b));
  for (const manifest of ancestors) {
    const hit = manifests.get(manifest)?.[key];
    if (hit) return hit;
  }
  // Not an ancestor — still consulted, in a stable order, so which one wins can
  // never depend on the sequence readdir happened to return.
  for (const manifest of [...manifests.keys()].sort()) {
    if (ancestors.includes(manifest)) continue;
    const hit = manifests.get(manifest)?.[key];
    if (hit) return hit;
  }
  return undefined;
}

interface ManifestRow {
  name: string;
  maxWidth: number;
  alpha: boolean;
  prompt: string;
}

function parseArtManifest(): ManifestRow[] {
  let raw: string;
  try {
    raw = readFileSync(ART_MANIFEST, 'utf8');
  } catch (err) {
    fail(
      'tools/art-manifest.tsv exists',
      err instanceof Error ? err.message : String(err),
    );
  }

  const rows: ManifestRow[] = [];
  const seen = new Set<string>();

  raw.split('\n').forEach((line, index) => {
    // Comments and the column-name header row are both `#`-prefixed so the
    // scripts and the validator can skip them with one rule.
    if (line.trim() === '' || line.startsWith('#')) return;
    const lineNo = index + 1;
    const cols = line.split('\t');
    if (cols.length < 4) {
      fail(
        `tools/art-manifest.tsv line ${lineNo} has 4 tab-separated columns`,
        `got ${cols.length}: ${line.slice(0, 80)}`,
      );
    }
    const [name, maxWidth, alpha, ...prompt] = cols;
    if (!isNonEmptyString(name) || !/^[a-z0-9-]+$/.test(name)) {
      fail(`tools/art-manifest.tsv line ${lineNo} has a valid name`, `name=${JSON.stringify(name)}`);
    }
    if (seen.has(name)) {
      fail(`tools/art-manifest.tsv has no duplicate name`, `duplicate row for "${name}"`);
    }
    seen.add(name);
    const width = Number(maxWidth);
    if (!Number.isInteger(width) || width < 1) {
      fail(`tools/art-manifest.tsv line ${lineNo} has a positive maxWidth`, `maxWidth=${maxWidth}`);
    }
    if (alpha !== 'yes' && alpha !== 'no') {
      fail(`tools/art-manifest.tsv line ${lineNo} alpha is yes|no`, `alpha=${JSON.stringify(alpha)}`);
    }
    const promptText = prompt.join('\t');
    if (!isNonEmptyString(promptText)) {
      fail(`tools/art-manifest.tsv line ${lineNo} has a prompt`, 'prompt column is empty');
    }
    rows.push({ name, maxWidth: width, alpha: alpha === 'yes', prompt: promptText });
  });

  if (rows.length === 0) {
    fail('tools/art-manifest.tsv lists at least one asset', 'manifest has no asset rows');
  }
  return rows;
}

/**
 * Every generated WebP must be named somewhere in the app source. An asset that
 * ships in public/ but is never requested is a silent ~50 KB (sometimes 200 KB)
 * of download for a texture nothing draws — the exact orphan this check exists
 * to keep out. Scoped to apps/game/public/generated/ on purpose: fighters/*.webp
 * are addressed through computed names, so a literal grep would be all false
 * positives there.
 */
function checkGeneratedArtIsWired(manifestNames: Set<string>): void {
  const shipped: string[] = [];
  for (const file of walk(GENERATED_DIR).filter((f) => f.toLowerCase().endsWith('.webp'))) {
    shipped.push(basename(file));
  }
  if (shipped.length === 0) {
    fail('apps/game/public/generated/ ships at least one .webp', 'no WebP assets found');
  }

  const sources: string[] = [];
  try {
    sources.push(...walk(SRC_DIR));
    if (existsSync(INDEX_HTML)) sources.push(INDEX_HTML);
  } catch (err) {
    fail(
      'apps/game/src is walkable',
      err instanceof Error ? err.message : String(err),
    );
  }
  const haystack = sources
    .filter((file) => /\.(ts|tsx|js|jsx|css|html|json|md)$/i.test(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  const orphans = shipped.filter((name) => !haystack.includes(name)).sort();
  if (orphans.length > 0) {
    fail(
      'every apps/game/public/generated/*.webp is referenced from app source',
      `orphaned (never loaded): ${orphans.join(', ')}`,
    );
  }
  pass(`all ${shipped.length} generated asset(s) are referenced from app source`);

  // The generator scripts and the shipped bundle must describe the same set, so
  // a row added to the manifest without regenerating (or vice versa) is a build
  // failure rather than a surprise at art time.
  const shippedBase = new Set(shipped.map((name) => name.replace(/\.webp$/, '')));
  for (const name of manifestNames) {
    if (!shippedBase.has(name)) {
      fail(
        'tools/art-manifest.tsv matches the shipped generated assets',
        `manifest row "${name}" has no apps/game/public/generated/${name}.webp`,
      );
    }
  }
  for (const name of [...shippedBase].sort()) {
    if (!manifestNames.has(name)) {
      fail(
        'tools/art-manifest.tsv matches the shipped generated assets',
        `apps/game/public/generated/${name}.webp has no manifest row`,
      );
    }
  }
  pass(`tools/art-manifest.tsv and the shipped assets agree (${shippedBase.size} asset(s))`);
}

function main(): void {
  let files: string[];
  try {
    files = walk(PUBLIC_DIR);
  } catch (err) {
    fail(
      `${relative(REPO_ROOT, PUBLIC_DIR)} is walkable`,
      err instanceof Error ? err.message : String(err),
    );
  }

  if (files.length === 0) {
    fail('apps/game/public/ has at least one file to validate', 'directory is empty');
  }
  pass(`walked apps/game/public/ (${files.length} file(s))`);

  // Forbidden extensions, checked across every file in public/, including the
  // provenance manifest itself.
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (FORBIDDEN_EXTENSIONS.has(ext)) {
      fail(
        'no ROM-derived extensions under apps/game/public/',
        `${relative(REPO_ROOT, file)} uses forbidden extension "${ext}"`,
      );
    }
  }
  pass(`no forbidden extensions present (${[...FORBIDDEN_EXTENSIONS].join(', ')})`);

  // Provenance manifests are discovered, not hardcoded. Every directory under
  // public/ may carry its own PROVENANCE.json whose keys are relative to the
  // public root (docs/asset-provenance.md). Today the two manifests are
  // brand/ (which also carries the fighters/ keys) and generated/ — there is no
  // manifest at the public root, so brand/ is the fallback rather than an
  // ancestor for anything outside its own directory.
  const manifests = new Map<string, Record<string, ProvenanceEntry>>();
  const manifestPaths = new Set<string>();

  for (const file of files.filter((f) => basename(f) === 'PROVENANCE.json')) {
    const key = relative(PUBLIC_DIR, file).split('\\').join('/');
    manifestPaths.add(key);
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, ProvenanceEntry>;
      manifests.set(key, parsed);
      pass(`${key} exists and parses`);
    } catch (err) {
      fail(`${key} is valid JSON`, err instanceof Error ? err.message : String(err));
    }
  }

  if (manifests.size === 0) {
    fail('apps/game/public/brand/PROVENANCE.json exists', 'no PROVENANCE.json found under public/');
  }

  const assetFiles = files.filter((file) => !manifestPaths.has(relative(PUBLIC_DIR, file).split('\\').join('/')));

  for (const file of assetFiles) {
    const key = relative(PUBLIC_DIR, file).split('\\').join('/');
    const label = `apps/game/public/${key}`;

    const stat = statSync(file);
    if (!stat.isFile() || stat.size === 0) {
      fail(`${label} is non-empty`, `size=${stat.size}`);
    }
    if (stat.size >= MAX_ASSET_BYTES) {
      fail(`${label} is under 512 KB`, `size=${stat.size} bytes`);
    }

    // Nearest ancestor wins; a non-ancestor manifest is a fallback. See
    // resolveEntry() for why this is not simply "first manifest with the key".
    const entry = resolveEntry(key, manifests);

    if (!entry) {
      fail(`${label} has a PROVENANCE.json entry`, `no entry keyed "${key}"`);
      continue;
    }
    if (!isNonEmptyString(entry.source)) {
      fail(`${label} provenance has a non-empty "source"`, `source=${JSON.stringify(entry.source)}`);
    }
    if (!isNonEmptyString(entry.license)) {
      fail(`${label} provenance has a non-empty "license"`, `license=${JSON.stringify(entry.license)}`);
    }
    if (!isNonEmptyString(entry.holder)) {
      fail(`${label} provenance has a non-empty "holder"`, `holder=${JSON.stringify(entry.holder)}`);
    }
    if (entry.approved !== true) {
      fail(`${label} provenance is approved`, `approved=${JSON.stringify(entry.approved)}`);
    }

    pass(`${label} (${stat.size} bytes) — provenance OK`);
  }

  // The generated art set gets two extra guarantees on top of provenance: a
  // single shared manifest that the generator scripts both read, and a wiring
  // check so nothing ships in public/generated/ without being loaded.
  const manifest = parseArtManifest();
  pass(`tools/art-manifest.tsv parses (${manifest.length} row(s))`);

  let generatedProvenance: Record<string, ProvenanceEntry>;
  try {
    generatedProvenance = JSON.parse(
      readFileSync(GENERATED_PROVENANCE, 'utf8'),
    ) as Record<string, ProvenanceEntry>;
  } catch (err) {
    fail(
      'apps/game/public/generated/PROVENANCE.json is valid JSON',
      err instanceof Error ? err.message : String(err),
    );
  }

  for (const row of manifest) {
    const key = `generated/${row.name}.webp`;
    const entry = generatedProvenance[key];
    if (!entry) {
      fail(
        'every manifest row has a generated/PROVENANCE.json entry',
        `no entry keyed "${key}"`,
      );
    }
    if (entry.approved !== true) {
      fail(`${key} provenance is approved`, `approved=${JSON.stringify(entry.approved)}`);
    }
  }
  pass(`every manifest row is approved in generated/PROVENANCE.json (${manifest.length} row(s))`);

  checkGeneratedArtIsWired(new Set(manifest.map((row) => row.name)));

  console.log('');
  console.log(`assets OK: ${assetFiles.length} asset(s) validated against provenance`);
}

main();
