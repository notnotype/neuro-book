# Agent 变更收件箱与提示词顺序收口

## 2026-07-12：FileChangeNotice 预算归 Harness

- `<FileChangeNotice>` 只保留 `mode + appendingIndex`，Profile turn plan 不再携带 diff 上限。
- 单文件 diff 上限属于 Harness runtime：系统默认 512，Global/Project 均支持通用默认和 Profile 局部覆盖，范围 0–8192。
- Harness 在物化 notice 时注入最终有效值；真实 provider、Preview、安全路径、inline/reference 降级和游标结算使用同一配置链。
- `settingsForm` 只管理 Profile 业务字段；旧 `ctx.settings.fileChangeDiffMaxChars`、prepare fallback 补值和同名保留键合同均已删除。

> 状态：已实施并验收（2026-07-10，自动化门禁与 `$playwright-cli` 浏览器终验全绿）。本任务承接 Task 95 的文件变更 UI / Agent 感知后续，并修正 Profile prompt 的运行时顺序。

> 2026-07-11 提示词与通用设置优化：`<file-change-notice>` 正文统一改为英文，文件条目使用 Git 风格 added/modified/deleted/renamed/restored/reverted 状态，并保留 hunk、diff 统计、安全阻断、预算和 at-least-once 游标语义。`<FileChangeNotice>` 只保留 `mode`，单文件 diff 上限迁入每个 Profile 的通用运行设置。Reminder runtime state 分离观察 baseline 与实际注入轮次；空 linked agents 不生成消息，但清空后重新关联同一 Agent 会再次提醒。Runtime Location 与 Workspace Focus 明确区分稳定访问能力和当前默认焦点。

> 2026-07-11 发布阻断修复：`defineAgentProfile().prepare()` 的直接调用 fallback 曾在补入通用 diff 默认值时，以 `ctx.settings → settingsForm defaults` 的错误顺序覆盖调用方设置。现统一为 `settingsForm defaults < 调用方 settings`，`fileChangeDiffMaxChars` 只在缺失时补 512，显式 0 保留；该通用键同时成为 settingsForm 保留键，定义阶段会检查 schema、defaults 与 fields 三个入口。正式 Harness/Preview 原本已传入完整通用设置，持久化 Config 无需迁移。敏感路径由 notice 渲染层直接识别，即使超出前四个 diff detail 也只输出不可点击路径与安全限制，不再建议 Agent 主动读取，也不推断 Inbox 状态。

## Relative documents refs

- [Task 02 Pi Agent Harness 迁移](../02-pi-agent-harness-migration/README.md)
- [Task 04 TSX Profile Workbench](../04-tsx-profile-workbench/README.md)
- [Task 95 nb-history 集成](../95-nb-history-integration/README.md)
- [`reference/agent/context.md`](../../../reference/agent/context.md)
- [`reference/agent/runtime-hooks.md`](../../../reference/agent/runtime-hooks.md)

## User Request / Topic

- 把文件变更收件箱集成到 Agent Composer 输入卡上方，默认收起；完整审查弹窗继续作为深度入口。
- 对安全且较小的文本变更在 Composer 和 Agent notice 中直接展示 diff；`.env` 等敏感文件无论如何不得向浏览器或 Agent prompt 返回 diff 正文。
- `<file-change-notice>` 不再由 Harness 硬编码注入，改为向 profile 提供数据，由 profile DSL 决定是否注入及其位置。
- 固定 provider 消息顺序为：`History → ModelContext → AppendingSet → CurrentUserInput`。

## Goal

完成 Agent 文件变更感知的 UI、安全边界与 profile 所有权收口：Composer 能默认折叠展示待审变更，Profile notice 能在可配置预算内内联小型安全 diff，超限时降级为文件引用与 hunk 位置，敏感正文在服务端即被阻断；Harness 只执行通用上下文与交付结算；真实 provider 与 Profile Preview 均严格遵守 `History → ModelContext → AppendingSet → CurrentUserInput`。通过聚焦单元/集成测试和全仓 typecheck 证明契约，同时不改变 workspace-history 记账、accept/revert 和游标 at-least-once 语义。

