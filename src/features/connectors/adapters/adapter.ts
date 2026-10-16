/**
 * Adapters (design-v2 section 4.7): one file per external effect, each a function of
 * the approved arguments, a token and `fetch`. Nothing here reads the database or runs
 * Claude. An AdapterError says whether the job may try again (`retryable`: the request
 * never reached the service) and whether the outcome is unknown (`ambiguous`: it may
 * have), which decides the message the owner sees.
 */
export class AdapterError extends Error {
  readonly retryable: boolean;
  readonly ambiguous: boolean;

  constructor(message: string, options: { retryable?: boolean; ambiguous?: boolean } = {}) {
    super(message);
    this.name = "AdapterError";
    this.retryable = options.retryable ?? false;
    this.ambiguous = options.ambiguous ?? false;
  }
}

export const AMBIGUOUS_SUFFIX = " Check the connected app before approving again.";
