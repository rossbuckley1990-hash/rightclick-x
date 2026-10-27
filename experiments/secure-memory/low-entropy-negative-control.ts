// Historical negative control: these values are synthetic, not credentials.
// Exit 1 means the legacy public digests remain vulnerable to simple guessing.
import { ReceiptChain, sha256, stableStringify } from "../../src/core/ledger.ts";
import { Authority } from "../../src/reflectors/net.ts";

const marker = "0037";
const args = { harmlessName: marker };
const chain = new ReceiptChain();
const receipt = await chain.append({ runId: "synthetic", capability: "fixture", provider: "fixture", startedAt: "2026-01-01T00:00:00.000Z", durationMs: 0, status: "completed", verification: "unverified" }, args, null);
let receiptGuess = false;
for (let i = 0; i < 100; i++) {
  const guess = String(i).padStart(4, "0");
  if (await sha256(stableStringify({ harmlessName: guess })) === receipt.inputDigest) { receiptGuess = guess === marker; break; }
}
const fingerprint = async (value: string) => {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ "x-fixture": value })));
  return [...new Uint8Array(bytes)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
};
const auth = new Authority();
auth.set("https://fixture.invalid", { "x-fixture": marker });
const stored = (await auth.fingerprints())["https://fixture.invalid"];
let fingerprintGuess = false;
for (let i = 0; i < 100; i++) {
  const guess = String(i).padStart(4, "0");
  if (await fingerprint(guess) === stored) { fingerprintGuess = guess === marker; break; }
}
console.log(JSON.stringify({ synthetic: true, legacyReceiptGuessable: receiptGuess, legacyFingerprintGuessable: fingerprintGuess }));
if (receiptGuess || fingerprintGuess) process.exitCode = 1;
