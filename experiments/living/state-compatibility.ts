// Compare retained-state readers against actual frozen local source revisions.
// This is an exposed development experiment, not an independent holdout.
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RightClick, type PersistedState } from "../../src/runtime.ts";
import { reflectOpenAPI } from "../../src/reflectors/openapi.ts";
import { FileStore } from "../../src/entry/node-host.ts";

const output = resolve(process.argv[2]);
await mkdir(output); // Never overwrite an earlier experiment.
const temp = await mkdtemp(join(tmpdir(), "rcx-state-compatibility-"));
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
try {
  let saved: PersistedState | null = null;
  const rc = await RightClick.create({ directories: [], sandbox: null,
    store: { load: async () => null, save: async state => { saved = structuredClone(state); } } });
  rc.graph.add(reflectOpenAPI({ openapi: "3.1.0", info: { title: "Compatibility" },
    servers: [{ url: "https://controlled.invalid" }], paths: { "/value": { get: {
      operationId: "value", responses: { "200": { content: { "application/json": { schema: {
        type: "object", properties: { value: { type: "string" } },
      } } } } },
    } } } }, "https://controlled.invalid/spec"));
  rc.graph.addCapability({ id: "composite:scoped", title: "Scoped retained operation", provider: "composite:scope",
    source: "composite", description: "No outbound origin is allowed by this retained contract.", inputs: [],
    outputs: [{ name: "", type: "text", required: true }], risk: "read", tags: [],
    invoke: { kind: "composite", steps: [{ capability: "openapi:compatibility:value", bindings: [] }],
      result: "0.value", origins: [], verify: [{ op: "equals", value: "controlled observation" }] },
  }, { id: "composite:scope", title: "Scope", source: "composite", origin: "local", learnedAt: new Date().toISOString() });
  await rc.flush();
  const legacy = { ...saved!, version: 1 }; delete (legacy as any).requirements;
  const file = join(temp, "encoded.json");
  await new FileStore(file).save(saved!);
  const encoded = await readFile(file, "utf8");
  const states = { legacy: JSON.stringify(legacy), naiveVersionBump: JSON.stringify({ ...legacy, version: 2 }), currentEncoding: encoded };
  const revisions = ["d4c2ac74de96000424cb8570ccf7d1add68f0ef8", "6fa0da732a28c285764ea90578f94da17db4abfb"];
  const sources = [{ name: "current", directory: process.cwd(), revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() }];
  for (const revision of revisions) {
    const directory = join(temp, revision); await mkdir(directory);
    const archive = execFileSync("git", ["archive", revision, "src"]);
    execFileSync("tar", ["-xf", "-", "-C", directory], { input: archive });
    sources.push({ name: revision.slice(0, 8), directory, revision });
  }
  const results: object[] = [];
  for (const source of sources) for (const [name, text] of Object.entries(states)) {
    const path = join(temp, `${source.name}-${name}.json`);
    await writeFile(path, text);
    const stdout = execFileSync(process.execPath, [resolve("experiments/living/state-client.ts"), source.directory, path],
      { encoding: "utf8", env: { PATH: process.env.PATH }, timeout: 10_000 });
    const result = JSON.parse(stdout);
    results.push({ reader: source.name, revision: source.revision, state: name, beforeHash: sha(text),
      ...result, bytesPreserved: sha(text) === result.afterHash });
  }
  for (const [name, text] of Object.entries(states)) await writeFile(join(output, name + ".json"), text);
  await writeFile(join(output, "results.json"), JSON.stringify({ results,
    encodingBytes: Object.fromEntries(Object.entries(states).map(([name, text]) => [name, Buffer.byteLength(text)])),
    scope: "counted mock provider; actual frozen reader source; same author; timings exclude module import and are not a matched economic benchmark" }, null, 2) + "\n");
  console.log(JSON.stringify(results.map(({ reader, state, created, calls, bytesPreserved, error, runError, run }: any) =>
    ({ reader, state, created, calls, bytesPreserved, error, runError, status: run?.status })), null, 2));
} finally { await rm(temp, { recursive: true, force: true }); }
