/**
 * JSON that keeps bigints. Chain values cross the server/browser boundary as
 * {"$n": "…"} and come back as bigints, so nothing is rounded through a float.
 */
export const toJson = (v: unknown) =>
  JSON.stringify(v, (_, x) => (typeof x === "bigint" ? { $n: x.toString() } : x));

export const fromJson = <T>(s: string): T =>
  JSON.parse(s, (_, x) => (x && typeof x === "object" && "$n" in x ? BigInt(x.$n) : x)) as T;
