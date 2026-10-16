/**
 * fetch with a deadline, for the Supabase clients, which take no timeout of their own:
 * a hung database would otherwise hold a page on its skeleton, or every request in the
 * proxy, until the function's limit. A caller's own signal still applies.
 */
export function fetchWithDeadline(ms: number): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(ms);
    return fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline,
    });
  };
}
