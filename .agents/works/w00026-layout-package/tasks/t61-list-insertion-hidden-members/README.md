---
schema: nbook.task/v2
taskId: t61-list-insertion-hidden-members
status: done
updated: 2026-11-26
---

# 列表插入位认滚出去的成员；README 写 TS 6 的 types（摩擦 3、8）

## 目标与范围

resolveListInsertion 过了最后一个看得见的成员、后面还有滚出去的成员时插到第一个滚出去的前面；标签编组示例的标签条能滚动；README 安装一节写 types: [] 在 TS 6 下的报错

合同：列表插入位的规则在包文档 [DropFeedbackOverlay](../../../../../packages/nb-layout/src/vue/DropFeedbackOverlay.md)（没有 Spec 条目）；t50 摩擦第 3、8 条。计划见 [plan.md](plan.md)。

## 结果

2026-11-26 完成，两片由 coder 子代理实施，主会话审 diff、补了一条工作台的守护用例、变基后复跑并合入 master：

- 库：`resolveListInsertion` 越过最后一个看得见的成员时，紧跟它的有效成员整个落在内容盒沿主轴终点之外（滚出去了）就交回它的 id，线照旧贴最后一个看得见的后缘；紧跟的只在交叉轴上被裁掉（换行）、在前端之外、或后面只有无效矩形时照旧 `null`。只看紧跟的那一个，不往后找：跳过换行的成员去认更后面滚出去的，放下的位置又和线对不上（用例守着）。
- 文档：`DropFeedbackOverlay.md` 改规则；README 安装一节写 TS 6 下 `types: []` 导入 `style.css` 报 TS2882；CHANGELOG `[Unreleased]` 两条（变基时被并进刚定稿的 `[0.3.0]`，挪回来了）。
- 标签编组示例：标签条放不下时横向滚动（`overflow-x: auto`，标签按名字宽、不再一起变窄截断）；示例 README 改成现状。
- 工作台：库的新规则只看一行里的顺序，工作台的行尾要在分区里按完整顺序找后继（固定区的最后一个之后是固定区末尾，不是普通区的第一个），所以 `tab-strip-geometry.ts` 只把没滚过行尾的标签交给库，行为不变。coder 的探针证明不过滤会把 `{before: null, after: "p2", partition: "pinned"}` 变成 `{before: "n1", partition: "normal"}`；主会话补了守护用例（`tab-strip-geometry.dom.test.ts`“普通区的标签滚出了行尾”），去掉过滤它失败。
- 变异检查：关掉新规则，单元用例与 `tabbed-panels.e2e.ts:116` 都失败（`insert:group-1:end`）；改成越过换行成员往后找，第 2 条单元用例失败；去掉工作台的过滤，守护用例失败。
- 验证：coder 跑了 nb-layout 测试（bun 711、vitest 369）、typecheck、`api:check`，nb-workbench-layout 测试与 typecheck，应用 typecheck；e2e：nb-layout 三个示例 49 条，工作台标签条 7 条（`editor-area` 524、890、929、1190、2359，`lab-tab-strip:100`，`workbench-live-drag:580`）。主会话变基后复跑 nb-layout 测试、typecheck、`api:check` 与 nb-workbench-layout 测试、typecheck，都过；master 在这期间只改了 CHANGELOG，e2e 结果沿用。
- 计划外发现：拖动会话的边缘自动滚动只滚 `scrollTop`，横向的标签条拖到两端不会自己滚，要先滚过去再拖（写进了标签编组示例的 README），留作下一个候选。
- 没验证：有头浏览器里细滚动条占掉多少标签高度。
