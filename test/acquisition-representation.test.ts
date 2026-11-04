// Regression coverage for the five acquisition gaps: an empty result, output encoding, volatile
// sandbox paths, conservatively established output representations, and composition diagnostics,
// plus empirical discovery safeguards (error exit codes, filename-only variation, no-op flags,
// and anchored direct-only / JSON-port composition).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeProcessOutput, normaliseSandboxPaths, SANDBOX_PATH_PLACEHOLDER, CONFINED_POLICY, type SandboxRun } from "../src/core/sandbox.ts";
import { inspectValue, isAbsoluteUri, lineListType, linesValidateAs } from "../src/core/semantics.ts";
import { checkUrl } from "../src/reflectors/net.ts";
import { investigateCli } from "../src/reflectors/cli.ts";

// ---------------------------------------------------------------- output encoding

test("output that is not valid UTF-8 is reported undecodable instead of silently replaced", () => {
  // "café" re-encoded as ISO-8859-1: 0xE9 is not a valid UTF-8 sequence on its own.
  const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
  const decoded = decodeProcessOutput(latin1, false);
  assert.equal(decoded.valid, false, "a lossy decode must not be reported as valid");
  assert.match(decoded.text, /\uFFFD/, "the lossy text is still available as evidence about the run");

  const utf8 = Buffer.from("café\n", "utf8");
  assert.deepEqual(decodeProcessOutput(utf8, false), { text: "café\n", valid: true });
  assert.equal(decodeProcessOutput(Buffer.alloc(0), false).valid, true, "empty output is valid UTF-8");
});

test("a truncated stream is not called undecodable for the bytes the sandbox cut off", () => {
  // "é" is 0xC3 0xA9. Cutting after the first byte is the sandbox's doing, not the program's.
  const cut = Buffer.concat([Buffer.from("ok ", "utf8"), Buffer.from([0xc3])]);
  assert.equal(decodeProcessOutput(cut, true).valid, true, "an incomplete trailing sequence is discounted");
  assert.equal(decodeProcessOutput(cut, false).valid, false, "the same bytes undecodable when nothing truncated them");
  // A genuinely invalid byte in the middle is not excused by truncation.
  const middle = Buffer.concat([Buffer.from("a", "utf8"), Buffer.from([0xe9]), Buffer.from("b", "utf8")]);
  assert.equal(decodeProcessOutput(middle, true).valid, false);
});

// ---------------------------------------------------------------- absolute URIs & filenames

test("a URI is recognised by its shape, not by parser success", () => {
  // new URL() accepts all of these; none is a location.
  for (const prose of ["note: this is important", "C:\\Users\\someone\\file.txt", "javascript:alert(1)", "data:text/plain,hello"]) {
    assert.equal(isAbsoluteUri(prose), false, prose);
    assert.notEqual(inspectValue(prose).type, "url", prose);
  }
  for (const relative of ["doc.md", "../other/notes.md", "/absolute/path/page.md", "example.com/path"]) {
    assert.equal(isAbsoluteUri(relative), false, relative);
  }
  for (const uri of ["https://a.example/x", "http://a.example", "file:///rcx-sandbox/doc.md", "ftp://host/p", "mailto:audit@example.org", "tel:+15551234", "urn:isbn:12345"]) {
    assert.equal(isAbsoluteUri(uri), true, uri);
    assert.equal(inspectValue(uri).type, "url", uri);
  }
  // A bare address stays an email; a mailto URI is a location. Both are correct, and they are
  // different types, so a line list containing one and not the other is not uniformly typed.
  assert.equal(inspectValue("audit@example.org").type, "email");
  assert.equal(inspectValue("mailto:audit@example.org").type, "url");
  // Common filenames with file extensions are not domain names.
  for (const fname of ["input1.txt", "input1.html", "data.json", "report.csv", "schema.xml"]) {
    assert.notEqual(inspectValue(fname).type, "domain", fname);
  }
});

test("widening what counts as a url does not widen what may be fetched", async () => {
  // The typing change is only safe because reachability is decided elsewhere, on its own account.
  assert.equal(inspectValue("file:///etc/passwd").type, "url");
  await assert.rejects(() => checkUrl(undefined, "file:///etc/passwd"), /not allowed/);
  await assert.rejects(() => checkUrl(undefined, "javascript:alert(1)"), /not allowed|Invalid URL/);
  await assert.rejects(() => checkUrl(undefined, "data:text/plain,x"), /not allowed/);
});

// ---------------------------------------------------------------- line-oriented representations

