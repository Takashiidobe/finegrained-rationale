const { spawn } = require("node:child_process");

const command = process.platform === "win32" ? "code.cmd" : "code";
const child = spawn(command, ["--new-window", `--extensionDevelopmentPath=${__dirname}`], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`Could not start VS Code using '${command}': ${error.message}`);
  process.exitCode = 1;
});
