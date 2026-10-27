// Reproduce with a separate, unmodified checkout of the pre-protected main:
// node experiments/protected-values/legacy-reader.ts /path/to/old/checkout
// No credentials, customer systems or model sessions are used.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RightClick } from "../../src/runtime.ts";
import { reflectOpenAPI } from "../../src/reflectors/openapi.ts";
import { MemoryStore } from "../../test/helpers.ts";
const old = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("supply a separate checkout of main at 278d66c");
const rev = spawnSync("git", ["-C", old, "rev-parse", "HEAD"], { encoding: "utf8" });
if (rev.status !== 0 || rev.stdout.trim() !== "278d66c327ffe60b25805399b1f6d284840d1628") throw new Error("old checkout must be at 278d66c");
const ref = { kind: "protected-value-ref" as const, version: 1 as const, slot: "service-key", purpose: "read", requiredScope: "read:check" };
const spec = { openapi: "3.1.0", info: { title: "Protected" }, servers: [{ url: "https://service.test" }], paths: { "/check": { get: { operationId: "check", summary: "Check flag", parameters: [{ name: "x-api-key", in: "header", required: true, schema: { type: "string" } }], responses: { "200": { content: { "application/json": { schema: { type: "boolean" } } } } } } } } };
const store = new MemoryStore();
const rc = await RightClick.create({ store, directories: [], sandbox: null, fetch: async () => Response.json(true), protectedValues: { principal: "alice", allowBooleanOutput: true, withAuthorizedValue: async (_req, consume) => consume("fixture-legacy-9371") } });
rc.graph.add(reflectOpenAPI(spec, "https://service.test/openapi.json"));
const created = await rc.compose({ have: { "x-api-key": { type: "id", value: ref } }, want: "boolean", through: ["openapi:protected:check"], run: true, publish: "protected check", verify: [{ op: "equals", value: true }] });
if (!created.published?.durable || !store.state?.requirements?.includes("protected-value-slots@1")) throw new Error("fixture failed to publish protected state");
const state = JSON.stringify(store.state);
if (state.includes("fixture-legacy-9371")) throw new Error("protected fixture value escaped");
const oldRuntime = pathToFileURL(resolve(old, "src/runtime.ts")).href;
const code = `import {RightClick} from ${JSON.stringify(oldRuntime)}; let calls=0; const chunks=[]; for await (const x of process.stdin) chunks.push(x); const state=JSON.parse(Buffer.concat(chunks).toString()); try { const rc=await RightClick.create({directories:[],sandbox:null,fetch:async()=>{calls++;throw Error('dispatch');},store:{load:async()=>state,save:async()=>{throw Error('save');}}}); await rc.run('goal:protected-check',{}); console.log('OLD_READER_EXECUTED'); process.exitCode=1; } catch(e) { if (!String(e?.message).includes('unsupported runtime state requirement') || calls!==0) { console.log('UNEXPECTED_REFUSAL'); process.exitCode=1; } else console.log('OLD_READER_REFUSED_BEFORE_DISPATCH'); }`;
const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { input: state, encoding: "utf8", timeout: 10_000 });
if (result.status !== 0 || result.stdout.trim() !== "OLD_READER_REFUSED_BEFORE_DISPATCH") throw new Error(`old reader control failed: ${result.stdout} ${result.stderr}`);
console.log(result.stdout.trim());
