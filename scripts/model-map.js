#!/usr/bin/env node

// 从 cmux 会话元数据生成 Agent 会话到模型的本地映射。
// 只读取会话恢复命令中的模型参数，不读取提示词或 transcript 正文。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { installSidebar } from './install-runtime.mjs';
import { generateLocalMetadata, injectLocalMetadata } from './local-metadata.mjs';

const GENERATED_MAP_SENTINEL = "const GENERATED_MODEL_MAP = {};";

export function extractModel(command) {
  if (!command) return "";
  const match = String(command).match(
    /(?:^|\s)(?:-m|--model)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s]+))/,
  );
  return (match?.[1] || match?.[2] || match?.[3] || "").trim();
}

export function providerForModel(model) {
  const value = String(model || "").toLowerCase();
  if (value.startsWith("deepseek")) return "deepseek";
  if (/^(gpt|o[134]|chatgpt)/.test(value)) return "openai";
  if (value.startsWith("claude")) return "anthropic";
  if (value.startsWith("gemini")) return "google";
  if (value.startsWith("grok")) return "xai";
  if (/^(qwen|tongyi)/.test(value)) return "alibaba";
  if (/^(kimi|moonshot)/.test(value)) return "moonshot";
  return "unknown";
}

const MODEL_FAMILIES = [
  [/^deepseek[-_ ]?(.*)$/i, "DeepSeek"],
  [/^gpt[-_ ]?(.*)$/i, "GPT"],
  [/^claude[-_ ]?(.*)$/i, "Claude"],
  [/^gemini[-_ ]?(.*)$/i, "Gemini"],
  [/^grok[-_ ]?(.*)$/i, "Grok"],
  [/^(?:qwen|tongyi)[-_ ]?(.*)$/i, "Qwen"],
  [/^(?:kimi|moonshot)[-_ ]?(.*)$/i, "Kimi"],
];

const titleToken = (token) =>
  /^\d/.test(token) ? token : token.charAt(0).toUpperCase() + token.slice(1);

export function displayModelName(model) {
  const value = String(model || "").trim();
  if (!value) return "未知模型";
  for (const [pattern, family] of MODEL_FAMILIES) {
    const match = value.match(pattern);
    if (!match) continue;
    const tokens = match[1].split(/[-_ ]+/).filter(Boolean).map(titleToken);
    const suffix = tokens.join(" ");
    if (!suffix) return family;
    return family === "GPT" && /^\d/.test(tokens[0]) ? `${family}-${suffix}` : `${family} ${suffix}`;
  }
  return value.split(/[-_ ]+/).filter(Boolean).map(titleToken).join(" ");
}

export function buildModelMap(sessions) {
  const map = {};
  for (const session of sessions || []) {
    const id = session?.session_id;
    const model = extractModel(session?.resume_command);
    if (!id || !model) continue;
    map[id] = {
      model,
      provider: providerForModel(model),
      name: displayModelName(model),
    };
  }
  return map;
}

export function injectModelMap(source, modelMap) {
  if (!source.includes(GENERATED_MAP_SENTINEL)) {
    throw new Error("sidebar source is missing GENERATED_MODEL_MAP sentinel");
  }
  const ordered = Object.fromEntries(
    Object.keys(modelMap)
      .sort()
      .map((key) => [key, modelMap[key]]),
  );
  return source.replace(
    GENERATED_MAP_SENTINEL,
    `const GENERATED_MODEL_MAP = ${JSON.stringify(ordered, null, 2)};`,
  );
}

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sourcePath = argument(
    "--source",
    path.join(repoRoot, "src/aia-projects.js"),
  );
  const outputPath = argument(
    "--output",
    path.join(os.homedir(), ".config/cmux/sidebars/aia-projects.js"),
  );
  let count = 0;
  await installSidebar({ outputPath, activate: process.argv.includes('--activate'), generate: async (installed) => {
    const sessions = JSON.parse(execFileSync('cmux', ['--json', 'vault', 'sessions', '--limit', '100'], {
      encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    }));
    const source = fs.readFileSync(sourcePath, 'utf8');
    if (source.includes('const LOCAL_CONVERSATION_METADATA =')) {
      const workspaces = JSON.parse(execFileSync('cmux', ['--json', 'workspace', 'list'],
        { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
      const { metadata } = await generateLocalMetadata(installed, workspaces.workspaces || [], sessions.sessions || []);
      count = Object.keys(metadata.providers).length;
      return injectLocalMetadata(source, metadata);
    }
    const modelMap = buildModelMap(sessions.sessions);
    count = Object.keys(modelMap).length;
    return injectModelMap(source, modelMap);
  } });
  process.stdout.write(`Generated sidebar with ${count} provider mappings\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('侧栏生成失败（' + (error.stage || 'metadata_or_install') + '），已保留并发更新或恢复上一版；未输出原始错误。');
    process.exitCode = 1;
  });
}
