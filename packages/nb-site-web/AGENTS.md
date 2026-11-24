# nb-site-web 包入口

本包位于 `packages/nb-site-web`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-web` 是官方站的前端（[官方站重写](../../docs/proposals/official-site-rewrite.md)）：Vue 3、Vite、Tailwind 与 nb-ui。界面工作先读根入口“动手前读什么”里前端那一行列出的文档。

## 边界

- 只经两个合同包认识后端的接口：清单与源码都不许出现两个模块包与 `nb-site-server`，由 `tests/boundary.test.ts` 检查。

## 完成门禁

```text
bun run typecheck
bun test
bun run build
```

`tests/build.test.ts` 在临时目录里真跑一次 `vite build`；`bun run build` 把产物写进 `dist/`（不入库），`vite preview` 看页面。
