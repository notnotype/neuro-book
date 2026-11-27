---
标签: [state:inject, state:shared-write, io:read]
别名: ["回执页宿主", "Receipt Page Host"]
---

# ReceiptPageHost

回执页 `nbook.canon.receipt` 的宿主（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 18、20、26 到 28）：经读取层读这次修订（`revision`），再按需读写出它要的名字：被改的、带来的变化里的与改动指向的条目（缺省位置上的名字与字段显示名，`entry-heads.ts`）、文字没变的剧情变更（现在的文字）、它还原的那几次（标题），都折成 `ReceiptPage` 的数据（`receipt.ts`）。由 `receipt-page.ts` 的页面实现创建。

## 布局与交互

- 读到修订时把标题报上去（`onTitle`），标签标题与面包屑用它。
- “还原这次修订”放进窗口里那一个还原对话框（`RevertRequests`）；章序调整（`revertable` 为 `not-revertable`）与世界写不了时不可用。
- 页面顶上是窗口里那一份保存后的提示，同 `EntryPageHost`。

## 数据

```ts
type ReceiptPageHostProps = {
    /** 修订 id。 */
    id: string;
    world: CanonWorld;
    notices: CanonNotices;
    revert: RevertRequests;
    open: (ref: {readonly kind: "entry" | "change"; readonly id: string}) => void;
    receipt: (revision: string) => void;
    onTitle: (title: string) => void;
};
```

## 隐藏通道理由

- `io:read`：要读哪些名字取决于这次修订改了什么，宿主（编辑器）不知道；读取随世界变跟着重读。只在真实界面里验证（`receipt-page.dom.test.ts`），Lab 里看 `ReceiptPage`。
- `state:shared-write`：挂着时向窗口里那一份保存后的提示登记、点“还原”时往还原对话框里放要还原的那一次。
- `state:inject`：经 `useCanonText()`、`useText()` 取翻译端口。
