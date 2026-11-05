// Before/after reproduction of the independent evaluation's counterexamples CE1-CE5 (PR #57
// acceptance of 20bc3a7). Each scenario runs against two source trees through the public MCP
// interface (`node bin/rcx.ts mcp`, stdin closed after each call so state is saved), or through
// the store's own API for CE5, on synthetic inputs in a fresh state directory.
//
//   node experiments/gauntlet-remediation/reproduce.ts <label>=<source dir> [...] > results.json
//
// Programs: /usr/bin/sort, /bin/cp, and tiffcp, dwebp and cwebp from Homebrew (skipped, and
// reported as such, when absent). Nothing outside the temporary state directories is written.
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, readFileSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const which = (p: string) => ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map((d) => `${d}/${p}`).find((x) => existsSync(x));

/** One MCP tool call against a source tree, as a host makes it. */
async function call(src: string, state: string, programs: string[], tool: string, args: unknown): Promise<any> {
  const child = spawn(process.execPath, ["bin/rcx.ts", "mcp"], { cwd: src, env: { ...process.env, RCX_STATE_FILE: state, RCX_INVESTIGATE: programs.join(","), RCX_EXECUTE: programs.join(",") }, stdio: ["pipe", "pipe", "pipe"] });
  const rl = createInterface({ input: child.stdout });
  const pending = new Map<number, (m: any) => void>();
  rl.on("line", (l) => { try { const m = JSON.parse(l); pending.get(m.id)?.(m); } catch { /* not ours */ } });
  let id = 0;
  const rpc = (method: string, params: unknown) => new Promise<any>((res) => { const n = ++id; pending.set(n, res); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); });
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gauntlet-remediation-reproduce", version: "1" } });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const m = await rpc("tools/call", { name: tool, arguments: args });
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  const text = m.result?.content?.[0]?.text ?? JSON.stringify(m.error ?? m.result);
  try { return JSON.parse(text); } catch { return { text }; }
}

function tiff(width: number, height: number): Buffer {
  const pix = Buffer.alloc(width * height, 0x80);
  const ifdAt = 8 + pix.length + (pix.length % 2);
  const entries: Array<[number, number, number, number]> = [[256, 3, 1, width], [257, 3, 1, height], [258, 3, 1, 8], [259, 3, 1, 1], [262, 3, 1, 1], [273, 4, 1, 8], [277, 3, 1, 1], [278, 3, 1, height], [279, 4, 1, pix.length]];
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
  ifd.writeUInt16LE(entries.length, 0);
  entries.forEach(([tag, type, count, value], i) => { const o = 2 + i * 12; ifd.writeUInt16LE(tag, o); ifd.writeUInt16LE(type, o + 2); ifd.writeUInt32LE(count, o + 4); if (type === 3) ifd.writeUInt16LE(value, o + 8); else ifd.writeUInt32LE(value, o + 8); });
  const head = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0, 0, 0, 0]);
  head.writeUInt32LE(ifdAt, 4);
  return Buffer.concat([head, pix, Buffer.alloc(ifdAt - 8 - pix.length), ifd]);
}
const tiffPages = (b: Buffer) => { let n = 0, p = b.readUInt32LE(4); while (p && p + 2 <= b.length && n < 64) { n++; const c = b.readUInt16LE(p); p = p + 2 + c * 12 + 4 <= b.length ? b.readUInt32LE(p + 2 + c * 12) : 0; } return n; };

const summary = (r: any) => ({ status: r.status, error: r.error ? String(r.error).slice(0, 200) : undefined, exitCode: r.output?.exitCode ?? r.cliValidity?.processExit, outcome: r.cliValidity?.outcome, exitStatus: r.cliValidity?.exitStatus });

