---
schema: nbook.task/v2
taskId: t11-harness-config-models
---

# nb-harness 的 config 与 models 模块

## 目标

写 [`harness.config`](../../../../../docs/specs/harness/config.md) 与 [`harness.models`](../../../../../docs/specs/harness/models.md) 两份 `planned` Spec，并按它们实现 `config`（配置快照、校验、变化通知）与 `models`（模型目录与解析、角色选择链、能力检查、OMP 凭据与 OAuth）两个模块。Work 切片 3。

非目标：模型调用与重试（`runtime`）；审批（`tools`）；从网络刷新目录；设置界面。

## 当前状态（2026-10-10）

- 两份 Spec 与实施计划 [`plan.md`](plan.md) 已写，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 推进。能力拆成 `harness.config` 与 `harness.models` 两份 Spec、一个 Task 实现，记在 [待确认清单](../../pending-confirmations.md)。
- 真实模型冒烟（`models.llm.test.ts`）只写不跑：真实模型调用要开发者授权（自主推进的停止条件之一）。
- **实现**（计划 S1、S2，提交 `548ddee6`）：`src/config/`（`schema.ts`、`validate.ts`、`store.ts`、`config.ts`）、`src/models/`（`catalog.ts`、`credentials.ts`、`models.ts`）；`package.json` 两个入口；边界测试模块表登记 `config`、`models`。`bun test src/config src/models` 12 pass、1 skip（冒烟）；整包 143 pass、3 skip；变异检查六处（规则问题只在 schema 通过时报、不填缺省值、`replace` 失败也通知、配置不覆盖内置目录、角色未绑定回落、`apiKeyFor` 走 OMP 的 `getApiKey`）都被报出。实现中实测两件事写进了 Spec 实现合同：OMP 的 `getApiKey` 把环境变量排在存下的 API key 之前（所以直接读存下的凭据，不再用计划里的 `hasNonEnvCredential` 把关取 key，只用它判断 `status`）；`AuthStorage.create` 打开已有库后要 `reload` 才读到凭据。Spec 加“实现合同”与证据行，注册表标“待晋升”。计划审查未开（两个 omp 审查会话仍在跑，排队中）。
- **计划审查（omp）**：已写出 4 条，全部成立并已修：OAuth 令牌改经只看存储的 `getOAuthAccess`（`getApiKey` 在 OAuth 不可用时回落到环境变量，实验用两个连接复现）；`createCredentials` 改为异步并先 `reload`；`accounts` 不按 `accountId` 过滤，带 `credentialId` 与 `active`；损坏库的合同按真实机制写清——不是 SQLite 的文件拒绝打开、不改动，文件头正确但内部损坏由 OMP 备份并换成空库（取舍记在待确认清单）。变异检查四处都被报出。第 5 条（阻断：模型引用语法把 OMP 目录里 65% 的模型挡在外面）——模型 id 改为第一个 `/` 之后的全部、非空且无空白与控制字符，两份 Spec、config 校验与 models 解析同步改，补“目录里每个引用都能 resolve”的测试；第 6 条冒烟入口——改用共享的 `llmTestConfig()`（模型取它的配置，缺省 `deepseek/deepseek-flash`），`DEEPSEEK_API_BASE` 由测试写成配置里的自建服务；第 7 条登录错误透出原文——`detail` 只给服务、错误类别与状态码，补带私密标记的回调失败用例。

- **计划审查（omp）第 8–14 条与收尾**：第 8 条（`__proto__` 等保留键）——`profiles`、`approval.tools`、`headers` 的键拒绝 `__proto__`、`constructor`、`prototype`；第 9 条——`baseUrl` 用 `new URL` 解析并限定 http(s)（协议解析通过就有主机名，去掉了无法到达的主机名检查）；第 10 条——Record 的键不再带 schema pattern，坏键的值照样校验，问题一次列全；第 11 条——`api` 只查形状 `[a-z0-9-]+`，能否派发由 models 在 `resolve` 时判断：不是 OMP 内置 `KnownApi`（清单用 `satisfies` 与 OMP 类型对齐，少一个 typecheck 失败）也没有 `registerCustomApi` 登记的 → 新失败码 `unsupported-api`；第 12 条——`buildModel` 后把配置给出（或按缺省）的 `reasoning`、`input`、`supportsTools`、`contextWindow`、`maxTokens` 写回，用 `deepseek/deepseek-flash`（目录会打开推理、窗口抬到 1M）锁定；第 13 条——`harness/model` 字段由 models 登记：`MODEL_FIELD`（schema `{model?, role?}`）与 `selectionFromProfile`（`role` → `defaultRole`），注册到主机由 runtime 做，Profile Spec 示例加注；第 14 条——稀疏数组的空洞算不能如实表示。报告收尾：14 条（阻断 2、重要 12，都已处理），未发现问题的方面、两条计划风险（`list` 全量构造实测 1.3 ms/次，接受；`hasNonEnvCredential` 方案已由第 1 条替换）、两条待确认项（拆分接受；环境变量隔离的做法改判，已按第 1 条处理）；证据 [`evidences/plan-review.txt`](evidences/plan-review.txt)。变异检查：不查 api、不回写字段、不报空洞都被报出。
- **实现审查（omp）**：未开（计划审查连实现一起核实过，另开一轮的收益小；留待 runtime 接入后一并审）。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“配置”“模型与凭据”“模型角色”三节；[模型角色合同](../../../../../docs/proposals/model-roles-contract.md)（`accepted`）。
- OMP 18.2.5：`AuthStorage`（`create(dbPath)`、`getApiKey`、`hasNonEnvCredential`、`set`/`remove`、`login`/`logout`、`listOAuthAccounts`）、OAuth 注册表 `getOAuthProviders`、`pi-catalog` 的 `getBundledProviders`/`getBundledModels`/`getBundledModel`/`buildModel`。实测 `getApiKey` 会回退读环境变量，所以先用 `hasNonEnvCredential` 把关。

## 下一步

omp 计划审查 → 处理 → 实现 → omp 实现审查。
