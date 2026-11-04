#!/usr/bin/env npx tsx
/**
 * Thin CLI entrypoint for RightClick X tool dispatch against a persisted state file.
 * Usage:
 *   npx tsx experiments/north-star-acquisition/rcx-cli.ts --state <path> [--locale c|utf8] <tool> '<json-args>'
 */
import fs from "node:fs";
import { RightClick, type PersistedState, type Store } from "../../src/runtime.ts";
import { dispatch } from "../../src/interface/tools.ts";

function createFileStore(filePath: string): Store {
  return {
    async load(): Promise<PersistedState | null> {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, "utf8")) as PersistedState;
    },
    async save(state: PersistedState): Promise<void> {
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
    },
    async withGoalLease<T>(_pins: Array<{ slug: string; digest: string }>, invoke: () => Promise<T>): Promise<T> {
      return invoke();
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  let statePath = "/tmp/rcx-default-state.json";
  let locale = process.env.RCX_SANDBOX_LOCALE ?? "utf8";
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--state" && argv[i + 1]) {
      statePath = argv[++i];
    } else if (argv[i] === "--locale" && argv[i + 1]) {
      locale = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  const [tool, rawArgs] = positional;
  if (!tool) {
    console.error("Usage: rcx-cli.ts --state <path> [--locale c|utf8] <context_tool> '<json-args>'");
    process.exit(2);
  }
  const args = rawArgs ? JSON.parse(rawArgs) : {};
  const allowedBins = [
    "/opt/homebrew/bin/lychee",
    "/opt/homebrew/bin/jq",
    "/opt/homebrew/bin/idn2",
    "/usr/bin/sort",
    "/usr/bin/tr",
  ].filter((p) => fs.existsSync(p));

  const store = createFileStore(statePath);
  let investigationsStarted = 0;
  const rc = await RightClick.create({
    store,
    authority: {
      investigate: allowedBins,
      execute: allowedBins,
      locale,
      shareEvidence: true,
    },
    onInvestigationStart: () => {
      investigationsStarted++;
    },
  });

  const t0 = performance.now();
  const out = await dispatch(rc, tool, args);
  await rc.flush();
  const durationMs = Math.round((performance.now() - t0) * 10) / 10;
  console.log(JSON.stringify({ ok: true, tool, durationMs, investigationsStarted, result: out }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message ?? err) }, null, 2));
  process.exit(1);
});
