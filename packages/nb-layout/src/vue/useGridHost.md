# useGridHost

把 `NestedGrid` 要的几样（树、布局、版本、上下文键、停用、提交处理、接尺寸与诊断的处理）打成一包，宿主写 `<NestedGrid v-bind="host.bindings.value">` 就能接手势。完整例子见包的 [README](../../README.md) 的“起步”。

```ts
const host = useGridHost({
    grid,                       // 网格实例：值、ref 或 getter；为 null 时布局为空、拒绝提交
    contextKey: "editor-area",  // 可省，缺省空串；换了上下文，旧手势的提交不落账
    disabled: () => locked.value, // 可省；宿主自己的停用条件
    onApplied: (commit, result, before) => save(), // 可省；手势落账之后
    onIssues: (issues) => report(issues),          // 可省；诊断的唯一出口
});
```

## 交回什么

| 名字 | 是什么 |
|---|---|
| `bindings` | 整包绑到 `NestedGrid` 上的属性与事件处理（`computed`） |
| `node`、`layout`、`revision` | 当前的树、布局与版本 |
| `extent` | `NestedGrid` 量到的承载盒尺寸；挂载前与卸载后是 `null` |
| `invalidate()` | 原地改了树的结构之后调：重算布局、版本递增 |
| `setCollapsed(id, collapsed)` | 收起或展开一块有收起策略的面板，标记变了就重发布局 |

## 尺寸从哪来

尺寸只来自 `NestedGrid` 自己量的根盒，它挂载后量到就发出来，两轴变了才再发。宿主不另量，也不要把 `NestedGrid` 放在“有了尺寸才渲染”的条件后面：那样永远等不到尺寸。

没量到可用尺寸（`null`，或宽、高任一为 0）时，布局为空、手势停用，叶照常挂着，只是没有尺寸。`NestedGrid` 被条件渲染摘掉时，`extent` 回到 `null`。

## 几样只经选项给

`contextKey`、`disabled`、提交处理只经 `useGridHost` 的选项给，模板里不要再写同名属性：

- 模板里另写 `context-key`、`:revision` 会盖住包里的值，提交时被拒、拖不动；
- 另写 `@gesture-commit` 会和包里的提交处理合成数组，提交时出错。

开发模式开关（根入口的 `setLayoutDevChecks`）打开时，这几种在控制台各警告一次。

模板里另写 `@gesture-start` 不受影响：Vue 把同名的监听合成数组、都会调用。渲染函数里展开 `bindings` 时，不要用同名的键覆盖它，也不要放在它前面被它覆盖。

## 诊断一个出口

布局重算的诊断（例如放不下的 `over-constrained`）、`NestedGrid` 的 `issues` 事件（手势的诊断、被拒的提交），都交给选项里的 `onIssues`。

只发新出现的：同一个码、同一个原因、同一根轴、同一个节点，这一次有、上一次重算没有的才发。要知道现在有哪些问题，读 `layout.value.issues`。

## 提交与 `onApplied`

拖完一次，包里的提交处理同步核对上下文、版本与尺寸，用 `resizeBranches` 一次落账，再发布新布局，然后调 `onApplied(commit, result, before)`。

- `before` 是这次提交之前发布的布局，也就是手势开始时呈现的那份；此时 `host.layout` 已经是之后的。
- `onApplied` 是“已经落账”的通知，不是第二道拒绝门：它抛出的错报成 `notify-failed`，不反悔已提交的几何。

## 收起与展开

`host.setCollapsed(id, collapsed)` 只翻那块面板的收起标记，尺寸意图不动，按分配规则重排：按比例分的兄弟吸收差额，保留像素的不变，展开回到意图。

- 标记变了才重发布局、版本递增；版本递增会让进行中的那场手势结束。没变时什么都不做。
- 它不触发 `onApplied`：结果直接交回，`collapse` 里是调用之后的收起策略（含记下的恢复尺寸），要存盘就存它。
- 没有网格时返回 `not-ready`。
- 分隔条上的 Enter 是另一种结果：隔着那条分隔条的邻居让位，恢复到记下的尺寸。
