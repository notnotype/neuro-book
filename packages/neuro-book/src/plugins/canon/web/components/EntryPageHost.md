---
标签: [state:inject, state:shared-write, io:read, io:mutate]
别名: ["条目页宿主", "Entry Page Host"]
---

# EntryPageHost

条目页 `nbook.canon.entry` 的宿主（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 6 到 15、26、27）：按标签的状态（`state`，编辑器给每个标签的那一份）经读取层读条目、章表、渲染与情节，交给 `EntryPage` 与各分页的组件；数据分页按类型用 `canon.component-views` 交来的界面，没有、贡献方停了或加载失败时用 `FieldsDataView`。由 `entry-page.ts` 的页面实现创建。

## 布局与交互

布局都在 `EntryPage` 与各分页的组件里，本组件只决定画哪个分页、给它们什么数据：

- 分页依次是文字（条目有主文字时）、每个启用的命名空间一个、情节；当前分页记在标签状态里，没有了就选第一个。情节的第一页不论在哪个分页都读，分页名后要写总条数。
- 文字分页里点一个值，在标签状态里记下它（`state.origin`），只读它的来历；再点收起。来历在世界版本、所选位置或模式变了以后按已读的步数重读。
- 数据分页：类型有交付的专门界面就用它（加载期间写“读取中…”），没有、撤回或加载失败时用 `FieldsDataView`，加载失败另在上面写原因。
- 标签标题与面包屑只在读的是缺省位置、实际模式时报上去（`onHead`），换位置看到别的名字时标题不变。
- 页面顶上是窗口里那一份保存后的提示（`NoticeBar`）：挂着时向它登记（`usePageNotice`），所以提示显示在这里而不是工作台通知；“撤销”打开窗口里那一个还原对话框。世界只读时页头上面有一条横幅写原因。

## 状态

- 加载中：章表或条目第一次还没读到。
- 读取失败：章表或条目第一次就没读出来（`EntryPage` 的 `failed`）。
- 找不到、已删除、未出场、断开：见 `EntryPage`。
- 选过的章被删掉：位置回到缺省，`state.positionGone` 为真，作者再选一个位置后清掉。

## 数据

```ts
type EntryPageHostProps = {
    id: string;
    /** 编辑器给这个标签的响应式状态（`EntryPageState`）。 */
    state: EntryPageState;
    world: CanonWorld;
    fetchOrigins: (address: TextAddress, position: ReadPosition, mode: "actual" | "planned", cursor?: string) => Promise<OriginsPage>;
    /** 世界客户端的读取（预览、读一个对象）。 */
    client: Pick<CanonClient, "call">;
    /** 本窗口的保存后的提示。 */
    notices: CanonNotices;
    /** 本窗口的还原对话框（提示里的“撤销”）。 */
    revert: RevertRequests;
    views: ComponentViewRegistry;
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    /** 打开一次修订的回执页。 */
    receipt: (revision: string) => void;
    /** 读到页头时报给页面实现：标签标题与面包屑用它。 */
    onHead: (head: EntryHead) => void;
};
```

## 隐藏通道理由

- `io:read`：读取随标签的状态变（换位置、换分页、展开一个值），只读当前分页要的；这些状态在页面里，宿主（编辑器）不知道条目页要读什么。只在真实界面里验证（`entry-page.dom.test.ts`），Lab 里看 `EntryPage` 与各分页的组件。
- `io:mutate`：就地改、记一笔、删除条目要按页面里的状态（在改哪个值、所选位置、读到的值与版本）拼写入，写完由读取层重读；宿主不知道这些。
- `state:shared-write`：保存成功后往窗口里那一份保存后的提示放一条；挂着时向它登记；点“撤销”时往还原对话框里放要还原的那一次。
- `state:inject`：经 `useCanonText()`、`useText()` 取翻译端口。
