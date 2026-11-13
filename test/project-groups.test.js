// 验证项目标题与真实对话分离，使用 cmux 真实侧栏运行时。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agent, group, mountSidebar, workspaces } from './project-harness.js';

function fixture(collapsed = false) {
  return {
    workspaces: workspaces(
      { id: 'a', title: '主对话', group: 'G', selected: true },
      { id: 'b', title: '修复测试', group: 'G' },
      { id: 'c', title: '独立对话' },
    ),
    groups: [group('G', 'AIAgentCLI', 'a', { collapsed })],
  };
}
const mount = (state) => mountSidebar(state, { projectGroups: true });

test('项目下显示全部对话，包括原 anchor，且不重复', () => {
  const sb = mount(fixture());
  assert.deepEqual(sb.outline(), ['AIAgentCLI', '  主对话 Ready', '  修复测试 Ready', '独立对话 Ready']);
  assert.equal(sb.row('AIAgentCLI').highlighted, false);
  assert.equal(sb.row('主对话').highlighted, true);
});

test('点击项目标题仅折叠，不切换对话', () => {
  const sb = mount(fixture());
  sb.row('AIAgentCLI').tap();
  assert.deepEqual(sb.take(), [{ method: 'workspace.group.collapse', params: { group_id: 'G' } }]);
  assert.deepEqual(sb.outline(), ['AIAgentCLI', '独立对话 Ready']);
  sb.row('AIAgentCLI').tap();
  assert.deepEqual(sb.take(), [{ method: 'workspace.group.expand', params: { group_id: 'G' } }]);
  sb.row('修复测试').tap();
  assert.ok(sb.take().some((a) => a.method === 'workspace.select' && a.params.workspace_id === 'b'));
});

test('折叠项目时活动对话仍可见，活动状态不挂在项目标题上', () => {
  const state = fixture(true);
  state.workspaces[0].agents = [agent('working')];
  const sb = mount(state);
  assert.deepEqual(sb.rows().map((r) => r.key), ['h:g:G', 'a', 'c']);
  assert.equal(sb.row('AIAgentCLI').indicator(), null);
  assert.ok(sb.rows().find((r) => r.key === 'a').texts.includes('Running'));
});

test('对话单行显示厂商与状态，不显示任务摘要', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('working', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  state.workspaces[0].latestPrompt = '补齐导航焦点样式';
  const sb = mount(state);
  const row = sb.rows().find((r) => r.key === 'a');
  assert.deepEqual(row.texts, ['OpenAI · A', 'Running']);
  assert.equal(row.highlighted, true);
});

test('项目使用文件夹图标，不同厂商使用不同符号', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  state.workspaces[1].agents = [agent('idle', { kind: 'claude', name: 'Claude', model: 'claude-sonnet' })];
  const sb = mount(state);
  assert.ok(sb.row('AIAgentCLI').imageNames.includes('folder'));
  assert.ok(sb.rows().find((r) => r.key === 'a').imageNames.includes('sparkles'));
  assert.ok(sb.rows().find((r) => r.key === 'b').imageNames.includes('sun.max'));
});

test('Active 仅控制折叠，选中对话及其他对话仍可访问', () => {
  const sb = mount(fixture());
  sb.chip('Active').tap();
  assert.deepEqual(sb.rows().map((r) => r.key), ['h:g:G', 'a', 'b', 'c']);
  sb.row('主对话').tap();
  assert.ok(sb.take().some((a) => a.method === 'workspace.select' && a.params.workspace_id === 'a'));
});

test('项目模式的相同数据刷新不会持续发送场景更新', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  state.workspaces[0].branch = 'main';
  const sb = mount(state);
  assert.equal(sb.opsDuring(() => sb.setData(state)).length, 0);
});

