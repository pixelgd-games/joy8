import { randomBytes } from "node:crypto"
import { loadPlatformDatabase } from "./platform-database.mjs"

export async function loadMemberPlatformDatabase(db) {
  await loadPlatformDatabase(db)
  const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
  const game = (await one("select id from public.games where slug='test-game'")).id
  const shared = (await one("insert into public.games(name,slug,type,published,launch_url) values('Shared','shared-game','casual',true,'https://game.example/') returning id")).id
  const independent = (await one("insert into public.games(name,slug,type,published,launch_url) values('Independent','independent-game','casual',true,'https://game.example/') returning id")).id
  await db.exec("insert into public.games(name,slug,type,published,launch_url) values('Unconfigured','unconfigured-game','casual',true,'https://game.example/')")
  const platformPolicy = (await one("insert into public.looty_wallet_policies(enabled) values(true) returning id")).id
  const gamePolicy = (await one("insert into public.looty_wallet_policies(game_id,enabled) values($1,true) returning id", [independent])).id
  const keys = new Map()
  for (const [id, policy] of [[game, platformPolicy], [shared, platformPolicy], [independent, gamePolicy]]) {
    await db.query("insert into public.looty_game_policies(game_id,wallet_policy_id,enabled,max_entry_amount) values($1,$2,true,1000)", [id, policy])
    const key = randomBytes(32).toString("hex")
    await db.query("insert into public.looty_backend_keys(game_id,key_hash,scopes,expires_at) values($1,public.looty_hash_secret($2),array['exchange','open'],now()+interval '1 day')", [id, key])
    keys.set(id, key)
  }
  return { game, shared, independent, platformPolicy, gamePolicy, keys }
}

export async function reserveMemberWallet(db, session, key) {
  await db.query("select public.looty_server_session_v1($1,'exchange',$2::jsonb)", [key, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  await db.query("select public.looty_open_match_v1($1,$2::jsonb)", [key, JSON.stringify({
    version: 1, match_ref: session.session_id, rule_version: "member-test-v1",
    participants: [{ session_id: session.session_id, reserve: "100.00" }],
  })])
}
