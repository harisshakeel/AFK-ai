/** A record with every key of a fixed list, each value made from its key. */
export function recordOf<K extends string, V>(
  keys: readonly K[],
  value: (key: K) => V,
): Record<K, V> {
  // Every key of the list is set, which is what the record type promises.
  return Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, V>;
}
