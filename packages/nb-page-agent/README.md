# nb-page-agent

让 Agent 看懂并引导一个网页：文字快照与引用、定位、截图、高亮与说明框。只管一个页面里的事；页面是哪个应用、窗口怎样选、模型怎样调用都归宿主。NeuroBook 里的宿主是内置插件 `nbook.page-agent`，以后浏览器插件（w00034）把它注入外部网页。

- **Owner**：w00033（Agent 操作 NeuroBook 界面）。行为合同：[`docs/specs/agent/page-agent.md`](../../docs/specs/agent/page-agent.md)。
- **Interface**：
  - `./attrs`：`nbTarget(name, key?)`，控件的拥有者用它写稳定名（`data-nb-target`、`data-nb-key`）。不碰 DOM，前后端都能引用。
  - 引擎（快照、定位、高亮）、参数与返回的 schema、截图随 w00033 t03 第 5、8 片加入。
- **依赖方向**：不依赖应用包、`nb-runtime` 与 Vue；宿主经参数给稳定名映射、界面文字、主题变量与截图实现。
- **验证命令**：在本目录 `bun run typecheck` 与 `bun test`。
