import { spawn } from "node:child_process";
import path from "node:path";

const browsersPath = path.join(process.cwd(), ".playwright-browsers");
const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["playwright", "install", "chromium"],
  {
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    },
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
