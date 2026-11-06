---
验证入口: EditorGroup
标签: [state:local, env:global]
别名: ["源码编辑器", "Source Editor", "Monaco"]
---

# MonacoControl

源码编辑器控件：一个 Monaco 编辑器实例，按编辑器控件合同（`shared/contracts.ts` 的 `TextEditorBinding`）绑定文档（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 9–13、20、43–45）。每个标签一个实例。

## 数据

```ts
type Props = {
    binding: TextEditorBinding | null;
    readonly: boolean;
    /** 变为可见时重新布局（停放期间尺寸为零）。 */
    visible: boolean;
    /** 编辑器的可访问名称（文件名）。 */
    label: string;
};

type Emits = {
    ready: [handle: EditorControlHandle | null];
    focus: [focused: boolean];
};
```

## 行为

- 第一次挂上时按需加载 Monaco 与 JSON 的语言服务，加载失败原位显示原因。
- 语言（输出 43–45）：编辑器区经 `provide` 交来语言登记表（`code/languages.ts`），建模型前把还没登记的语言声明登记进 Monaco；没有登记表时（Lab）只有纯文本与 JSON。标签记着已登记的语言就用它建模型，否则交给 Monaco 按文件名与首行识别（模型的 URI 带序号与文件名，只为识别）。标签记下的语言变了时 `setModelLanguage`，绑定不变。句柄的 `language` 是模型此刻的语言 id，换文档、卸载时为 null。
- 每“文档 × 组”一个模型，连同视图状态存在绑定的槽里：换文档时 `setModel` 并恢复光标、滚动与选区；A→B→A 回来时撤销栈还在。模型由编辑器区在标签关闭或淘汰时释放，组件卸载只释放编辑器实例。
- 每次输入立即经 `binding.commit` 交出；回执为 `conflict` 时保留自己的内容，裁决后按文档的正文重设。正文被别处改了时用 `setValue` 换成文档的正文，这会清掉这个模型的撤销栈（外部内容不进用户的撤销历史）。
- Monaco 的模型把换行统一成一种、把 BOM 单独存放：交给文档的正文是换入模型时的原文与模型内容按行三方合并的结果（`source-merge.ts`），没改的行连同自己的换行符原样保留，模型文本取时带上 BOM（`getValue(undefined, true)`）。只打开、切走、切回不会变 dirty。
- 控件被回收再挂上时编辑器实例重建（撤销栈在模型里，不丢）；控件自己不抢焦点，由编辑器区交给活动视图。
- 上次的光标（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 30）：第一次为这份文档建模型、标签记着光标时，把光标放到记下的行列（正文变短时夹到末尾）并滚到中间；光标停下 1 秒、失焦或换文档时把行列交给 `binding.remember`。
- 排版（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 52 的“代码编辑器”小组）：编辑器区经 `provide` 交来一份随配置变化的选项（`code/options.ts`），没有时（Lab）用缺省值。字体、字号、行高、行号、缩略图、换行是编辑器实例的选项，变化时 `updateOptions`，实例不重建；字体留空时取文档根上的 `--font-mono`。缩进是模型的选项：每个模型记下上次按哪份缩进设置应用过，进入模型时设置变了才重新应用（推测打开时 `detectIndentation`，关掉时固定 Tab 宽度与空格），当前模型在设置变化时立即应用；设置没变时切走再切回不重新推测。
- 句柄：聚焦、撤销、重做、行号导航（`revealLineInCenter` 并把光标放到行首）、光标位置与语言。

`state:local`：编辑器实例与当前绑定。`env:global`：观察文档根的属性（主题与明暗换了重新生成 Monaco 的主题），卸载时断开。
