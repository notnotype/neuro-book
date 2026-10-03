# ADR 0002：可重建运行产物必须有界

- 状态：Accepted（2026-07-27 随 Task 125 Round 02 实施）
- 日期：2026-07-26
- 关联任务：[Task 125](../../../../.agents/tasks/125-runtime-artifact-storage-lifecycle/README.md)

## 背景

NeuroBook 会生成两类可重建运行产物：Profile 发布 artifact，以及为绕过 Bun/Product 动态 import 行为建立的物理 Runtime Import Cache。测试还会创建带系统 assets 视图的临时 Workspace Fixture。

当前 Profile artifact 只有基于时间的 orphan GC，Runtime Import Cache 没有 retention policy，测试 fixture 会复制完整 `.nbook`。三者叠加后，少量源码可被放大成上百 GB 磁盘残留。只加清理脚本或启动全清无法表达 current release 的不可删除性，也不能处理并发发布与活跃测试 owner。

## 决策

所有持久化的可重建运行产物必须在其领域 Module 中声明并执行以下合同：

- 明确 owner；
- 明确可重建所依据的真相源；
- 明确当前可达集合；
- 明确硬字节/条目预算；
- 明确写入、启动或发布时的回收时机；
- 明确活跃项和不可驱逐项。

Published Profile Artifacts 与 Runtime Import Cache 分开拥有生命周期：

- Profile 的原子 `manifest.json` 继续是 current release 真相源。current 引用永不驱逐；只有未引用 artifact 可在 publish lock 保护下按 grace 与硬预算回收，容量上限优先于 orphan grace。
- Runtime Import Cache 不是发布真相源。调用方必须通过带 retention policy 的 Module 创建物理执行副本，不再允许只传 `cacheRoot/cacheKey` 建立无界持久缓存。
- Profile runtime 直接导入已经内容寻址的 published artifact，不再为相同 SHA 维护第二份 `profile` import cache。
- Test Workspace Fixture 不得复制 manifest 不可达的 artifact、staging 或 runtime cache；fixture Module 自己负责初始化回滚、最终清理和带 owner marker/lease 的跨运行残留回收。

具体预算数值属于 Task 125 的集中实施参数，可以基于测量调整，不写死在本 ADR。调整预算不得取消硬上限或 current release 保护。

实施时补充了两条本 ADR 原文没有写、但属于同一原则的约束：

- **最小安全年龄地板优先于硬预算。** 硬预算不得删除刚脱离 current 集合的 artifact，因为并发读者可能已经读到上一版 manifest 并正准备 import 其中的 artifact。因此硬预算是「稳态上界」而非「瞬时上界」，短时间高频发布可以短暂超出并被上报。
- **预算只约束不可达集合，不是目录总量上限。** current release 按合同不可驱逐，因此单个 root 的稳态是 `current + orphan`。定预算时必须同时看「一代 release 有多大」：一代占满预算的大部分时，预算实际只买到一代多一点的回滚余量，此时该调的是 artifact 体积而不是预算数字。
- **可达集合为空时不执行预算回收。** manifest 没有任何 loaded entry 属于退化态（例如宿主依赖临时缺失导致全量编译失败），此时把「全部 artifact 都不可达」当成「全部都是垃圾」会在一个瞬时故障窗口里清空整个 release 目录。

## 原因

Profile 发布 artifact 与 import cache 的安全删除条件不同。前者必须尊重原子 release 和并发 Publisher，后者随时可从源码/发布 artifact 重建；把两者塞进一个通用 Artifact Store 会产生复杂的策略矩阵，降低 Module 深度。

TTL 只能限制年龄，不能限制写入速度。当前一次 Profile 全量编译约产生 381 MiB，新产物可在一天内远超磁盘容量，因此必须有硬预算。

把 owner、可达性和 retention policy 放进 Interface 后，未来调用方无法在不知道回收责任的情况下新增持久 cache；这比事后增加定时清理更能防止同类问题复发。

## 后果

- current Profile release 不会为了满足缓存预算被删除；磁盘不足时优先删除 orphan，仍不足则发布/编译必须明确失败。
- orphan 历史可能比当前 7 天 grace 更早被回收，减少快速复用旧 artifact 的机会，但不丢失源码或用户内容。
- World Engine/Variable 需要迁移到新的 Runtime Import Cache Interface。
- 修改 system assets 的测试必须显式选择 isolated projection；默认 fixture 只使用共享只读 system assets。
- 预算统计和 policy 类型可以共享，但三个领域 owner 的 GC Implementation 保持分离。

## 未采用方案

- 应用或测试启动时无条件清空：无法保护活跃 owner 和 current release。
- 只使用 TTL：没有磁盘容量上界。
- 只修测试 `afterEach`：无法处理初始化失败、进程强杀和源模板膨胀。
- 优先建立共享 bundle chunks：会增加 release graph 复杂度，并固化本不应进入 Profile artifact 的宿主依赖。
- 将所有 package external：会破坏无根 `node_modules` 的 Product/Portable artifact import 合同。
- 建立统一 Artifact Store：不同真相源与并发语义会让 Interface 过度复杂。
