import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RightClick, type Store, type PersistedState } from "../src/runtime.ts";
import {
  C_LOCALE_PROFILE,
  effectiveSandboxLocale,
  hostSandbox,
  resolveSandboxLocale,
  withSandboxLocale,
} from "../src/core/sandbox.ts";
import { observeCliEnvironment } from "../src/core/cli-environment.ts";
import { lintPublicationPredicates } from "../src/core/verify.ts";
import { authorityFromEnv } from "../src/core/authority.ts";

const baseSandbox = await hostSandbox();
// Confinement assertions must run, never skip, wherever the host is supposed to confine: macOS always
// ships sandbox-exec, and the linux-bubblewrap CI job sets RCX_EXPECT_SANDBOX=1 after proving bwrap
// works. Elsewhere (linux-no-sandbox, Ubuntu runners with AppArmor-restricted user namespaces) the
// confinement tests skip with a stated reason and the fail-closed refusal is asserted instead.
const sandboxExpected = process.platform === "darwin" || process.env.RCX_EXPECT_SANDBOX === "1";
const skipIfNoSandbox = baseSandbox ? false : "host sandbox unavailable; the fail-closed refusal is asserted instead";

// Independent of resolveSandboxLocale: does the host list any UTF-8 locale at all? undefined = the
// host has no usable locale utility, which the product must also refuse.
function hostListsUtf8Locale(): boolean | undefined {
  const bin = ["/usr/bin/locale", "/bin/locale"].find((p) => fs.existsSync(p));
  if (!bin) return undefined;
  try {
    const out = execFileSync(bin, ["-a"], { env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 3000 });
    return out.split(/\r?\n/).some((l) => /utf-?8$/i.test(l.trim()));
  } catch {
    return undefined;
  }
}
const hostUtf8 = hostListsUtf8Locale();
const skipIfNoUtf8 = hostUtf8 ? false : "no UTF-8 locale installed on this host; the refusal is asserted instead";
const skipConfinedUtf8 = skipIfNoSandbox || skipIfNoUtf8;
const IDN2_PATHS = ["/opt/homebrew/bin/idn2", "/usr/local/bin/idn2", "/usr/bin/idn2"];

function makeMemoryStore(): Store & { snapshot: PersistedState | null } {
  let state: PersistedState | null = null;
  return {
    get snapshot() {
      return state;
    },
    async load() {
      return state ? structuredClone(state) : null;
    },
    async save(next: PersistedState) {
      state = structuredClone(next);
    },
    async withGoalLease<T>(_pins: Array<{ slug: string; digest: string }>, invoke: () => Promise<T>): Promise<T> {
      return invoke();
    },
  };
}

function makePortableIdn2Fixture(): { dir: string; bin: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rcx-idn2-fix-")));
  const bin = path.join(dir, "idn2");
  const script = `#!/bin/sh
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
  cat <<'EOF'
Usage: idn2 [OPTION]... [STRINGS]...
Internationalized Domain Name (IDNA2008) convert STRINGS, or standard input.

Command line interface to the Libidn2 implementation of IDNA2008.
All strings are expected to be encoded in the locale charset.

  -h, --help                Print help and exit
  -V, --version             Print version and exit
  -d, --decode              Decode (punycode) domain name
  -l, --lookup              Lookup domain name (default)
  -N, --tr46nt              Enable TR46 non-transitional processing
      --usestd3asciirules   Enable STD3 ASCII rules
      --no-alabelroundtrip  Disable A-label roundtrip for lookups
      --debug               Print debugging information
      --quiet               Silent operation
EOF
  exit 0
fi
if [ "$1" = "--version" ] || [ "$1" = "-V" ]; then
  echo "idn2 (Libidn2) 2.3.8"
  exit 0
fi
for arg in "$@"; do
  case "$arg" in
    --list|--list-commands)
      echo "idn2: unrecognized option '$arg'" >&2
      exit 1
      ;;
  esac
done
charmap=$(/usr/bin/locale charmap 2>/dev/null || echo "C")
process_line() {
  line="$1"
  [ -z "$line" ] && return 0
  non_ascii=$(printf '%s' "$line" | /usr/bin/tr -d '\\000-\\177')
  if [ -n "$non_ascii" ]; then
    case "$charmap" in
      UTF-8|utf8|UTF8)
        case "$line" in
          *münchen.de*) echo "xn--mnchen-3ya.de" ;;
          *zürich.ch*) echo "xn--zrich-kva.ch" ;;
          *bücher.ch*) echo "xn--bcher-kva.ch" ;;
          *) echo "xn--idn-punycode.org" ;;
        esac
        ;;
      *)
        echo "idn2: toAscii: could not convert from $charmap to UTF-8" >&2
        exit 1
        ;;
    esac
  else
    printf '%s\\n' "$line" | /usr/bin/tr 'A-Z' 'a-z'
  fi
}
if [ $# -gt 0 ] && [ "$1" != "-l" ] && [ "$1" != "--lookup" ] && [ "$1" != "-N" ] && [ "$1" != "--tr46nt" ] && [ "$1" != "--debug" ]; then
  for s in "$@"; do
    process_line "$s"
  done
  exit 0
fi
while IFS= read -r line || [ -n "$line" ]; do
  process_line "$line"
done
`;
  fs.writeFileSync(bin, script, { mode: 0o755 });
  return { dir, bin };
}

