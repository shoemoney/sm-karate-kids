/** FNV-1a 32-bit. Stable across renderers, platforms, and JS engines. */
export function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
