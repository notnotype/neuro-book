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

### 本轮结论

- #64：核心页面通过。
- #61：数据和恢复默认通过；窄屏详情布局暂定 P2。
- #59：键盘基本分支、PNG 类型门禁和附件原图路径通过；IME、metadata、预算边界未验证。
- #63：停止、取消投影、历史错误和刷新恢复部分通过；复杂竞态仍未关闭。
- #65：入口和历史 Workflow/Jobs 展示可见；关键等待、投递、隔离和结果回流场景未验证。
- 当前不能宣称五个 PR 的浏览器验收全部完成，也不能把本地环境中未出现任务误报成 Workflow 产品失败。

## TODO / Follow-ups

- [x] 完成 #64、#61、#59、#63、#65 的第一轮直接浏览器审查，并区分通过与未验证。
- [x] 记录图片缓存路径的浏览器/文件系统关联证据，不直接删除现有缓存。
- [x] 对复杂或不确定的失败场景保留主代理集中复核结论。
- [ ] 输出人话版 PR 功能报告和审查清单；P0/P1 未解决时不宣称本轮发布完成。
- [x] 核对本轮真实模型声称生成的 `.agent/browser-enter-audit.md`；文件实际不存在，不清理用户已有的 `cache/` 或 Workspace 附件。
