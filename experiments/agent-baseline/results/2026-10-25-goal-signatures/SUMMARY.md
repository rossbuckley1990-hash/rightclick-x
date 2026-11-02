# Agent baseline, 2026-10-25T23:08:45.970Z

2.1.301 (Claude Code); models: claude-opus-5-5

## tidy (3 trials per arm)

| Arm | Pass | Inspection asked | Median time | Median turns | Median output tokens | Median uncached input | Median cache reads | Median cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rcx-warm | 3/3 |  | 20.9 s | 5 | 1137 | 14040 | 94076 | 0.154 |

## services (2 repetitions of 3 sessions)

| Arm | Pass | Inspection asked | Median time | Median turns | Median output tokens | Median uncached input | Median cache reads | Median cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rcx, first session | 2/2 | 2/2 | 32.3 s | 13 | 2301 | 22416 | 335544 | 0.292 |
| rcx, later sessions | 4/4 | 4/4 | 14.0 s | 4 | 532 | 13628 | 97808 | 0.139 |
