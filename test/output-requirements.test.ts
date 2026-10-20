import test from "node:test";
import assert from "node:assert/strict";
import { RightClick, type RuntimeOptions } from "../src/runtime.ts";
import { reflectOpenAPI } from "../src/reflectors/openapi.ts";
import { dispatch } from "../src/interface/tools.ts";

const source = "https://inventory.test/openapi.json";
const id = "openapi:inventory:reading";
const spec = (field: string) => ({
  openapi: "3.1.0", info: { title: "Inventory" }, servers: [{ url: "https://inventory.test" }],
  paths: { "/readings/{sensor_id}": { get: { operationId: "reading", summary: "Read sensor record",
    parameters: [{ name: "sensor_id", in: "path", required: true, schema: { type: "string" } }],
    responses: { "200": { content: { "application/json": { schema: { type: "object",
      properties: { [field]: { type: "number" } } } } } } },
  } } },
});
const request = { have: { sensor_id: "sensor-2" }, want: "json", maxSteps: 1, run: true };
async function fixture(field: string, options: RuntimeOptions = {}) {
  const calls: string[] = [];
  let current = field;
  const rc = await RightClick.create({ directories: [], sandbox: null, ...options, fetch: async input => {
    calls.push(String(input));
    return Response.json(String(input) === source ? spec(current) : { [current]: 31 });
  } });
  const change = (next: string) => { current = next; rc.graph.add(reflectOpenAPI(spec(next), source)); };
  change(field);
  return { rc, calls, change };
}

test("absent output information skips incomplete candidates without dropping the requirement", async () => {
  const { rc, calls } = await fixture("parcel_mass");
  const size = rc.graph.capabilities.size;
  const result: any = await dispatch(rc, "context_compose", { ...request,
    require: ["parcel mass", "humidity"], publish: "must-not-publish" });
  assert.equal(result.outcome?.status, "unavailable");
  assert.match(result.outcome.reason, /current graph.*humidity/);
  assert.deepEqual(result.outcome.require, ["parcel mass", "humidity"]);
  assert.deepEqual(result.plans, [], "no futile incomplete candidates are searched");
  assert.equal(result.executed, undefined);
  assert.equal(result.published, undefined);
  assert.equal(result.planningRefusal, undefined);
  assert.equal(rc.graph.capabilities.size, size);
  assert.deepEqual(calls, []);
});

test("a capability ID in require gets guidance, never an automatic operation anchor", async () => {
  const { rc, calls, change } = await fixture("parcel_mass");
  const missing = await rc.compose({ ...request, require: [id] });
  assert.equal(missing.outcome?.status, "unavailable");
  assert.match(missing.outcome!.reason!, /through/);
  assert.deepEqual(missing.goal.through, []);
  assert.equal(missing.executed, undefined);
  assert.deepEqual(calls, []);
  // Identifier-shaped terms remain legitimate when a field actually carries those words.
  change("openapi_inventory_reading");
  const present = await rc.compose({ ...request, require: [id] });
  assert.equal(present.outcome?.status, "established");
  assert.equal(present.executed?.status, "completed");
  assert.equal(calls.length, 1);
  change("parcel_mass");
  const gone = await rc.compose({ ...request, require: [id] });
  assert.equal(gone.outcome?.status, "unavailable");
  assert.equal(gone.executed, undefined);
  assert.equal(calls.length, 1, "no stale coverage retained after graph replacement");
});

test("explicit acquisition can add missing evidence before the same request executes", async () => {
  let searches = 0;
  const { rc, calls } = await fixture("humidity", { directories: [{ id: "local-catalog",
    title: "Authorised catalog", url: "https://catalog.test", search: async () => {
      searches++;
      return [{ directory: "local-catalog", name: "sensor", title: "Sensor", description: "",
        source, kind: "openapi", score: 1 }];
    } }] });
  rc.graph.forget("openapi:inventory");
  const result = await rc.compose({ ...request, require: ["humidity"], acquire: true,
    verify: [{ op: "equals", path: "humidity", value: 31 }] });
  assert.equal(searches, 1);
  assert.ok(result.acquisition?.learned.some(l => l.capabilities === 1));
  assert.equal(result.outcome?.status, "established");
  assert.equal(result.executed?.status, "completed");
  assert.equal(result.executed?.verification.status, "checked");
  assert.deepEqual(calls, [source, "https://inventory.test/readings/sensor-2"]);
});

test("known information still diagnoses policy denial, while unknown information does not", async () => {
  const { rc, calls } = await fixture("humidity", { authority: { execution: { deniedCapabilities: [id] } } });
  const denied = await rc.compose({ ...request, require: ["humidity"] });
  assert.equal(denied.planningRefusal?.scope, "local-runtime-policy");
  assert.equal(denied.executed, undefined);
  const absent = await rc.compose({ ...request, require: ["thermal conductivity"] });
  assert.equal(absent.planningRefusal, undefined);
  assert.equal(absent.outcome?.status, "unavailable");
  assert.equal(absent.executed, undefined);
  assert.deepEqual(calls, []);
});

test("output metadata does not establish an unrelated input's semantic compatibility", async () => {
  const { rc, calls } = await fixture("humidity");
  const result = await rc.compose({ ...request, have: { account_id: "account-1" }, require: ["humidity"] });
  assert.notEqual(result.outcome?.status, "established");
  assert.equal(result.executed, undefined);
  assert.deepEqual(calls, []);
});

test("a scalar output's literal bracketed name retains the existing leaf satisfaction rule", async () => {
  const { rc, calls } = await fixture("parcel[]mass");
  const result = await rc.compose({ ...request, want: "number", run: false, through: [id], require: ["parcel"] });
  assert.equal(result.outcome?.status, "established");
  assert.ok(result.plans.some(p => p.result.endsWith(".parcel[]mass")));
  assert.deepEqual(calls, []);
});
