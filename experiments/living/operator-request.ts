import type { Wire } from "./challenge-session.ts";

/** Explicit operator-approved wire profile for the disposable experiment.
 * Kept outside the runtime; any change to its serialization requires a new
 * operator decision. Do not derive approval from an agent's attempted request.
 */
export function approvedCompression(origin: string, args: object): Wire {
  return { method: "POST", url: origin + "/jobs",
    headers: {
      accept: "application/json, text/html;q=0.9, */*;q=0.5",
      "content-type": "application/json",
      "user-agent": "rightclick-x/0.1 (+https://github.com/rossbuckley1990-hash/rightclick)",
    },
    body: Buffer.from(JSON.stringify(args)).toString("base64") };
}
