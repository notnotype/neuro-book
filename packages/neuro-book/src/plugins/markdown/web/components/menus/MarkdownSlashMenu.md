---
验证入口: EditorArea
标签: [state:local, state:inject]
---

# MarkdownSlashMenu

斜杠菜单（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 10–13）：触发与查询来自 `@notnotype/nb-markdown/editor` 的 `activeSlash`，面板是 nb-ui 的 `SuggestionMenu`，光标留在正文。键盘在 `scroller` 的捕获阶段先拦下（ProseMirror 的处理器在里面），只有菜单开着时才拦。

每项只有图标与名称，不写 Markdown 写法。筛选按名称与拼音首字母；`pinyin-pro` 第一次打开时才加载。

`state:local`：查询、当前项、是否在组字。`state:inject`：诊断出口（拼音库加载失败时记一条）。

## 不支持

“插入”组（引用文件、图片）：命令还没有。
