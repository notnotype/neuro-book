---
验证入口: EditorGroup
标签: [state:local, state:inject, env:timer]
别名: ["Markdown 编辑器", "Markdown Editor", "富文本编辑器"]
---

# MarkdownControl

Markdown 富文本控件：一个 Tiptap 编辑器实例，按编辑器控件合同（`shared/contracts.ts` 的 `TextEditorBinding`）绑定文档（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 9–13、19、61）。读写经 Markdown 编解码器（`markdown/codec/`），规则见 [`workspace/markdown-dialect.md`](../../../../../../../docs/specs/workspace/markdown-dialect.md)；同组的 Markdown 文件共用这一个实例，换文档只换编辑状态。

## 数据

```ts
type Props = {
    binding: TextEditorBinding | null;
    /** 编辑器区给的视图状态槽：控件把编辑器实例放在这里，切走再切回时接着用；淘汰时编辑器区调它的 `dispose`（workbench.editor 输出 19）。 */
    host: ViewStateSlot;
    readonly: boolean;
    visible: boolean;
    /** 编辑区的可访问名称（文件名）。 */
    label: string;
    /** 空文档的占位文字；可选。 */
    placeholder?: string;
    /** 界面语言：控件合同的一员，本控件不用它取文字（见下面的 `state:inject`）。 */
    locale?: DisplayLocale;
};

type Emits = {
    ready: [handle: EditorControlHandle | null];
    focus: [focused: boolean];
};
```

## 行为

- frontmatter 不进入富文本（编解码器原样保留）。
- 每个标签一份编辑状态（含撤销历史与选区）、原文对照（编解码器写回用，随每次被接受的写出累积）连同滚动位置存在绑定的槽里。编辑器实例存在编辑器区给每个标签的实例槽里（`EditorArea.tabControlSlot`）：控件被回收时只从 DOM 上拿下，再挂上时接着用，撤销历史不丢。控件自己不抢焦点，由编辑器区交给活动视图。
- 停止输入 150 ms 后把正文交给文档（输入法还在组字时等组字结束：交出被接受后的写法回填会重画这一块）；失焦、换文档、保存与资源管理器的操作之前立即结算。交出的正文由编解码器写出：没编辑的块写原文字节，编辑过的块重新写出并读回校验；没编辑过时就是原文。被接受后把这次写出实际用的写法回填进编辑器（不进撤销历史），之后再改这一块时保持（方言 Spec 输出 2）。
- 写不出（editor 输出 61）：这次输入不交，经 `binding.block` 记下写不出的那一块与抢救用的正文，视图保留自己的内容、别处的修改不重载它；之后这个视图的一次交出成功即解除。句柄的 `revealRange` 选中那一块并滚过去（组顶部的“定位”）；“采用当前正文”解除后按文档的正文重载。
- 正文被别处改了（另一组的输入、磁盘的新内容、裁决）时只把不同的那一段换掉，这次替换不进撤销历史，本组已有的撤销步骤映射过去后仍可用；原文对照换成按新正文读入的（没变的块以新原文为来源）。回执为 `conflict` 时保留自己的内容，裁决后同样按这种方式换成文档的正文。
- 显示（方言 Spec 输出 9、11–16、19、23）：批注的正文带波浪线，块批注左侧一条虚线；注音小字在上；双语的译文行在原文上方；提示块按类型有图标与颜色，带折叠标记的可以点标题行折叠（折叠状态按编辑状态记、不写回；光标进去或内容被改到时自动展开）；任务项有复选框；原样块与原样片段显示源码；可渲染 HTML 是源码卡片。颜色都取主题 token。
- 文件被外部删除后只读：之前敲下、还在 150 ms 延迟里的输入照常交出（文档在已删除时仍接受输入回执）。
- 链接点击不打开（编辑器里点链接是要编辑它）。
- 在格式的边界打字（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 62）：引入第三方编辑扩展时，逐项核对它影响输入的默认值（自动转换、标记是否包含边界、输入规则），与 Spec 不符的显式关掉，并在 `MarkdownControl.dom.test.ts` 的“在格式的边界打字”一组里补一行。
- 纸面（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 32）：界面字体，版心 720px（含左右各 48px 留白）、上 64px 下 120px、正文 17px、行距 1.95、段距 1.1em。这些值是控件根上的变量（`--markdown-measure`、`--markdown-padding-*`、`--markdown-font-size`、`--markdown-line-height`、`--markdown-block-gap`），以后做成偏好时只换变量。
- 上次的光标（输出 30）：第一次为这份文档建编辑状态、标签记着光标时，把选区放到记下的位置（正文变短时夹到末尾）并滚到它；编辑状态还在时用它自己的选区。光标停下 1 秒、失焦或换文档时把选区活动端交给 `binding.remember`。
- 句柄：聚焦、撤销、重做、结算；不提供行号导航（富文本没有行号）。另交出大纲 `outline` 与 `revealHeading`（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 的控件合同，面包屑用）：大纲跟着当前绑定，`binding` 是它的 token，正文每变一次（含按文档的正文重载）`version` 加一，光标动了只换 `current`；换绑定、没有绑定、卸载时为 null。标题 id 按位置给（同名不冲突），位置只记在控件里；`revealHeading` 的 `binding` 或 `version` 对不上为 `stale`、不移动光标，对得上时把光标放到标题开头并滚到它。

- 编辑动作与菜单（[`workbench/markdown-editing.md`](../../../../../../../docs/specs/workbench/markdown-editing.md)）：句柄交出 `editing`，动作实现在 `@notnotype/nb-markdown/editor`。菜单从编辑器区注入的 `editorMenusKey` 取，没有注入时（组件测试）不画工具栏与菜单。菜单状态按组件实例算，不写 ProseMirror 插件视图：换文档时 `plugins` 数组换了，插件视图会全部重建；组件重挂时也一样。

`state:local`：编辑器实例与当前绑定。`state:inject`：方言目录与资产地址（`nbook.markdown` 交出组件时提供），以及窗口的翻译端口（[`ui/i18n.md`](../../../../../../../docs/specs/ui/i18n.md)）：引用小块的悬停提示与图片的说明经它取，`markdownViewContext()` 把它带进节点视图里挂的图片，换语言时不重建编辑器：图片跟着端口重画，引用小块的悬停提示由控件重算一次。`env:timer`：输入后的结算延迟与记下光标的延迟，卸载与结算时清除。

## 不支持

批注侧栏、Agent 与 AI 引用、工作区引用标签与 frontmatter 面板（frontmatter 用源码编辑器改）。
