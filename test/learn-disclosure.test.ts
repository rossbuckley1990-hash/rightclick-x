// The learn response must be run-ready (the measured turn-count bottleneck: agents had to
// call graph+explain after learn just to learn what they learned), and compose must refuse
// malformed input with a useful message, never a TypeError (a raw TypeError was observed
// crossing to a client during the GLM development comparison when a caller sent {}).
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, learnAll, URLS } from "./helpers.ts";
import { ClientFacingError } from "../src/interface/client-error.ts";

test("context_learn returns the learned capabilities, run-ready: ids, titles and typed inputs", async () => {
  const { rc } = await world();
  const out = await rc.learn({ source: URLS.polyglot });
  const learned = out.results[0].learned[0];
  assert.ok(learned.capabilities?.length, "the learned list carries the new capabilities");
  assert.ok(learned.capabilities!.length >= 2, `polyglot exposes its operations (got ${learned.capabilities!.length})`);
  for (const c of learned.capabilities!) {
    assert.match(c.id, /^openapi:/);
    assert.ok(typeof c.title === "string" && c.title.length > 0, "a human title");
    assert.ok(Array.isArray(c.inputs), "inputs are listed inline");
    for (const p of c.inputs) {
      assert.equal(typeof p.name, "string");
      assert.equal(typeof p.type, "string");
      assert.equal(typeof p.required, "boolean");
    }
  }
  // The list is honest: every id is really runnable as learned.
  const first = learned.capabilities!.find((c) => c.inputs.length > 0)!;
  const run = await rc.run(first.id, Object.fromEntries(first.inputs.filter((p) => p.required).map((p) => [p.name, "test"])));
  assert.notEqual(run.status, "unknown capability");
});

test("learning several sources lists each provider's capabilities", async () => {
  const { rc } = await world();
  const out = await learnAll(rc);
  for (const result of out.results) {
    for (const learned of result.learned) {
      assert.ok(learned.capabilities?.length, `provider ${learned.provider} lists its capabilities`);
    }
  }
});

test("compose refuses malformed input with a useful invalid_argument message, not a TypeError", async () => {
  const { rc } = await world();
  await assert.rejects(rc.compose({} as never), (e: unknown) => {
    assert.ok(e instanceof ClientFacingError);
    assert.equal(e.code, "invalid_argument");
    assert.match(e.message, /have must be an object/);
    return true;
  });
  await assert.rejects(rc.compose({ have: {} } as never), (e: unknown) => {
    assert.ok(e instanceof ClientFacingError);
    assert.match(e.message, /want must be a semantic type/);
    return true;
  });
  await assert.rejects(rc.compose({ have: ["array"], want: "text" } as never), (e: unknown) => {
    assert.ok(e instanceof ClientFacingError);
    return true;
  });
});
