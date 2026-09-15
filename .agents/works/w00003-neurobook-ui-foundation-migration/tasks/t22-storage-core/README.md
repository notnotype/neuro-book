---
schema: nbook.task/v2
taskId: t22-storage-core
role: tasker
---

# Storage 状态定义与本地服务核心

## 目标与授权

开发者于 2026-09-16 明确授权：Spec 与文档治理完成并单独提交后，直接进入 goal 模式开始实现。
文档基线提交为 `44710392`。本 Task 是 [实施计划](../../storage-implementation-plan.md) 切片 1 的核心增量；
先固定不依赖 Nuxt、Vue 或浏览器的可运行服务，再按其实际结果创建宿主身份与 HTTP/前端适配增量。
行为依据：[storage.persistence](../../../../../docs/specs/storage/persistence.md) 与 [storage.boundaries](../../../../../docs/specs/storage/boundaries.md)。

## 工作区、范围与边界

- 在既有 `.worktree/w00003-neurobook-ui-foundation-migration`、`refactor/w00003-nb-ui-adoption` 工作。
- 实现主应用 `shared/storage/` 的公开类型、状态注册与纯校验，以及 `server/storage/` 的本地服务核心和同目录测试。
- 必要时新增同目录说明/公开入口；不改 Work 身份、Spec 产品合同、包依赖或用户产品数据。
- HTTP 路由、真实身份签发、Project 生命周期接线、用户资产树/备份接线、UI/旧键迁移在后续增量。
  本次核心接受宿主明确提供的受信访问上下文，不从页面、隐式当前用户、任意浏览器 body 或工作目录推导身份和路径。
- 原有 `app/utils/workbench/descriptors.ts` 与测试为上轮 dirty 改动，保持不动。
- 不联网、不派更多子代理、不提交、不 push、不改远端；所有数据测试使用仓库统一隔离临时根。

## 实现结果

1. 稳定公共边界：有限有界 JSON、owner/key、scope/locality、资源标识、schemaVersion/default/validate/迁移定义、快照分类、条件凭据、失败与失效。
   对注册冲突、未知版本、损坏、缺失和 I/O 失败给不同结果；运行期函数定义与可序列化 DTO 分开。
2. 逐记录文件 authority：绑定显式存储根及宿主主体/客户端上下文；逻辑标识安全编码，拒绝路径穿越与 symlink 逃逸。
   缺失读不写默认值；必要身份/分区元数据与值记录区分。单个坏键不使其它记录不可读。
3. 条件保存/删除/修复：锁内读、校验、quota 与原子替换；revision 与封装版本/schemaVersion 分开，条件凭据绑定分区代次。
   未知高版本禁止普通覆盖；损坏显式修复保留原件并检查绑定原始内容的凭据。保存成功后可重启恢复，推送异常不能撤销已提交事实。
4. user owner 实际分区有界跨进程文件锁，复用现有 proper-lockfile 与 Project 心跳/过期参数的合同，不长期占 workspace mutation 锁。
   不同键并发仍不能绕 quota；所有磁盘/锁操作有明确 owner，Windows 替换重试有界，失败不删除有效原件。
5. owner 显式墓碑回收：quota 满仍可减少占用；同一临界区先持久化新分区代次，再回收选定墓碑，旧句柄/缺失凭据/修复凭据失效。
   活值保持，维护预留空间有界，中断可恢复；不是全量清空。操作及订阅释放/排空能拒绝新操作并收口已接纳请求。
6. 初始化订阅无快照/更新间隙，进程外写入后可观察最新当前状态；允许合并中间值，不伪造审计重放。
   以明确生命周期控制的观察机制实现，不留下无人管理的轮询或 watcher。

实现可按模块职责合理拆分，避免大文件及为未来需求建立空壳。没有本次运行证据的宿主接线保持未完成，不将 capability 晋升 implemented。

## 验证与交接

- 先读相关 code common/typescript/server/contracts/packages 规范与 docs/testing/README.md，确认实际 package.json 命令。
- 用聚焦行为测试覆盖两主体/客户端/身份域隔离、local/shared、CAS/删除/回收旧凭据、注册/JSON 边界、损坏/高版本保护、容量与跨键并发、重启、原子替换故障、订阅/释放。
- 跨进程锁必须有两个进程竞争同旧 revision 的真实测试，不能只用同进程 Map 或 mocks 证明。
- 运行 `bun run --cwd packages/neuro-book test <目标>`、对应 typecheck、diff check；原基线错误单列，修本次新增失败。
- 在本 Task walkthrough 中记录实际文件、命令、退出码、关键结果、未覆盖验收和下一增量依赖。
- 遇到超时仍保留完整已修改文件与可恢复记录；最终必须给出简短报告，不以 yield null 代替交接。
- 交接前处理 [Leader 增量复核](walkthroughs/leader-review.md) 中的可复現问题，以当前源码和回归测试核对推断项。

## 2026-09-16 执行接续

首轮 omp Tasker 在 20 分钟期限退出，代码和 59 个通过的聚焦用例已落盘，但未产出最终报告，不能视为交付完成。
另一次只读 omp 核心复核在 4 分钟期限退出，无报告，不作为审查证据。
主 Agent 接续同一 Task 的 tasker 合同处理已复现缺陷，再进行集中独立复核；不重复建立 Work 或改 Task 身份。

## 本地核心增量交付

2026-09-16：t22 实现及同合同修复已闭合，返回 Leader 做本地提交和下一增量编排。
主 Agent 实测 10 文件、86 个 Storage 聚焦用例通过；纳入 Storage 入口后的主应用 typecheck 退出 0，
docs:check 为 5595 文件、failures=[]，t22 governance:context 无 failures。
两次缩窄范围的 omp 只读复核正常完成，发现项由主 Agent 核对和修复；详见 [复核与回归证据](walkthroughs/leader-review.md)。

本 Task 完成不表示切片 1 或整个 Storage Spec 已实现；后续仍需宿主身份、HTTP/前端适配、生命周期、迁移与 UI 验收。
没有运行全量产品测试、其它 OS 或真实用户数据迁移，没有 push/PR/部署。
