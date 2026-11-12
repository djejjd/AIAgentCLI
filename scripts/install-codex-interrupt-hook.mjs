// 安装 Codex Interrupt hook：用户按 ESC 中断回合时，通知 cmux 结束 agent 状态。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const WRAPPER_NAME = "aia-projects-codex-interrupt.sh";
const HOOK_TIMEOUT_SECONDS = 5;

export const interruptHookCommand = (wrapperPath) => wrapperPath;

const isOwnHook = (group) =>
  (group?.hooks ?? []).some((hook) =>
    typeof hook?.command === "string" && hook.command.includes(WRAPPER_NAME));

// 保留用户已有的 Interrupt hook，只维护本安装器写入的那一组。
export function mergeInterruptHook(config, command) {
  const next = JSON.parse(JSON.stringify(config ?? {}));
  next.hooks ??= {};
  const groups = Array.isArray(next.hooks.Interrupt) ? next.hooks.Interrupt : [];
  const own = groups.filter(isOwnHook);
  const withoutOwn = groups.filter((group) => !isOwnHook(group));
  const current = own.length === 1 && own[0].hooks?.length === 1
    && own[0].hooks[0].command === command
    && own[0].hooks[0].timeout === HOOK_TIMEOUT_SECONDS;
  if (current) return { config: next, changed: false };

  next.hooks.Interrupt = [
    ...withoutOwn,
    { hooks: [{ type: "command", command, timeout: HOOK_TIMEOUT_SECONDS }] },
  ];
  return { config: next, changed: true };
}

const wrapperSource = () => `#!/bin/sh
# aia-projects-codex-interrupt
cmux_cli="\${CMUX_CODEX_HOOK_CMUX_BIN:-\${CMUX_BUNDLED_CLI_PATH:-}}"
if [ -z "$cmux_cli" ] || [ ! -x "$cmux_cli" ]; then
  cmux_cli="/Applications/cmux.app/Contents/Resources/bin/cmux"
fi
if [ -n "\${CMUX_SURFACE_ID:-}" ] && [ "\${CMUX_CODEX_HOOKS_DISABLED:-}" != "1" ] && [ -x "$cmux_cli" ]; then
  if [ -n "\${CMUX_SOCKET_PATH:-}" ]; then
    CMUXTERM_CLI_RESPONSE_TIMEOUT_SEC=0.5 "$cmux_cli" --socket "$CMUX_SOCKET_PATH" hooks enqueue codex stop \
      || { cat >/dev/null 2>/dev/null || true; echo '{}'; }
  else
    CMUXTERM_CLI_RESPONSE_TIMEOUT_SEC=0.5 "$cmux_cli" hooks enqueue codex stop \
      || { cat >/dev/null 2>/dev/null || true; echo '{}'; }
  fi
else
  cat >/dev/null 2>/dev/null || true
  echo '{}'
fi
exit 0
`;

const writeAtomic = (target, contents, mode) => {
  const temp = target + ".tmp-" + process.pid;
  fs.writeFileSync(temp, contents, { mode });
  fs.chmodSync(temp, mode);
  fs.renameSync(temp, target);
};

const backupPathFor = (hooksPath) => {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
  return `${hooksPath}.bak.aia-projects-${stamp}`;
};

export function installCodexInterruptHook({ home = os.homedir() } = {}) {
  const codexDir = path.join(home, ".codex");
  const hooksPath = path.join(codexDir, "hooks.json");
  const hookDir = path.join(codexDir, "hooks");
  const wrapperPath = path.join(hookDir, WRAPPER_NAME);
  const command = interruptHookCommand(wrapperPath);

  fs.mkdirSync(hookDir, { recursive: true });
  const original = fs.existsSync(hooksPath) ? fs.readFileSync(hooksPath, "utf8") : '{"hooks":{}}\n';
  const parsed = JSON.parse(original);
  const { config, changed } = mergeInterruptHook(parsed, command);
  let backupPath = null;

  writeAtomic(wrapperPath, wrapperSource(), 0o755);
  if (changed) {
    if (fs.existsSync(hooksPath)) {
      backupPath = backupPathFor(hooksPath);
      fs.copyFileSync(hooksPath, backupPath);
    }
    writeAtomic(hooksPath, JSON.stringify(config, null, 2) + "\n", 0o644);
  }

  return { changed, backupPath, wrapperPath, hooksPath, command };
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  const result = installCodexInterruptHook();
  const state = result.changed ? "installed" : "already installed";
  console.log(`Codex Interrupt hook ${state}: ${result.hooksPath}`);
  if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
  console.log("Start a new Codex session and review/trust the new hook when prompted.");
}
