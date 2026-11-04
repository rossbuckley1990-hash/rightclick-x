// Section 9 — Generalisation Beyond Lychee & Negative Controls.
//
// Tests empirical acquisition, typed representation, execution and composition across multiple
// unfamiliar installed programs with different interfaces and output representations, plus all
// seven required negative controls:
//   NC1. Command that cannot be safely investigated (missing environmental precondition)
//   NC2. Command with misleading or incomplete documentation (/opt/homebrew/bin/sutf, /opt/homebrew/bin/hb-view, /opt/homebrew/bin/hmac256)
//   NC3. Command that produces no valid output on generic inputs (/opt/homebrew/bin/llama-gguf)
//   NC4. Command whose executable changes (sha256 mismatch + behavioural drift refusal)
//   NC5. Command with nondeterministic output (tagged nondeterministic + unsupported, refused by planner)
//   NC6. Command requiring prohibited network or filesystem access (sandbox confinement enforcement)
//   NC7. Command with unsupported binary input or non-UTF-8 output (/usr/bin/iconv)

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { RightClick } from "../../src/runtime.ts";
import { authorityFromEnv } from "../../src/core/authority.ts";

const HERE = new URL(".", import.meta.url).pathname;
const OUT = `${HERE}evidence/generalisation.json`;
const TMP_DIR = "/tmp/rcx-ns-generalisation";

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(`${HERE}evidence`, { recursive: true });

// Synthetic fixtures for NC1 (missing precondition), NC4 (changed executable), NC5 (nondeterministic), NC6 (sandbox probe)
const NC1_BIN = `${TMP_DIR}/precond-daemon`;
writeFileSync(
  NC1_BIN,
  `#!/bin/sh
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "precond-daemon - query local daemon"
  echo "Usage: precond-daemon [OPTIONS] [FILE]"
  echo "  -q, --quiet   Quiet mode"
  exit 0
fi
echo "precond-daemon: cannot open /etc/precond-daemon/daemon.conf: No such file or directory" >&2
exit 1
`,
  { mode: 0o755 },
);

const NC4_BIN = `${TMP_DIR}/drift-tool`;
writeFileSync(
  NC4_BIN,
  `#!/bin/sh
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "drift-tool - transform text lines"
  echo "Usage: drift-tool [OPTIONS]"
  echo "  -u, --upper   Convert to uppercase"
  exit 0
fi
cat
`,
  { mode: 0o755 },
);

const NC5_BIN = `${TMP_DIR}/nondet-tool`;
writeFileSync(
  NC5_BIN,
  `#!/bin/sh
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "nondet-tool - annotate input with random nonce"
  echo "Usage: nondet-tool [OPTIONS]"
  exit 0
fi
head -c 16 /dev/urandom | base64
cat
`,
  { mode: 0o755 },
);

const NC6_BIN = `${TMP_DIR}/escape-probe`;
writeFileSync(
  NC6_BIN,
  `#!/bin/sh
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  echo "escape-probe - test sandbox boundaries"
  echo "Usage: escape-probe [OPTIONS]"
  echo "  --read-home   Attempt to read user home directory"
  echo "  --write-tmp   Attempt to write outside sandbox workDir"
  exit 0
fi
if [ "$1" = "--read-home" ]; then
  ls "${process.env.HOME}" >/dev/null 2>&1 && echo "ESCAPED_READ" || { echo "sandbox blocked home read" >&2; exit 1; }
  exit 0
fi
if [ "$1" = "--write-tmp" ]; then
  touch /tmp/rcx-sandbox-escape-marker >/dev/null 2>&1 && echo "ESCAPED_WRITE" || { echo "sandbox blocked outside write" >&2; exit 1; }
  exit 0
fi
cat
`,
  { mode: 0o755 },
);

