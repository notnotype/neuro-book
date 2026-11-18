# nb-workbench-layout 包入口

本包位于 `packages/nb-workbench-layout`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-workbench-layout` 是工作台的布局层：布局文档、它到 nb-layout 布局树的投影、落点规则，以及标签条。w00026 t33 从 nb-layout 拆出，决策见 [ADR 0054](../../docs/adr/0054-nb-layout-general-library.md)；行为合同是 [`ui/workbench-layout`](../../docs/specs/ui/workbench-layout.md)。本包 `private`、不发布，许可证同仓库（AGPL）。

## 边界

- **放哪个包**：导出的标识符、数据属性或类型名里有工作台概念（活动栏、状态栏、区域、容器、编辑组、具名面板）的，放本包；与这些无关的布局原语放 nb-layout。注释与测试里的场景描述不算。
- **只经公开入口用 nb-layout**：`@notnotype/nb-layout` 与 `@notnotype/nb-layout/vue`，不用相对路径深入它的源码。nb-layout 不依赖本包。
- **核心**（`.` 入口，`src/` 下除 `vue/` 以外的文件）只导入 nb-layout 的核心入口，不依赖 Vue 与 DOM：服务端经应用的 `workbench/shared/` 也导入它。
- **Vue 层**（`./vue` 入口，`src/vue/`）再加 `vue`、nb-ui（含子路径）与 nb-layout 的 `/vue`。样式写在组件的 scoped CSS 里、用 nb-ui 的 token，不用原子类：宿主的 Tailwind 不扫描本包。
- 规则由 `src/boundary.test.ts` 读源码核对，新增文件同样受约束。
- 入口导出的组件是受管组件，同名 `.md` 必有（`docs:check`）。

## 验证

```text
bun run typecheck   # 核心 tsc，Vue 层 vue-tsc
bun run test        # 核心 bun test，Vue 层 Vitest（*.dom.test.ts，happy-dom）
```

真实浏览器里的拖放、标签条与工作台布局在应用的 e2e 里（`workbench-*.e2e.ts`、`lab-tab-strip.e2e.ts`、`lab-drop-sectors.e2e.ts`）。
