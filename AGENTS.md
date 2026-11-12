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
- PR 合并完成后必须立即发布正式热更新；不得等到用户再次提醒或让 `main` 与活动侧栏长期不一致。
- 正式热更新发布完成后必须切回并选中 `aia-projects`，确认活动文件内容与最新 `origin/main` 一致。

同步命令：

```sh
git -C /Users/lanser/Code/AIAgentCLI-main-hot fetch origin main
git -C /Users/lanser/Code/AIAgentCLI-main-hot checkout --detach origin/main
cmux sidebar validate aia-projects
cmux reload-config
```

发布完成证据：

```sh
git -C /Users/lanser/Code/AIAgentCLI-main-hot rev-parse HEAD
git -C /Users/lanser/Code/AIAgentCLI-main-hot rev-parse origin/main
readlink ~/.config/cmux/sidebars/aia-projects.js
cmux sidebar validate aia-projects
```

前两个 commit 必须一致，活动链接必须指向
`/Users/lanser/Code/AIAgentCLI-main-hot/src/aia-projects.js`。校验失败时保留上一份可用热更新并报告失败，不得让未验证版本继续作为正式侧栏。

## 临时验证

临时验证允许使用开发分支，但不得修改稳定 `aia-projects.js` 链接。所有分支共用一个固定预览入口：

```text
~/.config/cmux/sidebars/aia-projects-preview.js
```

使用步骤：

```sh
ln -sfn /path/to/dev-worktree/src/aia-projects.js \
  ~/.config/cmux/sidebars/aia-projects-preview.js
cmux sidebar validate aia-projects-preview
cmux sidebar select aia-projects-preview
```

验证完成后切回稳定版本：

```sh
cmux sidebar select aia-projects
```

- 预览入口可以反复改指向不同开发 worktree，但文件名始终是 `aia-projects-preview.js`。
- 不得为每个分支创建新的预览文件名。
- 预览版本只用于临时验收，不能作为长期使用版本、发布来源或稳定热更新来源。
- 验证结束必须切回 `aia-projects`，确保日常使用始终来自稳定 `origin/main`。

## 开发要求

- 所有改动经独立分支和 PR 合入 `main`，不直接推送 `main`。
- 声明完成前必须运行 `npm test`、`npm run check` 和 `cmux sidebar validate aia-projects`。
- 不修改用户未提交改动；开发 worktree 的脏状态不得带入稳定热更新目录。
- 文档使用中文；代码、命令、字段和路径保留原文。
- 保留 GPL-3.0-or-later 许可证、上游版权和来源说明。
