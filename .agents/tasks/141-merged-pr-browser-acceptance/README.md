# Merged PR Browser Acceptance

> Active task directory format: `NN-kebab-case-name/`. This task records direct browser acceptance of the five merged PRs after the earlier static review.

## Relative documents refs

- [Task 140 PR review and release gates](../140-pr-review-and-release-gates/README.md)
- [Task 108 Agent image attachment references](../108-agent-image-attachment-references/README.md)
- [Task 111 Workflow integration](../111-workflow-agent-integration/README.md)
- [Task 134 Agent Profile settings navigation](../134-agent-profile-settings-navigation/README.md)
- [Task 139 Agent abort and error projection](../139-agent-abort-error-projection/README.md)

## User Request / Topic

由主代理直接对已经合并的五个新 PR 做浏览器验收：#64、#61、#59、#63、#65。复杂、不确定的地方集中复核，并把用户观察到的图片缓存路径问题一并保留为风险记录。

## Goal

在本地真实运行的 NeuroBook 页面中，按用户可见工作流验证五个 PR 的核心行为，记录每个场景的操作、结果和证据；通过项、未验证项、环境阻塞和产品问题必须分开。除任务记录外不修改业务代码、不清理用户数据、不合并或关闭 PR。

## Current State

- 当前验收地址：`http://127.0.0.1:3000/?project=ming-ding-zhi-shi-2`。
- 本轮浏览器已能加载项目主界面、Agent 会话和 Workflow 待处理区；此前 `localhost`/浏览器时序曾出现导航超时和空白页，本轮不把旧阻塞直接当成当前产品缺陷。
- 工作区存在用户在途改动和未跟踪 `cache/`，本任务不触碰：`.gitignore`、`agent-chat-surface-state.ts`、`session-repo.ts`、`session/types.ts`、`agent-session.dto.ts`、`cache/`。
- 验收范围：#64 Product/World Engine、#61 Profile 设置、#59 Composer 键盘与图片门禁、#63 停止/错误/恢复、#65 Workflow/Jobs 反馈闭环。

## ADR / Decisions / Discussion

- 使用同一浏览器标签页和同一项目，减少跨项目状态差异；需要窄屏时临时调整 viewport，结束前恢复默认尺寸。
- 只使用页面可见状态、网络可达的产品操作和浏览器控制台作为验收证据；focused 测试只作为旁证。
- 不把浏览器加载超时归因给某个 PR 的业务逻辑；若页面无法稳定到达目标功能，记录为环境阻塞。
- 图片缓存问题单独记录：当前 Source Dev 观察到仓库根 `cache/image-variants` 有新文件，但不能在没有明确 State Root/Cache Root 归属前直接删除或修改缓存。

## Verification / Test

### 验收清单

- #64：打开 World Engine，读取世界配置/Schema/日历，确认页面无 schema/compiler 错误。
- #61：进入 Profile 设置，切换 Profile，恢复默认设置，打开详情，验证窄屏弹窗和滚动区域。
- #59：验证普通 Enter、Shift+Enter、Ctrl/Meta+Enter、输入法 composing Enter，以及图片 pending、MIME/metadata/预算失败门禁和失败时不创建乐观消息。
- #63：验证停止生成、半截正文、取消后重试、慢工具停止、错误去重和刷新恢复。
- #65：验证 Workflow waiting Composer、多 Run 分别应答、结果回流、状态图、任务中心、`wf.ask` 防重复和刷新恢复。

### 证据口径

- 通过：页面已完成对应操作，并取得可见结果或明确状态变化。
- 未验证：页面可用，但本轮尚未完成该项操作。
- 环境阻塞：浏览器/服务无法稳定到达功能，不能据此判断 PR 业务正确或错误。
- 发现问题：已能稳定复现且与产品行为相关，附绝对路径、行号或可复现步骤。

## Implementation Walkthrough

### 2026-08-05：建立本轮验收任务

- 读取 Task 140 的既有审查记录，确认本轮目标为五个已合并 PR，而不是重新派发子代理。
- 读取浏览器控制规范并连接本地页面。
- 首次使用 `127.0.0.1:3000` 时页面在约 5 秒后完成渲染，得到项目主界面截图；页面包含 Agent 会话列表和 `Workflow 待处理` Composer，浏览器可继续操作。

