import { randomBytes, randomUUID, createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { GAME_SLUG_PATTERN } from "../packages/joy8-game-sdk/policy.js"

const root = fileURLToPath(new URL("../", import.meta.url))
const projectRef = "lsazydefvnuqglultqii"
const allowedScopes = ["exchange", "renew", "open", "settle", "status", "cancel"]
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() !== value || !value) throw new Error(`Invalid ${name}`)
  return value
}

export function validateProfile(profile) {
  if (!profile || typeof profile !== "object") throw new Error("Invalid integration profile")
  const gameId = requiredString(profile.game?.gameId, "game.gameId")
  const slug = requiredString(profile.game?.slug, "game.slug")
  if (!uuidPattern.test(gameId)) throw new Error("Invalid game.gameId")
  if (!GAME_SLUG_PATTERN.test(slug)) throw new Error("Invalid game.slug")
  if (profile.platform?.protocol !== "server-v1") throw new Error("Only server-v1 is supported")
  if (profile.platform?.currency !== "POINT") throw new Error("Only POINT is supported")
  if (!["private-integration", "production"].includes(profile.credential?.purpose)) throw new Error("credential.purpose must be private-integration or production")
  if (profile.credential?.environmentVariable !== "JOY8_BACKEND_KEY") throw new Error("credential.environmentVariable must be JOY8_BACKEND_KEY")
  if (profile.credential?.delivery !== "secure-one-time") throw new Error("credential.delivery must be secure-one-time")
  const scopes = profile.credential?.scopes
  if (!Array.isArray(scopes) || scopes.length === 0 || new Set(scopes).size !== scopes.length || scopes.some(scope => !allowedScopes.includes(scope))) {
    throw new Error("Invalid credential.scopes")
  }
  if (Object.hasOwn(profile.credential, "expiresAt")) throw new Error("Backend Keys do not expire; remove credential.expiresAt")
  return { gameId, slug, scopes: [...scopes] }
}

export function validateDelivery(delivery) {
  if (!delivery || delivery.type !== "cloudflare-worker") throw new Error("Only cloudflare-worker delivery is supported")
  const cwd = requiredString(delivery.cwd, "delivery.cwd")
  const secretName = requiredString(delivery.secretName, "delivery.secretName")
  const workerName = requiredString(delivery.workerName, "delivery.workerName")
  if (!path.isAbsolute(cwd)) throw new Error("delivery.cwd must be an absolute path")
  if (secretName !== "JOY8_BACKEND_KEY") throw new Error("delivery.secretName must be JOY8_BACKEND_KEY")
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(workerName)) throw new Error("Invalid delivery.workerName")
  const deployMode = delivery.deployMode ?? "immediate"
  if (deployMode !== "immediate") throw new Error("delivery.deployMode must be immediate")
  const environment = delivery.environment == null ? null : requiredString(delivery.environment, "delivery.environment")
  const config = delivery.config == null ? null : requiredString(delivery.config, "delivery.config")
  if (environment && !/^[A-Za-z0-9_-]+$/.test(environment)) throw new Error("Invalid delivery.environment")
  return { type: delivery.type, cwd: path.resolve(cwd), secretName, workerName, deployMode, environment, config }
}

