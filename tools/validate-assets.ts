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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(REPO_ROOT, 'apps/game/public');


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
  // public root (docs/asset-provenance.md). The root manifest covers everything
  // with no nearer manifest, so brand/ and fighters/ keep working unchanged.
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

    // The manifest governing an asset is the NEAREST ancestor manifest, so a
    // directory's own record takes precedence over the root one. Every manifest
    // is also consulted, so a root entry still covers a file that a nearer
    // manifest simply does not mention.
    let entry: ProvenanceEntry | undefined;
    for (const manifest of manifests.values()) {
      entry ??= manifest[key];
    }

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

  console.log('');
  console.log(`assets OK: ${assetFiles.length} asset(s) validated against provenance`);
}

main();
