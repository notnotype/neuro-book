---
schema: nbook.task/v2
taskId: t36-explicit-exports-and-helpers
status: active
updated: 2026-11-19
---

# 显式入口清单与导出名测试

## 目标与范围

按提案第一档第 4 项（“公开入口”）：两个入口改显式清单加导出名测试，求解器内部件不导出；`Splitter*` 手势类型改名 `GridGesture*`、`gesture-start` 的载荷起名并导出；子路径清单。第 5 项（`useDragSession`、`useGridHost`、收起与展开入口、拖不动时报错、起步材料）2026-11-19 拆到 [t39](../t39-layout-helpers-and-starter/README.md)：那一半是要先写 Spec 定形状的新 API，这一半是不改行为的整理，分开审、分开合。

合同：行为不变；公开面收窄到显式清单，改名两个手势类型、给 `NestedGrid` 两个事件的载荷起名。改 [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的实现合同与“边界与兼容”。

## 当前状态

2026-11-18 经 nbdev 新建。2026-11-19 开工，计划见 [`plan.md`](plan.md)（第 1 稿），盘点见 [`evidences/exports-inventory.txt`](evidences/exports-inventory.txt)：根入口 158 个导出里仓库经包名导入的 55 个，Vue 入口 41 个里 18 个；没人导入的 126 个里，写在文档里 33 个、出现在公开签名里 38 个、其余 55 个是内部件。

- 带进来的事：t33 实现审查第 7 条，nb-layout 的分界规则（导出名、数据属性、类型名里不出现工作台概念，见 `packages/nb-layout/AGENTS.md`）只写在文档里、没有机检。导出名测试随本 Task 做时，加一份禁用词表一起拦（活动栏、状态栏、区域、容器、编辑组、具名面板一类），数据属性的字面量也扫；t33 README 列了有意留下的几个名字（`entryRect`、`data-drop-feedback-entry`、`FloatWindowHandles`、`LayoutFloatResize`），定表时一并判断。

第 1 稿的设计审查（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)）：10 条，阻断 0、重要 3、建议 7，都成立，改成第 2 稿：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | SDK 的 `@deprecated` 别名照计划写，`pack.test.ts`、`sdk.test.ts` 按 `export {…}` 取名单，认不出 | 声明式别名；两处测试改成读语法树、弃用别名列表 |
| 2 | `./text` 子路径没清点，`useLayoutText` 没人用却公开 | `useLayoutText` 挪内部；测试覆盖 `package.json` 的全部入口 |
| 3 | “文档”判据按词边界，`not-finite` 让 `finite` 误判；脚本没存 | 脚本存进 `evidences/`；判据收紧；t35 合入后重跑 |
| 4 | 改名用 `Grid` 前缀，独立 Splitter 的载荷也带上 `Grid` | 改用 `Sash` 前缀（`sash-gesture.ts` 的约定），记决策记录 |
| 5 | `useSashGesture` 留下，但键与分隔线渲染都不公开，搭不出来 | 降为内部，Spec 实现合同里删掉 |
| 6 | 禁用词与规则的对应、成员名不扫、一行一个名字 | 都写进计划 |
| 7 | Spec 改动有两处落点不存在 | 删掉空条目，载荷类型名作为新内容写 |
| 8 | 留下的比提案的基线多 57 个，没记偏离 | 记为偏离：签名里的类型要写得出名字 |
| 9 | 验收只覆盖“有人用”的名字 | 测试加文档导入名检查 |
| 10 | 与 `sdk.test.ts` 重复读入口 | 抽到 test-support 的 `./module-exports` |

## 实施记录

worktree `w00026-t36-explicit-exports`（分支 `w00026/t36-explicit-exports`），基于 t35 合入后的 master `1e96e855c`：

| 片 | 提交 | 内容 |
|---|---|---|
| 1 改名 | `66244895e` | `SashGestureSource`、`SashGestureCancelReason` 挪进 `sash-gesture.ts`；`GridGestureStart`、`GridGestureCancellation`；Lab 夹具与 SDK 跟着改，SDK 留两个弃用别名，两处 SDK 测试认就地声明的别名 |
| 2 显式入口 | `adfea4b2f` | 四个入口一行一个名字（根 111、`./vue` 28、`./text` 4、`./locales` 3），`useSashGesture`、`useLayoutText` 等成内部；`exports.test.ts`；test-support 的 `./module-exports`，SDK 测试改用它 |
| 3 文档 | `d42059e6e` | `AGENTS.md` 写明公开面与禁用词；变更记录 |

验证：

- nb-layout 363 条 bun 与 231 条 dom 测试、nb-workbench-layout 261 与 48 条、test-support 28 条通过；四个包的类型检查通过；`docs:check` 通过。
- 应用 vitest 942 条通过；bun 3678 条过、10 条失败：`nbook.stickers` 清单 7 条、SDK 导出面 `ImagePreviewDialog` 1 条、eval 1 条是 master 上原有的；文件插件的“组里的写入与文件操作带同一个组”1 条单独重跑 3 次都过（时序偶发，与本 Task 无关）。
- `bun.lock` 的改动只是 test-support 的 `typescript` 挪到依赖、版本不变，没有按 `test:affected` 跑全部 28 个包，见计划“实施中的调整”。
- 变异：入口加 `export *`、删掉文档里导入的名字，`exports.test.ts` 都会红。
- 不改运行时行为，没跑 e2e。

## 下一步

1. 实现审查（前端，Claude Sonnet）在跑，报告在 `.local/agent/works/w00026-layout-package/tasks/t36-explicit-exports-and-helpers/reports/impl-review/`；处理完合入 master。
2. 合入后：`ui/nested-grid` 实现合同的公开入口删掉 `useSashGesture`，“公开面”一句换模型核对后晋升。