export function createBackendCredential(bytes = randomBytes(32), id = randomUUID()) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 32) throw new Error("Backend Key entropy must be exactly 32 bytes")
  if (!uuidPattern.test(id)) throw new Error("Invalid Backend Key ID")
  const secret = bytes.toString("hex")
  return { id, secret, hash: createHash("sha256").update(secret).digest("hex") }
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function buildRegisterSql(profile, credential, oldKeyId = null) {
  const { gameId, slug, scopes } = validateProfile(profile)
  if (!credential || !uuidPattern.test(credential.id) || !/^[a-f0-9]{64}$/.test(credential.hash)) throw new Error("Invalid hashed credential")
  const scopeSql = scopes.map(quote).join(",")
  const production = profile.credential.purpose === "production"
  if (oldKeyId !== null && !uuidPattern.test(oldKeyId)) throw new Error("Invalid old Backend Key ID")
  if (production && !oldKeyId) throw new Error("Production credentials require rotation of an existing game key")
  return `do $joy8$
declare v_game_id uuid;
begin
  select g.id into v_game_id from public.games g
  where g.id=${quote(gameId)}::uuid and g.slug=${quote(slug)} and ${production ? "g.published" : "not g.published"}
  for update;
  if not found then raise exception 'JOY8_KEY_GAME_STATE_OR_ID_MISMATCH'; end if;
  ${oldKeyId ? `if not exists(select 1 from public.joy8_backend_keys where id=${quote(oldKeyId)}::uuid and game_id=v_game_id and scopes @> array[${scopeSql}]::text[]) then raise exception 'JOY8_KEY_ROTATION_SCOPE_OR_GAME_MISMATCH'; end if;
  update public.joy8_backend_keys set revoked_at=coalesce(revoked_at,now()) where id=${quote(oldKeyId)}::uuid and game_id=v_game_id;` : ""}
  perform 1 from public.joy8_game_policies gp
  join public.joy8_wallet_policies wp on wp.id=gp.wallet_policy_id
  where gp.game_id=v_game_id and gp.enabled and wp.enabled and wp.currency='POINT';
  if not found then raise exception 'JOY8_KEY_POLICY_NOT_READY'; end if;
  insert into public.joy8_backend_keys(id,game_id,key_hash,scopes)
  values (${quote(credential.id)}::uuid,v_game_id,${quote(credential.hash)},array[${scopeSql}]::text[]);
end
$joy8$;
select json_build_object('keyId',${quote(credential.id)},'gameId',${quote(gameId)},'slug',${quote(slug)},'replacedKeyId',${oldKeyId ? quote(oldKeyId) : "null"}) as joy8_backend_key_registered;
`
}

export function buildRevokeSql(profile, keyId) {
  const { gameId, slug } = validateProfile(profile)
  if (!uuidPattern.test(keyId)) throw new Error("Invalid Backend Key ID")
  return `do $joy8$
begin
  if not exists (select 1 from public.joy8_backend_keys k join public.games g on g.id=k.game_id
    where k.id=${quote(keyId)}::uuid and k.game_id=${quote(gameId)}::uuid and g.slug=${quote(slug)}) then
    raise exception 'JOY8_KEY_NOT_FOUND';
  end if;
  update public.joy8_backend_keys set revoked_at=coalesce(revoked_at,now())
  where id=${quote(keyId)}::uuid and game_id=${quote(gameId)}::uuid;
end
$joy8$;
select json_build_object('keyId',${quote(keyId)},'gameId',${quote(gameId)},'revoked',true) as joy8_backend_key_revoked;
`
}

export function buildStatusSql(profile) {
  const { gameId, slug } = validateProfile(profile)
  return `select coalesce(json_agg(json_build_object(
  'keyId',k.id,'scopes',k.scopes,'revokedAt',k.revoked_at,'createdAt',k.created_at
) order by k.created_at desc),'[]'::json) as joy8_backend_keys
from public.joy8_backend_keys k join public.games g on g.id=k.game_id
where k.game_id=${quote(gameId)}::uuid and g.slug=${quote(slug)};
`
}

export function cloudflareSecretArgs(delivery, wranglerBin) {
  const checked = validateDelivery(delivery)
  const args = [wranglerBin, "secret", "put", checked.secretName, "--name", checked.workerName]
  if (checked.environment) args.push("--env", checked.environment)
  if (checked.config) args.push("--config", checked.config)
  return args
}

