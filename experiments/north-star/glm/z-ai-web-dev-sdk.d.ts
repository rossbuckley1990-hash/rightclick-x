// Type surface for the development-environment model SDK (z-ai-web-dev-sdk). It is not a
// product dependency and is absent from clean installs: agent.ts falls back to the global
// install path at runtime. This declaration keeps the development harness typecheckable.
declare module "z-ai-web-dev-sdk" {
  export interface ChatCompletion {
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    model?: string;
  }
  const ZAI: {
    create(): Promise<{
      chat: { completions: { create: (body: Record<string, unknown>) => Promise<ChatCompletion> } };
    }>;
  };
  export default ZAI;
}
