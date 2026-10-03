# Task 79 实施 Goal（一次性贯通 Phase 0–3）

> 这是 profile 编译系统底层重构的**实施执行契约**，自包含、可直接交给一个全新会话/agent 执行，不依赖任何聊天上下文。设计已定稿，本文只负责「照着把它实现出来」。架构细节一律以下列真相源文档为准，**禁止在实现期重新设计或推翻已锁决策**。

## 0. Mission（一句话）

把 profile 的运行真相源 `.compiled/` 从「逐文件覆盖的编译工作区 + 全目录 watcher 无差别 invalidate」重构为：**内容寻址不可变 artifact + 原子 manifest 指针 + server 进程内存权威 Registry + 双模 Publisher + 读路径硬切 + 严格无 stale 状态机 + boot 对账 sweep**。从根上消灭「半提交窗口」（产物新、账本旧 → profile 被判 stale → settings 返 null → 低代码表单静默消失）与 editor-snapshot 无条件冷加载 catalog 的性能问题。

## 1. 真相源文档（执行前**必须**通读，全部在本 task 目录）

- `walkthroughs/round-04-recommended-architecture.md` — **可实施终稿**：组件分解 / 磁盘布局 / 发布时序 / 状态机 / §5.1 freshness 三时机 / API 拆分 / 迁移 / 测试 / 风险 / 分期。**实现以它为准**。
- `README.md` 的 `## Decisions` — 全部已锁定决策（不得重议）。
- `walkthroughs/round-01-baseline-and-current-state.md` — 现状代码级基线（所有 `file:line`，半提交窗口逐行复现）。
- `walkthroughs/round-02-harness-and-build-lifecycle.md` — harness wiring / 5 类编译调用方 / 多写入方 / blast radius（实现不得破坏的约束）。
- `walkthroughs/round-05-multi-scenario-and-update-review.md` — 多场景 / 多进程 / 版本更新 / 启动 CLI 审查（F1 双模、F2 sha 语义、F3 boot sweep、B1 sync、B2/B3 前端）。

## 2. 锁定决策（**不得重议**，违反即停止报告）

1. 源码保存后**自动后台编译**；source view 立即生效，runtime 仅在 build success 后可用。
2. runtime **严格阻止** stale/failed profile，**不回退**上次成功产物。
3. 接受**破坏旧 `.compiled` 格式**，`PROFILE_ARTIFACT_COMPILER_VERSION` 5 → 6，旧产物直接弃用重建。
4. editor-snapshot **硬切**拆专用轻接口，不保留 profile settings 大包兼容。
5. **跨进程写入纪律**：运行态 `.compiled/` 只由 server 进程经其单例 Publisher 写；preflight 仅在 server 未起时由 CLI 进程写；不允许 server 运行时另起进程并发写运行态产物；per-root advisory lock 兜底。
6. **升级首启** = 非阻塞 boot 对账 sweep + 前端 `compiling` 状态；**不做阻塞预编**；单 profile 编译失败只标 `compile_failed`，绝不阻塞 App 启动或其它 profile。
7. **release 历史后置**（先上 manifest 当前指针，需要回滚/审计再加 `releases/`）。
8. **自动编译去抖 = 500ms 单窗口** + 合并 + generation 去重，保存与自动保存统一合并。
9. **freshness 降级**：boot/热路径只验「源码 sha + compilerVersion」，全依赖 rehash 留 CLI `profile check`；依赖变化运行期靠 watcher 触发重编。
10. **Phase 0 先行**。

## 3. 终态不变量（**验收硬条件**，全部满足才算完成）

- **消灭半提交窗口**：任意编译过程中，runtime 读到的 profile 视图要么完整旧版、要么完整新版，绝无「文件新 / 账本旧」。
- **内容寻址**：artifact 落 `.compiled/artifacts/<sha>.mjs`，`<sha>` = **编译输出字节 sha256**（**不是**输入哈希）；同一 sha 只写一次（tmp→rename 到不存在目标）、**永不覆盖**。
- **原子指针**：`.compiled/manifest.json` 发布只做一次 `manifest.json.tmp → manifest.json` rename。
- **双模 Publisher**：server 进程内发布 = 写盘 + 翻内存 Registry；CLI/preflight = disk-only 写盘、不翻 Registry。发布前抢 per-root advisory lock `<root>/.compiled/.publish.lock`（`proper-lockfile` **直接依赖**）。
- **Registry 仅 server 进程**，热路径 `get/resolveMany/snapshot` O(1) 只读内存，**绝不**在请求里 stat/hash/import/编译（维持 Task 04 硬合同）。
- **严格无 stale 状态机**：`loaded / compiling / compile_failed / compile_stale / not_compiled / compiled_load_failed / source_error`；非 `loaded` 调 `get()` 抛错；取消现状对 user `source_changed/dependency_changed` 的「容忍→loaded」。
- **读路径硬切**：editor-snapshot 不再含 settings 大包、不再无条件读 catalog；新增 `/api/agent/profiles/settings` + `/api/agent/profiles/build-status`；前端保留 `loadStatus/issue/hasSettingsForm`，失败/编译中渲染**状态块**而非静默消失；表单**结构**来自 Registry、**值**来自 config（失败不丢值）。
- **boot 对账 sweep**：启动比对「源码集合 vs manifest 命中」，缺失/失配的后台 enqueue 重编；compilerVersion bump 后 system + user（含用户改过/自创）全部自愈。
- **不破坏**：5 类编译调用方（dev/build CLI、system-assets-preflight、product-runtime user 编译、HTTP runtime user 编译、test）+ product require shim / Nitro importMeta shim 校验 + assets 同步。