const PROGRAMS = [
  "/opt/homebrew/bin/jq",
  "/opt/homebrew/bin/idn2",
  "/opt/homebrew/bin/tidy",
  "/opt/homebrew/bin/ffeval",
  "/usr/bin/shasum",
  "/opt/homebrew/bin/hmac256",
  "/opt/homebrew/bin/sutf",
  "/opt/homebrew/bin/hb-view",
  "/opt/homebrew/bin/llama-gguf",
  "/usr/bin/iconv",
  NC1_BIN,
  NC4_BIN,
  NC5_BIN,
  NC6_BIN,
];

const rc = await RightClick.create({
  authority: authorityFromEnv({
    RCX_INVESTIGATE: PROGRAMS.join(","),
    RCX_EXECUTE: PROGRAMS.join(","),
  }),
});

const report: Record<string, any> = {
  startedAt: new Date().toISOString(),
  positivePrograms: {},
  negativeControls: {},
};

// ================================================================ 1. Positive Unfamiliar Programs
// P1: /opt/homebrew/bin/jq (JSON processor: stdin json -> structured json with observed fields)
const learnJq = await rc.learn({ source: "cli:/opt/homebrew/bin/jq" });
const jqDefault = rc.graph.get("cli:jq:default");
const jqSortKeys = rc.graph.get("cli:jq:sort-keys");
const jqRun = await rc.run("cli:jq:sort-keys", { json: { z: 1, a: 2, m: [3, 4] } });
report.positivePrograms.jq = {
  detail: learnJq.results[0]?.probes[0]?.detail ?? null,
  capabilityCount: rc.graph.list().filter((c) => c.provider === "cli:jq").length,
  defaultInputs: jqDefault?.inputs ?? null,
  defaultOutputs: jqDefault?.outputs ?? null,
  supported: !jqSortKeys?.tags.includes("unsupported"),
  sortKeysRun: {
    status: jqRun.status,
    output: jqRun.output,
    matchesExpected: JSON.stringify(jqRun.output) === JSON.stringify({ a: 2, m: [3, 4], z: 1 }),
  },
};

// P2: /opt/homebrew/bin/idn2 (IDNA2008 domain normalization utility in LC_ALL=C sandbox)
const learnIdn2 = await rc.learn({ source: "cli:/opt/homebrew/bin/idn2" });
const idn2Default = rc.graph.get("cli:idn2:default");
const idn2Lookup = await rc.run("cli:idn2:default", { input: "ALPHA-HOST.DEV\nBRAVO-HOST.IO\n" });
report.positivePrograms.idn2 = {
  detail: learnIdn2.results[0]?.probes[0]?.detail ?? null,
  capabilityIds: rc.graph.list().filter((c) => c.provider === "cli:idn2").map((c) => c.id),
  supported: !idn2Default?.tags.includes("unsupported"),
  normalizeRun: {
    status: idn2Lookup.status,
    output: String(idn2Lookup.output ?? "").trim().split("\n"),
    matchesExpected: JSON.stringify(String(idn2Lookup.output ?? "").trim().split("\n")) === JSON.stringify(["alpha-host.dev", "bravo-host.io"]),
  },
};

// P3: /opt/homebrew/bin/tidy (HTML Tidy markup processor with exit code 0/1 semantics)
const learnTidy = await rc.learn({ source: "cli:/opt/homebrew/bin/tidy" });
const tidyCaps = rc.graph.list().filter((c) => c.provider === "cli:tidy");
const tidyDefault = rc.graph.get("cli:tidy:default");
const tidyRun = await rc.run("cli:tidy:default", { html: "<!DOCTYPE html><html><head><title>Test</title></head><body><p>Hello Tidy</p></body></html>\n" });
report.positivePrograms.tidy = {
  detail: learnTidy.results[0]?.probes[0]?.detail ?? null,
  capabilityIds: tidyCaps.map((c) => c.id),
  defaultInputs: tidyDefault?.inputs ?? null,
  defaultOutputs: tidyDefault?.outputs ?? null,
  okExit: (tidyDefault?.invoke as any)?.okExit ?? null,
  supported: !tidyDefault?.tags.includes("unsupported"),
  run: {
    status: tidyRun.status,
    outputContainsBody: String(tidyRun.output ?? "").includes("Hello Tidy"),
  },
};

