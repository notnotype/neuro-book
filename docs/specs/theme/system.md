---
schema: nbook.spec/v1
kind: architecture
status: implemented
capability: theme.system
owners:
  - ui
---

# 主题系统参考

## 概述

NeuroBook 的主题由 **nb-ui 的两条轴**承担：**主题包**（形状 / 材质 / 排版 / 角色映射）与**配色**（颜色，按明暗分档）。产品只装 `nbook` 与 `macos` 两套主题包，配色取主题包自带的 `defaultColorway[明暗]`。老的自研 8 主题体系与自定义主题（`custom-*`）已整体下线，不留兼容层。

业务组件只消费 CSS 变量，不维护第二套颜色源。

新应用（`packages/neuro-book`）的事实源与运行时流程见下两节（planned）；旧应用（`packages/neuro-book-legacy`）的做法见其源码，只作参照。

## 事实源

- 配置项（[`settings.configuration`](../settings/configuration.md)），工作台在描述里声明，定义在 `src/plugins/workbench/shared/contracts.ts`：
  - `nbook.workbench/theme`：`"nbook" | "macos"`，默认 `"nbook"`；
  - `nbook.workbench/appearance`：`"light" | "dark" | "system"`，默认 `"light"`；
  - 两项都允许用户层与项目层。
- `src/ui/theme/`：装载两套主题包（已装过则跳过，与 `/lab` 共存）与无状态的应用、清除函数：把主题包、明暗与配色写到文档根（`<html>` 的 `data-nb-theme`、`data-nb-appearance`、`style.colorScheme` 与配色变量），清除时去掉它们。Lab 与工作台共用，偏好与状态各管各的。
- nb-ui 侧
  - `src/theme/theme-loader.ts`：装载校验（含 `defaultColorway` 指向的配色必须存在）与 fallback 兜底层。
  - `src/tokens.css`：设计 token、主题层基线与「角色 → 配色变量」映射。
  - `themes/nbook`、`themes/macos`：`vars.css`（主题取值）+ 自带两套配色。

## 运行时流程

1. 工作台渲染的页面挂载时，按配置的两项求出主题包、明暗与配色，写到文档根；`appearance` 为 `system` 时读 `prefers-color-scheme` 的当前值并监听变化，只改文档的明暗与配色，不改写配置。
2. 配置变化（命令、另一个窗口、外部改文件）时重新应用；页面卸载时停止应用与监听。应用不放在一直存活的插件激活作用域里。
3. 产品页面（首页与工作台根）的背景、文字颜色与字体消费 nb-ui 的 token，切换主题后看得见变化；宿主的启动与失败页保留自己的样式。
4. Lab（`/lab`）是离开时整页加载的独立页面，自己管文档根与偏好，不读产品配置（[`ui.component-lab`](../ui/component-lab.md)）；离开 Lab 后整页加载，工作台按最新配置重新应用。
5. 切换走命令 `nbook.settings.switch-theme`、`nbook.settings.switch-appearance`（[`workbench.commands`](../workbench/commands.md)），写入目标为 `auto`：项目层已覆盖主题时写项目层，否则写用户层。

## 变量体系

分三层，取值来源各不相同：

1. **配色变量**（随配色变化）：33 个键，契约在 nb-ui `src/colorway/colorway-contract.ts`，由主题包自带的配色给出具体值。
2. **角色变量**（主题决策）：`--panel-surface` / `--control-surface` / `--overlay-surface` / `--divider` / `--elevation-*` 等，映射写在 nb-ui `src/tokens.css`，主题可在自己的 `vars.css` 里改判。
3. **主题新增角色**：`--page-surface`（稿面）等由主题包 `manifest.declares` 声明，fallback 兜底层保证「别的主题激活时也成立」。

老体系 6 个领域专用变量的映射（唯一映射表，不允许在组件里另起名字）：

| 老变量 | 现变量 |
| --- | --- |
| `--editor-bg` | `--page-surface` |
| `--source-bg` | `--panel-surface` |
| `--source-text` | `--text-main` |
| `--source-muted` | `--text-muted` |
| `--toolbar-bg` | `--toolbar-surface` |
| `--chat-ai-bg` | `--bg-subtle` |

## 消费规则

- 业务 UI 必须使用 `bg-[var(--...)]`、`text-[var(--...)]`、`border-[var(--...)]` 或 CSS 中的 `var(--...)`。
- 禁止新增 Tailwind 调色板类和 `dark:` 变体。
- 禁止直接写固定 hex / rgba 作为业务颜色；测试、外部资产预览和分类色板定义除外。
- 阴影使用 `--shadow-color` 或 `--elevation-*`，文本选区使用 `--selection-bg`。
- Monaco 主题按会话的 `appearance` 选择 light/dark 基底，颜色从宿主计算样式读色彩角色（不读 `color-mix(...)` 表达式）。

## 状态语义

- `warning`：草稿、待审、未保存、诊断、占位。
- `success`：完成、已同步、已解决、检查通过。
- `danger`：错误、删除、冲突、不可恢复失败。
- `info`：运行中、引用、pending 信息、普通说明。
- `accent`：选中、当前项、主线强调、主操作。

Amber 的历史用法要按角色拆分：警示徽标走 `warning`，选中/主线强调走 `accent`。

## World Engine 别名层

World Engine 的 `--we-*` 仍是别名层，当前只允许修改其指向，不删除别名。唯一映射源是 `app/styles/theme-vars.css` 中的 `.world-engine-workbench-theme`；真实 `WorldEngineWorkbenchDialog.vue` 必须挂这个 class。

禁止在独立调试面或正式工作台重新写浅绿 `--we-*` 硬编码，也禁止用 `--bg-main: var(--we-bg-canvas)` 这类反向覆盖把局部别名写回全局主题变量。

## 例外

Plot / Workspace / Reference chip 分类色板是类别识别色，不迁移为主题状态色。当前明确保留：

- `plot-thread-panel.types.ts`
- `plot-tree.types.ts`
- `plot-preview.types.ts`
- `workspace-entry-meta.ts`
- `app/styles/reference-chips.css`

分类色用于正文或列表叠底时，应低透明或与 `--bg-panel` / `--bg-main` 混合，不得扩散到通用组件。

Reference chip 的外观只由 `app/styles/reference-chips.css` 管理，组件只输出 `is-chapter`、`is-character` 等语义 class。Profile template 节点类型 accent、Markdown 正文颜色选择器、JsonViewer / Monaco 语法高亮和备用 Markdown 内容主题属于内容或第三方编辑器色板，不进入配色契约；只要求其周边普通 UI 使用主题状态色、文本色和阴影变量。

NotificationViewport 挂在页面根节点之外，但配色变量写在 `<html>` 上，所以它直接消费 nb-ui 的配色变量（不再需要 JS 侧混色快照）。

## 验证

- 变量新增、删除、重命名时同步 nb-ui 侧契约（`colorway-contract.ts` / `tokens.css`）与主题包，本参考只记映射与规则。
- 四个组合（nbook / macos × light / dark）写到文档根的取值与主题包逐项一致，`system` 跟随系统明暗，由 `src/ui/theme/` 的组件测试锁定；产品页面随配置换主题、Lab 显示期间不被改写，由 `e2e/settings.e2e.ts` 验证（planned）。
- 常用命令：
  - `bun run --cwd packages/neuro-book typecheck`
  - `bun run --cwd packages/neuro-book test`
  - `bun run --cwd packages/nb-ui test`
