/** Deterministic 32-bit FNV-1a hash of an element id (used as Excalidraw seed). */
export function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