// P4: /opt/homebrew/bin/ffeval (FFmpeg mathematical expression evaluator)
const learnFfeval = await rc.learn({ source: "cli:/opt/homebrew/bin/ffeval" });
const ffevalE = rc.graph.get("cli:ffeval:e");
const ffevalRun = await rc.run("cli:ffeval:e", { input: "2+3*4\nsqrt(144)\n" });
report.positivePrograms.ffeval = {
  detail: learnFfeval.results[0]?.probes[0]?.detail ?? null,
  capabilityIds: rc.graph.list().filter((c) => c.provider === "cli:ffeval").map((c) => c.id),
  supported: !ffevalE?.tags.includes("unsupported"),
  run: {
    status: ffevalRun.status,
    output: String(ffevalRun.output ?? "").trim().split("\n"),
    matchesExpected: String(ffevalRun.output ?? "").includes("14.0") && String(ffevalRun.output ?? "").includes("12.0"),
  },
};

// P5: /usr/bin/shasum (Cryptographic digest tool)
const learnShasum = await rc.learn({ source: "cli:/usr/bin/shasum" });
const shasumDefault = rc.graph.get("cli:shasum:default");
const shasumRun = await rc.run("cli:shasum:default", { input: "abc" });
report.positivePrograms.shasum = {
  detail: learnShasum.results[0]?.probes[0]?.detail ?? null,
  capabilityIds: rc.graph.list().filter((c) => c.provider === "cli:shasum").map((c) => c.id),
  supported: !shasumDefault?.tags.includes("unsupported"),
  run: {
    status: shasumRun.status,
    output: String(shasumRun.output ?? "").trim(),
    matchesExpected: String(shasumRun.output ?? "").startsWith("a9993e364706816aba3e25717850c26c9cd0d89d"),
  },
};

// ================================================================ 2. Seven Required Negative Controls
// NC1: Command that cannot be safely investigated (missing environmental precondition)
const learnNc1 = await rc.learn({ source: `cli:${NC1_BIN}` });
const nc1Caps = rc.graph.list().filter((c) => c.provider === "cli:precond-daemon");
report.negativeControls.NC1_uninvestigablePrecondition = {
  detail: learnNc1.results[0]?.probes[0]?.detail ?? null,
  promotedCapabilities: nc1Caps.length,
  refusedAsMissingPrecondition: /not investigable here.*missing precondition/i.test(learnNc1.results[0]?.probes[0]?.detail ?? ""),
};

// NC2: Command with misleading or incomplete documentation (/opt/homebrew/bin/sutf, /opt/homebrew/bin/hb-view, /opt/homebrew/bin/hmac256)
const learnSutf = await rc.learn({ source: "cli:/opt/homebrew/bin/sutf" });
const learnHbView = await rc.learn({ source: "cli:/opt/homebrew/bin/hb-view" });
const learnHmac = await rc.learn({ source: "cli:/opt/homebrew/bin/hmac256" });
const sutfCaps = rc.graph.list().filter((c) => c.provider === "cli:sutf");
const hbCaps = rc.graph.list().filter((c) => c.provider === "cli:hb-view");
const hmacDefault = rc.graph.get("cli:hmac256:default");
const hbCompose = hbCaps[0] ? await rc.compose({ have: { input: "hello" }, want: "text", through: [hbCaps[0].id], run: false }) : null;
report.negativeControls.NC2_misleadingOrIncompleteDocs = {
  sutf: {
    detail: learnSutf.results[0]?.probes[0]?.detail ?? null,
    capabilityIds: sutfCaps.map((c) => c.id),
    tags: sutfCaps[0]?.tags ?? [],
    markedDeclaredOnlyAndUnsupported: (sutfCaps[0]?.tags.includes("declared-only") && sutfCaps[0]?.tags.includes("unsupported")) ?? false,
  },
  hbView: {
    detail: learnHbView.results[0]?.probes[0]?.detail ?? null,
    capabilityIds: hbCaps.map((c) => c.id),
    tags: hbCaps[0]?.tags ?? [],
    markedDeclaredOnlyAndUnsupported: (hbCaps[0]?.tags.includes("declared-only") && hbCaps[0]?.tags.includes("unsupported")) ?? false,
    excludedFromComposer: hbCompose ? hbCompose.plans.length === 0 : false,
    compositionDiagnostics: hbCompose?.compositionDiagnostics ?? null,
  },
  hmac256_filenameOnlyVariation: {
    detail: learnHmac.results[0]?.probes[0]?.detail ?? null,
    tags: hmacDefault?.tags ?? [],
    markedInputIndependentAndUnsupported: (hmacDefault?.tags.includes("input-independent-in-samples") && hmacDefault?.tags.includes("unsupported")) ?? false,
  },
};

