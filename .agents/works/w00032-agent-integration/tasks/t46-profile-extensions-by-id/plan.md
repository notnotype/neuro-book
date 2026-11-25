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

字段名两处都叫 `referencedExtensions`（插件 Profile 的声明、内核 Profile 的定义），不与实现里放扩展对象的 `extensions` 同名不同型（设计审查第 11 条）。

装上的规则（内核装配时算）：

1. 自动扩展（缺省）：照旧，按 `pluginExtensions` 的标签排除；`"none"` 时一个都不装。
2. 引用：Profile 引用的 id 一律装上，与 `pluginExtensions` 的排除无关（引用是显式的）；引用的是自动扩展也一样（被排除了也装）。同一个 id 只装一次，引用一个已经自动装上的不算重复。
3. 伴随：只在同一插件内。一个按需扩展依赖（声明的 `dependsOn`）同一插件的另一个已装上的按需扩展、且它自己的依赖都满足时，跟着装上；别的插件的按需扩展不会伴随进来，要的话 Profile 显式引用（设计审查第 2 条：反向拉入跨插件会绕过 `"none"` 与排除）。模式提醒 `nbook.agent.mode-reminder` 依赖 `nbook.agent.modes`、同属 `nbook.agent`，所以引用 `nbook.agent.modes` 就带上提醒。
4. 引用的 id 没有被任何插件贡献：新的装配问题码 `referenced-extension-missing`（`extension` 为 Profile 的 id、`dependency` 为引用的 id，message 写“profile X references extension Y, which is not contributed”）。新建会话 `profile-invalid`；打开已有会话进只读，只读码沿用 `dependency-missing`；提供方晚到后重新装配即解除，并且解除后跑的是真的 Profile（见下一节内核的修正）。
5. 单次请求 `complete()` 照旧不装插件扩展，也忽略引用（设计审查第 14 条），不因引用报 `unknown-profile`。
6. `defineProfile` 的 `extensions` 里出现字符串（照声明的写法写错了地方）：装配问题 `bad-extension-id` 的 hint 写明“按 id 引用请写在 referencedExtensions”。

### `packages/nb-harness/src/kernel`

- **先修一个已有缺陷（设计审查第 1 条，审查者用实验复现）**：打开会话时装配失败，`assembleOrPlaceholder`（`session/session.ts`）换上占位 Profile 并进只读；之后提供方发布、`reassembleOnce` 重新装配时沿用占位（只有 `pending.profile` 或 `profileLost` 时才重新 resolve），于是只读解除、日志写进 version `unknown` 的 `profileChanged`、Profile 自己的系统提示词没了。改为：打开时装配失败也记下“要重新解析 Profile”，`reassembleOnce` 先 resolve 再装配。补用例：打开即缺、晚到后恢复、恢复后系统提示词与清单是真 Profile。这一条先单独提交。
- `api/profile.ts`：Profile 加 `referencedExtensions?: readonly string[]`，与 `pluginExtensions` 互不影响（`"none"` 的 Profile 也能引用）。`DefineProfile` 的类型同步。
- `api/extension.ts`：`ContributedExtension` 加 `onRequest?: boolean`。
- `api/host.ts` 的 `ExtensionHandle.declaration` 加 `install?: "on-request"`；`session/agent-host.ts` 的 `contributed()` 带上 `onRequest`。
- `extension/assemble.ts` 的 `assemble`：按 1–4、6 算插件项；伴随按同插件的依赖闭包迭代到不再增加。其余检查（前缀、重名、成环、拓扑序、哈希）不变。`complete.ts` 按第 5 条不检查引用。

### `packages/neuro-book/src/plugins/agent`

