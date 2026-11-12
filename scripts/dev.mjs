import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// Set polling before Next imports Watchpack, including its route-file watcher.
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", "--webpack", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: { ...process.env, WATCHPACK_POLLING: process.env.WATCHPACK_POLLING || "1000" },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