## Current State

- Agent Composer 输入卡上方已有默认收起的独立文件变更卡片；它与输入区保持紧凑间距但不共享边框或焦点态，完整 `WorkspaceHistoryInboxDialog` 与 Header 入口继续保留。
- Composer 与完整 Dialog 共用 `useWorkspaceHistoryInbox`；workspace SSE 和 Agent workspace sync 会触发摘要刷新。Inbox / group 均带 revision，diff、accept、revert 和 accept-all 在服务端重新读取当前 Inbox 后做并发前置条件校验，旧版本统一 412。
- 小型安全文本 diff 可在 Composer 内按需展开；列表、API 和打开文件事件统一使用原始 Project Workspace 相对路径，并提供单文件「接受」和服务端「接受全部」。敏感路径、二进制、快照缺失和 inline 超限由服务端返回无正文状态。
- Composer 与完整 Dialog 共用版本化 diff 请求契约：缓存键为 `projectPath + path + revision + mode`，项目切换、Inbox 刷新和组件卸载会 abort 全部旧请求；loading/error/result 按版本键隔离，旧项目、旧 revision 和旧响应不能回填。Agent 模式从变更卡打开文件后会自动展开 Studio。
- 公开读取入口已硬切到按 `projectPath + inbox path + mode` 授权的 `/api/workspace-history/diff`；旧 hash-only `snapshot` 路由已删除。
- `<FileChangeNotice />` 是 Profile DSL 节点，公开属性只保留 `mode`。Agent 小 diff 字符预算来自 `agent.profiles[profileKey].fileChangeNotice.diffMaxChars`，Global/Project 可继承覆盖，默认 512。Harness 只物化 `turnContexts` 并在成功 ingest 后结算游标；未声明节点的 profile 即使存在 unseen 也不会注入提醒。
- `<file-change-notice>` 的逐文件条目只陈述状态、路径、归因、位置和 diff 统计；完整读取、敏感路径限制与删除路径限制在 footer 按整批文件汇总一次，不再随超限文件数量重复指导。Notice 不查询或推断 Inbox 状态。
- provider 与 Profile Preview 共用 prompt assembler，固定顺序为 `History → ModelContext → AppendingSet → CurrentUserInput`。
- 当前用户输入继续由 Harness 持久化为独立 durable prompt；`writer` / `inline.editor` 已删除对 `ctx.invocation.message` 的 AppendingSet 复制，只在缺少可见 message 时保留条件式安全提示。

## Decisions / Discussion

- D1：消息顺序固定为 `History → ModelContext → AppendingSet → CurrentUserInput`。
- D2：真实用户输入继续由 Harness 负责持久化与完整性；profile 不复制用户原文，Workbench dry-run 没有真实 invocation 时不伪造用户输入。
- D3：文件变更提醒由 Profile DSL 显式声明。Leader 使用 full、Writer 使用 minimal、Inline Editor 不声明，因此关闭。
- D4：游标只在 notice 实际进入模型且 turn ingest 成功后推进；失败保持 at-least-once 重现。
- D5：公开 diff API 必须按 inbox path 授权。敏感路径、二进制、快照缺失和超限内容不返回正文；旧 hash-only snapshot API 删除，不保留 legacy 别名。
- D6：Composer 默认折叠面板与完整 Dialog 共用一个 history inbox 数据层和安全 diff 契约，不复制 accept/revert 业务逻辑。
- D7：Agent diff 不运行 tokenizer。单文件字符预算属于 Profile 通用运行设置，默认 512 字符约 256 tokens；范围 0–8192，Project 可继承或覆盖 Global。系统再施加整轮硬保护：inline 总预算 `min(8192, diffMaxChars × 4)`、最多计算 4 个文件详情、最多逐项列出 50 个文件、最终 notice 不超过 12,288 字符。无法完整放入剩余预算时整段降级为 reference，不截断 diff；reference 不保留正文。
- D8：敏感策略采用明确路径黑名单，不做内容扫描和 `secret` 等宽泛子串匹配。阻断 `.ssh/.aws/.azure/.kube/.docker/.gnupg`、所有 `.env` 变体与 `.envrc`、常见凭据文件、私钥名和 `.pem/.key/.p12/.pfx/.jks/.keystore`；安全近似创作文件不误拦。
- D9：删除文件不生成可点击的当前文件引用；小型删除允许内联 removed diff，超限或快照不可用时明确说明当前路径不可 `read`，不再给通用读取建议。
- D10：notice 的文件条目与操作指导分层。文件条目只输出事实；read/sensitive/deleted 三类 clause 由 footer 根据整批文件能力聚合，整条 notice 各类指导最多出现一次。敏感 clause 要求当前任务确有需要时先询问用户；删除 clause 要求进一步查看历史或恢复前先询问用户；两者都不承诺 Inbox 中存在对应路径。

