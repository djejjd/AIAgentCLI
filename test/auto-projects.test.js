// 自动归组通过真实场景事件发命令，再用宿主回显验证完成及失败分支。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { group, mountSidebar, workspaces } from './project-harness.js';

const mount = (state) => mountSidebar(state, { projectGroups: true, autoProjectGroups: true });
const ws = (id, directory, extra = {}) => ({ id, title: id, directory, ...extra });
const create = (sb) => sb.take().filter((a) => a.method === 'workspace.group.create');

test('自动项目折叠时隐藏当前活动对话，展开后恢复', () => {
  const state = { workspaces: workspaces(ws('a', '/Code/App', { group: 'G', selected: true,
    agents: [{ id: 'agent-a', kind: 'codex', name: 'Codex', status: 'working', lastActivityAt: 0 }] })),
  groups: [group('G', 'App', 'a')] };
  const sb = mount(state);
  sb.row('App').tap();
  assert.deepEqual(sb.outline(), ['App']);
  sb.row('App').tap();
  assert.deepEqual(sb.rows().map((r) => r.key), ['h:g:G', 'a']);
});

test('单个未分组对话也创建项目，不额外生成空白工作区', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/Code/App')) });
  const calls = create(sb);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.name, 'App');
  assert.deepEqual(JSON.parse(calls[0].params.child_workspace_ids), ['a']);
});

test('同路径一次归组，不同路径不混入', () => {
  const state = { workspaces: workspaces(ws('a', '/Code/App/'), ws('b', '/Code/App'), ws('c', '/Code/Other')) };
  const sb = mount(state);
  assert.deepEqual(JSON.parse(create(sb)[0].params.child_workspace_ids), ['a', 'b']);
  sb.setData({ ...state, workspaces: workspaces(
    ws('a', '/Code/App', { group: 'G' }), ws('b', '/Code/App', { group: 'G' }), ws('c', '/Code/Other'),
  ), groups: [group('G', 'App', 'a')], now: 1 });
  assert.equal(create(sb)[0].params.name, 'Other');
});

test('已有同路径项目时加入现有组，不再创建第二个组', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/Code/App', { group: 'G' }), ws('b', '/Code/App')),
    groups: [group('G', 'App', 'a')] });
  assert.deepEqual(sb.take(), [{ method: 'workspace.group.add', params: { group_id: 'G', workspace_id: 'b' } }]);
});

test('同路径存在多个组时移入第一个组，不关闭任何对话', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/Code/App', { group: 'G' }), ws('b', '/Code/App', { group: 'H' })),
    groups: [group('G', 'App', 'a'), group('H', 'App', 'b')] });
  assert.deepEqual(sb.take(), [{ method: 'workspace.group.add', params: { group_id: 'G', workspace_id: 'b' } }]);
});

test('默认组名按项目路径更新，不能用混合目录组作为目标', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/Code/App', { group: 'G' })),
    groups: [group('G', 'New Group', 'a')] });
  assert.deepEqual(sb.take(), [{ method: 'workspace.group.rename', params: { group_id: 'G', name: 'App' } }]);
  const mixed = mount({ workspaces: workspaces(ws('a', '/Code/App', { group: 'G' }), ws('b', '/Code/Other', { group: 'G' })),
    groups: [group('G', 'Mixed', 'a')] });
  assert.deepEqual(JSON.parse(create(mixed)[0].params.child_workspace_ids), ['a']);
});

test('等待回显期间不重复创建，确认后释放挂起命令', () => {
  const state = { workspaces: workspaces(ws('a', '/Code/App')) };
  const sb = mount(state);
  create(sb);
  sb.setData({ ...state, now: 5 });
  assert.deepEqual(sb.take(), []);
  const settled = { workspaces: workspaces(ws('a', '/Code/App', { group: 'G' })), groups: [group('G', 'App', 'a')], now: 6 };
  sb.setData(settled);
  assert.deepEqual(sb.take(), []);
  sb.setData({ ...settled, now: 100 });
  assert.deepEqual(sb.take(), []);
  assert.ok(!sb.outline().some((s) => s.includes('未完成')));
});

