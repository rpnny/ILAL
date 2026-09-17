/** Canonical JSON wire encoding: all integers are decimal strings, keys sorted. */
export function stringifyProtocolJson(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item)) throw new Error("Protocol JSON numbers must be safe integers; use bigint for large values.");
      return item.toString();
    }
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, normalize(child)]));
    }
    return item;
  }
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}