test("a line list type is established only when every line of every output validates", () => {
  const urls = ["https://a.example/1\nhttps://b.example/2\n", "https://c.example/3\n"];
  assert.equal(lineListType(urls), "list:url");
  // Image URLs are a subtype of url, so a mixture of page URLs and image URLs is list:url.
  assert.equal(lineListType(["https://a.example/page\nhttps://a.example/logo.png\n"]), "list:url");
  assert.equal(linesValidateAs("https://a.example/page\nhttps://a.example/logo.png\n", "url"), true);
  // Trailing and interior blank lines are not elements.
  assert.equal(lineListType(["https://a.example/1\n\nhttps://b.example/2\n\n"]), "list:url");
  // Domains and numbers are specific too; bare text and json are not line elements.
  assert.equal(lineListType(["a.example\nb.example\n"]), "list:domain");
  assert.equal(lineListType(["1\n2\n3\n"]), "list:number");
  assert.equal(lineListType(['{"a":1}\n{"a":2}\n']), undefined, "json is handled as a whole-document representation");
});

test("one non-conforming line anywhere leaves the output opaque text", () => {
  // A header, a progress line, a summary footer: each is enough to defeat the representation.
  assert.equal(lineListType(["URL\nhttps://a.example/1\nhttps://b.example/2\n"]), undefined);
  assert.equal(lineListType(["https://a.example/1\nChecking...\nhttps://b.example/2\n"]), undefined);
  assert.equal(lineListType(["https://a.example/1\n2 links found\n"]), undefined);
  // Two specific types that are not the same type do not make a list.
  assert.equal(lineListType(["https://a.example/1\na.example\n"]), undefined);
  // Prose is never a list of anything specific.
  assert.equal(lineListType(["alpha bravo charlie\ndelta echo foxtrot\n"]), undefined);
  // A single observation establishes nothing.
  assert.equal(lineListType(["https://a.example/1\n"]), undefined);
  assert.equal(lineListType(["\n", ""]), undefined, "no lines at all is not a list type");
});

test("run-time re-validation uses the same rule that established the representation", () => {
  for (const output of ["https://a.example/1\nhttps://b.example/2\n"]) {
    const established = lineListType([output]);
    assert.equal(established, "list:url");
    assert.equal(linesValidateAs(output, "url"), true);
  }
  // A later input may be shorter: one element is still a list, so re-validation must not impose
  // the minimum line count that establishment needs.
  assert.equal(linesValidateAs("https://a.example/1\n", "url"), true);
  assert.equal(linesValidateAs("https://a.example/1\nsome prose\n", "url"), false);
  assert.equal(linesValidateAs("file:///rcx-sandbox/doc.md\nhttps://a.example/1\n", "url"), true);
});

// ---------------------------------------------------------------- volatile sandbox paths

test("the run's own sandbox directory is normalised without destroying the shape of the output", () => {
  const work = "/private/var/folders/ab/cd/T/rcx-sbx-XY12ab";
  const alias = "/var/folders/ab/cd/T/rcx-sbx-XY12ab";
  assert.equal(normaliseSandboxPaths(`file://${work}/doc.md`, work), `file://${SANDBOX_PATH_PLACEHOLDER}/doc.md`);
  assert.equal(normaliseSandboxPaths(`file://${alias}/doc.md`, work), `file://${SANDBOX_PATH_PLACEHOLDER}/doc.md`);
  assert.equal(normaliseSandboxPaths(`cannot open ${work}/input1.txt`, work), `cannot open ${SANDBOX_PATH_PLACEHOLDER}/input1.txt`);
  // The point of a path-shaped placeholder: the normalised destination is still a URI, so a
  // line-oriented result stays typeable after normalisation instead of being destroyed by it.
  const normalised = normaliseSandboxPaths(`file://${work}/doc.md`, work).trim();
  assert.equal(inspectValue(normalised).type, "url");
  assert.equal(lineListType([`${normalised}\nhttps://a.example/1\n`]), "list:url");
});

test("a path the sandbox did not create is a meaningful difference and survives normalisation", () => {
  const work = "/private/var/folders/ab/cd/T/rcx-sbx-XY12ab";
  // The host's temporary root, and any other path, are not this run's sandbox directory.
  const other = "file:///private/var/folders/ab/cd/T/other/notes.md";
  assert.equal(normaliseSandboxPaths(other, work), other);
  assert.equal(normaliseSandboxPaths("/etc/hosts changed", work), "/etc/hosts changed");
  assert.equal(normaliseSandboxPaths("no paths here", undefined), "no paths here");
});

// ---------------------------------------------------------------- runtime behaviour