- `shared/points.ts`：`ExtensionDeclarationSchema` 加 `install: Optional(Literal("on-request"))`；`ProfileDeclarationSchema` 加 `referencedExtensions: Optional(Array(String))`。
- `backend/profiles.ts` 的 `resolve`：插件 Profile 只认声明（设计审查第 5 条）：交给内核的对象是实现加上声明的 `referencedExtensions`（覆盖，不取并集）；实现自己也写了且不同时写诊断。合并结果按平台句柄缓存（WeakMap），同一代句柄交同一个对象，免得内核按对象相等判断“没变”落空、每次 `profilesChanged` 都把扩展摘下再装回（第 7 条）。声明没有引用时直接交实现。用户级 Profile 在 `defineProfile` 里写 `referencedExtensions`，只认包里的。
- 目录（输出 8、14）：每项加 `referencedExtensions`：插件 Profile 取声明的，用户级取上一次成功的包里的。可用性加一种原因 `{code: "extensions-missing", extensions}`：引用的 id 不在清单的扩展声明里（`declarations.list(EXTENSIONS_POINT)`，不激活提供方），选了才失败的情况在目录里就看得到（第 8 条）。
- `backend/plugin.ts`：模式扩展与提醒作为两条 `agent.extensions` 贡献交出（`install: "on-request"`，提醒的声明 `dependsOn: ["nbook.agent.modes"]`），声明加进 `contributions`、实现加进 `[EXTENSIONS_POINT]`。删掉 `agentProfilePartsKey` 服务（唯一使用方是伴聊 bot）。
- 时序（第 9 条，从代码推断）：平台先接纳业务、再通知接收者发布，`nbook.agent` 自己交出的模式扩展可能晚于 `agentKey` 可用。`agent.test.ts` 加一条：拿到 `agentKey` 后立刻建引用模式的会话，必须成功、有模式；失败就在会话表首次建或开之前等本插件自己的扩展发布完成。
- `backend/builtin/profiles/main.ts`、`adhoc.ts`：实现里去掉 `...modesExtensions`；声明加 `referencedExtensions: ["nbook.agent.modes"]`。
- `backend/subagents/tools.ts` 的 `modal`：判据收成一个函数。派发前按解析到的子 Profile 的 `referencedExtensions` 判（建前没有快照，只能静态判）；建好后用子会话快照里模式扩展是否 active 再核一次，不符就拒绝并关掉这个子会话（第 10 条），与续用路径（`hasModes(snapshot)`）同一个判据函数。
- `web/session-host.ts`：模式控件只按目录判（目录项的 `referencedExtensions` 含 `nbook.agent.modes`；目录还没加载时按有算，免得闪）。不追会话自己的扩展状态：前端 `KernelMeta` 没有扩展列表，追它要改 nb-agent-ui 的快照解析与 `profileChanged` 处理（第 3 条），这次不做；两边不一致只在用户级 Profile 改了引用、会话还没重新装配时出现，这时切换得到 `unknown-extension`，提示改成“这个会话没有 Agent 模式”。另修两处“只有主创有模式”的写法（第 4 条）：新建会话时按要建的 Profile 的目录判据提交草稿模式（现在只对主创提交）；没有会话时也按目录判控件显不显示（现在一律显示）。

### `packages/neuro-book/src/plugins/bots/backend`

- `profile.ts` 的 `companionProfile` 去掉 `parts`；声明加 `referencedExtensions: ["nbook.agent.modes"]`。`plugin.ts` 去掉对 `agentProfilePartsKey` 的依赖。

### 旧会话

模式扩展从“Profile 自带”（所属插件为 null）变成“`nbook.agent` 贡献”，装配序与清单里的所属插件变了，打开旧会话时哈希不同，写 `profileChanged{code-updated}`（extensions.md 输出 28，这是预期）。扩展设置按扩展 id 存（`settingsChanged{extension: "nbook.agent.modes"}`），id 不变，旧会话的模式保留；提醒的片同 id 保留。用一条测试钉住：在旧装配下切到 `plan`，换新装配后重开，模式仍是 `plan`、闸门照拦。

## Spec 与文档改动

- `docs/specs/agent/contributions.md`：输入里扩展声明加 `install`、Profile 声明加 `referencedExtensions`；新增输出“按需扩展”（规则 1–6）；输出 8 加 `extensions-missing`、输出 14 目录详情加 `referencedExtensions`；验收场景加一条（第三方插件 Profile 引用模式扩展）。
- `docs/specs/agent/modes.md`：术语里“主 Profile 装模式扩展”改为“按 id 引用 `nbook.agent.modes` 的 Profile 有模式（主创、临时、伴聊都引用）”；模式控件按扩展显示；`switch_mode` 只决定 Agent 能否主动申请，没列它的 Profile 用户照样能切。
- `docs/specs/harness/extensions.md`：装配一节加 `referencedExtensions` 与按需、同插件伴随规则，引用缺失 `referenced-extension-missing`（只读码 `dependency-missing`），`complete()` 忽略引用；打开时装配失败、晚到后恢复跑真 Profile。
- `docs/specs/harness/runtime.md` 输出 57：`published` 的按需扩展只装到引用它的 Profile。
- 插件作者文档（`packages/neuro-book/plugin-sdk` 下写 Profile 的那篇，实施时定位）：加一段“要模式就在声明里写 `referencedExtensions: ["nbook.agent.modes"]`；`switch_mode` 只决定 Agent 能不能主动申请”。

