<!--
状态: active
创建: 2026-10-01
最后更新: 2026-11-13
关联: src/aia-projects.js; docs/upstream.md
-->

# AIAgentCLI

AIAgentCLI 是一个面向 cmux 的项目式侧栏。它按本机工作目录组织工作区，同时保留每个项目下的终端、Agent 对话和运行状态。

本项目是 [s4ff0x/cmux-sidebar](https://github.com/s4ff0x/cmux-sidebar) 的独立 fork。基础行为来自 cmux 官方的
[`Examples/CustomSidebars/workspaces.js`](https://github.com/manaflow-ai/cmux/blob/main/Examples/CustomSidebars/workspaces.js)。

## 当前效果

- 同一本机目录下的工作区自动归入一个项目；只有一个工作区时也会归组。
- 项目标题显示项目名和分支信息，子项显示 Agent 名称、状态和单行任务摘要。
- 左侧项目栏使用放大的字号层级，项目名、Agent 名称、状态和摘要更易扫读。
- Agent 状态只保留两种：橙色圆点 `Running` 表示任务正在处理，绿色圆角方块 `Ready` 表示当前无任务处理。
- `Ready` 是稳定状态色，不会随时间、打开对话或侧栏重载消失；新一轮开始后切回 `Running`。
- `Active` 按钮只控制项目展开和收起：开启时展开包含 active 会话的项目，关闭时折叠这些项目。
- `Active` 不隐藏终端、闲置对话或已完成会话；重新展开项目后，原内容全部保留。
- 收藏筛选和右键收藏入口默认隐藏，底层收藏代码和设置开关仍保留。
- 保留嵌套分组、拖拽排序、标题颜色、批量关闭和侧栏使用说明。

## 自动归组规则

- 只使用当前窗口中的本机工作目录，不上传路径，也不读取对话正文。
- 路径只做词法标准化，不解析符号链接，不把子目录推断成仓库根目录。
- 远程工作区和无法识别目录的工作区不会按本机路径自动归组。
- 一次只发送一条归组命令，等待 cmux 数据确认后再继续。
- 15 秒未收到确认时显示失败阶段，不自动反复重发；用户可以显式点击“重试归组”。
- 失败状态只记录“创建分组、加入项目、命名项目”等阶段，不记录异常正文或会话内容。

## 安装

从当前仓库安装开发版：

```sh
git clone https://github.com/djejjd/AIAgentCLI.git
cd AIAgentCLI
./install.sh --dev
```

安装脚本会把 `src/aia-projects.js` 链接到：

```text
~/.config/cmux/sidebars/aia-projects.js
```

它安装为独立侧栏 `aia-projects`，不会覆盖已有的 `cmux-sidebar.js`。安装后可从 cmux 侧栏菜单选择
`aia-projects`。

要求 cmux 0.64.25 或更高版本，并启用自定义侧栏。

把 cmux 原生侧边栏的最小宽度提高到 260pt：

```sh
defaults write com.cmuxterm.app sidebarMinimumWidth -float 260
cmux reload-config
```

这个设置只限制左侧栏拖拽下限，不改变右侧终端或窗口宽度。

## 开发

```sh
npm test
npm run check
sh -n install.sh
cmux sidebar validate aia-projects
```

### Codex ESC 中断同步

Codex 原生支持 `Interrupt` hook。安装器会把中断事件转换为 cmux 的 Codex stop 事件，
让侧栏在用户按 ESC 取消回合后立即显示 `Ready`：

```sh
npm run install-codex-interrupt-hook
```

安装器会保留已有 Interrupt hook（例如 Orca），先备份 `~/.codex/hooks.json`，并写入稳定的
`~/.codex/hooks/aia-projects-codex-interrupt.sh`；重复执行不会产生重复项。

安装后首次启动新的 Codex 会话时会出现一次 `Hooks need review`，确认只有新增的
`aia-projects-codex-interrupt.sh` 为 new/changed 后，选择 `Trust all and continue`。
已运行中的旧会话不会重新加载 hook，需要新会话生效。

主要入口：

- 侧栏实现：`src/aia-projects.js`
- 测试 harness：`test/harness.js`
- 项目归组与 Active 行为测试：`test/aia-projects.test.js`
- 安装脚本：`install.sh`

## 来源与许可证

- 上游项目：<https://github.com/s4ff0x/cmux-sidebar>
- cmux 官方示例：<https://github.com/manaflow-ai/cmux/blob/main/Examples/CustomSidebars/workspaces.js>
- 许可证：GPL-3.0-or-later
- 上游和本地差异：`docs/upstream.md`

本仓库可以独立发布和维护，但代码仍属于上述 GPL 派生谱系。分发时需要保留原作者的版权、许可证和来源说明。
