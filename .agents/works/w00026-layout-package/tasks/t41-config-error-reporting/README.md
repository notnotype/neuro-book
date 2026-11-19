---
schema: nbook.task/v2
taskId: t41-config-error-reporting
status: active
updated: 2026-11-19
---

# 拖不动时报错：开发模式的配置错误各报一次

## 目标与范围

按提案“错误与诊断”与第一档第 5 项（从 t39 拆出）：sashSize 为 0、没接 onGestureCommit、contextKey 两处对不上、revision 没转交给 NestedGrid，开发模式下各报一次，判据用库内开关

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 新输出 151（开发模式的配置检查），公开入口加 `setLayoutDevChecks`；被拒的提交与 `issues` 事件不变。

## 当前状态

计划第 2 稿（[`plan.md`](plan.md)），不再送审，实现审查兜底。Spec 已写（planned，`a89a7a3f5`、`af2fc9b85`）。实施：worktree `w00026-t41-dev-checks`（分支 `w00026/t41-dev-checks`）。

## 设计审查

第 1 稿（Claude Sonnet，[`evidences/design-review.txt`](evidences/design-review.txt)，实验用真实 `NestedGrid` 加 `useGridHost`）：11 条，阻断 0、重要 6、建议 5，都成立，改成第 2 稿：

| 条 | 内容 | 处理 |
|---|---|---|
| 1 | 在提交处判“版本相同而上下文不同”会误报：手势期间换上下文或重发，`NestedGrid` 自己取消手势，唯一到得了提交的是刷新之前同步松手的合法拒绝 | 上下文与版本挪到手势开始处核对（`useGridHost` 的 `bindings` 加 `onGestureStart`），提交处不另检查 |
| 2 | 版本判据漏掉 1 到此刻之间的写死或过期的值 | 同上，按下时比是否相等 |
| 3 | 检查点放在内部的 `useGridLayout`，不经 `useGridHost` 的宿主覆盖不到 | `sashSize` 挪进 `NestedGrid`；上下文与版本只服务整包绑定的宿主，Context 写明 |
| 4 | `sashSize` 为 0 把只读网格也报 | 判据加“接了提交处理、没停用” |
| 5 | “不误报”只有合成场景 | 加一条正确接线、做各种操作、零警告的 dom 用例；开发服务里手动看一次控制台 |
| 6 | 整页每种一次会吞掉别的网格的同类错误、消息认不出是哪个 | 按组件或宿主实例各报一次（`WeakMap`），消息带 `contextKey` |
| 7 | 两个入口各带一份模块时开关失效 | 状态放在全局符号上 |
| 8 | 处理函数返回 `undefined` 也是 `handler-missing`，警告会说错 | 两种情形两条消息 |
| 9 | `Splitter.vue` 已有不带开关的 `console.warn` | 不合并，写明理由（独立 Splitter 由 t14 迁移） |
| 10 | 默认关与“凭记忆”的理由被写成事实 | 改成“提案标着凭记忆”；另一种做法写进“不做与风险” |
| 11 | 应用里放在 `main.ts` 会多一个静态依赖 | 放进只在开发模式加载的 `development-plugins.ts` |

另：第 1 条顺带发现 t40 写的 Spec 输出 149 与实现不符：版本递增时，进行中的手势是取消，不是提交时被拒。已在 t40 晋升时删掉那一句。

## 实施记录

| 片 | 提交 | 内容 |
|---|---|---|
| 1 | `9c9948644` | `dev-checks.ts`（开关、按实例各报一次）；`NestedGrid` 查全零分隔条与提交处理；`useGridHost` 在手势开始时查上下文与版本；`grid.md`、`NestedGrid.md` |
| 1 补 | `809054f83` | 全零分隔条只看两侧都能调的边界 |
| 2 | `590691d1d` | 应用在只于开发模式加载的 `development-plugins.ts` 里打开 |

实施中的调整（写进 Spec 输出 151）：

- 原判据是“所有分隔条都是 0”。工作台在窄窗口里会把区域从呈现里收走，只剩编辑区与条，条两侧的缝本来就是 0，会误报。
- 改成只看两侧都能调的边界：挨着固定尺寸节点的缝 0 宽，本来就拖不动、也无害。

验证：

- nb-layout 374 与 254 条、类型检查与应用类型检查通过；`architecture` 只有那条原有失败。
- 新用例 7 条，八个变异都会红：
  - 去掉“停用”“没接提交处理”“至少一条边界”“两侧都能调”各一项判据；
  - 去掉上下文、版本的核对；
  - 按组件记改成整页记；
  - 两种提交处理消息不分。
- 开发服务里的真实浏览器，用临时探针（不提交）走了八处：Lab 的四个网格场景、`WorkbenchSurface` 宽窄两种、产品工作台宽窄两种。
  - 每处拖一次分隔条，`[nb-layout` 警告零条；
  - 核对过页面上开关确实是开着的。
- 把 master 并进分支（合并提交 `a3f22d7b2`），`test:affected` 在跑。

## 下一步

1. 收口验证；实现审查（Claude Sonnet，不阻塞）；合入；晋升。
