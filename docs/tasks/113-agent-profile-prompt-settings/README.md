# Agent Profile Prompt Settings

## Relative documents refs

- [Config System](../03-config-system/README.md)
- [Agent Profile Settings Low-Code](../58-agent-profile-settings-low-code/README.md)
- [Agent Profile Home](../60-agent-profile-home/README.md)
- [Global Profile Home Resource Preset](../68-global-profile-home-resource-preset/README.md)
- [Agent Change Inbox and Prompt Order](../102-agent-change-inbox-and-prompt-order/README.md)
- [Agent Profile Guide](../../../reference/agent/profile-guide.md)

## User Request / Topic

- 优化“配置中心 → Agent Profile 模型”，让界面更简洁、参数边界和提示词系统更清晰。
- 保留 Profile 通用模型参数与单 Profile 模型覆盖。
- 通用运行默认值和单 Profile 运行策略默认折叠。
- 从普通配置中删除 `Compaction Prompt` 与“摘要前缀”，Harness 内部默认仍负责 Compaction 正常运行。
- 把 Profile 自定义提示词升级为可新增、删除、启停和排序的条目结构，并支持整套 Profile 设置预设。
- Writer、Leader 保留结构化特色设置；RP Actor、Cast、Extras 增加符合职责的特色设置。
- 设置修改后在同一 Session 的下一次 invocation 动态生效，不要求重开 Session。
- 完成后必须通过映射测试证明每个设置值确实改变最终 Prompt 或对应运行参数。

## Goal

实现一个安全、可预览、可验证的 Agent Profile 配置体验：普通用户可以在不编辑 TSX 的情况下管理有序提示词条目、切换整套 Profile 设置预设和调整特色行为；系统锁定的身份、工具与输出合同不能被删除或重排。Global 与 Project 配置继续遵守继承和可分享边界。每次 invocation 重新读取 effective config 并动态构建 Prompt，同一 invocation 内保持快照稳定。使用配置合并测试、Profile prepare 映射测试、前端草稿/预设测试和类型检查证明行为；若某个保留的模型字段没有运行时消费者，先报告并系统性接线或移除，不保留只改 UI 的假设置。

## Current State