### 浏览器结果

#### #64 / Product World Engine：通过

- World Engine Workbench 正常打开，页面显示项目名、日历格式和“已同步”。
- 结构栏能读取 `world-engine/schema/index.ts` 与 `world-engine/calendar.ts`。
- 页面显示 8 / 8 个主体、7 / 7 个切片，主体和切片详情均可见。
- 本次没有看到 schema、calendar、compiler 或 World Engine 加载错误。
- 这只证明当前 Source Dev 页面能消费现有 World Engine 数据；Product archive、hostile `NODE_PATH` 和正式发布载荷仍沿用 Task 140 的独立门禁。

#### #61 / Profile 设置：部分通过，发现 P2 窄屏问题

- 配置中心可以打开 Agent Profile 模型页面，并完成 Profile 数据读取。
- 点击“主创 / leader.default”后，详情标题、当前默认状态、源文件和参数区正常显示。
- 点击“回到默认”后，Profile 覆盖计数消失，“保存设定”变为可用；本次没有保存，未改写配置文件。
- 390 x 844 视口下，整个页面没有横向滚动，但配置中心内部的 Profile 左右布局没有堆叠：详情面板位于弹窗右侧，默认只有约 46px 可见，需要横向滚动才能访问完整内容。暂定 P2 UX，证据为内部滚动容器 `clientWidth=36`、`scrollWidth=231` 和窄屏截图。

#### #59 / Composer 键盘与图片门禁：核心部分通过，若干项未验证

- Shift+Enter 在输入框中保留换行，不会发送。
- 普通 Enter 清空输入并出现用户消息，证明普通发送分支可达。
- 运行中 Ctrl+Enter 清空输入，并在 Workflow Composer 中显示“队列 / 消息已排队”，证明跟进消息进入队列。
- 停止这次真实模型运行后，页面显示“已停止生成”。
- 选择 `package.json` 后立即显示“图片格式不支持，仅支持 PNG、JPEG、GIF 和 WebP”，没有创建图片预览或发送消息。
- 选择本地 PNG 后出现图片预览，Composer 显示附件路径 `workspace/.nbook/agent/attachments/...`；移除图片后草稿恢复为空。
- 当前模型页面提示“不支持图片输入，后端会使用文本占位”；上传中文文件名在本次浏览器输出中显示为乱码，暂列观察项，不单独升级为确定产品缺陷。
- Windows 中文输入法真实 composing Enter、metadata 失败、32 MiB 预算超限和失败时无乐观消息，本轮没有可靠复现，不能用 focused 测试替代。

#### #63 / 停止、错误和恢复：部分通过

- 对真实运行点击“停止”后，停止按钮消失并出现“已停止生成”。
- 历史会话 `#775` 能显示 `Command aborted`；历史 Workflow 失败也能显示 `500 status code (no body)` 及触达的 Session 信息。
- 刷新当前错误会话后，页面先显示“正在恢复对话”，随后恢复会话列表、消息内容和 Workflow 失败信息。
- 本轮没有稳定验证慢工具停止、半截正文保留、取消后重试、失败去重协议窗口，以及真实 provider 抛异常后的全链路表现。Task 140 已记录的 Session recovery、重复恢复和停止失败用户出口风险仍然有效。

#### #65 / Workflow 与 Jobs 反馈闭环：部分可见，关键场景未验证

- 已完成 Workflow 的历史会话能看到 `run_workflow` 结果消息和 Workflow 类型标识。
- Workflow 待处理 Composer 能显示“每个流程分别应答”，并在已有历史会话中看到 `novel-setup` 技能项。
- Jobs 入口可打开，显示 `全部 0 / 进行中 0 / 已结束 0` 和“暂无后台任务”。本轮没有可安全回答的实时 `wf.ask`，因此没有发送新答案。
- 多 Run 分别应答、结果回流到正确 Session、状态图、Job delivery、重复提交门禁、usage 清理和刷新恢复未取得完整浏览器证据。

#### 图片缓存路径专项观察