test('创建无回显时显示失败阶段，停止重试；手动重试只发一次', () => {
  const state = { workspaces: workspaces(ws('a', '/Code/App')) };
  const sb = mount(state);
  create(sb);
  sb.setData({ ...state, now: 16 });
  assert.ok(sb.outline().some((s) => s.includes('创建分组') && s.includes('未完成')));
  sb.setData({ ...state, now: 32 });
  assert.deepEqual(sb.take(), []);
  sb.tapButton('重试归组');
  assert.equal(create(sb).length, 1);
});

test('命令发送失败不使侧栏崩溃，记录失败阶段并释放等待状态', () => {
  const factory = vm.runInNewContext(readFileSync(new URL('../src/auto-projects.js', import.meta.url), 'utf8')
    + '\ncreateProjectReconciler');
  let calls = 0;
  const reconcile = factory(() => { calls++; throw new Error('host unavailable'); });
  const data = workspaces(ws('a', '/Code/App'));
  const result = reconcile.tick(data, [], 0);
  assert.equal(result.state, 'failed');
  assert.equal(result.failure, '创建分组');
  reconcile.tick(data, [], 30);
  assert.equal(calls, 1);
});

test('加入或命名失败均显示对应阶段', () => {
  for (const [name, extra, stage] of [['App', true, '加入项目'], ['New Group', false, '命名项目']]) {
    const state = { workspaces: workspaces(ws('a', '/Code/App', { group: 'G' }),
      ...(extra ? [ws('b', '/Code/App')] : [])), groups: [group('G', name, 'a')] };
    const sb = mount(state);
    sb.take();
    sb.setData({ ...state, now: 16 });
    assert.ok(sb.outline().some((s) => s.includes(stage) && s.includes('未完成')));
  }
});

test('挂起时工作区被关闭或切换目录，取消旧请求并按新状态规划', () => {
  const state = { workspaces: workspaces(ws('a', '/Code/App')) };
  const sb = mount(state);
  create(sb);
  sb.setData({ workspaces: [], now: 1 });
  assert.deepEqual(sb.take(), []);
  sb.setData({ workspaces: workspaces(ws('b', '/Code/Other')), now: 2 });
  assert.equal(create(sb)[0].params.name, 'Other');
});

test('没有目录、远程工作区均不按本机路径误归组', () => {
  const sb = mount({ workspaces: workspaces(ws('a', ''), ws('b', '/Code/App', { remote: { target: 'remote', connected: true } })) });
  assert.deepEqual(sb.take(), []);
});

test('不同路径但目录同名，保留独立项目并给标题消歧', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/One/App'), ws('b', '/Two/App')) });
  assert.equal(create(sb)[0].params.name, 'App · One');
});

test('侧栏空白区新建优先进入当前项目，而非顶层新建', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/Code/App', { group: 'G', selected: true })),
    groups: [group('G', 'App', 'a')] });
  sb.take();
  sb.doubleTapEmptyArea();
  assert.deepEqual(sb.take(), [{ method: 'workspace.group.new_workspace', params: { group_id: 'G' } }]);
});

test('当前项目尚在归组时，新建入口不会创建游离对话', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/Code/App', { selected: true })) });
  sb.take();
  sb.doubleTapEmptyArea();
  assert.deepEqual(sb.take(), []);
});

test('项目模式不再暴露会被自动归组撤销的手动分组入口', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/Code/App', { group: 'G', selected: true })),
    groups: [group('G', 'App', 'a')] });
  assert.ok(!sb.row('App').menuLabels().includes('Ungroup'));
  assert.ok(!sb.row('a').menuLabels().includes('Move to Group'));
  assert.ok(!sb.row('a').menuLabels().includes('New Group with This'));
});

test('跨项目拖动不能临时把对话放进错误项目', () => {
  const sb = mount({ workspaces: workspaces(ws('a', '/Code/App', { group: 'G' }), ws('b', '/Code/Other', { group: 'H' })),
    groups: [group('G', 'App', 'a'), group('H', 'Other', 'b')] });
  sb.take();
  sb.drop('b', 1);
  assert.deepEqual(sb.take(), []);
});