## 4. 分期执行（按序贯通，每个 Phase 过了验收门再进下一个）

> 一次性完成全部，但**保留相位门**：某 Phase 验收不过就停下报告，不硬推下一 Phase。

### Phase 0 — 读路径硬切 + 前端状态（独立、不需新格式、最先做）

- 后端 `server/config/config-service.ts`：`readConfigEditorSnapshot` 移除 `agentProfileSettings` 重型构造与无条件 `profiles.snapshot()`；`defaultProfileSettings`（只要 key/name/loadStatus）改 O(1) 读；models/web/cost/embedding/ui 不再触碰 catalog。
- 新增 `server/api/agent/profiles/settings.get.ts`（per-profile `{model, settingsForm+value+inherited, loadStatus, hasSettingsForm, issue, sourcePath, buildState}`，**唯一读 settings 处**）与 `server/api/agent/profiles/build-status.get.ts`。
- 前端 `app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`：`AgentProfileDraft` 保留 `loadStatus/issue/hasSettingsForm`；模板 `v-if="profile.settings"` 改为「loaded+有表单→LowCodeForm，否则状态块」；改打新 `/settings` + 轮询/订阅 `/build-status`。
- 前端 `app/components/novel-ide/agent/AgentChatSurface.vue`：`loadSelectableModels` 用 `bootstrap()` 替 `editorSnapshot()`。
- **验收门**：compile-all 期间反复请求 settings 不闪（仍可能显示 compiling，但不静默消失）；`editor-snapshot?workspaceKind=user-assets` 热路径不触发 profile catalog；AgentChatSurface 不再打完整 editor-snapshot。

### Phase 1 — 新格式 + 组件 + 原子 manifest + 锁 + sha 语义

- `bun add proper-lockfile@latest`（提权在沙箱外执行；**直接依赖**，勿赖 Prisma 传递依赖）。
- `server/agent/profiles/profile-artifact-compiler.ts`：`PROFILE_ARTIFACT_COMPILER_VERSION` 5→6；新布局 `artifacts/<sha>.mjs`（sha=输出字节）；旧 manifest 判不兼容→空→重建。
- 新组件（拆 catalog god-object，对外保留 `AgentProfileCatalog` facade 最小化 ~30 调用点改动）：`ProfileArtifactStore`（sha→import）、`ProfileReleaseStore`（原子读写 manifest）、`ProfileRegistry`（内存权威，仅 server）、`ProfileFreshnessChecker`、`ProfileReleasePublisher`（**双模** + advisory lock）。
- 重路由 5 类编译调用方经 Publisher（CLI/preflight disk-only；HTTP runtime in-process 翻 Registry）。
- Watcher 收敛：只监听源码 + 已知 helper/依赖 + `manifest.json`，忽略 `artifacts/**`/`*.tmp`/`.types.d.ts`。
- **验收门**：写 artifact 中途读 manifest 读不到半成品；全量编译只原子替换一次 manifest；单文件编译不破坏其它 profile；失败 profile 记 compile_failed 仍发布、好的可用；两个写进程并发被 advisory lock 串行化；**F2 测试**：同输入、不同 compilerVersion → 不同 artifact 且不复用旧文件。

### Phase 2 — Coordinator + 自动编译 + BuildState + 内存权威 + boot sweep + 严格状态机 + worker 池