- 上传 PNG 后，原图附件路径出现在 `workspace/.nbook/agent/attachments/sha256/...`。
- 仓库根 `cache/image-variants` 现有两个 WebP，时间为 2026-08-05 15:50；本次模型声明不支持图片输入，没有生成新的变体。
- 该现象与“原图位置正确、图片变体可能落在仓库根 cache”一致。不要直接删除现有缓存；Source Dev 的 canonical State Root / Cache Root 仍需单独决定并补回归测试。

### 2026-08-05：leader.default Harness 自查复核

本节复核 Project `ming-ding-zhi-shi-2` 中 `leader.default` session 834 的自查报告。持久化 Session、trace、Job 和 Project SQLite 证据支持其主要工具闭环结论，但原报告对模型故障、Git Bash、writer brief 和清理范围的定性过于乐观。本节只记录证据，没有修改模型配置、业务代码或 Project 数据。

#### P1：当前 Workspace Root 的 Profile 模型覆盖不可用

- [Workspace Root 配置](../../../workspace/.nbook/config.json:5)的全局默认模型是 `opencode/deepseek-v4-flash`，但 `retrieval`、`researcher`、`summarizer` 和 `memory.curator` 都显式覆盖为 `xiaomi-token-plan-cn/mimo-v2.5-pro`；目标 Project 没有进一步覆盖这些模型。
- retrieval session 837 两次、session 839 一次、researcher session 840 一次，共 4 次默认调用均在首个模型轮次返回 `503 Gateway Error: 没有可用的内网节点`，每次都是 0 token。session 839 和 840 显式改用 `opencode/deepseek-v4-flash` 后立即进入正常工具调用并完成任务。
- 原报告漏掉了 summarizer session 836：它从 15:52 到 19:06 共记录 9 次同类 503，全部是 0 token，说明当前长会话的自动摘要也持续失败。
- `memory.curator` 使用相同显式覆盖，因此列为同配置风险；本轮没有它的当前实调证据，不能写成已复现故障。
- 运行时按 Profile 覆盖选择模型的行为正确，问题是当前持久化配置选择了没有可用节点的模型。当前定级为 **P1 配置阻塞**，不归因于五个已合并 PR，也不建议运行时静默换模型；应恢复继承全局默认模型或显式选择可用模型，再分别验证 retrieval、researcher 和 summarizer。

#### P2：retrieval 内置 Git Bash 命令并不安全

- [retrieval Profile](../../../assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx:69)固定要求先执行 `rg --files | rg '(^|/)index\.md$' | workspace node parse --stdin --ndjson`。在真实 Git Bash 中，MSYS 会把正则参数里的裸 `/` 改写成包含 Git 安装目录的路径；最小输入 `lorebook/foo/index.md` 因而无匹配，命令退出码为 1。相同输入改用 `grep -E` 或把正则放进文件后可以匹配。
- [Profile 测试](../../../server/agent/profiles/leader-assets-profile.test.ts:394)把该字符串断言为“Git Bash 安全”，但只检查提示词包含文本；[bash 配置测试](../../../server/agent/tools/file-tools.test.ts:879)实际执行的是不含 `/` 的 `rg 'index.md$'`。本轮两个 focused 测试分别为 1 项通过、14 项跳过和 1 项通过、48 项跳过，但它们没有覆盖真实失败模式，不能作为该命令可用的证据。
- `MSYS_NO_PATHCONV=1` 不是可接受的全局修复：Agent bash 注入的 `RIPGREP_CONFIG_PATH` 使用 Git Bash 路径，需要 MSYS 转换。后续代码修复建议把固定命令改为 `rg --files -g 'index.md' | workspace node parse --stdin --ndjson`，并增加真实 Git Bash 执行回归。本 Task 不修改 Profile 或测试。

#### 正常合同、设计行为与 Project 数据问题

