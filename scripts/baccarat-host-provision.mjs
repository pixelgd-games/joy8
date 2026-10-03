import assert from "node:assert/strict"
import { randomBytes, pbkdf2Sync, createHmac, createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readFile, copyFile, access } from "node:fs/promises"
import path from "node:path"
import pg from "pg"
import { createBackendCredential, buildRegisterSql } from "./backend-key-provision.mjs"

const ref = "lsazydefvnuqglultqii"
const gameId = "6dc12d01-5760-4123-832f-6d0bd305404a"
assert.equal(process.env.SUPABASE_PROJECT_ID, ref, "Use scripts/supabase-joy8.cmd baccarat-host-provision")
assert.equal(process.platform, "win32")
assert.ok(process.env.SUPABASE_DB_PASSWORD)
assert.ok(process.argv.includes("--apply"), "Explicit --apply required")
const directory = "D:\\Studio\\Project-Gaming\\production\\table\\products\\baccarat\\server\\data\\host"
const encryptedFile = path.join(directory, "runtime.dpapi")
const shellEnvironment = { ...process.env, PSModulePath: path.join(process.env.WINDIR, "System32", "WindowsPowerShell", "v1.0", "Modules") }
assert.equal(await access(encryptedFile).then(() => true, () => false), false, "Existing credentials must be rotated explicitly")
const powershell = script => spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
  windowsHide: true, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...shellEnvironment, BACCARAT_HOST_DIRECTORY: directory }
})
const secured = powershell(`$ErrorActionPreference='Stop'; $d=$env:BACCARAT_HOST_DIRECTORY;
[IO.Directory]::CreateDirectory($d) | Out-Null;
$acl=New-Object Security.AccessControl.DirectorySecurity;
$acl.SetAccessRuleProtection($true,$false);
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;
$acl.SetOwner($sid);
foreach($id in @($sid,(New-Object Security.Principal.SecurityIdentifier('S-1-5-18')))) {
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($id,'FullControl','ContainerInherit,ObjectInherit','None','Allow')));
}; Set-Acl -LiteralPath $d -AclObject $acl`)
assert.equal(secured.status, 0, "Cannot secure the local credential directory")
const endpoint = new URL((await readFile("supabase/.temp/pooler-url", "utf8")).trim())
assert.equal(endpoint.protocol, "postgresql:")
assert.ok(endpoint.hostname.endsWith(".pooler.supabase.com"))
assert.ok(decodeURIComponent(endpoint.username).endsWith(`.${ref}`))
assert.ok(endpoint.password === "", "Pooler endpoint must contain no password")
assert.ok(!endpoint.port || endpoint.port === "5432", "Session pool required")
const caPath = path.resolve("supabase/.temp/pgdelta/pgdelta-target-ca.crt")
const ca = await readFile(caPath, "utf8")
await copyFile(caPath, path.join(directory, "database-ca.crt"))
const client = new pg.Client({ host: endpoint.hostname, port: 5432, database: endpoint.pathname.slice(1),
  user: decodeURIComponent(endpoint.username), password: process.env.SUPABASE_DB_PASSWORD,
  ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 10000 })
let committed = false
try {
  await client.connect()
  await client.query("begin")
  assert.equal((await client.query("select exists(select 1 from pg_roles where rolname='baccarat_runtime') value")).rows[0].value, false, "Existing runtime login requires explicit rotation")
  assert.equal((await client.query("select count(*)::int n from public.joy8_backend_keys where game_id=$1 and revoked_at is null", [gameId])).rows[0].n, 0, "Existing game key requires explicit rotation")
  const password = randomBytes(32).toString("hex")
  const salt = randomBytes(16)
  const salted = pbkdf2Sync(password, salt, 4096, 32, "sha256")
  const clientKey = createHmac("sha256", salted).update("Client Key").digest()
  const verifier = `SCRAM-SHA-256$4096:${salt.toString("base64")}$${createHash("sha256").update(clientKey).digest("base64")}:${createHmac("sha256", salted).update("Server Key").digest("base64")}`
  const statement = (await client.query("select format('create role baccarat_runtime login inherit nosuperuser nobypassrls nocreatedb nocreaterole connection limit 3 password %L', $1::text) sql", [verifier])).rows[0].sql
  await client.query(statement)
  await client.query("grant baccarat_backend to baccarat_runtime")
  const credential = createBackendCredential()
  const profile = { game: { gameId, slug: "baccarat" }, platform: { protocol: "server-v1", currency: "POINT" },
    credential: { purpose: "private-integration", environmentVariable: "JOY8_BACKEND_KEY", delivery: "secure-one-time", scopes: ["exchange", "renew", "open", "settle", "status", "cancel"] } }
  await client.query(buildRegisterSql(profile, credential))
  await client.query("select public.joy8_validate_product_adapters()")
  endpoint.username = `baccarat_runtime.${ref}`
  endpoint.password = password
  const config = { BACCARAT_MODE: "joy8", PORT: "8792", BACCARAT_DATABASE_URL: endpoint.href,
    BACCARAT_DATABASE_CA_FILE: path.join(directory, "database-ca.crt"), BACCARAT_CLIENT_ORIGINS: "https://baccarat-87d.pages.dev",
    JOY8_GAME_ID: gameId, JOY8_GATEWAY_URL: `https://${ref}.supabase.co/functions/v1/joy8-gateway`, JOY8_BACKEND_KEY: credential.secret }
  const delivered = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference='Stop'; $inputText=[Console]::In.ReadToEnd(); $cipher=ConvertTo-SecureString -String $inputText -AsPlainText -Force | ConvertFrom-SecureString; [IO.File]::WriteAllText($env:BACCARAT_SECRET_FILE,$cipher)"],
  { windowsHide: true, input: JSON.stringify(config), encoding: "utf8", stdio: ["pipe", "ignore", "ignore"], env: { ...shellEnvironment, BACCARAT_SECRET_FILE: encryptedFile } })
  assert.equal(delivered.status, 0, "Encrypted delivery failed; database transaction will roll back")
  await client.query("commit")
  committed = true
  console.log(JSON.stringify({ gameId, keyId: credential.id, runtimeRole: "baccarat_runtime", encryptedFile, delivered: true }))
} catch (error) {
  await client.query("rollback").catch(() => undefined)
  console.error(`Baccarat host provisioning stopped (${error.code || "validation/delivery failure"}); no credential value was logged. Inspect registration before any retry.`)
  process.exitCode = 1
} finally {
  await client.end()
  if (!committed) console.error("Host activation not completed; keep the game unpublished.")
}
