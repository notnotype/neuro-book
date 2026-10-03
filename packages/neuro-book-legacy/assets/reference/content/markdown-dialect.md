# NeuroBook Markdown Dialect

本文档写给 Agent 和作者。它定义 NeuroBook 中 Markdown 正文可以使用的扩展格式，以及这些格式与文件工具路径、内容节点引用的边界。

## Scope

适用范围：

- `manuscript/**/index.md` 正文。
- `lorebook/**/index.md` 的说明正文。
- 草稿、批注、审稿文件和可被 Markdown Studio 打开的普通 Markdown 文件。
- Agent 在回复中给出的可粘贴正文片段。

不适用范围：

- 工具调用路径。
- `writer` 的 `invoke_agent.input.path`、`invoke_agent.input.context`、`create_agent.initial` 等结构化参数。
- Plot / SQL / variable tool 的 JSON 参数。

工具调用和结构化参数必须继续使用对应工具要求的路径格式；不要把正文内部 Markdown 链接当成工具路径。

## Workspace Links

正文内部 Markdown link 支持三种 workspace 路径形态，推荐顺序如下：

```md
主角在 [荒野祭坛](lorebook/location/initial-stage/) 醒来。
主角在 [荒野祭坛](../../lorebook/location/initial-stage/) 醒来。
主角在 [荒野祭坛](C:/absolute/path/to/project/lorebook/location/initial-stage/) 醒来。
```

规则：

- 推荐使用 Project-relative path，例如 `lorebook/character/foo/`、`manual/reference.md`。这类路径从当前 Project Workspace root 解析，不带 `workspace/<project>/` 前缀。
- 兼容相对当前 Markdown 文件的路径，例如 `../../lorebook/character/foo/`。这类路径从当前 Markdown 文件所在目录解析。
- 支持当前 Project Workspace 内的绝对文件系统路径，例如 `C:/.../project/lorebook/character/foo/`，但不推荐用于长期正文，因为跨机器、跨 Project Root 和发布后容易失效。绝对路径仍必须落在当前 Project Workspace 内；POSIX 风格 `/...` 目前不会作为 workspace ref 进入校验。
- 内容节点链接指向目录并保留结尾 `/`，例如 `lorebook/character/foo/`。
- 普通文件链接指向具体文件名，例如 `notes.md`。
- 可以链接计划或执行记录等普通 Markdown 文件，例如 `[实施计划](.agent/thread-id/plan.md)`。
- `http:`、`https:`、`mailto:`、`tel:`、`#` 和其他 scheme 按普通链接或非工作区引用处理。

正文内部链接和工具路径不同：

| Context | Path Form |
| --- | --- |
| 正文内部 Markdown link | 推荐 Project-relative，例如 `lorebook/character/foo/`；也支持相对当前 Markdown 文件或绝对路径 |
| Project-bound Agent 文件工具 / bash | 当前Project Workspace相对，例如 `lorebook/character/foo/` |
| `writer` payload `context.lorebookEntries` | 当前Project Workspace相对内容节点路径，例如 `lorebook/character/foo/` |
| Plot tool `projectPath` | Project Path，例如 `workspace/project-slug` |

正文内部推荐的Project-relative链接与Project-bound Agent File Scope使用同一相对路径。跨Project文件访问仍必须使用完整`workspace/<project-slug>/<relative-path>`地址。

## Comment

批注统一使用 `<comment>` 标签，一个标签两种形态。

行内批注（开闭标签在同一段落内闭合）：

```md
她抬头<comment body="这里节奏太快">看了他一眼</comment>。
```

块级批注（开标签独占一行、闭标签独立成行，中间可跨任意多个段落）：

```md
<comment body="整段视角混乱，需要重写">
老人走向祭坛。

风里带着灰烬的味道。
</comment>
```

可选 `id`：

```md
<comment id="draft:1" body="需要核对">原文</comment>
```

形态规则：

- 批注单段内的局部文本：用行内形态，开闭标签必须在同一段落内闭合。
- 批注跨越多个段落：必须用块级形态，开标签后紧跟换行、闭标签独立成行；行内形态跨段落会解析失败。
- 旧语法 `<inline-comment>` 仍可读取，等价于行内 `<comment>`；编辑器保存时统一改写为 `<comment>`。新内容一律写 `<comment>`。
- 宽容形态：开标签黏在正文后但紧跟换行（`正文<comment>␊…␊</comment>`）的写法，编辑器读入时会自动拆段规范化为标准块级形态（见「宽容形态与规范化」），保存写回标准形态。生成时仍应直接写标准形态。

使用原则：

- 只在批注已有草稿、指出需要用户确认、核对或后续处理的文本时使用。
- 正式小说正文不要主动塞 comment，除非用户明确要求保留写作批注、审稿意见或待确认标记。
- `body` 应短而具体，不承载长篇分析；长分析放在回复、报告或单独说明文件中。

## Ruby Annotation

