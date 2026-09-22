---
标签: [state:local]
---

# CodeEditorView

把同一份领域文档投影到通用源码内核，不解析/格式化JSON正文，不读写磁盘。模型身份包含工作面、generation、documentId、路径与视图实例 token。

## 数据

```ts
type Props = {
    document: EditorDocumentSnapshot; visible: boolean; viewInstanceId: string;
    commitChange: (target, baseRevision, content) => EditorChangeResult;
    monacoPreferences: MonacoEditorPreferences; temporaryFontSize?: number | null;
};
// emits: save(target), focus(target,focused), ready(handle|null), update-temporary-font-size(size)
```

无slots、无expose，attrs透传根内核。ready只在内核真实就绪时发出；卸载回传null。`viewInstanceId` 进模型路径，同文档两个视图各持有自己的 Monaco model，可独立 dispose。

## 输入与回执

输入不再是 fire-and-forget：内核报上来的正文经 `commitChange(target, document.contentRevision, content)` 提交，按回执决定本地状态。

- `accepted`：推进本实例的确认正文。宿主随后交付的 accepted 快照与内核内容相同，因此**不回写内核、不重设撤销基线**（自己的回声不打断 Ctrl+Z）。
- `conflict`：保留候选，既不调用内核 `update`，也不当作已接受；候选未被裁决前，兄弟视图的权威快照也不会覆盖它。
- `stale`：身份已撤销（宿主正在卸载本实例），内容不归属任何文档。

`ready` 句柄的 `flushPendingChange()` 返回 `"settled" | "conflict"`：防抖计时器被清掉不等于输入已进入权威缓冲，存在未裁决候选时必须报 `conflict`。`resolveConflict(choice)` 是裁决入口——`adopt-current` 按最新快照重设内核并丢弃候选，`keep-view` 用最新 `document.contentRevision` 重提候选一次。

## 外部回灌

外部或兄弟视图正文只在内容与确认值不同且没有未裁决候选时经内核 `update` 同步；该路径整体重设缓冲区并清空撤销栈（见MonacoCodeEditor声明），所以回灌不入本视图的用户撤销栈，Ctrl+Z 只回溯本实例同步后的输入。

### 命令参与

宿主用命令系统承载具名可发现动作（聚焦编辑器、撤销、重做、跳转到行）。组件不 import 注册表、不执行命令、不引用命令 id，只按三条关系参与：

- **宿主发出**：宿主执行命令，把结果折算成 props 或状态传入；组件不知道命令的存在。只读文档里撤销/重做入口由宿主按 `document.readonly` 与句柄求值禁用，本组件不自己开关入口。
- **组件响应**：无法从 props 推导的动作由宿主路由到当前活动实例，响应入口是 ready 交出的 `EditorViewHandle`——`flushPendingChange`、`focus`、`undo`、`redo` 与冲突裁决 `resolveConflict`。行号跳转走同一句柄上的可选 `navigation`：`getLineCount` 未就绪返回 null，`revealLine` 行号从 1 起、越界拒绝而不 clamp、失败不移动光标。`navigation` 只有真实源码内核（Monaco）提供，Markdown / mock 句柄保持「无 navigation」的合法状态，宿主据此判定行导航是否可用。
- **状态上报**：save / focus / ready 三个既有事件把可观察状态交给宿主，宿主据此维护上下文键（活动编辑器、可写性、焦点、行导航能力）与面板行数；组件不为感知另开通道。

## 状态

占满父级并由内核滚动，390×844可编辑。只读/加载/错误继承内核并交由宿主显示；不提供批注动作、文件操作或统一跨视图撤销。内核主题和防抖通道见MonacoCodeEditor声明。
