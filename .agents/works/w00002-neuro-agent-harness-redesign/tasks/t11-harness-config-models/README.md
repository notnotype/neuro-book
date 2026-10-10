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

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“配置”“模型与凭据”“模型角色”三节；[模型角色合同](../../../../../docs/proposals/model-roles-contract.md)（`accepted`）。
- OMP 18.2.5：`AuthStorage`（`create(dbPath)`、`getApiKey`、`hasNonEnvCredential`、`set`/`remove`、`login`/`logout`、`listOAuthAccounts`）、OAuth 注册表 `getOAuthProviders`、`pi-catalog` 的 `getBundledProviders`/`getBundledModels`/`getBundledModel`/`buildModel`。实测 `getApiKey` 会回退读环境变量，所以先用 `hasNonEnvCredential` 把关。

## 下一步

omp 计划审查 → 处理 → 实现 → omp 实现审查。
