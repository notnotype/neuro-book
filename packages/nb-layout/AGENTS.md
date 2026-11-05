# nb-layout 包入口

本包位于 `packages/nb-layout`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-layout` 是工作台的布局工具，决策见 [ADR 0044](../../docs/adr/0044-workbench-single-layout-tree.md)，行为合同是 [`ui.nested-grid`](../../docs/specs/ui/nested-grid.md) 与 [`ui.layout-drag`](../../docs/specs/ui/layout-drag.md)。

## 边界

- 核心（`.` 入口，`src/` 下除 `vue/` 以外的文件）不依赖任何包，不依赖 Vue 与 DOM：插件激活时就要建模型，Bun 里也要能测。`src/boundary.test.ts` 读源码核对导入，新增文件同样受约束。
- Vue 层（`./vue` 入口，`src/vue/`）只依赖 `vue`、`@notnotype/nb-ui` 与核心。样式写在组件的 scoped CSS 里、用 nb-ui 的 token，不用原子类：宿主的 Tailwind 不扫描本包，用了宿主也不会生成。
- nb-ui 不依赖本包，也不重导出本包：本包的 Vue 层依赖 nb-ui，重导出会循环依赖。
- 入口导出的组件是受管组件，同名 `.md` 必有（`docs:check`）；内部组件写模块头注释。

## 与 nb-ui 里那份的关系

nb-ui 暂留一份冻结的 Splitter 与分隔线核心，只给 nb-story、dev-panel 用，只修不加，w00026 t14 迁移后删除。改这里的 Splitter 不用同步那一份。

## 验证

```text
bun run typecheck   # 核心 tsc，Vue 层 vue-tsc
bun run test        # 核心 bun test，Vue 层 Vitest（*.dom.test.ts，happy-dom）
```

真实浏览器里的指针、布局与可访问名称在应用 Component Lab 的场景与它的 Playwright 用例里。