async function verifyIdn2Target(idn2Path: string): Promise<void> {
  // 1. Under default C locale, non-ASCII IDN fails while ASCII control succeeds
  const rcC = await RightClick.create({
    directories: [],
    authority: { investigate: [idn2Path], execute: [idn2Path], locale: "c" },
  });
  const learnedC = await rcC.learn({ source: `cli:${idn2Path}` });
  assert.equal(learnedC.results[0]?.error, undefined);
  const lookupCapC = rcC.graph.list().find((c) => c.id.startsWith("cli:idn2:") && !c.tags.includes("unsupported"));
  const learnedDetail = () =>
    `learned=${JSON.stringify(learnedC.results[0])}; cli caps=${JSON.stringify(rcC.graph.list().filter((c) => c.provider.startsWith("cli:")).map((c) => [c.id, c.tags.includes("unsupported")]))}`;
  assert.ok(lookupCapC, `idn2 capability should be promoted under C locale for ASCII domains (${idn2Path}; ${learnedDetail()})`);
  assert.equal(lookupCapC.invoke.kind, "cli");
  if (lookupCapC.invoke.kind === "cli") {
    assert.equal(lookupCapC.invoke.localeProfile?.profile, "c");
    assert.equal(lookupCapC.invoke.localeProfile?.locale, "C");
  }

  const asciiRunC = await rcC.run(lookupCapC.id, { input: "Alpha-Node.org\n" });
  assert.equal(asciiRunC.status, "completed");
  assert.equal(String(asciiRunC.output).trim(), "alpha-node.org");

  const idnRunC = await rcC.run(lookupCapC.id, { input: "münchen.de\n" });
  assert.equal(idnRunC.status, "failed", "C locale must reject non-ASCII IDN input in idn2");

  // 2. Under verified UTF-8 locale profile, both münchen.de -> xn--mnchen-3ya.de and ASCII controls succeed
  const rcUtf8 = await RightClick.create({
    directories: [],
    authority: { investigate: [idn2Path], execute: [idn2Path], locale: "utf8" },
  });
  const learnedUtf8 = await rcUtf8.learn({ source: `cli:${idn2Path}` });
  assert.equal(learnedUtf8.results[0]?.error, undefined);
  const lookupCapUtf8 = rcUtf8.graph.list().find((c) => c.id.startsWith("cli:idn2:") && !c.tags.includes("unsupported"));
  assert.ok(lookupCapUtf8, "idn2 capability should be promoted under UTF-8 locale");
  assert.equal(lookupCapUtf8.invoke.kind, "cli");
  if (lookupCapUtf8.invoke.kind === "cli") {
    assert.equal(lookupCapUtf8.invoke.localeProfile?.profile, "utf8");
    assert.match(lookupCapUtf8.invoke.localeProfile?.locale ?? "", /UTF-?8$/i);
    assert.equal("LC_ALL" in (lookupCapUtf8.invoke.localeProfile?.env ?? {}), false);
  }

  const munchenRun = await rcUtf8.run(lookupCapUtf8.id, { input: "münchen.de\n" });
  assert.equal(munchenRun.status, "completed");
  assert.equal(String(munchenRun.output).trim(), "xn--mnchen-3ya.de");

  const asciiRunUtf8 = await rcUtf8.run(lookupCapUtf8.id, { input: "Alpha-Node.org\n" });
  assert.equal(asciiRunUtf8.status, "completed");
  assert.equal(String(asciiRunUtf8.output).trim(), "alpha-node.org");
}

