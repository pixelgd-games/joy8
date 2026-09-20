import { writeFile } from "node:fs/promises"
import { buildPlatformBundle } from "./fixtures/platform-bundle.mjs"

const output = JSON.stringify(await buildPlatformBundle(), null, 2) + "\n"
if (process.argv[2]) await writeFile(process.argv[2], output)
else process.stdout.write(output)
