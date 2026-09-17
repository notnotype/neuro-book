---
标签: [state:local]
---

# MarkdownEditorView

同一文档的Markdown可编辑富文本视图，保留引用、方言、批注与受权限约束的frontmatter入口。只挂富文本内核，源码能力由独立code视图承担。

```ts
type Props = {
    document: EditorDocumentSnapshot; visible: boolean; editorPreferences: MarkdownEditorPreferences;
    showFrontmatterPanel: boolean; referenceRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    openReference?: (target: string) => void; resolveReference?: WorkspaceReferenceResolver;
    inlineAiReferences?: InlineEditReference[]; inlineAiHighlightReference?: InlineEditReference | null; enableQuickTriggers?: boolean;
};
// emits: change(target,content), save(target), focus(target,focused), ready(handle|null), actions(target,actions),
// open-frontmatter-profile(kind), inline-ai-reference(reference)
```

无slots、无expose，attrs透传根元素。ready句柄支持flush/focus/undo/redo及markdown.comments动作。动作checked反馈批注面板展开状态。未编辑切换视图不会序列化正文；实际富文本编辑采用现有Markdown方言序列化语义，不承诺源码空白逐字保持。

占满父容器，正文内部滚动；宽屏批注并列，小于700px容器时批注覆盖正文并保留关闭入口。只读不编辑；失焦仅结算并回传焦点，不隐式保存。不执行Agent请求，引用及专属动作通过明确bindings委托宿主。内核依赖和隐藏通道沿用TipTapMarkdownEditor，不能以本适配器声明替代内核审查。
