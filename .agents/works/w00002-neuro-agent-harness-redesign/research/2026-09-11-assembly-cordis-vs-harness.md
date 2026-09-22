# 装配方式讨论：Cordis / dsh 与自组装

> 2026-09-11；开发者在产品形态更新中要求讨论「是直接用 neuro-agent-harness 组装，还是用 dsh 组装」。
> 本材料是讨论输入，不是决定、Proposal 或 Spec；未安装或运行任何候选框架。

## 0. 背景：2026-09-11 产品形态更新（开发者原话）

> 1. neuro-agent-harness：已经为 NeuroBook 领域集成了的 harness，没必要通用
> 2. append-only session，profile tsx，web 工具，编辑工具设计成领域无关的通用包。可以被（neuro-agent-harness 首批接入）

> 1. 通用包清单可以拆分。拆通用包的好处就是能解耦，而且还能通用。这里可以看一下使用 cordis 的 dsh 是否符合本次的需求。dsh 的 cordis 应该就是一个组装器。这里需要讨论：是直接用 neuro-agent-harness 组装还是，用 dsh 组装好
> 2. agent profile tsx 是当前 harness 的提示词装配器，定义子代理任务的
> 3. 本项目只做包与设计
> 4. 授权把 #193 正文与路线图改成新形态

## 1. 事实：Cordis 是什么

- `cordiverse/cordis`：MIT、TypeScript；README 自述 "Meta-Framework of Spatiotemporal Composability"，并明确 "Cordis is under active development. The API is not yet stable and may change without notice."；论文 `arXiv:2608.25512`；快照 8,334 stars / 518 forks / 44 open issues；npm 上游 `cordis@4.0.0-rc.10`（author: Shigma）；官方文档目前托管在 dsh 文档站（`cordis-primer`）。
- 五个核心概念（据 dsh 的 Cordis 入门文档）：
  - **plugin = 实现 Service 的对象**：函数（可选 `inject`、`apply(ctx)`）或 `Service` 子类；
  - **context 是服务仓库**：服务以稳定键注册（`ctx.tools`、`ctx.llm`、`ctx.sessions`），他人按键查找而不是 import 具体实现；
  - **`inject` 声明依赖**：加载顺序由服务需求表达，而不是手工 boot 时序；
  - **typed events 通信**：`emit` / `waterfall` / `parallel` / `serial` / `bail` 五种分派，分派模式是事件公开合同的一部分；
  - **注册是可逆 effect**：`ctx.effect()` / `ctx.on()` 返回 disposer，卸载与重载可预期地回退注册。
- dsh 持有自己的分叉：`@deepseek-ai/cordis@4.0.2`（dsh 仓库 `vendor/cordis`，独立发布），配套 `@deepseek-ai/cordis-plugin-loader` / `-include` / `-hmr` / `-timer`。上游与 dsh 分叉是两条发行线。

## 2. 事实：dsh 的「组装」是两层，不是 Cordis 一个库

- Cordis 只是内核（服务、事件、effect、scope）。dsh 在其上另建自研的 `dsh-app-boot`：**profile**（命名组合，如 web/headless/sdk/sdk-minimal/acp）、**bundle**（可分发配置行与代码）、**patch**（`cordis.patch.yml` 分层覆盖）——启动时按层装配插件树，`dsh --profile web --dump-config` 可打印整棵树。
- dsh 的每个能力都是独立 npm 包（约 70 个 `dsh-*` 直接依赖）。
- 因此「用 dsh 组装」实际含义是：采用 **Cordis 分叉 + dsh-app-boot + dsh 的包与配置约定** 整条栈，而不是采用一个通用组装库。

## 3. 事实：我们现状里「装配」已经在发生（无第三方框架）

- 产品 `packages/neuro-book/server/agent/`：`.profile.tsx`（JSX 提示词装配 DSL：`ProfilePrompt`/`System`/`HistorySet`/`AppendingSet`/`Message`/`Reminder`…，从 `nbook/profile-sdk` 导入）+ 编译 worker + catalog + watcher + artifact store/GC + 依赖门禁（编译产物只允许 DSL 表面）。这已经是「配置即代码 + 编译 + 热更新」的装配层。
- 独立包 `packages/neuro-agent-harness/`：显式注入（`AgentCaller`、`CapabilityToken`、`ProfilePrepareContext`）、capability、approval、event publication、JSONL store —— 更接近「运行内核 + 显式组合」。
- 两者都没有引入第三方装配框架；两套代码并存，是当前最大的不确定点之一（抽取源与最终归属需要先定）。

