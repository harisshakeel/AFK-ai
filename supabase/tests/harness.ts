import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";

/**
 * Runs our real migrations in PGlite (Postgres compiled to WebAssembly) so the schema,
 * the RLS policies and the job RPCs are tested without Docker or a cloud project.
 *
 * Supabase provides the auth and storage schemas and the anon / authenticated /
 * service_role roles; the stubs below reproduce just the parts our migrations use:
 * auth.users, auth.uid() and auth.jwt() reading request.jwt.claims (as PostgREST sets
 * it), and storage.buckets.
 */
const SUPABASE_STUBS = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create table auth.users (
    id uuid primary key, email text,
    is_anonymous boolean not null default false,
    created_at timestamptz not null default now()
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif((select auth.jwt()) ->> 'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
  );

  grant usage on schema public to anon, authenticated, service_role;

  -- Supabase grants every new table in public to these roles by default, so a migration
  -- must revoke before it grants. Reproduced here so a table that skips the revoke shows.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

let migratedSnapshot: File | Blob | undefined;

/** A fresh database with every migration applied. The first call migrates; later calls in
 * the same test file start from a snapshot of that result, which is much faster. */
export async function createTestDatabase(): Promise<PGlite> {
  if (migratedSnapshot) return PGlite.create({ loadDataDir: migratedSnapshot });
  const db = await migrate();
  migratedSnapshot = await db.dumpDataDir("none");
  return db;
}

async function migrate(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUBS);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`migration ${file} failed: ${String(error)}`);
    }
  }
  return db;
}

export type Caller =
  | { role: "anon" }
  | { role: "authenticated"; userId: string; isAnonymous?: boolean }
  | { role: "service_role" };

/** Run one statement as a Supabase caller, inside a transaction that is rolled back on error. */
export async function as<T>(
  db: PGlite,
  caller: Caller,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return db.transaction(async (tx) => {
    const claims =
      caller.role === "authenticated"
        ? { sub: caller.userId, role: caller.role, is_anonymous: caller.isAnonymous ?? true }
        : { role: caller.role };
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await tx.exec(`set local role ${caller.role}`);
    const result = await tx.query<T>(sql, params);
    return result.rows;
  });
}

/** A user row; a guest is an anonymous identity, optionally made some days ago. */
export async function createUser(
  db: PGlite,
  id: string,
  { anonymous = false, ageDays = 0 }: { anonymous?: boolean; ageDays?: number } = {},
): Promise<string> {
  await db.query(
    "insert into auth.users (id, is_anonymous, created_at) values ($1, $2, now() - make_interval(days => $3))",
    [id, anonymous, ageDays],
  );
  return id;
}
