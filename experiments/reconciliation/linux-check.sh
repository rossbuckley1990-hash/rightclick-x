#!/bin/sh
# Offline Linux check: /candidate and /git are read-only; only /tmp and /evidence
# are writable. The existing repository metadata supplies provenance without
# creating another repository. Installed TypeScript dependencies are mounted read-only.
set -eu
cp -R /candidate/. /tmp/rcx
cd /tmp/rcx
export CI=true
node -e 'console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch}))' > /evidence/environment.json
npm run typecheck > /evidence/typecheck.log 2>&1
npm test > /evidence/regression.log 2>&1
node experiments/sse-discovery/acceptance.mjs . /evidence/acceptance.json > /evidence/acceptance.log 2>&1
node proof/run.ts 20261018 > /evidence/lifecycle.log 2>&1
cp proof/results/latest.json /evidence/lifecycle.json
node experiments/open-world/negative-controls.ts > /evidence/negative-controls.log 2>&1
cp experiments/open-world/evidence/negative-controls.json /evidence/negative-controls.json
# Exercise the portable bundles built on the host; Bun is not in the cached image.
node dist/rcx.mjs version > /evidence/bundle-smoke.log 2>&1
node --input-type=module -e "await import('./dist/edge.js')" >> /evidence/bundle-smoke.log 2>&1
tail -n 9 /evidence/regression.log
tail -n 1 /evidence/lifecycle.log
