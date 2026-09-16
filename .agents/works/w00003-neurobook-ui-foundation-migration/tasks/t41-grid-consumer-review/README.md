---
schema: nbook.task/v2
taskId: t41-grid-consumer-review
role: reviewer
---

# 两轴grid及真实消费者独立复核

**本轮入口：** t37五项已实现（52原语+33消费者聚焦用例），Leader追加10000布局/3000手势探针全部通过，见本Task leader-numeric-verification.md。只核该五项及确定核心问题，结果写walkthroughs/review-final.md，不重做全套架构。t37当前只补WorkbenchBranch根像素尺寸及回归（全部子项触max时保留留白），所以先核其它稳定算法/快照/Shell/Spike，结束核Branch最终hash，变动未核部分直说。不跑全包门禁，不改源码，不建.tmp或递归删除，全部绝对cwd。不要复述旧缺陷；给可否提交的当前结论。

追加复核前先读 [Leader证据审计](walkthroughs/leader-evidence-audit.md)。所有命令必须用当前worktree绝对cwd；不得创建仓库.tmp或递归删除目录，只能归档自己确切创建的单文件。

**第二轮结果（2026-09-16 12:58）：** 五项与消费者接线已在最终 hash 上复核完毕，结论 `建议合并`。报告 [review-final](walkthroughs/review-final.md)；探针 `evidences/final-probe.test.ts`、`evidences/branch-container-probe.test.ts`、`evidences/t41-out-of-range-intent.ts`、输出 `evidences/probe-final-output.txt`。非阻断项：O1 编辑器叶隐藏时模型/树/呈现分叉（仅 `setLeafVisible("editor", …)` 公开 API 可达，当前 `index.vue` 不触发）、O3 越界意图下 `resize` 总量下调未在文档写明；浏览器与 Product 层证据按本 Task 排除项未做。

Work：[w00003](../../README.md)；实现：[t37](../t37-grid-geometry/README.md)。
合同：[ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)。HEAD `70c7168d`加当前未提交t37改动。

当前t37仍在完成消费者，先读真实产物并核对关键合同；报告保留首尾文件hash，变化部分标为待复核，不能对变动中的版本下最终通过。
只读被审源码，可写本Task报告与独立探针。不开代理、不联网、不提交，不访问或占用3001。
纯算法/DOM测试使用仓库Temp支持；本轮不启动产品服务、不做真实用户数据操作。不跑全包typecheck/build，避免并行争用。

## 核对范围

- nb-ui layout/grid*.ts（types、geometry、snapshot、树操作及测试）。
- 主应用WorkbenchBranch、WorkbenchShell、utils/workbench/layout、workbench-spike及测试。
- Splitter新gesture事件只作为边界输入核对，不替t39审Splitter内部，也不编辑t38文件。
- 用户dirty `descriptors{,.test}.ts` 完全排除。

## 关键问题

1. 两轴意图、显示、当前约束是否分开；视口变窄再恢复是否不改变快照；分支自身约束和后代约束冲突是否明确诊断且布局有限。
2. 原子移叶与失败不改树，重复/恶意id、非法/高版本/超深快照，未知引用过滤后的原件保护边界；公开泛型ref序列化是否稳定。
3. 单次sash调节是否恰好一次原子结算；呈现像素delta与意图比例是否在容器改变后仍等价。不要只在容器恰好等于意图总和时测。
4. 真正的renderer是否消费layout的尺寸、约束、实际sash占用；CSS隐藏sash后是否还计账。不可满足约束时Reka是否又把降级尺寸夹回min从而溢出。
5. 重点核对主页面左右sash：当前WorkbenchBranch选state.active中的第一个节点；editor~right会选editor，而Shell只更新left/right的store。检查是否造成右侧拖动回弹/不保存，不能只看纯layout测试。
6. 两个以上兄弟的补偿与真实Splitter几何是否一致；隐藏叶后比例、父级空间、恢复是否仍相符。手势中外部layout不应重挂抢本窗口拖动。
7. API/注释/测试/消费者一致、所有直接消费者可编译。可调用聚焦测试；测试失败报告原文和路径，不改实现。

## 产出

`walkthroughs/review.md`按严重度列可复现问题、影响和最小修复方向，区分合同缺陷/未验证/风格。
15分钟内留下首轮报告，不把等待t37完成当作无法取证；若关键文件首尾变化，在报告说明需作者收口后再复核。
探针优先纯内存；需要临时放入app或layout目录运行时先核对无同名文件，完成移回本Task evidences，不留生产目录scratch。
不能以exit0、空final或仅作者报告作为完成。
