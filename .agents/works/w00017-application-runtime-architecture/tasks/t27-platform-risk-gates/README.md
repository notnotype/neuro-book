---
schema: nbook.task/v2
taskId: t27-platform-risk-gates
---

# 平台风险门 G0、G1、G2 验证

## 目标与范围

[可扩展应用平台设计](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md)（2026-09-30 `accepted`）要求在阶段 1 之前单独验证三个风险门。本 Task 只做一次性验证并给出每个门的结论与证据，不交付产品代码：

- 实验代码放在仓库外的临时目录或临时 worktree，结束后清理；只把复现脚本、原始输出和报告复制到本 Task 的 `evidences/g0/`、`evidences/g1/`、`evidences/g2/`。
- 不修改 w00017 实现 worktree 中的产品代码，不提交实验代码，不执行远端操作。
- 不占用、不停止开发者已在 3001 端口运行的开发服务；实验使用临时 State Root，不触碰用户数据。

## 三个风险门与通过标准

**G0 自有服务端入口（设计 P6）与 WebSocket 升级（设计 P5）：**

1. 用 Nitro 的 `entry` 选项指定自有入口，产品构建（`node-server` preset）成功，产物入口仍是 `.output/server/index.mjs`；
2. 入口与路由共用同一模块图：入口和路由导入的同一个服务端模块只有一份实例；
3. 入口自己建立 HTTP 服务（`toNodeListener(nitroApp.h3App)`），在 Bun 下能启动、处理请求、有序停止；
4. Desktop 与 Manager 的就绪探测和停止通道（`PRODUCT_SHUTDOWN_PATH` 等）语义不变；
5. 开发模式下以 Nitro 插件在初始化时建立运行实例、在 `close` 钩子中停止，热重载后不残留旧实例；
6. 自有入口在 Bun 下用 crossws 的 node 适配器完成 WebSocket 升级，升级请求能按现有 Cookie 会话鉴权。

**G1 运行时加载的插件组件共享宿主的 Vue 与 nb-ui（设计 P7）：**

对源码树外的示例插件组件，分别用 import map 与宿主模块表两种做法在运行时加载，在开发构建与生产构建中确认：响应式更新生效；`inject` 能取得宿主提供的 i18n 与主题；nb-ui 浮层正常；卸载后没有残留；组件抛错只影响本视图。浏览器至少覆盖 Chromium 与 WebKit（作为 Tauri WebKitGTK 的近似），能运行时覆盖 Electron。

**G2 主线程卡死兜底与 worker 池（设计 P4、P6）：**

1. 看门狗阈值与 Session Store 租约（15 秒心跳、30 秒过期）的关系，卡死报告内容；
2. 服务端进程被结束后，Desktop 与 Manager 的实际行为（是否重启、如何呈现）；
3. Windows 上从 worker 结束整个进程的方式与限制（无 Windows 环境时以源码与文档为依据并标明未实测）；
4. worker 池 API 原型：`ctx.workers.run(module, input, {signal})`，中止即终止 worker，在服务端 Bun 与浏览器 Web Worker 两侧的可行形态。

## 当前状态

2026-09-30 开放，G0、G1、G2 分别委派给三个子代理并行验证。三个子代理都曾因用量限额中断，限额恢复后续跑。子代理的写入工具不允许创建报告类 `.md`，各门 `REPORT.md` 由主会话按子代理交回的正文原样保存。

