import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import pg from "pg"

const run = promisify(execFile)

async function freePort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const port = server.address().port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

export async function createLocalPostgres() {
  const bin = process.env.JOY8_TEST_PG_BIN
  assert.ok(bin && path.isAbsolute(bin), "Set JOY8_TEST_PG_BIN to an absolute PostgreSQL 17 bin directory")
  const executable = (name) => path.join(bin, process.platform === "win32" ? `${name}.exe` : name)
  const command = (name, args) => run(executable(name), args, { windowsHide: true, timeout: 30000, maxBuffer: 2 ** 20 })
  assert.match((await command("postgres", ["--version"])).stdout, /PostgreSQL\) 17\./)
  const tempRoot = await realpath(tmpdir())
  const directory = await mkdtemp(path.join(tempRoot, "joy8-member-pg17-"))
  const data = path.join(directory, "data")
  const passwordFile = path.join(directory, "password")
  const password = randomBytes(32).toString("hex")
  const port = await freePort()
  const connections = new Set()
  let startAttempted = false
  let closed = false

  async function close() {
    if (closed) return
    closed = true
    await Promise.allSettled([...connections].map((client) => client.end()))
    if (startAttempted) await command("pg_ctl", ["-D", data, "-m", "fast", "-w", "-t", "20", "stop"])
    const resolved = await realpath(directory)
    assert.equal(path.dirname(resolved), tempRoot)
    assert.equal(resolved, directory)
    assert.ok(path.basename(resolved).startsWith("joy8-member-pg17-"))
    await rm(resolved, { recursive: true, force: true })
  }

  async function connect() {
    const client = new pg.Client({
      host: "127.0.0.1", port, database: "postgres", user: "joy8_test", password,
      ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 10000,
      application_name: "joy8-member-sql-test",
    })
    connections.add(client)
    await client.connect()
    client.once("end", () => connections.delete(client))
    return client
  }

  try {
    await writeFile(passwordFile, password, { mode: 0o600 })
    await command("initdb", ["-D", data, "-U", "joy8_test", "-A", "scram-sha-256", "--pwfile", passwordFile, "--encoding=UTF8", "--locale=C"])
    await rm(passwordFile)
    startAttempted = true
    await command("pg_ctl", ["-D", data, "-l", path.join(directory, "server.log"), "-o", `-h 127.0.0.1 -p ${port}`, "-w", "-t", "20", "start"])
    const client = await connect()
    const version = (await client.query("show server_version_num")).rows[0].server_version_num
    assert.ok(Number(version) >= 170000 && Number(version) < 180000)
    return { exec: (sql) => client.query(sql), query: (sql, values) => client.query(sql, values), connect, close }
  } catch (error) {
    try { await close() } catch (cleanupError) { throw new AggregateError([error, cleanupError], `Local PostgreSQL startup or cleanup failed; inspect ${directory}`) }
    throw error
  }
}
