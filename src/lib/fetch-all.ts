/**
 * Every row of a PostgREST query, a page at a time: the API returns at most 1,000 rows
 * per request, and the long meeting has 1,067 turns. `onError` wraps a failed page in the
 * caller's error class (the job runner's TransientError, the app's plain Error).
 */
const PAGE = 1000;

export async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  onError: (message: string) => Error = (message) => new Error(message),
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw onError(`database read failed: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}
