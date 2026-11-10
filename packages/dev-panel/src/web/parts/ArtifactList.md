---
标签: []
---

# ArtifactList

产物页的列表（t03 第二轮产物页的列表）：按类分组——设计稿、讲解与报告、审查报告、提问集、还没发布的、文档类产物（Task 目录里的 Markdown）与证据（各 Task 的数目）。每条写明属于哪个 Work 与 Task、版本、待答数，等会话采纳的标出来；已采纳是完成态，不画徽标，产物 id 不写（t22）。每组里有题待答的排最前，再是等会话采纳的，其余保持原来的顺序。手机上标题独占一行，编号与标记在下一行。过滤由页面做，这里只排版。

## 数据

```ts
interface ArtifactListProps {
    /** 有发布记录的与没发布的产物；必填 */
    artifacts: ArtifactListItem[];
    /** 文档类产物；必填 */
    documents: DocumentListItem[];
    /** 各 Task 的证据数；必填 */
    evidences: EvidenceListItem[];
}
interface ArtifactListEmits {
    /** 普通左键点了一个入口；参数是面板内的地址，由页面 `router.push`。中键与带修饰键的点击交给浏览器（新标签页） */
    (event: "navigate", href: string): void;
}
```

没有插槽与 expose。全部为空时显示空态。产物、文档类产物与证据的入口都是真实链接（`<a href>`，分别去产物页、文档页、Task 页），能在新标签页打开。
