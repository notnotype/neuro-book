# nb-layout 包入口

本包位于 `packages/nb-layout`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-layout` 是布局工具：布局树、尺寸求解、落点与拖动。决策见 [ADR 0044](../../docs/adr/0044-workbench-single-layout-tree.md) 与 [ADR 0054](../../docs/adr/0054-nb-layout-general-library.md)（做成不认识工作台的通用库，发布之前 `private`），行为合同是 [`ui.nested-grid`](../../docs/specs/ui/nested-grid.md) 与 [`ui.layout-drag`](../../docs/specs/ui/layout-drag.md)。

## 边界

- 导出的标识符、数据属性与类型名里不出现工作台概念（活动栏、状态栏、区域、容器、编辑组、具名面板）；有这些概念的放 [`nb-workbench-layout`](../nb-workbench-layout/AGENTS.md)，它只经本包的公开入口用本包，本包不依赖它。

- 核心（`.` 入口，`src/` 下除 `vue/` 以外的文件）不依赖任何包，不依赖 Vue 与 DOM：插件激活时就要建模型，Bun 里也要能测。`src/boundary.test.ts` 读源码核对导入，新增文件同样受约束。
- Vue 层（`./vue` 入口，`src/vue/`）只依赖 `vue`、`tabbable` 与核心，不依赖 nb-ui（ADR 0054 第 3 条）。文字经 `./text` 的注入点（`src/vue/text.ts`）取。
- 样式写在组件的 scoped CSS 里，不用原子类：宿主的 Tailwind 不扫描本包，用了宿主也不会生成。只读 `--nb-layout-*`，每处带回退；名字、类别与回退登记在 `src/theme-vars.ts`，`theme-vars.test.ts` 扫源码核对，新变量先登记再用。装了 nb-ui 的宿主由它的 `tokens.css` 桥接主题旧名，桥接要跟着清单改（应用的 `theme-bridge.test.ts` 核对）。
- 例外：`src/vue/global.css` 是全局样式，只放必须作用在根上或跨组件的两样（减少动效时归零时长、焦点环类），由 `vue/index.ts` 导入；别的样式不往里放。根上平时不声明变量：不分层的声明会压过 nb-ui 放在 `layer(base)` 里的桥接。
- nb-ui 不依赖本包，也不重导出本包。
- 入口导出的组件是受管组件，同名 `.md` 必有（`docs:check`）；内部组件写模块头注释。入口加了或删了组件，插件 SDK 的组件清单要跟着改，做法同 nb-ui（[`packages/nb-ui/AGENTS.md`](../nb-ui/AGENTS.md)）。

## 与 nb-ui 里那份的关系

nb-ui 暂留一份冻结的 Splitter 与分隔线核心，只给 nb-story、dev-panel 用，只修不加，w00026 t14 迁移后删除。改这里的 Splitter 不用同步那一份。

## 验证

```text
bun run typecheck   # 核心 tsc，Vue 层 vue-tsc
bun run test        # 核心 bun test，Vue 层 Vitest（*.dom.test.ts，happy-dom）
```

真实浏览器里的指针、布局与可访问名称在应用 Component Lab 的场景与它的 Playwright 用例里。
