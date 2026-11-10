---
schema: nbook.task/v2
taskId: t32-harness-backfill
status: done
updated: 2026-11-10
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
| 通用工具 read、write、edit、search、shell、ask、image | `…/agent/backend/builtin/`；`nb-harness/src/tools/` 里旧的 read、edit 不合并、不改，留给 [t31](../t31-nb-story-new-kernel/README.md) 随 `createHarness` 一起删（见“决定”） |
| 资源视图 | `…/agent/backend/resources.ts` 与 `agent/shared/resources.ts` |
| ~~模型角色、压缩触发点的规则~~ | 不在本 Task：2026-11-10 改由 [w00043 t02](../../../w00043-neurobot/tasks/t02-host-base/README.md) 搬进新包 `nb-models`（见“决定”） |

留在 `nbook.agent`：把 harness 装成 nb-runtime 插件的接线（贡献点、Profile 包加载、扩展）、给界面的远程接口、附件的 HTTP 路由、NeuroBook 的地址方案（`project://`、`docs://` 等）、作品目录的审批规则、设置页、NeuroBook 专有工具。

“把 harness 装成 nb-runtime 插件的接线”这一层本 Task 不抽：NeuroBot 的会话按“哪个 bot、在哪里聊”开，接线会不同；等 NeuroBot 写出来再比重复多少。

已知的设计点：

