---
标签: [state:inject, state:shared-write, io:read, io:mutate]
别名: ["变更详情页宿主", "Change Page Host"]
---

# ChangePageHost

变更详情页 `nbook.canon.change` 的宿主（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 18、21、26 到 29）：经读取层读出这条变更（`object`）与章表，再读它涉及与改到的条目的名字与字段显示名（`entry-heads.ts`），折成 `ChangePage` 的数据（`change.ts`）。改一处的值与“改成生效”在 `change-edit.ts`：读出这条变更、换掉那一处的值或生效状态，照普通写入先预览再发布；填了一半的输入在标签状态里（`state.edit`）。由 `change-page.ts` 的页面实现创建。

## 布局与交互

- 读到文字与安放时报上去（`onHead`），标签标题与面包屑用它。
- 改一处：确认条同条目页（`ConfirmBar`，没有意图一项，“会写回这条情节”）；保存或取消以后焦点回到那一处的“改”。读出以后这条变更被别处改过：写“这个对象刚被改过”，以重读到的那一份为准重新预览，要作者再点一次保存。
- “打开这一章”：交给页面实现给的 `openChapter`（按章的编号在活页夹目录里找章节文件，经编辑器打开）；没找到时页面写一句。
- 页面顶上是窗口里那一份保存后的提示，同 `EntryPageHost`。

## 数据

```ts
type ChangePageHostProps = {
    /** 剧情变更 id。 */
    id: string;
    /** 编辑器给这个标签的响应式状态（`ChangePageState`）。 */
    state: ChangePageState;
    world: CanonWorld;
    client: Pick<CanonClient, "call">;
    notices: CanonNotices;
    revert: RevertRequests;
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    receipt: (revision: string) => void;
    openChapter: (chapter: string) => Promise<boolean>;
    onHead: (head: {readonly text: string; readonly place: string}) => void;
};
```

## 隐藏通道理由

- `io:read`：要读哪些名字取决于这条变更涉及谁、改了谁，宿主（编辑器）不知道；读取随世界变跟着重读。只在真实界面里验证（`change-page.dom.test.ts`），Lab 里看 `ChangePage` 与 `ConfirmBar`。
- `io:mutate`：改一处与改成生效要按页面里的状态（改哪一处、填的值、读出时的版本）拼写入。
- `state:shared-write`：保存成功后往窗口里那一份保存后的提示放一条；挂着时向它登记；点“还原”时往还原对话框里放要还原的那一次。
- `state:inject`：经 `useCanonText()`、`useText()` 取翻译端口。
