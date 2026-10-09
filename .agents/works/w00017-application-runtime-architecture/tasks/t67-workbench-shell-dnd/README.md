---
schema: nbook.task/v2
taskId: t67-workbench-shell-dnd
---

# NeuroBook v2 外壳三：拖放

## 目标与范围

按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节的外壳三：视图与容器两类拖动源、Switcher 插入位、容器内容的边缘并入与空 Part 整区三类落点；自建容器 `custom:<UUID>`、整组并入、半区按来源比例分配；键盘拖放；拖影与落点反馈；“移动到”菜单补上新建容器。之后是第 6 步 Files。

实施计划：[plan.md](plan.md)。

行为合同（本 Task 修订）：[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳三。

## 前置

外壳二 [t66](../t66-workbench-shell-views/README.md)。

## 当前状态

- 2026-10-08 计划起草，按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md) 交三个 omp 审查（对照 Spec 与旧应用、意图与多窗口不变量、可实现性与测试）；14 条意见按推荐并入计划（见计划“审查处理”），拖放的保存冲突政策记入[待确认清单](../../pending-confirmations.md)。下一步 S0。
- S0（Spec）：输出 24 的“新建容器（在 X）”、自建容器记录项的形状、半区写在意图单位、保存边界的冲突政策、`commands.md` 的 `newContainerIn`。
- S1（模型）：自建容器 `custom:<UUID>`、按字段的补丁与唯一的应用边界（`views/patch.ts`：目标重建、涉及容器收口、半区并入前提）、四种意图与半区、剩余区；`dnd-model.test.ts` 14 例与真实 Storage 的两窗口冲突两例，变异检查。
- S2（判定）：`views/drop.ts` 纯函数，行为表逐行 11 例，变异检查 21 处全部杀死。
- S3：`move-view` 的 `newContainerIn` 与菜单、无参选择的“新建容器（在 X）”；nb-ui `Tabs` 的逐项 `attrs`；右栏标签带与面板导航区常驻、空正文填满（“将视图拖动到此处显示”）。e2e 暴露 t66 一条用例在取消第二步前没等它打开，已改为等可观察状态。
- S4（会话）：改判为自写拖放会话，不引入 `@dnd-kit`（理由见计划 Context，记入待确认清单）。组件只写 DOM 标记，`views/drop-dom.ts` 读可见几何与命中，`views/drag-session.ts` 处理指针（6px、触摸 200ms）与键盘键表、只提交显示过的动作、吞掉拖动末尾的点击；`WorkbenchDragFeedback` 画拖影与落点。实现中修正：按下的 `:active` 缩放让源变小（拖动中撤掉；`scale` 与 `transform` 同写会被 CSS 压缩并掉）、键盘放下先还焦点后提交导致焦点落空、Tab 区域按文档顺序面板排在右栏前（改按 Part 顺序）。没有用上的 `Tabs` 的 `tabRef` 与 `keyboardDisabled` 撤掉。
- S5（e2e）：`e2e/workbench-dnd.e2e.ts` 13 例，连跑三次 39 例全过；对会话做两处变异（不吞点击、按键不拦截）均被抓到；全量 e2e 93 例通过。截图 `evidences/shots/`：产品页拖动中的插入线与半区（1440×900）。Lab 舞台截图拍不到传送到 body 的覆盖层，没有作证据。
- 实现审查（2026-10-09，范围 `b6322cd5..7d74a100`）：三个 omp 分别审正确性与不变量、测试与验收映射、代码质量与 Spec 一致，报告存 `evidences/impl-review-{correctness,tests,quality}.txt`。去重后 9 条产品缺陷、5 条测试缺口，全部修正：
  - 模型：被动挪位的容器重排改为“只改顺序”（保存时它已迁区就不动，与视图的 `reorder` 同理）；整组半区并入只把展开的成员计入比例与尺寸，收起成员的展开记忆不变，全部收起时只并入不拆；含不可移动成员的整组在判定时就拒绝，不再显示可接收的半区；布局代次加入选中项、可见成员与轴，活动内容或成员变化取消拖动。
  - store：修改作用在已有记录上没有变化时不写，以新结果 `unchanged` 结算、显示改为已确认值上的投影（`state/store.md` 输出 10、11；记入待确认清单）。修正前，保存时前提不成立的半区并入仍写一次、推进 revision，屏幕上的并入也留着。
  - 会话：指针拖动同样独占拖放键（标签带收不到）；焦点移到外壳之外（命令面板）取消拖动且不抢回焦点；结束时释放指针捕获，只吞指针点击（键盘触发的 `detail` 为 0 不吞）；键盘拿起停在源自己的原位（视图找自己的分节、容器找自己的条目），直接 Enter 不移动；工具区 `data-no-drag` 也不接收投递，面板标签带里的“移动到”包进工具区。
  - 测试：e2e 的写入计数改为测试库上的审计触发器（只数本页客户端的布局记录，不依赖修订号连续）；新增 8 例：多视图容器面板→侧栏→面板往返、真实拖动边界调成约 3:1 后按实测比例并入、工具区不接收、指针拖动的键与捕获、命令面板取消、原位 Enter、同一帧换落点不提交（页面内同步派发移动与松手，Playwright 鼠标做不出确定的同一帧）、“移动到”新建容器并刷新。模型与 store 补 7 例。
  - 变异检查：模型 9 处、store 3 处、会话与命中 7 处（每处重建 e2e 外壳），全部被抓到。两处起初没抓到，查明是测试本身的问题（`toHaveProperty` 把 `t.e` 当路径；指针拖动时漏出的键在 Playwright 里没让标签带切换），已改为直接断言。
  - 解释性决定记入待确认清单：multiple 里视图的标题行按窗格接收、“禁投方向”解释为不形成拆分方向、全部收起的整组只并入。
- 收口验证（2026-10-09）：`test:affected --typecheck` 全部通过；`docs:check`、`governance:check` 无失败（`test.setTimeout` 被固定等待规则误报，按规则写了行内例外与理由）；`smoke:server` 通过；拖放 e2e 21 例连跑三次通过（其中 3:1 一例改为按实测比例核对后单独连跑五次）。全量 e2e 101 例：98 过、3 失败，处理如下：
  - `workbench-shell.e2e.ts` 的主题 token 一例是本轮回归：面板导航槽里常驻的空工具区包装挡掉了“没有容器时回落显示标题”，条件挪到包装上后通过，三个外壳 e2e 文件重跑 48 过。
  - `dev.e2e.ts` 刷新后页面起不来，页面报 `net::ERR_INSUFFICIENT_RESOURCES`（开发模式未打包的模块逐个加载）；在 `7d74a100` 的独立 worktree 上同样失败，不是本轮引入，未修。
  - 拖放 e2e 的十二条空落点路径一例在全量里失败一次，单独连跑两次通过；`workbench-shell.e2e.ts` 的 Lab 往返一例在三个文件连跑时等编辑器样例超时（开发服务冷启动编译），单独连跑两次通过，代码路径本轮没动。
