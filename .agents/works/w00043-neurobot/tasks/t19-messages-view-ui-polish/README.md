---
schema: nbook.task/v2
taskId: t19-messages-view-ui-polish
status: active
updated: 2026-11-25
---

# 消息视图界面优化：头像列位置、列表入口、会话图标、消息样式与头

## 目标与范围

停靠在侧栏时消息视图像一体的桌面界面：头像列贴外边缘当活动栏、去掉三横线、会话可辨认、窄聊天区少零碎；先出多种静态稿逐轮评审

起因：开发者 2026-11-25 看 t18 合入后的停靠窄版，觉得头和下面两栏接得突兀、“≡”打开列表的设计怪，喜欢头像列，提议把它放到右边、像左侧边栏那样；要求整体优化一轮、“各种设计都可以尝试”。t18 评审板第 3 轮的接缝题（`dock-seam`）由本 Task 第 1 轮的 `strip-side` 取代。

合同：提案 [侧栏的侧轨](../../../../../docs/proposals/workbench-side-rails.md)（已接受）；Spec（planned）：[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 50、51，[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 21、22，[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 57。

## 注意力排序（主 Agent 的假设，开发者有异议再改）

1. 先看对话内容：聊天区占大部分宽度，挨着编辑区。
2. 其次是谁在说、谁有未读：头像列常驻，bot 圆头像、会话方块，未读点。
3. 完整的 bot 列表与会话历史默认收起，按需从头像列打开。

## 开发者的决定

1. 评审板第 1 轮（开发者 2026-11-25）：头像列在右边缘、通到顶（`strip-side = right-full`）；附言：竖线太生硬，希望和左侧边栏共用一个做法，左右两个侧栏还能直接交换，问要不要做成通用的模式、不给活动栏与消息视图各写特例，什么 API 合适。完整列表从头像列底部两个按钮打开（`list-entry = foot`）。总评：窄版里拉出抽屉不一定是更好的交互，要列出现有 IM 的做法再比较。

2. 看第 2 轮稿后在会话里说（开发者 2026-11-25）：问有没有更好的做法，要求请 omp 的 `extremelycat/gemini-4-neon-xhigh` 当顾问、另派一个拉远看；“整页切换我感觉也不太好”；指出稿面两处：聊天区右边空出一条、右边的轨与卡片圆角断开（都是摆稿的样式问题：藏掉视图里的头像列后聊天区没按新宽度重排；复制的轨卡片两侧都带圆角、和卡片之间留缝，左边活动栏与侧栏是工作台按相连算的）。第 2 轮两题不按板上选项答。

3. 评审板第 3 轮（开发者 2026-11-25）：头像列做成工作台的侧轨（`rail-kind = shell`）。`list-switcher` 没选，附言：“单独做一个弹窗比较好”；另问：用户想找某一个会话怎么办，只能通过这个弹窗吗；对话视图浮动后是什么样子。

4. 评审板第 4 轮（开发者 2026-11-25）：`list-dialog = adjust`：“让 gemini 重新设计一版。还有我甚至觉得可以不做成弹窗，还可以做成另一个单独的视图。可以负载左侧面板等任意位置”（会话面板以前就是单独的视图 `nbook.agent.sessions`，t15 由消息视图 `replaces` 并进来）。`float-rail = adjust`：“侧栏模式下让用户可以选择展开这个侧柜会不会好用一些？还有这个滑轨要提供放到左边或者放到右边的选项（这个好不好做？）”

5. 看 gemini 第 2 版的归纳后在会话里说（开发者 2026-11-25）：侧轨展开“自动加宽右栏，挤写作区”可以做出来试试；问“右边的轨 + 目录”各是什么；五项与三张稿都放评审板。

6. 评审板第 5 轮（开发者 2026-11-25）：`dir-view = ok`，附言“就是现在样式有点丑。需要重新设计”；`dir-open = ok`；`swap-scope = ok`；`rail-expand = widen`，附言“我感觉展开后还挺好看的。如果展开了后比较好看。我感觉第一题可以不做成单独的对话目录。但是类似这种侧轨的展开应该通用，也就是左侧的 ActivityBar 也支持展开（可以不做，但是底层要支持）”；`float-list` 未答。总评：“这个侧柜展开，还有浮动的时候和侧柜一起浮动。是一个新机制。需要审查一下现有底层是否支持。如果决定好了改底层设计，最后需要 gpt 来审查一轮才行。”

7. 展开的轨直接当完整列表（开发者 2026-11-25 会话里答“对”）：展开后顶上有搜索，下面是全部 bot 与全部会话，作品范围与筛选也在里面；收起时是 48 像素的快切栏。不再单独做“对话目录”视图（第 5 轮 `dir-view`、`dir-open` 随之作废，目录样式的问题一并消失）。

8. 底层调研后的四问（开发者 2026-11-25，选择框）：没有轨的地方（底部面板、与别的视图同在一个侧栏、多标签浮动窗）答“不准放这些地方行吗？”（主 Agent 回复：可以，加一个视图声明限制位置：只停左右侧栏、所在容器不接收别的视图、浮动窗只能单独一个标签）；右栏隐藏或拖到零时入口条像活动栏一样常驻；展开的宽度能拖（不按推荐）；浮动宽版没选，问“浮动会不会连着轨一起浮动、轨在布局里到底是什么”。主 Agent 回复：轨是两样拼起来的，区域的入口条（左边活动栏、底部面板与右栏顶上一行都是它，规范输出 22、47）永远不浮动，视图段（新对话、bot、最近会话、底部按钮、展开后的完整列表）属于消息视图，浮动时由视图在窗的右边缘画；以后分开叫“入口条”“视图段”。等开发者确认这个分法再写提案。

9. 看原型后（开发者 2026-11-25）：问浮动后右边的入口条还在是否正常（主 Agent 建议右栏一个容器都不剩时入口条跟着右栏收走：没有成员的容器本来没有入口，留着是一条空栏；原型已改）；入口条分组“对话图标｜新对话｜bot｜对话”挺好，新对话不排在 bot 上面（原型改成 bot、短线、新对话与最近会话）；顶上的容器入口照样能切到别的容器；对话视图不允许和其他容器分屏（即上面说的位置限制）。另指出原型两处毛病：拖入口拖出了资源管理器（副本带着活动栏第一项的标记）、入口条盖住拖动预览（层级）；原型已改。

10. 按原型的方案做（开发者 2026-11-25）：“可以就按这个方案做。要注意的是原型依旧有 bug。做的时候要重新做。切换浮动的时候很卡。需要好好把代码理清楚”。原型只作参考，不搬代码；入口条在工作台呈现层，视图段由视图交条目，飞行与宽度变化走工作台的布局过渡与尺寸求解，不逐帧量位置。

11. 提案 [侧栏的侧轨](../../../../../docs/proposals/workbench-side-rails.md) 的要点与三个待定项都按推荐（开发者 2026-11-25 答“可以，都同意”）；另要求写出全部状态与动作交 gemini 做 UI 审查：[`rail-states.md`](rail-states.md)。

12. 提案第 1 轮审查（gpt 29 条、Sonnet UI 约 50 条，处理见 [`evidences/design-review-rails-disposition.md`](evidences/design-review-rails-disposition.md)）后的三问（开发者 2026-11-25，都按推荐）：消息视图只停右栏与单独浮动；窄窗口先压编辑组、再压聊天区到最小，仍不够不展开并提示；别的面板最大化时先退出最大化。

13. 提案第三稿接受（开发者 2026-11-25 答“同意”），不再审第三轮；下一步写 Spec（planned）与 `plan.md`，计划交设计审查（前端 Sonnet，网格与布局记录部分 gpt）。

## 当前状态

- 草稿在草稿 worktree `.worktree/w00043-t19-drafts`（分支 `w00043-t19/drafts`，不合并）：直接在 `AgentMessages.vue` 里按 `globalThis.__msgDraft` 切变体，开发服务的真实页面上看（头、区域入口条与左边活动栏只在真实页面里有）；“头像列通到顶”的版本由截图脚本改入口条的样式摆出来。假模型端点造的三段对话。原图在本地 `shots/r1/`。
- 评审板第 1 轮（[`artifacts/review/index.html`](artifacts/review/index.html)）两题：`strip-side` 头像列放哪（推荐右边缘、通到顶），`list-entry` 去掉“≡”后列表从哪打开（推荐底部两个按钮）。直接画进稿里的：会话写标题首字的方块、“新对话”挪到头像列最上面、抽屉从头像列那一侧拉出。

- 评审板第 2 轮：`rail-look` 侧轨的样子（右栏有侧轨、两边对调各一张整窗稿），`list-open` 窄版点“会话历史”是抽屉还是整页切换（推荐整页）。稿是在真实页面上复制左边活动栏卡片当右边的轨，把头像列各项搬进去；对调稿把整个外壳水平镜像、再把各块内容翻回正向。原图在本地 `shots/r2/`。
- 评审板第 4 轮：`list-dialog` 居中的会话与 bot 弹窗（Bot、会话两页，搜索与筛选照会话面板）；`float-rail` 浮动窗窄版在右边缘画同一组条目、顶格让给“回到停靠”，宽版照旧左列表右聊天；页上列了找某个会话的几条路。待提案里定：停靠宽版有常驻列表栏时轨上不再放头像与会话（只留容器入口），免得两处重复；会话搜索只查标题与说明，按消息内容搜要另做（已在会话里问开发者）。
- 顾问第 2 轮（gemini，[`evidences/advisor-omp-gemini-2.txt`](evidences/advisor-omp-gemini-2.txt)，说明 [`evidences/advisor-brief-2.md`](evidences/advisor-brief-2.md)）：完整列表做成单独的“对话目录”视图（新 id，默认主侧栏自己的容器、首次不显示），轨底两个按钮显示它并切页、聚焦搜索，选中在消息视图打开；轨不加显示名字的展开档；左右只做主次整列交换（呈现层重排，ActivityBar 留在树里），另开工作台 Task；浮动窗宽窄都用轨加目录，消息视图里不再内嵌完整列表。五项待拍板，已归纳给开发者。
- 评审板第 5 轮：标注图说明轨、对话目录、消息视图各是哪一块；五题 `dir-view`（目录视图默认在左侧栏，另附与消息上下排的稿）、`dir-open`（选中总在消息视图打开）、`rail-expand`（A 展开并加宽右边这一列，编辑区让出 152，推荐；B 不展开）、`swap-scope`（只做整列交换、另开 Task）、`float-list`（浮动窗不再内嵌列表，推荐；对照现在的宽浮动窗）。原图在本地 `shots/r3/`。
- 底层调研（Opus，[`evidences/foundation-research.txt`](evidences/foundation-research.txt)，说明 [`evidences/foundation-brief.md`](evidences/foundation-brief.md)）：右轨放在呈现层，做成 body 里和活动栏同形的呈现专属叶（不放进区域的包装分支：那样区域宽度意图每次回写多记一份轨宽，展开挤的是区域内容）；文档树、骨架判定、校验不动，活动栏留在树里；展开只改叶的厚度，编辑组吸收；锚与浮动窗记录加可选字段 `railExpanded?`，不进 `hiddenBars`；相连、圆角、最大化写死为左边一条轨，要改成按轨列表；中段收着是声明式条目，展开放完整列表由视图经 `VIEW_RAIL` 认领、Teleport 进工作台给的位置；浮动窗里轨是窗内外框部件、展开时窗变宽。四项产品取舍已问开发者。
- 浮动与回到停靠的交互原型（开发者 2026-11-25 要看动画与状态）：草稿 worktree 的 `src/plugins/drafts/web/rail-prototype.ts`，经 `src/web/boot.ts` 导入，开发服务（草稿 worktree，端口 4317）上直接点。停靠时右边缘是复制活动栏画的入口条，中间是视图段的副本（会话、bot 点了转给原项）；点浮动时视图段的影子从入口条跟着窗飞到窗的右边缘，入口条只剩容器入口、不按下、右栏空了变成单独的圆角卡片；点回到停靠或点入口条的容器入口，影子飞回入口条。时长与曲线取 `--motion-layout`、`--ease-layout`，从第一帧起计时。没做：展开、底部两个按钮。

## 下一步

- Spec（planned）已提交 dabe9cb6a；计划 [`plan.md`](plan.md) 第 1 稿（含测试分工与元素标记约定），开发者 2026-11-25 确认要点与“测试与业务并行”的分工（规则写进用户级 `~/.claude/CLAUDE.md`、仓库 `implementation-planning` 技能）。
- 第 0 片：Work 分支快进到 master `2f8e6f696`，重新 `bun install`。计划设计审查在跑：布局部分 omp `@review`（接着提案审查的会话，说明 `/tmp/review-t19-plan/brief-layout.md`），前端部分 Sonnet（`brief-frontend.md`）。测试第 A 段已派 Sonnet：worktree `.worktree/w00043-t19-e2e`（分支 `w00043-t19/e2e`），说明 `/tmp/review-t19-e2e/segment-a.md`。
- 计划审查两份都回来（前端 Sonnet 17 条、布局 omp `@review` 7 条），处理见 [`evidences/plan-review-disposition.md`](evidences/plan-review-disposition.md)：成立要改 22、部分成立 1、接受取舍 1（L4 撞名记为已知限制）。计划改成第 2 稿；Spec 随之改：停靠时消息视图照旧接管标题区（第 1 稿写错，F1）、views 输出 21 的 `window` 带宽度与顶格、nested-grid 输出 105 加程序宽度过渡的指引。
- 测试第 A 段交回（`w00043-t19/e2e` 上 `e268a97fb`）：`workbench-side-rail.e2e.ts` 17 条与 `support/side-rail.ts`，盘点见 [`evidences/e2e-segment-a-report.txt`](evidences/e2e-segment-a-report.txt)。主会话审过 diff；入口带改名等由段 B 跟第 2 稿。
- 2026-11-26：Work 分支快进到 master `2fb76a588`。片 0b：基线检出 `.worktree/w00043-t19-base`（detached `2fb76a588`，已构建），`layout-frames.ts` 跑通一轮（结果在本地 `.local/agent/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/perf/base-0b.json`）。片 1 提交 `5815d0a08`、`a88d156c4`：`rail` 字段、读入归一与诊断、形状比较、去向在 `finish` 一处结算（改了计划第 2 稿的“逐个函数写明去向”，见计划）、保留 `rail:` 前缀、容器重置清掉；包内单测与 store 真实存储往返都过，变异 8 处都被抓到（撞名一条先空过，已修）。`test:affected` 里 canon 的 `entry-kinds.dom.test.ts` 一条在 master 上同样失败（原有），模型设置页一条单独重跑通过（负载）。
- 片 2 提交 `53f747f69`：投影插入右轨叶、区域按预算宽度呈现、预算纯函数 `railBudget`。审查 L3 的漂移在这套写法下不出现（覆盖加在保留像素的区域节点上，回写本来就不写它），计划第 2 稿的“回写只留宽度”机制没做，改为注释写明约束、用真实缺省布局的往返用例守住（变异时失败）。验收 36 的数照字面算：1100 宽、侧栏 340 显示着时展不开，用例按实际的数写。store 还没接上，片 3b 画出右轨后打开。
- 片 3a 提交 `5f793e7e8`：相邻关系与 `WorkbenchSurface` 改成侧轨列表（活动栏连右边的侧栏、右轨连左边的右栏，左右镜像），`rail` 插槽，Lab 场景 `rail-cards`。验证：`adjacency.test` 15 条、`lab-workbench-surface` e2e 17 条通过；开发服务（4417）上的 Lab 里看了右栏与右轨相连、接缝短线在右轨左侧，隐藏时逐帧读到右轨 `data-shell-cap=leave`、短线留到缩完，把布局过渡放慢到 4 秒截中途，右栏左边的圆角跟着左沿走、和右轨拼成一张，终态右轨自己一张圆角卡片。显示方向没在 Lab 里点（场景里隐藏后没有入口能点回来），留给段 B 的 e2e。
- 片 3b 提交 `f3814f396`：`WorkbenchToolStrip` 加 `region`、`joined`，整条一个 Tab 停靠、方向键走（左右同一模型）；外壳在右栏外侧画右轨，右栏顶上不再有入口条，`WorkbenchRegionStrip` 去掉图标变体；接管标题区改按面板头宽；拖放按入口带方向量。工作台单测 574、工作台与 Lab 的 dom 151 条、类型检查、治理检查都过；开发服务真实页面上看了右轨与右栏相连、消息入口按下。视图段的 `main`/`foot` 与拒收区挪到片 5（元素要等视图段才有）。片 3a、3b 的前端实现审查（Sonnet）在跑，说明 `/tmp/review-t19-impl-3/brief.md`。
- 片 4 提交 `e31150442`：声明字段 `confinedTo`（SDK 的 `view()` 不收），关卡 `placementViolations` 判整份文档，store 的提交出口（`apply` 与新的试算 `permitsMoveView`、`permitsMoveContainer`）、拖放的指针落点、预览与键盘候选、“移动到”菜单与命令面板第二步、入口菜单的“移到”“重置”都过它；店里改归属的动作其实都经 `apply`（计划写的“不经 `apply` 的组合”不存在），只拒“比操作前多出来的”违反，读入归整失败时布局不被锁死。读入归整在 `reconcileViews` 里：受限视图搬回右栏自己的容器，占了它容器的视图搬进 `custom:split-<视图>`。测试视图 `test.sample-views.rail` 用开关贡献。真实 store 用例 10 条覆盖计划列的各条路径，变异（拿掉提交关卡、拿掉读入归整）都被抓到；工作台单测 598、dom 101 条、类型检查都过。`test:affected` 选中整个应用跑了 15 分钟没完，停了，改跑工作台与 SDK 目录。
- 片 3a、3b 的前端实现审查（Sonnet）回来：阻断 0、重要 2、建议 6，处理见 [`evidences/impl-review-3-sonnet.txt`](evidences/impl-review-3-sonnet.txt) 末尾，修正提交 `13364cb00`。右栏切换容器改成竖着滚，Spec 输出 42 右栏那段随之改（入口竖排到右轨后“方向跟着入口”的理由不再给横滚），请开发者知悉。
- 片 1、2、4 快速审查（Opus 重要 3、建议 6；omp `@review` 重要 8、建议 4，两边有 7 条重合），处理见 [`evidences/impl-review-124-disposition.md`](evidences/impl-review-124-disposition.md)，修正提交 `8c9efbd14`。成立就改的 12 类，挪到片 5 的 2 条（手势回写与预算覆盖、降级求解按收着的基线，计划片 5 已加），接受取舍 1 条（`confinedTo` 第三方也能写）：开发者 2026-11-26 答“同意”维持现状，写进 Spec views 输出 22。Spec 输出 50 随之改了预算公式（右栏只让到聊天下限与有效最小宽的较大者）与“重置位置”的说法。工作台、布局库单测与 dom、类型检查都过。
- 片 5 分三段：第 1 段 `b969efea2`（投影交出按预算覆盖呈现的节点 `widthOverrides`，手势落账对它只写拖动的那段；验收 35 随之写清，请开发者过目）；第 2 段 `e63c257ec`（合同 `VIEW_RAIL`、`ViewRail`、`viewRailOf`；注册表 `railOf` 不加载视图同步读；store 的 `railState`（基线按收着的投影求一次网格，`railBaseline`）、`acceptRailBounds`、`requestRailExpanded`（放不下不写、回报 too-narrow，能展开时退出最大化）、`commitRailWidth`（取整、夹取、等于缺省不写）；收走计算照旧按收着的选项）。第 3 段待做：实例层每代一份 `ViewRail` 控制（`web/views/view-rail.ts`，同 `view-head.ts`）、侧轨组件的 `main`/`foot`/展开按钮/轨宽手柄/加载骨架、外壳按已提交的位置分发借用与撤回、揭示通道、焦点交接、`data-drop-refuse` 拒收区、测试视图 `test.sample-views.rail` 的视图段。
- 片 5 第 3 段 `ded327b85`：实例层每代一份 `ViewRailControl`（`web/views/view-rail.ts`，换代、渲染出错、删除时退休：位置 `none`、请求 `revoked`）；`WorkbenchToolStrip` 的 `segment`：`main`/`foot`（`data-drop-refuse`）、展开按钮（太窄时写“窗口太窄”）、加载骨架、展开两栏（右轨镜像）、轨宽手柄（`use-rail-handle.ts`：每帧至多一次预览，Esc、失去捕获、布局版本变化取消，键盘每次 10、Home 与双击回缺省，网格分隔线手势中不起拖）、焦点交接（焦点所在元素被拆掉时交给展开按钮）；外壳按 `state.rail` 分发借用；拖放里拒收区松手取消不开窗；store 加 `previewRailWidth`；测试视图 `test.sample-views.rail` 声明视图段（开关 `rail-bounds` 改范围）。单测与 dom 新增：实例层 2、侧轨组件 3（焦点交接做过变异）、store 侧轨意图 5（两处变异）、注册表 1、手势往返 1（变异）。工作台 600 条单测、dom 155 条、类型检查过；开发服务真实页面看了右轨与右栏相连、消息入口按下（消息视图片 7 才声明视图段，页面上没有展开按钮）。外壳层面真实 `Teleport` 的借用与撤回交段 B 的 e2e。挪走的：揭示通道到片 7（使用者是消息视图），两端轨宽不同时切换容器改走整次过渡到片 8。
- 已派（后台）：测试第 B 段（Sonnet 编码子代理，说明 `/tmp/review-t19-e2e/segment-b.md`），片 5 前端实现审查（Sonnet，`/tmp/review-t19-impl-5/brief.md`）。段 B 跑 e2e 期间主会话不构建、不跑 e2e。
- 下一步：片 6（浮动）。
- 写底层提案（右栏入口条竖排成侧轨、视图段、展开、位置限制、浮动），要点先给开发者看，再交 omp `@review` 审一轮（开发者要求改底层要 gpt 审）；之后写 Spec（planned）与 `plan.md`，在 Work worktree 实现。左右整列对调另开 Task。
- 顾问报告 [`evidences/advisor-omp-gemini.txt`](evidences/advisor-omp-gemini.txt)（omp gemini-4-neon-xhigh）、拉远看 [`evidences/zoom-out-review.txt`](evidences/zoom-out-review.txt)（Sonnet），说明 [`evidences/advisor-object.md`](evidences/advisor-object.md)。两份一致的：轨的条目用声明式数据由工作台画、不用 Teleport 送 DOM；不在布局树里加条节点（w00026 t27 `strip-1` 丙“右栏右边一条活动栏”当时就因六处冲突没选，开发者选了卡片顶上一行）；窄版完整列表用搜索优先的切换浮层，管理放到宽处。拉远看另建议左右对调另立提案、先出“头像列留在视图里不画线”的对照。已归纳给开发者；开发者 2026-11-25 同意按归纳的方向出稿。
- 评审板第 3 轮（取代第 2 轮两题）：`rail-kind` 甲 工作台的侧轨（推荐）对 乙 头像列留在视图里贴右边、无竖线、底色深一档；`list-switcher` A 锚在按钮旁的浮层（推荐）对 B 顶部居中的 QuickPick；附左右对调整窗稿（对调另开 Task）。稿面修了：接缝按相连画、聊天区铺满、当前会话改描边只突出一层、底部图标换成机器人与搜索列表。原图在本地 `shots/r3/`。
- 第 2 轮答复后：侧轨涉及工作台骨架（ADR 0044、`ui/workbench-layout.md` 输出 1、22、47），先写提案；窄版列表交互出稿比较；消息样式随后一轮。
- 协调（2026-11-26，w00026 的会话留）：[w00026 t60 浮动窗的几何接口](../../../w00026-layout-package/tasks/t60-float-geometry/README.md) 会先改 `nb-layout` 的 `grid-rects.ts`（`clampFloatRect` 的 `area` 可带原点、`resizeFloatRect` 的 `bounds.area`）、`FloatWindowHandles`（`area` 属性、`commit` 的第二个参数 `direction`：这次动的边）、`NestedGrid`（手柄层不随抬升搬节点、`float-raise` 事件、expose `leafRect`、`GridFloatInput.animate`：落实 nested-grid 输出 105 的 planned 指引）与 `grid-motion.ts`（松手的起点）。本 Task 第 6 片的“窗的手柄只结算动的边”“程序宽度过渡”请变基后直接用 `direction` 与 `animate`，不另做一套；有冲突或形状不合用，在 t60 的 README 里留话。
