// 仅读取模型元数据事件；提示词、工具输出、原始错误和路径均不进入返回值。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSessionModelMetadata } from '../scripts/local-metadata.mjs';

async function fixture(t, lines) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'aia-model-metadata-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'fixture.jsonl');
  await fs.writeFile(file, lines.map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n'));
  return file;
}

test('只取匹配会话的最后模型字段，忽略输入正文及其中的假模型', async (t) => {
  const file = await fixture(t, [
    { type: 'session_meta', payload: { id: 'current', model_provider: 'openai' } },
    { type: 'turn_context', payload: { model: 'gpt-6-luna' } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'secret', model: 'deepseek-flash' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', developer_instructions: 'private body' } },
    '{"type":"turn_context","payload":',
  ]);
  const result = await readSessionModelMetadata(file, 'current');
  assert.deepEqual(result, { state: 'ready', id: 'current', model: 'gpt-6.1-sol', provider: 'openai' });
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.ok(!JSON.stringify(result).includes('private body'));
});

test('文件缺失、身份错配和无模型时返回固定失败阶段，不含原始错误', async (t) => {
  const file = await fixture(t, [{ type: 'session_meta', payload: { id: 'other', model_provider: 'openai' } }]);
  assert.deepEqual(await readSessionModelMetadata(file, 'current'), { state: 'unavailable', stage: 'identity_mismatch' });
  assert.deepEqual(await readSessionModelMetadata(file + '.missing', 'current'), { state: 'unavailable', stage: 'read_failed' });
  const empty = await fixture(t, [{ type: 'session_meta', payload: { id: 'current' } }]);
  assert.deepEqual(await readSessionModelMetadata(empty, 'current'), { state: 'unavailable', stage: 'no_model_metadata' });
});

test('读取失败后仍能再次读取，输出不包含文件路径', async (t) => {
  const file = await fixture(t, [{ type: 'session_meta', payload: { id: 'current', model_provider: 'openai' } }]);
  const first = await readSessionModelMetadata(file, 'wrong');
  assert.ok(!JSON.stringify(first).includes(file));
  assert.equal((await readSessionModelMetadata(file, 'current')).state, 'ready');
});

test('超出读取限额时立即返回固定阶段，随后可正常读取其他文件', async (t) => {
  const file = await fixture(t, []);
  await fs.truncate(file, 64 * 1024 * 1024 + 1);
  assert.deepEqual(await readSessionModelMetadata(file, 'current'), { state: 'unavailable', stage: 'size_limit' });
  const good = await fixture(t, [{ type: 'session_meta', payload: { id: 'current', model_provider: 'openai' } }]);
  assert.equal((await readSessionModelMetadata(good, 'current')).state, 'ready');
});

test('过长元数据事件不解析或返回其正文', async (t) => {
  const file = await fixture(t, [
    { type: 'session_meta', payload: { id: 'current', model_provider: 'openai' } },
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', body: 'x'.repeat(1024 * 1024) } },
  ]);
  assert.deepEqual(await readSessionModelMetadata(file, 'current'), { state: 'unavailable', stage: 'metadata_limit' });
});