- `workspace project validate` 的参数是 Workspace Root 下的 Project slug，`.` 是保留目录名，拒绝它符合 [Project locator 合同](../../../server/workspace-files/project-identity.ts:180)。`workspace node validate` 同时支持直接路径和 `--stdin`；自查中 `printf` / `grep` 管道验证通过，原 `rg '(^|/)...'` 管道失败归入上述 Git Bash 缺陷，不归因于 CLI。
- World Engine 首写 subject 时注入 schema default 初始化 patch 是正式设计，本轮对应 Vitest 为 1 项通过、26 项跳过。编辑已有 patch 时应先读取完整切面并按 `patchId` 精确定位；“同路径永远取最后一条”只描述特定 reduce 结果，不能替代公开编辑合同，且 `editPatches` 后原 patchId 会失效。
- t99 验收线的 3 个场景 6、7、8 当前都没有完整时间锚点；其中挂在被测章节上的场景 6、8 直接令 brief 进入 `needs_world_anchor`。这证明 brief 状态机工作正常，但 [writer brief 合同](../../../reference/plot/writer-brief.md:48)明确要求非 `ready` 时先补齐再交接，因此不能写成“不影响主章写作”。这是历史测试数据对当前 Project 写作门禁的真实污染，不是编译器缺陷。

#### 清理边界复核

- 当前 `WorldSubject`、`WorldPatch`、`StoryThread`、`StoryScene`、`StoryPromise`、`StoryPromiseBeat`、`StoryDecision`、`StoryChapter` 八张业务表中，带 `test-harness` 标记的记录均为 0；`.agent/harness-test` 不存在。
- session 834 的持久化结果确认测试 Agent 835、837、838、839、840 均已 detach。后台 bash `job_6690a953` 为 `cancelled/accepted`，Workflow `job_e88671a3` 为 `completed/accepted`，没有活动测试任务。
- Session 835-841、对应 trace 和 `jobs.jsonl` 审计记录按设计仍保留；SQLite 自增序列也已经前进，例如 `StoryChapter seq=4/max=2`、`StoryScene seq=10/max=8`。此外，本轮主动删除了测试前已存在的 `test-harness-entity`，所以数据库并未回到严格的测试前状态。
- 没有测试前快照，无法独立证明所有真实业务数据从未被写过或恢复到字节级基线。可以确认的窄结论是：**没有活动任务或本轮 `test-harness` 业务实体残留**。
- 2026-08-07 复核确认，先前列出的 8 个历史验收实体已经不存在；本轮不再执行额外删除，也不重置 SQLite 自增序列。

#### 复核结论

- 持久化证据支持文件、SQL、Plot、World Engine、Agent 调度、后台任务和 Workflow 的主要冒烟闭环；这不等于每条竞态、恢复路径或跨进程合同均已验证。
- 当前没有从这次自查新增 P0，但存在 1 个 P1 当前配置阻塞、1 个 P2 Git Bash 代码缺陷，以及会阻断 writer brief `ready` 的历史测试数据。
- 当前配置下不能称 Harness “完全健康”，也不能据此关闭 Task 140 已确认的 Session 关联资源恢复、失败后重复恢复、Workflow 结果崩溃丢失窗口和停止失败无用户提示四个 P1。

### 本轮结论

- #64：核心页面通过。
- #61：数据和恢复默认通过；窄屏详情布局暂定 P2。
- #59：键盘基本分支、PNG 类型门禁和附件原图路径通过；IME、metadata、预算边界未验证。
- #63：停止、取消投影、历史错误和刷新恢复部分通过；复杂竞态仍未关闭。
- #65：入口和历史 Workflow/Jobs 展示可见；关键等待、投递、隔离和结果回流场景未验证。
- leader.default Harness 自查支持主要工具冒烟闭环，但模型配置 P1、Git Bash P2、历史测试数据门禁和 Task 140 的四个 P1 均未关闭。
- 当前不能宣称五个 PR 的浏览器验收全部完成，也不能把本地环境中未出现任务误报成 Workflow 产品失败。

## TODO / Follow-ups

- [x] 完成 #64、#61、#59、#63、#65 的第一轮直接浏览器审查，并区分通过与未验证。
- [x] 记录图片缓存路径的浏览器/文件系统关联证据，不直接删除现有缓存。
- [x] 对复杂或不确定的失败场景保留主代理集中复核结论。
- [x] 复核 leader.default Harness 自查，区分配置阻塞、代码缺陷、正常合同、历史数据与清理证据边界。
- [x] 复核 8 个历史验收实体的当前状态；确认已不存在，不执行额外清理。
- [ ] 输出人话版 PR 功能报告和审查清单；P0/P1 未解决时不宣称本轮发布完成。
- [x] 核对本轮真实模型声称生成的 `.agent/browser-enter-audit.md`；文件实际不存在，不清理用户已有的 `cache/` 或 Workspace 附件。

