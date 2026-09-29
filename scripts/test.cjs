const { spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const client = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "--test", "tests/models.test.mjs"],
  { stdio: "inherit" },
);
if (client.status) process.exit(client.status);
const local = join(
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const server = spawnSync(
  existsSync(local) ? local : "python",
  ["-m", "unittest", "discover", "-s", "server/tests", "-v"],
  { stdio: "inherit" },
);
process.exit(server.status || 0);
