import type { ProtectedValueRef } from "./portable-capability.ts";

/**
 * Trusted operator-provided authority and value boundary. An adapter must authenticate
 * its configured principal, check the current grant against the entire request, and
 * hold that authorization through consume(); a reference is not itself a grant.
 * Adapters must never cache an authorization across invocations. This interface does
 * not by itself implement a vault, authentication, cancellation or revocation.
 */
export interface ProtectedValueHost {
  readonly principal: string;
  /** The host explicitly allows the result's one boolean bit to leave the boundary. */
  readonly allowBooleanOutput: boolean;
  withAuthorizedValue<T>(request: Readonly<{
    principal: string;
    capability: string;
    contract: string;
    origin: string;
    header: string;
    ref: ProtectedValueRef;
  }>, consume: (value: string) => Promise<T>): Promise<T>;
}
