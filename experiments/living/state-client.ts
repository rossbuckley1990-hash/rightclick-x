// Fresh-process compatibility probe. The only provider is a counted in-memory
// response; no real service, credential, shell capability or network is exposed.
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const [source, file] = process.argv.slice(2);
const { RightClick } = await import(pathToFileURL(source + "/src/runtime.ts").href);
const { FileStore } = await import(pathToFileURL(source + "/src/entry/node-host.ts").href);
const started = performance.now();
let calls = 0, rc: any;
const result: Record<string, unknown> = {};
try {
  rc = await RightClick.create({ directories: [], sandbox: null, store: new FileStore(file),
    fetch: async () => { calls++; return Response.json({ value: "controlled observation" }); } });
  result.created = true;
  try {
    const run = await rc.run("composite:scoped");
    result.run = { status: run.status, error: run.error, output: run.output, verification: run.verification.status };
  } catch (error) { result.runError = String((error as Error).message); }
  await rc.flush();
} catch (error) {
  result.created ??= false;
  result.error = String((error as Error).message);
}
result.calls = calls;
result.createRunFlushMs = performance.now() - started;
result.rssBytes = process.memoryUsage().rss;
result.afterHash = createHash("sha256").update(await readFile(file)).digest("hex");
console.log(JSON.stringify(result));
