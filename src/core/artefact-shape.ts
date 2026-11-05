// The shape of an artefact value, with no platform dependencies (also bundled for edge runtimes).
// See artefacts.ts for staging, storage and limits.

export const TEXT_ENCODINGS = ["utf-8", "latin-1", "ascii", "utf-16le"] as const;
export type TextEncodingName = (typeof TEXT_ENCODINGS)[number];

export type ArtefactValue =
  | { type: "bytes"; base64: string }
  | { type: "text"; text: string; encoding: TextEncodingName }
  | { type: "artefact"; ref: string };

function keysExactly(v: Record<string, unknown>, keys: string[]): boolean {
  const k = Object.keys(v);
  return k.length === keys.length && keys.every((x) => k.includes(x));
}

/** True only for the three exact tagged shapes; any other object keeps its existing meaning. */
export function isArtefactValue(v: unknown): v is ArtefactValue {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o.type === "bytes") return keysExactly(o, ["type", "base64"]) && typeof o.base64 === "string";
  if (o.type === "text") return keysExactly(o, ["type", "text", "encoding"]) && typeof o.text === "string" && typeof o.encoding === "string";
  if (o.type === "artefact") return keysExactly(o, ["type", "ref"]) && typeof o.ref === "string";
  return false;
}

/** A log- and record-safe summary: shape and size, never the payload. */
export function summariseArtefactValue(v: ArtefactValue): Record<string, unknown> {
  if (v.type === "artefact") return { type: "artefact", ref: v.ref };
  if (v.type === "bytes") {
    const pad = v.base64.endsWith("==") ? 2 : v.base64.endsWith("=") ? 1 : 0;
    return { type: "bytes", bytes: Math.max(0, (v.base64.length / 4) * 3 - pad), payload: "[not logged]" };
  }
  return { type: "text", encoding: v.encoding, characters: [...v.text].length, payload: "[not logged]" };
}
