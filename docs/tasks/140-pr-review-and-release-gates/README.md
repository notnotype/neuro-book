# PR Review and Release Gates

> Active task directory format: `NN-kebab-case/`. This task records the post-merge review of the PR batch and the evidence required before the batch can be called release-ready.

## Relative documents refs

- [Task 111 Workflow integration](../111-workflow-agent-integration/README.md)
- [Task 139 Agent abort and error projection](../139-agent-abort-error-projection/README.md)
- [Task 134 Agent Profile settings navigation](../134-agent-profile-settings-navigation/README.md)
- [Task 108 Agent image attachment references](../108-agent-image-attachment-references/README.md)

## User Request / Topic

审查已经合并的 PR 批次，派发只读子代理完成简单且边界明确的检查；复杂的恢复竞态、跨进程投递和跨模块公开合同由主代理集中复核，并把过程与结果记录在本 Task。

## Goal

完成 #64、#61、#59、#63、#65 合并后 master 的只读审查，确认 #47 与 #17 的保留理由，记录每个发现的严重级别、绝对路径、行号和证据，并在所有 P0/P1 风险得到处理或明确转交前，不宣称本轮发布完成。

## Current State

- 最终 master 已按既定顺序合并 #64（替代 #49）、#61、#59、#63、#65（替代 #62）。
- 本轮只读确认当前 `HEAD` 与 `origin/master` 均为 `0b65903e72358b338085633773cb2bbee949cf4b`；这比前一轮交接记录的 `64b06530` 更新，说明期间已有其它 Agent/提交推进了 master。
- 当前工作区保留在途改动：`app/components/novel-ide/agent/agent-chat-surface-state.ts`、`server/agent/session/session-repo.ts`、`server/agent/session/types.ts`、`shared/dto/agent-session.dto.ts`，以及未跟踪的 `cache/`。本 Task 不触碰、不清理、不纳入提交。
- #47 和 #17 保持开放且未合并；原 #49 和 #62 已由干净替代 PR 取代。
- 前一轮整体审查无 P0，但记录了 Session recovery、Workflow 结果投递、停止失败反馈和验证文档等 P1 风险。
- 本轮只读子代理不得修改代码、文档、测试或远端状态；主代理负责汇总、判断不确定 findings，并决定是否需要后续实现 Task。

## ADR / Decisions / Discussion

- 先并行审查简单、局部、可用静态证据确认的范围：Profile/Composer、Product/发布边界、Workflow/Jobs 公共投影、取消/前端错误出口和 PR 收口记录。
- 不让子代理直接裁决 Session recovery 的主资源/关联资源语义、Workflow 崩溃窗口的持久化方案或跨模块公开合同；这些属于复杂审查，由主代理在子代理结果之后集中复核。
- 浏览器只复用已有证据，不在本轮自动启动浏览器；未验证项必须保持未验证，不得由 focused 测试替代。

## Verification / Test

- 初始证据：已合并 PR 的 focused 测试与上一轮浏览器验收记录；完整测试、advisory CI、真实 provider 和未完成浏览器场景分开记录。
- 子代理输出必须包含：严重级别、绝对文件路径和行号、复现或测试证据、剩余风险；没有确定问题时明确写无发现和覆盖边界。
- 收口门禁：P0/P1 未解决时不能将本轮标记为发布完成；文档中的测试数字、typecheck 状态和 issue 关闭关系必须与实际证据一致。

## Implementation Walkthrough

### 2026-08-05：创建审查 Task

- 创建本 Task，作为 PR 合并后的整体审查与发布门禁记录。
- 已派发 5 个只读子代理，范围限定为局部功能、公共投影、静态收口和证据一致性：
  - Profile/Composer：`019fd15a-5625-7001-acba-72d069ff3789`
  - Product/发布边界：`019fd15a-4f6c-7e12-86db-eecaf107ee07`
  - Workflow/Jobs：`019fd15a-527f-7473-9789-82d5f1ec9d9d`
  - 取消/前端错误出口：`019fd15a-4c7d-7543-b7b4-112903a994dc`
  - PR 收口/发布记录：`019fd15a-5a32-73c1-814d-ff995d129b20`

