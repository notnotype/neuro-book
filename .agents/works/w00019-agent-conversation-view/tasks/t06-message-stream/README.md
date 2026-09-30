---
schema: nbook.task/v2
taskId: t06-message-stream
---

# 消息流：滚动、阅读位置、历史分页、原始视图与消息状态

## 目标

实现切片 S3 剩下的部分。S2 已经做完轮次、摘要行、过程时间线、工具组与运行结束自动收起；本 Task 补上随时间变化的行为，以及类型里已有、界面还没显示的几种消息状态。

## 合同

[ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md)（planned）的“展开与折叠”末条、“原始视图”“历史与滚动”“消息”，验收第 4、7、9、10 条。

## 范围

- 滚动：停在底部时跟随新内容；用户离开底部后不再跟随，并出现“回到最新”；切换会话后定位到最新。
- 阅读位置：视口上方或正在读的内容变化（整轮收起、插入更早一页、点开收起）时，视口里的内容不跳；运行结束整轮收起时以该轮最终回复为锚点；焦点在被收起的过程里时移到整轮摘要行。
- 历史分页：接近顶部时发出 `history.loadPrevious`；顶部一行显示“更早的内容”、加载中、失败与重试。
- 原始视图做成正式版本。
- 消息状态：投递中；投递状态未知时的说明、“重新发送”和“移除”；仅显示预览；附件与图片缩略图；流式输出光标。
- Lab：对话视图夹具的“模拟宿主”补上流式输出、追加步骤、分页加载（可设为失败）与切换会话；新增对应场景；Component Lab smoke 新增 `agent-conversation` 套件，用浏览器量滚动位置。

## 非目标

- 历史消息的就地编辑：编辑器独立成组件，和输入框一起在 S6 做（开发者 2026-09-30 确认）。
- 错误条目的重试等条目渲染器（S5）、时间线回放（S4）。

## 当前状态（2026-09-30）：开发者已确认

开发者在 Lab 验收后确认，另提出细节还要打磨、需要加上动画，具体项待开发者列出，不阻塞后续切片。

实现要点：
- 滚动（`use-stream-scroll.ts`）：停在底部时跟随；离开底部后以视口顶部最深的露出元素为阅读锚点，被移除时依次改用下一个兄弟、父元素……，所以过程收起时固定的是最终回复；点击引起的变化以被点的元素为锚点。位置记成内容坐标，在视图更新前记下；浏览器因内容变短把 scrollTop 夹到底部时不当作用户滚动。滚动容器关掉浏览器自带的滚动锚定。
- 历史：顶部一行“更早的内容”（可点）、加载中（约 200ms 后淡入）、失败与重试，高度一致且不当锚点；接近顶部或内容不足一屏时请求，一页加载完高度没变时再检查一次；开头不完整的一轮补上更早的消息后沿用原来的组件 key（`assignTurnKeys`）。原先轮次内的“更早的内容”分隔线并入这一行。
- 离开底部时底部正中显示“回到最新”。
- 原始视图：新组件 `AgentRawView`，每条消息一块，头部是原始字段与 JSON 切换，正文不渲染 Markdown。
- 消息状态：新组件 `AgentUserContent`（文字、图片缩略图、文件、“仅显示预览”）与 `AgentDeliveryNotice`（投递未知的说明、重新发送、移除）；用户角色行与 steer 显示“发送中”；`AgentMarkdown` 新增 `streaming` 光标。
- 消息操作新增按单条消息判断的 `appliesTo`：尚未确认送达的用户消息不提供编辑、重试与分支。
- 焦点：整轮自动收起时焦点若在过程里，移到整轮摘要行。

Spec 调整（`ui.agent-conversation-view`）：
- “历史与滚动”补上跟随底部、“回到最新”、点击锚点与顶部历史行。
- “展开与折叠”末条改为“视口顶部正在读的内容保持原位，它在被收起的过程里时以最终回复为锚点”；原文只写了以最终回复为锚点，用户读的是该轮用户消息时会把它推出视口。
- 注册表的消息操作可按单条消息判断；Smoke 一节写明新套件。

## 验证

