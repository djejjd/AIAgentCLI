<!--
状态: active
创建: 2026-11-13
最后更新: 2026-11-13
关联: README.md; src/aia-projects.js
-->

# AIAgentCLI 项目规则

## 稳定热更新

- 稳定源码 worktree：`/Users/lanser/Code/AIAgentCLI-main-hot`，只检出
  `origin/main`，不得切换到功能分支。
- 正式侧栏 `~/.config/cmux/sidebars/aia-projects.js` 由稳定源码和本地模型映射生成。
- 禁止创建分支专属热更新文件；PR 合并后立即更新同一个稳定 worktree 并切回
  `aia-projects`，不等用户再次提醒。
- 发布后稳定 worktree 的 `HEAD` 必须等于 `origin/main`；校验失败则保留上一版。

```sh
git -C /Users/lanser/Code/AIAgentCLI-main-hot fetch origin main
git -C /Users/lanser/Code/AIAgentCLI-main-hot checkout --detach origin/main
node /Users/lanser/Code/AIAgentCLI-main-hot/scripts/model-map.js \
  --source /Users/lanser/Code/AIAgentCLI-main-hot/src/aia-projects.js \
  --output ~/.config/cmux/sidebars/aia-projects.js
cmux sidebar validate aia-projects
cmux sidebar select aia-projects
cmux reload-config
```

## 临时验证

- 所有开发分支共用一个固定预览入口
  `~/.config/cmux/sidebars/aia-projects-preview.js`，只改指向，不增加文件名。
- 预览不得修改正式链接；验证结束必须切回 `aia-projects`。

```sh
node /path/to/dev-worktree/scripts/model-map.js \
  --source /path/to/dev-worktree/src/aia-projects.js \
  --output ~/.config/cmux/sidebars/aia-projects-preview.js
cmux sidebar validate aia-projects-preview
cmux sidebar select aia-projects-preview

# 验证结束后
cmux sidebar select aia-projects
```

## 开发要求

- 所有改动经独立分支和 PR 合入 `main`，不直接推送 `main`。
- 声明完成前必须运行 `npm test`、`npm run check` 和 `cmux sidebar validate aia-projects`。
- 不修改用户未提交改动；开发 worktree 的脏状态不得带入稳定热更新目录。
- 文档使用中文；代码、命令、字段和路径保留原文。
- 保留 GPL-3.0-or-later 许可证、上游版权和来源说明。