test('工作状态改变不移动树形连线，历史结束记录不算额外活动代理', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('working', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', surfaceId: 's1' })];
  const sb = mount(state);
  const before = sb.rows().find((r) => r.key === 'a').leadingPadding;
  state.workspaces[0].agents[0].status = 'idle';
  state.workspaces[0].agents.push(agent('ended', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', surfaceId: 'old' }));
  sb.setData(state);
  const row = sb.rows().find((r) => r.key === 'a');
  assert.equal(row.leadingPadding, before);
  assert.equal(row.texts[0], 'OpenAI · A');
});

test('处理中显示橙色圆点 Running，所有非运行态显示绿色方块 Ready', () => {
  for (const [status, label, color, marker] of [
    ['working', 'Running', '#FF8A00', 'circle'],
    ['needs_input', 'Ready', '#30D158', 'roundedRectangle'],
    ['idle', 'Ready', '#30D158', 'roundedRectangle'],
    ['ended', 'Ready', '#30D158', 'roundedRectangle'],
    ['future_status', 'Ready', '#30D158', 'roundedRectangle'],
  ]) {
    const state = fixture();
    state.workspaces[0].agents = [agent(status, { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
    const sb = mount(state);
    const row = sb.rows().find((r) => r.key === 'a');
    assert.ok(row.texts.includes(label));
    assert.equal(row.textStyle(label).color, color);
    assert.deepEqual(row.marker(), { type: marker, color });
  }
});

test('一轮从 Running 正常完成后切为绿色 Ready，打开该对话仍保持', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('working', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  const sb = mount(state);
  state.workspaces[0].agents[0].status = 'idle';
  state.workspaces[0].agents[0].lastActivityAt = 100;
  sb.setData(state);
  let row = sb.rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Ready'));
  assert.equal(row.textStyle('Ready').color, '#30D158');
  assert.deepEqual(row.marker(), { type: 'roundedRectangle', color: '#30D158' });

  state.workspaces[0].selected = true;
  sb.setData(state);
  row = sb.rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Ready'));
  assert.equal(row.textStyle('Ready').color, '#30D158');
});

test('侧栏重载后，空闲对话仍显示绿色 Ready', () => {
  const state = fixture();
  state.now = 1700;
  state.workspaces[0].latestAt = 1000;
  state.workspaces[0].agents = [
    agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', lastActivityAt: 1600 }),
  ];
  const row = mount(state).rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Ready'));
  assert.equal(row.textStyle('Ready').color, '#30D158');
  assert.deepEqual(row.marker(), { type: 'roundedRectangle', color: '#30D158' });
});

test('Ready 绿色不会随停留时间推进而掉色', () => {
  const state = fixture();
  state.now = 100;
  state.workspaces[0].latestAt = 90;
  state.workspaces[0].agents = [
    agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', lastActivityAt: 90 }),
  ];
  const sb = mount(state);
  state.now = 100 + 2 * 60 * 60;
  sb.setData(state);
  const row = sb.rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Ready'));
  assert.equal(row.textStyle('Ready').color, '#30D158');
  assert.deepEqual(row.marker(), { type: 'roundedRectangle', color: '#30D158' });
});

test('agent 记录被清理但仍有对话提示时继续显示绿色 Ready', () => {
  const state = fixture();
  state.now = 100;
  state.workspaces[0].latestAt = 90;
  state.workspaces[0].agents = [
    agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', lastActivityAt: 90 }),
  ];
  const sb = mount(state);
  state.workspaces[0].agents = [];
  sb.setData(state);
  const row = sb.rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Ready'));
  assert.equal(row.textStyle('Ready').color, '#30D158');
  assert.deepEqual(row.marker(), { type: 'roundedRectangle', color: '#30D158' });
});

test('Codex 长时间没有 hook 活动时从 Running 切到 Ready', () => {
  const state = fixture();
  state.now = 2000;
  state.workspaces[0].agents = [
    agent('working', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', lastActivityAt: 0 }),
  ];
  const row = mount(state).rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Ready'));
  assert.equal(row.textStyle('Ready').color, '#30D158');
});

test('Running 遇到未知状态时回到 Ready', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('working', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  const sb = mount(state);
  state.workspaces[0].agents[0].status = 'future_status';
  sb.setData(state);
  const row = sb.rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Ready'));
});

test('较新的有绑定结束记录淘汰较旧的无绑定 working 记录', () => {
  const state = fixture();
  state.now = 100;
  state.workspaces[0].agents = [
    agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', surfaceId: 's-current', lastActivityAt: 90 }),
    agent('working', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', lastActivityAt: 80 }),
  ];
  const row = mount(state).rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Ready'));
});

test('较新的无绑定 working 记录仍显示 Running', () => {
  const state = fixture();
  state.now = 100;
  state.workspaces[0].agents = [
    agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', surfaceId: 's-current', lastActivityAt: 80 }),
    agent('working', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', lastActivityAt: 90 }),
  ];
  const row = mount(state).rows().find((r) => r.key === 'a');
  assert.ok(row.texts.includes('Running'));
});

test('项目显示实际 Git 分支，多个分支不会误用 anchor 分支', () => {
  const state = fixture();
  state.workspaces[0].branch = 'main';
  state.workspaces[1].branch = 'main';
  const sb = mount(state);
  assert.ok(sb.row('AIAgentCLI').texts.includes('main'));
  state.workspaces[1].branch = 'fix/focus';
  sb.setData(state);
  assert.ok(sb.row('AIAgentCLI').texts.includes('多分支'));
});

test('紧凑项目树使用清晰字号与同行单行分支标签', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  state.workspaces[0].latestPrompt = '补齐导航焦点样式';
  state.workspaces[0].branch = 'feature/long-branch-name-for-project-sidebar';
  const sb = mount(state);
  const project = sb.row('AIAgentCLI');
  const conversation = sb.rows().find((r) => r.key === 'a');
  assert.equal(conversation.textStyle('OpenAI · A').font, 13);
  assert.ok(!conversation.texts.includes('补齐导航焦点样式'));
  assert.equal(conversation.textStyle('Ready').layoutPriority, 2);
  const branch = project.textStyle(state.workspaces[0].branch);
  assert.equal(branch.help, state.workspaces[0].branch);
  assert.equal(branch.lineLimit, 1);
  assert.equal(branch.truncation, 'middle');
  assert.deepEqual(project.textParents(state.workspaces[0].branch).filter((type) => type !== 'group').slice(0, 1), ['hstack']);
});

test('选中高亮随对话切换，项目标题不冒充选中对话', () => {
  const state = fixture();
  const sb = mount(state);
  assert.equal(sb.rows().find((r) => r.key === 'a').background, '#4C9EEB26');
  assert.equal(sb.row('AIAgentCLI').highlighted, false);
  state.workspaces[0].selected = false;
  state.workspaces[1].selected = true;
  sb.setData(state);
  assert.equal(sb.rows().find((r) => r.key === 'a').background, null);
  assert.equal(sb.rows().find((r) => r.key === 'b').background, '#4C9EEB26');
});

test('缺少分支和摘要时不伪造数据，保留原对话标题', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  const sb = mount(state);
  assert.deepEqual(sb.row('AIAgentCLI').texts, ['AIAgentCLI']);
  assert.deepEqual(sb.rows().find((r) => r.key === 'a').texts, ['OpenAI · A', 'Ready']);
});

test('多个代理时厂商与聚焦终端绑定，摘要不展示', () => {
  const state = fixture();
  state.workspaces[0].agents = [
    agent('idle', { kind: 'claude', name: 'Claude', model: 'claude-sonnet', surfaceId: 's2', lastActivityAt: 2 }),
    agent('working', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol', surfaceId: 's1', lastActivityAt: 1 }),
  ];
  state.workspaces[0].tabs = [
    { id: 't1', surfaceId: 's1', focused: true, latestPrompt: '当前 Codex 任务' },
    { id: 't2', surfaceId: 's2', latestPrompt: '另一个 Claude 任务' },
  ];
  const sb = mount(state);
  assert.deepEqual(sb.rows().find((r) => r.key === 'a').texts, ['OpenAI · A +1', 'Running']);
});

test('多行长输入不进入侧栏，厂商标签保持稳定', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('idle', { kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  state.workspaces[0].latestPrompt = '导航焦点\n'.repeat(100);
  const row = mount(state).rows().find((r) => r.key === 'a');
  assert.deepEqual(row.texts, ['OpenAI · A', 'Ready']);
});

test('代理状态更新不重建项目树，也不展示新输入', () => {
  const state = fixture();
  state.workspaces[0].agents = [agent('working', { id: 's1', kind: 'codex', name: 'Codex', model: 'gpt-6.1-sol' })];
  const sb = mount(state);
  state.workspaces[0].agents[0].status = 'needs_input';
  state.workspaces[0].latestPrompt = '请确认修改';
  sb.setData(state);
  assert.deepEqual(sb.rows().find((r) => r.key === 'a').texts, ['OpenAI · A', 'Ready']);
});

test('嵌套项目的所有 anchor 各显示一次，折叠后不重复', () => {
  const state = fixture();
  state.workspaces.push(...workspaces({ id: 'd', title: '子项目对话', group: 'H', agents: [agent('working')] }));
  state.groups.push(group('H', 'AIAgentCLI/子项目', 'd'));
  const sb = mount(state);
  assert.equal(sb.rows().filter((r) => r.key === 'd').length, 1);
  sb.row('AIAgentCLI').tap();
  assert.equal(sb.rows().filter((r) => r.key === 'd').length, 1);
});

test('项目加号仍创建组内工作区，单对话项目仍保留子项', () => {
  const state = fixture();
  state.workspaces = workspaces(state.workspaces[0]);
  const sb = mount(state);
  assert.deepEqual(sb.outline(), ['AIAgentCLI', '  主对话 Ready']);
  sb.row('AIAgentCLI').menu('新建对话', '新建空白终端');
  assert.deepEqual(sb.take(), [{ method: 'workspace.group.new_workspace', params: { group_id: 'G' } }]);
});

test('拖动整个项目时，重排请求不重复包含 anchor', () => {
  const sb = mount(fixture());
  sb.drop('h:g:G', 4);
  const reorder = sb.take().find((a) => a.method === 'workspace.reorder_many');
  assert.ok(reorder);
  assert.deepEqual(JSON.parse(reorder.params.workspace_ids), ['c', 'a', 'b']);
});

test('移走 anchor 后由新 anchor 接替，所有对话依然可访问', () => {
  const state = fixture();
  const sb = mount(state);
  sb.setData({ ...state, workspaces: workspaces(
    { id: 'a', title: '主对话' },
    { id: 'b', title: '修复测试', group: 'G' },
  ), groups: [group('G', 'AIAgentCLI', 'b')] });
  assert.deepEqual(sb.outline(), ['主对话 Ready', 'AIAgentCLI', '  修复测试 Ready']);
});
