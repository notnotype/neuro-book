# nb-page-agent 包入口

本包位于 `packages/nb-page-agent`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则；职责与接口见 [`README.md`](README.md)。

## 边界

- 与应用无关：源码不写 NeuroBook 的标记、命令与插件 id，不导入应用包。只认 Spec 公开的属性（`data-nb-target`、`data-nb-key`、`data-nb-agent`）与自己的节点（`data-nb-page-agent`）。
- `./attrs` 不碰 DOM、没有依赖；`./api` 不碰 DOM，只依赖 TypeBox。
- 判断看不看得见、在哪一层的规则只写在 `src/snapshot/walk.ts` 的 `enter` 里：快照的遍历与按引用核对身份都走它，两边才不会对同一个元素得出不同的层。

## 测试

- 布局、命中检查、shadow root 与 `popover` 只有真实浏览器才对：规则测试写在 `e2e/` 的夹具页里（真实 Chrome），不用 happy-dom；`src/` 的 bun 测试只测纯函数。
- 测试源码里要用双向控制字符、行分隔符这类字符时，用 `String.fromCharCode` 在运行时拼，不直接写进字符串字面量。

## 完成门禁

`bun run typecheck`、`bun test` 与 `bun run test:e2e` 在本包目录通过。
