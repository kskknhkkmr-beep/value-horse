/** Offline input classification; no prices, outcomes or performance-based rules. */
export const RACE_KIND_VERSION = "development-race-kind-v1";
export type RaceKind = "芝" | "ダ" | "障" | "unknown";
export type KindEvidence = { surface: string | null; raceName?: string | null;
  classRaw?: string | null; grade?: string | null; courseRaw?: string | null };
export type Classification = { kind: RaceKind; reasons: string[] };
const normalized = (s: string | null | undefined) => (s ?? "").normalize("NFKC").replace(/\s+/g, "");
export function classifyRaceKind(input: KindEvidence): Classification {
  const name = normalized(input.raceName), cls = normalized(input.classRaw);
  const grade = normalized(input.grade).toUpperCase(), course = normalized(input.courseRaw);
  const surface = normalized(input.surface);
  const reasons: string[] = [];
  if (/障害|ジャンプ/.test(name + cls)) reasons.push("race name/class explicitly identifies jumps");
  if (/^J[・.]?G(?:I{1,3}|[123])$/.test(grade) || /[（(]J[・.]?G(?:I{1,3}|[123])[）)]/i.test(name + cls)) {
    reasons.push("jump grade");
  }
  if (surface === "障" || surface === "障害") reasons.push("stored jump surface");
  if (/^障/.test(course)) reasons.push("course header starts with jumps (physical turf/dirt is secondary)");
  if (reasons.length) {
    if (/^G(?:I{1,3}|[123])$/.test(grade)) return { kind: "unknown", reasons: [...reasons, "conflicting flat grade"] };
    return { kind: "障", reasons };
  }
  if (course) {
    const turf = course.includes("芝"), dirt = /ダ|ダート/.test(course);
    if (turf === dirt) return { kind: "unknown", reasons: ["ambiguous/unrecognized course header"] };
    const kind = turf ? "芝" : "ダ";
    if (surface && surface !== kind && !(kind === "ダ" && surface === "ダート")) {
      return { kind: "unknown", reasons: ["course/stored surface conflict"] };
    }
    return { kind, reasons: ["explicit flat course header"] };
  }
  if (surface === "芝") return { kind: "芝", reasons: ["stored turf; no jump evidence"] };
  if (surface === "ダ" || surface === "ダート") return { kind: "ダ", reasons: ["stored dirt; no jump evidence"] };
  return { kind: "unknown", reasons: ["unrecognized/missing race kind"] };
}
export function flatExclusionReason(race: KindEvidence): string | null {
  const c = classifyRaceKind(race);
  return c.kind === "芝" || c.kind === "ダ" ? null : `excluded ${c.kind}: ${c.reasons.join("; ")}`;
}
