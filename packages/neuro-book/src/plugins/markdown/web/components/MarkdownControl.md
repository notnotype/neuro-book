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
    /** 编辑内核失焦；焦点进自己的菜单与输入框也算（自动保存的“失焦时”用）。 */
    leave: [];
};
```

## 行为

- frontmatter 不进入正文：它在编辑器文档的属性上（`frontmatterOf`），写回把它原样拼在正文前，别处改了它时跟着重载。有 frontmatter 时稿纸里、正文上方是属性面板（nb-markdown 的 `MarkdownProperties`，[`workbench/markdown-editing.md`](../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 39–51）：面板交回的新原文在这里作为一次编辑提交（`setDocAttribute`，进撤销历史），之后照正文的输入交出；结算先让面板写回还没写回的输入，交给 `binding.attach` 的“手里有没有没交出的输入”也算上它。面板按绑定换实例（`key`）。展开状态按文件地址记在注入的 `markdownPropertiesOpenKey`（插件给的是项目分区的本机记录 `markdown.properties-open`，没有注入时几个控件共用一份内存里的）。新建 frontmatter（第一块开头打 `---`、编辑动作 `properties`）的事务带 `FRONTMATTER_REQUEST`：控件看到它就记下展开、让面板聚焦新属性的名字。正文第一块的开头按上方向键，焦点进面板的最后一个输入；面板发 `leave` 时焦点回到正文原来的选区。新建用的换行符在换文档、重载时写进编辑器（`setFrontmatterEol`）。属性的改动走撤销历史。已知限制：重载换属性不进撤销历史，之后撤销本组在重载之前对属性的改动，换回的是那次改动之前的整段原文，别处对 frontmatter 的修改随之丢掉（正文的撤销按段映射，不受影响）；这要本组改了 frontmatter、别处又改了它，再在本组撤销。
- 每个标签一份编辑状态（含撤销历史与选区）、原文对照（编解码器写回用，随每次被接受的写出累积）连同滚动位置存在绑定的槽里。编辑器实例存在编辑器区给每个标签的实例槽里（`EditorArea.tabControlSlot`）：控件被回收时只从 DOM 上拿下，再挂上时接着用，撤销历史不丢。控件自己不抢焦点，由编辑器区交给活动视图。
- 停止输入 150 ms 后把正文交给文档（输入法还在组字时等组字结束：交出被接受后的写法回填会重画这一块）；失焦、换文档、保存与资源管理器的操作之前立即结算。交出的正文由编解码器写出：没编辑的块写原文字节，编辑过的块重新写出并读回校验；没编辑过时就是原文。被接受后把这次写出实际用的写法回填进编辑器（不进撤销历史，接着打字要用的格式原样带过去：刚用快捷键切换的格式不因这次交出丢掉，editor 输出 62），之后再改这一块时保持（方言 Spec 输出 2）。已知限制：别处改了正文、本控件按新正文重载（`reload`）时，替换照常清掉接着打字要用的格式；这要两个组同时编辑同一份文档，且正好落在切换格式与下一个字之间。
- 写不出（editor 输出 61）：这次输入不交，经 `binding.block` 记下写不出的那一块与抢救用的正文，视图保留自己的内容、别处的修改不重载它；之后这个视图的一次交出成功即解除。句柄的 `revealRange` 选中那一块并滚过去（组顶部的“定位”）；“采用当前正文”解除后按文档的正文重载。
- 正文被别处改了（另一组的输入、磁盘的新内容、裁决）时只把不同的那一段换掉，这次替换不进撤销历史，本组已有的撤销步骤映射过去后仍可用；原文对照换成按新正文读入的（没变的块以新原文为来源）。回执为 `conflict` 时保留自己的内容，裁决后同样按这种方式换成文档的正文。
- 显示（方言 Spec 输出 9、11–16、19、23）：批注的正文带波浪线，块批注左侧一条虚线；注音小字在上；双语的译文行在原文上方；提示块按类型有图标与颜色，带折叠标记的可以点标题行折叠（折叠状态按编辑状态记、不写回；光标进去或内容被改到时自动展开）；任务项有复选框；原样块与原样片段显示源码；可渲染 HTML 是源码卡片。颜色都取主题 token。
- 文件被外部删除后只读：之前敲下、还在 150 ms 延迟里的输入照常交出（文档在已删除时仍接受输入回执）。
- 链接：单击是编辑（Tiptap 的 Link 选中整条链接）；按住 Ctrl（⌘）点才打开（[`workbench/markdown-editing.md`](../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 53）：作品里的文件与用户资产经编辑器区菜单执行 `nbook.editor.open`，外部网址（`http`、`https`、`mailto`，`classifyTarget` 的缺省规则）用临时的 `<a target=\"_blank\">` 点一下，文件内的片段与别的方案不处理；没有编辑器区（Lab、组件测试）时不提供打开，Ctrl 点也不接手。批注层让出链接上的 Ctrl 点（同一段文字既是链接又是批注时链接优先）。
- 宿主给扩展的能力经间接对象：编辑器实例跨挂载复用（标签移组、拆分时控件卸载重挂），扩展建一次，所以扩展里放的不是某一次挂载的闭包，而是读“当前挂载”的 `HostTarget`（存在实例槽里，每次挂载换成这次的 `viewHost`，卸载时清空）。`base()`、`openLink`、`images` 都在事件发生时才读。实例槽里的对象 `markRaw`：槽被包进响应式时编辑器实例不能被代理。
- 粘贴图片（输出 55、58）：`viewHost.images` 来自注入的 `markdownMediaKey`（`../media.ts`）与 `view-images.ts`：没有提供媒体能力时不装，粘贴照原来的粘贴；提供了、没绑定作品时装上，粘贴被接手、上传返回 `unavailable` 并给通知。存放目录与文件名按设置与当前文件算，失败的通知经 `menus.notify(key, params)`（`menus.image*`）。
- 在格式的边界打字（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 62）：引入第三方编辑扩展时，逐项核对它影响输入的默认值（自动转换、标记是否包含边界、输入规则），与 Spec 不符的显式关掉，并在 `MarkdownControl.dom.test.ts` 的“在格式的边界打字”一组里补一行。
- 纸面（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 输出 32）：界面字体，版心 720px（含左右各 48px 留白）、上 64px 下 120px、正文 17px、行距 1.95、段距 1.1em。这些值是控件根上的变量（`--markdown-measure`、`--markdown-padding-*`、`--markdown-font-size`、`--markdown-line-height`、`--markdown-block-gap`），缺省值如上，字号、行距与字体由设置“Markdown 正文”改（`nbook.editor` 经 `markdownEditorOptionsKey` 注入，控件把它写在自己根的内联变量上，`--markdown-user-font` 只在用户填了字体时写；留空时正文用皮肤的 `--font-prose`，皮肤没有再用界面字体）。变量只写在 `.markdown-control-root` 上，不要提到更外层：对话里的 Markdown 展示器也读 `--markdown-font-size`。没有注入（Lab、组件测试）时用样式里的缺省。字号变后版心与两侧场景图不变（版心固定 720px）；批注页边靠容器尺寸重排，不受影响；滚动位置按视野顶端那一块补回（排版变了正文高度跟着变，像素位置不补会漂到别处，`MarkdownControl.vue` 的排版监听）。已知限制：块手柄（`MarkdownBlockGutter`）的悬停位置在字号变后可能停在旧处，到下一次指针移动才更新。
- 上次的光标（输出 30）：第一次为这份文档建编辑状态、标签记着光标时，把选区放到记下的位置（正文变短时夹到末尾）并滚到它；编辑状态还在时用它自己的选区。光标停下 1 秒、失焦或换文档时把选区活动端交给 `binding.remember`。
- 句柄：聚焦、撤销、重做、结算；不提供行号导航（富文本没有行号）。另交出大纲 `outline` 与 `revealHeading`（[`workbench/editor.md`](../../../../../../../docs/specs/workbench/editor.md) 的控件合同，面包屑用）：大纲跟着当前绑定，`binding` 是它的 token，正文每变一次（含按文档的正文重载）`version` 加一，光标动了只换 `current`；换绑定、没有绑定、卸载时为 null。标题 id 按位置给（同名不冲突），位置只记在控件里；`revealHeading` 的 `binding` 或 `version` 对不上为 `stale`、不移动光标，对得上时把光标放到标题开头并滚到它。