describe("Decision 1 — Verified UTF-8 Locale Execution Profile", () => {
  it("runs the confinement assertions wherever the host is expected to confine, rather than skipping them", (t) => {
    t.diagnostic(`host sandbox: ${baseSandbox ? `${baseSandbox.kind} (${baseSandbox.enforces.join("; ")})` : "none"}; UTF-8 locale listed: ${hostUtf8}`);
    if (sandboxExpected) assert.ok(baseSandbox, `${process.platform} with RCX_EXPECT_SANDBOX=${process.env.RCX_EXPECT_SANDBOX ?? ""} must have a working host sandbox`);
    if (sandboxExpected) assert.equal(hostUtf8, true, "supported CI hosts must list a UTF-8 locale so the UTF-8 confinement tests run");
  });

  it("resolves C and UTF-8 locale profiles without ever combining LC_CTYPE with LC_ALL=C", () => {
    const cProfile = resolveSandboxLocale("c");
    assert.deepEqual(cProfile, C_LOCALE_PROFILE);
    assert.equal(cProfile.env.LC_ALL, "C");
    assert.equal(cProfile.env.LANG, "C");

    const fromEnv = authorityFromEnv({ RCX_SANDBOX_LOCALE: "utf8" });
    assert.equal(fromEnv.locale, "utf8");

    // A host that lists no UTF-8 locale (or has no locale utility) must refuse the profile, not fall back to C.
    if (!hostUtf8) {
      assert.throws(() => resolveSandboxLocale("utf8"), /RCX_SANDBOX_LOCALE refused/);
      return;
    }

    // glibc lists the C UTF-8 locale as "C.utf8", macOS as "C.UTF-8"; the product accepts both spellings.
    const utf8Profile = resolveSandboxLocale("utf8");
    assert.equal(utf8Profile.profile, "utf8");
    assert.match(utf8Profile.locale, /UTF-?8$/i);
    assert.equal("LC_ALL" in utf8Profile.env, false, "LC_ALL must be omitted in UTF-8 profile so LC_CTYPE is not overridden");
    assert.equal(utf8Profile.env.LANG, utf8Profile.locale);
    assert.equal(utf8Profile.env.LC_CTYPE, utf8Profile.locale);
    assert.equal(utf8Profile.env.LC_COLLATE, "C");
    assert.equal(utf8Profile.env.LC_NUMERIC, "C");
    assert.equal(utf8Profile.env.LC_TIME, "C");
    assert.equal(utf8Profile.env.LC_MONETARY, "C");
    assert.equal(utf8Profile.env.LC_MESSAGES, "C");
  });

  it("rejects unsupported or non-UTF-8 locale selections fail-closed", async () => {
    assert.throws(() => resolveSandboxLocale("bogus_XX.UTF-8"), /RCX_SANDBOX_LOCALE refused.*not installed/);
    assert.throws(() => resolveSandboxLocale("en_US.ISO8859-1"), /RCX_SANDBOX_LOCALE refused.*not a UTF-8 locale/);
    assert.throws(() => resolveSandboxLocale("fr_FR"), /RCX_SANDBOX_LOCALE refused.*not a UTF-8 locale/);

    await assert.rejects(
      () => RightClick.create({ directories: [], authority: { locale: "bogus_XX.UTF-8" } }),
      /RCX_SANDBOX_LOCALE refused.*not installed/,
    );
  });

  it("preserves deterministic byte-order sorting (LC_COLLATE=C) while enabling UTF-8 character classes in the sandbox", { skip: skipConfinedUtf8 }, async () => {
    assert.ok(baseSandbox, "host sandbox must be available");
    const cSb = withSandboxLocale(baseSandbox, resolveSandboxLocale("c"));
    const utf8Sb = withSandboxLocale(baseSandbox, resolveSandboxLocale("utf8"));

    // Verify locale charmap inside both sandboxes
    if (fs.existsSync("/usr/bin/locale")) {
      const cCharmap = await cSb.run("/usr/bin/locale", ["charmap"]);
      assert.equal(cCharmap.code, 0);
      assert.match(cCharmap.stdout.trim(), /^(US-ASCII|ASCII|ANSI_X3\.4-1968|C)$/i);

      const utf8Charmap = await utf8Sb.run("/usr/bin/locale", ["charmap"]);
      assert.equal(utf8Charmap.code, 0);
      assert.equal(utf8Charmap.stdout.trim(), "UTF-8");
    }

    // Deterministic collation (A, B before a, b) must hold identically in both C and UTF-8 profiles
    const sortInput = "b\nA\na\nB\n";
    const cSort = await cSb.run("/usr/bin/sort", [], { stdin: sortInput });
    const utf8Sort = await utf8Sb.run("/usr/bin/sort", [], { stdin: sortInput });
    assert.equal(cSort.stdout, "A\nB\na\nb\n");
    assert.equal(utf8Sort.stdout, "A\nB\na\nb\n");

    // Cross-platform multi-byte character awareness: wc -m counts 8 UTF-8 chars ("münchen\n") under UTF-8 vs 9 raw bytes under C
    if (fs.existsSync("/usr/bin/wc")) {
      const utf8Wc = await utf8Sb.run("/usr/bin/wc", ["-m"], { stdin: "münchen\n" });
      const cWc = await cSb.run("/usr/bin/wc", ["-m"], { stdin: "münchen\n" });
      assert.equal(utf8Wc.code, 0);
      assert.equal(cWc.code, 0);
      assert.equal(Number(utf8Wc.stdout.trim()), 8, "UTF-8 locale must count multibyte 'ü' as a single character");
      assert.equal(Number(cWc.stdout.trim()), 9, "C locale counts multibyte 'ü' as two separate bytes");
    }

    // macOS BSD tr supports multi-byte case conversion under UTF-8 LC_CTYPE
    if (process.platform === "darwin" && fs.existsSync("/usr/bin/tr")) {
      const utf8Tr = await utf8Sb.run("/usr/bin/tr", ["[:lower:]", "[:upper:]"], { stdin: "münchen\n" });
      assert.equal(utf8Tr.code, 0);
      assert.equal(utf8Tr.stdout, "MÜNCHEN\n");

      const cTr = await cSb.run("/usr/bin/tr", ["[:lower:]", "[:upper:]"], { stdin: "münchen\n" });
      assert.equal(cTr.code, 0);
      assert.notEqual(cTr.stdout, "MÜNCHEN\n", "C locale must not treat multibyte UTF-8 'ü' as a single character");
    }
  });

  // A controlled idn2-shaped program whose behaviour depends only on the charmap the sandbox gives it
  // (it reads `locale charmap` inside the sandbox). It checks RightClick's side of the claim on every
  // supported host: learning, promotion, the recorded locale profile, the C profile refusing non-ASCII
  // input and the verified UTF-8 profile accepting it. It does not test libidn2's own conversion.
  it("learns a charmap-dependent idn2-shaped fixture: C refuses münchen.de, the verified UTF-8 profile converts it, ASCII controls pass in both", { skip: skipConfinedUtf8 }, async () => {
    const fixture = makePortableIdn2Fixture();
    try {
      await verifyIdn2Target(fixture.bin);
    } finally {
      fs.rmSync(fixture.dir, { recursive: true, force: true });
    }
  });

  // The real libidn2 binary, when the host has one. Asserted in full whenever the binary itself
  // converts correctly inside the sandbox; a visible skip (never a silent pass) otherwise.
  it("converts münchen.de -> xn--mnchen-3ya.de and ASCII controls through the host's real idn2 under the UTF-8 profile", { skip: skipConfinedUtf8 }, async (t) => {
    assert.ok(baseSandbox);
    const hostIdn2 = IDN2_PATHS.find((p) => fs.existsSync(p));
    if (!hostIdn2) return t.skip(`no idn2 installed at ${IDN2_PATHS.join(", ")}`);
    const cSb = withSandboxLocale(baseSandbox, resolveSandboxLocale("c"));
    const utf8Sb = withSandboxLocale(baseSandbox, resolveSandboxLocale("utf8"));
    const ascii = await cSb.run(hostIdn2, [], { stdin: "Alpha-Node.org\n" });
    const idn = await utf8Sb.run(hostIdn2, [], { stdin: "münchen.de\n" });
    const version = await cSb.run(hostIdn2, ["--version"]);
    t.diagnostic(
      `host idn2 ${fs.realpathSync(hostIdn2)} ${JSON.stringify(version.stdout.split("\n")[0])}: ` +
        `C run code=${ascii.code} out=${JSON.stringify(ascii.stdout.trim())} err=${JSON.stringify(ascii.stderr.trim().slice(0, 200))}; ` +
        `UTF-8 run code=${idn.code} out=${JSON.stringify(idn.stdout.trim())} err=${JSON.stringify(idn.stderr.trim().slice(0, 200))}`,
    );
    const works = ascii.code === 0 && ascii.stdout.trim() === "alpha-node.org" && idn.code === 0 && idn.stdout.trim() === "xn--mnchen-3ya.de";
    if (!works) return t.skip(`host idn2 at ${hostIdn2} does not itself convert inside the sandbox on this host; RightClick's side is asserted with the controlled fixture`);
    await verifyIdn2Target(hostIdn2);
  });

  it("includes locale profile in CLI environment fingerprints and refuses stale retained capabilities when the locale changes", { skip: skipConfinedUtf8 }, async () => {
    assert.ok(baseSandbox);
    const cSb = withSandboxLocale(baseSandbox, resolveSandboxLocale("c"));
    const utf8Sb = withSandboxLocale(baseSandbox, resolveSandboxLocale("utf8"));

    const envC = await observeCliEnvironment("/usr/bin/sort", cSb.policy);
    const envUtf8 = await observeCliEnvironment("/usr/bin/sort", utf8Sb.policy);
    assert.notEqual(envC.digest, envUtf8.digest, "environment digest must change when sandbox locale profile changes");
    assert.equal(envC.locale?.profile, "c");
    assert.equal(envUtf8.locale?.profile, "utf8");

    // Persist state learned under C locale, then load into a runtime configured with UTF-8 locale
    const store = makeMemoryStore();
    const rcC = await RightClick.create({
      directories: [],
      store,
      authority: { investigate: ["/usr/bin/sort"], execute: ["/usr/bin/sort"], locale: "c", shareEvidence: true },
    });
    await rcC.learn({ source: "cli:/usr/bin/sort" });
    const sortCap = rcC.graph.list().find((c) => c.id.startsWith("cli:sort:") && !c.tags.includes("unsupported"));
    assert.ok(sortCap);
    const okRun = await rcC.run(sortCap.id, { input: "b\na\n" });
    assert.equal(okRun.status, "completed");
    await rcC.flush();

    // Loading that persisted state under a UTF-8 runtime must refuse execution until revalidated
    const rcUtf8Stale = await RightClick.create({
      directories: [],
      store,
      authority: { investigate: ["/usr/bin/sort"], execute: ["/usr/bin/sort"], locale: "utf8" },
    });
    const staleRun = await rcUtf8Stale.run(sortCap.id, { input: "b\na\n" });
    assert.equal(staleRun.status, "failed");
    assert.equal(staleRun.cliValidity?.environment, "changed");
    assert.match(staleRun.error ?? "", /CLI execution environment changed/);

    // Explicit revalidation via importKnowledge replays conformance examples in the UTF-8 sandbox and updates the pin
    const bundle = rcC.exportKnowledge();
    const rcUtf8Fresh = await RightClick.create({
      directories: [],
      authority: { investigate: ["/usr/bin/sort"], execute: ["/usr/bin/sort"], locale: "utf8" },
    });
    const importReport = await rcUtf8Fresh.importKnowledge(bundle);
    assert.equal(importReport.programs[0]?.status, "accepted");
    assert.ok((importReport.programs[0]?.revalidationRuns ?? 0) > 0);
    const revalidatedRun = await rcUtf8Fresh.run(sortCap.id, { input: "b\na\n" });
    assert.equal(revalidatedRun.status, "completed");
    assert.equal(revalidatedRun.output, "a\nb\n");
  });

  it("preserves network and filesystem confinement under the UTF-8 execution profile", { skip: skipConfinedUtf8 }, async () => {
    assert.ok(baseSandbox);
    const utf8Sb = withSandboxLocale(baseSandbox, resolveSandboxLocale("utf8"));
    assert.equal(effectiveSandboxLocale(utf8Sb.policy).profile, "utf8");
    assert.equal(utf8Sb.policy.network, false);
    assert.deepEqual(utf8Sb.policy.writeRoots, []);

    // Filesystem write outside workDir must be blocked
    const escapeTarget = path.join(os.tmpdir(), `rcx-utf8-escape-${process.pid}-${Date.now()}.txt`);
    const fsAttempt = await utf8Sb.run("/bin/sh", ["-c", `echo escaped > ${escapeTarget}`]);
    assert.notEqual(fsAttempt.code, 0, "sandbox must block writes outside workDir under UTF-8 profile");
    assert.equal(fs.existsSync(escapeTarget), false);

    // Outbound network access must be blocked
    if (fs.existsSync("/usr/bin/curl")) {
      const netAttempt = await utf8Sb.run("/usr/bin/curl", ["-sS", "--max-time", "2", "http://1.1.1.1"]);
      assert.notEqual(netAttempt.code, 0, "sandbox must block outbound network under UTF-8 profile");
    }
  });

  // Runs on every host. Without a sandbox, neither locale profile may investigate or run a program,
  // and a capability learned under confinement is refused, never executed unconfined.
  it("fails closed without a sandbox under both locale profiles: nothing is investigated, imported or run", async () => {
    const sort = "/usr/bin/sort";
    const profiles = ["c", ...(hostUtf8 ? ["utf8"] : [])];
    for (const locale of profiles) {
      const runtimes = [
        await RightClick.create({ directories: [], sandbox: null, authority: { investigate: [sort], execute: [sort], locale } }),
        // On a host that really has no sandbox, the default host detection must refuse in the same way.
        ...(baseSandbox ? [] : [await RightClick.create({ directories: [], authority: { investigate: [sort], execute: [sort], locale } })]),
      ];
      for (const rc of runtimes) {
        const learned = await rc.learn({ source: `cli:${sort}` });
        assert.match(String(learned.results[0]?.error), /unavailable: no sandbox/, locale);
        assert.equal(rc.graph.list().filter((c) => c.provider.startsWith("cli:")).length, 0, locale);
      }
    }
    if (!baseSandbox) return;

    // Learned and persisted under confinement, then loaded where no sandbox is available.
    for (const locale of profiles) {
      const store = makeMemoryStore();
      const confined = await RightClick.create({ directories: [], store, authority: { investigate: [sort], execute: [sort], locale, shareEvidence: true } });
      await confined.learn({ source: `cli:${sort}` });
      const cap = confined.graph.list().find((c) => c.id.startsWith("cli:sort:") && !c.tags.includes("unsupported"));
      assert.ok(cap, locale);
      assert.equal((await confined.run(cap.id, { input: "b\na\n" })).status, "completed", locale);
      await confined.flush();

      const unconfined = await RightClick.create({ directories: [], store, sandbox: null, authority: { investigate: [sort], execute: [sort], locale } });
      const run = await unconfined.run(cap.id, { input: "b\na\n" });
      assert.equal(run.status, "failed", locale);
      assert.match(String(run.error), /no sandbox/, locale);
      assert.notEqual(run.output, "a\nb\n", locale);

      const imported = await RightClick.create({ directories: [], sandbox: null, authority: { investigate: [sort], execute: [sort], locale } });
      const report = await imported.importKnowledge(confined.exportKnowledge());
      assert.equal(report.programs[0]?.status, "refused", locale);
      assert.match(String(report.programs[0]?.reason), /no sandbox/, locale);
      assert.equal(report.programs[0]?.revalidationRuns, 0, locale);
    }
  });
});

