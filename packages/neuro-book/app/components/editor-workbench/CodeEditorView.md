---
标签: [state:local]
---

# CodeEditorView

把同一份领域文档投影到通用源码内核，不解析/格式化JSON正文，不读写磁盘。模型身份包含工作面、generation、documentId和路径。

```ts
type Props = { document: EditorDocumentSnapshot; visible: boolean; monacoPreferences: MonacoEditorPreferences; temporaryFontSize?: number | null };
// emits: change(target,content), save(target), focus(target,focused), ready(handle|null), update-temporary-font-size(size)
```

无slots、无expose，attrs透传根内核。ready只在内核真实就绪时发出；卸载回传null。自己产生的输入不全文回灌，外部正文更新通过内核update同步。隐藏期间上游ViewHost不推送正文；重新可见前同步最新快照。

占满父级并由内核滚动，390×844可编辑。只读/加载/错误继承内核并交由宿主显示；不提供批注动作、文件操作或统一跨视图撤销。内核主题和防抖通道见MonacoCodeEditor声明。