### 2026-08-07：隔离根最终浏览器复核

本轮使用隔离根：

```text
C:\Users\<user>\Documents\CodeRepository\GithubProjects\neuro-book\.agent\tmp\t142-final-browser-c179997cd42e47a68f354006862d2412
```

应用状态迁移以 `bun run migrate:application-state -- --apply` 完成；隔离 Source Dev 在 `http://127.0.0.1:3002/?project=t142-browser-acceptance` 启动，并创建了临时 Project `T142 Browser Acceptance`。没有对真实 Project `ming-ding-zhi-shi-2` 发起写入请求。

#### 已取得的浏览器证据

- Source Dev 能完成迁移后启动，书架能打开临时 Project，文件树和 Novel IDE 主界面可见。
- World Engine Workbench 能读取 `world-engine/schema/index.ts`、`world-engine/calendar.ts`，显示“已同步”；创建 `world` subject 后页面显示 init Slice、主体状态、变更 patch 和检查器 JSON。
- 配置中心桌面视口可打开 Agent Profile 模型页面；390×844 下配置中心改为上下布局，页面和 `document.body` 均为 `clientWidth=390 / scrollWidth=390`，没有文档级横向溢出。证据截图：[evidence-settings-mobile.png](evidences/evidence-settings-mobile.png)。
- Agent 面板、Workflow 待处理区和 Jobs 入口可见；隔离 Project 没有真实模型，所以发送按钮保持禁用，避免伪造 provider 结果。

#### 仍未验证的场景

- 中文 IME Enter、Shift+Enter、Ctrl/Meta+Enter 的真实发送；图片 metadata 失败、32 MiB 预算和失败时不创建乐观消息。
- 停止失败通知与真实 provider 异常、半截正文、慢工具停止、取消后重试和刷新恢复。
- 主 Session 有效但关联 Session 缺失、重复 SSE recovery、手动恢复。
- 多 Workflow Run 分别应答、`wf.ask` 重复提交、结果回流、状态图、Job 详情和重启后刷新恢复。

这些场景需要真实可用的 provider、已有 Session 或可控的 Workflow demo 数据；本轮隔离 State Root 没有复制用户凭证，也没有将真实 Project 的数据带入测试。因此它们保持“未验证”，不写成失败，也不写成通过。对应逻辑由 Task 140/142 的 focused、重启和 durable store 测试旁证。

#### 图片缓存复核口径

- 本轮显式设置隔离 `NEURO_BOOK_CACHE_ROOT`，未产生新的仓库根 `cache` 业务文件。
- Source Dev 默认路径由 `scripts/cli/source-dev.ts` 和 `shared/source-dev-launcher.test.ts` 固定为 `<checkout>/.agent/cache`；显式 `NEURO_BOOK_CACHE_ROOT` 仍按原值使用。
- 旧的仓库根 `cache/image-variants` 不自动迁移、不在本 Task 删除；停服后由迁移指南提供人工清理方式。

### 本轮最终结论

- 本 Task 取得了隔离 Source Dev、Project、World Engine、Profile 设置桌面/窄屏的真实浏览器证据。
- 本 Task 没有取得真实模型驱动的 Composer、取消/错误恢复和 Workflow/Jobs 全流程证据；因此不能宣称五个 PR 已完成“全量浏览器验收”。
- 浏览器未验证项不构成当前代码 P0/P1；按本轮限量 canary 决策，它们作为已知未完成的人工/真实 provider 验收记录，不写成全流程通过。

### 2026-08-07：限量 canary 发布后的验收口径

- `v0.9.3-canary.20260807.175842Z.771ac42b` 已公开，Release workflow `31204827527` 的平台、Portable、公开 payload、GHCR 和 Windows data reuse 硬门禁全部通过。
- 这次发布不改变本 Task 对浏览器证据的边界：隔离 Source Dev、World Engine、Profile 桌面和 390×844 窄屏已有真实证据；真实 provider 驱动的 Composer、取消/错误恢复、Workflow/Jobs 多 Run 和重启人工流程仍标记为未验证。
- 该限量 canary 不宣称完整人工 Agent/Workflow 验收通过；后续补验应继续使用隔离 State Root 和临时 Project，不把 focused 测试替代浏览器证据。
