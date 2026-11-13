// 本地映射仅保留显示必需的厂商和显式名称，不传递恢复命令或正文。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectLocalMetadata, injectLocalMetadata } from '../scripts/local-metadata.mjs';

test('只提取已有映射的厂商，不执行源代码或复制模型和正文', () => {
  const source = 'const GENERATED_MODEL_MAP = {"a":{"model":"private-model","provider":"deepseek","name":"secret"}};\nthrow Error("never run");';
  const result = collectLocalMetadata(source, [{ id: 'w', has_custom_title: true, custom_title: '登录修复', latest_submitted_message: 'secret' }]);
  assert.deepEqual(result, { providers: { a: { provider: 'deepseek' } }, names: { w: '登录修复' } });
  assert.ok(!JSON.stringify(result).includes('private-model'));
});

test('缺少映射或损坏数据时不猜测，不把自动标题当别名', () => {
  assert.deepEqual(collectLocalMetadata('', [{ id: 'w', title: '上一轮输入' }]), { providers: {}, names: {} });
  assert.throws(() => collectLocalMetadata('const GENERATED_MODEL_MAP = {broken};', []));
});

test('注入使用 JSON 字面量，不把名称中的替换符或代码当表达式', () => {
  const source = 'const LOCAL_CONVERSATION_METADATA = { providers: {}, names: {} };';
  const metadata = { providers: {}, names: { w: '$& ` ${secret}' } };
  const injected = injectLocalMetadata(source, metadata);
  assert.ok(injected.includes(JSON.stringify(metadata)));
  assert.throws(() => injectLocalMetadata('no marker', metadata));
});

test('默认模型没有 -m 参数时，仍从结构化会话元数据识别 OpenAI', () => {
  const result = collectLocalMetadata('', [], [{ id: 'current', model: 'gpt-6.1-sol', provider: 'openai' }]);
  assert.deepEqual(result.providers, { current: { provider: 'openai' } });
  assert.ok(!JSON.stringify(result).includes('gpt-6.1-sol'));
});

test('刷新保留新版已有厂商映射，实时元数据覆盖旧值，显式清名不复活', () => {
  const source = injectLocalMetadata('const LOCAL_CONVERSATION_METADATA = { providers: {}, names: {} };', {
    providers: { old: { provider: 'deepseek' }, current: { provider: 'deepseek' } }, names: { w: '旧名称' },
  });
  const result = collectLocalMetadata(source, [{ id: 'w', has_custom_title: false }],
    [{ id: 'current', model: 'gpt-6.1-sol', provider: 'openai' }]);
  assert.deepEqual(result, { providers: { old: { provider: 'deepseek' }, current: { provider: 'openai' } }, names: {} });
});

test('明确的模型家族优先于代理商，未知新模型不沿用旧厂商', () => {
  const source = 'const GENERATED_MODEL_MAP = {"a":{"provider":"openai"}};';
  const result = collectLocalMetadata(source, [], [
    { id: 'a', model: 'private-model', provider: 'router' },
    { id: 'b', model: 'opencode/deepseek-v4-flash-free', provider: 'openrouter' },
    { id: 'c', model: 'sonnet', provider: 'anthropic' },
  ]);
  assert.deepEqual(result.providers, { b: { provider: 'deepseek' }, c: { provider: 'anthropic' } });
});
