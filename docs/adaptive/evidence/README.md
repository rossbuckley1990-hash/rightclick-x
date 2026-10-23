# Archived Adaptive Capability Plane evidence

The raw evidence behind the documents in [`docs/adaptive/`](..) is not in `main`'s working tree. It is kept, unchanged, at an immutable archive tag:

| | |
|---|---|
| Archive tag | [`archive/pr4-e413876`](https://github.com/rossbuckley1990-hash/rightclick-x/tree/archive/pr4-e413876/docs/adaptive/evidence) |
| Commit | `e413876fe3f5f000c1884a502827ec5639fc78b7`, the head of draft PR #4, a superset of PR #2 (also tagged `archive/pr2-42c46e0`) |
| Git tree of this directory | `343979e541a12ae39da7119edadaa1ecaeb98f31` |
| Contents | 10,253 regular files (1,143,426,168 bytes) and 3 symlinks |
| SHA-256 manifest | [`MANIFEST.sha256`](MANIFEST.sha256), one line per regular file |

**Why it moved.** The tree is 1.1 GB, about 95% of the reconciled repository. Keeping it in `main` would make every checkout of the product carry it. The project's artifact policy keeps source, tests, compact manifests and documentation in `main`. Large experiment traces are kept at stable GitHub references and checked with SHA-256 manifests. Nothing was rewritten or deleted from history. `main` reaches every original commit through the reconciliation merge.

## Retrieve and verify

```bash
git fetch origin tag archive/pr4-e413876
git worktree add ../rightclick-x-evidence archive/pr4-e413876
cd ../rightclick-x-evidence
shasum -a 256 -c /path/to/rightclick-x/docs/adaptive/evidence/MANIFEST.sha256
```

A clean result prints `OK` for all 10,253 files. The three symlinks are recorded by git, not the manifest:

- `claude-development-2a8eaa5/results.json.attempts/state/A/json_xs/bin/json_xs -> /usr/bin/json_xs`
- `codex-development-c047f96/results.json.attempts/state/B/json_xs/bin/json_xs -> /usr/bin/json_xs`
- `model-recheck-15928a3/completed-session-view/results.json.attempts -> ../results.json.attempts`

## Link-checking policy

The programme documents in `docs/adaptive/*.md`, and some in `docs/north-star/` and `experiments/`, are historical records. Their relative links into `evidence/` are intentionally left as written. They resolve inside an archive checkout, and in `main` they lead to this page. Editing them to point elsewhere would change the historical record they describe.

Current product documentation, meaning the root `README.md` and any new user-facing guide, must not link into this directory by relative path. Link to the archive tag URL instead.

The historical verifiers in `experiments/living/*.py` and `experiments/competitive-cli-anything/tools/` read from this directory. Run them from an archive checkout.

New large traces should go to a retained GitHub Actions artifact or an approved release asset, with a SHA-256 manifest committed here or beside the document that cites them.
