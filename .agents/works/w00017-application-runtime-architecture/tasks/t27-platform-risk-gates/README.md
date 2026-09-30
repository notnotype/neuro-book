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

2026-09-30 开放。G0、G1、G2 分别委派给三个子代理并行验证：G0、G1 各使用一个从当前 HEAD 分离出的临时 worktree（位于会话临时目录，不在仓库内），G2 在临时目录中实验并只读参考仓库源码。等待结果。

## 依据

- 设计：[P5 插件通道](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md#p5-运行位置与插件通道)、[P6 服务端宿主](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md#p6-服务端宿主内核拥有进程)、[P7 浏览器宿主](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md#p7-浏览器宿主与第三方界面)。
- 已有实验：[t26 worker 实验](../t26-platform-architecture-redesign/evidences/worker-probe/output.txt)、[t26 同线程卸载与看门狗实验](../t26-platform-architecture-redesign/evidences/inproc-probe/output.txt)。

## 下一步

汇总三个门的结论；任一门不成立时，按设计中的退路修改 P6 或 P7 并交开发者确认。三个门都成立后，把 `runtime.plugins`、`runtime.application` 的改动与新增 capability 写入 `planned` Spec，再进入阶段 1。
