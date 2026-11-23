# t28 实施计划：条目主文字的编辑器（一个解析器、暂存加提交）

2026-11-23 主会话起草，待开发者确认；确认后写 Spec 草稿、交设计审查（后端与计划 omp，前端 Sonnet，另开一份只拿目标的独立设计对照），再实现。

## 1. Context

**为什么做。** 开发者 2026-11-23 看过写入底座后说“整个界面都是属于一种不可用的状态，就是用户不知道怎么用”，定了接下来的路径：先让“世界引擎能像文件系统一样记录东西”（最基础的条目加主文字的编辑器），再做人物设定组。现在主文字要点“改这一段”、在对话框里改 Markdown 源文字。

**开发者已确认的决定**（Work README 决定表 2026-11-23）：

1. 主文字的编辑器与章节用同一个富文本编辑器。
2. 解析器只留一个：扩展章节编辑器现有的解析器，内核也改用它；作者与 AI 的写法不变；另写 ADR 部分取代 0038 决策 1。
3. 保存：编辑中的内容自动暂存（刷新、关窗口都不丢，不进改动记录，Agent 读不到）；作者点“提交”才发布成一条修订；有没提交的内容时页面上有“提交”“放弃”、标签上有圆点；Ctrl+S 等于提交；暂存期间条目被别处改了，提交时告诉作者，由作者决定是否以自己的为准。
4. 在编辑器里直接打字都算改设定；“这段文字在剧情里变了”的入口收进每一块的菜单。
5. 分组先不变成真的文件夹。

