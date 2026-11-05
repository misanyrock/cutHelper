import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
execFileSync(
  process.execPath,
  [require.resolve("typescript/bin/tsc"), "-p", "tsconfig.electron.json"],
  { stdio: "inherit" },
);
const vite = spawn(
  process.execPath,
  [
    path.join(
      path.dirname(require.resolve("vite/package.json")),
      "bin/vite.js",
    ),
  ],
  { stdio: "inherit" },
);
let desktop,
  stopping = false,
  launching = false;
const env = { ...process.env, CUTHELPER_DEV_URL: "http://127.0.0.1:5173" };
delete env.ELECTRON_RUN_AS_NODE;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  desktop?.kill();
  vite.kill();
  process.exit(code);
}
const timer = setInterval(async () => {
  if (launching) return;
  try {
    const response = await fetch(env.CUTHELPER_DEV_URL, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return;
    launching = true;
    clearInterval(timer);
    desktop = spawn(require("electron"), ["."], { stdio: "inherit", env });
    desktop.on("error", (error) => {
      console.error(error);
      stop(1);
    });
    desktop.on("exit", (code) => stop(code ?? 0));
  } catch {}
}, 300);
vite.on("error", (error) => {
  console.error(error);
  stop(1);
});
vite.on("exit", (code) => {
  if (!stopping) stop(code ?? 1);
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