### 2026-08-05：只读子代理结果

- Profile/Composer 子代理未发现高置信度代码问题；确认 Task 134 仍把已完成的 Profile 切换浏览器证据写成“未做”，窄屏和真实 IME 仍未验证。
- Product/发布子代理未发现确定的 P0/P1 代码问题；确认 POSIX verifier 没有 hostile `NODE_PATH` 注入，平台 baseline 代码与发布状态文档的完成口径不一致。容器直接入口、Source context 和最终 Zod 实例属于主代理复核项。
- Workflow/Jobs 子代理确认 system identity、公开 usage、Job delivery 状态、答案校验、重复 resume 门禁和 vendor snapshot 的局部实现一致；发现 Job 完成结果不跨进程持久化的 P1 候选，未自行设计 outbox。
- 取消/前端子代理确认停止请求失败只写控制台，是明确 P1；半截正文、`interrupted` 投影和错误气泡去重未发现局部高置信度缺陷。真实 provider 抛异常、150ms 强制取消和 Session SSE 竞态保留给主代理。
- PR 收口/发布子代理确认 #47、#17 仍未合并，#49/#62 分别由 #64/#65 替代，#61/#59/#63 已合并；发现 Task 111 测试数字/typecheck、Issue #46、替代 PR 正文与标签仍需收口。

### 2026-08-05：主代理复核复杂事项

- **确认 P1：Session recovery 没有区分主资源与关联资源。** `buildSessionRecovery()` 无条件调用 `sessionRelations()`；关联 Session 的 `repo.readSession()` 复用 `AgentSessionNotFoundError`，HTTP 层统一映射为 `SESSION_NOT_FOUND`。前端因此可能把仍有效的主 Session 当成失效目标处理。证据：`server/agent/harness/neuro-agent-harness.ts:2603`、`:2674`、`server/agent/http.ts:332`、`app/components/novel-ide/agent/AgentChatSurface.vue:1236`。
- **确认 P1：Recovery 失败后可能重复恢复。** `useAgentSessionStream.ts` 的 recovery catch 只调用 `onError`，`needsRecovery` 没有清除；后续事件进入 `handleEvent()` 后会再次调用 `syncRecovery()`。现有失败测试只验证内容保留，没有覆盖失败后再次收到事件的次数。证据：`app/components/novel-ide/agent/useAgentSessionStream.ts:205`、`:250`、`:264`，测试 `useAgentSessionStream.test.ts:348`。
- **确认 P1：Workflow 结果存在进程崩溃丢失窗口。** `execute()` 在 `record.result = outcome.result` 后只把状态和 delivery 字段写入 JSONL；如果随后进程退出，重启恢复只处理 `running/waiting`，已完成 Job 不回到内存，完整结果无法查询或重新投递。证据：`server/agent/jobs/agent-job-manager.ts:296`、`:365`、`:367`、`:443`。
- **确认 P1：停止请求失败没有用户可见出口。** `stopRun()` 的 catch 只有 `console.error`，没有通知或局部错误状态。证据：`app/components/novel-ide/agent/AgentChatSurface.vue:1666`。
- Product 容器风险暂不升级为代码缺陷：正式 Docker、POSIX verifier 和 release workflow 均调用 `commands/product-command.mjs`，该入口先执行 `openSelfVerified()`；`product-start-command.mjs` 是已验证 command bundle 内部入口。仍需正式 Container/Posix hostile `NODE_PATH` 和 archive 验收来关闭发布证据缺口。
- Workflow vendor runner 的直接调用目前只出现在测试和 `WorkflowDemoService`，正式 resume API 经过 Service 校验；没有发现绕过校验的生产路径，但真实并发 HTTP resume 仍未验证。

### 当前判断

- 无 P0。
- 有 4 个已确认的运行时/恢复 P1；另有 Issue #46 归属和测试证据不一致两个发布收口阻塞项，需明确为修复、后续任务或历史记录。
- P2 包括 Task 134 浏览器状态滞后、Task 111/PROJECT-STATUS 测试口径不清、Product 平台 baseline 文档口径不清、POSIX hostile `NODE_PATH` 覆盖不足，以及替代 PR 的过期正文/标签。
- 本 Task 只读审查已完成，未修改业务代码、未关闭 Issue、未合并或推送任何 PR；本轮已尝试浏览器审查，但目标页面未完成可读渲染，不能记为有效 UI 验收。

