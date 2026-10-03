# 编辑器工作台规范

## Summary

中央编辑区按 VS Code 工作台思路组织：文件选择会打开标签页，标签页绑定真实 workspace 文件 buffer；Markdown、代码、JSON、纯文本由编辑器分发层选择不同组件展示。

## Key Rules

- `.md` 文件使用 TipTap Markdown 编辑器；frontmatter 与正文分离，TipTap 只编辑正文，保存时重新合并。
- `.json`、代码文件、`.txt`、无扩展文本文件使用 Monaco；语言根据扩展名推断，未知文本回退 `plaintext`。
- 标签页保留 `path/title/editorKind/viewMode/dirty`；第一版只实现单编辑组，后续分屏在此基础上扩展。
- 工具栏由当前 active tab 决定按钮：Markdown 显示富文本/源码/分屏预留、Comment、align、frontmatter；Monaco 显示源码状态和通用保存/撤销/重做。

## Markdown Extensions

- 引用：`[label](../relative/path/)`、`[label](./draft.md)` 等 Markdown 相对路径。
- 评论：`<comment id="comment-123" body="评论内容">被评论文本</comment>`。
- 对齐：`<align value="center">文本</align>`，`value` 支持 `left | center | right | justify`。
- 无损目标是语义无损，不承诺空白、属性顺序、Markdown 标记风格的字节级不变。

## Implementation Notes

- `MilkdownEditor.vue` 文件名暂时保留，但内部实现是 TipTap，避免一次性改动所有调用方。
- `StructuredTextEditor.vue` 是轻量结构化文本编辑器；新 TipTap Markdown 编辑器是它的能力超集。
- frontmatter 独立 dialog 只编辑 YAML 对象；解析失败时不得写回文件。

## Component API

- `MilkdownEditor.vue`
  - `initialValue`/`change` 的值始终是完整 Markdown。
  - 组件内部用 `splitMarkdownFrontmatter` 分离开头 YAML frontmatter；TipTap 只接收正文。
  - `getValue()` 返回重新合并 frontmatter 后的完整 Markdown。
- `MarkdownSourceEditor.vue`
  - 用 `language` 接收 Monaco language。
  - 用 `modelPath` 生成 Monaco model URI，确保不同文件 path 拥有独立 model、撤销栈和诊断上下文。
- `NovelEditorToolbar.vue`
  - 工具栏按钮由当前 editor kind 生成 action descriptor。
  - Markdown 主动作包含 frontmatter、comment、居中；次要 align 动作进入 `...` 菜单。

## Dispatch Rules

- 编辑器类型：
  - `.md` + editable：`markdown`。
  - 其它 editable 文本：`monaco`。
  - 不可编辑：`readonly`。
- Monaco language：
  - `.json` -> `json`。
  - `.js/.mjs/.cjs` -> `javascript`。
  - `.ts/.tsx` -> `typescript`。
  - `.vue` -> `html`。
  - `.css` -> `css`。
  - `.html/.htm` -> `html`。
  - `.yaml/.yml` -> `yaml`。
  - `.txt`、无扩展、未知扩展 -> `plaintext`。

## Frontmatter Rules

- 只有 `manuscript/`、`lorebook/` 下的内容节点 Markdown 文件启用 frontmatter 按钮。
- frontmatter 必须是 YAML object；空字符串表示删除 frontmatter。
- dialog 打开时可展示解析错误，但只有校验通过后才能写回。
- split/compose 的目标是保留正文内容，不承诺换行风格字节级不变。

## Split Extension Point

- `WorkspaceEditorViewMode` 保留 `split`，当前只作为 UI 状态。
- 真正分屏以后应在 tab 之上增加 editor group，不改变单 tab 的 `path/title/editorKind/viewMode/dirty` 基础结构。