describe("Decision 2 — Conservative Publication-Time Structural Predicate Linting", () => {
  it("warns on acquisition-sample, input-derived, domain/URL, filename, and vacuous-regex predicates without rejecting or rewriting them", () => {
    const warnings = lintPublicationPredicates(
      [
        { op: "contains", value: "alpha-acq.dev" },
        { op: "contains", value: "example.org" },
        { op: "contains", value: "https://unpinned-service.io/v1" },
        { op: "contains", value: "sample-input.md" },
        { op: "matches", pattern: ".*" },
        { op: "equals", path: "status", value: "ok" },
        { op: "length_gt", value: 0 },
      ],
      {
        inputs: { markdown: "Check https://alpha-acq.dev/docs and https://bravo-acq.org/spec" },
        fixedInputs: {},
      },
    );

    assert.equal(warnings.length, 5);
    assert.equal(warnings[0]?.code, "input-derived-literal");
    assert.equal(warnings[0]?.matchedSource, "input:markdown");
    assert.equal(warnings[1]?.code, "acquisition-sample-literal");
    assert.equal(warnings[2]?.code, "sample-domain-or-url");
    assert.equal(warnings[3]?.code, "sample-filename");
    assert.equal(warnings[4]?.code, "vacuous-regex");
  });

  it("suppresses warnings when fixed invariants are explicitly confirmed while keeping literal checks strictly enforced at runtime", { skip: skipIfNoSandbox }, async () => {
    const store = makeMemoryStore();
    const rc = await RightClick.create({
      directories: [],
      store,
      authority: { investigate: ["/usr/bin/sort"], execute: ["/usr/bin/sort"] },
    });
    await rc.learn({ source: "cli:/usr/bin/sort" });
    const sortCap = rc.graph.list().find((c) => c.id.startsWith("cli:sort:") && !c.tags.includes("unsupported"));
    assert.ok(sortCap);

    // 1. Publish WITH an unconfirmed input-derived literal ("alpha-acq.dev")
    const unconfirmedPub = await rc.compose({
      have: { input: "https://bravo-acq.org\nhttps://alpha-acq.dev\n" },
      want: sortCap.outputs[0]!.type,
      through: [sortCap.id],
      run: true,
      verify: [{ op: "contains", value: "alpha-acq.dev" }],
      publish: "sort_unconfirmed_literal",
    });
    assert.equal(unconfirmedPub.executed?.status, "completed");
    assert.equal(unconfirmedPub.published?.trust, "checked");
    assert.equal(unconfirmedPub.predicateWarnings?.length, 1);
    assert.equal(unconfirmedPub.predicateWarnings?.[0]?.code, "input-derived-literal");
    assert.equal(unconfirmedPub.published?.warnings?.length, 1);

    // Predicate was NOT silently rewritten: running on an unseen input without "alpha-acq.dev" is refuted
    const unseenRefuted = await rc.run(unconfirmedPub.published!.id, {
      input: "https://delta-unseen.io\nhttps://charlie-unseen.net\n",
    });
    assert.equal(unseenRefuted.status, "failed");
    assert.equal(unseenRefuted.verification.status, "refuted");

    // 2. Publish WITH explicit confirmFixedInvariant: true for an intentional literal requirement
    const confirmedPub = await rc.compose({
      have: { input: "https://corp.internal.example\nhttps://alpha.internal.example\n" },
      want: sortCap.outputs[0]!.type,
      through: [sortCap.id],
      run: true,
      verify: [{ op: "contains", value: "corp.internal.example", confirmFixedInvariant: true }],
      publish: "sort_confirmed_invariant",
    });
    assert.equal(confirmedPub.executed?.status, "completed");
    assert.equal(confirmedPub.predicateWarnings, undefined, "confirmed fixed invariant must not emit a warning");
    assert.equal(confirmedPub.published?.warnings, undefined);

    // Legitimate literal requirement remains strictly enforced on future runs
    const validCorpRun = await rc.run(confirmedPub.published!.id, {
      input: "https://zeta.internal.example\nhttps://corp.internal.example\n",
    });
    assert.equal(validCorpRun.status, "completed");
    assert.equal(validCorpRun.verification.status, "checked");

    const missingCorpRun = await rc.run(confirmedPub.published!.id, {
      input: "https://zeta.internal.example\nhttps://other.example.com\n",
    });
    assert.equal(missingCorpRun.status, "failed");
    assert.equal(missingCorpRun.verification.status, "refuted");

    // 3. Publish WITH structural condition: zero warnings, unseen inputs succeed, CHECKED vs VERIFIED preserved
    const structuralPub = await rc.compose({
      have: { input: "https://bravo-acq.org\nhttps://alpha-acq.dev\n" },
      want: sortCap.outputs[0]!.type,
      through: [sortCap.id],
      run: true,
      verify: [
        { op: "length_gt", value: 0 },
        { op: "matches", pattern: "^https://" },
      ],
      publish: "sort_structural_checked",
    });
    assert.equal(structuralPub.executed?.status, "completed");
    assert.equal(structuralPub.published?.trust, "checked");
    assert.equal(structuralPub.predicateWarnings, undefined);

    const unseenStructuralRun = await rc.run(structuralPub.published!.id, {
      input: "https://omega-unseen.io\nhttps://delta-unseen.io\n",
    });
    assert.equal(unseenStructuralRun.status, "completed");
    assert.equal(unseenStructuralRun.verification.status, "checked");
    assert.equal(unseenStructuralRun.output, "https://delta-unseen.io\nhttps://omega-unseen.io\n");

    // 4. Loose regex emits vacuous-regex warning and never upgrades CHECKED to VERIFIED; only an independent OutcomeWitness establishes VERIFIED
    const looseRegexPub = await rc.compose({
      have: { input: "https://bravo-acq.org\nhttps://alpha-acq.dev\n" },
      want: sortCap.outputs[0]!.type,
      through: [sortCap.id],
      run: true,
      verify: [{ op: "matches", pattern: ".*" }],
      publish: "sort_loose_regex",
    });
    assert.equal(looseRegexPub.published?.trust, "checked");
    assert.equal(looseRegexPub.predicateWarnings?.length, 1);
    assert.equal(looseRegexPub.predicateWarnings?.[0]?.code, "vacuous-regex");

    // Independent witness establishes VERIFIED and survives unseen inputs
    const verifiedPub = await rc.compose({
      have: { input: "https://bravo-acq.org\nhttps://alpha-acq.dev\n" },
      want: sortCap.outputs[0]!.type,
      through: [sortCap.id],
      run: true,
      verify: [{ op: "matches", pattern: "^https://" }],
      witnesses: [
        {
          capability: "builtin:text.sha256",
          args: { text: { output: "" } },
          verify: [{ op: "matches", pattern: "^[a-f0-9]{64}$" }],
        },
      ],
      publish: "sort_verified_witness",
    });
    assert.equal(verifiedPub.published?.trust, "verified");
    assert.equal(verifiedPub.predicateWarnings, undefined);

    const unseenVerifiedRun = await rc.run(verifiedPub.published!.id, {
      input: "https://omega-unseen.io\nhttps://delta-unseen.io\n",
    });
    assert.equal(unseenVerifiedRun.status, "completed");
    assert.equal(unseenVerifiedRun.verification.status, "verified");
  });
});
