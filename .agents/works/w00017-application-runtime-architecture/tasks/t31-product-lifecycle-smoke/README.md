---
schema: nbook.task/v2
taskId: t31-product-lifecycle-smoke
---

# 阶段 1 生命周期 smoke 与当前基线

## 目标与范围

2026-09-30 开发者确认：阶段 1 的完成标准是一个自动化 smoke 全部通过，先写 smoke、在当前代码上跑出基线，再改代码。本 Task 新增 `smoke:product-lifecycle`（检查项 L1–L10，对应 [`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md)、[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 与 [`runtime.plugin-manifest`](../../../../../docs/specs/runtime/plugin-manifest.md) 的验收场景），不改产品行为。后续阶段在同一脚本中追加检查项（阶段 2：Files 走插件通道与 API 文档；阶段 3：外部插件安装、禁用、升级、安全模式、看门狗）。

编码由 omp 完成（`gpt-6.1-sol`，额度用完后换 `aihub/gpt-6.1-sol` 续同一会话），任务说明见 [brief.md](brief.md)，主会话三轮审查意见见 [reviews/](reviews/)。

## 当前状态

2026-10-01 验收通过。

**用法：** 在 `packages/neuro-book` 运行 `bun run smoke:product-lifecycle -- --report <路径> [--skip-build] [--only L1,L3]`。每个检查项由若干子断言组成，任一子断言 fail 则该项 fail，否则有 pending 则 pending；存在 fail 时退出码为 1。产品与 dev 进程的完整输出写入各检查项的日志。经 Manager 的 `./product-control` 公开入口（本 Task 新增，导出 `applicationEnvironment`、`waitForApplicationReady`、`shutdownNativeProduct`）驱动产品，不深导入 Manager 源码。

**当前代码的基线**（omp 连续两次完整运行结果一致：[stability-run-1.json](evidences/stability-run-1.json)、[baseline-report.json](evidences/baseline-report.json)；主会话用 `--skip-build` 重跑 L1、L3、L5、L9、L10 结果相同：[acceptance-subset-report.json](evidences/acceptance-subset-report.json)）：

| 检查项 | 结果 | 现象 |
|---|---|---|
| L1 生产就绪与浏览器 | pass | |
| L2 激活顺序 | pending | 没有激活顺序诊断 |
| L3 SIGTERM 停止 | fail | 排空期间新请求被拒绝连接（不是 503）；在途的 128MB 归档下载只收到 42 字节即被切断；退出码 0、租约锁释放；关闭顺序 pending |
| L4 Manager 停止 | fail | 新请求得到 503，但在途下载被切断；优雅停止超时被强制结束，退出码 1、租约锁残留 |
| L5 启动失败退出 | pass | |
| L6 租约失效 | pass | 退出码 75 |
| L7 开发热重载 | fail | dev 启动或重载后持续 500（`agent-session-store` 初始化失败）；日志可见 worker 重启后租约 id 改变，属 #244 的启动竞态，两次运行中初始就绪时好时坏 |
| L8 开发停止 | fail | 全新 dev 进程同样在启动阶段 500，无法进入停止场景 |
| L9 引导失败 | fail | 拦截启动请求后页面仍渲染部分工作台；失败提示与重试恢复正常 |
| L10 双窗口隔离 | pass | |

阶段 1 的退出条件：上表全部为 pass（L2 与 L3、L4 的关闭顺序在内核输出激活与关闭诊断后转为可判定）。

**发现的产品问题（不在本 Task 修复）：** 归档下载在客户端取消或服务端关闭时，`/tmp/nbook-project-archive-*` staging 目录不会被清理。

**审查中处理的 smoke 问题：** 替换掉原有 `smoke:runtime-foundation` 脚本行（已恢复）；L3、L4、L9 起初被标为 pending 或测错对象（改为真实归档下载与路由拦截）；跨包深导入 Manager 源码（改为公开入口）；产品输出未记录、L9 与 L10 复用临时 State Root 导致 L10 偶发失败（已修，两次运行稳定）。

## 下一步

开始阶段 1 的实现切片，第一片为内核的入口与服务级依赖。
