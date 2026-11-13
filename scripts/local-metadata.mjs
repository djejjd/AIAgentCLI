// 提取本地厂商及显式名称；只解析模型元数据事件，不提取输入或工具正文。
import { open, realpath, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
const PROVIDERS = new Set(['openai', 'anthropic', 'deepseek', 'google', 'xai', 'alibaba', 'moonshot']);
const MAX_SESSION_BYTES = 64 * 1024 * 1024;

// 原始错误与路径不进入报告；句柄和流在成功、早退与异常时统一释放。
export async function readSessionModelMetadata(file, expectedId) {
  let handle, stream, lines;
  const unavailable = (stage) => ({ state: 'unavailable', stage });
  try {
    handle = await open(file, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_SESSION_BYTES) return unavailable('size_limit');
    stream = handle.createReadStream({ encoding: 'utf8', autoClose: false });
    lines = createInterface({ input: stream, crlfDelay: Infinity });
    let id = '', model = '', provider = '', bytes = 0;
    for await (const line of lines) {
      bytes += Buffer.byteLength(line);
      if (bytes > MAX_SESSION_BYTES) return unavailable('size_limit');
      if (!/"type"\s*:\s*"(?:session_meta|turn_context)"/.test(line.slice(0, 180))) continue;
      if (line.length > 1024 * 1024) return unavailable('metadata_limit');
      let event;
      try { event = JSON.parse(line); } catch { continue; } // 文件正在追加时末行可尚未写完。
      const payload = event.payload || {};
      if (event.type === 'session_meta') {
        id = payload.id || '';
        if (id !== expectedId) return unavailable('identity_mismatch');
      }
      if (!['session_meta', 'turn_context'].includes(event.type)) continue;
      if (typeof payload.model === 'string') model = payload.model.slice(0, 160);
      if (typeof payload.model_provider === 'string') provider = payload.model_provider.slice(0, 80);
    }
    if (!id || id !== expectedId) return unavailable('identity_mismatch');
    return model || provider ? { state: 'ready', id, model, provider } : unavailable('no_model_metadata');
  } catch { return unavailable('read_failed'); }
  finally {
    lines?.close();
    stream?.destroy();
    await handle?.close().catch(() => {});
  }
}

// 仅按明确模型家族或已知厂商识别；路由商名称与工具名不作为默认厂商。
function metadataProvider({ model, provider }) {
  const value = String(model || '').toLowerCase().split('/').at(-1);
  const families = [
    [/^deepseek/, 'deepseek'], [/^(gpt|o[134](?:[-.]|$)|chatgpt)/, 'openai'],
    [/^claude/, 'anthropic'], [/^gemini/, 'google'], [/^grok/, 'xai'],
    [/^(qwen|tongyi)/, 'alibaba'], [/^(kimi|moonshot)/, 'moonshot'],
  ];
  return families.find(([pattern]) => pattern.test(value))?.[1] || (PROVIDERS.has(provider) ? provider : '');
}

// 兼容旧版多行模型映射及新版单行厂商映射；只解析 JSON，不执行安装源码。
function installedMetadata(source) {
  const legacy = source.match(/const GENERATED_MODEL_MAP = (\{[^\n]*\}|\{[\s\S]*?\n\});/);
  const current = source.match(/^const LOCAL_CONVERSATION_METADATA = (\{[^\n]*\});$/m);
  const legacyMap = legacy ? JSON.parse(legacy[1]) : {};
  const defaultEmpty = current && /^\{\s*providers:\s*\{\},\s*names:\s*\{\}\s*\}$/.test(current[1]);
  const metadata = current && !defaultEmpty ? JSON.parse(current[1]) : {};
  return { mappings: { ...legacyMap, ...metadata.providers }, names: { ...metadata.names } };
}

// 新鲜会话元数据覆盖快照；结果只保留厂商，不传递模型、正文或恢复命令。
export function collectLocalMetadata(source, workspaces, sessionMetadata = []) {
  const { mappings, names } = installedMetadata(source);
  const providers = {};
  for (const [id, value] of Object.entries(mappings)) {
    if (PROVIDERS.has(value?.provider)) providers[id] = { provider: value.provider };
  }
  for (const session of sessionMetadata) {
    if (!session.id) continue;
    const provider = metadataProvider(session);
    if (provider) providers[session.id] = { provider };
    else delete providers[session.id]; // 明确的新未知值不能被旧快照冒充。
  }
  for (const w of workspaces) {
    if (w.has_custom_title === false) delete names[w.id];
    if (w.has_custom_title && typeof w.custom_title === 'string' && w.custom_title.trim()) {
      names[w.id] = w.custom_title.trim().slice(0, 160);
    }
  }
  return { providers, names };
}

// JSON 序列化后以回调注入，避免名称中的 $& 等字符被当作替换指令。
export function injectLocalMetadata(source, metadata) {
  const marker = /const LOCAL_CONVERSATION_METADATA = \{[^\n]*\};/;
  if (!marker.test(source)) throw new Error('Missing local metadata marker');
  return source.replace(marker, () => 'const LOCAL_CONVERSATION_METADATA = ' + JSON.stringify(metadata) + ';');
}

// 调用者提供源码快照与会话索引；文件路径限制在指定会话根目录，输出不含模型正文。
export async function generateLocalMetadata(source, workspaces, sessions,
  sessionRoot = path.join(homedir(), '.codex/sessions')) {
  const root = await realpath(sessionRoot).catch(() => '');
  const records = sessions.flatMap((session) => {
    const match = String(session.resume_command || '').match(/(?:^|\s)(?:-m|--model)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
    const model = match?.[1] || match?.[2] || match?.[3];
    return session.session_id && model ? [{ id: session.session_id, model }] : [];
  }), skipped = {};
  let sessionMetadataReady = 0;
  for (const session of sessions) {
    if (session.agent !== 'codex' || !session.session_id || !session.file) continue;
    const file = await realpath(session.file).catch(() => '');
    const withinRoot = root && file.startsWith(root + path.sep);
    const result = withinRoot ? await readSessionModelMetadata(file, session.session_id)
      : { state: 'unavailable', stage: 'path_unavailable' };
    if (result.state === 'ready') { records.push(result); sessionMetadataReady++; }
    else skipped[result.stage] = (skipped[result.stage] || 0) + 1;
  }
  const metadata = collectLocalMetadata(source, workspaces, records);
  return { metadata, summary: { mappings: Object.keys(metadata.providers).length, sessionMetadataReady, unavailable: skipped } };
}

// 显式刷新命令：索引只用来定位同一会话的本机元数据文件，不读取恢复命令或标题。
async function refreshMetadata() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? '' : process.argv[i + 1]; };
  const output = arg('--output');
  if (!output || output.startsWith('--')) throw new Error('output_required');
  const source = arg('--source') || path.join(homedir(), '.config/cmux/sidebars/aia-projects.js');
  const readCmux = (args) => JSON.parse(execFileSync('cmux', ['--json', ...args], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const workspaces = readCmux(['workspace', 'list']).workspaces || [];
  const sessions = readCmux(['vault', 'sessions', '--limit', '100']).sessions || [];
  const { metadata, summary } = await generateLocalMetadata(await readFile(source, 'utf8'), workspaces, sessions);
  await writeFile(output, JSON.stringify(metadata), { mode: 0o600 });
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  refreshMetadata().catch(() => {
    console.error('元数据刷新失败：请核对输出参数、安装文件和本机 cmux 连接；未输出原始错误。');
    process.exitCode = 1;
  });
}