## 4. 装配选项与权衡

| 选项 | 得到什么 | 付出什么 | 主要风险 |
| --- | --- | --- | --- |
| A. 自组装（领域 harness 作为装配根） | 零新依赖；完全可控；与现有代码风格一致 | 自己维护组合代码；配置分层、热插拔、隔离要自研 | 组合复杂度随包数量增长；容易各宿主重复实现 |
| B. 自研薄装配层（借鉴 Cordis 概念，不引入依赖） | 服务键 + inject + 可逆注册 + 显式 scope；概念已由 dsh/Cordis 验证 | 需要自己设计并长期维护这一层；轮子风险 | 半成品装配层可能既不够用又难替换 |
| C. 引入 Cordis（上游 rc 或 dsh 分叉） | 成熟的 DI/事件/effect/scope 内核；dsh 的大规模验证 | 依赖预发布（上游 `4.0.0-rc`）；两条发行线（上游 vs dsh 分叉）；团队学习成本 | API 未稳定；分叉风险；把装配押给上游节奏 |
| D. 以 dsh 为平台组装（我们的包做成 dsh 插件） | 直接得到 dsh 全套（会话、工具、沙箱、审批、web/桌面/SDK/ACP）+ app-boot 配置分层 | 形态绑定 dsh 0.1.x developer preview（官方明示破坏性变更）；需跟随其插件 API 与包约定 | 与我们「领域 harness 自持」的定位重叠；dsh 自带 session/tools 全套，通用包可能变成 dsh 的附属 |

## 5. 讨论建议（待开发者判断，不是决定）

1. **通用包保持框架中立**：包的公开合同里不出现 Cordis（或任何装配框架）类型；组合面用最小、稳定的形式（构造注入 + 可逆注册 + 显式作用域）。理由：通用性要求包能被不同宿主消费，框架选择不应下推给每个消费者。
2. **装配是宿主层决策，先自组装起步（选项 A）**：neuro-agent-harness 用最小组合面装配它需要的通用包；把「Cordis 级装配器」记为证据驱动候选，触发条件：出现第二种宿主需要不同组合/分层覆盖、需要热插拔与隔离、或组合代码复杂度成为真实维护负担。
3. **若要做 Cordis 评估**：建议限定 spike（只在领域 harness 内部、只装配 2–3 个通用包，不改变通用包公共合同），对照产出为组合代码量、卸载/热更语义、错误处理与类型体验。上游 rc 与 dsh 分叉应分别评估（分叉修复与版本号已分线）。
4. **不建议把 dsh 作为装配器绑定（选项 D）**：dsh 是完整平台且处于 developer preview；把它当装配层会把我们的形态交给它的节奏，且它与「领域 harness」定位重复。它的 profile/bundle/patch 分层与 capability seam 三角色更适合当**设计参照**（详见 `2026-09-11-deepseek-harness-vs-omp.md`）。

## 6. 需要决策的问题（候选 decision id，供新 Task 合同使用）

- `D-ASSEMBLY-01`：装配层归属与采用策略（A/B/C/D，或分阶段：先 A，何时评估 B/C）。
- `D-ASSEMBLY-02`：通用包是否允许暴露框架特定的组合面（候选默认：不允许；装配框架只出现在宿主层）。
- `D-SPLIT-01`：通用包清单与粒度（候选：append-only session、agent profile 提示词装配 DSL、web 工具、编辑工具；其余待研究）。

## 7. 未验证与边界

- 未安装、未运行 Cordis、dsh 或任何装配框架；无 spike 结果；未测 Bun/Node 兼容性；未评估除许可证（MIT 已核对）以外的合规问题。
- 「Cordis 是否适合」在本材料中只有公开文档级证据；是否满足本项目的实际装配需求，需要 spike 才能回答。
- 上游 `cordis@4.0.0-rc.10` 与 dsh 分叉 `@deepseek-ai/cordis@4.0.2` 的差异未逐项核对。

## 8. 来源

- `https://github.com/cordiverse/cordis`（README、仓库结构）
- `https://registry.npmjs.org/cordis/latest`；`https://registry.npmjs.org/@deepseek-ai/cordis/latest`
- `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/cordis-primer.md`
- `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/architecture.md`
- 本仓库：`packages/neuro-book/server/agent/profiles/`（profile-dsl、catalog、compiler）、`packages/neuro-book/assets/workspace/.nbook/agent/profiles/builtin/*.profile.tsx`、`packages/neuro-agent-harness/src/`
