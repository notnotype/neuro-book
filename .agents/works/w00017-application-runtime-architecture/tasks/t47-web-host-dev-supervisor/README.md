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

**不在本 Task**：第 4 步的工作台外壳、命令、布局持久化与 Lab，以及 vue-router、UnoCSS、nb-ui、vue-i18n；browser-host 场景 3、5、6、7（懒激活、插件集合变化、离线与重连）与布局恢复；鉴权；第三方浏览器入口；e2e 进 CI；Windows 实测。

## 验收

1. 生产构建（`bun run build` 后 `bun run start`）：首屏是空工作台，窗口运行实例在挂载前建立，`nbook.workbench` 已激活（browser-host 场景 1）。
2. 引导失败显示带重试的连接失败页，没有半个工作台；恢复后重试成功（场景 2）。协议不兼容提示刷新。
3. 两个窗口互相独立：关闭一个不影响另一个，服务端不停止（场景 4）。
4. 开发模式改后端文件：旧后端有序停止后新进程启动，没有两个进程同时监听；新进程启动失败时不循环重启（server-host 场景 7）。
5. 对开发监督进程发 SIGTERM：后端有序停止后监督进程退出（server-host 场景 8）。
6. `typecheck`、`test`、`smoke:server`、`test:e2e` 通过；`docs:check`、`governance:check` 失败为 0。

## 当前状态

2026-10-03 开始。S0 试验完成（结论见实现决定 5）；S1 服务端协议与静态资源进行中。

## 下一步

S1 → S2 前端宿主 → S3 开发监督进程 → S4 e2e 与 Spec，完成后交 omp 审查。