// NC3: Command that produces no valid output on generic inputs (/opt/homebrew/bin/llama-gguf)
const learnGguf = await rc.learn({ source: "cli:/opt/homebrew/bin/llama-gguf" });
const ggufCaps = rc.graph.list().filter((c) => c.provider === "cli:llama-gguf");
report.negativeControls.NC3_noValidOutput = {
  detail: learnGguf.results[0]?.probes[0]?.detail ?? null,
  promotedCapabilities: ggufCaps.length,
  zeroCapabilitiesPromoted: ggufCaps.length === 0 && /no input channel produced output/i.test(learnGguf.results[0]?.probes[0]?.detail ?? ""),
};

// NC4: Command whose executable changes (behavioural drift refused)
const learnNc4 = await rc.learn({ source: `cli:${NC4_BIN}` });
const nc4Before = await rc.run("cli:drift-tool:default", { input: "hello world\n" });
writeFileSync(
  NC4_BIN,
  `#!/bin/sh
echo "COMPLETELY DIFFERENT OUTPUT"
`,
  { mode: 0o755 },
);
const nc4After = await rc.run("cli:drift-tool:default", { input: "hello world\n" });
report.negativeControls.NC4_changedExecutable = {
  detail: learnNc4.results[0]?.probes[0]?.detail ?? null,
  beforeChange: { status: nc4Before.status, output: nc4Before.output },
  afterBehaviouralChange: {
    status: nc4After.status,
    error: nc4After.error,
    refused: nc4After.status === "failed" && /changed|insufficient/i.test(nc4After.error ?? ""),
  },
};

// NC5: Command with nondeterministic output
const learnNc5 = await rc.learn({ source: `cli:${NC5_BIN}` });
const nc5Cap = rc.graph.get("cli:nondet-tool:default");
const nc5AutoCompose = await rc.compose({ have: { input: "hello\n" }, want: "text", intent: "annotate input with random nonce", run: false });
const nc5AnchoredCompose = await rc.compose({ have: { input: "hello\n" }, want: "text", through: ["cli:nondet-tool:default"], run: false });
report.negativeControls.NC5_nondeterministicOutput = {
  detail: learnNc5.results[0]?.probes[0]?.detail ?? null,
  tags: nc5Cap?.tags ?? [],
  markedNondeterministicAndUnsupported: (nc5Cap?.tags.includes("nondeterministic") && nc5Cap?.tags.includes("unsupported")) ?? false,
  excludedFromAutomaticComposition: !nc5AutoCompose.plans.some((p) => JSON.stringify(p).includes("nondet-tool")),
  excludedEvenWhenAnchored: nc5AnchoredCompose.plans.length === 0,
  compositionDiagnostics: nc5AnchoredCompose.compositionDiagnostics ?? null,
};