- 已完成：固定 Top/Bottom 文本改为可新增、删除、启停和排序的 `promptEntries[]`；条目只进入 Profile 开放的 System Prompt 槽位。
- 已完成：新增整套 Profile 设置预设，包含提示词条目和特色设置，不包含模型参数与通用运行策略；人设正文仍使用 Profile Home `prompts/*.md` 资源预设。
- 已完成：Profile settings 与模型设置均使用 `next-invocation` 语义。Harness 每次 invocation 读取最新 effective config；同一 Session 无需重开，当前执行中的 invocation 保持快照稳定。
- 已完成：Agent 变量系统不承担配置真相；使用 settings-backed 声明和 prepare-time 动态渲染，不恢复已下线的公开变量 helper。
- 已完成：Provider 消息顺序仍固定为 `History → ModelContext → AppendingSet → CurrentUserInput`；身份、工具权限、输出合同和分区顺序保持锁定。
- 已完成：Writer、Leader 保留结构化特色设置；`rp.actor` 新增还原度、记忆依据、内心活动、自主行动、信息边界；`rp.cast` 新增重试、汇总、材料检查、缺失角色策略；`rp.extras` 新增反应密度、台词长度、职业差异、群体联动、加戏程度。
- 已完成：模型参数审计后删除无 Pi 通用合同的 `topK`；`temperature` 接入请求参数；原无消费者的 `stream` 改为 `realtimeOutput`，Provider 仍始终流式运行，关闭时只抑制公开增量。
- 已完成：普通配置删除 Compaction Prompt 与摘要前缀，Harness 使用内部常量；运行策略继续保留启停、触发、预留 token 与近期上下文配置。
- 已完成：`promptEntries[]` 新增 `position: "before" | "after"`，配置 UI 明确拆成“前置提示词 → 固定 Profile 结构 → 末尾补充提示词”三段；条目可跨前后槽切换，槽内排序不会越过固定的人设、特色设置、身份/工具协议与输出合同。
- 已完成：配置中心新增“完整提示词预览”，当前草稿与已保存配置都通过服务端真实 `profile.prepare()` 生成，自定义条目在最终 System Prompt 中高亮；草稿资源修改只应用到内存 Profile Home 覆盖层，不落盘。
- 已完成：需要创建期 `initial` 的特殊 Profile 不再因空对象解析而返回 HTTP 500。预览 API 返回稳定 `initial_context_required`，配置中心自动查找同 Profile 的真实 Session，并复用其创建期 `initial`、Project 与历史上下文；没有候选 Session 时明确提示先创建 Session。
- 已完成：同职责特殊 Profile 复用同一份特色设置契约。`rp.writer` 与普通 `writer` 共享 8 项 Writer 设置，`simulator.actor` 与 `rp.actor` 共享 5 项 Actor 设置；各 Profile 仍可保留职责适配默认值和固定 Prompt 合同。
- 已完成：低代码字段支持仅影响显示的 `section` 元数据。配置中心把通用人设/提示词条目归入“提示词系统”，把 Writer、Actor、Cast、Extras、Leader 的职责参数归入“特色设置”，不改变 settings 存储结构。
- 已完成：提示词条目启停控件改为明确的“已启用 / 已禁用”双状态按钮；禁用条目仍保留在草稿和预设中，但不会进入最终提示词。
- 已完成：修复 `leader.default` 旧 Home 缺少 `prompts/default.md` 时阻断所有 Global 配置保存的问题。Leader manifest 升到 v2，由正式 `home.upgrade()` 补齐资源并保留已有用户人设。
- 已完成：预设按钮和说明明确“创建/更新预设草稿”语义；预设修改与其他页面草稿统一由顶部“保存设定”持久化，保存失败同时展示面板错误和全局通知。

## Decisions / Discussion

- D1：设置即时生效的准确语义是“同一 Session 下一次 invocation 生效”；正在执行的 invocation 不热变更。
- D2：提示词条目由 `ctx.settings` 声明并在 Profile prepare 阶段渲染，不使用 `ctx.vars` 作为配置存储。
- D3：可编辑条目只能进入 Profile 明确开放的 System Prompt 槽位；身份、工具权限、输出协议和 Provider 消息分区保持锁定。
- D4：Profile 预设包含提示词条目与 Profile 特色设置，不包含模型参数和通用运行策略。
- D5：Project 有序提示词组合采用完整覆盖；未覆盖时继承 Global，开始编辑时复制当前 Global 组合，不做跨层数组逐项合并。
- D6：`Compaction Prompt` 与 `summaryPrefix` 从普通配置 schema 和设置 UI 移除，Harness 使用内部常量。Profile Workbench 是否保留开发者级 DSL 覆盖不由本页暴露。
- D7：Writer/Leader 等特色设置继续使用类型化字段，不退化为自由文本提示词。
- D8：RP 角色个体性格继续来自 `rp/characters/{id}/人设/soul.md` 与心境/记忆；`rp.actor` 设置只控制所有角色共享的扮演策略。
- D9：自定义条目的稳定顺序合同为 `before 条目 → 固定 Profile 结构 → after 条目`。缺省 `position` 按 `before` 处理，现有配置无需迁移；固定结构不是可编辑条目，不能被删除或跨越重排。
- D10：完整提示词预览必须执行真实 `profile.prepare()`，不能由前端拼接近似文本。需要角色/任务初始化数据时必须使用真实 Session 上下文，不自动伪造 `initialSchema` 字段或角色路径。
- D11：同一职责的变体 Profile 必须复用共享 settings schema、form 和 Prompt renderer，避免只给基础 Profile 加字段而特殊 Profile 静默缺失；职责变体只能覆盖默认值或追加自己的固定合同。
- D12：低代码表单分区属于展示元数据，不进入 settings patch。Leader 原本已有 5 项特色字段，本轮只修复其位于长提示词列表之后、缺少明确分区的可发现性问题，不重复新增第二套 Leader 配置。
- D13：Profile Home 引用的默认资源属于配置保存前置契约。新增或补齐默认资源时必须提升 `manifest.version` 并通过 `home.upgrade()` 迁移，不能只修改初始化函数，否则既有 Home 不会得到新资源并会导致整个配置请求校验失败。
- D14：Profile 预设仍采用页面级草稿事务，不单独绕过配置中心保存。UI 必须清楚提示“创建/更新预设草稿”后仍需顶部保存，保存错误必须在用户离开当前局部表单后仍可见。

