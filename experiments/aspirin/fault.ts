// Fault controller is a separate process. It cannot change the worker's business checks.
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], process.argv[3], { mode: 0o600 });
