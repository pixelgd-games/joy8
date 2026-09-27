import { randomUUID } from "node:crypto"

export async function googleIdentity(db) {
  const id = randomUUID()
  const email = `${id}@example.test`
  await db.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())", [id, email])
  await db.query("insert into auth.identities(user_id,provider) values($1,'google')", [id])
  await db.query("insert into public.joy8_email_allowlist(email) values($1)", [email])
  return id
}
