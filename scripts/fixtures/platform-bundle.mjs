import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"

const root = new URL("../../", import.meta.url)
const normalized = source => source.replace(/\r\n/g, "\n")
export const sourceHash = source => createHash("sha256").update(normalized(source)).digest("hex")
export const platformSourcePaths = contract => [contract.bootstrap,
  ...contract.runtime.map(name => `supabase/migrations/${name}`), ...contract.drafts]

export async function buildPlatformBundle() {
  const contract = JSON.parse(await readFile(new URL("platform-sources.json", import.meta.url), "utf8"))
  const migrations = (await readdir(new URL("supabase/migrations/", root))).filter(name => name.endsWith(".sql")).sort()
  const classified = [...contract.runtime, ...Object.keys(contract.excluded)]
  assert.equal(new Set(classified).size, classified.length, "A migration must have exactly one classification")
  assert.deepEqual(classified.toSorted(), migrations, "Classify every migration as runtime or explicitly excluded")
  assert.deepEqual(contract.runtime, contract.runtime.toSorted(), "Runtime migrations must stay in deployment order")
  for (const reason of Object.values(contract.excluded)) assert.ok(reason.trim(), "Excluded migrations require a reason")
  const sources = await Promise.all(platformSourcePaths(contract).map(async path => {
    const sql = normalized(await readFile(new URL(path, root), "utf8"))
    return { path, sha256: sourceHash(sql), sql }
  }))
  const bundle = { contract, sources }
  validatePlatformBundle(bundle)
  return bundle
}

export function validatePlatformBundle(bundle) {
  assert.equal(bundle.contract.version, 1, "Unsupported platform fixture contract")
  const paths = platformSourcePaths(bundle.contract)
  assert.equal(new Set(paths).size, paths.length, "Duplicate platform SQL source")
  assert.deepEqual(bundle.sources.map(source => source.path), paths, "Missing, extra or reordered platform SQL source")
  for (const source of bundle.sources) assert.equal(sourceHash(source.sql), source.sha256, `Changed platform SQL: ${source.path}`)
}

export async function loadCurrentPlatform(db) {
  for (const source of (await buildPlatformBundle()).sources) await db.exec(source.sql)
  await db.exec("update public.games set published=true where slug in ('test-game','missing-url')")
}
