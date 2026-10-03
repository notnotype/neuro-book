# Task 98: leader.assets 用户资产助手重塑

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- `reference/agent/profile-routing.md`（leader.assets 职责行）
- `docs/tasks/58-agent-profile-settings-low-code/README.md`（settingsForm 机制）
- `docs/tasks/60-agent-profile-home/README.md`、`docs/tasks/68-global-profile-home-resource-preset/README.md`（profile home 机制）
- `docs/tasks/90-agent-mode-system/README.md`（ModeAvailabilityReminder 来源）
- `assets/workspace/.nbook/agent/skills/profile-system-guide/`、`assets/workspace/.nbook/agent/skills/tsx-profile-editing/`（本 agent 的知识库）

## User Request / Topic

- `leader.assets.profile.tsx` 提示词长期未更新，落后于 settingsForm、profile home、Task 90 mode 系统等多轮演进。
- 重塑目标：让该 agent 能**向用户介绍并帮助创建、修改、管理用户资产**（profile 怎么写、skill 放哪、变量、模板、设置表单、home 资源、UI 入口分工）。
- 约束：系统性修复、不留技术债、不过度设计、不 hack。
- 用户追加拍板：SkillCatalog 增强为支持 **skill 白名单**；leader.assets 自身加 settingsForm；leader.default 指引句微调。

## Goal

leader.assets 成为用户资产体系的向导 + 执行者：prompt 承载资产地图、UI 入口分工与路由级知识，教学细节下沉到 profile-system-guide / tsx-profile-editing 两个 skill；同时消灭四类结构问题（每轮堆积的裸 Message、SkillCatalog fork 漂移、agent-v2 死文本、缺 Task 90 组件）。验证面：`leader-assets-profile.test.ts` + `profile-dsl.test.ts` 全绿、`profile check/preview` 通过、typecheck 通过。

## Current State

已全部完成并验证（2026-07-08）。

## Decisions / Discussion

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | SkillCatalog fork 漂移 | DSL 层修复：`SkillCatalog` 加 `mode="userAssets"` 文案参数（复用 RuntimeLocationReminder 先例）；**skill 白名单做在契约层**（用户拍板要白名单）：`defineAgentProfile` 加 `skills: {include: [...]}`，在 prepare 包装层统一过滤 `ctx.skills`，所有消费者一致、零 harness 改动。删除 profile 内 fork 函数 `renderUserAssetsSkillCatalogText`。 |
| D2 | AppendingSet 裸 `<Message>` 每轮堆积 | 纯删除。`prepare-run.ts` 无条件落盘 appendingMessages，去重只在 Reminder 节点内部；该句与 system prompt「切回 Project Workspace」原则重复。加负向断言防回归。 |
| D3 | 内联「# 工具使用」段 | 保留内联精简版，不 Import `reference/agent/workspace-tool-use.md`（该文档 Workspace CLI/Bash 段是 Project-Workspace-cwd 视角，对 user-assets cwd 是错误指引）。源码注释标注上游文档。 |
| D4 | leader.assets settingsForm | 加单字段 `customTopSystemPrompt`（textarea），照 leader.default 模式 prepend `<custom_top_system_prompt>`。 |
| D5 | task 工具 | 不加（资产任务短，TaskReminder 噪音大于价值）。 |
| D6 | manifest.description | 更新为「介绍 + 创建/修改/管理 + 指路 UI」表述（AgentCatalog 与路由文档的数据源）。 |
| D7 | leader.default Notes | 补一句「简单配置也可直接在设置界面 Agent Profile 模型面板填写」。 |
| D8 | 白名单语义 | `skills.include` 只是 **catalog 可见性过滤**，不是文件级权限隔离（文件工具仍可读任何 skill 目录）。prompt 与 skill 文档均按此表述，不承诺不存在的隔离。 |
| D9 | prompt/skill 分工原则 | prompt 只承载身份、硬边界、资产地图、路由（去哪做/找谁学）；机制教学与分步操作下沉 skill。后续维护延续此分工，防止 prompt 膨胀。 |

## Verification / Test

- `bun run test server/agent/profiles/profile-dsl.test.ts`：28 用例全绿（含新增 SkillCatalog mode 用例、白名单过滤/校验用例）。
- `bun run test server/agent/profiles/leader-assets-profile.test.ts`：15 用例全绿（重写 leader.assets 断言面 + 新增 settings/白名单行为用例）。
- `bun scripts/build/profile.ts compile --system`：全部 builtin profile 编译通过；`profile preview leader.assets --system` 人工审阅渲染正常。
- `bun run typecheck`：exit 0。
- `bun run test:agent` 全量：除**工作区固有失败**外全绿。固有失败与本任务无关：`neuro-agent-harness.test.ts` Plan Mode 用例（pendingApprovals 断言来自另一条未提交的 harness 工作线自身）、black-box/payload 超时类（同一工作线 + 高负载 flaky）、build-coordinator 2 例（并行负载 flaky，隔离跑通过）。
- 死链检查：skill 内 `docs/modules/agent/harness.md` 引用清零。

## Implementation Walkthrough