## Verification / Test

- 2026-07-30 定向组合：10/12 test files 通过，合计 281/339 tests 通过。通过项覆盖 Prompt 条目顺序/启停、预设元数据、Writer/Leader/RP 映射、Compaction 内部常量、Temperature 请求参数、前端 runtime 草稿、RunFrame 与完整 Harness 主路径。
- RP 修正定向：`rp-profiles.test.ts` 2/2 通过，证明 Actor 五项特色设置逐项生成目标提示词，以及同一 Cast Session 下一次 `prepare` 读取最新条目且不残留旧文本。
- Harness 热更新定向：`neuro-agent-harness.test.ts` 2/2 通过。一项证明 Profile settings 在同一 Session 的两次 invocation 间从 `cinematic` 更新为 `lyrical`；另一项证明第一次 invocation 使用 `temperature=0.2 + realtimeOutput=false`，修改配置后第二次使用 `0.7 + true`。两者都无需重开 Session。
- OpenAPI 生成物已刷新；配置路由不再暴露 `topK`、旧 `stream`、Compaction Prompt 或摘要前缀，并暴露 `temperature` 与 `realtimeOutput`。
- 组合测试偏差：`config-service.test.ts` 57 项在 Windows 初始化阶段因创建 `package.json` symlink 返回 `EPERM`，没有进入业务断言；遗留的 57 个 `nbook-workspace-assets-*` 临时目录已清理。完整 Harness 另有一条既有“已删除 session 模型 recovery”断言失败，与本任务设置映射无关。
- `bun run typecheck` 仅剩既有 `WorldEngineStateOverview.vue:204 TS2589`，Task 113 相关文件无新增类型错误。
- 19 个内置 Profile artifacts 已重新编译。
- 提示词位置/预览定向：`prompt-customization.test.ts`、`profile-home.test.ts`、`profile-http-service.test.ts`、`leader-assets-profile.test.ts` 共 4 files / 33 tests 通过。覆盖 before/after 槽位顺序、Writer 前后条目跨越固定结构的位置、Profile Home 草稿不落盘、真实 Session initial 映射与 19 个 artifact 加载。
- `previewAgentProfilePrepare()` 缺少必填 initial 时返回 `initial_context_required`；选择 `initial.characterId="heroine"` 的 Session 后，真实 prepare 生成 `character:heroine`，证明预览没有使用占位数据。
- 按项目约定未自动执行浏览器验证；建议后续授权一次配置中心手动验收。
- 同职责特色设置修复定向：`rp-profiles.test.ts`、`leader-assets-profile.test.ts`、`low-code-form.test.ts`、`prompt-customization.test.ts` 共 4 files / 60 tests 通过。逐项证明 `rp.writer` 的 Writer 参数和 `simulator.actor` 的 Actor 参数进入最终 System Prompt，并证明 `section` 会被序列化到表单 DTO、但不会污染 settings。
- 真实 user runtime 已同步 7 个 Profile。直接加载 `.compiled` artifacts 复核：`rp.writer` 为 2 个提示词字段 + 8 个 Writer 特色字段，`simulator.actor` 为 2 + 5，`leader.default` 前 2 项属于“提示词系统”、后 5 项属于“特色设置”。
- 本轮复跑 `bun run typecheck` 后没有 Task 113 新增错误，仅剩既有 `WorldEngineStateOverview.vue:204 TS2589`。
- 保存与开关修复定向：`agent-profile-settings-persistence.test.ts`、`leader-assets-profile.test.ts`、`prompt-customization.test.ts`、`low-code-form.test.ts`、`agent-profile-prompt-settings-ui.test.ts` 共 5 files / 50 tests 通过。覆盖 `enabled=false` 从 UI 草稿到 Config 重读保持不变、预设与 active ID 持久化、禁用条目不进入 Prompt、Leader v1→v2 Home 升级和双状态 UI 合同。
- `config-service.test.ts` 的公共 Windows fixture 仍因 `package.json` symlink 返回 `EPERM`，因此保存回归使用独立、无 symlink 的真实 Config Service 测试完成，不把环境失败误报为业务失败。
- `bun scripts/cli/sync-user-assets.ts` 成功（`updatedProfiles=1`）。真实 runtime 只读复核确认 `leader.default/home.json` 已为 v2、`prompts/default.md` 已由 upgrade 自动创建、设置 API 的 Leader issues 为空；未手工修改用户配置。

