import { randomBytes } from "node:crypto"
import { loadPlatformDatabase } from "./platform-database.mjs"

export async function loadMemberPlatformDatabase(db, rebrand = true) {
  await loadPlatformDatabase(db, async () => {}, rebrand)
  const namespace = rebrand ? "joy8" : "looty"
  const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
  const game = (await one("select id from public.games where slug='test-game'")).id
  const shared = (await one("insert into public.games(name,slug,type,published,launch_url) values('Shared','shared-game','casual',true,'https://game.example/') returning id")).id
  const independent = (await one("insert into public.games(name,slug,type,published,launch_url) values('Independent','independent-game','casual',true,'https://game.example/') returning id")).id
  await db.exec("insert into public.games(name,slug,type,published,launch_url) values('Unconfigured','unconfigured-game','casual',true,'https://game.example/')")
  const platformPolicy = (await one(rebrand
    ? `update public.${namespace}_wallet_policies set enabled=true,initial_credit=0,guest_initial_credit=0 returning id`
    : `insert into public.${namespace}_wallet_policies(game_id,enabled,initial_credit) values(null,true,0) returning id`)).id
  const keys = new Map()
  for (const id of [game, shared, independent]) {
    await db.query(`insert into public.${namespace}_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount) values($1,$2,true,1000)`, [id, platformPolicy])
    const key = randomBytes(32).toString("hex")
    await db.query(`insert into public.${namespace}_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.${namespace}_hash_secret($2),array['exchange','open'],now()+interval '1 day')`, [id, key])
    keys.set(id, key)
  }
  return { game, shared, independent, platformPolicy, keys }
}

export async function reserveMemberWallet(db, session, key, namespace = "joy8") {
  await db.query(`select public.${namespace}_server_session_v1($1,'exchange',$2::jsonb)`, [key, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  await db.query(`select public.${namespace}_open_match_v1($1,$2::jsonb)`, [key, JSON.stringify({
    version: 1, match_ref: session.session_id, rule_version: "member-test-v1",
    participants: [{ session_id: session.session_id, reserve: "100.00" }],
  })])
}
