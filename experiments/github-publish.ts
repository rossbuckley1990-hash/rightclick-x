// E8: RightClick X publishes itself to a brand-new GitHub repository.
//
// No git push, no gh CLI, no GitHub SDK, no GitHub-specific code: the runtime
// learns GitHub's official OpenAPI description, *searches its own graph* for
// the operations it needs, and drives them through context_run. The proof is
// not "GitHub said 201": it is that the tree GitHub computes from the uploaded
// blobs hashes to exactly the same SHA as this checkout's `git write-tree`.
//
//   RCX_AUTH='{"https://api.github.com":{"Authorization":"Bearer …"}}' \
//     node experiments/github-publish.ts <owner> <repo> [--public]

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { RightClick } from "../src/runtime.ts";
import { Authority } from "../src/reflectors/net.ts";

const [owner, repo] = process.argv.slice(2);
const isPublic = process.argv.includes("--public");
if (!owner || !repo) throw new Error("usage: github-publish.ts <owner> <repo> [--public]");
const SPEC = "https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json";
const log = (...a: unknown[]) => console.log(...a);
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

const auth = new Authority();
auth.loadEnv(process.env.RCX_AUTH);
if (!auth.origins().includes("https://api.github.com")) throw new Error("RCX_AUTH must carry credentials for https://api.github.com");
const rc = await RightClick.create({ name: "rcx-self-publish", auth, timeoutMs: 60_000 });

const t0 = performance.now();
const learned = await rc.learn({ source: SPEC });
log(`learned GitHub REST: ${learned.totalNewCapabilities} operations in ${Math.round(performance.now() - t0)}ms (0 lines of GitHub code)`);

// The runtime finds its own tools.
function find(phrase: string, expect: RegExp): string {
  const hit = rc.graph.search(phrase, 5).find((h) => expect.test(h.capability.id));
  if (!hit) throw new Error(`no capability for "${phrase}"`);
  log(`  search "${phrase}" → ${hit.capability.id} [${hit.capability.risk}]`);
  return hit.capability.id;
}
const CREATE_REPO = find("create a repository for the authenticated user", /repos-create-for-authenticated-user$/);
const GET_REF = find("get a reference", /git-get-ref$/);
const CREATE_BLOB = find("create a blob", /git-create-blob$/);
const CREATE_TREE = find("create a tree", /git-create-tree$/);
const CREATE_COMMIT = find("create a commit", /git-create-commit$/);
const UPDATE_REF = find("update a reference", /git-update-ref$/);
const GET_COMMIT = find("get a commit object", /git-get-commit$/);

async function run(id: string, args: Record<string, unknown>, verify?: any[]) {
  const r = await rc.run(id, args, { verify });
  if (r.status !== "completed") throw new Error(`${id} failed: ${r.error}`);
  if (r.verification.status === "refuted") throw new Error(`${id} refuted: ${JSON.stringify(r.verification.results)}`);
  return r.output as any;
}

// 1. A brand-new repository.
const created = await run(
  CREATE_REPO,
  {
    name: repo,
    description: "An MCP server that becomes whatever its environment can do. This repository was created and populated by RightClick X itself.",
    private: !isPublic,
    auto_init: true,
  },
  [{ op: "equals", path: "full_name", value: `${owner}/${repo}` }],
);
log(`1. created ${created.full_name} (${created.private ? "private" : "public"}) → ${created.html_url}`);

// 2. The commit GitHub initialised it with.
const ref = await run(GET_REF, { owner, repo, ref: "heads/main" });
const parent = ref.object.sha;
log(`2. main is at ${parent.slice(0, 12)} (auto-init)`);

// 3. Every tracked file as a blob; each blob SHA must equal git's own object id.
const entries = git("ls-files", "-s")
  .split("\n")
  .map((l) => {
    const [meta, path] = l.split("\t");
    const [mode, sha] = meta.split(" ");
    return { mode, sha, path };
  });
let matched = 0;
const queue = [...entries];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      const blob = await run(CREATE_BLOB, { owner, repo, content: readFileSync(e.path).toString("base64"), encoding: "base64" });
      if (blob.sha !== e.sha) throw new Error(`blob mismatch for ${e.path}: github ${blob.sha} vs git ${e.sha}`);
      matched++;
    }
  }),
);
log(`3. uploaded ${entries.length} blobs; ${matched}/${entries.length} SHAs identical to the local git objects`);

// 4. The tree. Its SHA is computed by GitHub; it must equal the local tree.
const localTree = git("write-tree");
const tree = await run(CREATE_TREE, { owner, repo, tree: entries.map((e) => ({ path: e.path, mode: e.mode, type: "blob", sha: e.sha })) }, [
  { op: "equals", path: "sha", value: localTree },
]);
log(`4. GitHub tree ${tree.sha}\n   local tree  ${localTree}  ${tree.sha === localTree ? "✓ identical" : "✗ DIFFERENT"}`);

// 5. Commit and move main.
const message = `RightClick X ${process.env.npm_package_version ?? "0.1.0"}, published by RightClick X itself

Created through capabilities RightClick X reflected from GitHub's official
REST API description at runtime: repos/create-for-authenticated-user,
git/create-blob, git/create-tree, git/create-commit, git/update-ref.
No git push, no gh, no GitHub SDK, no GitHub-specific code.

Tree ${localTree} is identical to the source checkout's \`git write-tree\`.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
const commit = await run(CREATE_COMMIT, { owner, repo, message, tree: tree.sha, parents: [parent] }, [{ op: "equals", path: "tree.sha", value: localTree }]);
await run(UPDATE_REF, { owner, repo, ref: "heads/main", sha: commit.sha }, [{ op: "equals", path: "object.sha", value: commit.sha }]);
log(`5. commit ${commit.sha.slice(0, 12)} → main`);

// 6. Independent read-back through a different capability.
const back = await run(GET_COMMIT, { owner, repo, commit_sha: commit.sha }, [
  { op: "equals", path: "tree.sha", value: localTree },
  { op: "equals", path: "parents.0.sha", value: parent },
]);
const chain = await rc.verifyReceipts();
log(`6. read back: commit ${back.sha.slice(0, 12)} has tree ${back.tree.sha.slice(0, 12)} ✓ · ${chain.count} receipts, chain intact: ${chain.intact}`);

mkdirSync("experiments/results", { recursive: true });
writeFileSync(
  "experiments/results/E8-self-publish.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      repo: created.html_url,
      visibility: created.private ? "private" : "public",
      operationsLearned: learned.totalNewCapabilities,
      capabilitiesUsed: [CREATE_REPO, GET_REF, CREATE_BLOB, CREATE_TREE, CREATE_COMMIT, UPDATE_REF, GET_COMMIT],
      files: entries.length,
      blobShasMatched: matched,
      localTree,
      githubTree: tree.sha,
      commit: commit.sha,
      receipts: { count: chain.count, intact: chain.intact, head: chain.head },
    },
    null,
    2,
  ),
);
