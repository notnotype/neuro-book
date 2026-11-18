---
标签: [state:local]
别名: ["普通文本框", "Plain Prompt Editor"]
---

# PlainPromptEditor

宿主没有注入提示词编辑器时，输入框用它：一个普通的多行文本框。

## 布局与交互

- 回车发出 `submit({mod: false})`（`enterSubmits` 为假时回车换行），Ctrl/⌘+回车发出 `submit({mod: true})`，Shift+回车换行；输入法组字时的回车不算。
- Escape 发出 `escape`，Shift+Tab 发出 `shift-tab`。
- `bare` 去掉外框，焦点由外层表示；`fill` 时高度撑满外层。
- 没有标签、附件、粘贴块、触发菜单与输入历史：输入框在它上面隐藏“添加附件”，也没有 `/` 命令菜单；正文以登记的 `/命令` 开头时照常执行命令。

## 数据

```ts
type PlainPromptEditorProps = {
    /** 草稿：版本号变化时替换正文；同一版本内的文字变化是自己的回声。 */
    draft: {text: string; version: number};
    locale: "zh-CN" | "en-US";
    placeholder?: string;
    ariaLabel?: string;
    readonly?: boolean;
    /** 默认 true。 */
    enterSubmits?: boolean;
    fill?: boolean;
    bare?: boolean;
};

type PlainPromptEditorEmits = {
    (e: "change", text: string): void;
    (e: "submit", payload: {mod: boolean}): void;
    (e: "escape"): void;
    (e: "shift-tab"): void;
};

type PlainPromptEditorExpose = {
    /** 聚焦，光标落在开头或末尾；默认末尾。 */
    focus(at?: "start" | "end" | "keep"): void;
    /** 在光标处插入文字，发出 change；只读时不做任何事。 */
    insertText(text: string): void;
    /** 收不了附件，什么也不做。 */
    insertFiles(files: readonly File[]): void;
};
```

## 状态与边界

- 正文在组件内；宿主换草稿版本时被替换。
