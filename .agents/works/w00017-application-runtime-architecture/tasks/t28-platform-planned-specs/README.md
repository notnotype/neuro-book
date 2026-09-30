---
schema: nbook.task/v2
taskId: t28-platform-planned-specs
---

# 可扩展应用平台的 planned Spec

## 目标与范围

把[可扩展应用平台设计](../../../../../packages/neuro-book/docs/proposals/extensible-application-platform.md)（2026-09-30 `accepted`，插件系统问题同日全部确定）中已确认的行为写成 `planned` Spec，作为阶段 1 至阶段 3 的实现与验收依据。

- 已 `implemented` 的 `runtime.plugins`、`runtime.application` 描述当前行为，不改成 `planned`；新行为按可独立验收的能力拆成新的 `planned` Spec，并在旧 Spec 中补相邻合同链接。
- 设计稿没有给出、但 Spec 必须写明的默认值（超时、路径、状态码、重启上限等），由本 Task 选定并在交付时列给开发者确认。
- 用 omp 的 `@default` 模型（gpt-6.1-sol）做一次跨模型审查。
- 只改文档，不改产品代码，不执行远端操作。

## 当前状态

2026-09-30 写完 10 份 `planned` Spec（`docs/specs/runtime/` 下的 plugin-manifest、server-host、browser-host、plugin-channel、api-docs、plugin-hot-plug、plugin-install、plugin-code-loading、plugin-api、stall-watchdog），登记进 Spec 注册表；`runtime.plugins` 与 `runtime.application` 只补相邻链接；设计稿的“对 Spec 的预期改动”改为指向这些 Spec。`docs:check` 与 `governance:check` 通过。

跨模型审查：omp `gpt-6.1-sol`（thinking high，只读、无工具），原文见 [cross-model-review.md](evidences/cross-model-review.md)，共 25 条。处理：

- 采纳并修改 23 条。高严重度的 9 条：
  - 看门狗不再自己删租约锁，改由 Manager 确认旧进程退出后删除，消除双写窗口；
  - 拒绝同版本重装；
  - 升级只在服务端判定成功，浏览器失败不回滚；
  - 安装、升级、卸载各定义提交点与崩溃恢复；
  - 引导与事件流之间用集合修订号对齐；
  - 插件管理限 `admin`；
  - 拒绝符号链接与越界的 `files`；
  - 回收与 worker 按入口而非整个插件；
  - 贡献按单条校验，拥有者缺席时“待校验”。

  中低严重度：
  - 重复 id 全部拒绝；
  - 三步停止的预算按整次操作、信号在第 2 步触发；
  - 跨插件接口分三类，规定远程形态约束的适用范围；
  - 通道依赖只是可用性约束；
  - 启动必需按运行位置判定；
  - 禁用、卸载、不存在三种情况的状态码（`interrupted` 改为 503）；
  - 路由冲突全部拒绝；
  - 再次激活总是新模块实例；
  - worker 验收不再写死 30 毫秒；
  - 停止请求引起的退出不重启，重启上限与自动安全模式分开验收；
  - 密钥不可解密时保留密文；
  - OpenAPI 只含静态声明；
  - 去掉 Nitro `entry`、FFI 等实现细节。
- 第 23 条（“待开发者确认”的默认值已写成正文）：各 Spec 的证据一节列出了由本 Task 选定的默认值，交开发者确认后删除“待确认”说明。
- 不采纳第 25 条（章节数为 10）：Spec 模板在九个固定行为章节之外另有“证据”一节，与现有 Spec 一致。

## 下一步

开发者确认各 Spec 证据一节列出的默认值后，删除“待开发者确认”；阶段 1 的实施另行授权。
