// Provider limit messages are infrastructure interruptions, never task decisions.
// Keep this separate from result scoring so corrections can preserve the original record.
export function quotaBlock(reply: string): string | undefined {
  if (/^\s*(?:you(?:'ve| have) hit your (?:weekly |daily |monthly |session |usage )?limit|usage limit|rate limit|overloaded)/i.test(reply)) return reply.slice(0, 300);
  return undefined;
}
