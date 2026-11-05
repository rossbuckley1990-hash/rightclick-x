// Byte-exact artefacts: the value a capability consumes or produces when its content is not
// (or not only) UTF-8 text.
//
// A plain JSON string keeps its historical meaning everywhere: UTF-8 text. Bytes are never
// smuggled through a string. Three explicit, tagged forms carry everything else:
//
//   { "type": "bytes",    "base64": "<strict base64>" }              exact bytes
//   { "type": "text",     "text": "…", "encoding": "latin-1" }       text with a declared encoding
//   { "type": "artefact", "ref": "sha256:<64 hex>" }                  bytes this runtime already holds
//
// A reference names content, not a location: it can only resolve to bytes the runtime itself
// stored (a caller's earlier `put`, or a run's collected output). It can never name a host path,
// so an artefact grants no read authority beyond the bytes a caller already supplied.

import { TEXT_ENCODINGS, type ArtefactValue } from "./artefact-shape.ts";
export { isArtefactValue, summariseArtefactValue, TEXT_ENCODINGS, type ArtefactValue, type TextEncodingName } from "./artefact-shape.ts";

export const ARTEFACT_LIMITS = Object.freeze({
  /** Largest single artefact accepted or produced. */
  maxBytes: 64 * 1024 * 1024,
  /** Most output files collected from one run. */
  maxOutputs: 32,
  /** Total bytes the store holds before it refuses new content. */
  maxStoreBytes: 512 * 1024 * 1024,
  /** Largest slice returned by one read. */
  maxReadBytes: 8 * 1024 * 1024,
});


/** What a run returns for a produced artefact: identity and size, never the bytes themselves. */
export interface ArtefactResult {
  type: "artefact";
  ref: string;
  sha256: string;
  bytes: number;
  name?: string;
}

const REF = /^sha256:([0-9a-f]{64})$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export class ArtefactError extends Error {}

/** A lone UTF-16 surrogate: no Unicode encoding can represent it exactly. */
const UNPAIRED = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** SHA-256 via WebCrypto, available in Node and in edge/browser runtimes alike. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Strict base64: canonical alphabet, correct padding, and a decode that re-encodes identically. */
export function decodeBase64Strict(s: string, maxBytes = ARTEFACT_LIMITS.maxBytes): Buffer {
  if (s.length % 4 !== 0 || !B64.test(s)) throw new ArtefactError("base64 is malformed: use the standard alphabet with padding, no whitespace (HTTP 400 equivalent: nothing was run)");
  if ((s.length / 4) * 3 > maxBytes + 2) throw new ArtefactError(`artefact exceeds ${maxBytes} bytes (HTTP 413 equivalent: nothing was run)`);
  const b = Buffer.from(s, "base64");
  if (b.toString("base64") !== s) throw new ArtefactError("base64 is not canonical (HTTP 400 equivalent: nothing was run)");
  if (b.length > maxBytes) throw new ArtefactError(`artefact exceeds ${maxBytes} bytes (HTTP 413 equivalent: nothing was run)`);
  return b;
}

/** Encode text exactly as declared; characters the encoding cannot represent are refused, never replaced. */
export function encodeText(text: string, encoding: string): Buffer {
  switch (encoding.toLowerCase()) {
    case "utf-8": case "utf8":
      if (UNPAIRED.test(text)) throw new ArtefactError("text contains unpaired surrogates and has no UTF-8 encoding (HTTP 400 equivalent: nothing was run)");
      return Buffer.from(text, "utf8");
    case "latin-1": case "latin1": case "iso-8859-1": {
      for (const ch of text) if (ch.codePointAt(0)! > 0xff) throw new ArtefactError(`character U+${ch.codePointAt(0)!.toString(16).toUpperCase()} cannot be encoded as latin-1 (HTTP 400 equivalent: nothing was run)`);
      return Buffer.from(text, "latin1");
    }
    case "ascii": case "us-ascii": {
      for (const ch of text) if (ch.codePointAt(0)! > 0x7f) throw new ArtefactError(`character U+${ch.codePointAt(0)!.toString(16).toUpperCase()} cannot be encoded as ascii (HTTP 400 equivalent: nothing was run)`);
      return Buffer.from(text, "ascii");
    }
    case "utf-16le":
      if (UNPAIRED.test(text)) throw new ArtefactError("text contains unpaired surrogates (HTTP 400 equivalent: nothing was run)");
      return Buffer.from(text, "utf16le");
    default:
      throw new ArtefactError(`unsupported text encoding ${JSON.stringify(encoding)}: use one of ${TEXT_ENCODINGS.join(", ")} or pass exact bytes as {"type":"bytes","base64":…} (HTTP 400 equivalent: nothing was run)`);
  }
}

