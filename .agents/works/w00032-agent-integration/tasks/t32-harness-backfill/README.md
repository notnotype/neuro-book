---
schema: nbook.task/v2
taskId: t32-harness-backfill
status: planned
updated: 2026-11-09
---

# 把落在 nbook.agent 里的通用部分补回 nb-harness

## 目标与范围

[t02](../t02-harness-baseline/README.md) 决定 3 按“离开 NeuroBook 还能不能用”分工：运行时、会话格式与存储接口、Profile 渲染、工具登记、审批判定与提问通道、压缩、模型目录与凭据接口、资源地址的登记机制、通用文件工具归 harness。内核（t20）照此落地；之后 t06、t11、t12 等把其中几块写进了 `nbook.agent` 与 `nbook.models`，Task 记录里没查到这样放的理由。本 Task 把它们补回 nb-harness，行为不变。

起因：NeuroBot（[w00043](../../../w00043-neurobot/README.md)）作为 monorepo 里的新应用、在 nb-runtime 上自建，要复用这些能力；仓库规则不许领域包依赖应用包。

要补回的（2026-11-09 按目录与行数粗估，实现约 3,800 行）：

| 块 | 现在 |
|---|---|
| 压缩的三种方法、切点、放回 | `packages/neuro-book/src/plugins/agent/backend/compaction/` |
| 审批判定：规则、bash 方言、审批模型、模式 | `…/agent/backend/permissions/`（作品目录的规则 `project-rules.ts` 留下） |
| 守卫：花费、循环、拒答 | `…/agent/backend/guards/`（接设置的部分留下） |
| 会话句柄表、会话元数据 | `…/agent/backend/sessions.ts`、`session-meta.ts` |
| 通用工具 read、write、edit、search、shell、ask、image | `…/agent/backend/builtin/`；合并 `nb-harness/src/tools/` 里旧的 read、edit |
| 资源视图 | `…/agent/backend/resources.ts` 与 `agent/shared/resources.ts` |
| 模型角色、压缩触发点的规则 | `packages/neuro-book/src/plugins/models/shared/` |

留在 `nbook.agent`：把 harness 装成 nb-runtime 插件的接线（贡献点、Profile 包加载、扩展）、给界面的远程接口、附件的 HTTP 路由、NeuroBook 的地址方案（`project://`、`docs://` 等）、作品目录的审批规则、设置页、NeuroBook 专有工具。

“把 harness 装成 nb-runtime 插件的接线”这一层本 Task 不抽：NeuroBot 的会话按“哪个 bot、在哪里聊”开，接线会不同；等 NeuroBot 写出来再比重复多少。

已知的设计点：

- **文件访问接口**：工具、放回、审批判定都经 `nbook.files` 读写与解析地址（写入按 [ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md) 暂存、由根的拥有者提交并记账；地址方案按 [t08](../t08-resources-home/README.md) 注册在文件服务里），几块互相引用（`permissions/hook.ts`、`permissions/modes.ts`、`compaction/restore.ts` 引用 `builtin/common.ts`、`builtin/read.ts`、`resources.ts`），要一起搬。在 harness 里定一个由宿主传入的文件访问接口：NeuroBook 用文件服务实现，NeuroBot 直接读写 bot 的电脑。
- **写小说专用的部分改成参数**：压缩摘要的小节按写小说定（[t11](../t11-compaction/README.md) 决定 5），改成由 Profile 或宿主给，现有那份留在 NeuroBook。
- **审批判定者可替换**：NeuroBot 要让另一个 bot 判定工具调用（开发者 2026-11-09，w00043），这与本 Work [t14](../t14-multi-agent/README.md) 决定 8“审批一律交给用户”对 NeuroBot 不同。本 Task 不实现，但搬过去的判定接口不能把“判定者是用户或审批模型”写死。
- **依赖**：nb-harness 新增 `unbash`（纯 JS、无依赖）与 `nb-form`（只依赖 TypeBox）；`pi-natives` 已在。nb-harness 以源码发到 npm、nb-story 依赖它（[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)），nb-story 本来就依赖 nb-form。

非目标：不改用户可观察的行为、贡献 id（例如 `nbook.agent.shake`）、设置与界面；不实现 NeuroBot 的任何东西；不做 t14 的子代理与任务中心。

合同：行为合同未变；[`agent/compaction.md`](../../../../../docs/specs/agent/compaction.md)、[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md)（都是 `implemented`）的 owner 与实现合同几节随代码改；可能还有 `docs/specs/harness/` 下对应的几份。

## 授权与限制

- 开发者 2026-11-09（w00043 t01 讨论）同意按 t02 决定 3 补回 nb-harness、不新建包；时机与 t14 的界面静态稿阶段并行。
- 另一个会话在做 t14（静态稿评审）：本 Task 不改 t14 的记录与草稿；t14 的前后端实施在本 Task 合入之后开始，它的通用部分直接写进 nb-harness。
- 搬完加一条架构测试：nb-harness 不出现 NeuroBook 的名字、不依赖 `nbook.files`（参照 `packages/nb-runtime/src/app-neutral.test.ts`）。

## 当前状态

2026-11-09 新建，未开工；先写 `plan.md`，开发者确认后实施。

## 下一步

按 [implementation-planning](../../../../skills/implementation-planning/SKILL.md) 写 `plan.md`。