- 编辑动作与菜单（[`workbench/markdown-editing.md`](../../../../../../../docs/specs/workbench/markdown-editing.md)）：句柄交出 `editing`，动作实现在 `@notnotype/nb-markdown/editor`。菜单从编辑器区注入的 `editorMenusKey` 取，没有注入时（组件测试）不画工具栏与菜单。菜单状态按组件实例算，不写 ProseMirror 插件视图：换文档时 `plugins` 数组换了，插件视图会全部重建；组件重挂时也一样。

- 属性的图标、显示名与类型（[`workbench/markdown-editing.md`](../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 59–61）：插件入口按贡献点 `markdown.properties` 建好 `describe`（`../properties-catalog.ts`，声明现查、显示名经窗口翻译端口解析），经注入键 `markdownPropertiesDescribeKey` 交给控件，控件原样传给属性面板的 `describe`；没有注入（Lab、组件测试）时面板照旧。
- 批注页边（[`workbench/markdown-editing.md`](../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 33）：开关（`menus.commentMargin`，这部作品的本机记录）开着、控件够宽才画。宽度量控件根 `.markdown-control-root` 的容器宽度（不含滚动条，页边卡片把短文档撑出滚动条时不会因此少一截而来回闪），出现在“版心 + 页边宽 + 空 + 两侧最小留白”（1032px，版心取 `--markdown-measure`）、已画出的在窄于它 32px 时收起（迟滞）；常量在 `menus/comments/margin-layout.ts` 与本文件。画出来时滚动容器加 `padding-inline-end`（页边宽加空），版心自然居中在剩下的宽度里，左移半个页边宽；根上带 `data-comment-margin`，主题的两侧场景图据此不画。`marginDrawn` 算一份，下传给批注层（浮层据此不出，页边据此画）。句柄交出 `comments.count`（文档里批注的条数，每个事务现算），没有菜单层时不交出。

`state:local`：编辑器实例与当前绑定；控件宽度与页边画不画。`state:inject`：纸面排版（`markdownEditorOptionsKey`）、方言目录、资产地址与插图能力（`markdownMediaKey`，`nbook.markdown` 交出组件时提供）、表情目录（`markdownStickersKey`；单击正文里表情的图时控件自己开 nb-ui `ImagePreviewDialog`，[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 46）与诊断出口（`markdownReportKey`，节点视图里的失败经它记诊断），以及窗口的翻译端口（[`ui/i18n.md`](../../../../../../../docs/specs/ui/i18n.md)）：引用小块的悬停提示与图片的说明经它取，`markdownViewContext()` 把它带进节点视图里挂的图片，换语言时不重建编辑器：图片跟着端口重画，引用小块的悬停提示由控件重算一次。`env:timer`：输入后的结算延迟与记下光标的延迟，卸载与结算时清除。

## 不支持

“全部批注”的侧栏列表（页边打开时页边就是总览）、Agent 与 AI 引用、工作区引用标签。
