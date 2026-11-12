import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, test } from "node:test";
import {
  installCodexInterruptHook,
  interruptHookCommand,
  mergeInterruptHook,
} from "../scripts/install-codex-interrupt-hook.mjs";

const roots = [];
const tempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aia-codex-hooks-"));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test("adds the cmux Interrupt hook without changing existing hooks", () => {
  const command = interruptHookCommand("/tmp/home/.codex/hooks/aia-projects-codex-interrupt.sh");
  const original = {
    hooks: {
      Interrupt: [{ hooks: [{ type: "command", command: "orca-hook", timeout: 3 }] }],
      Stop: [{ hooks: [{ type: "command", command: "stop-hook", timeout: 5 }] }],
    },
  };

  const { config, changed } = mergeInterruptHook(original, command);

  assert.equal(changed, true);
  assert.deepEqual(original.hooks.Interrupt, [
    { hooks: [{ type: "command", command: "orca-hook", timeout: 3 }] },
  ]);
  assert.deepEqual(config.hooks.Interrupt, [
    { hooks: [{ type: "command", command: "orca-hook", timeout: 3 }] },
    { hooks: [{ type: "command", command, timeout: 5 }] },
  ]);
  assert.deepEqual(config.hooks.Stop, original.hooks.Stop);
});

test("applying the Interrupt hook twice is idempotent", () => {
  const command = interruptHookCommand("/tmp/home/.codex/hooks/aia-projects-codex-interrupt.sh");
  const first = mergeInterruptHook({ hooks: {} }, command);
  const second = mergeInterruptHook(first.config, command);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.deepEqual(second.config, first.config);
});

test("installs an executable wrapper, backs up hooks.json, and is repeatable", () => {
  const home = tempRoot();
  const codexDir = path.join(home, ".codex");
  fs.mkdirSync(codexDir, { recursive: true });
  const hooksPath = path.join(codexDir, "hooks.json");
  fs.writeFileSync(hooksPath, JSON.stringify({
    hooks: {
      Interrupt: [{ hooks: [{ type: "command", command: "orca-hook", timeout: 3 }] }],
    },
  }, null, 2) + "\n");

  const first = installCodexInterruptHook({ home });
  assert.equal(first.changed, true);
  assert.ok(fs.existsSync(first.backupPath));
  assert.ok(fs.existsSync(first.wrapperPath));
  assert.ok(fs.statSync(first.wrapperPath).mode & 0o111);
  assert.ok(fs.readFileSync(hooksPath, "utf8").includes(first.command));

  const second = installCodexInterruptHook({ home });
  assert.equal(second.changed, false);
});

test("wrapper forwards Interrupt to cmux as a codex stop event", () => {
  const home = tempRoot();
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  const hooksPath = path.join(home, ".codex", "hooks.json");
  fs.writeFileSync(hooksPath, '{"hooks":{}}\n');
  const installed = installCodexInterruptHook({ home });

  const fakeCmux = path.join(home, "fake-cmux");
  const argsPath = path.join(home, "args.txt");
  const stdinPath = path.join(home, "stdin.json");
  fs.writeFileSync(fakeCmux,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE_ARGS"\ncat > "$CAPTURE_STDIN"\n');
  fs.chmodSync(fakeCmux, 0o755);

  const payload = '{"hook_event_name":"Interrupt","session_id":"abc"}\n';
  const result = spawnSync(installed.wrapperPath, {
    input: payload,
    encoding: "utf8",
    env: {
      ...process.env,
      CMUX_SURFACE_ID: "surface:test",
      CMUX_SOCKET_PATH: "",
      CMUX_CODEX_HOOK_CMUX_BIN: fakeCmux,
      CAPTURE_ARGS: argsPath,
      CAPTURE_STDIN: stdinPath,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(argsPath, "utf8"), "hooks\nenqueue\ncodex\nstop\n");
  assert.equal(fs.readFileSync(stdinPath, "utf8"),
    '{"hook_event_name":"Stop","session_id":"abc"}\n');
});

test("wrapper stays inert outside cmux", () => {
  const home = tempRoot();
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "hooks.json"), '{"hooks":{}}\n');
  const installed = installCodexInterruptHook({ home });

  const result = spawnSync(installed.wrapperPath, {
    input: "{}\n",
    encoding: "utf8",
    env: { ...process.env, CMUX_SURFACE_ID: "" },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "{}\n");
});
