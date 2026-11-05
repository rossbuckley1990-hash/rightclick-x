#!/usr/bin/env node
// Execution demonstration: byte-exact artefacts through the real stdio MCP server.
//   node experiments/binary-artefacts/demo.mjs [program-path] > experiments/binary-artefacts/evidence/demo.json
//
// Spawns `node bin/rcx.ts mcp` as an MCP host would, authorises one program (default: zipmerge),
// learns it, merges two binary zip archives through context_run, reads the merged archive back
// through context_run_status, and checks it with an independent reader (this file's own central-
// directory walk plus node:zlib inflation). Prints evidence JSON; exits non-zero on any mismatch.
// zipmerge is a development case from the independent evaluation, not held-out acceptance.
import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { deflateRawSync, inflateRawSync, crc32 } from "node:zlib";

const bin = realpathSync(process.argv[2] ?? ["/opt/homebrew/bin/zipmerge", "/usr/local/bin/zipmerge", "/usr/bin/zipmerge"].find(existsSync) ?? "zipmerge-not-installed");
const work = realpathSync(mkdtempSync(join(tmpdir(), "rcx-demo-")));
const sha = (b) => createHash("sha256").update(b).digest("hex");

function zip(entries) {
  const local = [], central = []; let off = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name), raw = Buffer.from(text), data = deflateRawSync(raw), c = crc32(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt32LE(c, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    local.push(h, n, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(c, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, end]);
}
function unzip(b) {
  const e = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = b.readUInt16LE(e + 10); let p = b.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < count; i++) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nl = b.readUInt16LE(p + 28), el = b.readUInt16LE(p + 30), cl = b.readUInt16LE(p + 32), lo = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nl).toString();
    const ds = lo + 30 + b.readUInt16LE(lo + 26) + b.readUInt16LE(lo + 28);
    const data = b.subarray(ds, ds + csize);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString();
    p += 46 + nl + el + cl;
  }
  return out;
}

const child = spawn(process.execPath, ["bin/rcx.ts", "mcp"], {
  cwd: new URL("../..", import.meta.url).pathname,
  env: { ...process.env, RCX_STATE_FILE: join(work, "state.json"), RCX_INVESTIGATE: bin, RCX_EXECUTE: bin, RCX_MCP_LOG: join(work, "mcp.log") },
  stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map(); let id = 0;
createInterface({ input: child.stdout }).on("line", (l) => { try { const m = JSON.parse(l); pending.get(m.id)?.(m); } catch {} });
const rpc = (method, params) => new Promise((res, rej) => { const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: i, method, params }) + "\n"); });
const call = async (name, args) => { const r = await rpc("tools/call", { name, arguments: args }); const t = r.content.map((c) => c.text).join(""); if (r.isError) throw new Error(t); return JSON.parse(t); };

const a = zip([["docs/a.txt", "alpha v1"], ["Readme.txt", "lisez-moi"], ["données/été.txt", "chaud"]]);
const b = zip([["docs/a.txt", "alpha v2"], ["README.TXT", "read me (newer)"]]);
const expected = { "docs/a.txt": "alpha v2", "données/été.txt": "chaud" };
let ok = false; const evidence = { program: bin, inputs: { "a.zip": sha(a), "b.zip": sha(b) } };
try {
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "binary-artefacts-demo", version: "1" } });
  const learned = await call("context_learn", { source: `cli:${bin}` });
  evidence.learn = learned.results?.[0]?.probes?.[0]?.detail;
  const found = await call("context_graph", { op: "search", query: "zipmerge" });
  const capId = (Array.isArray(found) ? found : found.results ?? []).map((c) => c.id ?? c).find((x) => /^cli:zipmerge:invoke$/.test(x));
  evidence.capability = capId;
  const run = await call("context_run", { id: capId, args: { files: { "a.zip": { type: "bytes", base64: a.toString("base64") }, "b.zip": { type: "bytes", base64: b.toString("base64") } }, options: ["-I"], operands: ["merged.zip", "a.zip", "b.zip"], outputs: ["merged.zip"] } });
  evidence.run = { status: run.status, runId: run.runId, output: run.output, provenance: run.cliValidity?.artefacts };
  const ref = run.output.outputs["merged.zip"].ref;
  const read = await call("context_run_status", { artefact: ref });
  const merged = Buffer.from(read.base64, "base64");
  const contents = unzip(merged);
  const lowered = Object.fromEntries(Object.entries(contents).map(([k, v]) => [k.toLowerCase(), v]));
  evidence.check = { mergedSha256: sha(merged), refSha256: read.sha256, entries: Object.keys(contents), readmeKeptNewer: lowered["readme.txt"] === "read me (newer)" };
  ok = read.sha256 === sha(merged) && read.complete && expected["docs/a.txt"] === contents["docs/a.txt"] && expected["données/été.txt"] === contents["données/été.txt"] && lowered["readme.txt"] === "read me (newer)" && Object.keys(contents).length === 3;
  const { readFileSync } = await import("node:fs");
  const log = readFileSync(join(work, "mcp.log"), "utf8");
  evidence.auditLogHoldsPayload = log.includes(a.toString("base64")) || log.includes(b.toString("base64"));
  ok = ok && !evidence.auditLogHoldsPayload;
} catch (e) {
  evidence.error = String(e.message ?? e).slice(0, 500);
} finally {
  child.stdin.end();
  await new Promise((r) => child.on("exit", r));
  rmSync(work, { recursive: true, force: true });
}
evidence.ok = ok;
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = ok ? 0 : 1;