## Implementation Walkthrough

- 2026-07-30：完成第一轮只读调研并确认方案。发现当前三件套已经提供人设资源预设，但缺少有序条目和整套设置预设；确认 `rp.cast` 与 `rp.actor` 职责不同；确认同 Session 下一次 run 动态生效可直接建立在现有 `ctx.settings` prepare 链路上，不应恢复已下线的公开变量插值系统。
- 2026-07-30：实施前模型参数审计发现现有页面含未接入运行时或缺少上游合同的字段：`reasoningEffort` 已生效；`temperature` 是 Pi 正式参数但 Profile 配置未接入；Pi 0.80.6 `SimpleStreamOptions` 没有 `topK`；Harness 始终依赖 Provider stream，现有 `stream` 配置没有消费者。按照“不能保留假设置或用 Provider-specific payload hack 绕过类型系统”的约束暂停业务代码，等待用户决定 TopK 与 Stream 的产品语义。
- 2026-07-30：用户确认后实施。通用提示词共享层改为 `promptEntries[] + personaPreset + Profile settings presets`；新增 `prompt-list` 低代码组件并把预设操作接入通用 `LowCodeForm`。配置中心默认折叠运行默认值和单 Profile 运行策略，保留模型覆盖与结构化特色设置。
- 2026-07-30：完成运行时接线。Temperature 覆盖 Provider request options；`stream` 更名并实现为 `realtimeOutput` 公开事件策略；每次 invocation 重新读取 effective config。Compaction Prompt/摘要前缀退出普通 DTO，Harness 内部常量继续保证压缩可用。
- 2026-07-30：完成 Writer、Leader 与 RP Actor/Cast/Extras 映射和内置 artifact 重编译。刷新 OpenAPI 内嵌 Schema，并用 Profile prepare + 完整 Harness 两层测试证明同 Session 下一次调用即时生效。
- 2026-07-30：根据用户二次验收反馈，把单一提示词列表升级为前置/末尾双槽，中间展示不可编辑的固定 Profile 结构；19 个内置 Profile 均在真实结构两端渲染对应槽位。新增配置中心完整 System Prompt 预览，草稿/已保存切换均走真实 prepare，并用内存 Profile Home 覆盖层安全应用未保存资源修改。
- 2026-07-30：补齐特殊 Profile 预览上下文。修复原 `sessionId` 已传入但仍用 `{}` 解析 initial 的协议错误；服务端改为复用 Session durable initial 并返回稳定问题码，前端在需要时自动选择同 Profile 最近 Session，避免 `rp.actor`、`simulator.actor`、`director` 等预览直接失败或用伪造角色数据。
- 2026-07-30：根据用户验收继续补齐同职责特殊 Profile。抽出 Writer 与 Actor 的共享 settings 契约，让 `rp.writer`、`simulator.actor` 与对应基础职责保持同一字段集合并动态注入 Prompt；`rp.writer` manifest 升到 v2，以升级现有 Profile Home 的文风/参考资源。Leader 经检查确认运行时字段原本齐全，因此采用低代码表单分区提升可发现性，而非重复造字段。19 个系统 Profile artifacts 已重编译，7 个 Profile 已同步真实 user runtime。
- 2026-07-30：排查“新条目启用无效、预设和配置整体无法保存”。最小 JSDOM 映射测试证明开关事件和 `LowCodeForm → 草稿` 链能正确保留 `false/true`；服务日志进一步定位真实根因为 `leader.default` Home 仍是 v1，缺失设置默认引用的 `prompts/default.md`，导致 `/api/config/global` 整体返回 400，重载后看起来像开关无效。
- 2026-07-30：按系统迁移方式修复而非绕过校验。Leader manifest 升到 v2，既有 upgrade 补齐默认提示词人设；启停控件改为带 `aria-pressed` 的“已启用 / 已禁用”按钮，预设操作明确为页面草稿，保存失败增加全局通知。独立 Config Service 测试和真实 runtime upgrade 均验证通过。

