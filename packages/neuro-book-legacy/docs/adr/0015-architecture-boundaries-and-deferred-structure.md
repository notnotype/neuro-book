# ADR 0015：共享合同边界与结构优化延期

- 状态：Accepted
- 日期：2026-08-07
- 关联任务：[Task 123](../../../../.agents/tasks/123-repo-structure-optimization/README.md)、[Task 142](../../../../.agents/tasks/142-post-merge-reliability-hardening/README.md)、[Task 143](../../../../.agents/tasks/143-desktop-envelope-installation-spike/README.md)
- 相关决策：[ADR 0010](0010-desktop-storage-loopback-shutdown.md)、[ADR 0017](0017-agent-job-durable-history.md)

## 背景

当前 master 的核心生命周期、Job 终态持久化、Project Module Registry 和 Desktop Contract 方向基本成立，但结构审查发现几处边界不够真实：Product Runtime 的共享 verifier 与独立 Manager 之间存在运行时依赖环，shared DTO 与 `server/agent` 存在循环类型依赖，多个领域 Facade 仍然是大单体，OpenAPI 生成物也仍写回路由源码。

这些问题主要影响独立发布、后续维护和审查成本，不等同于已经复现的用户运行时故障。本 ADR 记录本轮为什么不把所有结构问题一次性改掉，也避免为了“看起来干净”引入更大的迁移风险。

## 决策
### 0. 主应用包边界已由 Task 149 完成

本 ADR 当时记录的后续目标已在 Task 149 落地：根 `package.json` 现在只做 private workspace orchestrator，主应用源码、Nuxt、Vitest 与 Prisma 配置位于 `packages/neuro-book`；根 `scripts/` 与 `desktop/` 继续承担跨包产品、发布和宿主适配职责。

根与应用包内的 `nbook/*` alias 指向 `packages/neuro-book`，只作为应用源码导入约定；其他 workspace 必须通过公开包入口消费能力。Source Dev、Product、Manager、Desktop 与测试的当前 Owner、Interface、数据边界和验证入口见 [Monorepo Module 边界与迁移规范](../../../../docs/modules/monorepo-boundaries.md)。迁移没有新增旧根路径 alias、兼容 re-export 或静默 fallback。


### 1. 暂不新建 `runtime-contract` 包

不为了消除当前依赖环立即新建一个新的共享包。现有 `shared/`、Manager 包和 Product Runtime 仍按当前仓库合同工作；不增加新的别名层、重复类型或兼容转发层。

只有当 Manager 需要真正脱离 NeuroBook 仓库独立发布，或 Product Runtime 合同被第二个独立宿主复用且当前依赖已经阻塞构建、打包或发布时，才重新评估是否抽出独立合同包。届时先以最小的实际复用面确定包边界，不按想象中的未来宿主预留接口。

### 2. 暂不处理 shared/Manager 的依赖环

`shared/product-runtime-image-verifier.ts` 目前依赖 Manager 的 `PRODUCT_PLATFORMS`；Manager 的 Product 实现又依赖该 verifier。当前构建和已有 Manager 验证没有显示运行时故障，因此本轮只记录为 P1 架构候选，不进行仅为“解环”而进行的复制常量或大范围导入改写。

重新评估的证据包括：独立 Manager 构建把仓库源码带入产物、独立发布无法解析 `nbook/*` 导入、平台枚举在两个位置发生漂移，或该环在实际宿主/打包流程中造成失败。

### 3. 暂不处理 shared 与 `server/agent` 的循环类型依赖

`shared/dto/agent-session.dto.ts` 当前引用 Agent 内部类型，而 `server/agent/session/types.ts` 又引用 shared DTO。因为两侧都是 type-only import，本轮没有观察到运行时环。它被记录为 P2 结构问题；只有在 shared DTO 需要由另一个宿主独立编译、或者 TypeScript/project reference、生成客户端或打包边界被该环实际阻塞时，才单独设计最小的合同下沉。

### 4. 暂不按行数拆分核心单体