## TODO / Follow-ups

- [x] 汇总并核对所有只读子代理报告。
- [x] 主代理复核复杂的 Session recovery、Workflow delivery outbox 和取消失败竞态。
- [ ] 修复或转交 4 个运行时/恢复 P1，并为 Issue #46 选择最终归属。
- [ ] 更新 P1/P2 风险清单与对应 Task/Issue 公开记录。
- [ ] 在没有 P0/P1 或已明确阻塞转交之前，不宣称本轮完成。

### 2026-08-05：图片缓存路径专项浏览器审查

- **确认行为：当前 Source Dev 会把图片变体写入仓库根 `cache`。** 现场存在两个新生成的 WebP：
  `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\neuro-book\cache\image-variants\`，文件时间为 2026-08-05 15:50 左右；该目录由 `.gitignore:75` 忽略，但仍污染 checkout 的 Application Root。
- **根因调用链：** `server/runtime/paths/runtime-paths.ts:64-82` 在未设置 `NEURO_BOOK_APPLICATION_ROOT`、`NEURO_BOOK_STATE_ROOT`、`NEURO_BOOK_CACHE_ROOT` 时依次取 `process.cwd()`、Application Root 和 `State Root/cache`，当前 checkout 因而解析为 `neuro-book/cache`；`server/media/image-variant-runtime.ts:13-17` 再把 `paths.imageVariantRoot` 交给 `ImageVariantModule`。图片模块没有另行拼接仓库路径。
- **启动链缺口：** `scripts/cli/source-dev.ts:23-30` 只注入 host 和 shutdown token，没有注入 State/Cache Root；当前 `.env` 也没有这两个变量。`package.json` 的 `dev:runtime` 直接启动 Nuxt，未建立仓库外 Source Dev State/Cache owner。
- **合同对照：** `reference/media/image-variants.md:54`、`docs/adr/0006-image-variant-and-original-ownership.md:20` 和 `docs/adr/0010-desktop-storage-loopback-shutdown.md:40` 要求变体位于 `Cache Root/image-variants`；受管 Product 必须显式注入 Cache Root，Source Dev 未配置时才回退到 `State Root/cache`。因此“仓库根 cache 是否错误”取决于 Source Dev 的 State Root 是否本应在仓库外，但当前启动行为和用户观察已确认一致。
- **浏览器证据：** `http://localhost:3000/?project=ming-ding-zhi-shi-2` 的 HTTP GET 返回 `200`、`text/html`、约 5385 bytes 的 Nuxt HTML，但浏览器截图为空白，DOM snapshot 为空，控制台未采集到有效业务日志；重载和新标签导航分别在页面评估/`Page.navigate` 阶段超时。页面没有完成可操作渲染，本轮不能宣称已完成图片上传/预览 UI 验收。
- **自动化证据：** `bun test server/runtime/paths/runtime-paths.test.ts server/media/image-variant.test.ts` 为 17/17 通过；直接调用 `runtimePathsFromEnv(repoRoot, {})` 明确输出 `cacheRoot=repoRoot\\cache`、`imageVariantRoot=repoRoot\\cache\\image-variants`。这些测试证明模块预算、缓存完整性和显式路径注入工作，不证明 Source Dev 默认 owner 符合产品预期。
- **当前定级：** P1 候选，暂不直接修复。若 Source Dev 必须与 checkout 隔离，这是运行时边界缺陷；若仓库根被定义为 Source Dev 的 State Root，则是默认值/文档缺口。需要下一步决定 Source Dev 的 canonical State/Cache locator，再补回归测试和迁移/清理策略；不要直接删除现有 `cache` 内容。

#### 本轮子代理补充

