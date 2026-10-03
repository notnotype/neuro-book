---
schema: nbook.task/v2
taskId: t47-web-host-dev-supervisor
---

# NeuroBook v2 第 3 步（下）：开发监督进程、Vite 前端、浏览器宿主与静态资源

## 目标与范围

按 [NeuroBook v2：并排重建应用](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 方案第 3、4、6 节，补齐应用骨架的另一半：`bun run dev` 与生产启动打开的都是空工作台。后端宿主见 [t46](../t46-server-host/README.md)。开发者 2026-10-03 决定：主 Agent 编码，omp（默认模型）审查。

行为合同：[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md)、[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md) 的开发模式一节、[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md) 的浏览器出口。旧实现（`packages/neuro-book-legacy/app/runtime/`、`shared/browser-bootstrap.ts`、`app/features/runtime-diagnostics/console-exporter.ts`、`scripts/cli/source-dev.ts`）只作参照。

**做什么**

- **引导接口与静态资源**：宿主自有接口 `GET /api/runtime/browser-bootstrap`（TypeBox 合同在 `src/shared/`）；`nbook.http` 在设置 `NBOOK_WEB_ROOT` 时提供前端构建产物，未匹配的页面路径回退到 `index.html`。
- **前端宿主**（`src/web/`）：Vite + Vue 入口在挂载根组件前建立窗口运行实例；引导失败显示带重试的连接失败页，协议不兼容与启动失败提示刷新；`nbook.workbench` 先只有提供空工作台的浏览器入口；`nbook.diagnostics` 增加浏览器的 console 出口。
- **开发监督进程**（`src/server/dev/`）：一条命令启动 Vite 与后端子进程；后端文件变化时经标准输入有序重启，新进程启动失败时等待下一次改动；SIGINT、SIGTERM 时先停后端、再停 Vite。
- **构建**：`build:web`（`vite build`）、`build`、`start`；真实浏览器 e2e（`test:e2e`）。

**实现决定**

1. **开发默认状态根**（开发者 2026-10-03 决定）：未设置 `NBOOK_STATE_ROOT` 时用 `packages/neuro-book/.dev-state/`（git 忽略），每个 worktree 各一份，不读写旧应用的数据目录。
2. **浏览器基线**（开发者 2026-10-03 决定）：Chrome/Edge 119、Firefox 124、Safari 17.4，由内核用到的 `Promise.withResolvers`、`AbortSignal.any` 决定，Vite 构建目标据此设置；真实浏览器只在 Chrome 上实测。Electron、WebKitGTK 随桌面版删除，不再列入 smoke。
3. **引导内容**：只返回协议版本、集合修订号与插件 `{id, version}`。内置插件的浏览器定义随前端构建，服务端不再下发一份清单副本；第三方浏览器入口出现时再按协议版本加回清单。
4. **鉴权**：壳子阶段不加载鉴权插件，引导接口不需要登录，窗口没有 `unauthorized` 状态。
5. **Vite 在监督进程内运行**：中间件模式、由监督进程自己的 HTTP 服务监听，并关闭依赖发现、只预构建 `vue`。S0 实测：Vite 自己监听时端口 0 被当作缺省 5173；依赖发现进行中时 `close()` 一直不结算（Bun 与 Node 相同）。
6. **后端子进程用 `Bun.spawn`，不用 owned-process**：owned-process 的 POSIX 中间进程与调用方同一进程组，终端 Ctrl+C 会先结束它，监督进程看不到后端真正退出；孤儿后端由“标准输入结束即有序停止”收口。
7. **后端就绪以 `GET /api/runtime/health` 返回 200 为准**：`Listening on` 只说明端口已监听，其余插件可能还在激活。第一版按 `Listening on` 判定，注入激活失败的后端被当成“运行中崩溃”（合同测试发现）；健康检查利用“就绪前请求等待、启动失败得到 503”的既有合同，不需要轮询。
8. **启动失败的原因行**：内核的紧急报告只带失败入口与代号（不带错误正文），致命诊断里看不出“静态根缺少 index.html”这类原因。宿主在内核关闭完成后补写一行 `runtime.startup.causes`，列出各失败入口的错误（经脱敏）。

**不在本 Task**：第 4 步的工作台外壳、命令、布局持久化与 Lab，以及 vue-router、UnoCSS、nb-ui、vue-i18n；browser-host 场景 3、5、6、7（懒激活、插件集合变化、离线与重连）与布局恢复；鉴权；第三方浏览器入口；e2e 进 CI；Windows 实测。

## 验收

1. 生产构建（`bun run build` 后 `bun run start`）：首屏是空工作台，窗口运行实例在挂载前建立，`nbook.workbench` 已激活（browser-host 场景 1）。
2. 引导失败显示带重试的连接失败页，没有半个工作台；恢复后重试成功（场景 2）。协议不兼容提示刷新。
3. 两个窗口互相独立：关闭一个不影响另一个，服务端不停止（场景 4）。
4. 开发模式改后端文件：旧后端有序停止后新进程启动，没有两个进程同时监听；新进程启动失败时不循环重启（server-host 场景 7）。
5. 对开发监督进程发 SIGTERM：后端有序停止后监督进程退出（server-host 场景 8）。
6. `typecheck`、`test`、`smoke:server`、`test:e2e` 通过；`docs:check`、`governance:check` 失败为 0。

## 当前状态

2026-10-03 实现完成（`40455b18`、`7fecf728`、`735c76f0` 与 S4 提交），待 omp 审查。

**实际改动（`packages/neuro-book`）：**

- **S1 引导与静态资源**：`src/shared/browser-bootstrap.ts`（路径、协议版本、TypeBox schema）；`src/server/browser-bootstrap.ts`（按清单列出浏览器插件，修订号取排序后 `id@version` 的 sha256 前缀）；`src/plugins/http/server/static.ts`（GET/HEAD、不越出静态根、页面路径回退、`/assets` 长期缓存）；`createHttpPlugin` 增加 `hostRoutes`、`staticRoot`；启动参数 `NBOOK_WEB_ROOT`；清单描述增加版本，加入 `nbook.workbench`；`smoke:server` 增加 S5。
- **S2 前端宿主**：`src/web/`（`main.ts` 先启动窗口再挂载；`host/window.ts` 状态机；`host/browser-host.ts` 浏览器适配器；`host/connection.ts`；`plugins.ts`；`App.vue`、`FailurePage.vue`）；`nbook.workbench` 浏览器入口交出空工作台；`nbook.diagnostics` 浏览器入口写 console；`vite.config.ts`、`tsconfig.web.json`（vue-tsc）；`collectServiceKeys` 移到 `src/shared/`；`src/architecture.test.ts` 守住包内依赖方向。
- **S3 开发监督进程**：`src/server/dev/`（`main.ts`、`run.ts`、`supervisor.ts`、`backend-process.ts`、`frontend.ts`、`watch.ts`、`config.ts`）；`bun run dev`；`.dev-state/` 加入 `.gitignore`。
- **S4**：`e2e/`（Playwright 由 Node 运行，本机 Chrome）与 `test:e2e`；测试写法机检扩到 `*.e2e.ts`、拦截 `waitForTimeout`；CI 矩阵加 `build:web`。
- **Spec 与文档**：`runtime.browser-host` 按 v2 改写（前端入口、不加载鉴权、引导字段、浏览器基线、宿主页、Chrome 上的 smoke、实现合同），状态保持 `planned`；`runtime.server-host` 写实开发模式、页面资源与启动失败原因行；`runtime.application`、`runtime.diagnostics` 的浏览器部分改指新应用；登记表、包 `AGENTS.md` 与 README、模块边界、测试规范。

**验收（主 Agent 自跑）：**

1. `bun run typecheck`（tsc 与 vue-tsc）0 错误；`bun run test` 16 个文件 79 个用例通过（[`app-checks.txt`](evidences/app-checks.txt)），连跑 3 次无波动。
2. `bun run smoke:server`：S1–S5 通过（[`smoke-server.txt`](evidences/smoke-server.txt)）。
3. `bun run test:e2e`：6 个用例通过（[`e2e.txt`](evidences/e2e.txt)）：生产构建上场景 1（挂载前只出现过静态占位，没有“启动中”与失败页）、场景 2（拦截引导请求 → 连接失败页、无工作台 → 解除后重试进入工作台）、503 与协议不兼容、场景 4（关闭一个窗口，另一个照常、刷新后换了新实例，服务端最后以 0 退出）；开发命令上 server-host 场景 7、8（改后端入口 mtime 后有序重启，启动与退出严格交替；SIGTERM 先停后端再关页面，以 0 退出）。
4. 合同测试覆盖 server-host 场景 7、8 的其余分支：去抖合并、重启中的改动不追加、新进程启动失败不循环、运行中退出只报告、前置门、终端 Ctrl+C、第二个信号以 1 退出、页面端口被占用不启动后端。
5. `docs:check`、`governance:check` 失败为 0、本次改动无新警告；`test:affected --typecheck`（`bun.lock` 有改动，选中全部包）只有 4 项既有失败（llmlint 类型检查与测试、nb-ui、test-support，开发者 2026-10-03 决定暂不处理），本次改动涉及的包与根脚本全部通过（[`affected.txt`](evidences/affected.txt)）。

**未验证**：Windows（Ctrl+C、文件监视、强制结束）；Firefox、Safari 上的实际运行（只按 API 定了基线）。

## 下一步

omp 审查；之后进入第 4 步 workbench 底座。
