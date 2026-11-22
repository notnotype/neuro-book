---
标签: ["state:local"]
---

# 详情外壳

右侧的一张详情（docs/specs/story/viewer.md 输出 66、67）：人物卡、原文、段落或图节点画在里面，外面一层带读屏名称与关闭按钮（人物卡自己带关闭按钮，其余三种在右上角补一个）。宽屏时由 `BookFrame` 画进网格的内容层，两张并排时各一个。

里面的链接换它所在的那一张：外壳给里面提供会话的代理（`host/detail-scope.ts` 的 `scopeSession`），`openCard`、`openSource`、`openParagraph`、`openNode` 换这一张，`closeDrawer` 关这一张，其余（阅读位置、页面、`openBeside` 等）原样转给会话。卡片里的 `NameLink`、`RefLink`、页签、迷你关系图都不用知道自己在哪一张，以后新加的入口也一样。

## 数据

```ts
defineProps<{
    /** 书的会话；外壳只拿它做代理的原型，自己不读它的状态。必填。 */
    session: BookSession;
    /** 这一张：`key` 与内容。必填。 */
    item: DetailItem;
    /** 左边是 0，右边是 1。必填。 */
    index: number;
    /** 此刻并排的张数（1 或 2）。必填。 */
    count: number;
    /** 是不是最近点过的那张。必填。 */
    active: boolean;
}>();

defineEmits<{
    /** 要关掉这一张（关闭按钮、卡片里的关闭）：带外壳的根元素，宿主据此看焦点在不在里面、先把焦点交出去再关。 */
    close: [shell: HTMLElement];
    /** 在里面按下指针、获得焦点或滚动，而它不是最近的那张：宿主让它成为最近的。 */
    touch: [];
    /** 与另一张对调（头部的按钮，或卡片菜单里的“与另一张对调”）。 */
    swap: [];
}>();
```

没有 slots、expose。

## 呈现

- 根元素是 `aside`，带 `data-testid="drawer"`、`data-detail-key`（这一张的 `key`）、`data-detail-index`（0 或 1）；`tabindex="-1"`，关掉另一张时焦点能交到这里，不进 Tab 顺序；键盘用户看得到焦点交到了这里（内嵌焦点线）。
- 读屏名称：一张时“详情”，两张时“左边的详情”“右边的详情”（与分隔线的显示名同一个函数，`host/details.ts` 的 `detailLabel`）；两张时最近点过的那张带 `aria-current="true"`，上边一条 2 像素的强调色线。

## 注意事项

- 外壳不读会话的 `details`：关掉的那张在过渡里由网格冻住插槽调用（`leave: "retain"`），但外壳自己读的响应式数据照常更新，读到已经关掉的那张会出错。它要的几样都经属性给，属性停在关之前的样子。
- 代理的 `key` 在建外壳时定下：一个外壳只对应一张详情，换成别的内容时宿主换 `key`、换外壳；换页签不换。
- `state:local`：只有根元素的模板引用。代理用 `provide` 交给里面，不是取外面的东西。
