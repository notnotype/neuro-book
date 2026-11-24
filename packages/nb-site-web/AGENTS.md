# nb-site-web 包入口

本包位于 `packages/nb-site-web`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-web` 是官方站的前端（[官方站重写](../../docs/proposals/official-site-rewrite.md)）：Vue 3、Vite、Tailwind 与 nb-ui。界面工作先读根入口“动手前读什么”里前端那一行列出的文档。

## 边界

- 只经两个合同包认识后端的接口，按白名单检查（`tests/boundary.test.ts`）：`src/` 里的源码与样式只许导入 nb-ui、两个合同包与第三方包，不许别的工作区包与 `bun:`、`node:` 内置模块（前端代码跑在浏览器里）；`tests/` 与 `vite.config.ts` 另许 `bun:`、`node:` 与测试支持包。清单里的工作区包：`dependencies` 只有 nb-ui 与两个合同包，`devDependencies` 只有测试支持包。要放开一项，先在这里写明理由，再改检查。

## 完成门禁

```text
bun run typecheck
bun test
bun run build
```

`tests/build.test.ts` 在临时目录里真跑一次 `vite build`；`bun run build` 把产物写进 `dist/`（不入库），`bun run --cwd packages/nb-site-web preview` 起 Vite 的预览服务看页面（地址在它的输出里）。
