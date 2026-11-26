# useGridHost

把 `NestedGrid` 要的几样（树、布局、版本、上下文键、停用、提交处理、接尺寸与诊断的处理）打成一包，宿主写 `<NestedGrid v-bind="host.bindings.value">` 就能接手势。完整例子见包的 [README](../../README.md) 的“起步”。

```ts
const host = useGridHost({
    grid,                       // 网格实例：值、ref 或 getter；为 null 时布局为空、拒绝提交
    contextKey: "editor-area",  // 可省，缺省空串；换了上下文，旧手势的提交不落账
    disabled: () => locked.value, // 可省；宿主自己的停用条件
    onApplied: (change, before) => save(),  // 可省；落账、收起展开与设尺寸之后
    onIssues: (issues) => report(issues),          // 诊断的唯一出口；不给时开发检查警告一次
});
```

## 交回什么

| 名字 | 是什么 |
|---|---|
| `bindings` | 整包绑到 `NestedGrid` 上的属性与事件处理（`computed`） |
| `node`、`layout`、`revision` | 当前的树、布局与版本 |
| `extent` | `NestedGrid` 量到的承载盒尺寸；挂载前与卸载后是 `null` |
| `invalidate()` | 原地改了树的结构之后调：重算布局、版本递增 |
| `setCollapsed(id, collapsed, options?)` | 收起或展开一块有收起策略的面板，`options.locked` 同时改锁；有变化就重发布局并通知 `onApplied` |
| `setSize(id, px)` | 把一块保留像素的面板设成给定宽度（同 `grid.setSize`）；意图变了就重发布局并通知 `onApplied` |

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

没给 `onIssues` 时，库不把诊断本身打到控制台：诊断与被拒的提交都被丢掉。开发模式开关打开时，`useGridHost` 在建立时警告一次“没有出口”。有意不收诊断的宿主给一个什么都不做的 `onIssues`。这条只看 `useGridHost` 的选项：直接用 `NestedGrid`、不经 `useGridHost` 的宿主查不到。

## 什么时候调 `invalidate()`

原地改了树之后调：结构操作（`addLeaf`、`splitLeaf`、`removeLeaf`、`moveLeaf`）、`grid.restore`、直接调 `grid.setSize` 或 `grid.setCollapsed`。经 `host.setCollapsed`、`host.setSize` 改的不用调，它们自己重发布局；`invalidate()` 不调 `onApplied`，结构操作之后要存盘的宿主自己存；换了一个网格实例（`grid` 选项的值变了）也不用调。经 `NestedGrid` 属性给的宿主状态（内容项、活动标签、最大化）不用调，属性变了组件自己重画。

调一次版本就递增：进行中的分隔条手势被取消；拿版本作结构键的拖动会话（`structure` 返回它）整场取消。所以不要为了“保险”在每次渲染或每次拖动中调它。

## 提交与 `onApplied`

三种改动落账之后都调 `onApplied(change, before)`，`change.kind` 说是哪一种：

| `kind` | 什么时候 | 另带 |
|---|---|---|
| `gesture` | 拖完一次（或键盘调整、Enter 切换结束）：包里的提交处理同步核对上下文、版本与尺寸，用 `resizeBranches` 一次落账 | `commit`、`result` |
| `collapse` | `host.setCollapsed` 有变化（标记或锁） | `id`、`result` |
| `size` | `host.setSize` 改了意图 | `id`、`result` |

三种都带 `collapsed`：这次翻了收起标记的节点（id 到新状态），只改了锁或尺寸时是空对象。

- 先发布新布局再调它：`before` 是这次改动之前发布的布局（手势就是开始时呈现的那份），此时 `host.layout` 已经是之后的。
- `onApplied` 是“已经落账”的通知，不是第二道拒绝门：它抛出的错报成 `notify-failed`，不反悔已提交的几何。
- 没有变化、被拒或没有网格时不调；`invalidate()` 也不调。

## 收起与展开

`host.setCollapsed(id, collapsed)` 只翻那块面板的收起标记，尺寸意图不动，按分配规则重排：按比例分的兄弟吸收差额，保留像素的不变，展开回到意图。

- 标记或锁变了才重发布局、版本递增，并调 `onApplied`；版本递增会让进行中的那场手势结束。没变时什么都不做。
- 结果也直接交回，`collapse` 里是调用之后的收起策略；要存盘就存它的 `collapsed`，展开尺寸就是快照里的意图；锁与别的策略字段一样不进快照，恢复时由宿主按自己的记录给回。
- 锁住的面板只有宿主能翻：`setCollapsed` 照常翻它，锁经 `options.locked` 改；拖动收不了也拉不开它，分隔条上的 Enter 跳过它。
- 没有网格时返回 `not-ready`。
- 分隔条上的 Enter 能翻时结果与 `setCollapsed` 相同，走手势那条路（`kind` 是 `gesture`）；放不下或没有兄弟吸收差额时不切换。