- 新组件：`ProfileBuildCoordinator`（串行排队 / 500ms 去抖 / generation 重校验 / 向 worker 池并行派发）、`ProfileBuildWorker`（worker_thread 池，编到内容寻址 staging、回传 sha，不发布）、`ProfileBuildState`、`ProfileSourceWatcher`。
- `server/agent/harness/neuro-agent-harness.ts`：`watchProfiles` 时 wiring Coordinator/Publisher/Watcher。
- 保存/创建端点：写源码后 `Coordinator.enqueue`（不再「保存即 invalidate 等手动编译」）。
- **boot 对账 sweep**：Registry 读 manifest 建 Map 后，比对源码集合，缺失/失配后台 enqueue（非阻塞）。
- 严格状态机硬切（§3 不变量）。
- **验收门**：保存源码 → UI compiling→loaded/failed；外部编辑 writer 自动编译、完成前不可运行、完成后恢复；compilerVersion bump 后 user 自定义自愈（**F3 测试**：bump 后 user 改过/自创 profile 不被删、boot sweep 后恢复 loaded）；并行编译削平全量重编延迟。

### Phase 3 — assets 同步改造 + GC +（可选）releases/

- `server/workspace-files/novel-workspace.ts`：`syncCompiledProfileArtifact` 改为 **copy-if-absent**（用户未改→同 sha 直接落 user `artifacts/`；用户改过→走自己的 sha、不覆盖；源码级冲突沿用现有 3-way），经 Publisher 一次性发布用户 manifest；**退役** `stageVerifiedArtifact`/`replaceFilesWithRollback`/`replaceFileWithRollback`。
- GC：延后 + grace period；只删「不被 current manifest 引用」的 `<sha>`，**不假设单写者**；绝不删 current 引用的 sha。
- （可选）`releases/<id>.json` + `current.json` 历史账本——**默认不做**，留待真正需要回滚/审计。
- **验收门**：用户改过的 profile 同步后不被覆盖/删除；GC 不误删 current 引用；sync 幂等（重复跑无副作用）。

## 5. Constraints（必须遵守，违反即停止报告）

- 维持 **Task 04 硬合同**：普通 runtime 请求只读产物、绝不在热路径编译。
- 不破坏 5 类编译调用方 + product-runtime shim（require / Nitro importMeta）+ system-assets-preflight + assets 同步。
- 遇到设计问题 / 需要 hack 绕过 / 会破坏类型系统 → **立即终止任务并告知用户**，不制造技术债。
- 类型覆盖：不用 `any/unknown/Record<string,unknown>`，必要时旁注原因。
- 不一次性应用 800 行以上超大补丁；按 script/template/style 或组件拆分多次应用。
- 后端 class 模式、前端 FP；不用相对路径导入（用 `nbook/...`）；4 空格缩进；函数必须中文注释；optional 属性注明空/非空含义。
- 不主动跑 git 命令查看变更；不自动做浏览器验证（可建议用户做）。
- 复杂/核心逻辑写测试（Publisher 原子边界、Registry 只读内存、boot sweep 自愈、读路径不触发 catalog）；简单逻辑不写。

## 6. 测试计划（映射 round-04 §8）

- **Compiler/Publisher**：全量只原子替换一次 manifest；中途读不到半成品；单文件不破坏其它；失败记账仍发布；编译期源码再变→旧 build 丢弃标 stale + re-enqueue；删 profile→manifest 移除；F2 同输入异 compilerVersion 不复用。
- **Registry/Catalog**：只从 current manifest 加载；非 loaded `get()` 抛错；helper/依赖变（watch-time）→受影响 profile 重编；`artifacts/**` 事件不 invalidate。
- **API/Frontend**：editor-snapshot 不含 settings 大包且不触 catalog；settings 接口带状态；保存源码 UI compiling→loaded/failed；AgentChatSurface 不打完整 editor-snapshot。
- **Regression/Smoke**：compile-all 期间反复请求 settings 不闪；外部编辑自动编译、完成前不可运行、完成后恢复；F3 升级 bump 自愈；跨进程并发写被锁串行。

## 7. Iteration / 收尾要求

- 每个 Phase 写 `walkthroughs/round-NN-implementation-*.md`（NN 续上现有编号），记录用户需求映射、变更文件、关键决策、验证结果，并**报告实际结果与本 Goal 计划的出入**。
- 全部完成后：`PROJECT-STATUS.md` 的 Task 79 状态 Design → Implemented 并更新行为/架构摘要；在 `reference/agent/` 新增 `.compiled` 新格式契约（content-addressed artifact + manifest 指针 + 双模 Publisher + 状态机）；更新 memory `profile-build-system-redesign`。

## 8. Blocked stop conditions（命中即停，报告 + 给建议，等用户）

- 任一 Phase 验收门不过 → 停，报告失败证据，不硬推下一 Phase。
- 需要 hack / 制造技术债 / 破坏类型系统才能继续 → 停，报告。
- 发现真相源文档与代码现实冲突（例如某编译调用方无法在不破坏约束下经 Publisher）→ 停，记录冲突 + 解锁条件，**不擅自改设计**。
- 涉及不可逆或对外动作（删大量产物、改 product 打包链）→ 先确认。
</content>
