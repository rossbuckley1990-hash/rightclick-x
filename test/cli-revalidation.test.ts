import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { RightClick } from "../src/runtime.ts";
import { FileStore } from "../src/entry/node-host.ts";
import { hostSandbox } from "../src/core/sandbox.ts";

const base = await hostSandbox();

function tool(dir: string, body: string): string {
  const bin = `${dir}/echo-tool`;
  writeFileSync(bin, body, { mode: 0o755 });
  return bin;
}

function reportTool(output = "REPORT"): string {
  return `#!/bin/sh
if [ "$1" = "--help" ]; then
  printf 'Usage: report-tool [OPTIONS] COMMAND [ARGS]...\\n\\nOptions:\\n  --help  Show this message and exit.\\n\\nCommands:\\n  report  Report records.\\n'
  exit 0
fi
if [ "$1" = "report" ] && [ "$2" = "--help" ]; then
  printf 'Usage: report-tool report [OPTIONS] [FILE]\\n\\n  Report records from FILE.\\n\\nOptions:\\n  --help  Show this message and exit.\\n'
  exit 0
fi
printf '${output}\\n'
`;
}

async function learned(bin: string, dir: string, retry: string[] = []) {
  const rc = await RightClick.create({ directories: [], authority: { investigate: [bin], retry }, store: new FileStore(`${dir}/state.json`) });
  await rc.learn({ source: `cli:${bin}` });
  const cap = rc.graph.list().find((c) => c.source === "cli" && c.invoke.kind === "cli")!;
  assert.ok(cap, "the program was learned");
  return { rc, cap };
}

const input = "alpha bravo\ncharlie delta\n";

test("a changed program that no longer reproduces its conformance examples is refused visibly", { skip: base ? false : "no host sandbox" }, async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-revalidation-`));
  const bin = tool(dir, "#!/bin/sh\nexec /bin/cat \"$@\"\n");
  const { rc, cap } = await learned(bin, dir);
  const name = cap.inputs[0].name;
  const priorSha = cap.invoke.kind === "cli" ? cap.invoke.sha256 : "";

  // Same path and interface, different bytes and different behaviour.
  tool(dir, "#!/bin/sh\nexec /usr/bin/rev \"$@\"\n");
  const refused = await rc.run(cap.id, { [name]: input });
  assert.equal(refused.status, "failed");
  assert.match(String(refused.error), /conformance examples no longer match|changed meaning/);
  // The refused bytes were not adopted: the next call refuses again rather than silently running them.
  const stored = rc.graph.get(cap.id)!.invoke;
  assert.equal(stored.kind === "cli" ? stored.sha256 : "", priorSha);
  const again = await rc.run(cap.id, { [name]: input });
  assert.equal(again.status, "failed");
});

test("a changed program that still reproduces its conformance examples is retried", { skip: base ? false : "no host sandbox" }, async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-revalidation-compatible-`));
  const bin = tool(dir, "#!/bin/sh\nexec /bin/cat \"$@\"\n");
  const { rc, cap } = await learned(bin, dir);
  const name = cap.inputs[0].name;

  tool(dir, "#!/bin/sh\n# reinstalled, same behaviour\nexec /bin/cat \"$@\"\n");
  const ran = await rc.run(cap.id, { [name]: input });
  assert.equal(ran.status, "completed", ran.error);
  assert.equal(String(ran.output), input);
  assert.match(ran.healing?.note ?? "", /retried/);
});

test("a documented-only subcommand has no behaviour evidence to accept a changed program", { skip: base ? false : "no host sandbox" }, async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-revalidation-declared-`));
  const bin = `${dir}/report-tool`;
  const body = reportTool();
  writeFileSync(bin, body, { mode: 0o755 });
  const { rc, cap } = await learned(bin, dir);
  assert.equal(cap.invoke.kind === "cli" ? cap.invoke.examples?.length : 1, undefined);
  const priorSha = cap.invoke.kind === "cli" ? cap.invoke.sha256 : "";

  writeFileSync(bin, body.replace("#!/bin/sh", "#!/bin/sh\n# reinstalled"), { mode: 0o755 });
  const refused = await rc.run(cap.id, { files: { "input.csv": "A,B\n1,2\n" }, operands: ["input.csv"] });
  assert.equal(refused.status, "failed");
  assert.match(String(refused.error), /no conformance examples or prior successful call/);
  const stored = rc.graph.get(cap.id)!.invoke;
  assert.equal(stored.kind === "cli" ? stored.sha256 : "", priorSha);
  const again = await rc.run(cap.id, { files: { "input.csv": "A,B\n1,2\n" }, operands: ["input.csv"] });
  assert.equal(again.status, "failed");
});

test("a documented-only subcommand is revalidated against its last successful call", { skip: base ? false : "no host sandbox" }, async () => {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-revalidation-receipt-`));
  const bin = `${dir}/report-tool`;
  writeFileSync(bin, reportTool(), { mode: 0o755 });
  const { rc, cap } = await learned(bin, dir, ["cli:report-tool:report"]);
  const args = { files: { "input.csv": "A,B\n1,2\n" }, operands: ["input.csv"] };
  const first = await rc.run(cap.id, args);
  assert.equal(first.status, "completed", first.error);

  writeFileSync(bin, reportTool().replace("#!/bin/sh", "#!/bin/sh\n# reinstalled"), { mode: 0o755 });
  const compatible = await rc.run(cap.id, args);
  assert.equal(compatible.status, "completed", compatible.error);
  assert.match(compatible.healing?.note ?? "", /retried/);
  const accepted = rc.graph.get(cap.id)!.invoke;
  const acceptedSha = accepted.kind === "cli" ? accepted.sha256 : "";

  writeFileSync(bin, reportTool("ALTERED"), { mode: 0o755 });
  const changed = await rc.run(cap.id, args);
  assert.equal(changed.status, "failed");
  assert.match(String(changed.error), /identical successful call differs|changed meaning/);
  const stored = rc.graph.get(cap.id)!.invoke;
  assert.equal(stored.kind === "cli" ? stored.sha256 : "", acceptedSha);
});
