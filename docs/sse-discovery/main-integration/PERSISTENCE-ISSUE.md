# Unresolved baseline persistence race

Status: **OPEN — separate from discovery integration**.

`FileStore.save` in `src/entry/node-host.ts` writes `${this.file}.${process.pid}.tmp` and renames it to the destination. Concurrent saves in one process can share that temporary path; one rename can remove the file another save expects, producing ENOENT.

The universal discovery recovery report at source commit `6b22a59333175fe25725e2631896a612da8f5f46` records an initial 338/339 suite failure and a subsequent unchanged 339/339 pass. Its bounded control reproduced the race in three out of three pairs on both programme baseline and corrected integration. Original control artifacts are copied byte-for-byte here as [JSON](store-race-control.json) and [log](store-race-control.log); the original report remains at `/Users/ross/src/rightclick-x-sse-integration/docs/sse-discovery/recovery/REPORT.md`.

Main's FileStore implementation retains the same shared temporary-path behavior. This candidate does not edit FileStore or runtime persistence, does not claim the race is fixed, and does not suppress or weaken any failing test. A persistence correction needs its own scoped review and concurrency verification. No remote issue was filed, and no unrelated development was undertaken.
