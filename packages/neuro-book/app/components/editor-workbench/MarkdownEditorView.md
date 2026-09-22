---
标签: [state:local]
---

# MarkdownEditorView

同一文档的Markdown可编辑富文本视图，保留引用、方言、批注与受权限约束的frontmatter入口。只挂富文本内核，源码能力由独立code视图承担。

```ts
type Props = {
    document: EditorDocumentSnapshot; visible: boolean; viewInstanceId: string;
    commitChange: (target, baseRevision, content) => EditorChangeResult;
    editorPreferences: MarkdownEditorPreferences;
    showFrontmatterPanel: boolean; referenceRefreshKey?: string | number;
    resolveMenu?: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    openReference?: (target: string) => void; resolveReference?: WorkspaceReferenceResolver;
    inlineAiReferences?: InlineEditReference[]; inlineAiHighlightReference?: InlineEditReference | null; enableQuickTriggers?: boolean;
};
// emits: save(target), focus(target,focused), ready(handle|null), actions(target,actions),
// open-frontmatter-profile(kind), inline-ai-reference(reference)
```

无slots、无expose，attrs透传根元素。ready句柄支持flush/focus/undo/redo、`markdown.comments`动作与冲突裁决 `resolveConflict`。动作checked反馈批注面板展开状态。未编辑切换视图不会序列化正文；实际富文本编辑采用现有Markdown方言序列化语义，不承诺源码空白逐字保持。

占满父容器，正文内部滚动；宽屏批注并列，小于700px容器时批注覆盖正文并保留关闭入口。只读不编辑；失焦仅结算并回传焦点，不隐式保存。不执行Agent请求，引用及专属动作通过明确bindings委托宿主。内核依赖和隐藏通道沿用TipTapMarkdownEditor，不能以本适配器声明替代内核审查。

## 输入与回执

输入以 `commitChange(target, document.contentRevision, content)` 提交并按回执定归属：`accepted` 推进本实例确认正文（宿主交付的快照与内核内容一致，因此不重设 history 基线），`conflict` 保留候选且不把未接受内容传给内核或其它视图，`stale` 表示身份已撤销。`flushPendingChange()` 返回 `"settled" | "conflict"`，存在未裁决候选时不得报 settled；`resolveConflict("adopt-current")` 丢弃候选并按最新快照重设正文，`resolveConflict("keep-view")` 用最新修订重提候选一次。

同类位置还有一个独立实例（`viewInstanceId` 只进宿主路由与模型身份）：兄弟视图或外部权威正文只在无未裁决候选时经内核 `update` 回灌，该路径重设本视图的撤销基线——外部内容不入用户撤销栈，Ctrl+Z 只回溯本视图最近一次外部同步之后的输入。
