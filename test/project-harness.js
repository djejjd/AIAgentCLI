// 新项目视图的测试入口，保留上游兼容视图的默认测试源。
import { mountSidebar as mountBase } from './harness.js';
export { agent, group, workspaces } from './harness.js';
export const mountSidebar = (state, settings = {}) => mountBase(state,
  { projectGroups: false, autoProjectGroups: false, ...settings },
  { sourcePath: new URL('../src/aia-projects.js', import.meta.url) });