- 新增 `bun run smoke:component-lab:agent-conversation`（`scripts/smoke/agent-conversation-view.ts`，按场景各开标签页、URL 参数直达）：跟随底部、离开底部后流式输出与新步骤不移动阅读内容、下方轮次收起不跳（验收 4）、过程收起时最终回复不动且焦点移到摘要行、加载更早一页位置不变且沿用同一组件（验收 7）、全部加载后各轮收起、失败重试、原始视图切换（验收 9）、投递未知的说明与重发移除（验收 10）。倒数第二版连续 3 次通过，改完最后一处（点击加载不受滚动去重限制）后再跑一次仍通过。
- 变异检查：分别去掉阅读锚点校正、去掉“下一个兄弟”替补、去掉夹底判断，smoke 都会失败，说明断言确实在检验这些行为。
- `lab:shot`：`AgentConversationView` 8 个场景与 `AgentConversationTurn`、`AgentTurnBlock`、`AgentMarkdown`、`AgentUserContent`、`AgentDeliveryNotice`、`AgentRawView`、`AgentMessageActions` 全部场景，手机与 1400x900 共 70 张，没有溢出、越界元素或页面问题；关键场景另截了昼色配色，对比正常。
- 单测：`app/component-lab` 与 `app/components/agent` 176 个，167 通过；9 个失败仍是未改动的 `WorkbenchShellLayoutFixture.test.ts`。`conversation-turns.test.ts` 新增 `assignTurnKeys` 两例。
- `bun run typecheck` 仍为 32 个既有错误；`scripts:typecheck` 无新脚本错误；`docs:check` failures 为 0。

## 进展记录

调试中发现并修掉：
- 一页加载完、补上的内容都收在已收起的轮次里时高度不变，视图停在顶部却不再请求下一页。改为加载结束后隔两帧再查一次。
- 内容变短时浏览器先把 scrollTop 夹到新底部并发 scroll 事件，视图据此判定“停在底部”，跳过了锚点校正，最终回复上移约 40px。改为跟踪已知 scrollTop，识别夹底。
- 分页不按轮次切时，更早的一页只补上过程、不含用户消息，原先只看组里第二条消息的 key 规则会重建组件。改为沿用组里第一条“上次是组首”的消息的 key。
- `AgentTurnBlock` 夹具给自带 24px 缩进的块加了 `w-full`，横向溢出约 20px；去掉 `w-full`。

验收后修的 Lab 报错（开发者 2026-09-30 报告“切换组件会报错”）：
- 从对话视图切到 fixture 加载较慢的组件（例如 DiffWorkbench）时，控制台报 `Cannot read properties of null (reading 'type')` 与 `reading 'nextSibling'`。根因在 `LabShell`：场景与输入在切换的那次渲染就换成新组件的，fixture 组件却要等 loader，旧 fixture 按新 key 带着别的组件的输入重新挂载，`AgentConversationView` 读不到 `ctx` 而在 setup 抛错，随后整个舞台卸载失败。改为开始加载时先清空 fixture 组件。旧的宽容型 fixture 拿到错误输入不抛错，所以之前没暴露。
- 同一轮复现里还有 `SharedDiffEditor`、`SharedMergeEditor` 的问题：首次加载 Monaco 要几秒，这期间组件被切走、模板 ref 已置空，加载完仍往空容器建编辑器。改为加载后重新取容器，取不到就返回。
- `agent-conversation` smoke 新增“切换组件”检查：从对话视图在组件树里切到 JsonViewer，并用 `page.route` 把它的 fixture 模块请求拖慢 1 秒，保证加载慢于淡出动画。去掉 `LabShell` 的修复后这项检查报出同样两条错误，恢复后整套通过；`smoke:component-lab:core` 通过，typecheck 仍是 32 个既有错误。

非目标（留给后续）：历史消息的就地编辑器（S6，与输入框共用编辑器组件）；点击缩略图看原图需要宿主的附件 action，随 S7 附件面板一起定；`smoke:component-lab` 的完整组合没有并入新套件。

回写（开发者 2026-09-30 批准）：
- `packages/nb-ui/docs/design-language.md` 的“踩过的坑”新增 49（内容变短时浏览器先夹底、再轮到 ResizeObserver）与 50（断言“位置不变”前先断言触发条件成立）。
- 开发者新增规范“文档不用 `§` 这类罕见符号，引用章节写小节名或锚点链接”：改写根 `AGENTS.md`“了解开发者”里原有的罕见符号条目，使其同时覆盖回复与文档；`task-reflection` 回写表模板的目标位置改为“文件路径的小节名”。
- `governance:check` 新增 `verifyRareDocumentSymbols`（`scripts/ci/agent-governance-contract.ts`）：统计活跃 Markdown 正文里的 `§`、`¶`（不算行内代码、代码块和历史归档），只给一条警告，列出总数、未提交改动里的文件与存量最多的 5 个文件，不列逐处位置；补两例单测。
- 顺手清掉本 Work 触及文件里的 `§`：`design-language.md` 18 处、`ui-development` Skill 3 处、t05 记录 2 处。现存 74 个文件 365 处仍只报警告；`packages/neuro-book/AGENTS.md` 的 1 处在他人未提交的改动里，未动。
