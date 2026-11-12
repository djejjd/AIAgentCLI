<!--
状态: active
创建: 2026-11-13
最后更新: 2026-11-13
关联: README.md; src/aia-projects.js
-->

# AIAgentCLI 项目规则

## 稳定热更新

cmux 当前使用的侧栏只能指向稳定 main 热更新目录：

```text
~/.config/cmux/sidebars/aia-projects.js
→ /Users/lanser/Code/AIAgentCLI-main-hot/src/aia-projects.js
```

- `/Users/lanser/Code/AIAgentCLI-main-hot` 只检出 `origin/main`，不得切换到功能分支。
- 功能开发和缺陷修复在其他独立分支或 worktree 中进行，不得把活动侧栏链接直接指向开发分支。
- 禁止为每个功能、修复或实验创建单独的 `aia-projects-*.js` 热更新文件。
- 功能分支合并到 `main` 后，统一同步同一个稳定目录并重新校验，不新增热更新版本。

同步命令：

```sh
git -C /Users/lanser/Code/AIAgentCLI-main-hot fetch origin main
git -C /Users/lanser/Code/AIAgentCLI-main-hot checkout --detach origin/main
cmux sidebar validate aia-projects
cmux reload-config
```

## 开发要求

- 所有改动经独立分支和 PR 合入 `main`，不直接推送 `main`。
- 声明完成前必须运行 `npm test`、`npm run check` 和 `cmux sidebar validate aia-projects`。
- 不修改用户未提交改动；开发 worktree 的脏状态不得带入稳定热更新目录。
- 文档使用中文；代码、命令、字段和路径保留原文。
- 保留 GPL-3.0-or-later 许可证、上游版权和来源说明。
