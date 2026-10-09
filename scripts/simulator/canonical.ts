import { createHash } from "node:crypto";
/** Sorting object keys makes hashes independent of JSON property insertion order. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  throw new Error("Only finite JSON values are permitted");
}
export const sha256 = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
export function frozenClone<T>(value: T): T {
  const clone = JSON.parse(canonical(value)) as T;
  const freeze = (v: unknown) => {
    if (v && typeof v === "object") {
      Object.values(v).forEach(freeze);
      Object.freeze(v);
    }
  };
  freeze(clone);
  return clone;
}
export function isoDate(date: string): string {
  const iso = date.replaceAll("/", "-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
      new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date: ${date}`);
  return iso;
}
export function developmentDate(date: string) {
  const iso = isoDate(date);
  if (iso < "2026-02-07" || iso > "2026-06-21") throw new Error("Non-development race rejected");
  return iso;
}