const { RightClick } = await import("../src/runtime.ts");
const { createHash } = await import("node:crypto");
const { mkdtempSync, writeFileSync, realpathSync } = await import("node:fs");
const { tmpdir } = await import("node:os");

const dir = realpathSync(mkdtempSync(`${tmpdir()}/rcx-acq-`));
const program = `${dir}/fixture`;
const bytes = "#!/bin/sh\nexit 0\n";
writeFileSync(program, bytes, { mode: 0o755 });
const sha256 = createHash("sha256").update(bytes).digest("hex");

/** A runtime with one synthetic CLI capability and a sandbox that returns whatever the test sets. */
async function fixtureWorld(run: Partial<SandboxRun> & { code: number }) {
  const calls: any[] = [];
  const rc = await RightClick.create({
    directories: [],
    authority: { investigate: [program], execute: [program] },
    sandbox: {
      kind: "macos-sandbox-exec", policy: CONFINED_POLICY, enforces: [],
      async run(bin, argv, options) {
        calls.push({ bin, argv, options });
        const base: SandboxRun = { code: 0, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 1, created: [], workDir: dir };
        return { ...base, ...run };
      },
    },
  });
  return { rc, calls };
}

const addCapability = (rc: any, invoke: Record<string, unknown>, outputs: Array<Record<string, unknown>> = [{ name: "", type: "text", required: true }]) => {
  const cap: any = {
    id: "cli:fixture:default", provider: "cli:fixture", title: "Synthetic fixture", description: "Unit test transport only",
    source: "cli", inputs: [{ name: "input", type: "text", required: true }], outputs, risk: "read", tags: [],
    invoke: { kind: "cli", bin: program, args: [], stdin: "input", okExit: [0], output: "text", sha256, ...invoke },
  };
  rc.graph.add({ provider: { id: cap.provider, title: "Synthetic", source: "cli", learnedAt: new Date().toISOString(), capabilityIds: [cap.id], origin: program }, capabilities: [cap] });
  return cap;
};

test("empty standard output on the program's own success code is a result, not a failure", async () => {
  const { rc } = await fixtureWorld({ code: 0, stdout: "" });
  addCapability(rc, {});
  const run = await rc.run("cli:fixture:default", { input: "anything\n" });
  assert.equal(run.status, "completed", run.error);
  assert.equal(run.output, "");
  assert.equal(run.cliValidity?.emptyResult, true, "the record says the result was empty rather than leaving the caller to guess");
});

test("genuine failures are still failures, and an empty result does not excuse them", async () => {
  // A non-zero exit that the contract does accept, but that was never observed with a result.
  const { rc } = await fixtureWorld({ code: 1, stdout: "" });
  addCapability(rc, { okExit: [0, 1] });
  const nonZero = await rc.run("cli:fixture:default", { input: "x\n" });
  assert.equal(nonZero.status, "failed");
  assert.match(nonZero.error!, /without output/);

  // An exit code outside the learned set is refused whatever it printed.
  const { rc: rc2 } = await fixtureWorld({ code: 3, stdout: "something\n" });
  addCapability(rc2, {});
  const badExit = await rc2.run("cli:fixture:default", { input: "x\n" });
  assert.equal(badExit.status, "failed");

  // A timeout, a truncation and a sandbox limit are all still failures on empty output.
  for (const partial of [{ timedOut: true }, { truncated: true }, { limit: "memory" as const }]) {
    const { rc: rc3 } = await fixtureWorld({ code: 0, stdout: "", ...partial });
    addCapability(rc3, {});
    const failed = await rc3.run("cli:fixture:default", { input: "x\n" });
    assert.equal(failed.status, "failed", JSON.stringify(partial));
  }
});

test("undecodable output is refused with its raw bytes retained, never returned as text", async () => {
  const raw = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]);
  const { rc } = await fixtureWorld({ code: 0, stdout: raw.toString("utf8"), stdoutEncoding: "unsupported", stdoutBase64: raw.toString("base64"), stdoutBytes: raw.length });
  addCapability(rc, {});
  const run = await rc.run("cli:fixture:default", { input: "x\n" });
  assert.equal(run.status, "failed", "a lossy decode must not be reported as a completed result");
  assert.match(run.error!, /not valid UTF-8/);
  assert.equal(run.cliValidity?.rawOutputBase64, raw.toString("base64"), "the exact bytes survive as evidence");
  assert.equal(run.cliValidity?.stdoutBytes, raw.length);
});

