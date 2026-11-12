---
schema: nbook.task/v2
taskId: t25-container-feedback
status: active
updated: 2026-11-12
---

# 视图容器试用反馈：拖动与显隐的三个问题、四处动画

## 目标与范围

开发者 2026-11-12 在开发服务上试用 t24（视图容器第一步）后的反馈：侧栏容器里拖走一节再移回原处不让位；松手后马上再拖拖不起来；动画时内容先于外框出来；右栏拖空后打不开；四处动画（设置窗口的关闭、侧栏展开、视图浮动、标签与容器切换），一个一个来。

不做：右栏、底部面板的入口条（视图容器第二步）。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 11、22、38、43 与验收 8，[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的内容层；空区域要另写 ADR 部分取代 [ADR 0046](../../../../../docs/adr/0046-workbench-view-containers.md) 决策 1。

## 当前状态

在 worktree `.worktree/w00026-t25-container-feedback`（分支 `fix/w00026-t25-container-feedback`，从 master `b5f894ed8` 开）实施，计划 [`plan.md`](plan.md) 开发者 2026-11-12 确认（“可以，开始吧”）。

- 第 1 片（`69e1dbfad`）与第 2 片（`4c9cacfe8`）已提交：
  - 实时布局里来源收起后回到原处（判为原位）就展开回原位，判定换回拿起时的几何（Spec `ui/workbench-layout` 输出 38，条目级 planned）。单元测试 `live-drag.test.ts`；e2e `workbench-live-drag`“同一个容器里拖走前一节再回到原处……松手后马上再按，照常拿起”，去掉展开时失败。
  - 停放过的内容随刚长出来的叶一起长：切回容器、侧栏显示时内容不再先于外框整块出现。根因是内容是早就挂着的元素，起点样式带着过渡标记写上去，浏览器开始一段到起点的过渡，紧接着写终点就地反向取消；现在起点那一帧不带标记。Spec `ui/nested-grid` 的“内容层”写明停放过的内容同样。单元测试 `grid-motion.test.ts`；e2e `workbench-containers`“切回容器、侧栏从隐藏到显示……每一帧都不超出外框”，两处改动各自去掉时都失败。
  - 计划里的“过渡中按下先走到终点”第 1 片做了、第 2 片撤回，理由见 [`plan.md`](plan.md)。
  - 验证：工作台与 Lab 570 项、nb-layout 531 + 190 项、两份类型检查通过；e2e `workbench-containers`、`workbench-views`、`workbench-shell`、`workbench-live-drag`、`workbench-float`、`workbench-dnd`、`lab-workbench-surface` 149 条在撤回前 148 过（失败的就是被撤回那项弄坏的 `float:295`），撤回后重跑 `workbench-live-drag`、`workbench-float` 与新用例 38 条全过。
  - 复现时注意：e2e 默认减少动效，拖动一律是落点指示；量实时布局与过渡要先 `emulateMedia({reducedMotion: "no-preference"})`。

- 第 3 片（空区域能打开）已提交（`e279fc48b`），[ADR 0050](../../../../../docs/adr/0050-workbench-empty-region-anchor.md)。
  - 设计审查（Opus，[`evidences/design-review-s3.txt`](evidences/design-review-s3.txt)）：阻断 1、重要 4、建议 4，九条都成立，按建议修订计划与 ADR 后实施。最要紧的两条：放进空区域的预览里新分节看不见（库只写归属、不补当前容器）；“拖空就隐藏”放在工作台要每条预览路径各接一次（改为布局库的不变量，第 3 条随之消失）。第 9 条（容器唯一的视图拖进空区域时搬整个容器）照推荐做，记进待确认清单。
  - 实现：nb-layout 的锚只在区域没有分节时显示；结构操作收尾时区域被拖空就隐藏锚；`settleLanding` 在区域没有当前容器时把落进来的容器设为当前；投影里锚这片叶也登记成区域节点；空区域单独一条落点规则（`LayoutDropInput.newContainer`、`edge` 带 `container`、分区 id `whole`）。工作台：归整不再隐藏、`setPartHidden` 去掉零写入、`regionOccupied` 与收走顺序认空面板、拖动给 `newContainer`、外壳与 Lab 的空面板占位“把视图拖到这里”。
  - 验证：nb-layout 537 + 188 项、工作台与 Lab 570 项、类型检查通过；模型三处、投影、落点规则、`regionOccupied` 各做了变异检查，去掉时对应测试失败。e2e 8 个文件 202 条，200 过；`editor-area:1265`、`workbench-float:295` 单独各跑两次都过（后者在 t24 的整轮里也偶发过）。新用例 `workbench-shell`“右栏拖空后还能打开……”。
- 动画 1（设置窗口的关闭）已提交（`d20aa3e0b`）。
  - 根因：浮动窗口一关闭，定位组合函数就把“已定位”清掉，面板整段退场动画都是 `visibility: hidden`，所以窗口一下子没了。退场的关键帧本来在播（260ms，收回齿轮），只是看不见；之前的探针和 `settings.e2e` 只量不透明度与矩形，没量可见性，所以 11-06 调过曲线也没发现。这个行为从 10-12 浮动窗口有定位起就在。改为面板卸掉才算没定位；退场中的面不接指针（原来藏着时点击会穿过去，现在保持这一点）。
  - 顺带修了第一次打开的起点：起点在“已定位”变真的同一轮刷新里量，窗口的居中位置还没写进页面，量到的是左上角的初始位置，页面载入后第一次打开与收回都偏出两三百像素；改为等这一轮渲染之后再量。
  - 曲线与时长没动（11-06 定的先慢后快、260ms）：拍了三种退场的逐帧对照（现状、主曲线加不透明度保持、先慢后快加不透明度保持），现状在看得见以后就是一路缩回齿轮，另两种一个太快一个太晚。
  - 测试：`settings.e2e` 的齿轮用例加两条断言（第一次打开的起点在 85% 处、退场一半时可见），两处改动各自撤回时都失败。nb-ui 600 项、类型检查通过；e2e `settings`、`theme-editor`、`workbench-titlebar`、`lab-nb-ui` 57 条全过。
  - 没有来处时（快捷键、命令面板）关闭仍是原地 90ms 的淡出；设置窗口刷新后不会恢复成开着，这条只在快捷键、命令面板打开时出现，没改。

- 动画 2（侧栏从隐藏到展开）已提交（`c5975dbd3`，Spec `ui/nested-grid` 的“过渡”`c6ee3a57d`）。
  - 现状：侧栏两节一开始就是全宽，各自从高 0 竖着长，压在还没让开的编辑区上；只有一节时也从错的一边长（第一块以外的终点不动，可让位的是后面的编辑区）。根因是新叶各自按自己的父分支长。
  - 改为整棵新开出来的子树（上一帧没有、下面没有旧叶、不是顶替同一位置上的别的节点）作为一块，沿它在父分支里的主轴从上一帧两个兄弟之间的缝长出来，里面的叶、分隔线、内容另一个方向一开始就是终点；没有缝时从不动的那条边。拆分（包住旧叶的新分支）与切换容器（列还在，或一节换成一列）照旧各自长。`placeGrid` 给每块叶记从根往下的路径。
  - 测试：`grid-motion.test.ts` 四条（整列出现、列上一帧就在、一节换成一列、拆分包住旧叶），去掉三个条件各自失败；e2e `workbench-containers` 的侧栏显示改量横向：每一帧全高、左边贴活动栏、内容四边不出外框。nb-layout 541 项与类型检查通过；e2e `workbench-containers`、`lab-grid-structure`、`editor-area`、`workbench-shell`、`workbench-live-drag`、`workbench-views` 全过，只有 `editor-area:1265` 在整轮里失败、单独跑通过（第 3 片的整轮里也是它）。
  - 隐藏侧栏仍是原样：侧栏立即消失，编辑区再往左长过来（Spec“离开的叶立即消失”）；要对称的收起动画得让离开的叶在过渡里留着，是另一块机制，等开发者定。

## 下一步

开发者在开发服务（端口 4317）上看动画 2，并定隐藏时要不要对称的收起；确认后做动画 3（视图变成浮动窗），动画逐个做、逐个给开发者看。