- **文件访问接口**：工具、放回、审批判定都经 `nbook.files` 读写与解析地址（写入按 [ADR 0040](../../../../../docs/adr/0040-file-writes-staged-and-committed-by-root-owner.md) 暂存、由根的拥有者提交并记账；地址方案按 [t08](../t08-resources-home/README.md) 注册在文件服务里），几块互相引用（`permissions/hook.ts`、`permissions/modes.ts`、`compaction/restore.ts` 引用 `builtin/common.ts`、`builtin/read.ts`、`resources.ts`），要一起搬。在 harness 里定一个由宿主传入的文件访问接口：NeuroBook 用文件服务实现，NeuroBot 直接读写 bot 的电脑。
- **写小说专用的部分改成参数**：压缩摘要的小节按写小说定（[t11](../t11-compaction/README.md) 决定 5），改成由 Profile 或宿主给，现有那份留在 NeuroBook。
- **审批判定者可替换**：NeuroBot 要让另一个 bot 判定工具调用（开发者 2026-11-09，w00043），这与本 Work [t14](../t14-multi-agent/README.md) 决定 8“审批一律交给用户”对 NeuroBot 不同。本 Task 不实现，但搬过去的判定接口不能把“判定者是用户或审批模型”写死。
- **依赖**：nb-harness 新增 `unbash`（纯 JS、无依赖）与 `@notnotype/nb-form`（只导入核心入口，见“决定”）；`pi-natives` 已在。nb-form 的 `nb-ui`、`vue`、`typescript` 改为可选 peer，装 nb-story 不连带装上 Vue 一套（本 README 第一稿误写成 nb-form“只依赖 TypeBox”，那只是核心入口的运行时依赖）。nb-harness 以源码发到 npm、nb-story 依赖它（[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。

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
| 2026-11-10 | 开发者：“我想要 nb-harness 的数据结构支持表单，但是不用 nb-form 的 vue 组件实现。”做法：nb-harness 只导入 nb-form 的核心入口（表单描述、检查、解析、校验；运行时只依赖 TypeBox，对 nb-ui 只取文字值的类型，由 nb-form 的 `boundary.test.ts` 守着），不导入 `./vue`，nb-harness 加一条导入边界测试守住；表单怎么画由各宿主决定。为了装 nb-story 时不连带装上 Vue 一套，nb-form 的 `nb-ui` 与 `vue` 改为可选的 peer 依赖（只有 `./vue` 用到），并加进 nb-form 的开发依赖供它自己的测试用；这一步是主 Agent 的推荐，放进本 Task，开发者有异议再改 |
| 2026-11-10 | 开发者：压缩摘要的小节“由应用决定”（确认项第 3 条按推荐） |
| 2026-11-10 | 开发者同意 w00043 t02 的三项（答“可以”）：模型服务放进新包 `nb-models`，所以本 Task 不再搬 `models/shared/rules.ts`、`compaction.ts`（改由 w00043 t02 搬进 `nb-models`），`./models/rules` 子路径删去；kit 要用的压缩角色 id 留在 `kit/shapes.ts`。确认项第 4 条（新增公开子路径）按推荐，清单按第三稿实际的目录 |
| 2026-11-10 | 计划第三稿“需要开发者确认”第 1 条按“待确认默认追认”算定（开发者同意 w00043 的 Task 规划时它还列着、没有单独作答）：旧 `src/tools/` 不合并、不改，留给 t31 删；`registerBuiltinTools`、`createReadTool`、`createEditTool` 是已发布包根入口的导出，删除属于发布合同变更，合入时记进 t31 的“要做的事”。代码由谁写没有答复，按开发者的全局规则由主会话写 |

## 当前状态

2026-11-10：[plan.md](plan.md) 初稿（Opus）做了计划审查（Opus，15 条，[`evidences/plan-review-r1-opus.txt`](evidences/plan-review-r1-opus.txt)）与文件访问接口的独立设计（Sonnet，[`evidences/plan-independent-design-r1-sonnet.txt`](evidences/plan-independent-design-r1-sonnet.txt)），按下表改第二稿。开发者 2026-11-10 选了 NeuroBot 提案待定项 1 的 (b)：模型服务（`models/backend/core.ts`）由 [w00043 t02](../../../w00043-neurobot/tasks/t02-host-base/README.md) 抽，本 Task 不碰它的服务部分、`server/` 与 `web/`。

2026-11-10：按“决定”表改出第三稿（Opus）：`ask` 直接从 nb-form 核心入口导入、删去 `AskForms`；新增第 1 片把 nb-form 的 `nb-ui`、`vue`、`typescript` 改为可选 peer（`typescript` 是计划另加的：它也只有 `./vue` 用到，不标可选装 nb-story 仍会装上它），`release:smoke` 的 `smokeStory` 加一条“装好后没有 nb-ui、vue、typescript”的检查，并实测 `bun pm pack` 会改写 peer 里的 `workspace:^`；删去模型规则那一片、`./models/rules` 与 `models.e2e.ts`。主 Agent 核对：`./vue` 的消费者（应用、nb-story 网页、冒烟的 Vue 宿主）都自己依赖 nb-ui 与 vue，nb-story 的这两个只在开发依赖里；`bun.lock` 里没有包硬依赖 `typescript`，那条检查在第 1 片成立。

### 实施进度

代码在 `.worktree/w00032-t32-harness-backfill`（分支 `feat/w00032-t32-harness-backfill`），主会话写。

- 开工前：draft Spec [`harness/host-kit.md`](../../../../../docs/specs/harness/host-kit.md) 已提交；baseline 录在 `.local/agent/works/w00032-agent-integration/tasks/t32-harness-backfill/baseline.json`（dump 脚本是不提交的 `packages/neuro-book/src/plugins/agent/t32-baseline.dump.test.ts`，两次运行逐字相同）。
- 第 1 片（nb-form 的可选 peer）：`release:check`、nb-form 测试与类型检查、应用与 nb-story 的类型检查、nb-story `build:web`、`release:smoke`（在干净克隆里跑，tarball 里 nb-form 的 peer 已改写成 `^0.3.0`，装 nb-story 不带 nb-ui、vue、typescript）都通过。
- 第 2 片（kit 骨架与边界测试）、第 3 片（文件访问接口、本机参考实现、合同测试）已提交；第 3 片后 baseline 逐字相同。合同测试两个实现都过（本机 13 条，NeuroBook 经真实插件 21 条）。

- 第 4 片（读、写、改、搜索、预览、命令方言）、第 5 片（shell、ask，nb-harness 依赖 nb-form 核心）已提交，两片后 baseline 都逐字相同；第 5 片后 `release:check` 通过（发布顺序 nb-form 在 nb-harness 前），`agent-conversation.e2e.ts` 19 条通过。
- 第 6 片（压缩方法与放回）、第 7 片（审批判定、钩子、审批模型）、第 8 片（运行守卫、会话句柄表、标题生成）已提交，每片后 baseline 逐字相同；第 7 片后 `agent-conversation.e2e.ts` 19 条通过。
- 第 9 片（2026-11-10）：nb-harness README 加宿主套件一节，`docs/omp-capabilities.md` 补 kit 用到的 `pi-natives` 能力；分支变基到 master 后跑合入前清单：
  - baseline 最后一次对照逐字相同。
  - `bun run test:affected --package nb-form --package nb-harness --package scripts --with-consumers --typecheck`：7 项的类型检查全过；测试失败 9 条都是负载 10 到 22 时的超时（内核日志存储 1 条、nb-story 命令行 7 条、SDK 打包的类型诊断 1 条），单独重跑全过（27、73、12 条）。不带 `--package` 时因为 `bun.lock` 有改动会选全量，按计划只选这几项。
  - `release:check`、`governance:check` 通过。`release:smoke` 第一次失败：插件 SDK 的类型打包没有 `@notnotype/nb-harness/kit/files` 到源码的映射，生成不出 `decodeText`、`renderVirtual` 的声明（`files/shared/contracts.ts` 转出它们）；`plugin-sdk/pack.ts` 补上映射后在干净克隆里重跑 14 项全过，含“nb-story 的安装里没有 nb-ui、vue、typescript”。
  - 真实模型：计划列的 5 个 `*.llm.test.ts` 共 7 条通过，没有跳过。
  - 变异检查 9 项拦住 8 项：只读白名单、浏览器链、nb-form 子路径、应用名、合同测试（`localFiles` 把未登记的方案报成 `not-found`；它没有虚拟根，计划写的“虚拟根报别的码”只在 NeuroBook 那一遍有）、钩子调审批者的条件、调转问的条件、句柄表拿引用时的同步取消。没拦住的是空闲回调里对引用数的复查：拿引用只有一条路径并且同步取消计时，按 `SessionTableClock` 的合同（取消同步生效）这条复查走不到，是冗余保护，不补测试。smokeStory 的检查另在克隆里把 nb-form 的 `vue` 改回非可选 peer 跑冒烟。
  - `docs:check` 报 24 条失效链接，都是 `docs/specs/agent/` 证据行指向已搬走的文件，按计划合入后在主工作区紧接着改。

与计划的偏差：

- baseline 没录“标题生成的两种材料”与“项目规则读坏时的诊断消息”：只能在真实运行里取，搬家时逐字对照源码。
- `kit/testing` 单元除 `bun:test` 外还用 `node:fs/promises`、`node:os`、`node:path`：合同测试要在夹具目录里放文件与链接。
- 两条扫描整个 `src/` 的检查改用 TypeScript 的 `preProcessFile` 取说明符：建语法树每条要 1.5 秒，超出快速测试的预算。
- 合同测试发现 `host-kit.md` 漏了“只读方案的写为 `unsupported-capability`”（NeuroBook 现有行为，文件服务的能力矩阵），已在 master 补上。
- 应用名扫描的正则另加了 `nbot`、`neurobot`。
- kit 的工具交出两组：`builtinDeclarations(texts)`（纯数据，宿主静态登记贡献要用）与 `builtinTools({stores, dialects})`，不是计划写的一个工厂；`renderSnapshot` 留在 `tools/read.ts`，`snapshot.ts` 只放 `SessionEditStores`。
- nb-harness 的 tsconfig `lib` 升到 ES2023：图片缩放用 `findLast`。
- 改写用例时查出本机参考实现两处不合合同（上级是文件报 `io-failed`、认不出的错误把本机路径带进 `detail`），已修，并把“路上有一段是文件”补进合同测试。
- `ask` 的 kit 测试按内核 `QuestionAnswer` 的类型直接给回答，没用 `createTestSession`；经真实提问通道的一条留在应用。
- 第 3 片第二次提交漏跑应用名扫描，合同测试注释里的应用名由单独的修正提交去掉。
- 第 7 片：kit 的 `decide` 交回询问的来源（`rule`、`gate`、`mode`），闸门文字由宿主经 `gateTexts` 给，`rules.test.ts` 里调 `decide` 的地方随之加参数；`MODE_BLOCKED_TEXT` 移到应用的 `backend/permissions/index.ts`；第一次提交里审批模型超时那条用例已改用 `modelReviewer`（宿主文字照旧）。`auto-review.test.ts` 留在应用的是“模型看到什么”（要真实会话日志）与“读、作品与草稿里的写”“用户设置的写”（NeuroBook 的地址分类）。
- 第 8 片：守卫写成 `costGuard({id, limits})`、`loopGuard({id, threshold})`；标题生成的 Profile 与两种材料由宿主给（`titleProfile`、`material`），扩展用 `sessionMetaExtension({id, tag, notify})`；句柄表的计时口是 `SessionTableClock`（`schedule` 交回取消函数）。“触发器在真实内核上”那条用例搬进 kit 的 `sessions/meta.test.ts`。
- 架构测试的浏览器链规则起初把 `import type {Static} from "typebox"` 也算越界，改为 `typebox` 的值导入与类型导入都放行。
- baseline 的 dump 脚本随第 7、8 片改用 kit 的 `decide`（去掉新加的 `source` 再比）、带 NeuroBook 文字的 `modelReviewer` 与 `runGuards` 的替身，取的仍是真实导出。
- 第 9 片多改了计划没列的 `packages/neuro-book/plugin-sdk/pack.ts`（见上：发布冒烟查出的 SDK 类型映射）。`plugin-sdk/pack.test.ts` 本来就会拦住它，各片只跑了 Agent 相关的测试，到合入前的清单才跑到。

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

2026-11-10 合入 master（合并提交 `1b7d042c6`），按计划“Spec 与文档改动”改了 `docs/specs/agent/` 下八份 Spec 的 owner、实现合同与证据（行为合同不变）、`harness/host-kit.md` 的证据与注册表“待晋升”、`ui/forms.md` 的依赖、`docs/modules/monorepo-boundaries.md`；删旧 `src/tools/` 记进 [t31](../t31-nb-story-new-kernel/README.md)。

- `harness/host-kit.md` 晋升 `implemented` 待开发者批准。
- 接着做 [w00043 t02](../../../w00043-neurobot/tasks/t02-host-base/README.md)（nb-file-lock、nb-host、nb-models），t14 的前后端实施也可以开始。