- 浏览器子代理确认目标页超过 12 秒仍为空白，按钮、文件输入和 `contenteditable` 均为 0；`/api/projects` 及目标项目接口返回 200，未确认是 Project open、presence SSE 还是 workspace 路由同步阻塞。截图保留于 `.agent/browser-audit-ming-ding-zhi-shi-2-2026-08-05.png`。另发现开发模式 HTML/Vite 资源含本机绝对路径，列为未确认生产影响的中风险。
- 图片路径子代理未发现附件越权：`entries/[contentIndex].get.ts:47-57` 先授权再处理变体；Agent 原图仍是 `<Workspace Root>/.nbook/agent/attachments/sha256/<2>/<62>`，multipart 上传未写 OS 临时文件。其 5 个附件/路径/变体测试文件共 33 项通过。
- 合同子代理未发现 P0；补充指出 `server/media/image-variant-runtime.ts:12-18` 每次调用重新读取环境并可能替换全局 Module，若运行中环境变化，旧实例的在途写入可能落到旧 Cache Root；现有测试未覆盖该交错场景，暂列中风险待集中复核。

### 2026-08-05：五个新 PR 浏览器验收批次

本轮按 PR 一对一派发 5 个只读浏览器代理：#64、#61、#59、#63、#65。结果全部是“验收阻塞”，没有任何 PR 获得浏览器通过结论；不把这些阻塞写成产品 P0，也不把 focused 测试写成浏览器通过。

- **#64（#49 clean replacement，Product/World Engine）：阻塞。** 目标 URL 导航超过 60 秒并报 `Page.navigate` 超时，DOM、截图、控制台和 API 均未取得；World Engine、日历、配置入口全部未验证。该 PR 声称无前端改动，Product smoke 不能替代浏览器验收。代码范围锚点仍以 [PROJECT-STATUS.md](../../../PROJECT-STATUS.md:13) 和 PR 的 Product Runtime 边界为准。
- **#64 补充证据：** 另一只读浏览器代理在首次加载约 3 秒时取得空白截图：`#__nuxt` 存在但无可见内容，按钮、链接、输入框和 ARIA 节点均为 0，仅有 Nuxt DevTools；控制台只有 Vite/Nitro 连接日志。随后导航和截图再次超时。World Engine Workbench 只有在项目达到 ready 后才请求 schema/calendar，因此本轮没有真实消费证据，不能把“未见 schema 错误”当成成功。
- **#61（Profile 设置）：阻塞。** 导航超时，后续 `Runtime.evaluate`、DOM、截图、控制台和 API 均不可用；Profile 切换、默认设置恢复、详情渲染、窄屏弹窗、滚动区和保存/重置全部未验证。代码验收锚点：[NovelIdeAgentProfileModelSettingsPanel.vue](../../../app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue:627)、[AgentProfileDefaultsPanel.vue](../../../app/components/novel-ide/settings/AgentProfileDefaultsPanel.vue:43)、[NovelIdeSettingsDialog.vue](../../../app/components/novel-ide/NovelIdeSettingsDialog.vue:722)。
- **#59（Composer 键盘与图片门禁）：阻塞。** 导航/浏览器内核超时，没有取得 DOM、截图、控制台或 API；普通 Enter、Shift+Enter、Ctrl/Meta+Enter、IME composing Enter、图片 pending/metadata failure/预算门禁和“无乐观消息”均未验证。代理已读取文件上传指引，但没有上传文件。
- **#63（取消、半截正文与错误投影）：阻塞。** 导航调用约 8.3 秒后被中断，没有 provider/会话、DOM、截图、控制台或 API/SSE 证据；停止、半截正文、已停止文案、重试分支、慢工具停止、错误去重、刷新恢复和真实 provider 抛异常路径全部未验证。
- **#65（Workflow/Jobs feedback loop）：阻塞。** 浏览器连接成功但标签列表为空，未成功建立目标标签页，因此 waiting Composer、多 Run 隔离、结果回流、状态图、Job center、`wf.ask` 重复提交、usage、详情和刷新恢复全部未验证。

**批次结论：** 当前本地 `localhost:3000` 浏览器验收环境不稳定，至少出现导航超时、页面运行时超时和标签页为空三类阻塞。该结果只说明五个 PR 尚未取得浏览器证据，不能归因到任何一个 PR 的业务代码。修复/重启本地服务并确认浏览器可稳定加载后，应按同一清单重跑五项；在此之前不能宣称五个 PR 浏览器验收完成。
