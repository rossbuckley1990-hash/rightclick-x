# Agent baseline, 2026-10-25T22:49:38.136Z

2.1.301 (Claude Code); models: claude-opus-5-5

## tidy (3 trials per arm)

| Arm | Pass | Inspection asked | Median time | Median turns | Median output tokens | Median uncached input | Median cache reads | Median cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rcx-warm | 3/3 |  | 25.9 s | 5 | 1064 | 13163 | 93915 | 0.144 |
| rcx-cold | 3/3 |  | 30.5 s | 8 | 1247 | 14222 | 201659 | 0.179 |
| shell | 3/3 |  | 14.0 s | 2 | 710 | 6859 | 45217 | 0.078 |

## services (2 repetitions of 3 sessions)

| Arm | Pass | Inspection asked | Median time | Median turns | Median output tokens | Median uncached input | Median cache reads | Median cost (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rcx, first session | 2/2 | 2/2 | 34.5 s | 11 | 2183 | 21347 | 232908 | 0.261 |
| rcx, later sessions | 4/4 | 4/4 | 14.5 s | 4 | 547 | 13688 | 97960 | 0.140 |
| shell, first session | 2/2 | 2/2 | 13.4 s | 5 | 500 | 7490 | 125165 | 0.095 |
| shell, later sessions | 4/4 | 4/4 | 16.1 s | 5 | 501 | 7476 | 125163 | 0.095 |
| shell-memory, first session | 2/2 | 2/2 | 17.4 s | 6 | 843 | 8045 | 153091 | 0.112 |
| shell-memory, later sessions | 4/4 | 4/4 | 19.4 s | 6 | 716 | 6161 | 155107 | 0.094 |