test("the sandbox directory is normalised in the returned result and the raw output is still recoverable", async () => {
  const work = "/private/var/folders/ab/cd/T/rcx-sbx-XY12ab";
  const { rc } = await fixtureWorld({ code: 0, stdout: `file://${work}/doc.md\nhttps://a.example/1\n`, workDir: work });
  addCapability(rc, {});
  const run = await rc.run("cli:fixture:default", { input: "x\n" });
  assert.equal(run.status, "completed", run.error);
  assert.equal(run.output, `file://${SANDBOX_PATH_PLACEHOLDER}/doc.md\nhttps://a.example/1\n`);
  assert.equal(run.cliValidity?.sandboxPathNormalised, true);
  assert.match(run.cliValidity?.rawOutputSha256 ?? "", /^[0-9a-f]{64}$/, "the raw output's digest is retained");
  // A second run of the same behaviour is now byte-identical, which is what makes it reproducible.
  const { rc: rc2 } = await fixtureWorld({ code: 0, stdout: `file://${work}/doc.md\nhttps://a.example/1\n`, workDir: work });
  addCapability(rc2, {});
  assert.equal((await rc2.run("cli:fixture:default", { input: "x\n" })).output, run.output);
});

test("a declared line representation is re-validated on every run and returns a list", async () => {
  const { rc } = await fixtureWorld({ code: 0, stdout: "https://a.example/1\nhttps://b.example/2.png\n" });
  addCapability(rc, { lineType: "url" }, [{ name: "", type: "list:url", required: true }]);
  const run = await rc.run("cli:fixture:default", { input: "x\n" });
  assert.equal(run.status, "completed", run.error);
  assert.deepEqual(run.output, ["https://a.example/1", "https://b.example/2.png"]);

  // An input the representation does not hold for is refused, not coerced into the declared type.
  const { rc: rc2 } = await fixtureWorld({ code: 0, stdout: "https://a.example/1\n2 links found\n" });
  addCapability(rc2, { lineType: "url" }, [{ name: "", type: "list:url", required: true }]);
  const refused = await rc2.run("cli:fixture:default", { input: "x\n" });
  assert.equal(refused.status, "failed");
  assert.match(refused.error!, /not url/);
  assert.match(refused.error!, /2 links found/, "the offending line is named so the caller can see what happened");

  // An empty result of a list-typed capability is an empty list, not a refusal.
  const { rc: rc3 } = await fixtureWorld({ code: 0, stdout: "" });
  addCapability(rc3, { lineType: "url" }, [{ name: "", type: "list:url", required: true }]);
  const empty = await rc3.run("cli:fixture:default", { input: "x\n" });
  assert.equal(empty.status, "completed", empty.error);
  assert.deepEqual(empty.output, []);

  // Domain list representation re-validates every line too.
  const { rc: rc4 } = await fixtureWorld({ code: 0, stdout: "a.example\nb.example\n" });
  addCapability(rc4, { lineType: "domain" }, [{ name: "", type: "list:domain", required: true }]);
  const domains = await rc4.run("cli:fixture:default", { input: "x\n" });
  assert.equal(domains.status, "completed", domains.error);
  assert.deepEqual(domains.output, ["a.example", "b.example"]);
});

test("a composition that cannot be built says which port and type blocked it", async () => {
  const { rc } = await fixtureWorld({ code: 0, stdout: "x\n" });
  // A capability that only accepts html: nothing in this graph turns markdown into html.
  addCapability(rc, {}, [{ name: "", type: "list:url", required: true }]);
  rc.graph.get("cli:fixture:default")!.inputs = [{ name: "html", type: "html", required: true }];
  const composed = await rc.compose({ have: { document: "markdown" }, want: "list:url", intent: "enumerate links" });
  assert.equal(composed.plans.length, 0);
  const diagnostics = composed.compositionDiagnostics ?? [];
  assert.ok(diagnostics.length, "a caller must be told why nothing composed");
  const fixture = diagnostics.find((d) => d.capability === "cli:fixture:default");
  assert.ok(fixture, `the nearest candidate is named: ${JSON.stringify(diagnostics)}`);
  assert.match(fixture!.reasons.join(" "), /html/, "the port type it wanted is named");
  assert.match(fixture!.reasons.join(" "), /document|markdown/, "the value that was available is named");
});