注音 / 词语级标注，`text` 属性承载标注文本，渲染为正文上方的小字（浏览器原生 ruby 排版）：

```md
远处站着<ruby text="hàn zì">汉字</ruby>先生。
```

适合拼音、假名、术语原文、短译文等词语级双语标注。标准 HTML 形式 `<ruby>汉字<rt>hàn zì</rt></ruby>` 可以读取，但保存会统一改写为属性式；生成时一律写属性式。标注内的正文保持纯文本，不要在 ruby 内部嵌套其他格式标签。

## Bilingual Block

段落级双语对照，`text` 属性承载对照译文，渲染为原文上方的弱色对照行（行间对照）：

```md
<bilingual text="老人缓缓走向祭坛。">
The old man walked toward the altar.
</bilingual>
```

结构规则与块级 comment 相同：开标签独占一行、闭标签独立成行。适合整段翻译对照阅读；词语级对照用 ruby。

## HTML Embed

需要真正渲染的自定义 HTML 使用显式 `<html>` 块（开闭标签独立成行，结构规则同块级 comment）：

```md
<html>
<div class="card">状态面板</div>
<script>console.log("允许脚本")</script>
</html>
```

行为：

- 编辑器中默认显示源码卡片，用户点击「渲染」后才在沙箱 iframe 中渲染。
- 脚本允许执行，但运行在隔离源中：拿不到 NeuroBook 页面、cookie 和存储，直接 fetch 站内接口会被拒绝。
- 与宿主交互的唯一通道是 `window.nbook.request(type, payload)`（宿主数据接口，当前默认未开放，调用会被拒绝）。
- 这是唯一具备渲染能力的 HTML 语法；只有用户明确要求嵌入可渲染 HTML 时才使用。

## Raw HTML

`<html>` 之外的未知 HTML / XML 标签不会丢失，但也不会渲染：

- 块级未知标签（标签独占行的完整片段，内容可跨空行）保留为源码块原样显示。
- 行内未知标签原样保留为源码 chip。
- 失配残片（无闭合的开标签、孤立的闭标签、正文里的伪标签如 `Vec<String>`）退化为单标签 chip，同样不会丢数据。
- `<br>` 等已知行内标签独占一行时按行内语义还原（如硬换行），不会变成源码块。

注意：

- 未闭合的标签会按 Markdown 原生规则截断到空行，尽量写完整闭合的片段。
- 不要用自定义标签表达本方言已有的语义（批注用 comment、对齐用 align、标注用 ruby、可渲染嵌入用 html）。

## 宽容形态与规范化

块级方言标签（comment / bilingual / align / html）要求开标签独占一行，但「开标签黏在正文后、紧跟换行」是人和 AI 都容易写出的形态。编辑器读入内容时（打开文件、外部同步、粘贴）会自动把这种形态拆段规范化：

```md
正文段落<comment>
批注内容
</comment>
```

读入后等价于（保存也写回此形态）：

```md
正文段落

<comment>
批注内容
</comment>
```

规范化只在同时满足以下条件时发生：开标签紧跟行尾、向下存在独立成行的配对闭标签、不在 fenced code / 缩进代码块内、开标签前有真实正文（引用 `>` 或列表标记后的开标签已是合法嵌套形态，不动）。不满足条件的残片交由 Raw HTML 兜底保数据。AI 流式写入与源码模式（Monaco）不做规范化。

## Mark Highlight

高亮：

```md
<mark>文本</mark>
<mark style="background-color: #fce7f3">文本</mark>
```

使用原则：

- 无特殊颜色要求时优先使用无 `style` 的 `<mark>`。
- 需要色彩语义时使用安全、清晰的背景色。
- 不要用高亮表达稳定设定关系；稳定关系用内容节点正文、frontmatter refs 或 Plot System 表达。

## Text Color

文本颜色：

```md
<span style="color: #ef4444">文本</span>
```

使用原则：

- 只用于明确需要视觉区分的局部文本。
- 不要把颜色当作唯一语义来源；必要语义仍应写入文字。

## Superscript And Subscript

上标和下标：

```md
<sup>上标</sup>
<sub>下标</sub>
```

适合公式、注记、术语标号和特殊排版。

## Alignment

对齐块：

```md
<align value="center">...</align>
```

`value` 支持：

- `center`
- `right`
- `justify`

左对齐保持普通 Markdown 即可。

## Agent Rules

Agent 生成或修改 Markdown 时：

- 正文内部引用优先使用 Project-relative 链接；相对当前文件路径和绝对路径仅作为兼容形态。工具调用路径仍使用工具要求的 cwd-relative 或 Project Path。
- 内容节点链接指向目录并保留 `/`。
- 不要把 Markdown 扩展标签写进 frontmatter 字段名或工具 JSON。
- 不要为了展示功能而使用扩展格式；只有用户目标、正文需要或审稿需要时才使用。
- 修改已有 Markdown 时，尽量保留原有链接和扩展标签，不要无关重写。