export async function resolveWranglerBin(cwd) {
  const packageRoot = path.join(path.resolve(cwd), "node_modules", "wrangler")
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8").catch(() => {
    throw new Error("Target backend must install Wrangler locally before secret delivery")
  }))
  const relativeBin = typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.wrangler
  if (typeof relativeBin !== "string") throw new Error("Local Wrangler package has no executable")
  const bin = path.resolve(packageRoot, relativeBin)
  const relative = path.relative(packageRoot, bin)
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid local Wrangler executable")
  await readFile(bin).catch(() => { throw new Error("Local Wrangler executable is unavailable") })
  return bin
}

export async function deliverCloudflareSecret(delivery, secret) {
  const checked = validateDelivery(delivery)
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("Invalid Backend Key")
  const wranglerBin = await resolveWranglerBin(checked.cwd)
  const result = spawnSync(process.execPath, cloudflareSecretArgs(checked, wranglerBin), {
    cwd: checked.cwd,
    input: `${secret}\n`,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["pipe", "ignore", "ignore"]
  })
  if (result.error || result.status !== 0) throw new Error("Cloudflare rejected Backend Key delivery; no secret output was retained")
}

export async function provisionCredential({ profile, delivery, oldKeyId = null, registerKey, deliverKey, revokeKey, credentialFactory = createBackendCredential }) {
  validateProfile(profile)
  validateDelivery(delivery)
  if (oldKeyId !== null && !uuidPattern.test(oldKeyId)) throw new Error("Invalid old Backend Key ID")
  if (profile.credential.purpose === "production" && !oldKeyId) throw new Error("Production credentials require rotation of an existing game key")
  const credential = credentialFactory()
  await registerKey({ id: credential.id, hash: credential.hash })
  try {
    await deliverKey(credential.secret)
  } catch {
    try {
      await revokeKey(credential.id)
    } catch {
      throw new Error(`Backend Key delivery failed and compensation failed; revoke key ID ${credential.id}`)
    }
    throw new Error(`Backend Key delivery failed; new key ID ${credential.id} was revoked${oldKeyId ? ` and old key ${oldKeyId} stays revoked` : ""}`)
  }
  return { keyId: credential.id, gameId: profile.game.gameId, delivered: true, oldKeyRevoked: Boolean(oldKeyId) }
}

function runPowerShell(args) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "supabase-joy8.ps1"), ...args], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true
  })
  if (result.error || result.status !== 0) throw new Error("Joy8 Supabase command failed; inspect the local operator terminal")
  return result.stdout
}

function verifyProjectLink() {
  const output = runPowerShell(["projects", "list", "--output", "json"])
  const start = output.indexOf("[")
  const end = output.lastIndexOf("]")
  if (start < 0 || end < start) throw new Error("Could not verify the linked Joy8 Supabase project")
  const projects = JSON.parse(output.slice(start, end + 1))
  const project = projects.find(item => item.id === projectRef || item.ref === projectRef)
  if (!project || project.name !== "Joy8" || project.linked !== true) throw new Error("Joy8 / lsazydefvnuqglultqii is not the linked Supabase project")
}

async function withTemporarySql(sql, callback) {
  const tempRoot = path.resolve(os.tmpdir())
  const directory = await mkdtemp(path.join(tempRoot, "joy8-backend-key-"))
  const file = path.join(directory, "operation.sql")
  try {
    await writeFile(file, sql, { encoding: "utf8", mode: 0o600 })
    return await callback(file)
  } finally {
    const resolved = path.resolve(directory)
    if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith("joy8-backend-key-")) throw new Error("Refused unsafe temporary cleanup")
    await rm(resolved, { recursive: true, force: true })
  }
}