async function scenarios(label: string, src: string) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), `rcx-repro-${label}-`)));
  const state = join(work, "state.json");
  const out: Record<string, unknown> = { label, src, commit: (() => { try { return readFileSync(join(src, ".commit"), "utf8").trim(); } catch { return undefined; } })() };
  try {
    // CE1: sort -n
    const sort = "/usr/bin/sort";
    await call(src, state, [sort], "context_learn", { source: `cli:${sort}` });
    const s = await call(src, state, [sort], "context_run", { id: "cli:sort:invoke", args: { input: "10\n9\n100\n", options: ["-n"] } });
    out.CE1 = { scenario: "context_run cli:sort:invoke {options:[\"-n\"]} on 10/9/100", expected: "completed, 9 10 100", ...summary(s), output: typeof s.output === "string" ? s.output : undefined };

    // CE2: cp a.bin a.bin exits 1 with no output, stdout requested as an artefact
    const cp = "/bin/cp";
    await call(src, state, [sort, cp], "context_learn", { source: `cli:${cp}` });
    const c = await call(src, state, [sort, cp], "context_run", { id: "cli:cp:invoke", args: { files: { "a.bin": { type: "bytes", base64: "AQID" } }, operands: ["a.bin", "a.bin"], stdoutAs: "artefact" } });
    out.CE2 = { scenario: "cp a.bin a.bin (exit 1, nothing printed), stdoutAs artefact", expected: "failed, no artefact", ...summary(c), returnedArtefact: !!c.output?.stdout?.ref };

    // CE3: tiffcp with a truncated second input
    const tiffcp = which("tiffcp");
    if (!tiffcp) out.CE3 = { skipped: "tiffcp not installed" };
    else {
      const bin = realpathSync(tiffcp);
      const progs = [sort, cp, bin];
      await call(src, state, progs, "context_learn", { source: `cli:${bin}` });
      const good = tiff(4, 2);
      const t = await call(src, state, progs, "context_run", { id: "cli:tiffcp:invoke", args: { files: { "a.tif": { type: "bytes", base64: b64(good) }, "b.tif": { type: "bytes", base64: b64(good.subarray(0, 20)) } }, operands: ["a.tif", "b.tif", "out.tif"], outputs: ["out.tif"] } });
      let pages: number | undefined;
      const ref = t.output?.outputs?.["out.tif"]?.ref;
      if (ref) { const r = await call(src, state, progs, "context_run_status", { artefact: ref }); pages = r.base64 ? tiffPages(Buffer.from(r.base64, "base64")) : undefined; }
      out.CE3 = { scenario: "tiffcp a.tif <truncated b.tif> out.tif", expected: "failed, no artefact", ...summary(t), returnedArtefact: !!ref, pagesInReturnedArtefact: pages, failureEvidence: t.cliValidity?.failure };
    }

    // CE4: dwebp -crop x y w h
    const dwebp = which("dwebp"), cwebp = which("cwebp");
    if (!dwebp || !cwebp) out.CE4 = { skipped: "dwebp/cwebp not installed" };
    else {
      const bin = realpathSync(dwebp);
      const progs = [sort, cp, bin];
      writeFileSync(join(work, "in.ppm"), Buffer.concat([Buffer.from("P6\n4 4\n255\n"), Buffer.alloc(48, 0x40)]));
      execFileSync(cwebp, ["-quiet", "-lossless", join(work, "in.ppm"), "-o", join(work, "in.webp")]);
      await call(src, state, progs, "context_learn", { source: `cli:${bin}` });
      const d = await call(src, state, progs, "context_run", { id: "cli:dwebp:invoke", args: { files: { "in.webp": { type: "bytes", base64: b64(readFileSync(join(work, "in.webp"))) } }, operands: ["in.webp"], options: ["-crop", "1", "1", "2", "2", "-ppm", "-o", "out.ppm"], outputs: ["out.ppm"] } });
      let header: string | undefined;
      const ref = d.output?.outputs?.["out.ppm"]?.ref;
      if (ref) { const r = await call(src, state, progs, "context_run_status", { artefact: ref }); header = Buffer.from(r.base64 ?? "", "base64").subarray(0, 11).toString("latin1"); }
      out.CE4 = { scenario: "dwebp in.webp -crop 1 1 2 2 -ppm -o out.ppm", expected: "completed, a 2x2 PPM", ...summary(d), ppmHeader: header };
    }

  } catch (e) {
    out.error = String((e as Error).stack ?? e).slice(0, 500);
  }

  // CE5: the store, through its own API (signature-compatible put for both versions)
  const { ArtefactStore } = await import(join(src, "src/core/artefacts.ts"));
  const put = (st: any, b: Buffer) => st.put(b, { origin: "repro", holder: "run:repro" });
  const ce5: Record<string, unknown> = {};
  { // S6: total bound across restarts, with two processes over one directory (64 MiB items so 9 exceed 512 MiB)
    const d = join(work, "s6");
    const child = join(work, "s6-child.mjs");
    writeFileSync(child, `const { ArtefactStore } = await import(${JSON.stringify(join(src, "src/core/artefacts.ts"))});
const st = new ArtefactStore(process.argv[2]); const r = [];
for (let i = 0; i < 5; i++) { const b = Buffer.alloc(60 * 1024 * 1024, (Number(process.argv[3]) + i) % 251); b.write(process.argv[3] + ":" + i); try { await st.put(b, { origin: "repro", holder: "run:repro" }); r.push(true); } catch { r.push(false); } }
console.log(JSON.stringify(r));`);
    const a = JSON.parse(execFileSync(process.execPath, [child, d, "1"]).toString());
    const b = JSON.parse(execFileSync(process.execPath, [child, d, "100"]).toString());
    const bytesOnDisk = readdirSync(d).filter((f) => /^[0-9a-f]{64}$/.test(f)).reduce((n, f) => n + statSync(join(d, f)).size, 0);
    ce5.S6 = { scenario: "two processes each put 5 x 60 MiB into one 512 MiB store", processA: a, processB: b, bytesOnDisk, limit: 512 * 1024 * 1024, boundHeld: bytesOnDisk <= 512 * 1024 * 1024 };
    rmSync(d, { recursive: true, force: true });
  }
  { // S4: a truncated file already at the content address
    const d = join(work, "s4");
    const b = Buffer.alloc(1 << 20, 9); b.write("whole");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, sha(b)), b.subarray(0, 1000));
    let putOk = false, readAfterRestart = "not attempted";
    try {
      const r = await put(new ArtefactStore(d), b);
      putOk = true;
      try { const g = await new ArtefactStore(d).get(r.ref); readAfterRestart = sha(g) === sha(b) ? "exact" : "wrong bytes"; } catch (e) { readAfterRestart = `refused: ${String((e as Error).message).slice(0, 80)}`; }
    } catch (e) { readAfterRestart = `put refused: ${String((e as Error).message).slice(0, 80)}`; }
    ce5.S4 = { scenario: "put() over a truncated file at the content address, then read after restart", putOk, bytesOnDiskAfterPut: lstatSync(join(d, sha(b))).size, expectedBytes: b.length, readAfterRestart };
  }
  { // R5: the digest a provenance record carries, used as a read reference
    const d = join(work, "r5");
    const secret = Buffer.from("predictable private content");
    await put(new ArtefactStore(d), secret);
    let digestRead = "served";
    try { await new ArtefactStore(d).get(`sha256:${sha(secret)}`); } catch (e) { digestRead = `refused: ${String((e as Error).message).slice(0, 90)}`; }
    ce5.R5 = { scenario: "read with the bare digest of content another caller stored", digestRead };
  }
  { // S9: the read cache over 8 x 60 MiB stored across two processes
    const d = join(work, "s9");
    const st0 = new ArtefactStore(d);
    const refs: string[] = [];
    for (let i = 0; i < 4; i++) { const b = Buffer.alloc(60 * 1024 * 1024, i + 1); refs.push((await put(st0, b)).ref); }
    const reader = new ArtefactStore(d);
    for (const r of refs) await reader.get(r);
    const held = (reader as any).cached ?? [...((reader as any).mem?.values?.() ?? [])].reduce((n: number, e: any) => n + (e.bytes?.length ?? 0), 0);
    ce5.S9 = { scenario: "one process reads 4 x 60 MiB artefacts", bytesHeldInMemory: held };
  }
  out.CE5 = ce5;
  rmSync(work, { recursive: true, force: true });
  return out;
}

const results = [];
for (const spec of process.argv.slice(2)) {
  const [label, src] = spec.split("=");
  results.push(await scenarios(label, src));
}
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, platform: `${process.platform} ${process.arch}`, results }, null, 2));
