// Boundary behaviour of check() in src/core/verify.ts. Each case below fails under a
// single-token change to check() found by mutation testing, so it pins that token.
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, type Predicate } from "../src/core/verify.ts";

const status = (value: unknown, predicate: unknown) => check(value, [predicate as Predicate]).status;

test("an unrecognised predicate op refutes: a misspelt check must never count as passed", () => {
  const r = check({ a: 1 }, [{ op: "exist", path: "a" } as unknown as Predicate]);
  assert.equal(r.status, "refuted");
  assert.equal(r.results[0].ok, false);
});

test("exists refutes null and the empty string, and accepts zero and false", () => {
  assert.equal(status({ a: null }, { op: "exists", path: "a" }), "refuted");
  assert.equal(status({ a: "" }, { op: "exists", path: "a" }), "refuted");
  assert.equal(status({}, { op: "exists", path: "a" }), "refuted");
  assert.equal(status({ a: 0 }, { op: "exists", path: "a" }), "checked");
  assert.equal(status({ a: false }, { op: "exists", path: "a" }), "checked");
});

test("gt and lt are strict at the boundary", () => {
  assert.equal(status({ n: 5 }, { op: "gt", path: "n", value: 5 }), "refuted");
  assert.equal(status({ n: 5 }, { op: "lt", path: "n", value: 5 }), "refuted");
  assert.equal(status({ n: 6 }, { op: "gt", path: "n", value: 5 }), "checked");
  assert.equal(status({ n: 4 }, { op: "lt", path: "n", value: 5 }), "checked");
});

test("type object does not accept an array, and type array does", () => {
  assert.equal(status({ v: [] }, { op: "type", path: "v", value: "object" }), "refuted");
  assert.equal(status({ v: [] }, { op: "type", path: "v", value: "array" }), "checked");
  assert.equal(status({ v: {} }, { op: "type", path: "v", value: "object" }), "checked");
});
