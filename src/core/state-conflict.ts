/** The backing state changed or another writer owns its publication lock. */
export class StateConflictError extends Error {
  constructor(message: string) {
    super(`state conflict: ${message}`);
    this.name = "StateConflictError";
  }
}