// NC6: Command requiring prohibited network or filesystem access (sandbox confinement)
const learnNc6 = await rc.learn({ source: `cli:${NC6_BIN}` });
const nc6ReadHome = await rc.run("cli:escape-probe:invoke", { input: "x\n", options: ["--read-home"] });
const nc6WriteTmp = await rc.run("cli:escape-probe:invoke", { input: "x\n", options: ["--write-tmp"] });
report.negativeControls.NC6_prohibitedFilesystemAndNetwork = {
  detail: learnNc6.results[0]?.probes[0]?.detail ?? null,
  readHomeBlocked: nc6ReadHome.status === "failed" && !String(nc6ReadHome.output ?? "").includes("ESCAPED_READ"),
  readHomeError: nc6ReadHome.error ?? null,
  writeOutsideSandboxBlocked: nc6WriteTmp.status === "failed" && !String(nc6WriteTmp.output ?? "").includes("ESCAPED_WRITE"),
  writeOutsideError: nc6WriteTmp.error ?? null,
};

// NC7: Command with unsupported binary input or non-UTF-8 output
const learnIconv = await rc.learn({ source: "cli:/usr/bin/iconv" });
const iconvRun = await rc.run("cli:iconv:invoke", { input: "café naïve\n", options: ["-f", "UTF-8", "-t", "ISO-8859-1"] });
report.negativeControls.NC7_unsupportedBinaryOrNonUtf8 = {
  iconvIso88591: {
    status: iconvRun.status,
    error: iconvRun.error ?? null,
    explicitlyUnsupportedEncoding: /not valid UTF-8|encoding is reported unsupported/i.test(iconvRun.error ?? ""),
    rawBase64Retained: !!iconvRun.cliValidity?.rawOutputBase64,
    replacementCharsReturned: (String(iconvRun.output ?? "").match(/\uFFFD/g) ?? []).length,
  },
};

report.finishedAt = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(report, null, 2));
rmSync(TMP_DIR, { recursive: true, force: true });
console.log(JSON.stringify({
  out: OUT,
  positivePrograms: Object.fromEntries(Object.entries(report.positivePrograms).map(([k, v]: [string, any]) => [k, {
    detail: v.detail,
    supported: v.supported,
    executionCompleted: (v.run ?? v.sortKeysRun ?? v.normalizeRun)?.status === "completed",
  }])),
  negativeControls: {
    NC1_refused: report.negativeControls.NC1_uninvestigablePrecondition.refusedAsMissingPrecondition,
    NC2_sutfMarkedUnsupported: report.negativeControls.NC2_misleadingOrIncompleteDocs.sutf.markedDeclaredOnlyAndUnsupported,
    NC2_hbViewUnsupportedAndExcluded: report.negativeControls.NC2_misleadingOrIncompleteDocs.hbView.markedDeclaredOnlyAndUnsupported && report.negativeControls.NC2_misleadingOrIncompleteDocs.hbView.excludedFromComposer,
    NC2_hmac256FilenameVariationRejected: report.negativeControls.NC2_misleadingOrIncompleteDocs.hmac256_filenameOnlyVariation.markedInputIndependentAndUnsupported,
    NC3_ggufZeroPromoted: report.negativeControls.NC3_noValidOutput.zeroCapabilitiesPromoted,
    NC4_changedExecutableRefused: report.negativeControls.NC4_changedExecutable.afterBehaviouralChange.refused,
    NC5_nondeterministicExcluded: report.negativeControls.NC5_nondeterministicOutput.markedNondeterministicAndUnsupported && report.negativeControls.NC5_nondeterministicOutput.excludedEvenWhenAnchored,
    NC6_sandboxConfinementEnforced: report.negativeControls.NC6_prohibitedFilesystemAndNetwork.readHomeBlocked && report.negativeControls.NC6_prohibitedFilesystemAndNetwork.writeOutsideSandboxBlocked,
    NC7_nonUtf8RefusedWithRawBytes: report.negativeControls.NC7_unsupportedBinaryOrNonUtf8.iconvIso88591.explicitlyUnsupportedEncoding && report.negativeControls.NC7_unsupportedBinaryOrNonUtf8.iconvIso88591.rawBase64Retained,
  },
}, null, 2));
process.exit(0);
