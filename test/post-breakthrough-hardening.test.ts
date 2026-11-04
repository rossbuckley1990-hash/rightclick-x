import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

describe("Decision 1 — Verified UTF-8 Locale Execution Profile", () => {
  it("resolves C and UTF-8 locale profiles without ever combining LC_CTYPE with LC_ALL=C", () => {
    const cProfile = resolveSandboxLocale("c");
    assert.deepEqual(cProfile, C_LOCALE_PROFILE);
    assert.equal(cProfile.env.LC_ALL, "C");
    assert.equal(cProfile.env.LANG, "C");

    const utf8Profile = resolveSandboxLocale("utf8");
    assert.equal(utf8Profile.profile, "utf8");
    assert.match(utf8Profile.locale, /UTF-8$/i);
    assert.equal("LC_ALL" in utf8Profile.env, false, "LC_ALL must be omitted in UTF-8 profile so LC_CTYPE is not overridden");
    assert.equal(utf8Profile.env.LANG, utf8Profile.locale);
    assert.equal(utf8Profile.env.LC_CTYPE, utf8Profile.locale);
    assert.equal(utf8Profile.env.LC_COLLATE, "C");
    assert.equal(utf8Profile.env.LC_NUMERIC, "C");
    assert.equal(utf8Profile.env.LC_TIME, "C");
    assert.equal(utf8Profile.env.LC_MONETARY, "C");
    assert.equal(utf8Profile.env.LC_MESSAGES, "C");

    const fromEnv = authorityFromEnv({ RCX_SANDBOX_LOCALE: "utf8" });
    assert.equal(fromEnv.locale, "utf8");
  });

  it("rejects unsupported or non-UTF-8 locale selections fail-closed", async () => {
    assert.throws(() => resolveSandboxLocale("bogus_XX.UTF-8"), /RCX_SANDBOX_LOCALE refused.*not installed/);
    assert.throws(() => resolveSandboxLocale("en_US.ISO8859-1"), /RCX_SANDBOX_LOCALE refused.*not a UTF-8 locale/);
    assert.throws(() => resolveSandboxLocale("fr_FR"), /RCX_SANDBOX_LOCALE refused.*not a UTF-8 locale/);

    await assert.rejects(
      () => RightClick.create({ authority: { locale: "bogus_XX.UTF-8" } }),
      /RCX_SANDBOX_LOCALE refused.*not installed/,
    );
  });

  it("preserves deterministic byte-order sorting (LC_COLLATE=C) while enabling UTF-8 character classes in the sandbox", async () => {
    const baseSb = await hostSandbox();
    assert.ok(baseSb, "host sandbox must be available");
    const cSb = withSandboxLocale(baseSb, resolveSandboxLocale("c"));
    const utf8Sb = withSandboxLocale(baseSb, resolveSandboxLocale("utf8"));

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

    // Locale-dependent case conversion: tr '[:lower:]' '[:upper:]' on "münchen\n"
    if (fs.existsSync("/usr/bin/tr")) {
      const utf8Tr = await utf8Sb.run("/usr/bin/tr", ["[:lower:]", "[:upper:]"], { stdin: "münchen\n" });
      assert.equal(utf8Tr.code, 0);
      assert.equal(utf8Tr.stdout, "MÜNCHEN\n");

      const cTr = await cSb.run("/usr/bin/tr", ["[:lower:]", "[:upper:]"], { stdin: "münchen\n" });
      assert.equal(cTr.code, 0);
      assert.notEqual(cTr.stdout, "MÜNCHEN\n", "C locale must not treat multibyte UTF-8 'ü' as a single character");
    }
  });

  it("converts münchen.de -> xn--mnchen-3ya.de and ASCII controls through idn2 under the UTF-8 profile", async () => {
    const idn2Path = ["/opt/homebrew/bin/idn2", "/usr/local/bin/idn2", "/usr/bin/idn2"].find((p) => fs.existsSync(p));
    if (!idn2Path) return;

    // 1. Under default C locale, non-ASCII IDN fails while ASCII control succeeds
    const rcC = await RightClick.create({
      authority: { investigate: [idn2Path], execute: [idn2Path], locale: "c" },
    });
    const learnedC = await rcC.learn({ source: `cli:${idn2Path}` });
    assert.equal(learnedC.results[0]?.error, undefined);
    const lookupCapC = rcC.graph.list().find((c) => c.id.startsWith("cli:idn2:") && !c.tags.includes("unsupported"));
    assert.ok(lookupCapC, "idn2 capability should be promoted under C locale for ASCII domains");
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
      authority: { investigate: [idn2Path], execute: [idn2Path], locale: "utf8" },
    });
    const learnedUtf8 = await rcUtf8.learn({ source: `cli:${idn2Path}` });
    assert.equal(learnedUtf8.results[0]?.error, undefined);
    const lookupCapUtf8 = rcUtf8.graph.list().find((c) => c.id.startsWith("cli:idn2:") && !c.tags.includes("unsupported"));
    assert.ok(lookupCapUtf8, "idn2 capability should be promoted under UTF-8 locale");
    assert.equal(lookupCapUtf8.invoke.kind, "cli");
    if (lookupCapUtf8.invoke.kind === "cli") {
      assert.equal(lookupCapUtf8.invoke.localeProfile?.profile, "utf8");
      assert.match(lookupCapUtf8.invoke.localeProfile?.locale ?? "", /UTF-8$/i);
      assert.equal("LC_ALL" in (lookupCapUtf8.invoke.localeProfile?.env ?? {}), false);
    }

    const munchenRun = await rcUtf8.run(lookupCapUtf8.id, { input: "münchen.de\n" });
    assert.equal(munchenRun.status, "completed");
    assert.equal(String(munchenRun.output).trim(), "xn--mnchen-3ya.de");

    const asciiRunUtf8 = await rcUtf8.run(lookupCapUtf8.id, { input: "Alpha-Node.org\n" });
    assert.equal(asciiRunUtf8.status, "completed");
    assert.equal(String(asciiRunUtf8.output).trim(), "alpha-node.org");
  });

  it("includes locale profile in CLI environment fingerprints and refuses stale retained capabilities when the locale changes", async () => {
    const baseSb = await hostSandbox();
    assert.ok(baseSb);
    const cSb = withSandboxLocale(baseSb, resolveSandboxLocale("c"));
    const utf8Sb = withSandboxLocale(baseSb, resolveSandboxLocale("utf8"));

    const envC = await observeCliEnvironment("/usr/bin/sort", cSb.policy);
    const envUtf8 = await observeCliEnvironment("/usr/bin/sort", utf8Sb.policy);
    assert.notEqual(envC.digest, envUtf8.digest, "environment digest must change when sandbox locale profile changes");
    assert.equal(envC.locale?.profile, "c");
    assert.equal(envUtf8.locale?.profile, "utf8");

    // Persist state learned under C locale, then load into a runtime configured with UTF-8 locale
    const store = makeMemoryStore();
    const rcC = await RightClick.create({
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
      authority: { investigate: ["/usr/bin/sort"], execute: ["/usr/bin/sort"], locale: "utf8" },
    });
    const importReport = await rcUtf8Fresh.importKnowledge(bundle);
    assert.equal(importReport.programs[0]?.status, "accepted");
    assert.ok((importReport.programs[0]?.revalidationRuns ?? 0) > 0);
    const revalidatedRun = await rcUtf8Fresh.run(sortCap.id, { input: "b\na\n" });
    assert.equal(revalidatedRun.status, "completed");
    assert.equal(revalidatedRun.output, "a\nb\n");
  });

  it("preserves network and filesystem confinement under the UTF-8 execution profile", async () => {
    const baseSb = await hostSandbox();
    assert.ok(baseSb);
    const utf8Sb = withSandboxLocale(baseSb, resolveSandboxLocale("utf8"));
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

  it("suppresses warnings when fixed invariants are explicitly confirmed while keeping literal checks strictly enforced at runtime", async () => {
    const store = makeMemoryStore();
    const rc = await RightClick.create({
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
