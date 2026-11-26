# nb-page-agent

让 Agent 看懂并引导一个网页：文字快照与引用、定位、截图、高亮与说明框。只管一个页面里的事；页面是哪个应用、窗口怎样选、模型怎样调用都归宿主。NeuroBook 里的宿主是内置插件 `nbook.page-agent`，以后浏览器插件（w00034）把它注入外部网页。

- **Owner**：w00033（Agent 操作 NeuroBook 界面）。行为合同：[`docs/specs/agent/page-agent.md`](../../docs/specs/agent/page-agent.md)。
- **Interface**：
  - `.`：`createPageAgent({document?, refPrefix?})`，一个页面加载建一个，交回 `snapshot(args)`、`locate(locator, {mutating?, settle?})`、`describe(element)`。只在浏览器里用。
  - `./api`：定位、快照的参数与返回的 TypeBox schema，页面里的失败码（`stale-ref`、`ambiguous`、`not-found`）与大小上限。不碰 DOM，宿主在服务端拿它生成工具参数与文档。
  - `./attrs`：`nbTarget(name, key?)`，控件的拥有者用它写稳定名（`data-nb-target`、`data-nb-key`）。不碰 DOM，前后端都能引用。
  - 高亮与说明框、截图入口随 w00033 t03 第 8 片加入。
- **依赖方向**：不依赖应用包、`nb-runtime` 与 Vue；宿主经参数给界面文字、主题变量、悬停显示钩子与截图实现。
- **验证命令**：在本目录 `bun run typecheck`、`bun test`（纯函数）与 `bun run test:e2e`（真实 Chrome 里的夹具页；先把引擎打成 IIFE 包）。耗时测量：`NB_PAGE_AGENT_PERF=1 bun run test:e2e -- perf`。
