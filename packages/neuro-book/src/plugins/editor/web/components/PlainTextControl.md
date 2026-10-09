---
验证入口: EditorArea
标签: [state:local]
别名: ["纯文本控件", "Plain Text Control"]
---

# PlainTextControl

纯文本编辑器控件：一个等宽 textarea，按编辑器控件合同（`control.ts`）绑定文档。源码编辑器与 Markdown 编辑器接入之前，两种编辑器都用它；之后它只作合同的参照与 Lab 演示。

## 数据

```ts
type Props = {
    binding: ViewBinding | null;
    readonly: boolean;
    visible: boolean;
    /** textarea 的可访问名称（文件名）。 */
    label: string;
};

type Emits = {
    ready: [handle: EditorControlHandle | null];
    focus: [focused: boolean];
};
```

## 行为

- 换绑定时把旧文档的滚动与选区存进旧绑定的槽，并把还没交出的输入交出；从新绑定的槽恢复。
- 每次输入立即经 `binding.commit` 交给文档（没有防抖，所以结算是空操作）；回执为 `conflict` 时保留自己的内容，裁决后按文档的正文重设。
- 文档的正文被别处改了（修订前进且不是自己交的）时重设内容，选区夹到新长度内。
- 句柄：聚焦、行号导航（按换行计行）；不提供撤销与重做（浏览器 textarea 的撤销在程序改值后失效）。

`state:local`：textarea 的引用、确认过的修订与“有未裁决输入”标记，组件销毁即丢失。
