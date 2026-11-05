// Byte-exact artefacts: the value a capability consumes or produces when its content is not
// (or not only) UTF-8 text.
//
// A plain JSON string keeps its historical meaning everywhere: UTF-8 text. Bytes are never
// smuggled through a string. Three explicit, tagged forms carry everything else:
//
//   { "type": "bytes",    "base64": "<strict base64>" }              exact bytes
//   { "type": "text",     "text": "…", "encoding": "latin-1" }       text with a declared encoding
//   { "type": "artefact", "ref": "sha256:<64 hex>.<grant>" }         bytes this runtime holds
//
// Two different strings name stored content, and only one of them reads it:
//
//   sha256:<64 hex>            the content's identity. It appears in provenance records, receipts
//                              and exports, and anyone can compute it from bytes they guess, so it
//                              is never permission to read anything.
//   sha256:<64 hex>.<grant>    a read grant: 128 random bits issued to whoever received the run's
//                              result. It is tied to one hold on the content and stops working when
//                              that hold is released or expires.
//
// Neither names a location, so an artefact grants no host read authority.

import { TEXT_ENCODINGS, type ArtefactValue } from "./artefact-shape.ts";
export { isArtefactValue, summariseArtefactValue, TEXT_ENCODINGS, type ArtefactValue, type TextEncodingName } from "./artefact-shape.ts";

export const ARTEFACT_LIMITS = Object.freeze({
  /** Largest single artefact accepted or produced. */
  maxBytes: 64 * 1024 * 1024,
  /** Most output files collected from one run. */
  maxOutputs: 32,
  /** Total content bytes the store holds, across every process using it, before it refuses new content. */
  maxStoreBytes: 512 * 1024 * 1024,
  /** Largest slice returned by one read. */
  maxReadBytes: 8 * 1024 * 1024,
  /** How long a hold lasts when the operator sets no other retention. */
  retentionMs: 7 * 24 * 60 * 60 * 1000,
  /** Bytes one process keeps in memory to avoid re-reading persisted artefacts. */
  cacheBytes: 64 * 1024 * 1024,
  /** Most holds one artefact keeps; beyond it the oldest hold is released. */
  maxHolds: 256,
});

export interface ArtefactStoreOptions {
  maxBytes?: number;
  maxStoreBytes?: number;
  retentionMs?: number;
  cacheBytes?: number;
  maxHolds?: number;
  /** How long to wait for another process's lock before refusing (default 30 s). */
  lockWaitMs?: number;
  /** Clock, for retention. */
  now?: () => number;
}

/** What a run returns for a produced artefact: identity, size and a read grant, never the bytes. */
export interface ArtefactResult {
  type: "artefact";
  /** A read grant: `sha256:<hex>.<grant>`. */
  ref: string;
  sha256: string;
  bytes: number;
  name?: string;
}

const REF = /^sha256:([0-9a-f]{64})$/;
const GRANT_REF = /^sha256:([0-9a-f]{64})\.([A-Za-z0-9_-]{22})$/;
const CONTENT_FILE = /^[0-9a-f]{64}$/;
const HOLDS_FILE = /^([0-9a-f]{64})\.holds$/;
const TMP_FILE = /^\.tmp-(\d+)-[A-Za-z0-9_-]+$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
const LOCK_WAIT_MS = 30_000;
/** A lock created but never written (a crash between the two) is abandoned after this long. */
const UNWRITTEN_LOCK_MS = 10_000;
/**
 * A lock whose holder's pid cannot be checked here (another host or pid namespace) is abandoned
 * only after this long: far longer than any critical section, which stores at most one artefact.
 */
const FOREIGN_LOCK_MS = 120_000;
/** The breaker lock is held for two system calls; one older than this was left by a crash. */
const BREAKER_STALE_MS = 10_000;

export class ArtefactError extends Error {}

/** The content identity for a digest: what provenance records carry. It reads nothing. */
export const contentRef = (hex: string) => `sha256:${hex}`;

/** The digest a content identity or read grant names, or undefined. */
export function refDigest(ref: string): string | undefined {
  return (GRANT_REF.exec(ref) ?? REF.exec(ref))?.[1];
}

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

