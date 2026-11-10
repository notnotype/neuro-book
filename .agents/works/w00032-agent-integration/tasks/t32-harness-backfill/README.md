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
- **依赖**：nb-harness 新增 `unbash`（纯 JS、无依赖）；`pi-natives` 已在。`ask` 用到的 `nb-form` 包级依赖 nb-ui 与 Vue（本 README 第一稿误写成“只依赖 TypeBox”，计划改为表单校验由宿主注入，nb-harness 不依赖它）。nb-harness 以源码发到 npm、nb-story 依赖它（[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。

非目标：不改用户可观察的行为、贡献 id（例如 `nbook.agent.shake`）、设置与界面；不实现 NeuroBot 的任何东西；不做 t14 的子代理与任务中心。

合同：行为合同未变；[`agent/compaction.md`](../../../../../docs/specs/agent/compaction.md)、[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md)（都是 `implemented`）的 owner 与实现合同几节随代码改；可能还有 `docs/specs/harness/` 下对应的几份。

## 授权与限制

- 开发者 2026-11-09（w00043 t01 讨论）同意按 t02 决定 3 补回 nb-harness、不新建包；时机与 t14 的界面静态稿阶段并行。
- 另一个会话在做 t14（静态稿评审）：本 Task 不改 t14 的记录与草稿；t14 的前后端实施在本 Task 合入之后开始，它的通用部分直接写进 nb-harness。
- 搬完加一条架构测试：nb-harness 不出现 NeuroBook 的名字、不依赖 `nbook.files`（参照 `packages/nb-runtime/src/app-neutral.test.ts`）。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-11-10 | 开发者：“我觉得可以依赖 nb-form”。推翻计划第二稿确认项第 1 条的推荐（表单校验由宿主注入）：nb-harness 直接依赖 nb-form，`ask` 照现在用它校验表单。代价（主 Agent 核实）：nb-form 的包级依赖有 nb-ui 与 Vue（非可选 peer），装 nb-story 时会连带装上；运行时只加载 nb-form 的核心入口（只依赖 TypeBox） |

## 当前状态

2026-11-10：[plan.md](plan.md) 初稿（Opus）做了计划审查（Opus，15 条，[`evidences/plan-review-r1-opus.txt`](evidences/plan-review-r1-opus.txt)）与文件访问接口的独立设计（Sonnet，[`evidences/plan-independent-design-r1-sonnet.txt`](evidences/plan-independent-design-r1-sonnet.txt)），按下表改第二稿。开发者 2026-11-10 选了 NeuroBot 提案待定项 1 的 (b)：模型服务（`models/backend/core.ts`）由 [w00043 t02](../../../w00043-neurobot/tasks/t02-host-base/README.md) 抽，本 Task 不碰它的服务部分、`server/` 与 `web/`。

### 计划第一稿的处理

| 来源 | 结论 | 第二稿怎么改 |
|---|---|---|
| 审查 1：浏览器早已在运行期导入 nb-harness（`shared/remote.ts:16`） | 成立 | 风险改写成新增两个子路径的导入链：类型只能 `import type`，`vue-tsc` 会顺着类型导入检查哪些文件 |
| 审查 2、3、12：`modelChoice` 漏了按用途定角色两步、导入边界；按开发者定的 (b) 模型服务归 w00043 t02 | 成立 | t32 只搬 `models/shared/rules.ts`、`compaction.ts`（`rules.ts` 只依赖 `typebox` 与 `import type`），`port.resolve` 的选择顺序留给 w00043 t02；确认项第 6 条删去 |
| 审查 4：`kit/compaction` 要用角色常量，分层表不许 | 成立 | 角色常量放进 `kit/shapes.ts` |
| 审查 5：句柄表换成 `clock.wait` 后到点之后取消不再生效 | 成立（审查者已降为低） | kit 的句柄表收 `schedule(cb, ms) => cancel` 形状的计时口，保住同步取消，不经 `Clock.wait` |
| 审查 6：判定者只在 `auto` 那一步可换，其余转问写死交给用户 | 成立，涉及开发者定的“判定接口不能写死判定者” | 钩子加 `escalate` 选项：所有要转问的调用（规则、闸门、地址分类、项目规则读坏、审批模型转人工）都经它，带来源；缺省原样交回 `ask`，NeuroBook 不传、行为不变 |
| 审查 7：`localFiles` 当成 NeuroBot 的实现，缺写锁与改动记录 | 成立 | `localFiles` 定位为 kit 测试的真实依赖与参考实现，`classify` 必传；NeuroBot 自己实现 `SessionFiles`（可以包它），写锁与改动记录在 NeuroBot |
| 审查 8：baseline 漏了 kit 自带的文字 | 成立 | baseline 加放回提示、shake 占位、模式拒绝文字、循环守卫提醒、摘要输入的排版、标题材料，都用固定输入调真实函数 |
| 审查 9：没有测试证明 `localFiles` 与 NeuroBook 实现在失败码上一致 | 成立 | kit 导出参数化的 `SessionFiles` 合同测试，两个实现各跑一遍 |
| 审查 10：代码与守它的测试同一片里一起改写 | 成立 | 每片两次提交：先只搬实现、应用测试只改导入照跑通过；再把用例改写进 kit；`auto-review.test.ts` 每组写明去向 |
| 审查 11：两处会进日志的文字被改 | 成立 | 项目规则读坏的诊断消息由宿主给；错误类改名列为 baseline 的预期差异 |
| 审查 13：只读检查漏了别的写盘写法 | 成立（`EditSession` 那半句审查者已撤回） | 改成白名单式：禁命名空间与默认导入、`Bun.file(…).write`、`.writer(`、`Bun.$`、`Bun.spawn`、动态 `import(`，`shell.ts` 的执行入口单独放行 |
| 审查 14：kit 没有自己的合同 | 成立 | 开一份 draft `docs/specs/harness/host-kit.md`，先写 `SessionFiles` 的合同（失败码、`locate`、`forCall` 的分组与来源、全文）；其余块的宿主无关条目留到 NeuroBot 接入时 |
| 审查 15、独立设计：`SessionLayout` 塞了别的功能的配置 | 成立 | 布局只留与文件访问和判定相关的：工作目录、草稿根、本地写的根、必须询问的写、搜索时跳过的；计划文件、日志地址、项目根改由放回与审批模型各自的选项给 |
| 独立设计：方法名与现有 `SessionResources` 一致 | 采纳 | NeuroBook 的现有对象结构上直接满足接口，只补布局 |
| 独立设计：`decodeText`、`renderVirtual` 只留一份 | 采纳 | 搬进 nb-harness，`nbook.files` 改为从那里取；删去“两份对照”的风险条目 |
| 独立设计：模式（`switch_mode` 与提醒文字）整个留在 NeuroBook | 采纳：没有第二个使用者 | kit 只给钩子要的闸门分类（按草稿根判断）；`createAgentModes` 不进 kit |
| 独立设计：NeuroBot 的“目录外读要审批”用缺省规则表达 | 采纳 | 接口不为它加字段；写进计划的“不做” |

## 下一步

第二稿（2026-11-10，按上表改，另有几处落实时必须一起改的：浏览器要用的 `./kit/files` 不引 node、`localFiles` 拆到 `./kit/files/local`；模式闸门的文字由宿主给；`escalate` 的来源加 `mode`；`ReviewRequest` 去掉 `project`）已写，交开发者确认计划第七节的 4 项。确认后建 worktree 开工；t14 的前后端实施在本 Task 合入之后。
