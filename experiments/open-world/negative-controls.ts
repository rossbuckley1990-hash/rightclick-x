// Negative controls: cases where a credible integration engine must NOT
// connect capabilities, or must report failure rather than a plausible answer.
// Each control runs the named regression test(s) on the current build.
//   node experiments/open-world/negative-controls.ts

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CONTROLS: Array<{ control: string; expectation: string; tests: Array<[string, string]> }> = [
  {
    control: "Identical primitive types, different entities",
    expectation: "An invoice id (string) is never accepted where an order id (string) is required; no plan is produced.",
    tests: [["test/planning-rules.test.ts", "identifiers of different entities never mix"]],
  },
  {
    control: "A numerical field with ambiguous meaning",
    expectation: "When the tax-rate capability is gone, an order total (also a number) is not returned as the tax rate; the run fails instead.",
    tests: [["test/drift.test.ts", "healing preserves the meaning of the goal"]],
  },
  {
    control: "A seemingly compatible operation would change data during a read-only task",
    expectation: "With risks:[read], update/cancel capabilities never appear in plans; destructive capabilities do not run without confirm:true.",
    tests: [
      ["test/planning-rules.test.ts", "read-only constraint"],
      ["test/runtime.test.ts", "consent: writes run directly"],
    ],
  },
  {
    control: "A provider returns a successful response containing an incorrect result",
    expectation: "Verification predicates mark the run refuted (not verified), and it counts as a failure in the ledger.",
    tests: [["test/runtime.test.ts", "verification: refuted predicates"]],
  },
  {
    control: "A required provider disappears",
    expectation: "Its capabilities are withdrawn, dependent pipelines retired, an alternative used if one exists, otherwise the run fails.",
    tests: [["test/drift.test.ts", "a provider that disappears is withdrawn"]],
  },
  {
    control: "A contract changes but keeps the same operation name",
    expectation: "The saved pipeline built on the old contract is retired even though the operation id is unchanged.",
    tests: [["test/drift.test.ts", "a contract change under the same operation id"]],
  },
];

const build = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const results = CONTROLS.map((c) => {
  const runs = c.tests.map(([file, name]) => {
    const r = spawnSync(process.execPath, ["--test", "--test-name-pattern", name, file], { encoding: "utf8" });
    const pass = Number(/ℹ pass (\d+)/.exec(r.stdout)?.[1] ?? 0);
    const fail = Number(/ℹ fail (\d+)/.exec(r.stdout)?.[1] ?? 0);
    return { file, test: name, pass, fail, ok: r.status === 0 && pass > 0 && fail === 0 };
  });
  const ok = runs.every((r) => r.ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.control}`);
  return { ...c, runs, verdict: ok ? "PASS" : "FAIL" };
});
mkdirSync("experiments/open-world/evidence", { recursive: true });
writeFileSync("experiments/open-world/evidence/negative-controls.json", JSON.stringify({ build, at: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.filter((r) => r.verdict === "PASS").length}/${results.length} negative controls pass`);