/** One reason the store keeps an artefact: who holds it, until when, and the grant that reads it. */
interface Hold { grant: string; holder: string; name?: string; at: number; until: number }
interface Holds { v: 1; bytes: number; holds: Hold[] }

type Fs = typeof import("node:fs");

const newGrant = () => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
function sameGrant(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === "EPERM"; }
}
/**
 * Where a pid means something: the host and, on Linux, the pid namespace. A lock written from
 * another container or machine sharing the directory names a pid this process cannot check, so
 * its liveness is never judged by pid.
 */
let pidScopeCache: string | undefined;
async function pidScope(fs: Fs): Promise<string> {
  if (pidScopeCache !== undefined) return pidScopeCache;
  const os = await import("node:os");
  let ns = "";
  try { ns = fs.readlinkSync("/proc/self/ns/pid"); } catch { /* no pid namespaces here */ }
  return (pidScopeCache = `${os.hostname()}|${ns}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const unknown = (ref: string) => new ArtefactError(`unknown artefact ${ref.slice(0, 19)}…: this runtime holds no such grant (released, never issued, or for another store) (HTTP 404 equivalent: nothing was read)`);

/**
 * Content-addressed, bounded artefact store with owned holds.
 *
 * Every stored artefact is held by someone (`run:<runId>`): each hold carries a random read grant
 * and an expiry. Content with no live hold is deleted by `sweep`, so nothing is kept indefinitely,
 * and `release` ends a hold early. With a directory, the store is shared safely by several
 * processes: writes are serialised by a lock file, accounting is the size of the content actually
 * on disk, content is written to a temporary file, verified, and renamed into place before it is
 * acknowledged, and an existing file is trusted only after its bytes hash to its name. Content is
 * re-hashed on every read, so a modified file is refused, not served.
 */
export class ArtefactStore {
  readonly limits: Required<Omit<ArtefactStoreOptions, "now">>;
  private readonly dir?: string;
  private readonly now: () => number;
  /** Memory mode (no directory): the store itself. */
  private mem = new Map<string, { bytes: Buffer; holds: Hold[] }>();
  /** Directory mode: a bounded cache of verified content, revalidated against the file on each read. */
  private cache = new Map<string, { bytes: Buffer; ino: number; size: number; mtimeMs: number }>();
  private cached = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private swept = false;

  constructor(dir?: string, opts: ArtefactStoreOptions = {}) {
    this.dir = dir;
    this.now = opts.now ?? Date.now;
    this.limits = {
      maxBytes: opts.maxBytes ?? ARTEFACT_LIMITS.maxBytes,
      maxStoreBytes: opts.maxStoreBytes ?? ARTEFACT_LIMITS.maxStoreBytes,
      retentionMs: opts.retentionMs ?? ARTEFACT_LIMITS.retentionMs,
      cacheBytes: opts.cacheBytes ?? ARTEFACT_LIMITS.cacheBytes,
      maxHolds: opts.maxHolds ?? ARTEFACT_LIMITS.maxHolds,
      lockWaitMs: opts.lockWaitMs ?? LOCK_WAIT_MS,
    };
  }

  /** Store `bytes` for `holder` and return a read grant for this hold. */
  async put(bytes: Uint8Array, meta: { name?: string; holder: string }): Promise<ArtefactResult> {
    const b = Buffer.from(bytes);
    if (b.length > this.limits.maxBytes) throw new ArtefactError(`artefact exceeds ${this.limits.maxBytes} bytes; nothing was stored`);
    if (!meta.holder) throw new ArtefactError("an artefact is stored only for a holder");
    const hex = await sha256Hex(b);
    return this.serial(async () => {
      const now = this.now();
      const done = (grant: string): ArtefactResult => ({ type: "artefact", ref: `sha256:${hex}.${grant}`, sha256: hex, bytes: b.length, ...(meta.name ? { name: meta.name } : {}) });
      if (!this.dir) {
        let e = this.mem.get(hex);
        if (!e) {
          if (this.memUsage() + b.length > this.limits.maxStoreBytes) this.sweepMemory(now);
          if (this.memUsage() + b.length > this.limits.maxStoreBytes) throw this.full();
          e = { bytes: b, holds: [] };
          this.mem.set(hex, e);
        }
        return done(this.hold(e.holds, meta, now));
      }
      return this.locked(async (fs) => {
        const p = `${this.dir}/${hex}`;
        let existing = await this.inspect(fs, p, hex);
        if (existing.state === "other") throw new ArtefactError(`store entry ${hex.slice(0, 12)}… is not a regular file; nothing was stored`);
        // What this put adds on disk: the content unless it is already there (a file at the address
        // that is not this content, from a crash or tampering, is replaced and its space reclaimed),
        // and at most one more hold in its holds file. The holds count against the bound too.
        const entry = JSON.stringify({ grant: "x".repeat(22), holder: meta.holder, ...(meta.name ? { name: meta.name } : {}), at: now, until: now + this.limits.retentionMs }).length + 1;
        const growth = () => {
          const reclaim = existing.state === "invalid" ? existing.size : 0;
          const content = existing.state === "valid" ? 0 : b.length - reclaim;
          const holdsNow = (() => { try { return fs.lstatSync(`${p}.holds`).size; } catch { return 0; } })();
          return content + entry + (holdsNow ? 0 : JSON.stringify({ v: 1, bytes: b.length, holds: [] }).length);
        };
        if (this.diskUsage(fs) + growth() > this.limits.maxStoreBytes) {
          this.sweepDisk(fs, now);
          // The sweep may have deleted this very content (every hold on it had expired).
          existing = await this.inspect(fs, p, hex);
          if (this.diskUsage(fs) + growth() > this.limits.maxStoreBytes) throw this.full();
        }
        if (existing.state !== "valid") await this.writeVerified(fs, p, b, hex);
        const holds = this.readHolds(fs, hex) ?? { v: 1 as const, bytes: b.length, holds: [] };
        holds.bytes = b.length;
        holds.holds = holds.holds.filter((h) => h.until > now);
        const grant = this.hold(holds.holds, meta, now);
        this.writeJson(fs, `${p}.holds`, holds);
        return done(grant);
      });
    });
  }

  /** The bytes a read grant names. A content digest alone is refused. */
  async get(ref: string): Promise<Buffer> {
    const { hex, grant } = this.parseGrant(ref);
    const now = this.now();
    if (!this.dir) {
      const e = this.mem.get(hex);
      const h = e?.holds.find((x) => sameGrant(x.grant, grant));
      if (!e || !h) throw unknown(ref);
      if (h.until <= now) throw this.expired(ref, h);
      return e.bytes;
    }
    const fs = await this.fs();
    const h = this.readHolds(fs, hex)?.holds.find((x) => sameGrant(x.grant, grant));
    if (!h) throw unknown(ref);
    if (h.until <= now) throw this.expired(ref, h);
    const p = `${this.dir}/${hex}`;
    let st;
    try { st = fs.lstatSync(p); } catch { throw unknown(ref); }
    if (!st.isFile()) throw unknown(ref);
    if (st.size > this.limits.maxBytes) throw new ArtefactError(`artefact ${ref.slice(0, 19)}… exceeds ${this.limits.maxBytes} bytes on disk; refused (HTTP 409 equivalent: nothing was read)`);
    const c = this.cache.get(hex);
    if (c && c.ino === st.ino && c.size === st.size && c.mtimeMs === st.mtimeMs) {
      this.cache.delete(hex);
      this.cache.set(hex, c);
      return c.bytes;
    }
    const b = fs.readFileSync(p);
    if ((await sha256Hex(b)) !== hex) throw new ArtefactError(`artefact ${ref.slice(0, 19)}… failed its content check; refused (HTTP 409 equivalent: nothing was read)`);
    this.remember(hex, b, st);
    return b;
  }

  async stat(ref: string): Promise<ArtefactResult> {
    const b = await this.get(ref);
    return { type: "artefact", ref, sha256: refDigest(ref)!, bytes: b.length };
  }

  /** End the hold a read grant belongs to. Content no one holds any more is deleted now. */
  async release(ref: string): Promise<{ released: boolean; deleted: boolean; remainingHolds: number }> {
    const { hex, grant } = this.parseGrant(ref);
    return this.serial(async () => {
      if (!this.dir) {
        const e = this.mem.get(hex);
        const before = e?.holds.length ?? 0;
        if (!e || !e.holds.some((h) => sameGrant(h.grant, grant))) throw unknown(ref);
        e.holds = e.holds.filter((h) => !sameGrant(h.grant, grant));
        if (!e.holds.length) this.mem.delete(hex);
        return { released: e.holds.length < before, deleted: !e.holds.length, remainingHolds: e.holds.length };
      }
      return this.locked(async (fs) => {
        const holds = this.readHolds(fs, hex);
        if (!holds || !holds.holds.some((h) => sameGrant(h.grant, grant))) throw unknown(ref);
        holds.holds = holds.holds.filter((h) => !sameGrant(h.grant, grant) && h.until > this.now());
        const deleted = !holds.holds.length;
        if (deleted) this.remove(fs, hex);
        else this.writeJson(fs, `${this.dir}/${hex}.holds`, holds);
        return { released: true, deleted, remainingHolds: holds.holds.length };
      });
    });
  }

  /** End every hold `holder` has on a digest (used when a run fails after storing some outputs). */
  async releaseHolder(hex: string, holder: string): Promise<void> {
    await this.serial(async () => {
      if (!this.dir) {
        const e = this.mem.get(hex);
        if (!e) return;
        e.holds = e.holds.filter((h) => h.holder !== holder);
        if (!e.holds.length) this.mem.delete(hex);
        return;
      }
      await this.locked(async (fs) => {
        const holds = this.readHolds(fs, hex);
        if (!holds) return;
        holds.holds = holds.holds.filter((h) => h.holder !== holder);
        if (!holds.holds.length) this.remove(fs, hex);
        else this.writeJson(fs, `${this.dir}/${hex}.holds`, holds);
      });
    });
  }

  /**
   * Apply retention: drop expired holds, delete content no live hold keeps (including content left
   * without holds by a crash), and delete temporary files abandoned by an interrupted write.
   */
  async sweep(): Promise<{ deleted: number; bytesFreed: number; temporaryFilesRemoved: number }> {
    return this.serial(async () => {
      if (!this.dir) return this.sweepMemory(this.now());
      return this.locked(async (fs) => this.sweepDisk(fs, this.now()));
    });
  }

  /** Content bytes held, across every process using the store. */
  async usage(): Promise<{ bytes: number; artefacts: number }> {
    if (!this.dir) return { bytes: this.memUsage(), artefacts: this.mem.size };
    return this.serial(() => this.locked(async (fs) => ({ bytes: this.diskUsage(fs), artefacts: fs.readdirSync(this.dir!).filter((f) => CONTENT_FILE.test(f)).length })));
  }

  // ------------------------------------------------------------------ internals

  private parseGrant(ref: string): { hex: string; grant: string } {
    const m = GRANT_REF.exec(String(ref));
    if (m) return { hex: m[1], grant: m[2] };
    if (REF.test(String(ref))) throw new ArtefactError(`${String(ref).slice(0, 19)}… is a content digest, not a read grant. Digests appear in provenance records and anyone can compute one, so a digest never permits a read: use the ref a run returned (sha256:<hex>.<grant>) (HTTP 403 equivalent: nothing was read)`);
    throw new ArtefactError(`not an artefact reference: ${JSON.stringify(String(ref).slice(0, 80))} (expected the sha256:<64 hex>.<grant> a run returned); host paths are never accepted (HTTP 400 equivalent: nothing was run)`);
  }

  private hold(holds: Hold[], meta: { name?: string; holder: string }, now: number): string {
    const until = now + this.limits.retentionMs;
    const mine = holds.find((h) => h.holder === meta.holder);
    if (mine) { mine.until = Math.max(mine.until, until); return mine.grant; }
    holds.push({ grant: newGrant(), holder: meta.holder, ...(meta.name ? { name: meta.name } : {}), at: now, until });
    while (holds.length > this.limits.maxHolds) holds.shift();
    return holds[holds.length - 1].grant;
  }

  private expired(ref: string, h: Hold) {
    return new ArtefactError(`artefact ${ref.slice(0, 19)}… expired at ${new Date(h.until).toISOString()} (retention); its digest stays in the run's record, its bytes are no longer held (HTTP 410 equivalent: nothing was read)`);
  }

  private full() {
    return new ArtefactError(`artefact store is full (${this.limits.maxStoreBytes} bytes held across every process using it, after expired holds were released); nothing was stored`);
  }

  private memUsage(): number {
    let n = 0;
    for (const e of this.mem.values()) n += e.bytes.length;
    return n;
  }

  private sweepMemory(now: number) {
    let deleted = 0, bytesFreed = 0;
    for (const [hex, e] of this.mem) {
      e.holds = e.holds.filter((h) => h.until > now);
      if (!e.holds.length) { this.mem.delete(hex); deleted++; bytesFreed += e.bytes.length; }
    }
    return { deleted, bytesFreed, temporaryFilesRemoved: 0 };
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async fs(): Promise<Fs> { return await import("node:fs"); }

  /**
   * Run `fn` holding the store's lock, which serialises every process using the directory.
   *
   * The lock is a file created exclusively. Only its holder removes it, except that a lock whose
   * holder is gone may be broken, and breaking is itself serialised by a second exclusive file
   * (`.lock.break`): the breaker re-reads the lock and removes it only if it is still the very file
   * judged abandoned (same content, same inode). A live lock is therefore never moved, even
   * briefly, so no other process can slip in while it is absent. Residual risk: a breaker that
   * stalls for longer than BREAKER_STALE_MS between its re-check and the removal.
   */
  private async locked<T>(fn: (fs: Fs) => Promise<T>): Promise<T> {
    const fs = await this.fs();
    fs.mkdirSync(this.dir!, { recursive: true, mode: 0o700 });
    const lock = `${this.dir}/.lock`;
    const scope = await pidScope(fs);
    const deadline = Date.now() + this.limits.lockWaitMs;
    const me = JSON.stringify({ pid: process.pid, scope, at: Date.now(), nonce: newGrant() });
    for (;;) {
      try {
        fs.writeFileSync(lock, me, { flag: "wx", mode: 0o600 });
        // Held only if it is still ours: a lock judged unwritten and broken in the instant between
        // its creation and its write is not.
        if (this.readLock(fs, lock)?.text === me) break;
        continue;
      } catch (e) {
        if ((e as { code?: string }).code !== "EEXIST") throw e;
      }
      const seen = this.readLock(fs, lock);
      if (!seen) continue;
      if (this.abandoned(seen, scope)) { this.breakLock(fs, lock, seen, me); continue; }
      if (Date.now() > deadline) throw new ArtefactError(`artefact store is busy: another process (pid ${seen.holder?.pid ?? "unknown"}${seen.holder?.scope && seen.holder.scope !== scope ? `, on ${seen.holder.scope.split("|")[0]}` : ""}) has held ${lock} for ${Math.round(seen.age / 1000)}s; nothing was stored. If no RightClick process is running, remove that file.`);
      await sleep(5 + Math.floor(Math.random() * 20));
    }
    try {
      if (!this.swept) {
        this.swept = true;
        this.sweepDisk(fs, this.now());
      }
      return await fn(fs);
    } finally {
      try { if (fs.readFileSync(lock, "utf8") === me) fs.unlinkSync(lock); } catch { /* already gone */ }
    }
  }

  private readLock(fs: Fs, lock: string): { text: string; ino: number; age: number; holder?: { pid?: number; scope?: string } } | undefined {
    let st, text;
    try { st = fs.lstatSync(lock); text = fs.readFileSync(lock, "utf8"); } catch { return undefined; }
    let holder: { pid?: number; scope?: string } | undefined;
    try { const v = JSON.parse(text); if (v && typeof v === "object") holder = { pid: Number.isInteger(v.pid) ? v.pid : undefined, scope: typeof v.scope === "string" ? v.scope : undefined }; } catch { holder = undefined; }
    return { text, ino: st.ino, age: Date.now() - st.mtimeMs, holder };
  }

  /** Whether a lock was left by a holder that is gone. A pid is judged only where it means something. */
  private abandoned(seen: { age: number; holder?: { pid?: number; scope?: string } }, scope: string): boolean {
    if (!seen.holder?.pid) return seen.age > UNWRITTEN_LOCK_MS;
    if (seen.holder.scope !== scope) return seen.age > FOREIGN_LOCK_MS;
    return !pidAlive(seen.holder.pid);
  }

  /** Remove an abandoned lock, but only the exact file that was judged abandoned, and one breaker at a time. */
  private breakLock(fs: Fs, lock: string, seen: { text: string; ino: number }, me: string) {
    const breaker = `${lock}.break`;
    try { fs.writeFileSync(breaker, me, { flag: "wx", mode: 0o600 }); }
    catch (e) {
      if ((e as { code?: string }).code !== "EEXIST") throw e;
      // Another process is breaking it. A breaker file this old was left by a crash.
      try { if (Date.now() - fs.lstatSync(breaker).mtimeMs > BREAKER_STALE_MS) fs.unlinkSync(breaker); } catch { /* gone */ }
      return;
    }
    try {
      const now = this.readLock(fs, lock);
      if (now && now.text === seen.text && now.ino === seen.ino) fs.unlinkSync(lock);
    } finally {
      try { if (fs.readFileSync(breaker, "utf8") === me) fs.unlinkSync(breaker); } catch { /* gone */ }
    }
  }

  /** What the address holds: this content (by hash, not by name), something else, or nothing. */
  private async inspect(fs: Fs, p: string, hex: string): Promise<{ state: "valid" | "invalid" | "absent" | "other"; size: number }> {
    let st;
    try { st = fs.lstatSync(p); } catch { return { state: "absent", size: 0 }; }
    if (st.isSymbolicLink()) return { state: "invalid", size: 0 };
    if (!st.isFile()) return { state: "other", size: 0 };
    const c = this.cache.get(hex);
    if (c && c.ino === st.ino && c.size === st.size && c.mtimeMs === st.mtimeMs) return { state: "valid", size: st.size };
    if (st.size > this.limits.maxBytes) return { state: "invalid", size: st.size };
    const b = fs.readFileSync(p);
    return (await sha256Hex(b)) === hex ? { state: "valid", size: st.size } : { state: "invalid", size: st.size };
  }

  /** Temporary file, flushed, re-read and hashed, then renamed into place: only then acknowledged. */
  private async writeVerified(fs: Fs, p: string, b: Buffer, hex: string) {
    const tmp = `${this.dir}/.tmp-${process.pid}-${newGrant()}`;
    try {
      const fd = fs.openSync(tmp, "wx", 0o600);
      try {
        for (let off = 0; off < b.length;) off += fs.writeSync(fd, b, off, b.length - off);
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      const back = fs.readFileSync(tmp);
      if (back.length !== b.length || (await sha256Hex(back)) !== hex) throw new ArtefactError("artefact write verification failed; nothing was stored");
      fs.renameSync(tmp, p);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* not created */ }
      throw e;
    }
    this.syncDir(fs);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.size !== b.length) throw new ArtefactError("artefact did not land as written; nothing was stored");
    this.remember(hex, b, st);
  }

  private writeJson(fs: Fs, p: string, value: unknown) {
    const tmp = `${this.dir}/.tmp-${process.pid}-${newGrant()}`;
    fs.writeFileSync(tmp, JSON.stringify(value), { flag: "wx", mode: 0o600 });
    fs.renameSync(tmp, p);
    this.syncDir(fs);
  }

  private syncDir(fs: Fs) {
    let fd: number | undefined;
    try { fd = fs.openSync(this.dir!, "r"); fs.fsyncSync(fd); } catch { /* not supported here */ } finally { if (fd !== undefined) fs.closeSync(fd); }
  }

  private readHolds(fs: Fs, hex: string): Holds | undefined {
    try {
      const st = fs.lstatSync(`${this.dir}/${hex}.holds`);
      if (!st.isFile() || st.size > 1 << 20) return undefined;
      const v = JSON.parse(fs.readFileSync(`${this.dir}/${hex}.holds`, "utf8"));
      if (v?.v !== 1 || !Array.isArray(v.holds)) return undefined;
      return { v: 1, bytes: Number(v.bytes) || 0, holds: v.holds.filter((h: Hold) => typeof h?.grant === "string" && typeof h.holder === "string" && Number.isFinite(h.until)) };
    } catch { return undefined; }
  }

  private remove(fs: Fs, hex: string) {
    for (const f of [`${this.dir}/${hex}`, `${this.dir}/${hex}.holds`]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
    const c = this.cache.get(hex);
    if (c) { this.cache.delete(hex); this.cached -= c.bytes.length; }
  }

  /**
   * Bytes on disk that count against the quota: content, the holds that keep it, and in-flight
   * temporary files. Holds count so that many tiny artefacts cannot grow the store past its bound
   * through their metadata. (Filesystem block rounding is not counted.)
   */
  private diskUsage(fs: Fs): number {
    let n = 0;
    for (const f of fs.readdirSync(this.dir!)) {
      if (!CONTENT_FILE.test(f) && !TMP_FILE.test(f) && !HOLDS_FILE.test(f)) continue;
      try { const st = fs.lstatSync(`${this.dir}/${f}`); if (st.isFile()) n += st.size; } catch { /* gone */ }
    }
    return n;
  }

  private sweepDisk(fs: Fs, now: number) {
    let deleted = 0, bytesFreed = 0, temporaryFilesRemoved = 0;
    for (const f of fs.readdirSync(this.dir!)) {
      // Every temporary file is written under the lock, and this runs under the lock, so any
      // temporary file seen here was abandoned by an interrupted write.
      if (TMP_FILE.test(f)) {
        try { fs.unlinkSync(`${this.dir}/${f}`); temporaryFilesRemoved++; } catch { /* gone */ }
        continue;
      }
      // Left by the earlier rename-aside lock breaking (b8cabb0), which no longer exists.
      if (f.startsWith(".lock.stale-")) { try { fs.unlinkSync(`${this.dir}/${f}`); } catch { /* gone */ } continue; }
      const holdsOnly = HOLDS_FILE.exec(f);
      const hex = CONTENT_FILE.test(f) ? f : holdsOnly?.[1];
      if (!hex) continue;
      if (holdsOnly) {
        // Holds whose content is gone (deleted, or never landed) grant nothing: remove them.
        if (!fs.existsSync(`${this.dir}/${hex}`)) { try { fs.unlinkSync(`${this.dir}/${f}`); } catch { /* gone */ } }
        continue;
      }
      const holds = this.readHolds(fs, hex);
      const live = holds?.holds.filter((h) => h.until > now) ?? [];
      if (live.length) {
        if (holds && live.length !== holds.holds.length) this.writeJson(fs, `${this.dir}/${hex}.holds`, { ...holds, holds: live });
        continue;
      }
      let size = 0;
      try { const st = fs.lstatSync(`${this.dir}/${hex}`); if (st.isFile()) size = st.size; } catch { /* holds without content */ }
      this.remove(fs, hex);
      if (size) { deleted++; bytesFreed += size; }
    }
    return { deleted, bytesFreed, temporaryFilesRemoved };
  }

  private remember(hex: string, bytes: Buffer, st: { ino: number; size: number; mtimeMs: number }) {
    if (bytes.length > this.limits.cacheBytes) return;
    const old = this.cache.get(hex);
    if (old) { this.cache.delete(hex); this.cached -= old.bytes.length; }
    this.cache.set(hex, { bytes, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs });
    this.cached += bytes.length;
    for (const [k, v] of this.cache) {
      if (this.cached <= this.limits.cacheBytes) break;
      this.cache.delete(k);
      this.cached -= v.bytes.length;
    }
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
