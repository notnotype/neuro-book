# t46 实施计划：Profile 声明按 id 引用扩展

## Context

开发者 2026-11-25 报告：装了一个带新 Profile 的插件，在 Profile 面板里给它配上能力后，切换模式（普通、讨论、计划）的按钮点了报“发送失败(unknown-extension)”。

根因（读代码确认）：

- 界面按 Profile 目录里声明的工具有没有 `nbook.agent.switch-mode` 决定显示模式控件（`agent/web/session-host.ts` 的 `hasModes`）。
- 模式扩展 `nbook.agent.modes` 与提醒 `nbook.agent.mode-reminder` 只装在把扩展对象写进 Profile 实现 `extensions` 里的 Profile 上：主创、临时 Profile 直接 import，伴聊 bot 经 `agentProfilePartsKey` 服务取。第三方插件经 SDK 拿不到这两个对象，用户级 Profile 也拿不到。
- 于是列了 `switch_mode` 却没装扩展的 Profile：控件出现，`changeSettings({"nbook.agent.modes": …})` 在 `settingsProblem` 里得 `unknown-extension`。

开发者已确认的决定（2026-11-25，会话里答）：

1. 修法是“声明里按 id 引用扩展”，不是“扩展跟着 switch_mode 装”。
2. 没声明 `switch_mode` 的 Profile，只要装了模式扩展，用户照样能切模式，只是 Agent 不能主动切。即：模式控件跟着扩展走，`switch_mode` 只管 Agent 主动申请。

