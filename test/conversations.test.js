// 厂商展示与启动状态机的行为回归，不读取真实会话正文。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function api() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(new URL('../src/conversations.js', import.meta.url), 'utf8'), ctx);
  return vm.runInContext('({ providerForModel, conversationProvider, conversationNumber, presetCommand, createConversationLauncher })', ctx);
}

test('厂商识别支持命名空间，不能按 Codex 工具名冒充 OpenAI', () => {
  const a = api();
  assert.equal(a.providerForModel('opencode/deepseek-v4-flash-free'), 'deepseek');
  assert.equal(a.providerForModel('anthropic/claude-sonnet'), 'anthropic');
  assert.equal(a.conversationProvider({ kind: 'codex' }, {}).name, '未知厂商');
  assert.equal(a.conversationProvider({ kind: 'codex', model: 'deepseek-flash' }, {}).name, 'DeepSeek');
});

test('运行元数据优先于静态映射，不把代理商当模型厂商', () => {
  const a = api();
  assert.equal(a.conversationProvider({ id: 'a', model: 'gpt-6.1-sol', provider: 'openrouter' },
    { a: { model: 'deepseek-flash' } }).name, 'OpenAI');
  assert.equal(a.conversationProvider({ id: 'a' }, { a: { provider: 'deepseek' } }).name, 'DeepSeek');
});

test('编号绑定工作区身份，重排和重新加载都不改变', () => {
  const a = api();
  const id = 'A08EBBCC-1111-2222-3333-123456789ABC';
  assert.equal(a.conversationNumber(id), api().conversationNumber(id));
  assert.notEqual(a.conversationNumber(id), a.conversationNumber('BBBBCCCC-1111-2222-3333-123456789ABD'));
});

test('启动命令只接受已知工具和有界模型 ID，拒绝注入及权限绕过', () => {
  const a = api();
  assert.equal(a.presetCommand({ tool: 'codex', model: 'gpt-6.1-sol' }), "'codex' '-m' 'gpt-6.1-sol'");
  assert.equal(a.presetCommand({ tool: 'opencode', model: 'opencode/deepseek-v4-flash-free' }),
    "'opencode' '-m' 'opencode/deepseek-v4-flash-free'");
  for (const preset of [{ tool: 'sh', model: 'x' }, { tool: 'codex', model: 'x;curl secret' },
    { tool: 'codex', model: '--yolo' }]) assert.equal(a.presetCommand(preset), null);
});

const preset = { id: 'sol', tool: 'codex', model: 'gpt-6.1-sol', label: 'Codex · Sol' };
const ws = [{ id: 'old', group: 'G', directory: '/tmp/project' }];

test('创建预设只发一次初始命令，宿主确认创建后释放请求', () => {
  const actions = [];
  const launcher = api().createConversationLauncher((method, params) => actions.push({ method, params }));
  assert.equal(launcher.start('G', preset, ws, 0), true);
  assert.equal(launcher.start('G', preset, ws, 1), false);
  assert.equal(actions[0].method, 'workspace.create');
  assert.equal(actions[0].params.group_id, 'G');
  assert.equal(actions[0].params.cwd, '/tmp/project');
  assert.equal(actions[0].params.initial_input, "'codex' '-m' 'gpt-6.1-sol'\r");
  assert.ok(!('command' in actions[0].params));
  const title = actions[0].params.title;
  const created = { id: 'new', group: 'G', title, agents: [] };
  assert.equal(launcher.tick([...ws, created], ['G'], 2).state, 'idle');
  created.agents = [{ kind: 'codex', status: 'idle' }];
  assert.equal(launcher.tick([...ws, created], ['G'], 3).state, 'idle');
  assert.equal(launcher.pending(), false);
  assert.equal(actions.length, 1);
});

test('创建超时及发送失败释放请求，不自动重试；创建后无代理不误报失败', () => {
  let count = 0;
  const launcher = api().createConversationLauncher(() => count++);
  launcher.start('G', preset, ws, 0);
  assert.equal(launcher.tick(ws, ['G'], 16).failure, '创建对话');
  assert.equal(launcher.pending(), false);
  launcher.tick(ws, ['G'], 50);
  assert.equal(count, 1);
  const broken = api().createConversationLauncher(() => { throw new Error('private body'); });
  broken.start('G', preset, ws, 0);
  assert.equal(broken.tick(ws, ['G'], 1).failure, '发送创建请求');
  assert.equal(broken.pending(), false);
  let title;
  const slow = api().createConversationLauncher((_, p) => { title = p.title; });
  slow.start('G', preset, ws, 0);
  const next = [...ws, { id: 'new', group: 'G', title, agents: [] }];
  slow.tick(next, ['G'], 1);
  assert.equal(slow.tick(next, ['G'], 61).failure, '');
  assert.equal(slow.pending(), false);
});

test('项目消失、混合目录和远程项目不会误启动，创建后关闭不残留请求', () => {
  const launcher = api().createConversationLauncher(() => {});
  assert.equal(launcher.start('G', preset, [{ ...ws[0], remote: { target: 'host' } }], 0), false);
  assert.equal(launcher.start('G', preset, [...ws, { id: 'other', group: 'G', directory: '/else' }], 0), false);
  launcher.start('G', preset, ws, 0);
  assert.equal(launcher.tick(ws, [], 1).failure, '项目已移除');
  assert.equal(launcher.pending(), false);
  let title;
  const closed = api().createConversationLauncher((_, p) => { title = p.title; });
  closed.start('G', preset, ws, 0);
  closed.tick([...ws, { id: 'new', group: 'G', title }], ['G'], 1);
  assert.equal(closed.tick(ws, ['G'], 2).failure, '');
  assert.equal(closed.pending(), false);
});

test('未知模型别名回退明确运行厂商，不回退陈旧映射', () => {
  const a = api();
  assert.equal(a.conversationProvider({ id: 'a', provider: 'anthropic', model: 'sonnet' }, {}).name, 'Anthropic');
  assert.equal(a.conversationProvider({ id: 'a', model: 'unrecognized' }, { a: { provider: 'openai' } }).name, '未知厂商');
});

test('新终端确认创建即释放请求，未发送首轮输入也不会误报启动失败', () => {
  let title;
  const launcher = api().createConversationLauncher((_, p) => { title = p.title; });
  launcher.start('G', preset, ws, 0);
  const next = [...ws, { id: 'new', group: 'G', title, tabs: [{ title: 'project', surfaceId: 's' }] }];
  assert.equal(launcher.tick(next, ['G'], 1).state, 'idle');
  assert.equal(launcher.pending(), false);
  assert.equal(launcher.tick(next, ['G'], 100).failure, '');
});
