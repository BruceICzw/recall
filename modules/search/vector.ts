/** Vector maths. Pure. Embeddings are stored L2-normalised so cosine = dot product. */

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function normalize(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    s += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
}

/** Keep the top-k items by score using a simple bounded insertion (k is small). */
export function topK<T>(items: Iterable<T>, k: number, score: (t: T) => number): { item: T; score: number }[] {
  const best: { item: T; score: number }[] = [];
  for (const item of items) {
    const s = score(item);
    if (best.length < k) {
      best.push({ item, score: s });
      if (best.length === k) best.sort((a, b) => b.score - a.score);
      continue;
    }
    if (s <= best[k - 1].score) continue;
    let i = k - 1;
    while (i > 0 && best[i - 1].score < s) {
      best[i] = best[i - 1];
      i--;
    }
    best[i] = { item, score: s };
  }
  return best.sort((a, b) => b.score - a.score);
}