## Verification / Test

- `bun run generate:openapi`：通过。
- `bun scripts/build/prepare-system-assets.ts --sync-user-assets --force-sync-user-assets`：通过；14 个系统 Profile 重新编译，`bun scripts/build/profile.ts status --all --system` 全部 `loaded`。
- Workspace History / API：9 files / 37 tests 通过，覆盖完整敏感路径矩阵、正文读取前阻断、group / Inbox revision 成功与 412、Agent 4 文件详情和整轮预算。
- `bun test ./server/agent/tools`：147/147 通过。
- Task 102 / Profile 聚焦套件：7 files / 70 tests 通过；额外 FauxProvider 黑盒锁定 notice 位于 CurrentUserInput 前、失败轮不推进游标、成功重试后结算。
- 前端请求守卫：3/3 通过，覆盖刷新前旧响应、同路径旧 revision、旧项目和 A/B 文件并发状态隔离；Profile 新节点默认值和 literal TSX round-trip 已覆盖。
- `bun run typecheck`：退出 0。
- 2026-07-11 通用运行设置与 Reminder 收口回归：11 files / 167 tests 全部通过；system/user Profile 各 14 个 `status` 均为 `loaded`，Profile source check 全绿。
- 2026-07-11 settings fallback 发布阻断回归：最终聚焦套件 4 files / 74 tests 通过；10 文件组合套件 307/308，通过外唯一失败为 Harness 既有并发 claim 时序抖动，单用例复跑及 Harness 整文件串行 164/164 均通过；`bun run typecheck`、system/user Profile source check、system 全量 14 Profile 编译和两侧 14/14 `loaded` status 全部通过。
- 2026-07-11 二次发布阻断审查修复：聚焦套件 5 files / 89 tests 通过；11 文件组合套件 321/322，通过外唯一失败为 Windows 并发文件锁，Config 单文件单 worker 复跑 39/39 通过。settingsForm 保留键覆盖 schema-only/defaults/field 三种声明；敏感 notice 覆盖单文件、混合文件、第 5 个无 detail 文件和删除文件。`bun run typecheck`、system/user source check、system 全量 14 Profile 编译和两侧 14/14 `loaded` status 全部通过。
- 2026-07-18 notice 指导去重与能力表述收口：`file-change-reminder.test.ts` 18/18 通过，覆盖 2/4 个 reference 文件在 minimal/full 下只输出一次读取指导、inline/reference/敏感/删除同批 footer、长路径逼近 12,288 字符上限、消息顺序与 at-least-once 游标结算；敏感与删除 clause 均不再出现 `file change inbox` 承诺。
- 卫生检查：旧 path-only 调用为 0；相关文件均小于 800 行；UI 无 Tailwind 调色板色、`dark:`、调试日志或 demo 文本。
- `$playwright-cli` 在《命定之诗2》完成真实浏览器终验：默认收起、展开/收起高度动画、稳定滚动属性、Project Workspace 原始相对路径、同名 slug 子目录准确打开、Agent 模式自动展开 Studio、小 diff、`.envrc` 0 正文、延迟旧 200 diff 在 revision 刷新后不回填、accept / revert / accept-all 412 刷新均通过。临时文件已删除并只接受对应三组，最终 Inbox 恢复原 `test-html-demo.md` 单组基线；新会话 0 error / 0 warning。