## Changed Files

- `server/agent/profiles/prompt-customization.ts`：有序提示词、Profile 设置预设和安全渲染合同。
- `server/agent/profiles/writer-profile-settings.ts`、`actor-profile-settings.ts`：Writer/Actor 同职责变体共享的 schema、低代码字段和动态 Prompt renderer。
- `shared/dto/low-code-form.dto.ts`、`server/low-code-form/index.ts`、`app/components/common/low-code-form/LowCodeForm.vue`：表单显示分区 DTO、序列化与 UI。
- `app/components/common/low-code-form/LowCodePromptListField.vue`、`LowCodeForm.vue`：条目编辑与整套预设 UI。
- `app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`、`AgentProfilePromptPreview.vue`：折叠布局、模型参数、保存映射与真实完整提示词预览。
- `server/config/agent-profile-settings-persistence.test.ts`、`app/components/novel-ide/settings/agent-profile-prompt-settings-ui.test.ts`：配置持久化与启停/预设/通知 UI 合同回归。
- `server/agent/profiles/profile-http-service.ts`、`profile-home.ts`：真实 prepare 草稿预览、Session initial 复用与只读 Profile Home 覆盖层。
- `shared/dto/agent-profile.dto.ts`：草稿设置、资源 mutation、Project/Session 预览上下文协议。
- `shared/dto/app-settings.dto.ts`、`shared/agent/profile-runtime-settings.ts`、`server/config/normalizer.ts`：配置 DTO、运行策略与继承。
- `server/agent/harness/neuro-agent-harness.ts`、`pi-request-options.ts`：Temperature 与公开实时输出行为。
- `assets/workspace/.nbook/agent/profiles/builtin/*.profile.tsx`：内置 Profile 提示词槽位、特色设置及生成 artifact。
- `server/api/config/**`：由 `generate-openapi-meta` 刷新的配置 API Schema。

## TODO / Follow-ups

- [x] 完成提示词条目与 Profile 设置预设协议。
- [x] 完成配置中心 UI 收敛。
- [x] 完成 Writer、Leader、RP Actor/Cast/Extras 特色设置。
- [x] 完成设置到 Prompt/运行参数的映射测试。
- [x] 更新稳定 reference、PROJECT-STATUS 与最终计划偏差。
- [ ] 用户授权后执行浏览器手动验收：Global/Project 继承、前置/末尾槽切换与槽内排序、固定结构定位、草稿/已保存完整预览、特殊 Profile Session 上下文、预设切换、特色设置和实时输出开关。
