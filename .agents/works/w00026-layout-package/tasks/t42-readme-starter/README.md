---
schema: nbook.task/v2
taskId: t42-readme-starter
status: done
updated: 2026-11-19
---

# nb-layout 的 README 起步与三份短文档

## 目标与范围

按提案第一档第 5 项（从 t39 拆出）：README 写成复制能跑的五件事例子、我要做 X 用哪个导出的表、目前只在源码里的约定；useGridLayout（或 useGridHost）、useLayoutExtent、createDragSession 各一份短 .md；排在 t39 到 t41 的形状定了之后

合同：行为合同未变，只改文档与一个 Lab 场景；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的实现合同加上 README 与新的短文档。

## 当前状态

2026-11-19 写计划第 1 稿（[`plan.md`](plan.md)）。只改文档：按“按任务大小降级”不做设计审查，实现审查（Claude Sonnet，按文档审）兜底。

## 实施记录

worktree `w00026-t42-readme`（分支 `w00026/t42-readme`）：

| 片 | 提交 | 内容 |
|---|---|---|
| 1 | `34df7c4e0` | README：定位、起步例子（与 Lab 的 `starter` 场景同一份，`readme.test.ts` 核对）、导出对照表、约定；`lab-grid-structure.e2e.ts` 加“起步例子” |
| 2 | `c6800919e` | `useGridHost.md`、`useLayoutExtent.md`、`drag-session.md`；`NestedGrid.md` 的“接入”改成链接，只留组件这一侧的几条 |
| 3 | `751b86669` | 包内文档不引输出编号：`NestedGrid.md`、`grid.md` 由 Claude Sonnet 做文案迁移（逐处清单 [`evidences/citations.txt`](evidences/citations.txt)），我审 diff；指向仓库别处的链接改成 GitHub 绝对地址；`readme.test.ts` 加一条扫描 |

验证：

- `readme.test.ts` 通过；把 README 例子改一个字会红。
- 应用类型检查通过（场景能编译）；“起步例子”e2e 通过（拖宽、拆分、收起与展开）。
- `docs:check` 没有本 Task 的失败。

约定逐条对照过源码：

- 恢复时解析函数返回 `{ref}` 或 `null`：`grid-types.ts` 的 `GridRefResolution`、`GridRefResolver`；
- 层数与节点数的上限：`grid.ts:211、214`；
- 焦点只停在叶里能聚焦的元素上：`vue/grid-focus.ts` 的 `focusablesIn`；
- 拖动会话跳过反馈元素：`vue/drag-session.ts:79` 的 `FEEDBACK_SELECTOR`。

收口：

- 并入 master（合并提交 `5ee713aa2`）。
- `readme.test.ts` 两条通过：扫描那条在文档里加回一个编号或相对链接会红。
- `docs:check` 没有本 Task 的失败。
- `test:affected` 只有那五条原有失败。

## 实现审查

Claude Sonnet（[`evidences/impl-review.txt`](evidences/impl-review.txt)，按文档审准确、可用、可读，带实验）：16 条，阻断 0、重要 3、建议 13，都成立，修正提交 `08ae058d1`：

- 重要：
  - 约定没说快照不存保留像素、最小尺寸、收起策略。恢复后左栏会悄悄变成按比例分、收不起来。改法：写明快照只存什么，给一段解析函数的例子。
  - 起步例子最外层 `height: 100%` 在普通项目里会塌成 0 高。改法：外层定高 480px，并写明另一种做法。
  - 恢复那条的 `createGrid(null)` 没给 `sashSize`。改法：补上，并说明 `encodeRef`。
- 建议：
  - 起步例子：收起按钮的状态从网格读，拖动收起之后也对；拆分之后也存快照；解释收起策略的四个数与 `contextKey`；定义“宿主”“承载盒”。
  - 新加“安装”一节：对等依赖、以源码发布、要能编译 TS 与 `.vue`。
  - 约定一节：
    - “两种坐标”改成两种矩形的形状，表里加 `placeGrid`；
    - 层数上限写准：只在拆分与插入时拒绝，写出 16 与 256；
    - `moveGridFocus` 写出签名、只有前后两个方向、有返回值，`NestedGrid.md` 里的参数名改成 `container`。
  - `NestedGrid.md`：
    - “留着缩回去”的条件补上“在分支一头”那一支；
    - 自己接组件的一节补回“空尺寸时空布局”“不要等尺寸再渲染”两条；
    - 删掉一处残留的“失败 6”。
  - `drag-session.md`：补 `commitsUnderPointer`、`onActiveChange`，写出 `keyboard` 的子项与 `scroll`、`autoScroll` 的取值。
  - 改掉几处只有仓库内的人才懂的说法：“验收台”、`vitest.setup.ts`、“实时布局”。
  - `readme.test.ts`：
    - 扫描认“输出、失败、验收”三种编号；
    - 链接扫描查根相对路径、跳出包目录（带分隔符）、目标文件不存在；
    - 新加一条核对导出对照表：表里每个名字都从那一行写的入口导出。它当场抓到一处 `invalidate()` 是宿主的方法、不是入口导出。三个变异都会红。
- 不改，记下：
  - 随包源码的注释里还有约 84 处“输出 N”，IDE 悬停时可见。本 Task 只管随包的 `.md`，测试里已写明；要清理另起一个 Task。
  - 链接扫描不看引用式链接与 HTML 的 `href`，包里没有这两种写法。
  - “约定”里恢复快照的那段示例没有测试编译或运行它（`readme.test.ts` 只钉住起步例子）。合入后按 advisor 复核改过一次（`9593a26e9`：解析函数按表给每个引用的策略，拆分出来的 `preview` 也认得），之后改它要自己核对。

## 合入

2026-11-19：并入 master（带进别的 Work 的 nb-agent-ui 改动，与本 Task 不相交）后快进合入 master `4afd9dcd4`，删掉 worktree `w00026-t42-readme`、`review-t42-impl` 与分支。Spec 不改：行为合同未变。

## 下一步

无。随包源码注释里的输出编号要清理的话另起 Task。