## Implementation Walkthrough

- 2026-07-10：完成只读诊断。复现 provider 顺序漂移；确认 `file-change-notice` 为 Harness 硬注入；确认 `.env` / `.env.local` / `*.pem` 会进入 history，而 snapshot API 无路径授权。
- 2026-07-10：用户确认保持 `History → ModelContext → AppendingSet → CurrentUserInput`，并要求新建独立任务记录实施。
- 2026-07-10：新增 `prompt-order.ts` 作为 Harness / Profile Preview 的唯一消息组装器；ModelContext 在本轮 AppendingSet 前插入，CurrentUserInput 始终保持最后。
- 2026-07-10：新增 `ProfileTurnContextPlan` 与 `<FileChangeNotice mode={...} />`。节点只能作为 `AppendingSet` 直接子节点并记录声明位置；Leader=full、Writer=minimal、Inline Editor 不声明。成功 ingest 后才推进 `last_seen_entry_id`，失败保持 at-least-once。
- 2026-07-10：新增安全 diff policy / DTO / API。`.env*`、凭据、私钥/证书和 `.ssh` 路径在调用 `textDiff` 前即阻断；inline 模式限制 24 KiB / 120 变更行，超限只返回统计。
- 2026-07-10：新增 Composer 折叠摘要和共用 inbox composable；展开文件时按需读取 inline diff，完整审查继续复用 Monaco Dialog 的 accept/revert 流程。
- 2026-07-10：收尾审查发现 writer / inline editor 仍手工复制 `ctx.invocation.message`，已改成仅在 message 缺失时渲染安全提示，消除 AppendingSet 与 CurrentUserInput 重复。
- 2026-07-10 UI 调整轮：根据浏览器截图把收件箱从 `--bg-input` 改为卡片语义的 `--bg-panel`，展开详情使用 `--bg-subtle`、diff 代码区使用 `--source-bg`。曾短暂合并进 Composer 外框，用户复核后撤回；最终保持两张独立卡片。
- 2026-07-10 UI 调整轮：展示路径会防御性移除 `workspace/<slug>/` 或 `<slug>/` 前缀；新增行级「接受」与 `/api/workspace-history/accept-all` 服务端全收件箱接受入口，操作完成后刷新共用 inbox 并通知结果。
- 2026-07-10 紧凑样式轮：标题、文件行、计数、接受按钮与底部说明压缩到约 20–28px 高；新增卡片显隐、展开区、diff 区、文件行移除和 chevron 旋转动画，时长控制在 150–200ms。
- 2026-07-10 可读性与动画修复轮：移除 8–9px 字号，标题、路径、操作与 diff 调整到 10–11px；展开主体拆为裁切动画外壳与稳定滚动视口，滚动区和 diff 区接入 `custom-scrollbar`、稳定 scrollbar gutter 与 overscroll containment。卡片、diff、文件行不再嵌套 `max-height` 动画，避免展开、接受和 diff 切换时反复重排及滚动条横跳；继续支持 `prefers-reduced-motion`。
- 2026-07-10 收起动画与文件打开修复轮：展开主体不再依赖自适应 `grid-template-rows` 插值，而是在离场前锁定真实 `offsetHeight`，再以 220ms 高度过渡收至 0；文件行新增「打开」入口，复用 IDE workspace 引用打开链并永久打开对应标签，已删除文件禁用入口。
- Composer inline diff 的“小型”契约仍为：前后全文 UTF-8 字节数合计不超过 24 KiB，且 added/removed 变更行合计不超过 120 行；任一超限只返回统计。
- Agent `FileChangeNotice` 使用 Profile 通用配置中的单文件最终 unified diff 字符预算，系统默认 512（约 256 tokens）；任一超限不内联 diff，只给 Project Workspace 文件引用、hunk 新旧行号与统计，整批 notice 只在 footer 给一次完整读取指导。设置为 0 可完全关闭 Agent diff 内联。敏感路径即使很小也只显示不可点击路径和阻断说明。
- 2026-07-11：英文 notice 主状态按净状态和操作历史分类，锁定 create→edit=`added`、rename→edit=`renamed`、restore/revert 后续 edit 仍保留对应主语义，最终不存在统一为 `deleted`。
- 2026-07-11：Reminder 状态把 observed fingerprint/value 与 `injectedAtTurn` 分开。空渲染会更新 observed baseline，但不伪造注入时间；linked agents 的空→关联→清空→同 Agent 重关联序列因此能正确二次提醒。
- 2026-07-11：最终契约扫描确认旧 `<FileChangeNotice diffMaxChars>`、`builtin.variable`、`Variable` / `VariableSchema` Profile helper 无真实公开实现残留；Variable 全局 tools/runtime 继续存在。
- 2026-07-11：发布前稳定回归定位到 `withDefaultSettings` 的合并顺序。修复后通用测试锁定 defaults、调用方覆盖、缺省 512、显式 0、`context()` / 高级 `prepare()` 一致性和 settingsForm 保留键拒绝；`leader.assets` 置顶提示词真实用例恢复。
- 2026-07-11：二次审查补齐两个遗漏：保留键拒绝不再只看 defaults/fields，还检查 TypeBox 顶层 schema properties；敏感路径判断从有限的 diff detail 前移到 notice 渲染层，批量列表中的任意敏感文件都不会生成链接或通用 `read` 指引。
- 2026-07-10 验收修复轮：安全黑名单扩展到明确凭据目录/文件/私钥格式；Inbox 与 group 引入 revision 并删除 path-only 调用；Composer / Dialog 接入版本键请求守卫与 412 刷新；Agent notice 增加 4 文件详情、50 文件列表、8192 inline 总额和 12,288 notice 硬上限，删除路径语义收口；Profile Inspector 补三档 mode 与 0–8192 数字约束。
- 浏览器验收额外发现并修复 ProjectSession open 前的 Inbox 早发竞态：`useWorkspaceHistoryInbox` 增加宿主 enabled 契约，Composer 只在 Agent surface active 后加载，关闭中的 History Dialog 不再发请求。修复采用生命周期接线，不引入延时重试。

