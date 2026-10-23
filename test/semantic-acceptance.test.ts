// Semantic acceptance suite (docs/north-star/EVALUATION-PLAN.md §8). Every case must end correct
// or explicitly not established; never completed with a wrong output, and never labelled verified
// on the strength of a trivial check. S1 and S3 use real system programs when present.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RightClick } from "../src/runtime.ts";
import { hostSandbox } from "../src/core/sandbox.ts";

const sandbox = await hostSandbox();
const skip = sandbox ? false : "no host sandbox on this platform";
const tmp = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
function program(dir: string, name: string, body: string) {
  const p = join(dir, name);
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}
const odBytes = (s: string) => s.split("\n").flatMap((l) => l.trim().split(/\s+/).slice(1)).filter((x) => /^[0-7]{3}$/.test(x)).map((x) => parseInt(x, 8));
const stepsOf = (r: any) => (r.executed?.titles ?? []).join(" → ");

test("S1 historical mandoc -> od: the octal dump is of the ORIGINAL text, never of a formatted intermediate", { skip: skip || (!existsSync("/usr/bin/mandoc") || !existsSync("/usr/bin/od") ? "mandoc/od not installed" : false), timeout: 120_000 }, async () => {
  const rc = await RightClick.create({ directories: [], authority: { investigate: ["/usr/bin/mandoc", "/usr/bin/od"] } });
  await rc.learn({ sources: ["cli:/usr/bin/mandoc", "cli:/usr/bin/od"] });
  const text = "Harbour lights\tat dusk\n";
  for (const intent of ["octal dump of the bytes of a text", "octal dump of the text", "show the bytes of the text in octal"]) {
    const r: any = await rc.compose({ have: { input: { type: "text", value: text } }, want: "text", intent, run: true, view: { full: true } } as any);
    assert.doesNotMatch(stepsOf(r), /mandoc/, `${intent}: no formatting step (${stepsOf(r)})`);
    if (r.executed?.status === "completed") assert.deepEqual(odBytes(String(r.executed.output)), [...Buffer.from(text)], `${intent}: the dump round-trips to the original bytes`);
  }
});

test("S1b a saved composite containing an unrequested transformation is not reused for a request that does not ask for it", { skip, timeout: 120_000 }, async () => {
  const dir = tmp("rcx-s1b-");
  const fmt = program(dir, "pageset", `if [ "$1" = "--help" ]; then echo "usage: pageset [file]"; echo "Typeset text as formatted pages"; exit 0; fi; while IFS= read -r l; do printf '   %s   ()\\n' "$l"; done`);
  const dump = program(dir, "octdump", `if [ "$1" = "--help" ]; then echo "usage: octdump [file]"; echo "Octal dump of the bytes of the input"; exit 0; fi; /usr/bin/od -b`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ sources: [`cli:${fmt}`, `cli:${dump}`] });
  const fmtCap = rc.graph.list().find((c) => c.provider === "cli:pageset")!;
  const dumpCap = rc.graph.list().find((c) => c.provider === "cli:octdump")!;
  // A caller explicitly asks for the two-step pipeline once; it is crystallised.
  await rc.compose({ have: { input: { type: "text", value: "first page\n" } }, want: "text", intent: "octal dump of the bytes of a text", through: [fmtCap.id, dumpCap.id], run: true } as any);
  // Later, someone asks for an octal dump of their text: the saved pipeline must not be reused.
  const text = "Harbour lights\tat dusk\n";
  const r: any = await rc.compose({ have: { input: { type: "text", value: text } }, want: "text", intent: "octal dump of the bytes of a text", run: true, view: { full: true } } as any);
  assert.doesNotMatch(stepsOf(r), /pageset|Typeset/i, `no typesetting step, directly or inside a saved pipeline (${stepsOf(r)})`);
  if (r.executed?.status === "completed") assert.deepEqual(odBytes(String(r.executed.output)), [...Buffer.from(text)]);
});