- **G0 已完成**（[报告](evidences/g0/REPORT.md)）：生产侧成立，包括 `entry` 自有入口构建、同一模块图、Bun 下自建 HTTP 服务并有序停止、Manager 就绪与停止合同、WebSocket 升级与会话鉴权。开发模式只部分成立：热重载存在新旧实例重叠窗口，重叠后新实例拿不到 Session Store 租约且不会自愈；Nitro close 钩子一个抛错会跳过其余钩子；开发模式的停止通道与 SIGTERM 都不能有序停止进程。另发现：`entry` 只能在生产构建设置；HTTP 停止路由绕过宿主；启动门禁失败时进程不退出（推断为现有问题）；`bun x nuxt dev` 实际运行在 Node 上。G0 的临时 worktree 已删除，改动保存在 `evidences/g0/changes.diff`。
- **G2 已完成**（[报告](evidences/g2/REPORT.md)）：看门狗、卡死报告、worker 池原型可行，但有四处与设计不符：
  - 看门狗阈值必须小于租约心跳间隔 15 秒（建议 10 秒），而不是设计写的“低于 30 秒、例如 20 秒”；
  - 结束进程要写报告、删除本进程的租约锁，并以专用退出码经 FFI `_exit` 结束，因为 `SIGKILL` 经产品包装链后变成退出码 1；
  - Desktop 与 Manager 现在在服务就绪后既不重启也不提示；
  - Bun 的 `worker.terminate()` 打断不了 WebAssembly 与原生阻塞调用，Chrome 终止后有约 2 秒宽限。
- **G1 已完成**（[报告](evidences/g1/REPORT.md)）：成立。import map 与宿主模块表两种做法，在开发与生产构建、Chromium 151、WPE WebKit 26.5、Electron 43、WebKitGTK 2.52.6 上，响应式、宿主 i18n/主题/inject、nb-ui 浮层、卸载无残留、抛错隔离全部成立。区别在卸载：ESM 模块被浏览器模块映射永久持有，宿主模块表注销后代码可被回收（Chromium、Electron 堆快照）。插件自带一份 Vue 时是静默失败（计数不更新、无报错，`inject` 却能取到宿主上下文），只能在构建或加载时拦截。Tauri 本体与 WebView2 未运行。G1 的临时 worktree 已删除，改动保存在 `evidences/g1/changes.diff`。

三个门的结论：G0 生产侧成立、开发模式需重新设计；G1 成立；G2 可行但阈值、结束方式与重启链路需改。“内核拥有进程”“同线程加保护”“宿主模块表”三个方向都不需要推翻。各报告列出的设计修改建议待开发者确认。

开发者 2026-09-30 的处理：WebAssembly 计算不强制切分；启动失败不退出与 API 路径认证放行两个现有问题交 w00020 修复（分支 `fix/w00020-startup-exit-api-auth`）；开发模式问题登记为 [#244](https://github.com/notnotype/neuro-book/issues/244)。

插件依赖按端细分的外部调研（2026-09-30，开发者要求）：[VS Code](evidences/deps-vscode/REPORT.md)、[DeepSeek Harness](evidences/deps-dsh/REPORT.md)。两者都没有“依赖某插件的某一端”的写法：VS Code 一个扩展只在一个宿主运行，依赖只在同宿主解析，跨宿主依赖要求被依赖方声明 `api: none` 并放弃导出 API；DeepSeek Harness 没有插件级激活依赖，两端各自在代码里按服务名 `inject`，各自解析。

验证过程的副作用：G1 为运行 Electron 启动无头 KWin 时首次崩溃，触发了开发者桌面会话的崩溃报告器（约 1 分钟内已停止）；浏览器、Electron 等下载物放在会话临时目录。

## 依据

- 设计：[P5 插件通道](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md#p5-运行位置与插件通道)、[P6 服务端宿主](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md#p6-服务端宿主内核拥有进程)、[P7 浏览器宿主](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md#p7-浏览器宿主与第三方界面)。
- 已有实验：[t26 worker 实验](../t26-platform-architecture-redesign/evidences/worker-probe/output.txt)、[t26 同线程卸载与看门狗实验](../t26-platform-architecture-redesign/evidences/inproc-probe/output.txt)。

## 下一步

本 Task 的验证交付完成。2026-09-30 开发者同意插件系统与进程生命周期分两条线推进、生命周期部分按验证证据直接写入设计；设计稿 P2、P4、P5、P6、P7、P9、P11 与 ADR 0022 已按三个门的结论修订。剩余插件系统问题由开发者逐项决定后，把 `runtime.plugins`、`runtime.application` 的改动与新增 capability 写入 `planned` Spec，再进入阶段 1。
