# nb-agent-ui 包入口

本包位于 `packages/nb-agent-ui`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-agent-ui` 是 Agent 对话视图：消息流、过程时间线、工具详情、输入框，以及把 harness 的会话日志与事件合成视图消息的适配器。行为合同是 [`ui.agent-conversation-view`](../../docs/specs/ui/agent-conversation-view.md)；宿主怎么接入见 [README](README.md)。

## 边界

- 核心（`.` 入口，`src/` 下除 `vue/` 以外的文件）只依赖 `@notnotype/nb-ui/text`（文字值的纯数据层，没有外部依赖、不引 Vue），只许 `import type` 自 `vue`（注册表类型里有组件字段）。`src/boundary.test.ts` 读源码核对导入，新增文件同样受约束。
- Vue 渲染层（`./vue` 入口，`src/vue/`）只依赖 `vue`、`@notnotype/nb-ui` 与核心。不引用宿主的源码：Markdown 显示与提示词编辑器由宿主注入，接口形状在核心的 `ports.ts`。
- 工具卡片的字段对照工具的真实 schema，不臆造字段；按数据形状区分开放式与选项式提问。
- 样式写在组件的 scoped CSS 里、用 nb-ui 的 token，不用原子类。图标是 `i-lucide-*` 类名，宿主导入本包的 `tailwind.css` 才会生成；类名不能拼接（`src/icon-registration.test.ts`）。
- 界面文字在本包的消息目录里（`src/locales/`，`.ts` 模块，命名空间 `nb-agent-ui`，经 `./locales` 子路径导出）：核心只产出文字引用（`agentRef`），组件经注入的翻译端口取，没有注入时用缺省端口（README“没有宿主时”）。目录的值与源语言不在仓库的 JSON 目录检查里，由 `src/locales.test.ts` 核对。宿主与插件给的文字写中英两份。
- 视图不持有会话数据：消息、运行状态与草稿都由宿主经 `ctx` 给出，用户操作经 `action` 交回。
- `./vue` 入口只导出 `AgentConversationView`、`AgentSessionList`、`AgentSessionPanel`（切换会话的面板，新内核的宿主用）、`AgentModelCatalog`（模型目录对话框，宿主在设置里用）与内置登记：这四个是受管组件，`docs:check` 机检它们的标签。内部组件同样有同名 `.md`（组件规范：新建组件都要有）；要在 Lab 单独看的登记场景，经只给 Lab 的 `./lab` 入口挂载，其余写 `验证入口`。`./lab` 不是宿主接口，宿主代码不引用它。

## 验证

```text
bun run typecheck   # 核心 tsc，渲染层 vue-tsc
bun run test        # 核心 bun test，渲染层 Vitest（*.dom.test.ts，happy-dom）
```

真实浏览器里的布局、滚动与指针在应用 Component Lab 的 `nb-agent-ui` 场景与它的 Playwright 用例（`packages/neuro-book/e2e/lab-agent-ui.e2e.ts`）里。