test("S2 a two-input comparison never gets the same caller value twice", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-s2-");
  const cmp = program(dir, "twocmp", `if [ "$1" = "--help" ]; then echo "usage: twocmp file1 file2"; echo "compare two files line by line"; exit 0; fi; /usr/bin/diff "$1" "$2"; exit 0`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${cmp}` });
  const r: any = await rc.compose({ have: { a: { type: "text", value: "one\ntwo\n" } }, want: "text", intent: "compare two files line by line", run: true } as any);
  for (const p of r.plans ?? []) for (const st of p.steps) {
    const froms = st.bindings.map((b: any) => b.from);
    assert.equal(new Set(froms).size, froms.length, `a step binds one value to two ports: ${froms.join(", ")}`);
  }
  assert.notEqual(r.executed?.status, "completed", "nothing comparable was supplied, so nothing is presented as a comparison");
});

test("S3 an unrelated type-preserving transformer is never inserted (base64 of a text with tidy available)", { skip: skip || (!existsSync("/usr/bin/base64") || !existsSync("/usr/bin/tidy") ? "base64/tidy not installed" : false), timeout: 120_000 }, async () => {
  const rc = await RightClick.create({ directories: [], authority: { investigate: ["/usr/bin/base64", "/usr/bin/tidy"] } });
  await rc.learn({ sources: ["cli:/usr/bin/base64", "cli:/usr/bin/tidy"] });
  const text = "Copper wire, brass hinges\n";
  const r: any = await rc.compose({ have: { input: { type: "text", value: text } }, want: "text", intent: "base64 encode the text", run: true, view: { full: true } } as any);
  assert.doesNotMatch(stepsOf(r), /tidy/, stepsOf(r));
  if (r.executed?.status === "completed") assert.equal(String(r.executed.output).replace(/\s+/g, ""), Buffer.from(text).toString("base64"));
});

test("S4 a trivial predicate is not verification: the result and the published goal are not labelled verified", async () => {
  const rc = await RightClick.create({ directories: [] });
  const r: any = await rc.compose({ have: { text: "The harbour lights came on at dusk. Gulls circled overhead." }, want: "text", intent: "summarize", run: true, verify: [{ op: "exists" }], publish: "Shout" } as any);
  assert.equal(r.executed?.status, "completed");
  assert.notEqual(r.executed?.verification.status, "verified", "a passed predicate is a check, not independent verification");
  assert.notEqual(r.published?.trust, "verified");
  const card: any = rc.card(rc.graph.get("goal:shout")!);
  assert.notEqual(card.verification?.trust, "verified");
});

// ------------------------------------------------------------------ S5–S7: web contracts
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const ok = (schema: object) => ({ "200": { description: "ok", content: { "application/json": { schema } } } });
const RECORDS = {
  openapi: "3.0.0", info: { title: "Records" }, servers: [{ url: "https://records.test" }],
  paths: { "/records/{accession}": { get: { operationId: "getRecord", summary: "Get a protein record", parameters: [{ name: "accession", in: "path", required: true, schema: { type: "string" }, description: "Protein accession identifier" }],
    responses: ok({ type: "object", properties: { accession: { type: "string" }, feature: { type: "object", properties: { ligand: { type: "object", properties: { label: { type: "string" } } } } }, organism: { type: "string" } } }) } } },
};
function records(calls: string[]) {
  return (async (input: any) => {
    const u = new URL(typeof input === "string" ? input : input.url);
    calls.push(u.pathname);
    if (u.pathname === "/openapi.json") return json(RECORDS);
    const m = /^\/records\/(\w+)$/.exec(u.pathname);
    if (m) return json({ accession: m[1], organism: "Homo sapiens" }); // the declared ligand label is absent
    return json({ error: "nf" }, 404);
  }) as typeof fetch;
}

test("S5 required information matched only by a field name that the result does not actually carry is incomplete, not success", async () => {
  const calls: string[] = [];
  const rc = await RightClick.create({ fetch: records(calls), directories: [] });
  await rc.learn({ source: "https://records.test/openapi.json" });
  const r: any = await rc.compose({ have: { accession: "P38398" }, want: "json", intent: "label of the protein", require: ["label"], run: true });
  assert.notEqual(r.outcome?.status, "established", JSON.stringify(r.outcome));
});

test("S6 information reachable only through a generic join is unverified and nothing runs", async () => {
  const calls: string[] = [];
  const rc = await RightClick.create({ fetch: records(calls), directories: [] });
  await rc.learn({ source: "https://records.test/openapi.json" });
  const before = calls.length;
  const r: any = await rc.compose({ have: { note: "some free text" }, want: "json", intent: "organism of the record", require: ["organism"], run: true });
  assert.notEqual(r.outcome?.status, "established");
  assert.equal(r.executed, undefined, "nothing ran");
  assert.equal(calls.length, before);
});

test("S7 no learned capability can produce the outcome: unavailable, nothing runs", async () => {
  const calls: string[] = [];
  const rc = await RightClick.create({ fetch: records(calls), directories: [] });
  await rc.learn({ source: "https://records.test/openapi.json" });
  const before = calls.length;
  const r: any = await rc.compose({ have: { accession: "P38398" }, want: "json", intent: "melting temperature", require: ["melting temperature"], run: true });
  assert.equal(r.outcome?.status, "unavailable");
  assert.equal(calls.length, before);
});

test("S8 a plan expected to preserve the input's content that loses it at run time fails its contract", { skip, timeout: 60_000 }, async () => {
  const dir = tmp("rcx-s8-");
  // Preserves every word of the investigator's samples, but silently drops lines mentioning "invoice".
  const p = program(dir, "tidyup", `if [ "$1" = "--help" ]; then echo "usage: tidyup [file]"; echo "Normalise spacing in a text"; exit 0; fi; /usr/bin/grep -v invoice | /usr/bin/tr -s ' '`);
  const rc = await RightClick.create({ directories: [], authority: { investigate: [`${dir}/`] } });
  await rc.learn({ source: `cli:${p}` });
  const r: any = await rc.compose({ have: { input: { type: "text", value: "pay  the   invoice\nthen   rest\n" } }, want: "text", intent: "normalise spacing in a text", run: true, view: { full: true } } as any);
  const lost = r.executed?.status === "completed" && !String(r.executed.output).includes("invoice");
  assert.ok(!lost || r.outcome?.status === "violated" || r.executed?.contract?.status === "violated", `content was lost but reported as success: ${JSON.stringify({ status: r.executed?.status, contract: r.executed?.contract })}`);
});
