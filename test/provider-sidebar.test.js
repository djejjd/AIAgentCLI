// 厂商单行侧栏的真实运行时回归。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, group, mountSidebar, workspaces } from './project-harness.js';
const state = () => ({ workspaces: workspaces({ id: '00000000-0000-0000-0000-000000000001',
  title: '旧输入不能显示', directory: '/tmp/Project', group: 'G', selected: true,
  latestPrompt: '上轮敏感输入', description: '旧摘要',
  agents: [agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })] }),
  groups: [group('G', 'Project', '00000000-0000-0000-0000-000000000001')] });
const mount = (s, settings) => mountSidebar(s, { projectGroups: true, ...settings });

test('会话只显示厂商和状态，不显示模型或任何上轮输入', () => {
  const row = mount(state()).rows().find((r) => !r.key.startsWith('h:'));
  assert.deepEqual(row.texts, ['OpenAI · 000001', 'Ready']);
  assert.ok(row.imageNames.includes('sparkles'));
  assert.equal(row.shapeStyle('roundedRectangle').width, 5);
  assert.equal(row.shapeStyle('roundedRectangle').height, 5);
});

test('重命名后单行包含自定义名，保留厂商，清空后恢复编号', () => {
  const sb = mount(state());
  let row = sb.rows().find((r) => !r.key.startsWith('h:'));
  row.doubleTap();
  sb.rows().find((r) => !r.key.startsWith('h:')).submit('修复登录');
  row = sb.rows().find((r) => !r.key.startsWith('h:'));
  assert.deepEqual(row.texts, ['修复登录 · OpenAI', 'Ready']);
  assert.ok(sb.take().some((a) => a.method === 'workspace.action' && a.params.title === '修复登录 · OpenAI'));
  row.doubleTap();
  sb.rows().find((r) => !r.key.startsWith('h:')).submit('');
  assert.deepEqual(sb.rows().find((r) => !r.key.startsWith('h:')).texts, ['OpenAI · 000001', 'Ready']);
});

test('原生自定义名称重载后保留，未知厂商不猜测，纯终端不读取摘要', () => {
  const s = state();
  s.workspaces[0].customTitle = '排查登录';
  s.workspaces[0].agents[0].model = '';
  const sb = mount(s);
  assert.deepEqual(sb.rows().find((r) => !r.key.startsWith('h:')).texts, ['排查登录 · 未知厂商', 'Ready']);
  s.workspaces[0].agents = [];
  sb.setData(s);
  assert.deepEqual(sb.rows().find((r) => !r.key.startsWith('h:')).texts, ['排查登录', 'Ready']);
});

test('同厂商对话编号不随重排或状态变化跳动', () => {
  const s = state();
  s.workspaces.push(...workspaces({ ...s.workspaces[0], id: '00000000-0000-0000-0000-000000000002', selected: false }));
  const sb = mount(s);
  const before = sb.rows().filter((r) => !r.key.startsWith('h:')).map((r) => [r.key, r.texts[0]]);
  s.workspaces.reverse();
  sb.setData(s);
  for (const [key, label] of before) assert.equal(sb.rows().find((r) => r.key === key).texts[0], label);
});

test('项目加号菜单提供空白终端和显式模型预设，加载时不启动', () => {
  const sb = mount(state(), { autoProjectGroups: true });
  assert.equal(sb.take().length, 0);
  const row = sb.row('Project');
  assert.ok(row.menuLabels('新建对话').includes('新建空白终端'));
  row.menu('新建对话', 'Codex · Sol');
  const action = sb.take().find((a) => a.method === 'workspace.create');
  assert.equal(action.params.initial_input, "'codex' '-m' 'gpt-6.1-sol'\r");
  assert.equal(action.params.group_id, 'G');
});

test('宿主确认改名后，外部再改名和清空不会被旧缓存遮住', () => {
  const s = state();
  s.workspaces[0].tabs = [{ title: '终端自动标题', focused: true }];
  const sb = mount(s);
  let row = sb.rows().find((r) => !r.key.startsWith('h:'));
  row.doubleTap();
  sb.rows().find((r) => !r.key.startsWith('h:')).submit('侧栏改名');
  s.workspaces[0].title = '侧栏改名 · OpenAI';
  sb.setData(s);
  s.workspaces[0].title = '外部新名';
  s.workspaces[0].customTitle = '外部新名';
  sb.setData(s);
  assert.deepEqual(sb.rows().find((r) => !r.key.startsWith('h:')).texts, ['外部新名 · OpenAI', 'Ready']);
  s.workspaces[0].title = '终端自动标题';
  s.workspaces[0].customTitle = '';
  sb.setData(s);
  assert.deepEqual(sb.rows().find((r) => !r.key.startsWith('h:')).texts, ['OpenAI · 000001', 'Ready']);
});

test('宿主只提供 title 和 tabs 时，侧栏自定义名称重新加载仍可显示', () => {
  const s = state();
  s.workspaces[0].title = '登录修复 · OpenAI';
  s.workspaces[0].tabs = [{ title: '终端自动标题', focused: true }];
  assert.deepEqual(mount(s).rows().find((r) => !r.key.startsWith('h:')).texts, ['登录修复 · OpenAI', 'Ready']);
});

test('启动预设的原生标题在没有代理 hook 时仍显示厂商和 Ready', () => {
  const s = state();
  s.workspaces[0].agents = [];
  s.workspaces[0].title = 'OpenAI · 1794529411-1';
  delete s.workspaces[0].latestPrompt;
  delete s.workspaces[0].description;
  const sb = mount(s);
  assert.deepEqual(sb.rows().find((r) => !r.key.startsWith('h:')).texts, ['OpenAI · 000001', 'Ready']);
  assert.ok(sb.rows().find((r) => !r.key.startsWith('h:')).imageNames.includes('sparkles'));
  sb.rows().find((r) => !r.key.startsWith('h:')).doubleTap();
  sb.rows().find((r) => !r.key.startsWith('h:')).submit('登录修复');
  assert.ok(sb.take().some((a) => a.params.title === '登录修复 · OpenAI'));
});

test('终端动态标题不同于工作区标题时，不冒充用户自定义名', () => {
  const s = state();
  s.workspaces[0].title = 'Project';
  s.workspaces[0].tabs = [{ title: '⠋ Project', focused: true }];
  assert.deepEqual(mount(s).rows().find((r) => !r.key.startsWith('h:')).texts, ['OpenAI · 000001', 'Ready']);
});

test('最近使用的预设前移，空白终端始终保持首项', () => {
  const sb = mount(state(), { autoProjectGroups: true });
  sb.row('Project').menu('新建对话', 'Codex · Astra');
  const labels = sb.row('Project').menuLabels('新建对话');
  assert.equal(labels[0], '新建空白终端');
  assert.equal(labels[1], 'Codex · Astra');
});