export async function runJoy8Sql(sql) {
  verifyProjectLink()
  const rawUrl = (await readFile(path.join(root, "supabase", ".temp", "pooler-url"), "utf8")).trim()
  const dbUrl = new URL(rawUrl)
  if (dbUrl.protocol !== "postgresql:" || !dbUrl.hostname.endsWith(".pooler.supabase.com") || !dbUrl.username.includes(projectRef) || dbUrl.password) {
    throw new Error("Joy8 pooler URL is missing or unsafe")
  }
  return withTemporarySql(sql, file => runPowerShell(["db", "query", "--db-url", dbUrl.toString(), "--file", file]))
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const values = { command, apply: false }
  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]
    if (item === "--apply") values.apply = true
    else if (item.startsWith("--")) {
      const value = rest[index + 1]
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${item}`)
      values[item.slice(2).replaceAll("-", "_")] = value
      index += 1
    } else throw new Error(`Unexpected argument ${item}`)
  }
  return values
}

export function credentialPlan({ operation, profile, delivery, keyId = null }) {
  if (!["provision", "rotate", "revoke"].includes(operation)) throw new Error("Choose --operation provision, rotate or revoke")
  const checked = validateProfile(profile)
  if (operation !== "provision" && !uuidPattern.test(keyId)) throw new Error("Rotation/revocation requires an exact key ID")
  if (operation === "provision" && (keyId || profile.credential.purpose === "production")) throw new Error("Production credentials require explicit rotation")
  return {
    operation, projectRef, gameId: checked.gameId, slug: checked.slug,
    purpose: profile.credential.purpose, scopes: checked.scopes,
    keyId, target: operation === "revoke" ? null : validateDelivery(delivery),
    databaseChange: operation === "revoke" ? "Revoke the named game key"
      : operation === "rotate" ? "Revoke the named key and insert the replacement hash in one transaction; revoke the replacement if delivery fails"
        : "Insert a game-scoped credential hash; revoke it if delivery fails",
    deliveryChange: operation === "revoke" ? null : "Deploy the named Worker secret immediately",
  }
}

export function verifyCredentialPlan(plan, reviewed) {
  if (JSON.stringify(plan) !== JSON.stringify(reviewed)) throw new Error("Reviewed plan does not match this operation; prepare and review a new plan")
}

async function readJson(file, name) {
  if (!file) throw new Error(`Missing --${name}`)
  return JSON.parse(await readFile(path.resolve(file), "utf8"))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!["plan", "provision", "rotate", "status", "revoke"].includes(args.command)) {
    throw new Error("Use plan, provision, rotate, status or revoke")
  }
  const profile = await readJson(args.profile, "profile")
  if (args.command === "status") {
    process.stdout.write(await runJoy8Sql(buildStatusSql(profile)))
    return
  }
  const operation = args.command === "plan" ? args.operation : args.command
  const delivery = operation === "revoke" ? null : await readJson(args.delivery, "delivery")
  const plan = credentialPlan({ operation, profile, delivery, keyId: args.old_key_id ?? args.key_id ?? null })
  if (args.command === "plan") {
    if (!args.output) throw new Error("Plan requires --output for the non-secret review file")
    await writeFile(path.resolve(args.output), `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx" })
    console.log(JSON.stringify(plan, null, 2))
    return
  }
  if (!args.apply) throw new Error("Remote changes require a user-reviewed plan and --apply")
  verifyCredentialPlan(plan, await readJson(args.reviewed_plan, "reviewed-plan"))
  if (operation === "revoke") {
    process.stdout.write(await runJoy8Sql(buildRevokeSql(profile, plan.keyId)))
    return
  }
  const result = await provisionCredential({
    profile,
    delivery,
    oldKeyId: plan.keyId,
    registerKey: credential => runJoy8Sql(buildRegisterSql(profile, credential, plan.keyId)),
    deliverKey: secret => deliverCloudflareSecret(delivery, secret),
    revokeKey: keyId => runJoy8Sql(buildRevokeSql(profile, keyId))
  })
  console.log(JSON.stringify(result, null, 2))
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(error => {
    console.error(`Backend Key operation stopped: ${error.message}`)
    process.exitCode = 1
  })
}