`NeuroAgentHarness`、Project Lifecycle、Workspace Files、Novel IDE 页面/Store 和 AgentChatSurface 的行数较大，但它们仍承担领域 Facade 角色，当前没有单凭行数就必须拆分的运行时证据。本轮不为追求文件变小而创建过多代理层或中间抽象。

重新评估时看用户流程回归、模块之间的真实边界、变更冲突和测试隔离是否持续造成成本；如果只是局部方法较长但合同稳定，不以机械拆文件作为目标。

### 5. 暂不建设跨存储全局事务

文件系统、Project SQLite、History SQLite、Session JSONL 和 Job JSON 各自维护自己的生命周期与一致性。当前继续依赖已有的操作顺序、幂等、补偿和可诊断失败合同，不建设跨存储分布式事务或统一提交协调器。

只有出现已复现的用户可见数据丢失、无法通过局部重试/补偿恢复，且该场景具有稳定产品合同时，才重新评估更强的一致性设计；单纯“多个存储同时变化”不构成建设事务框架的理由。

### 6. 接受 Electron/Tauri 的局部重复

Electron 和 Tauri 目前仍是 Desktop spike。配置、端口、Supervisor、关闭和窗口状态的部分重复是跨 Rust/TypeScript 宿主的现实成本，本轮不提前引入复杂的跨语言运行时或代码生成层。

只有在 Desktop 进入正式发行、两个实现的行为矩阵需要长期同步，且重复已经产生可复现的合同漂移时，才重新评估抽取共享协议或测试向量；当前应保持宿主差异显式可审查。

### 7. OpenAPI 生成物继续由 Task 123 单独处理

路由源码中自动生成的 `defineRouteMeta` JSON 仍是维护噪音和合并冲突来源，但它已有 Task 123 的 D1 方案和独立验证要求。本轮不把它与可靠性、Manager 或 Desktop 结构改动混合；实际改造必须保持逐路由 spec 等价。

## 后果

- 主应用物理包迁移已完成；根 workspace orchestrator、`packages/neuro-book` 与各 workspace 包的持续边界由 [Monorepo Module 边界与迁移规范](../../../../docs/modules/monorepo-boundaries.md) 和治理门禁维护。
- 独立 Manager 发布只消费公开 Product/Release/Installation 合同；不得重新依赖迁移前根应用路径或 Nuxt 私有实现。
- 大单体和 OpenAPI 生成物仍会增加后续修改的审查成本；它们保留在 Task 123 的长期 backlog 中。
- 跨存储操作仍只保证各自模块的合同和已有补偿路径，不承诺全局原子性。
- Desktop 继续是 Windows-first spike；本 ADR 不改变其未完成的签名安装器、updater、跨平台正式包和最终框架选择边界。

## 重新评估清单

满足以下任一条件时，应新开独立 task/ADR 或更新本 ADR，而不是在普通功能 PR 中顺手处理：

- Manager 需要脱离主仓库独立发布，或 Product Runtime 被第二个独立宿主消费。
- 当前依赖环在 clean package、独立 typecheck、bundle、安装或发布验证中实际失败。
- shared DTO 需要被独立客户端/宿主编译，或循环类型依赖导致生成代码、project reference 或边界测试失败。
- 大单体已导致可复现的用户流程回归、多人合并冲突或无法隔离的 focused test 失败。
- 跨存储操作出现已复现且局部补偿无法恢复的用户可见数据损失。
- Electron/Tauri 已进入正式发行，并出现可复现的跨宿主合同漂移。

## 验证边界

- 直接运行 `node node_modules/nuxt/bin/nuxt.mjs typecheck --dotenv .env.typecheck --logLevel silent`：通过，退出码 0。
- `bun run typecheck` 未进入 TypeScript，Bun 报告 `Bun failed to remap this bin to its proper location within node_modules.`，并提示 `corrupted node_modules directory`，退出码 255。
- 本轮未运行全仓测试、浏览器验收、真实 provider 或发布流程；本 ADR 不替代这些门禁。