批次 1（DSL + 契约基建）：
- `server/agent/profiles/profile-dsl.ts`：`SkillCatalog` 加 `mode?: "workspace" | "userAssets"`；`defaultSkillCatalogText(ctx, mode)` 按 mode 切换 roots 行与「长期资产纪律」行，其余原则共享。
- `server/agent/profiles/types.ts`：`AgentProfileDefinition` 加 `skills?: {include: readonly string[]}`（注释写明可见性语义）。
- `server/agent/profiles/define-agent-profile.ts`：校验链加 `assertProfileSkills`（非空、去重）；prepare 两条包装路径统一走 `withSkillInclude(profile, withDefaultSettings(...))` 过滤 `ctx.skills`。
- `server/agent/profiles/profile-dsl.test.ts`：+2 用例。

批次 2（leader.assets 重塑）：
- `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx` 全量重写：删裸 Message / fork 函数 / agent-v2 死文本；`<SkillCatalog mode="userAssets" />`；`skills: {include: [profile-system-guide, tsx-profile-editing, skill-creator, skill-creator-zh]}`；AppendingSet 加 `<ModeAvailabilityReminder />`；settingsForm（customTopSystemPrompt）；manifest.description 更新；新 system prompt 章节：身份段 / System / 重要原则 / **用户资产地图**（含 templates 两类模板、agents/{profileKey}/ 全局 home、config.json settings 存储、sessions/traces 运行时数据）/ **哪里做什么**（三入口分工 + 常见诉求映射）/ TSX Profile 编辑（压缩 + 双 skill 指路）/ **设置表单与 Home 资源**（新章）/ 变量系统 / Skill 编辑（白名单现状 + skill-creator 指路）/ 工具使用（内联精简）/ 多 Agent 协作 / 输出效率。
- `server/agent/profiles/leader-assets-profile.test.ts`：断言面同步（新增约 30 条正负向断言 + 1 个新用例）。

批次 3（skill 知识落地）：
- `profile-system-guide/SKILL.md`：frontmatter 触发条件、Plain Explanation +2 条人话、Important Paths 重排（死链→docs/profile-tsx/ 与 task 58/60/68、补 home/config/templates 路径）、契约节术语修正（InputSchema→InitialSchema、mainRunToolKeys→toolKeys、删已不存在的 ingest）并补 settingsForm/home/skills 成员、新增 **Settings Form** 与 **Profile Home** 两节（含「给 writer 加文风预设」两条 canonical 路径与 frontmatter 契约，依据 writer.profile.tsx renderStyleResource/renderReferenceResource 实况）、Answering Users 补设置表单/预设两条问答。
- `references/harness-profile-system.md`（基于工作区版本）：删 agent-v2 行；Profile Contract 代码块与规则全面更新（initialSchema/payloadSchema/settingsForm/home/skills/toolKeys/runtime）；ctx.initial/ctx.settings/ctx.home；新增 **Settings Resolution** 与 **Profile Home Lifecycle** 两节；DSL convenience 节点列表修正为真实导出（删 RuntimeContext/WorkspaceReminder/PlotFocusReminder 幻影名）；Skills And Profiles 补白名单段；User-Assets Overlay 补 home 与 settings 路径；Source Index 修死链并补 profile-home.ts / low-code-form。
- `tsx-profile-editing/SKILL.md`：模块契约补 SettingsSchema/Settings 导出说明 + 可选成员代码骨架（settingsForm/home/skills 带注释）+ tool bundle 用法；工作流补第 7 步（settingsForm/home 改后编译与验证）。

批次 4（路由与文档收尾）：
- `reference/agent/profile-routing.md`：leader.assets「适合」列更新为介绍/创建/修改/管理 + UI 指路。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：Notes 补设置面板指引句。
- `PROJECT-STATUS.md`：Recent Tasks 补 Task 98 行。
- 编译：leader.assets 与 leader.default 均已重新 `profile compile --system`。

### 与计划的偏差

- 实施中发现（并非计划内）：编辑 define-agent-profile.ts 的两次 Edit 之间，开发服务器用中间态源码自动重编译了系统 profile，把 `compile_failed` 写进了 assets 侧 `.compiled/manifest.json`，导致 14 个 profile 短暂不可加载。以 `profile compile --system --all` 重编译恢复。教训：dev server 开着时，多步源码编辑期间系统 profile manifest 可能短暂进入失败态，属预期行为，完整源码落盘后重编译即恢复。
- reference 修正超出计划清单两处：DSL convenience 列表中的幻影节点名（RuntimeContext/WorkspaceReminder/PlotFocusReminder）与 Invoke Lifecycle 的 `ingest` 表述，均为核对真实导出后顺手修正。
- 其余按计划执行，无范围变更。

## TODO / Follow-ups

- `reference/agent/workspace-tool-use.md` 拆分评估：把 File Tools/并行调用等通用段与 Project-Workspace-cwd 特有段（Workspace CLI/Bash 绑定）分离，让 leader.assets 可以 Import 通用段，消除内联双份维护（本次以源码注释标注上游代替）。
- `workspace/.nbook/agent/writing-presets/` legacy 目录清理评估：代码 roots 已不含该目录，确认无消费后可删。
- 浏览器验收（可选）：真实进入用户资产界面，验证 leader.assets 新 prompt 的 skill 白名单 catalog、settingsForm 面板与「哪里做什么」指路话术的实际体验。