## Files Changed

- Prompt / Profile：`server/agent/profiles/prompt-order.ts`、`profile-turn-context.ts`、`profile-dsl.ts`、Profile Preview / Workbench parser 与 builtin leader/writer/inline profiles。
- Harness：`server/agent/harness/neuro-agent-harness.ts`、prepare / run frame 相关类型与 file-change 黑盒测试；旧 `file-change-reminder.ts` 删除。
- History 安全边界：`server/workspace-history/history-diff.ts`、`agent-change-diff.ts`、`server/api/workspace-history/diff.get.ts`、`server/api/workspace-history/accept-all.post.ts`、`shared/dto/workspace-history.dto.ts`、`shared/agent/file-change-policy.ts`；旧 `snapshot.get.ts` 删除。
- UI：`AgentWorkspaceChanges.vue`、`useWorkspaceHistoryInbox.ts`、`AgentComposer.vue`、`AgentChatSurface.vue`、`WorkspaceHistoryInboxDialog.vue`、`index.vue` 与中英文 i18n。
- 文档：Task 02 / 04 / 95 / 102、Agent context / runtime hooks、`PROJECT-STATUS.md`。

## Plan Deviations

- Header 的完整收件箱入口没有删除；Composer 是新增的就近摘要入口，Header / Dialog 仍承担全量 accept/revert 审查。
- Profile Preview 的 file-change notice 使用运行时占位消息，不读取真实 Project history，也不推进游标。
- 首次聚焦测试命令漏写 `./`，Bun 额外匹配到 `product/` 旧构建快照并报 3 个 stale-copy 错误；随后使用精确 `./server/...` 路径重跑，源码套件全部通过。该错误未触发业务代码修改。

## TODO / Follow-ups

- [ ] Task 95 的时间线 / 删除找回、D15b 外部变更列表和 history 设置表单仍是独立后续，不在本任务扩展。
