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

Novel IDE 的主题由 **nb-ui 的两条轴**承担：**主题包**（形状 / 材质 / 排版 / 角色映射）与**配色**（颜色，按明暗分档）。产品只登记 `nbook` 与 `macos` 两套主题包，配色明暗由主题包自带的 `defaultColorway` 决定。老的自研 8 主题体系与自定义主题（`custom-*`）已整体下线，不留兼容层。

业务组件只消费 CSS 变量，不维护第二套颜色源。

## 事实源

- `packages/neuro-book/shared/theme/theme-axes.ts`
  - `productThemeIds`：`nbook | macos`，配置白名单。
  - `productAppearances`：`light | dark`。
  - `DEFAULT_PRODUCT_THEME_ID` / `DEFAULT_PRODUCT_APPEARANCE`：`nbook` + `light`。
- `packages/neuro-book/app/utils/theme/theme-packs.ts`
  - 装载 nbook / macos（顺序 = 设置里主题列表的顺序）；已装过则跳过，避免与 `/lab` 重复装载冲突。
- `packages/neuro-book/app/utils/theme/theme-session.ts`
  - 两轴会话（模块级单例）：`themeId` / `appearance` / `colorwayId` / `colorwayVars`。
  - 落地点是 `<html>`：`data-nb-theme`、`data-nb-appearance`、`style.colorScheme`，以及配色变量（`<html>` 与 `<body>` 各写一份）。
- `packages/neuro-book/app/utils/theme/host.ts`
  - `THEME_HOST_CLASS = "novel-ide-theme"`：页面根节点的宿主 class，浮层 Teleport 的落点；`ensureThemeHost()` 只补 class、不写变量。
- `packages/neuro-book/app/composables/useThemeSettings.ts`
  - 写入口：乐观应用 → 写 Global Config → 失败回滚并提示。
- nb-ui 侧
  - `src/theme/theme-loader.ts`：装载校验（含 `defaultColorway` 指向的配色必须存在）与 fallback 兜底层。
  - `src/tokens.css`：设计 token、主题层基线与「角色 → 配色变量」映射。
  - `themes/nbook`、`themes/macos`：`vars.css`（主题取值）+ 自带两套配色。

## 运行时流程

1. `/api/config/bootstrap` 返回 Global Config 中的 `ui.themeId` 与 `ui.appearance`。
2. `app/pages/index.vue` 调用 `useProductTheme().applyStoredAxes(...)`：白名单外的取值（老 id、`custom-*`、缺失字段）一律回落默认，**不做映射**。
3. 会话把两轴写到 `<html>`；配色变量来自当前主题包 `manifest.defaultColorway[appearance]` 指向的那套配色。
4. 切换走 `useThemeSettings().saveAxes({themeId?, appearance?})`：先本地应用，再静默保存 Global Config；失败时通知并回滚。
5. 模块首次求值就落一次默认值，配置读回之前界面也是完整主题。

登录页、Admin 用户页与 Profile Template Visual Editor 共用同一个会话单例（不再各自持有主题源）；它们与工作台一样，只需保证页面根节点带宿主 class。

## 存储契约

Global Config `ui` 字段：

```ts
type UiConfig = {
    themeId: "nbook" | "macos";
    appearance: "light" | "dark";
    costCurrency: "USD" | "CNY";
};
```

`ui.customThemes` 与老 `ui.theme` 已从 schema 删除：配置文件里残留的旧键在 normalizer 里被忽略，读到旧 id 时回落到 `nbook` + `light`。

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
- 四个组合（nbook / macos × light / dark）在 `<html>` 上的取值与主题包逐项一致，由 `app/utils/theme/theme-session.test.ts` 锁定。
- 常用命令：
  - `bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json`
  - `bun run --cwd packages/neuro-book test`
  - `bun run --cwd packages/nb-ui test`
  - DTO / config route 变化后再跑 `bun run generate:openapi`
