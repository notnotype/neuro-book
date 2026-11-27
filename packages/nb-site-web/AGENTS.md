# nb-site-web 包入口

本包位于 `packages/nb-site-web`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-web` 是官方站的前端（[官方站重写](../../docs/proposals/official-site-rewrite.md)）：Vue 3、Vite、Tailwind 与 nb-ui。界面工作先读根入口“动手前读什么”里前端那一行列出的文档。

## 边界

- 只经两个合同包认识后端的接口，按白名单检查（`tests/boundary.test.ts`）：`src/` 里的源码与样式只许导入 nb-ui、两个合同包与第三方包，不许别的工作区包与 `bun:`、`node:` 内置模块（前端代码跑在浏览器里）；两个合同包都只许从各自的 `./constants` 子路径导入（`@notnotype/nb-site-identity-contract/constants`、`@notnotype/nb-site-telemetry-contract/constants`；整包入口带着全部 schema 与 TypeBox 的运行时，会打进访客的入口块或看板块），要的常量不在那里时先在合同包里挪（见各自的 `AGENTS.md`）；ECharts（与 ZRender）只许 `src/pages/admin/dashboard/charts/echarts.ts` 在运行时导入，别处只许 `import type`：按需导入的清单只在那一个文件里，别处一条整包导入就多出约 200 KB（gzip），要用新的图或组件时在那里加；Markdown 库 `marked`（开发依赖）浏览器代码不许导入，只由构建插件 `build/legal-docs.ts` 用；`tests/`、`e2e/`、`build/` 与 `vite.config.ts`、`vitest.config.ts` 另许 `bun:`、`node:` 与测试支持包。清单里的工作区包：`dependencies` 只有 nb-ui 与两个合同包，`devDependencies` 只有测试支持包。要放开一项，先在这里写明理由，再改检查。

## 条款正文与发布构建

- 隐私政策与服务条款的正文是 `src/legal/<语言>/privacy.md`、`terms.md`，构建时由 `build/legal-docs.ts`（Vite 插件）转成 HTML，随各自那一页的块下载。头部的 front matter 写 `version: YYYY-MM-DD`（两份共用一个版本，上线时等于服务端的 `NB_SITE_IDENTITY_TERMS_VERSION`）与 `placeholder: true`（文字还是占位；定稿后删掉这一行）。正文的标题从 `##` 起，一级标题由页面画。
- 部署用的构建要设 `NB_SITE_RELEASE=1`（例如 `NB_SITE_RELEASE=1 bun run --cwd packages/nb-site-server build:image`，它把环境传给前端的构建）：发布构建遇到占位正文就失败，报出是哪几份文件。不设时照常构建、页面显示占位正文（浏览器场景与 CI 的镜像构建都是这样）。这个变量只认 `1`，写成别的值构建直接报错。两份正文的版本不一致时，不论发不发布，构建都失败。

## 测试

- `tests/` 下是纯逻辑与构建的测试，由 `bun test` 跑：分派与守卫、接口层的核心、当前账号、失败码的文案覆盖、依赖边界、构建。
- `src/` 下的 `*.dom.test.ts` 是要浏览器接口的测试（组件、`sessionStorage`、主题写到根元素、装起来的站点），由 `vitest` 在 happy-dom 里跑（`vitest.config.ts`）；包内 `bunfig.toml` 让 `bun test` 跳过它们。
- 包脚本 `bun run test` 两样都跑；`bun run test:affected --package nb-site-web` 走的也是它。
- `e2e/` 下的 `*.e2e.ts` 是浏览器场景（Playwright，用本机 Chrome）：`bun run test:e2e` 先 `vite build`，再起 Vite 的预览服务（端口默认 4360，被占时设 `NB_SITE_WEB_E2E_PORT`），由 `e2e/fake-api.ts` 截下 `/api/` 的请求按合同的形状回答，数据在 `e2e/fixtures/`（`tests/e2e-fixtures.test.ts` 用合同的 schema 检查每份）。只量 happy-dom 量不了的：真实布局、溢出、格线对齐、颜色与对比度、主路径。不进 `bun run test`。

## 完成门禁

```text
bun run typecheck
bun run test
bun run build
```

`tests/build.test.ts` 在临时目录里真跑一次 `vite build`（按 `NODE_ENV=production`），在输出里记下入口块与看板块的 gzip 大小，两者都有上限，入口块还不许带账号页才用的对话框与菜单（nb-ui 没声明 `sideEffects`，`vite.config.ts` 替它声明，见那里的注释）；ECharts 要在看板自己的块里、别的块里没有，哪个块都不许带 TypeBox（前端只从两个合同包的 `./constants` 导入）；条款两页各是懒加载的块、哪个块都不带 `marked`，另起一次 `NB_SITE_RELEASE=1` 的构建核对占位正文被拒；`bun run build` 把产物写进 `dist/`（不入库），`bun run --cwd packages/nb-site-web preview` 起 Vite 的预览服务看页面（地址在它的输出里）。