interface Entry { bytes: Buffer; name?: string; origin: string }

/**
 * Content-addressed, bounded artefact store. With a directory, entries persist as files named by
 * their SHA-256 and are re-hashed on every read, so a modified file is refused, not served.
 */
export class ArtefactStore {
  private mem = new Map<string, Entry>();
  private total = 0;
  private readonly dir?: string;
  constructor(dir?: string) { this.dir = dir; }

  private async fsMod() { return await import("node:fs"); }

  async put(bytes: Uint8Array, meta: { name?: string; origin: string }): Promise<ArtefactResult> {
    const b = Buffer.from(bytes);
    if (b.length > ARTEFACT_LIMITS.maxBytes) throw new ArtefactError(`artefact exceeds ${ARTEFACT_LIMITS.maxBytes} bytes`);
    const hex = await sha256Hex(b);
    if (!this.mem.has(hex)) {
      if (this.total + b.length > ARTEFACT_LIMITS.maxStoreBytes) throw new ArtefactError(`artefact store is full (${ARTEFACT_LIMITS.maxStoreBytes} bytes); nothing was stored`);
      this.mem.set(hex, { bytes: b, ...(meta.name ? { name: meta.name } : {}), origin: meta.origin });
      this.total += b.length;
      if (this.dir) {
        const fs = await this.fsMod();
        fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        const p = `${this.dir}/${hex}`;
        try { fs.writeFileSync(p, b, { flag: "wx", mode: 0o600 }); }
        catch (e) { if ((e as { code?: string }).code !== "EEXIST") throw e; }
      }
    }
    return { type: "artefact", ref: `sha256:${hex}`, sha256: hex, bytes: b.length, ...(meta.name ? { name: meta.name } : {}) };
  }

  async get(ref: string): Promise<Buffer> {
    const m = REF.exec(ref);
    if (!m) throw new ArtefactError(`not an artefact reference: ${JSON.stringify(ref.slice(0, 80))} (expected sha256:<64 hex>); host paths are never accepted (HTTP 400 equivalent: nothing was run)`);
    const hex = m[1];
    const hit = this.mem.get(hex);
    if (hit) return hit.bytes;
    if (this.dir) {
      const fs = await this.fsMod();
      const p = `${this.dir}/${hex}`;
      let st;
      try { st = fs.lstatSync(p); } catch { st = undefined; }
      if (st && st.isFile() && st.size <= ARTEFACT_LIMITS.maxBytes) {
        const b = fs.readFileSync(p);
        if ((await sha256Hex(b)) !== hex) throw new ArtefactError(`artefact ${ref.slice(0, 19)}… failed its content check; refused (HTTP 409 equivalent: nothing was run)`);
        this.mem.set(hex, { bytes: b, origin: "store" });
        this.total += b.length;
        return b;
      }
    }
    throw new ArtefactError(`unknown artefact ${ref.slice(0, 19)}…: this runtime holds no such content (HTTP 404 equivalent: nothing was run)`);
  }

  async stat(ref: string): Promise<ArtefactResult> {
    const b = await this.get(ref);
    const hex = REF.exec(ref)![1];
    const name = this.mem.get(hex)?.name;
    return { type: "artefact", ref, sha256: hex, bytes: b.length, ...(name ? { name } : {}) };
  }
}

/** The bytes an artefact value stands for. */
export async function artefactBytes(v: ArtefactValue, store: ArtefactStore): Promise<Buffer> {
  if (v.type === "bytes") return decodeBase64Strict(v.base64);
  if (v.type === "text") {
    const b = encodeText(v.text, v.encoding);
    if (b.length > ARTEFACT_LIMITS.maxBytes) throw new ArtefactError(`artefact exceeds ${ARTEFACT_LIMITS.maxBytes} bytes (HTTP 413 equivalent: nothing was run)`);
    return b;
  }
  return store.get(v.ref);
}
