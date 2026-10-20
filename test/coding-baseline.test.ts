import { test } from "node:test";
import assert from "node:assert/strict";
import { CodeFiles, executeCode } from "../experiments/living/coding-host.ts";
import { benchmarkServer } from "../experiments/north-star/codex-session.ts";

test("baseline saves real executable code and documentation across fresh stores", async () => {
  const original = new CodeFiles();
  original.write("double.js", "return {answer:input.value*2}"); original.write("README.md", "Run double.js with value.");
  const fresh = new CodeFiles(original.snapshot());
  const result = await executeCode(fresh.read("double.js"), { value: 7 }, async () => { throw new Error("unexpected network"); });
  assert.deepEqual(result.value, { answer: 14 }); assert.equal(fresh.list().length, 2);
});
test("baseline files are bounded logical names, never host paths", () => {
  const store = new CodeFiles();
  for (const name of ["../a", "/etc/passwd", "", ".", "..", "a/b", "a\\b"]) assert.throws(() => store.write(name, "x"));
  assert.throws(() => store.write("large", "x".repeat(256 * 1024 + 1)));
  for (let i = 0; i < 64; i++) store.write("f" + i, "x");
  assert.throws(() => store.write("more", "x")); store.write("f0", "changed");
  assert.equal(store.read("f0"), "changed"); assert.throws(() => store.read("missing"));
});
test("worker uses measured fetch without hiding errors or request content", async () => {
  const requests: any[] = [];
  const result = await executeCode("const r=await fetch(input.url,{method:'POST',body:JSON.stringify(input.data)}); return {status:r.status,data:await r.json()}",
    { url: "https://example.test/query", data: { id: "a" } }, async request => {
      requests.push(request); return { status: 200, headers: {}, body: Buffer.from('{"result":42}').toString("base64") };
    });
  assert.equal(result.fetches, 1); assert.equal(requests[0].method, "POST");
  assert.equal(Buffer.from(requests[0].body, "base64").toString(), '{"id":"a"}');
  assert.deepEqual(result.value, { status: 200, data: { result: 42 } });
  await assert.rejects(executeCode("return await fetch('https://example.test/')", {}, async () => { throw new Error("operator refused"); }), /operator refused/);
});
test("unawaited fetch is drained before accounting closes", async () => {
  let completed = false;
  await executeCode("fetch('https://example.test/'); await new Promise(r=>setTimeout(r,20)); return 1", {}, async () => {
    await new Promise(resolve => setTimeout(resolve, 80)); completed = true;
    return { status: 200, headers: {}, body: "" };
  });
  assert.equal(completed, true);
});
test("timeouts, output overflow and script errors never become successful values", async () => {
  const noNetwork = async () => { throw new Error("unexpected network"); };
  await assert.rejects(executeCode("while(true){}", {}, noNetwork, 100), /timed out/);
  await assert.rejects(executeCode("return 'a'.repeat(300000)", {}, noNetwork), /result bound/);
  await assert.rejects(executeCode("console.log('a'.repeat(300000)); await new Promise(r=>setTimeout(r,100))", {}, noNetwork), /output bound/);
  await assert.rejects(executeCode("throw new Error('failed')", {}, noNetwork), /failed/);
});
test("model has only the four authorised coding-baseline tools", () => {
  const server = benchmarkServer("coding", { url: "http://127.0.0.1:1234/mcp" });
  assert.deepEqual(server.enabled_tools, ["run_code", "list_files", "read_file", "write_file"]);
  assert.throws(() => benchmarkServer("unknown", {}));
});
