import { randomBytes } from "node:crypto"
import { loadCurrentPlatform } from "./platform-bundle.mjs"

export async function loadMemberPlatformDatabase(db) {
  await loadCurrentPlatform(db)
  const one = async (sql, values = []) => (await db.query(sql, values)).rows[0]
  const game = (await one("select id from public.games where slug='test-game'")).id
  const shared = (await one("insert into public.games(name,slug,type,published,launch_url) values('Shared','shared-game','casual',true,'https://game.example/') returning id")).id
  const independent = (await one("insert into public.games(name,slug,type,published,launch_url) values('Independent','independent-game','casual',true,'https://game.example/') returning id")).id
  await db.exec("insert into public.games(name,slug,type,published,launch_url) values('Unconfigured','unconfigured-game','casual',true,'https://game.example/')")
  const platformPolicy = (await one("update public.joy8_wallet_policies set enabled=true,initial_credit=0,guest_initial_credit=0 returning id")).id
  const keys = new Map()
  for (const id of [game, shared, independent]) {
    await db.query("insert into public.joy8_game_policies(game_id,wallet_policy_id,enabled,max_bet_amount,max_payout_amount) values($1,$2,true,1000,1000)", [id, platformPolicy])
    const key = randomBytes(32).toString("hex")
    await db.query("insert into public.joy8_backend_keys(game_id,key_hash,scopes) values($1,public.joy8_hash_secret($2),array['exchange','open'])", [id, key])
    keys.set(id, key)
  }
  return { game, shared, independent, platformPolicy, keys }
}

export async function reserveMemberWallet(db, session, key) {
  await db.query("select public.joy8_server_session_v1($1,'exchange',$2::jsonb)", [key, JSON.stringify({ version: 1, launch_code: session.launch_code })])
  await db.query("select public.joy8_open_match_v1($1,$2::jsonb)", [key, JSON.stringify({
    version: 1, match_ref: session.session_id, rule_version: "member-test-v1",
    participants: [{ session_id: session.session_id, reserve: "100.00" }],
  })])
}