## 切片

1. **内核缺陷**：打开时装配失败、晚到后恢复跑真 Profile；`host.test.ts` 补用例。单独提交。
2. **内核按需扩展**：`referencedExtensions`、`onRequest`、规则 1–6、`complete()`；`assemble` 单测与 `host.test.ts`（没引用不装、引用后装上、同插件伴随、跨插件不伴随、`"none"` 照样装引用的、引用自动扩展不重复、引用缺失的新建与打开、晚到后解除）。提交。
3. **agent 插件与 bot**：贡献点字段、两条按需贡献、三个 Profile 改引用、`resolve` 只认声明并缓存、目录与 `extensions-missing`、`subagents` 判据、时序用例、删 `agentProfilePartsKey`；`modes.test.ts`、`agent.test.ts`、`profiles.test.ts` 补用例（含旧会话保留模式）。提交。
4. **界面**：控件只按目录判、新建时提交草稿模式按目录判、没会话时也按目录判、`unknown-extension` 的提示；`session-host.test.ts` 补用例。提交。
5. **Spec 与 SDK 文档**。提交。

每片自跑：`bun run test:affected --typecheck`（只跑受影响的）。

## 验收映射

- 开发者报告的场景（插件 Profile 列了 `switch_mode` 没引用扩展）→ `session-host.test.ts`（不显示控件）与 `agent.test.ts`（`switch_mode` 得 `mode-unavailable`，不是 `unknown-extension`）。
- 第三方插件 Profile 引用模式扩展 → `agent.test.ts`（测试插件交 Profile，声明 `referencedExtensions`，切模式成功、闸门生效）。
- 规则 1–6 → 内核 `assemble` 单测与 `host.test.ts`；打开即缺、晚到后恢复跑真 Profile → `host.test.ts`。
- 没 `switch_mode` 但引用了模式：用户能切 → `session-host.test.ts`。
- 新建会话的草稿模式对伴聊、第三方 Profile 生效；不引用模式的 Profile 草稿里没有控件 → `session-host.test.ts`。
- `extensions-missing` → `profiles.test.ts`。
- 子代理建好后模式不符被拒并关掉 → `subagents` 的测试。
- `agentKey` 可用即能建引用模式的会话 → `agent.test.ts`。
- 旧会话保留模式 → `modes.test.ts`。
- Spec 新输出条目编号在写 Spec 时定，写完回填到这里。

## 验证

- 单测与合同测试如上，`bun run test:affected --typecheck`。
- e2e：`agent-conversation.e2e.ts`（覆盖模式控件的只有它，按 `switch-mode`、`conversation.mode` 精确搜过），合入前跑一次；起点上的基线 26 条全过（2026-11-25）。
- 未验证边界：真实第三方插件包（走 `nbooke build`）只在 `agent.test.ts` 的运行期插件里覆盖，不另装一个外部包试。

## 不做与风险

- 不做：Profile 面板（工具绑定）里增删扩展。现在面板只能增删工具；要不要让用户在面板里给某个 Profile 开关“模式”，另问开发者。
- 已知（交开发者知情，设计审查第 12 条）：面板绑定里给不引用模式的 Profile 加上的 `switch_mode` 仍会交给模型，每次调用得 `mode-unavailable`（工具结果写明“这个会话没有 Agent 模式”）。要去掉它，需要工具集按会话装配过滤，或在面板上标注，另开。
- 不做：其它内置扩展（权限规则 `rules`、会话元数据等）改成按需。规则扩展仍由主创 Profile 自带。
- 不做：前端追会话自己的扩展状态（理由见界面一节）。
- 风险：装配规则改在内核，所有会话都经过它。按需扩展缺省关闭，旧的自动扩展路径不变；靠内核现有的装配测试全过兜底，加上切片 1、2 的新用例。