依据：[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)（输出 1、4、14）、[`agent/modes.md`](../../../../../docs/specs/agent/modes.md)、[`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md)（装配、输出 1 与 28）、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 57、[ADR 0027](../../../../../docs/adr/0027-builtin-and-third-party-plugins-are-equal.md)（内置与第三方经同一贡献点，没有内部登记表）。

## 技术选型

无。

## 关键设计

### 概念：按需扩展

`agent.extensions` 贡献现在一律装到所有 Profile（Profile 只能按标签排除或 `"none"`）。新增一种**按需扩展**：声明写 `install: "on-request"`，不自动装；Profile 按 id 引用它才装。内置的模式扩展改成按需扩展经贡献点交出（ADR 0027：不留内部对象直传的路），主创、临时、伴聊三个 Profile 改为按 id 引用。

装上的规则（内核装配时算）：

1. 自动扩展（缺省）：照旧，按 `pluginExtensions` 的标签排除；`"none"` 时一个都不装。
2. 按需扩展：Profile 引用了它的 id 时装上，与 `pluginExtensions` 的排除无关（引用是显式的）。
3. 伴随：一个按需扩展声明的依赖里有一个已装上的按需扩展、且它自己的依赖都满足时，跟着装上。模式提醒 `nbook.agent.mode-reminder` 依赖 `nbook.agent.modes`，所以引用 `nbook.agent.modes` 就带上提醒；Profile 作者只写一个 id。
4. 引用的 id 没有对应的按需或自动扩展：装配问题 `dependency-missing`（`extension` 为 Profile 的 id，`dependency` 为引用的 id）。沿用现有语义：新建会话 `profile-invalid`，打开已有会话进只读 `dependency-missing`；提供方晚到后重新装配即解除。

### `packages/nb-harness/src/kernel`

- `api/profile.ts`：Profile 加 `referencedExtensions?: readonly string[]`（按 id 引用的按需扩展），与 `pluginExtensions`（自动扩展的排除）互不影响：`"none"` 的 Profile 也能引用。不复用 `pluginExtensions` 的对象形状，免得 `"none"` 与引用打架。`DefineProfile` 的类型同步。
- `api/extension.ts`：`ContributedExtension` 加 `onRequest?: boolean`。
- `api/host.ts` 的 `ExtensionHandle.declaration` 加 `install?: "on-request"`；`session/agent-host.ts` 的 `contributed()` 带上 `onRequest`。
- `extension/assemble.ts` 的 `assemble`：按上面 1–4 算 `plugins`；伴随按依赖闭包迭代到不再增加。其余检查（前缀、重名、成环、拓扑序、哈希）不变。

### `packages/neuro-book/src/plugins/agent`

- `shared/points.ts`：`ExtensionDeclarationSchema` 加 `install: Optional(Literal("on-request"))`；`ProfileDeclarationSchema` 加 `extensions: Optional(Array(String))`（引用的扩展 id）。
- `backend/profiles.ts` 的 `resolve`：插件 Profile 的声明有 `extensions` 时，交给内核的对象是实现加上 `referencedExtensions`（声明的与实现自己写的取并集）。用户级 Profile 直接在 `defineProfile` 里写 `referencedExtensions`。
- 目录详情（输出 14）：每项加 `extensions`：插件 Profile 取声明的，用户级取上一次成功的包里的 `referencedExtensions`。
- `backend/plugin.ts`：模式扩展与提醒作为两条 `agent.extensions` 贡献交出（`install: "on-request"`，提醒的声明 `dependsOn: ["nbook.agent.modes"]`），声明加进 `contributions`、实现加进 `[EXTENSIONS_POINT]`；声明 `onAgentSession:open` 已覆盖（同 `SUBAGENTS_EXTENSION` 等）。删掉 `agentProfilePartsKey` 服务（唯一使用方是伴聊 bot）。
- `backend/builtin/profiles/main.ts`、`adhoc.ts`：实现里去掉 `...modesExtensions`；声明（`MAIN_DECLARATION` 等）加 `extensions: ["nbook.agent.modes"]`。
- `backend/subagents/tools.ts:343` 的 `modal` 判断改读子 Profile 的引用（`referencedExtensions` 含模式扩展），不再在 `profile.extensions` 里找对象。
- `web/session-host.ts` 的 `hasModes`：改成目录详情的 `extensions` 含 `nbook.agent.modes`（目录还没加载时仍按有算，免得闪）。有会话时以会话自己的扩展状态为准（会话元数据里模式扩展是否 active），没有会话时用目录。`switch_mode` 不再参与。

### `packages/neuro-book/src/plugins/bots/backend`

- `profile.ts` 的 `companionProfile` 去掉 `parts`；声明加 `extensions: ["nbook.agent.modes"]`。`plugin.ts` 去掉对 `agentProfilePartsKey` 的依赖。

### 旧会话

模式扩展从“Profile 自带”（所属插件为 null）变成“`nbook.agent` 贡献”，装配序与清单里的所属插件变了，打开旧会话时哈希不同，写 `profileChanged{code-updated}`（extensions.md 输出 28，这是预期）。扩展设置按扩展 id 存（`settingsChanged{extension: "nbook.agent.modes"}`），id 不变，旧会话的模式保留；提醒的片同 id 保留。用一条测试钉住：在旧装配下切到 `plan`，换新装配后重开，模式仍是 `plan`、闸门照拦。

## Spec 与文档改动

- `docs/specs/agent/contributions.md`：输入里扩展声明加 `install`、Profile 声明加 `extensions`；新增输出“按需扩展”（规则 1–4）；输出 14 目录详情加 `extensions`；验收场景加一条（第三方插件 Profile 引用模式扩展）。
- `docs/specs/agent/modes.md`：术语里“主 Profile 装模式扩展”改为“按 id 引用 `nbook.agent.modes` 的 Profile 有模式（主创、临时、伴聊都引用）”；模式控件按扩展显示；`switch_mode` 只决定 Agent 能否主动申请，没列它的 Profile 用户照样能切。
- `docs/specs/harness/extensions.md`：装配一节加 `referencedExtensions` 与按需、伴随规则，引用缺失按 `dependency-missing`。
- `docs/specs/harness/runtime.md` 输出 57：`published` 的按需扩展只装到引用它的 Profile。
- 插件作者文档（`packages/neuro-book/plugin-sdk` 下写 Profile 的那篇，实施时定位）：加一段“要模式就写 `extensions: ["nbook.agent.modes"]`”。

## 切片

1. **内核**：`referencedExtensions`、`onRequest`、装配规则 1–4；内核测试（`assemble` 的单测与 `host.test.ts`：按需扩展不装到没引用的 Profile、引用后装上、伴随、引用缺失的新建与打开、提供方晚到后解除只读）。提交。
2. **agent 插件与 bot**：贡献点字段、两条按需贡献、三个 Profile 改引用、`resolve` 合并、目录详情、`subagents` 判断、删 `agentProfilePartsKey`；`modes.test.ts`、`agent.test.ts`、`profiles.test.ts` 补用例（含旧会话保留模式）。提交。
3. **界面**：`hasModes` 改判据；`session-host.test.ts` 补“没 `switch_mode` 但引用了模式扩展：显示控件、切换成功”“列了 `switch_mode` 没引用：不显示控件”。提交。
4. **Spec 与 SDK 文档**。提交。

每片自跑：`bun run test:affected --typecheck`（只跑受影响的）。

## 验收映射

- 开发者报告的场景（插件 Profile 列了 `switch_mode` 没引用扩展）→ `session-host.test.ts`（不显示控件）与 `agent.test.ts`（`switch_mode` 得 `mode-unavailable`，不是 `unknown-extension`）。
- 第三方插件 Profile 引用模式扩展 → `agent.test.ts`（测试插件交 Profile，声明 `extensions`，切模式成功、闸门生效）。
- 规则 1–4 → 内核 `assemble` 单测与 `host.test.ts`。
- 旧会话保留模式 → `modes.test.ts`。
- `contributions.md`、`modes.md` 的新输出条目编号在写 Spec 时定，写完回填到这里。

## 验证

- 单测与合同测试如上，`bun run test:affected --typecheck`。
- e2e：覆盖模式控件的文件（实施时用 `grep -ln "mode" packages/neuro-book/e2e` 定，预计是 Agent 对话那一两个文件），合入前跑一次；开工前在起点上先跑一遍作基线。
- 未验证边界：真实第三方插件包（走 `nbooke build`）只在 `agent.test.ts` 的运行期插件里覆盖，不另装一个外部包试。

## 不做与风险

- 不做：Profile 面板（工具绑定）里增删扩展。现在面板只能增删工具；要不要让用户在面板里给某个 Profile 开关“模式”，另问开发者。
- 不做：其它内置扩展（权限规则 `rules`、会话元数据等）改成按需。规则扩展仍由主创 Profile 自带。
- 风险：装配规则改在内核，所有会话都经过它。按需扩展缺省关闭，旧的自动扩展路径不变；靠内核现有的装配测试全过兜底，加上切片 1 的新用例。
- 风险：伴随规则让第三方的按需扩展只要依赖模式扩展就会跟着装到所有引用模式的 Profile 上。这是有意的（扩展模式的插件不必让每个 Profile 都改声明），写进 Spec。
