# t02 实施计划：标签写法与共用解析器（第 4 稿）

## Context

条目主文字现在是白名单 MDX（micromark 加 mdxjs、acorn 解析表达式）：正文里写 `{panel.魔力}`、`{a >= 1 ? "x" : "y"}`，标签只有 `<Ref>`、`<Image>`；给 Agent 的渲染是 `{地址 = 值}` 这种可改的注记，Agent 交回时由 `writeBack` 扫注记拆成字段操作与文字操作。章节编辑器用的是另一套解析器（nb-markdown，marked）。富文本编辑器要建在 nb-markdown 上，两套解析器对同一段文字的读法不同（w00039 t39 的设计审查），所以先换内核。

开发者已定（[Work 的决定表](../../README.md#决定)，2026-11-23 到 11-26）：

1. 取值与条件换成标签：`<V of="panel.魔力" />`、`<V entry="e2" of="…" />`、计算值 `<V expr="…" />`、条件 `<If test="…">…<ElseIf test="…" />…<Else />…</If>`；`test`、`expr` 是表达式（比较、与或非、三元式、四则运算与 `%`、负号、括号、`round`、`floor`、`ceil`、`min`、`max`、`abs`、`percent`，`ref('id').命名空间.字段`），只解释不执行，三值逻辑照旧。
2. 解析器只留 marked，内核与编辑器共用。
3. 给 Agent 读主文字时带值、只给看（`<V of="panel.魔力">1200</V>`，值写成 JSON）；Agent 不在文字里改值，交回时程序去掉值。
4. 插件可以登记展示用的标签，没装对应插件时原样保留（登记表在 t04 做，本 Task 只留规则）。
5. 已有的 `{}` 要迁移。

本 Task 是 Work 的第一段，做完以后：内核与 Agent 用新写法；阅读视图、源文字编辑、预览照旧能用（换成新的渲染合同）；富文本编辑器、标签登记表、设定组分页改成默认模板在后面的 Task（见文末“后续 Task”）。

依据：[`canon/rendering.md`](../../../../../docs/specs/canon/rendering.md)、[ADR 0038](../../../../../docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md)、[t38 的难点](../../../w00039-novel-writing-plugins/tasks/t38-kernel-shared-parser/README.md#来由与已知的难点)、[11-24 的讨论](../../../w00039-novel-writing-plugins/research/2026-11-24-entry-text-direction.md)、[t01 的评测与演示](../t01-demos/README.md)、本 Task 的[独立设计](evidences/independent-design.txt)（Opus，只拿到目标，用真实的 marked 17 与 nb-markdown 的 core 配置做了实验）、[调研摘要](evidences/survey.txt)（谁在用主文字、要换写法的文件清单）、[编解码器对照](evidences/codec-probe.txt)（编辑器的读写与直接用 marked 差在哪；浏览器加载 acorn 与 marked 的实测）。

工作方式：一个 Work 分支 `w00055-entry-rich-text`、worktree `.worktree/w00055-entry-rich-text`，本 Task 的切片都在上面，收口后合入 master（不等后面的 Task）。主会话写业务代码与纯逻辑测试；测试数据的批量换写法（规则写死、转换器兜底）派 Haiku；审查见“验证”。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| Markdown 词法 | marked 17 与 nb-markdown core 的配置（已有依赖） | 开发者定的“只留 marked”；不再用 micromark 链（迁移完删掉） |
| 表达式解析 | acorn（已有依赖）加节点白名单 | 稳定的库，现有的白名单与求值直接扩；否决手写 Pratt 解析器（只在浏览器体积成问题时再考虑，acorn 压缩后约 34 KB） |
| 标签与属性的词法 | 自写一个小的标签词法（`<大写名 名="值" …>`） | 规则窄（只认双引号、不跨行、区分大小写）；nb-markdown 的 `parseAttributes` 会改小写、解码实体、收单引号，与约定不同 |
| 标签在原文里的位置 | 先遮罩再分词（独立设计的做法） | 见“关键设计”第 2 节；否决按词法单元的 `raw` 回搜（列表、引用去了前缀，表格按 `|` 切开标签，实验里静默丢内容） |
| 随机对照与往返 | fast-check（nb-markdown 已有的开发依赖） | 性质测试：标签不丢、往返逐字相同 |

## 关键设计

### 1. `packages/nb-markdown`：拆出纯的 marked 配置，加“原子”钩子

- 新文件 `src/marked/`（纯 TS，只引 `marked`、`marked-cjk-friendly`、`entities` 与已是纯 TS 的 `language/syntax/tags.ts`、`markdown-dialect.ts`）：core 的三个 marked 扩展（`markedCjkFriendly()`、`doubleTildeOnly`、`htmlInline`）、原样语法的 marked 扩展、建 `Marked` 实例与词法器的函数，以及遮罩流程 `lexWithAtoms(marked, source, atoms)`。新子路径 `./marked` 导出它们。
- `language/syntax/core/index.ts`、`raw/index.ts`、`language.ts` 改成从 `src/marked/` 引同一份对象（只有一个所有者，不分叉）。
- `MarkdownSyntax` 加可选字段 `atoms`：在原文上从左到右找出互不重叠的“原子”，返回 `{from, to}[]`。`createMarkdownLanguage` 的词法器先遮罩、分词、再还原；遮罩结果与原文不等长就抛出（失败关闭）。原子表挂在每个词法器实例上，随 `lex()` 进入时设、结束时清，模块的分词规则经 `this.lexer` 用导出的 `atomAt(lexer, 占位)` 查回原文与序号；一次分词进行中另起的分词（写回校验、注释语法的 `tools.lex`）各有各的表。没有 `atoms` 的语言行为逐字不变。
- `MarkdownSyntax` 加可选的转义规则：写回文字时，文字里会被本模块认成原子开头的写法（条目语法：`<` 紧跟大写字母）前面加 `\`；接进 `codec/render/escape.ts` 的文字转义。这样编辑器写出的“评级 <A 级”是 `评级 \<A 级`，读回不变、内核放行（设计审查第 1 条）。
- `createMarkdownLanguage` 加选项“不读 frontmatter”：条目语言打开它，开头的 `---…---` 照 Markdown 读（与内核相同），不拆成文件头（设计审查第 11 条）。
- `./marked` 导出“块级 html 单元是不是只有换行”的判断，core 的读法与内核的写入检查共用（设计审查第 7 条）。
- `./marked` 导出 `lexAtoms(lexing, source)`：分词并交回每个原子落在哪（所在的词法单元、字段与外层单元，在还原之前找）；原子多于上限时交回没遮罩与个数，内核据此报 `too-many-tags`。
- 词法器的每个入口都遮罩（omp 设计审查第 2 条）：编解码器的读法在顶层 `lex()` 之后还会对一部分文字调 `blockTokens`、`inlineTokens`，那时原子表已清。不在遮罩的分词里时，这两个入口也先遮罩、分完还原。核心语法的表格读法与写法若按还原后的文字数 `|`、转义原子里的 `|`，一并改（omp 第 4 条），由 S3 的编解码器对照发现。
- `src/boundary.test.ts` 加一条：`./marked` 运行时只许引 `marked`、`marked-cjk-friendly`、`entities` 与纯文件。
- Spec：`workspace/markdown-syntaxes.md` 补 `atoms` 的合同。

### 2. `packages/nb-canon/src/grammar/`（新的纯子路径 `./grammar`）：条目文法

浏览器与后端都引它（编辑器、阅读视图、内核）。只依赖 `@notnotype/nb-markdown/marked`、`marked`、`acorn`。

- **标签词法** `lexTags(source)`：从左到右扫描，候选是 `<` 或 `</` 加大写开头的名字、后面紧跟空白、`/` 或 `>`（`Map<K, V>` 的 `<K,` 不是候选）；`B`、`BR`、`EM`、`I`、`DEL`、`S`、`STRONG`（不分大小写）不是候选（core 读成 HTML 的强调与换行）。认出一个完整的标签后从它的结尾接着扫，属性值里的 `<` 不另算。属性只认 `名="值"`，值里没有 `"` 与换行，标签不跨行。不完整的候选只占 `<名` 那几个字、之后从名字后面接着扫；名字是内置或登记的标签名、后面跟着 `名="` 的算写坏的标签（`tag-malformed`，代码里与转义的除外，纯文字报 `syntax`），别的是文字。原文里 Unicode 私用区的字也作为原子（这样不用拒收它们）。词法与登记表无关：凡是大写名都认，解析结果可以按源文缓存；判“写坏的标签”时才用登记表。
- **遮罩**：每个原子换成等长的哨兵（标签用 `<`、私用区的身份字、`>`；私用区的字用一个身份字），交给 marked；候选与私用区的字合计超过 6000 个时拒收（`too-many-tags`）。
- **预处理**：写入前去掉开头的 BOM、把换行规范成 LF。frontmatter 由编辑器那一侧关掉（条目语言不读 frontmatter，见第 1 节），内核不拆（[编解码器对照](evidences/codec-probe.txt)里开头 `---…---` 的那一例）。
- **marked 扩展**：行内的 `entryTag` 把每个完整的标签（自闭合、开、闭、带内容的）认成一个叶子单元。分完以后在同一层的兄弟单元里配对 `If`、`ElseIf`、`Else` 与 `</If>`，换成一个 `entryIf` 单元（omp 设计审查第 3 条：转义的、代码里的闭标签不成单元，不会被当成配对；被强调或链接切开的分支标记落在别的层，按 `cross-block` 报）。套在 `If` 里的 `If` 拒收（`cross-block`）。块级的 If（各分支独占几行）这一版不做，跨段的 If 拒收。
- **分类** `classify(tokens)`：每个标签一个去处：活的、代码里与转义的字面、链接地址与标题、图片说明、原样 HTML、孤立的 `Else`、没闭合的 `If`。不变量：每个标签要么恰好一次是活的，要么都是字面；不满足按结构错误报行列。
- **还原**：哨兵逐字换回原文。
- **表达式** `parseExpression(attributeValue)`：acorn 的 `parseExpressionAt`；用 `onComment` 收注释，有注释即 `forbidden-syntax`；去掉首尾空白后要求表达式从 0 读到末尾；`LogicalExpression` 只放 `&&`、`||`（不放 `??`），`BinaryExpression` 按运算符核对（设计审查第 15 条）。节点表在现有 `check`、`memberReference` 上加 `+ - * / %`、任意操作数的负号、7 个函数名（只在调用的位置认，不进 `RESERVED_ROOTS`：同名的命名空间照旧可用，omp 第 16 条）。求值 `evaluate` 从 `render/render.ts` 挪过来扩写：函数与运算按三值逻辑（任一参数未知结果未知，除以 0、`% 0` 与 `percent` 的整体为 0 时未知，结果不是有限数时未知，`round` 的位数只收整数字面量；数的字面量要有限，omp 第 20 条）；运算结果按 15 位有效数字去掉二进制的尾差（只用于显示与比较，不存）。错误的列是属性值在原文里的起点加 acorn 给的位置。
- **地址**：`of="att.态度[e1].称呼"` 沿用 `core/address.ts` 的 `parsePath`。
- **编辑器侧的条目语法模块**（最小版，在 canon 插件 `web/entry-syntax.ts`）：`atoms` 用 `lexTags`，分词用上面两条扩展（经 `atomAt` 查回原文），转义规则是“`<` 紧跟大写字母”，读成 Tiptap 的原子节点、按原文写回。t03 在它上面加小块的样子与改法。它在本 Task 的用处是对照：同一份语料经 `codecFor(...).read` 读出的条目节点及其落点，与内核的分类逐个相同；`codec.write` 原样与整篇重写写出的文字都能过内核的写入检查。
- **装饰的值**：程序生成的属性值与登记标签的描述里，`&`、`"`、`<`、`>` 写成实体、换行写成空格（名字、显示名、原因来自作者的数据；设计审查第 3 条）；`V` 的值是 JSON，`<` 写成 `\u003c`。去值整段丢掉它们，不用解码。
- **给 Agent 的文字与去值** `stripAgentText(text)`：带值的 `V` 换回自闭合并去掉 `label`、`incomplete`、`unavailable`；`If`、`ElseIf` 去掉 `value`；`Ref` 去掉 `name`；`Image` 去掉 `path`；登记的标签去掉开闭之间的描述；只动活的标签。写入前把活的标签规范成 `<名 属性="…" />`（属性顺序不变、单个空格），所以“去值(带值渲染(源文)) 等于源文”逐字成立。

### 3. `packages/nb-canon/src/render/`：内核换上新文法

- `syntax.ts`：`parseBlock` 改成走 `grammar` 的流程，结果是词法单元加标签表（每个标签：序号、名字、属性、起止、去处、表达式与字段引用）。缓存按源文照旧；`parseDraft` 照旧不进缓存。
- **写入检查**（rendering 输出 1）：放行的词法单元是段落、标题、列表与任务项、引用、围栏与缩进代码、行内代码、分隔线、表格、粗体、斜体、`~~` 删除线、链接与图片、引用定义、转义、文字，以及条目标签。core 自己读写的 HTML 形式的强调与换行（`htmlMark`、`htmlBreak`，以及只有换行的块级 html 单元，用 `./marked` 的同一个判断）放行。别的原样 HTML、HTML 注释、脚注、数学拒收（新码 `unsupported-markdown`）；以后加进语言、不在名单里的单元也拒收。标签只查活的：`V` 要 `of`（可带 `entry`）或 `expr`，必须自闭合；`If`、`ElseIf` 要 `test`；`Ref` 要 `id`；`Image` 要 `src` 或 `of`，可带 `alt`；没登记的大写标签报 `unknown-tag`，例外是这个条目当前的主文字里（任一块）已经有规范写法相同的这个标签（卸了插件以后作者整篇提交、Agent 改别处都还能写；设计审查第 5 条）。程序加的属性（`label`、`incomplete`、`unavailable`、`value`、`name`、`path`）与带内容的 `V` 出现在源文里也报 `unknown-tag`：哪个入口漏了去值都写不进去。字面的标签落在链接地址、标题、图片说明里报 `tag-not-live`。旧的花括号写法不设防线（没有真实作品要迁，S5 断言样本与测试里没有残留；设计审查第 8 条）。
- **给作者的渲染**改成“源文加值表”：每块 `{id, source, values, error?}`，`values` 每项对应一个活的标签，按起点排，项里写标签名与起点（`If` 与各 `ElseIf` 各一项，`Else`、`</If>` 没有项；没生效的支里的标签照样有项、照样求值），前端按标签名与起点对上，对不上整块按出错显示并报诊断（设计审查第 2 条）：`V` 给地址、条目、显示名、原始值、显示文字、未知、不完整、读不到的原因；`If` 与 `ElseIf` 给判断结果与生效的分支（判断未知时作者看到“未知”）；`Ref` 给当时的名字与是否删了；`Image` 给路径与说明；没登记的标签给“需要插件”。前端用同一份文法读源文。不再给语法树（树是 marked 的词法单元，不是稳定的合同，也是源文的十几倍大）。`renderSourceForAuthor`（预览）同样给值表，不用再裁剪位置。
- **给 Agent 的渲染**：
  - `<V of="panel.魔力">3110</V>`；显示名与 id 不同时加 `label="魔力"`；不完整加 `incomplete="c7 constraint-violated"`；读不到写 `unavailable="原因"`，值是 `null`；计算值 `<V expr="…">"40%"</V>`。
  - 值里的 `<` 写成 JSON 的 `\u003c`，带值的 `V` 从开标签到 `</V>` 之间没有 `<`，词法把它整体当一个原子。
  - `<If test="…" value="true">…<ElseIf test="…" value="false" />…<Else />…</If>`：每个判断带结果（`true`、`false`、`null`），各支里的标签照常带装饰。
  - `<Ref id="e12" name="星瑾" />`；`<Image of="…" alt="…" path="…" />`。
  - 出错的块给原样源文与“出错”标记，带诊断（不变）。
- **纯文字的渲染**（输出 15）：`reads` 与 `mentions` 先按词法得到的全部标签静态地算，活的与字面的都算，`If` 的判断与各分支都算；`mentions` 再并上求值时从值里得到的引用与以引用为键的行（omp 第 7 条）。块里有字面的标签时报 `syntax`（照原文写会把条目 id 给读者，omp 第 9 条）。代码里、转义的、以后新加的不透明容器都吞不掉依赖（t38 的保密关卡）；代价是代码里写着标签时多扣，很少见。值的写法、`problems` 的四种不变，加一种 `unknown-tag`（没登记的标签，不知道读了谁）；写坏的内置或登记标签（含代码里的）报 `syntax`（设计审查第 17 条）。If 判断未知时纯文字写“未知”（同旧三元式）。
- **删掉** `writeback.ts` 的 `writeBack`、`scanAnnotations`、`annotation` 与 `render.ts` 里的注记写法，`canonWorldContract` 的 `writeBack` 与 `backend/remote.ts` 的转发（产品里没有调用方）。`world/text-blocks.ts` 里同名的文字路由保留。
- `entry.ts` 的 `splitBlocks` 改用新词法器切顶层单元（公开函数，产品里没有调用方）。
- Component 的 `agentView`（schema 里的文字字段，没有插件用）照新写法解释。

### 4. `packages/nb-canon/src/render/legacy/`：转换器（迁移完删掉）

- `convertLegacyBlock(source) → {source} | {problem}`：用旧的 `parseBlock`（micromark 链此时挪进 devDependencies）拿到表达式的精确偏移，按偏移拼接。
- 写法对照：`{地址}` → `<V of="地址" />`；`{ref("e2").ns.f}` → `<V entry="e2" of="ns.f" />`；别的表达式 → `<V expr="…" />`，字符串字面量换成单引号（字面量里有 `"` 时报错、人工改）；顶层的三元式 → `<If test="c">X<Else />Y</If>`（分支是字符串的写成转义过的正文，否则写成 `<V>`，else 支还是三元式的接成 `ElseIf`）；运算里面的三元式整个写成 `<V expr="…" />`；`{/* 注释 */}` 去掉并报条数；`<Image src={单地址}>` → `<Image of=…>`。
- 样本：110 处里 77 处单地址、22 处带 `ref`、11 处是同一句“比较 ? 字面量 : 字面量”，都在规则内。
- 一次性脚本改写样本 JSON、nb-canon 的测试与 fixture、应用里 canon 与 plot 的测试数据（文件清单见[调研摘要](evidences/survey.txt)第一节）。

### 5. 应用：`packages/neuro-book/src/plugins/canon/`

- `backend/agent-tools.ts`：`create` 的 `text`、`addBlock` 的 `text`、`set` 写 `text[块]` 的值整段经 `stripAgentText`。`replace` 写 `text[块]` 时 `find`、`with` 不单独去值：按读取位置、实际模式渲染这一块的带值文字，`find` 恰好出现一次，换成 `with`，整块去值、检查，用 `set` 写回 `text[块]`（`read` 写旧源文，`value-conflict` 照常）；找不到且 `find` 带装饰时回话提示按实际模式重读（设计审查第 4、6 条）。这也修掉 w00039 t20 记的“读到带值文字、在源文里替换对不上”。Agent 在文字里改了值时照常写入，回话加一句“文字里的值不写入，现在是 X，改值用 set”：交回的与当时的带值 `V` 按（标签名、地址或式子）配对比较，配不上的不报（决定 3 的“交回时去掉值”）。只抄了开标签的 `<V of="…">3110`（没有 `</V>`）是写坏的标签，拒收。`canon_read`、`canon_write` 的说明写新写法与每种标签的用法。
- `shared/contracts.ts`：`render`（作者）与 `renderSource` 的输出换成源文加值表；删 `writeBack`。
- `web/components/EntryText.vue`（阅读视图）：从“画语法树”改成对源文跑 `@notnotype/nb-canon/grammar`、按词法单元与值表画；值是按钮、点了展开来历照旧；If 只画生效的那一支。预览（`text-preview.ts`）照同一个画法。富文本在 t03 取代它，这一版只换数据来源，不改样子。
- `web/entry-language.ts`（Monaco 着色）：换成标签的规则；`EntryPageHost.vue` 的“插入”写 `<V of="…" />`。
- `src/architecture.test.ts`：浏览器放行 `@notnotype/nb-canon/grammar`（实施时在开发服务上实测一次 Vite 开发模式能加载）。
- plot 的简报（`plot/core/brief/gate.ts`）只用 `reads`、`mentions`、`problems` 三样，不用改；测试数据随迁移换写法。

### 6. 依赖与边界

- nb-canon：加 `@notnotype/nb-markdown`（只引 `./marked`）与 `marked`；迁移完删 micromark 链的 9 个依赖，`acorn` 留下。nb-canon 是 private、只在工作区里用，传递依赖（Tiptap、vue）不进打包，由 `./grammar` 的边界测试守住。
- 后端引 nb-markdown 纯入口已有先例（`bots/backend/summary.ts`、`stickers/backend/editor.ts`）。
- 换成“只放 marked 配置的新小包”的条件：nb-canon 要发布，或依赖闭包里的 Tiptap 成了问题。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| 新 ADR 0064 | 条目主文字用标签写法、与章节共用 marked；给 Agent 带值只给看、去掉注记回写。部分取代 ADR 0038 的决策 1、3 与决策 2 里的“标签只有内置的几个”（0038 正文不动，索引里补注） |
| `docs/specs/canon/rendering.md` | 重写白名单与表达式节点表、标签与属性、写入检查与新码、给作者的值表、带值写法与去值、纯文字的静态收集、读法变化清单；删回写的输出 9、10、12 到 14 与相关失败码；场景 1 到 5 换写法 |
| `docs/specs/canon/agent-tools.md` | `canon_read` 的文字格式；`canon_write` 写文字时去值、`replace` 在带值文字里做 |
| `docs/specs/canon/author-ui.md` | 输出 10、39、48 的写法与“插入”写的标签；预览照新渲染 |
| `docs/specs/canon/components.md`、`model.md`、`revisions.md` | “主 MDX”改称“主文字”，`agentView` 用新写法 |
| `docs/specs/workspace/markdown-syntaxes.md` | `atoms` 字段 |
| `docs/modules/monorepo-boundaries.md`、`packages/nb-canon/AGENTS.md`、`packages/nb-markdown/README.md` | nb-canon 的依赖与浏览器能引的子路径；nb-markdown 的 `./marked` |

## 切片

每片一个提交范围，自跑的验证写在各片后面。

1. **S0 旧实现的快照。** 在样本世界的几章、两条线、实际与按计划两种模式上，记下旧实现的纯文字（文字、`reads`、`mentions`、`problems`）、给作者的显示文字序列、给 Agent 的值序列，存成测试数据。验证：快照测试在分支起点上通过。
2. **S1 Spec 与 ADR。** 先写 rendering.md 等（上表）与 ADR，做设计审查（见“验证”）。
3. **S2 nb-markdown 拆 `./marked`，加 `atoms`、`atomAt`、转义规则与“不读 frontmatter”。** 验证：拆出的配置与 core 语言的词法单元在 nb-markdown 全部语料上逐字相同（独立设计 E3 写成测试）；没有 `atoms` 时编解码语料测试不变；外层分词进行中对另一段文字再分词，两边的原子表互不串；`bun run test`、`typecheck`（nb-markdown）。
4. **S3 `grammar` 与编辑器侧的条目语法模块。** 验证：独立设计 E2 的 33 个例子做成表驱动测试；E4 的随机对照与 E5 的往返用 fast-check 写成性质测试；编解码器对照写成性质测试（落点相同、写出的文字过写入检查，含编解码器对照里的 frontmatter、表格、`<br>` 几例，列表项与引用里独占一行的 `<br>`，以及“`<` 加大写字母加空白、没有 `>`”的纯文字），放在应用包，跑 `bun run --cwd packages/neuro-book test src/plugins/canon/entry-syntax.test.ts`；生成器包含属性值里的 `<大写名`、名字与显示名里的 `"`、换行、`<`、`>`；遮罩不等长即失败；acorn 的注释、首尾空白、`??` 几例进表驱动测试；“字面不当活的”“分类失败关闭”做变异检查；nb-canon `bun test`、`typecheck`。
5. **S4 转换器。** 旧的 `parseBlock` 还在，转换器只依赖它；单测覆盖写法对照的每一行与报错的几种。验证：nb-canon `bun test`。
6. **S5 内核换上新文法，连同数据迁移（一个提交范围）。** 写入检查、求值、三种渲染、删回写；同一范围里用转换器改写样本 JSON 与[调研摘要](evidences/survey.txt)第一节列的测试与 fixture（派 Haiku 跑脚本，转换器报错的逐条人工改）。分开提交时中间那一版的测试过不了（新内核拒收旧写法），所以合成一个范围。验证：`rendering.test.ts` 按新 Spec 重写（真实 `World`）；对 S0 快照逐块对照：`reads`、`mentions`、`problems`、值序列全部相同，三元式只比纯文字，纯文字只许出现读法变化清单里登记过的差异；样本、测试与 fixture 里没有残留的花括号写法（断言）；nb-canon 全部测试、plot 的简报测试照过。另外（omp 设计审查）：BOM、换行与标签的规范化放在新源文进入候选之前，`publish`、`editInPlace`、`editEntries`、初值与补丁走同一处，候选、预览与读回核对用同一份，`read` 的旧源文不经此路径（第 14 条）；样本适配器把 `V` 的 `entry`、`Ref` 的 `id`、式子里的 `ref('…')` 一起按标签文法重绑，只动活的标签，验收覆盖首次写入就读到正式 id（第 19 条）；`rendering.test.ts` 覆盖两条线与按计划模式的读法（第 23 条）。
7. **S6 应用接入。** agent-tools、契约、阅读视图与预览、着色与“插入”、架构测试；删 micromark 链与转换器。另外（omp 设计审查）：`render`、`renderSource` 的形状变了，升 canon 远程合同的版本（第 10 条）；交回的块去值后与当前源文相同、又没有别的改动时不发布，回话照常提示改值用 `set`（第 15 条）；预览检查没登记的标签时用条目当前的整个主文字作基线（第 22 条）。验证：见下节。

## 验收映射

| `canon.rendering` | 覆盖 |
|---|---|
| 输出 1（白名单、各码、行列；`tag-malformed` 与文字的分界；`too-many-tags` 的上限）、输出 18（存下的是规范写法） | `nb-canon/tests/rendering.test.ts`；`grammar` 的表驱动测试 |
| 输出 2、5（运算、函数与三值逻辑，三元式选出文字） | `rendering.test.ts`、`grammar` 的单测 |
| 输出 6（`unavailable="…"`）、7（值表的名字与起点、`If` 的项、没生效的支、未知的 `If`）、16 | `rendering.test.ts`；`EntryText.dom.test.ts` 用真实 `grammar`（含对不上整块出错） |
| 输出 8、9（装饰，含名字里的 `"`、换行、`<`）、22（去值往返）、场景 1、6 | `grammar` 的性质测试；`rendering.test.ts` |
| 输出 15（静态收集、`unknown-tag`、写坏的标签报 `syntax`）、场景 5 | `rendering.test.ts`；`plot/core/brief/gate.test.ts` |
| 输出 17（落点、表格的 `|`、私用区的字）、场景 7 | `grammar` 的表驱动与性质测试 |
| 输出 19（没登记的标签：两块、第二块有，整篇提交能写） | `rendering.test.ts`、`entry-edits.test.ts` |
| 输出 21（与编辑器读法一致） | `packages/neuro-book/src/plugins/canon/entry-syntax.test.ts` |
| `canon.agent-tools` 输出 6 写主文字（整块去值；`replace` 用带值的整个 `V`、半个带值标签、按计划模式读到的值做 `find`；改了值的提示按配对） | `packages/neuro-book/src/plugins/canon/agent-tools.test.ts`（真实世界服务） |
| 迁移不改语义 | `nb-canon/tests/legacy-render.test.ts` 换成对照（S5） |

## 验证

- 每片自跑上面列的命令；收口 `bun run test:affected --since master`。
- 合入前的 e2e（4 个文件，读过的写法与阅读视图都在里面）：`canon-write`、`canon-author`、`canon-character`、`plot-author`。开工前在分支起点上各跑一遍记作基线。实施中只重跑改动覆盖到的那个。
- 真实浏览器：开发服务上打开星瑕样本，阅读视图的值、点值看来历、编辑源文字与预览、提交；`nbdev shot` 截 `EntryText` 与 `EntryTextEditor` 的 Lab 场景。
- 真实 Agent：用 t01 评测的场景跑几次 `canon_read` 与 `canon_write`（luna），看带值文字与改文字、改值的回话。
- 审查（高风险后端：数据格式、保密）：S1 的 Spec 与 ADR 用快速审查（Opus 先审，omp `@review` 在后台）；S3 与 S5 的实现收口各交一次同样的审查；S6 的前端部分派 Sonnet。
- 不验证：块级的 If、登记的标签（t04）、富文本（t03）。

## 测试分工

本 Task 以内核为主，e2e 只改写法与选择器，主会话自己做；测试数据的批量换写法派 Haiku（S5）。

## 不做与风险

- 不做：块级 If；登记表与登记标签的界面（t04）；富文本编辑器与阅读视图的新样子（t03）；设定组分页的默认模板（t05）；手写表达式解析器。
- 风险：
  - 遮罩的哨兵与编辑器的往返：t03 的编辑器走同一个 `atoms` 钩子，由 nb-markdown 的语料测试守“没有 atoms 时逐字不变”、由 S3 的性质测试守条目这边。
  - 读法变化（`a < b`、自动链接、缩进代码、单个波浪线、任务项、中文强调的边角、行首标签不再算 HTML 块开头）：S5 的对照把样本里的实际差异逐条列出，写进 Spec。
  - Agent 照着读到的样子在文字里改值：照常写入并提示，靠 t01 评测的场景实测一次回话是否让模型改用 `set`。
  - 前后端文法版本必须一致（值表按序号）：随同一份应用构建发布；远程连接两端同版本的前提照旧。

## 要开发者定的

1. **真实作品里有没有旧写法的世界。** 有的话，本 Task 加一次“换写法”的系统修订（打开作品时把旧写法的块整体转换，进改动记录、可还原），旧解析器要多留一段时间；没有的话只改样本与测试，旧写法的块显示成出错的块。推荐：先问清有没有，没有就不做。
2. **Agent 在文字里改了值时怎么办。** 计划选的是照常写入、值不改、回话里写一句“文字里的值不写入，现在是 X，改值用 set”；另一种是整次拒收。推荐前者（与“交回时程序去掉值”一致）。
3. **块级的条件这一版不做。** `If` 只能在一段里（同旧的三元式）；跨几段的条件写入时拒收，以后再加。
4. **删掉已实现的回写合同。** `{地址 = 值}` 的可改注记与 `writeBack`（rendering 输出 9、10、12 到 14，产品里没有调用方）整个去掉。
5. **条件在给 Agent 的文字里的标记改了名。** 演示里是 `is="true"`；计划改成每个判断都带 `value="true|false|null"`（`ElseIf` 也要标，未知用 `null`）。
6. **登记标签的描述（t04 的事，先提一句）。** 演示里描述由插件的函数生成；独立设计建议改成一段条目文字的模板（例如 `一条“$label”进度条，<V of="$of" />/<V of="$max" />`），前后端结果一致、读了哪些字段可以静态收集。做 t04 时再出演示对齐。

## 后续 Task（本 Task 不做，先记下）

- t03 富文本编辑器：阅读与编辑用同一个 Tiptap 编辑器，值与条件的小块、插入（`{`、`@`）、源文字切换、去掉分屏预览；界面请 omp `@designer` 当顾问（开发者 2026-11-26）。
- t04 标签登记表：内核侧的登记（属性表、描述模板、`reads`）、贡献点、作者界面、给模型的标签列表与用法、写入检查带用法的回话。分析缓存（`render/syntax.ts`）的键那时要带登记表的摘要，或把依赖登记表的部分移出缓存（S5 审查 Opus 第 11 条）。
- `canon_read` 读条目文字时的截断（S5 期间记下）。
- t05 设定组分页改成作者能改的默认模板：先出演示稿与开发者对齐。
