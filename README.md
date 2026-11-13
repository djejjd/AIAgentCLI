<!--
状态: active
创建: 2026-10-01
最后更新: 2026-11-13
关联: src/aia-projects.js; docs/upstream.md
-->

# AIAgentCLI

一个面向 cmux 的项目式侧栏：按本机目录整理项目，单行显示会话厂商、自定义名称或固定编号以及任务状态。

```text
Project · main
  ✧ OpenAI · A1B2C3    ▪ Ready
  ≋ DeepSeek · D4E5F6  • Running
```

示例只说明信息层级，不包含个人会话或路径。

## 主要效果

- **按目录归组**：同一目录下的工作区自动放入同一个项目。
- **厂商单行显示**：不展示具体模型和上一轮输入；多代理工作区按聚焦代理显示厂商并保留数量。
- **统一图标风格**：使用简洁的灰色线性图标，不采用品牌彩色 Logo。
- **未知厂商兜底**：无法确认时显示“未知厂商”和问号图标，不根据工具名猜测。
- **任务状态清晰**：5pt 橙点表示 `Running`，绿色圆角方块表示 `Ready`。
- **自定义名称**：双击或右键 Rename 改名，原生标题保存，重载后保留。
- **保留完整会话**：`Active` 只展开或折叠项目，不会隐藏终端和闲置对话。
- **完整项目操作**：支持嵌套分组、拖拽排序、标题颜色和批量关闭。

## 安装

要求：

- macOS
- Node.js 20+
- cmux 0.64.25 或更高版本
- 已启用 cmux 自定义侧栏

从源码安装（从可访问本机 cmux 的终端执行）：

```sh
git clone https://github.com/djejjd/AIAgentCLI.git
cd AIAgentCLI
./install.sh --dev
```

安装器会备份、生成本机映射、校验并热加载 `aia-projects`，无需重启。

正式版发布后也可使用 Release 安装器：

```sh
curl -fsSL https://github.com/djejjd/AIAgentCLI/releases/latest/download/install.sh | sh
```

### 更新

```sh
git pull
./install.sh --dev
```

### 可选：扩大侧边栏最小宽度

```sh
defaults write com.cmuxterm.app sidebarMinimumWidth -float 260
cmux reload-config
```

## 厂商图标

| 厂商 | 图标风格 |
|---|---|
| DeepSeek | 水波纹 |
| OpenAI | 星芒 |
| Anthropic | 太阳 |
| Google | 菱形 |
| 其他或未知 | 问号 |

## 来源

本项目基于 [s4ff0x/cmux-sidebar](https://github.com/s4ff0x/cmux-sidebar) 衍生，上游基础来自 cmux 官方示例。

许可证：GPL-3.0-or-later。

## 本机厂商刷新与热更新

```sh
npm run models
cmux sidebar reload aia-projects
cmux sidebar select aia-projects
```

默认 GPT 会话从结构化模型元数据识别；只保留厂商及显式名称，不提取输入或工具正文。
公开附件保持空映射，个人映射只在安装端生成。映射不是后台实时探测，切换厂商后可再次刷新。
会话双击或右键 Rename 可改名；六位编号与工作区身份绑定，不随排序变化，但不保证全局唯一。
项目加号菜单首项始终为空白终端，最近使用的启动预设在当前侧栏运行期间前移。

## 正式发布

发布说明见 [v0.8.0](docs/releases/v0.8.0.md)。所有代码先经分支及 PR 合入 main；
单独确认标签后才推送 `v0.8.0`，workflow 检查标签版本与公开构建并发布正式附件。
更新后按 AGENTS.md 从同一个稳定源码 worktree 生成 `aia-projects`，无需重启 cmux。

正式下载会先验证附件 SHA256，再执行本机生成器；安装事务使用同一文件锁，
校验/激活失败按文件归属回滚，保留校验期间发生的并发更新。

## 开发验证

```sh
npm run build
npm test
npm run check
sh -n install.sh
```

视图与独立逻辑分别位于 `src/project-sidebar.js`、`src/auto-projects.js`、`src/conversations.js`；
构建生成公开的 `src/aia-projects.js`。不要将本机注入后的安装文件提交到仓库。
