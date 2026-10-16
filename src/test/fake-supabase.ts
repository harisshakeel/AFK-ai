/**
 * A stand-in for the Supabase clients in route handler tests: the query builder's
 * filters the routes use (eq, is, in, order, limit; a JSON field as "args->>key"),
 * awaited or read with maybeSingle() or single(), the session's claims, and RPCs
 * answered by name and recorded. Rows are filtered, never projected: a route that reads a
 * column it did not select still sees it, so assert on what the route does, not on the
 * shape of its reads. Writes are recorded and never change the rows.
 */
type Row = Record<string, unknown>;
type DbError = { code: string; message: string };
type Result = { data: unknown; error: DbError | null };

export type FakeClient = {
  auth: { getClaims: () => Promise<{ data: { claims: Row } | null; error: null }> };
  from: (table: string) => unknown;
  rpc: (fn: string, args?: Row) => Promise<Result>;
  storage: { from: (bucket: string) => unknown };
  /** Every rpc call, update and delete, in order: `{ fn: "delete meetings" }` for a delete. */
  calls: Array<{ fn: string; args?: Row }>;
};

/** A column, or a JSON column's field as text ("args->>sharedNotes"), as PostgREST reads it. */
function valueOf(row: Row, field: string): unknown {
  const [column = field, key] = field.split("->>");
  if (key === undefined) return row[field];
  const json = row[column];
  const value = json && typeof json === "object" ? (json as Row)[key] : undefined;
  return value === undefined || value === null ? null : String(value);
}

function query(
  table: string,
  rows: Row[],
  error: DbError | null,
  calls: FakeClient["calls"],
  failures: Record<string, DbError>,
): unknown {
  const next = (kept: Row[], failure: DbError | null = error) =>
    query(table, kept, failure, calls, failures);
  // A write is recorded, then answers with the failure set for it ("update meetings"); an
  // insert answers with the row it was given, under the id "inserted" when it had none.
  const write = (fn: string, args?: Row, inserted?: Row) => {
    calls.push({ fn, args });
    return next(inserted ? [inserted] : rows, failures[fn] ?? error);
  };
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    delete: () => write(`delete ${table}`),
    update: (values: Row) => write(`update ${table}`, values),
    insert: (values: Row) => write(`insert ${table}`, values, { id: "inserted", ...values }),
    eq: (field: string, value: unknown) =>
      next(rows.filter((row) => valueOf(row, field) === value)),
    is: (field: string, value: unknown) =>
      next(rows.filter((row) => valueOf(row, field) === value)),
    in: (field: string, values: unknown[]) =>
      next(rows.filter((row) => values.includes(row[field]))),
    maybeSingle: async (): Promise<Result> => ({ data: error ? null : (rows[0] ?? null), error }),
    // Exactly one row, else PostgREST's PGRST116.
    single: async (): Promise<Result> =>
      error || rows.length !== 1
        ? {
            data: null,
            error: error ?? { code: "PGRST116", message: `${rows.length} rows, expected one` },
          }
        : { data: rows[0], error: null },
    then: (resolve: (result: Result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve<Result>({ data: error ? null : rows, error }).then(resolve, reject),
  };
  return builder;
}

/** A Google user's claims, a guest's, or no session at all. */
export function claimsFor(userId: string | null, kind: "google" | "guest" = "google") {
  if (!userId) return null;
  return {
    sub: userId,
    is_anonymous: kind === "guest",
    app_metadata: { providers: kind === "google" ? ["google"] : ["anonymous"] },
  };
}

export function fakeClient({
  claims = null,
  tables = {},
  errors = {},
  failures = {},
  rpc = {},
}: {
  claims?: Row | null;
  tables?: Record<string, Row[]>;
  errors?: Record<string, DbError>;
  /** A write that fails, by its recorded name: `{ "update meetings": {...} }`. */
  failures?: Record<string, DbError>;
  rpc?: Record<string, Result>;
} = {}): FakeClient {
  const calls: FakeClient["calls"] = [];
  return {
    auth: { getClaims: async () => ({ data: claims ? { claims } : null, error: null }) },
    from: (table) => query(table, tables[table] ?? [], errors[table] ?? null, calls, failures),
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "note_visitor_write" && !(fn in rpc)) return { data: true, error: null };
      return rpc[fn] ?? { data: null, error: { code: "42883", message: `no ${fn}` } };
    },
    // An empty bucket: nothing to list, nothing to remove.
    storage: {
      from: () => ({
        list: async () => ({ data: [], error: null }),
        remove: async () => ({ data: [], error: null }),
      }),
    },
    calls,
  };
}