**依据。** [ADR 0038](../../../../../docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md)；[`canon/rendering.md`](../../../../../docs/specs/canon/rendering.md)、[`canon/revisions.md`](../../../../../docs/specs/canon/revisions.md) 输出 8、25、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md) 输出 9、10、39；[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md)（不编辑不改字节、按块写回、写回必须读得回来）；[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 33、53；[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)。探针：[`evidences/parser-probe.txt`](evidences/parser-probe.txt)。

**范围。** 本 Task 只做解析器、编辑器与暂存提交。条目树像文件树一样用（就地新建、改名、菜单补全、拖动）拆成紧接着的下一个 Task，见第 8 节。

## 2. 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 条目主文字的解析 | nb-markdown 的词法（marked 17，仓库已有）加三条分词规则 | 开发者定。否决：留着 micromark 加 mdxjs 另做对照测试（分歧只能靠样本发现）；让编辑器改接 mdxjs（等于再写一套读入，内核那条解析链在浏览器开发模式下也加载不了） |
| 表达式的语法树 | acorn 的 `parseExpressionAt`（nb-canon 已依赖） | 现在是 mdxjs 间接调 acorn，节点形状不变，白名单检查照用 |
| 标签属性的解析 | 手写，只认 `<Ref id />`、`<Image src alt />` 两个自闭合标签 | 两个标签、三个属性，值只有字符串字面量与表达式；不为它引 acorn-jsx |
| 富文本编辑器 | nb-markdown 的 Tiptap 扩展组与编解码器 | 开发者定；章节在用 |
| 暂存放哪 | 插件的项目记录（`storage.persistence`，`scope: project`、按条目 id 分键） | 页面标签的状态刷新后不保留（`editor/web/pages.ts`）；浏览器本地存储不跟着作品走 |
| 整篇文字拆成块的增删改 | 内核里按块的原文做最长公共子序列对比（自写，几十行） | 输入是几十到几百块的字符串数组，不为它引 diff 库；nb-ui 里的 `diff` 是给界面比文字用的，内核不依赖 nb-ui |

## 3. 关键设计

### 3.1 一份共用的文法：`packages/nb-markdown`（新入口 `./grammar`）与 `packages/nb-canon/src/text/`

要守住的不变量：**编辑器读入与内核解析用同一组分词规则、同一个切块函数**，由测试逐样本核对两边的词法单元序列相同。

- nb-markdown 加不带 Tiptap 的入口 `./grammar`（只依赖 marked、marked-cjk-friendly、entities）：
  - 核心语法传给 marked 的三条扩展（`markedCjkFriendly()`、`doubleTildeOnly`、`htmlInline`，现在在 `syntax/core/index.ts` 里，那个文件顶层就引 Tiptap）与“原样”语法的分词规则（`syntax/raw/index.ts`）各挪到不引 Tiptap 的文件，原模块改从那里取。只挪位置，行为不变，现有编解码测试兜底。
  - 交出建词法器的函数（`createMarkdownLanguage` 里 `new Marked({gfm: true})` 与按相反顺序 `use` 的那一段，语言自己也改用它）与切块用的 `normalize`、`segment`（`codec/source.ts`）。
  - `MarkdownSyntax` 加两处口子：语法自己的正文转义规则（现在 `codec/render/escape.ts` 把表情的冒号写死在编解码器里；条目的语言要把文字里的 `{` 写成 `\{`）；语言可以声明“没有 frontmatter”（现在读入时无条件拆开头的 `---` 块，条目里开头的分割线会被当成 frontmatter）。
- nb-canon 新模块 `src/text/`，经新子路径 `./text` 导出（浏览器可引，应用的 `architecture.test.ts` 在 `./schema` 之外放行它）：
  - `grammar.ts`：三条分词规则（行内的 `{表达式}`，花括号按 JS 的词法配平；行内与单独成块的 `<Ref … />`、`<Image … />`），条目文字的词法器（经 `./grammar` 用“这三条加核心加原样”建），标签属性的解析。
  - `sites.ts`：一块原文 → 表达式、条目引用、图片各自的起止偏移。marked 不给位置：按词法单元的叶子顺序在原文里往后定位（探针已验证；嵌套列表里那一个没对上的叶子在 S1 查清，查不清就改成分词时记下偏移）。
  - `split.ts`：整段文字 → 块（顶层单元的原文切片，不含块间的空行）。

### 3.2 内核换解析器：`packages/nb-canon/src/render/`

- `syntax.ts`：`parseUncached` 改用 `text/sites`；`ParsedBlock` 去掉 mdast 的 `tree`。表达式的白名单检查（`check`、`memberReference`）不动。失败码的名字不改（`mdx-invalid`、`forbidden-syntax`、`unknown-tag`、`no-field-expression`、`cross-block`）：
  - 没配平的 `{`、表达式内容 acorn 解析不了：`mdx-invalid`；
  - 编辑器会读成“原样 HTML”的标签（`Ref`、`Image` 以外的）：`unknown-tag`；
  - `import`、`export` 开头的行不再有特殊含义，按普通文字（不执行代码，没有安全上的差别）。
- `render.ts`：
  - `renderBlockPlain`（给写手简报）与 `renderBlockForAgent`（带值写法）本来就按偏移拼接，输入换成新的 `ParsedBlock`，**输出不该变**。
  - `renderBlockForAuthor` 现在返回换过节点的 mdast 树，只有界面的 `EntryText.vue` 在用。改成返回 `{id, source, parts}`：`parts` 是这一块里每处表达式、条目引用、图片按出现顺序的结果（地址、显示名、显示文字、未知与不完整的标记、条目当时的名字、图片路径与说明），编辑器按顺序贴到对应的节点上。
- `entry.ts`：`splitBlocks` 改用 `text/split`。
- `writeback.ts`（Agent 交回带值写法）只依赖表达式的位置，逻辑不动。
- 依赖：去掉 `micromark-extension-mdxjs`、`mdast-util-mdx`、`mdast-util-from-markdown`、`micromark-extension-cjk-friendly`、两个 gfm 的扩展；加 `@notnotype/nb-markdown`（只用 `./grammar`）。
- **先拍快照再换**：换之前用旧实现对一批样本（星瑕样本全部条目的主文字、`tests/rendering.test.ts` 里的源文、边角写法）导出每块的表达式与标签位置、纯文字、带值写法、切块结果，存成测试夹具；新实现逐字对照。有意不同的几处（缩进代码块、原样 HTML、`import` 行）单列断言并写进 Spec。

### 3.3 整篇主文字的写法：`packages/nb-canon/src/world/entry-edits.ts`

`editEntries` 加一项操作 `{op: "text", entry, value}`：把这个条目在读取位置上的主文字整篇换成 `value`。

- 内核切块，把新旧两边都摊成顶层单元后按原文对比，合成现有的三种操作：`set text[块 id]`、`addBlock`（带插在哪一块之后）、`removeBlock`。一个旧块的几个单元都没动就不碰它；没动过的块 id 不变。
- 合成出来的操作照现有规则路由与校验（改设定写回给出这段文字的记录，来自剧情变更的块按“改设定”去掉时照旧拒收并说明），整批一条修订。
- 同一批里对同一个条目另有 `text[…]`、`addBlock`、`removeBlock` 时拒收（`duplicate-address`）。没有差别时这一项不产生操作。
- 远程合同不加方法（`editEntries` 的输入多一种操作）。给 Agent 的 `canon_write` 这次不加这一项（Agent 这条线暂缓）。

### 3.4 条目主文字的语言与编辑组件

- **语言**（`packages/neuro-book/src/plugins/canon/web/text-language/`）：`createMarkdownLanguage([条目语法, coreSyntax])`，不带章节方言。条目语法给三种原子节点（表达式、条目引用、图片标签），原文记在节点上、原样写回（照 `syntax/sticker/index.ts` 的做法）；分词规则从 nb-canon 的 `./text` 取，不另写一份。节点视图显示内核给的 `parts`：值是可以点开来历的小块，条目引用显示当时的名字、点了打开那个条目，图片显示图。
- **可嵌入的编辑组件**：章节的控件 `MarkdownControl.vue` 绑的是文件文档（`TextEditorBinding`），里面混着 frontmatter 面板、大纲、批注栏；工具栏与菜单在 markdown 插件内部，别的插件按规则只能经它的合同取。markdown 插件的合同（`shared/contracts.ts` 的 `MarkdownComponents`）多交一个“给别的插件嵌入用的富文本编辑组件”：收文字、语言、只读、标签、图片的基准地址，交回改过的文字与写不出的原因；内部复用同一套编辑器、工具栏、斜杠菜单与选区菜单，文件专属的部分不出，工具栏只列这份语言支持的动作。
  - 这一片先做探查：用假的绑定与条目语言把现有控件挂起来，列出哪些地方假定了章节方言或文件地址。改动量超出“加开关”的范围时，改为在 canon 里用 nb-markdown 的公开接口（`createMarkdownEditorExtensions`、`codecFor`）另拼一个只有基本工具栏的控件，并告诉开发者。
- **“看源文字”开关**：同一份暂存文字换成等宽的纯文本框编辑，切回来重新读入。给要手写表达式、或要改“原样块”的人用（原样块在富文本里不能打字）。

### 3.5 文字分页：`packages/neuro-book/src/plugins/canon/web/`

- 新组件 `EntryTextEditor.vue` 取代 `EntryText.vue` 与“改这一段”“加一段”“删掉这一段”的对话框流程。读取位置上的各块用空行连成整篇交给编辑器；`parts` 来自 `render`。
- **暂存**（新的组合式函数，经 `storageKey`）：记录 `canon.text-drafts`，`scope: project`，按条目 id 分键，值是 `{text, base: {version, position, blocks: [{id, source}]}}`，单条上限取存储允许的最大值 1 MiB，超了就不暂存并在页面上说明。编辑器交出文字后停一会儿写暂存；提交成功或放弃时删掉。
- **提交**：`editEntries` 一项 `text`，带暂存里记的版本。条目在这之后被别处改过时内核拒收（`version-conflict`），页面写“这个条目在你编辑期间被别处改过”，给“放弃我的修改”与“以我的为准提交”（后者带当前版本再发一次）。
- **世界变了**：没有暂存时编辑器按新的文字重载（编解码器的 `reload`，没变的块不动、光标不跳）；有暂存时不动编辑器，只出上面那句提示。
- **只读**：世界只读、别人独占写入、断开、条目已删除、“按计划”开着时，编辑器只读，写入入口照 `author-ui.md` 输出 28 说明原因。
- **剧情里变了**：每一块的菜单里“这一段在剧情里变了……”，打开现有的对话框（只留剧情这一种意图），照现在的写法发 `set text[块 id]`、`addBlock`、`removeBlock`。有暂存没提交时这个入口不可用。
- 页面状态里“在改哪一块”的那部分随对话框流程一起去掉。

### 3.6 页面标签的未提交圆点与保存：`packages/neuro-book/src/plugins/editor/`

现在页面标签不算 dirty、接不住保存命令（`workbench/editor.md` 输出 33）。给页面的上下文（`EditorPageContext`）加两样：页面可以报告“有没提交的内容”，标签据此画圆点；页面可以登记保存的处理函数，活动标签是页面时 `nbook.editor.save`（Ctrl+S）交给它。不加关闭与离开时的确认：内容已经暂存，关掉再开还在。

## 4. Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `docs/adr/`（新，下一个空号） | 条目主文字与章节共用一个解析器，写法不变；部分取代 0038 决策 1 与决策 4；0038 在索引里补注 |
| `docs/specs/canon/rendering.md` | 白名单与解析的说法从“MDX”改成“Markdown 加表达式与两个标签，用与章节相同的解析器”；输出 1 的失败情形；输出 3 切块；输出 7 给作者的渲染改成按块的 `parts`；与旧解析有意不同的几处；实现合同 |
| `docs/specs/canon/revisions.md` | 输出 25 加 `text` 一项 |
| `docs/specs/canon/author-ui.md` | 输出 10、39 改写（文字分页是编辑器、块的菜单）；新条目：暂存、提交与放弃、别处改过、看源文字；验收场景 |
| `docs/specs/workbench/editor.md` | 输出 33、53：页面可以报告未提交、接保存 |
| `docs/specs/workspace/markdown-dialect.md`、`markdown-syntaxes.md` | 语法自己的转义规则、没有 frontmatter 的语言、`./grammar` 入口（实现合同） |
| `docs/modules/monorepo-boundaries.md` | nb-canon 的依赖与 `./text` 子路径；nb-markdown 的 `./grammar` |
| `EntryTextEditor.md`（新）、`EntryText.md`（删）、`EntryPageHost.md` | 组件文档 |

新行为先标 planned。

## 5. 切片

每片单独提交，自跑各自的验证。

| 片 | 做什么 | 对应 | 自跑验证 |
|---|---|---|---|
| S0 | ADR 与 Spec 草稿 | 第 4 节 | `bun run docs:check` |
| S1 | 旧实现的对照快照；nb-markdown 的 `./grammar`（只挪位置） | 3.1、3.2 | nb-canon 的快照测试生成并通过旧实现；nb-markdown 的 `codec` 测试全过 |
| S2 | nb-canon 的 `src/text/` 与内核换解析器，去掉旧依赖 | 3.1、3.2 | nb-canon 全量；快照逐字对照；`plot` 的简报测试；两边词法单元序列相同的测试；应用的 `architecture.test.ts` |
| S3 | `text` 操作 | 3.3 | `entry-edits` 的测试（没动的块 id 不变、一个块几个单元、来自变更的块、与别的文字操作同批拒收）；经真实服务的一条 |
| S4 | 条目主文字的语言；nb-markdown 的两处口子 | 3.1、3.4 | 语料往返（读入再写出逐字节相同，写出的内核接受，两边切块相同）；打字后写出的转义；dom 测试 |
| S5 | markdown 插件交出可嵌入的编辑组件（先探查） | 3.4 | 组件的 dom 测试；章节编辑器的 e2e 两个文件不回归 |
| S6 | 页面标签的未提交圆点与保存 | 3.6 | editor 插件的测试；`workbench-editor` 相关 e2e 一个文件 |
| S7 | 文字分页：编辑器、暂存、提交、冲突、源文字开关、只读、剧情入口；删旧组件 | 3.5 | canon 的 vitest；Lab 场景逐个状态看过渡 |
| S8 | e2e 与收口：`canon-write` 的作者用例改成直接打字，新加暂存与冲突两条；截图；实现审查；合入 | 第 6、7 节 | 见第 7 节 |

## 6. 验收映射

Spec 的新条目在 S0 定编号，这里先列行为与由谁覆盖；S0 之后把编号补上。

| 行为 | 覆盖 |
|---|---|
| 换解析器以后纯文字、带值写法、切块不变 | nb-canon 的对照快照（S1、S2） |
| 有意不同的几处（缩进代码块、原样 HTML、`import` 行） | nb-canon `rendering.test.ts` 新断言 |
| 编辑器与内核用同一份分词规则 | 逐样本比两边的词法单元序列（S2、S4） |
| 没编辑的块逐字节不变、块 id 不变 | 语言的语料往返（S4）；`text` 操作的测试（S3） |
| 文字里打出的 `{`、`<Ref` 读回来还是文字 | S4 的写出测试 |
| 直接打字、暂存、刷新后还在、提交成一条修订 | e2e `canon-write`（S8） |
| 暂存期间别处改了：提示、放弃、以我的为准 | canon 的 vitest（真实世界里另一处写入）；e2e 一条 |
| 标签的圆点、Ctrl+S 提交 | editor 插件测试；e2e 断言 |
| 值的小块点开来历、条目引用打开条目 | canon 的 vitest |
| 只读的几种情形 | canon 的 vitest |
| 看源文字的开关 | canon 的 vitest |

## 7. 验证

- 各片的快速测试见第 5 节；收口跑 nb-canon、nb-markdown 全量，应用里 canon、plot、markdown、editor 四个插件的 `bun test` 与 vitest，类型检查。
- e2e（先 `bun run build` 与 `bun run build:e2e`）：`canon-write`、`canon-author`、`plot-author`，加章节编辑器的两个文件（S5 动了它的控件）。不超过 8 个文件。
- 真实浏览器里亲手走一遍并截图：空作品新建条目、直接打字、插入一个条目引用、刷新、提交、看改动记录；星瑕样本里带表达式的条目打开、改一段、提交。
- 没验证的边界：三百万字的书上换解析器以后的渲染速度只跑现有的性能脚本对比，不另做大书实测；真实模型不涉及。

## 8. 不做与风险

**不做：**

- 条目树像文件树一样用（就地新建与改名、右键菜单补全、常驻的新建入口、拖动移动）：拆成紧接着的下一个 Task。nb-ui 的 `Tree` 现在没有行内输入、行尾按钮与拖放，资源管理器的那套写在它自己的插件里、类型带着文件专属的字段，要先给 `Tree` 加能力。
- 欢迎页上的设定入口：欢迎页是 `nbook.projects` 的，没有贡献点，另议。
- 给 Agent 的整篇主文字写法、表达式的补全与字段选择器（等人物设定组有了字段再做）、表格之外的新版式。
- 分组变成真的文件夹。

**风险：**

| 风险 | 怎么兜 |
|---|---|
| 换解析器让已有的文字读出不同的结果 | S1 先拍快照，S2 逐字对照；过不了当前规则的旧块照 `rendering.md` 输出 4 显示成纯文本并带诊断，不丢数据 |
| marked 不给位置，表达式定位出错 | 探针里嵌套列表有一个叶子没对上（没影响表达式）；S1 查清，必要时改成分词时记偏移；快照里放嵌套列表、引用、表格的样本 |
| 章节的控件嵌不进来 | S5 先探查；退路是 canon 里另拼一个瘦的控件（3.4） |
| 动了 nb-markdown 与 markdown、editor 两个插件，别的会话也在改 | 只挪位置与加口子；每片先并 master 再动手；章节编辑器的 e2e 守着 |
| 暂存与世界不同步（暂存基于的块被别处改了） | 暂存记着基于的版本与各块原文，打开与提交时比对；提交由内核按当前的块重新对比 |
| 一次提交改动很多块时某一块不合规则 | 内核整批拒收并指出块、行、列；编辑器把光标带到那一块，暂存不丢 |

热路径：`parseBlock` 按源文缓存的做法不变；S2 换完当片重跑 nb-canon 现有的渲染与读取性能脚本，与换之前对比。
