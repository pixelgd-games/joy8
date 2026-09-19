import { buildPlatformBundle } from "./fixtures/platform-bundle.mjs"

process.stdout.write(JSON.stringify(await buildPlatformBundle(), null, 2) + "\n")
