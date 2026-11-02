import { ClientFacingError } from "../interface/client-error.ts";

/** The backing state changed or another writer owns its publication lock. */
export class StateConflictError extends ClientFacingError {
  constructor(message: string) {
    super("state_conflict", `state conflict: ${message}`);
    this.name = "StateConflictError";
  }
}

/** A state commit was attempted, but its durable outcome cannot be established. */
export class StateCommitUnknownError extends ClientFacingError {
  constructor(message: string) {
    super("state_commit_unknown", `state commit outcome unknown: ${message}`);
    this.name = "StateCommitUnknownError";
  }
}
