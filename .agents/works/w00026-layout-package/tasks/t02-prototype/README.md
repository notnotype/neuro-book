---
schema: nbook.task/v2
taskId: t02-prototype
status: active
updated: 2026-11-05
---

# 一次性原型：扁平渲染与一棵树的手感

## 目标与范围

交开发者亲手试：扁平渲染的一棵树、VS Code 与 Trellis 两种拖动手感、一个应用内浮动窗、一个手机呈现。回答三个问题：手感够不够，Tab 与读屏顺序怎么办，重内容（真实编辑器）的帧率与起拖时的停顿。手感不够或 Tab 顺序解决不了就回到开发者重新讨论。代码不合入。依据 [t01](../t01-requirements/README.md) 的决定 1、2、3。

合同：原型不改产品行为。结论进 t03 的提案与 Spec。

## 执行位置

草稿 worktree `.worktree/w00026-t02-prototype-drafts`，分支 `chore/w00026-t02-prototype-drafts`，不合并、不推送。代码在 `packages/neuro-book/src/plugins/drafts/web/components/layout-tree/`，场景在 `lab/web/fixtures/drafts/LayoutTreeDraftFixture.vue`。测量脚本在主工作区 `.local/agent/works/w00026-layout-package/tasks/t02-prototype/scripts/`（不入库），要在这个 worktree 的 `packages/neuro-book` 下运行。

## 怎么试

在 worktree 里 `nbdev dev start`，打开 `/lab?c=LayoutTreeDraft&s=default`，占满整个窗口。窗口窄于 600 时变成手机呈现；也可以用 `&s=phone&vp=phone`。切换手感在标题栏，其余选项在标题栏的“设置”里。状态栏显示落点、上一场拖动的帧率和内容加载耗时；每个视图右下角写着实例被创建了几次，搬动后应该一直是 1。

## 原型做了什么

- **模型**：一棵树（分支与带标签的面板）加浮动列表，编辑区是树里标了 `stage` 的子树；标题栏和状态栏在树外。尺寸只按权重分，没有拖到零和快照。
- **渲染**：面板外框、分隔线、视图内容都是同一个父元素下的绝对定位元素，用 transform 加宽高摆放。视图内容按视图 id 建一次，不换父元素。每个标签自己一个内容实例（Trellis 的做法），不是现在的每个编辑组一个控件。
- **判定**：拿起时算好“摘掉来源之后”的树和几何，整场拖动都按这份固定几何判定，预览只影响显示；否则让位会把落点从指针下挪走，来回抖。

## 实测

原始结果见 [`evidences/measurements.txt`](evidences/measurements.txt)。

- **结构可行**：主流程 22 项全过。跨面板搬动后滚动、输入、光标和一直在跑的动画都还在，没有实例被重建。
- **Tab 顺序有解**：`reading-flow` 加 `reading-order` 让 Tab 跟视觉顺序走，不搬节点。读屏顺序要另加 `aria-owns`。只在 Chrome 上试过。
- **每标签一实例可以接受**：普通章节的 JS 堆增量在噪声内，第二个 Monaco 约 6MB（DOM 占用没有计入）。起拖时新建 TipTap 最长帧 33 到 50ms；Monaco 第一次要等库加载，这期间卡片是空的。
- **帧率说不准**：无头软件渲染，同条件各轮差到 35 到 59 帧，负载影响大于条件本身。过渡时内容只排一次版对 TipTap 有小幅改善，对 Monaco 看不出差别。真实手感只能靠开发者在真窗口里试。
- **`moveBefore` 不能代替不换父元素**：焦点在，滚动还是丢。

## 未验证

- 真窗口和 GPU 下的手感与帧率；CPU 降速（脚本超时，没有结果）。
- 触摸、软键盘（手机呈现没有拖动）。
- Firefox、Safari 上的 `reading-flow`。
- 树内移动文件、窗口外开独立窗口都没做：窗口外松手落成应用内浮动。

## 当前状态

原型可以试，等开发者试手感。

## 下一步

开发者试过后，把结论写在这里，手感够就开 t03，不够就回到开发者重新讨论。结束时把原型提交到草稿分支留作原始材料，不合入，开发服务停掉。
