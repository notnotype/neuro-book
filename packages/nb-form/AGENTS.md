# nb-form 包入口

本包位于 `packages/nb-form`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-form` 按数据 schema 画表单，行为合同是 [`ui.forms`](../../docs/specs/ui/forms.md)。设置、nbdev 的提问、Agent 的提问与审批、命令参数都用它。

## 边界

- 核心（`.` 入口，`src/` 下除 `vue/` 以外的文件）只依赖 `typebox`，另外只许 `import type` 自 `@notnotype/nb-ui/text`（文字值的类型）：不依赖 Vue、DOM、i18next、应用包与宿主的服务。`src/boundary.test.ts` 读源码核对导入，新增文件同样受约束。
- Vue 渲染层（`./vue` 入口，`src/vue/`）只依赖 `vue`、`@notnotype/nb-ui` 与核心，以便以后打进生成式视图的沙箱。同一个测试也核对它的导入。样式写在组件的 scoped CSS 里、用 nb-ui 的 token，不用原子类：宿主编译出的原子类（应用的 Tailwind）在沙箱里没有。
- `@notnotype/nb-ui`、`vue`、`typescript` 是可选的 peer 依赖（`peerDependenciesMeta`），只给 Vue 渲染层用：只用核心的消费者（nb-harness，经它还有 nb-story）不会装上它们。给核心新增的依赖写进 `dependencies`，不能放进可选 peer。
- 入口导出的组件是受管组件，同名 `.md` 必有（`docs:check`）；内部组件写模块头注释。
- 表单不持有数据：值、问题、选项与带外状态都由调用方给出；核心不调用调用方的函数。
- 描述可能来自模型：处理描述的函数（`checkDescription`、`resolveForm`、`validateForm`）不因描述写坏而抛异常。

## 验证

```text
bun run typecheck   # 核心 tsc，渲染层 vue-tsc
bun run test        # 核心 bun test，渲染层 Vitest（*.dom.test.ts，happy-dom）
```

真实浏览器里的布局、指针与可访问名称在应用 Component Lab 的 `nb-form` 场景与它的 Playwright 用例里。
