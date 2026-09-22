---
标签: [state:local, state:inject, env:timer]
---

# MonacoCodeEditor

通用源码编辑内核；按 language 选择语法与已加载语言服务，JSON非法文本可继续编辑并原样上报。不是文件会话，不读取或保存文件。

## 数据

```ts
type Props = {
    initialValue?: string; readonly?: boolean; autofocus?: boolean; placeholder?: string;
    visible?: boolean; language?: string; modelPath?: string;
    monacoPreferences?: MonacoEditorPreferences; temporaryFontSize?: number | null;
    submitOnEnter?: boolean; compact?: boolean;
};
// emits: ready(), change(text), focus(), blur(), save-request(),
// submit({ctrlKey?,metaKey?}), shift-tab(), update-temporary-font-size(size)
```

无slots；attrs透传根元素。expose为TextEditorHandle：update、focus、getValue、flushPendingChange、undo、redo、insertText、replaceSelection、appendText、scrollToTop、navigation（getLineCount/revealLine，行号1起、越界拒绝）。

**模型归属**：`modelPath` 由调用者保证实例唯一（文档身份 + 视图实例 token）。每个内核按自己的 URI 新建并独占一个 model，可独立 dispose；不会「同 URI 取已有 model 后各组件都能释放」。同文档的第二个视图是自己的一份 model，正文只通过上层的权威快照同步。

## 交互与状态

Ctrl/Cmd+S与失焦前先结算300ms防抖；只emit保存意图。卸载只取消未结算输入，宿主必须先flush。readonly不产生正文写入。Ctrl/Cmd+滚轮回传临时字号；默认language为plaintext。异步加载失败向父级错误边界传播，不伪造ready。

外部 `update(text)` 取消未结算输入并抑制回环；它整体重设缓冲区（`model.setValue`）而不是整篇 `pushEditOperations`，因此**回灌不制造撤销项、旧历史也不会被重放到新正文上**——用户撤销只回溯本实例同步之后的输入。重设前后自行保留选区（越界坐标夹到新正文内）与滚动位置。自己的输入经防抖 emit，不触发这条回灌通道。

## 布局及上游边界

填满父级，内部Monaco负责横纵滚动，390×844不扩张页面。提供当前加载器的语法/JSON语言服务，不承诺完整VS Code语言能力。主题通过现有产品主题会话读取（注入通道），防抖计时器由内核销毁时取消。外观沿用nb-ui主题变量。