test("investigation rejects exit code 2 even when error output echoes input words, and marks filename-only variation unsupported", async () => {
  const { reflection, investigation } = await investigateCli(program, {
    kind: "macos-sandbox-exec",
    policy: CONFINED_POLICY,
    enforces: [],
    async run(_bin, argv, opts) {
      const base: SandboxRun = { code: 0, stdout: "", stderr: "", timedOut: false, truncated: false, durationMs: 1, created: [], workDir: dir };
      if (argv.includes("--help") || argv.includes("-h")) {
        return {
          ...base,
          stdout: "fixture - check links in markdown and html documents\nUsage: fixture [OPTIONS] <FILE>\nOptions:\n  --dump         Print extracted links\n  --dump-inputs  Print input file names\n  --no-progress  Suppress progress output\n",
        };
      }
      if (argv.includes("--version")) return { ...base, stdout: "fixture 1.0.0\n" };
      const file = argv.find((a) => !a.startsWith("-"));
      if (!file) return { ...base, code: 2, stderr: "error: no input file provided\n" };
      const content = opts?.files?.[file] ?? "";
      if (argv.includes("--dump-inputs")) {
        return { ...base, stdout: file ? `${dir}/${file}\n` : "" };
      }
      const urls = [...content.matchAll(/https:\/\/[^\s)>\]]+/g)].map((m) => m[0]);
      if (argv.includes("--dump")) {
        return { ...base, stdout: urls.length ? urls.join("\n") + "\n" : "" };
      }
      // Default and --no-progress: if URLs exist, fail with exit code 2 echoing the input content; otherwise print constant summary.
      if (urls.length) {
        return { ...base, code: 2, stdout: `[ERROR] network blocked while checking:\n${content}\n` };
      }
      return { ...base, code: 0, stdout: "0 Total 0 OK 0 Errors\n" };
    },
  });
  assert.ok(reflection);
  const dump = reflection!.capabilities.find((c) => c.id === "cli:fixture:dump");
  assert.ok(dump, "dump mode is discovered");
  assert.ok(!dump!.tags.includes("unsupported"), "dump mode is experimentally supported");
  assert.equal(dump!.inputs[0]?.type, "markdown");
  assert.equal(dump!.outputs[0]?.type, "list:url");
  assert.equal((dump!.invoke as any).emptyResult, "observed", "empty output on link-free document is recorded");
  assert.deepEqual((dump!.invoke as any).okExit, [0], "exit code 2 is never learned as a valid exit");

  const dumpInputs = reflection!.capabilities.find((c) => c.id === "cli:fixture:dump-inputs");
  assert.ok(dumpInputs);
  assert.ok(dumpInputs!.tags.includes("input-independent-in-samples") && dumpInputs!.tags.includes("unsupported"), "filename-only variation across kinds is marked unsupported");
  assert.equal(dumpInputs!.outputs[0]?.type, "text", "filename-only output is not typed as list:domain");

  const noProgress = reflection!.capabilities.find((c) => c.id === "cli:fixture:no-progress");
  assert.equal(noProgress, undefined, "no-op flag is folded into default even when extra variants were probed");
  assert.ok(investigation.claims.some((c) => c.subject === "cli:fixture:no-progress" && c.status === "contradicted"));
});

test("anchored direct-only file-operand :invoke and anchored JSON-consuming CLI capabilities compose cleanly", async () => {
  const { rc } = await fixtureWorld({ code: 0, stdout: "https://alpha.example.com/a\nhttps://bravo.example.org/b\n" });
  const invokeCap: any = {
    id: "cli:fixture:invoke",
    provider: "cli:fixture",
    title: "fixture with documented options",
    description: "Extract links with documented options",
    source: "cli",
    inputs: [
      { name: "file1", type: "markdown", required: false },
      { name: "options", type: "list:text", required: false },
      { name: "files", type: "json", required: false },
      { name: "operands", type: "list:text", required: false },
    ],
    outputs: [{ name: "", type: "list:url", required: true }],
    risk: "read",
    tags: ["fixture", "declared-interface", "direct-only"],
    invoke: {
      kind: "cli",
      bin: program,
      args: [{ input: "file1" }],
      options: { port: "options", allowed: [{ flags: ["--dump"], arg: false }] },
      filesPort: "files",
      operandsPort: "operands",
      okExit: [0],
      output: "text",
      lineType: "url",
      sha256,
    },
  };
  rc.graph.add({ provider: { id: "cli:fixture", title: "Synthetic", source: "cli", learnedAt: new Date().toISOString(), capabilityIds: [invokeCap.id], origin: program }, capabilities: [invokeCap] });
  const composed = await rc.compose({
    have: { document: { type: "markdown", value: "# Doc\n[a](https://alpha.example.com/a)\n" }, options: { value: ["--dump"], fixed: true } },
    want: "list:domain",
    through: ["cli:fixture:invoke"],
    intent: "hosts linked from markdown",
    run: true,
  });
  assert.equal(composed.executed?.status, "completed", JSON.stringify(composed));
  assert.deepEqual(composed.executed?.output, ["alpha.example.com", "bravo.example.org"]);
});
