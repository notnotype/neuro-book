# 任务：只读调研 —— 工作台底层能不能支持“侧轨”这套新机制

仓库：`/home/notnotype/CodeRepository/neuro-book`（主工作区 master，只读）。背景先读 `/tmp/review-t19-rail/object.md`、顾问报告 `/tmp/review-t19-rail/omp-advisor.txt` 与 `/tmp/review-t19-rail/omp-advisor-2.txt`、拉远看 `/tmp/review-t19-rail/zoom-out.txt`；开发者的决定在 `.agents/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/README.md` 的“开发者的决定”。稿在 `/tmp/review-t19-rail/`（`jia.png` 收着的轨，`expand.png` 展开的轨 —— 若没有就看 `.agents/works/w00043-neurobot/tasks/t19-messages-view-ui-polish/artifacts/review/r5/`）。稿都是在真实页面上用样式摆的，不是实现。

## 开发者要的机制（2026-11-25 定）

1. **侧轨**：每个侧区域（左侧栏 `sidebar`、右栏 `auxiliarybar`）在窗口外缘有一条轨。上段是这个区域的容器入口；中段是当前视图交出的声明式条目（图标或头像、名字、未读、选中、命令；工作台画，不传 DOM）；底段是视图的固定条目，主侧那条再加全局项（账号、设置）。左边现在的活动栏就是左侧栏的轨。右栏现在横着的入口条（输出 47）搬进轨。
2. **轨能展开**：收着 48 像素只有图标；展开约 200 像素，每项后面跟名字。展开时这一列（轨加区域）变宽，挤编辑区，区域里的内容宽度不变；收起回原样。要通用：左边活动栏也要能展开（这次可以不开放，但底层要支持）。展开开着还是收着要不要记住、记在哪，你给建议。
3. **左右整列对调**：设置一个“主侧在左还是右”，两边整列交换，轨总在外缘；活动栏不挪出布局树；另开 Task 做，但这次的设计不能挡住它。
4. **浮动时和轨一起浮动**：消息视图浮成窗口时，它的轨条目跟着走，浮动窗右边缘有一条轨（也能收、能展开）；窗里多个标签时怎样，你给建议。
5. 开发者在考虑：展开后的轨若好看，可能不再单独做“对话目录”视图（完整列表），展开的轨就承担浏览与查找。请评估展开的轨要不要、能不能带搜索与筛选，以及这对机制的影响。

## 请查清并回答

对每一条：现有底层里已经有什么能直接用（文件:行）、缺什么、最小的改法（给两种以内的候选，各写代价与风险），以及它会碰到哪些现有合同（Spec 条目编号、ADR）。要读的地方至少包括：

- 布局树与骨架：`packages/neuro-book/src/plugins/workbench/web/state/default-tree.ts`（`fitsSkeleton`）、`layout-doc-validate.ts`、`layout-doc-store.ts`、`layout-constraints.ts`（条的厚度、尺寸求解）；`docs/specs/ui/workbench-layout.md` 输出 1、4–8、19–22、38–47；ADR 0044、0046。
- 呈现层：`packages/nb-workbench-layout/src/layout-project.ts`（`projectLayoutDoc`）与 nb-layout 的网格；条节点、`hiddenBars`。
- 卡片相连、圆角、接缝：`WorkbenchSurface.vue`（按 `ACTIVITY_BAR` 写的那些）、`shell/adjacency.ts`。
- 入口条：`WorkbenchToolStrip.vue`、`WorkbenchRegionStrip.vue`、`entry-drop.ts`、`layout-drag.ts`。
- 浮动窗：`doc.floats`、浮动窗的外框与自绘头（`WorkbenchShell.vue` 的 `ownHeadBands`、`docs/specs/workbench/views.md` 输出 19 的“自绘头”、`ui/workbench-layout.md` 输出 39）。
- 视图接口：`packages/neuro-book/src/plugins/workbench/shared/contracts.ts`（`ViewHead`、`VIEW_OWN_HEAD`）。
- 历史：`docs/proposals/workbench-view-containers.md` 第 3 节（右栏入口条作条节点的六处冲突）、`.agents/works/w00026-layout-package/tasks/t27-region-entry-strips/README.md`。

最后给一段**总体结论**：这套机制放在哪一层最合适（布局树、呈现层、外壳组件），要不要新的持久化字段，哪几处是这次必须改的底层、哪几处可以留到对调或左轨展开时再改；列出会让设计失败的风险（例如尺寸求解与展开宽度的关系、拖到零与隐藏、最大化、拖放落点、F6 与读屏顺序、布局记录兼容）。

## 规则

- 只读：不修改仓库文件，不 commit、push、stash、切换分支。可以跑类型检查与单元测试，不跑 e2e 与开发服务。
- 报告写到 `/tmp/review-t19-rail/foundation.txt`（绝对路径）：每查完一条就用一次 `cat >> /tmp/review-t19-rail/foundation.txt <<'EOF' … EOF` 追加，每次 1500 字以内。
- 结论只写到证据覆盖的范围：没读到的写“没读到”，推断的标“推断”。用中文。
