import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { createLocalPostgres } from "./fixtures/local-postgres.mjs"
import { buildPlatformBundle } from "./fixtures/platform-bundle.mjs"

const db = await createLocalPostgres()
try {
  for (const source of (await buildPlatformBundle()).sources) await db.exec(source.sql)
  let sql = await db.dump(["--schema-only", "--schema=public"])
  sql = sql.replace(/^\\(?:un)?restrict.*\r?\n/gm, "")
    .replace(/^--.*\r?\n/gm, "")
    .replace(/^CREATE SCHEMA public;\r?\n/gm, "")
    .replace(/ALTER DEFAULT PRIVILEGES FOR ROLE joy8_test/g, "ALTER DEFAULT PRIVILEGES")
    .replace(/\n{3,}/g, "\n\n")
  const events = (await db.query("select evtname,evtevent,evtfoid::regproc::text function,evttags from pg_event_trigger order by evtname")).rows
  for (const event of events) {
    assert.match(event.evtname, /^joy8_[a-z_]+$/)
    assert.match(event.function, /^(public\.)?joy8_[a-z_]+$/)
    if (!sql.includes(`CREATE EVENT TRIGGER ${event.evtname}`)) {
      const tags = event.evttags?.length ? ` WHEN TAG IN (${event.evttags.map(tag => `'${tag.replaceAll("'", "''")}'`).join(",")})` : ""
      sql += `\nCREATE EVENT TRIGGER ${event.evtname} ON ${event.evtevent}${tags} EXECUTE FUNCTION public.${event.function.replace(/^public\./, "")}();\n`
    }
  }
  const policy = (await db.query("select to_jsonb(p)-'id' policy from public.joy8_wallet_policies p")).rows
  assert.equal(policy.length, 1)
  const fields = Object.entries(policy[0].policy).filter(([key]) => !["created_at", "updated_at"].includes(key))
  const literal = value => value === null ? "NULL" : typeof value === "string" ? `'${value.replaceAll("'", "''")}'` : String(value)
  sql += `\nINSERT INTO public.joy8_wallet_policies(${fields.map(([key]) => key).join(",")}) VALUES(${fields.map(([, value]) => literal(value)).join(",")});\n`
  const preamble = `BEGIN;
DO $$ BEGIN
  IF to_regclass('public.games') IS NOT NULL THEN RAISE EXCEPTION 'JOY8_BOOTSTRAP_REQUIRES_EMPTY_PROJECT'; END IF;
  IF to_regclass('auth.users') IS NULL OR to_regclass('auth.identities') IS NULL THEN RAISE EXCEPTION 'JOY8_SUPABASE_AUTH_REQUIRED'; END IF;
END; $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role,supabase_auth_admin;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC,anon,authenticated,service_role;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
`
  await mkdir("supabase/bootstrap", { recursive: true })
  await writeFile("supabase/bootstrap/platform.sql", preamble + sql.trim() + "\nCOMMIT;\n")
  console.log("Exported current platform schema and POINT policy without identities, keys, catalog or financial data.")
} finally { await db.close() }
