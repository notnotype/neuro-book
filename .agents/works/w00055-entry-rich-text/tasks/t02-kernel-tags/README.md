---
schema: nbook.task/v2
taskId: t02-kernel-tags
status: active
updated: 2026-11-26
---

# 写法与内核：标签写法、共用解析器、给 Agent 的带值只给看

## 目标与范围

条目主文字改用标签写法（取值、计算、条件、条目引用、图片、插件登记的标签），内核改用与章节编辑器相同的 marked 解析器，给 Agent 的渲染带值只给看、交回时去掉值；已有数据换写法。为后面的富文本编辑器与标签登记表打底。

合同：[`canon/rendering.md`](../../../../../docs/specs/canon/rendering.md) 重写（写法、白名单、带值写法、去掉回写）；[`canon/agent-tools.md`](../../../../../docs/specs/canon/agent-tools.md)、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md)、[`workspace/markdown-syntaxes.md`](../../../../../docs/specs/workspace/markdown-syntaxes.md) 跟着改；新 ADR 部分取代 [ADR 0038](../../../../../docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md)。具体见[实施计划](plan.md)。

## 当前状态

2026-11-26 经 nbdev 新建（开发者“可以，开工”，要写实施计划）。

[实施计划](plan.md)第 2 稿已写，等开发者确认“要开发者定的”六条。依据：[独立设计](evidences/independent-design.txt)（Opus，带实验：先遮罩再分词拿到标签的准确位置，约 9000 份随机文档没有标签丢失；不遮罩时表格里的标签被 `|` 切开、内容静默丢掉）、[调研摘要](evidences/survey.txt)、[编解码器对照](evidences/codec-probe.txt)。第 1 稿交顾问看过，按意见改了三处：内核走与编辑器同一段预处理（frontmatter、LF），白名单放行编辑器会写出的 `<br>` 等；编辑器侧的条目语法模块与内核的对照提前到本 Task；转换器先做，换内核与数据迁移合成一个提交范围。

开发者 2026-11-26：“全部同意”。计划里“要开发者定的”六条按推荐定：

1. 只迁样本与测试，不做打开作品时的整体转换。主会话查过本机：只有一部作品带世界数据目录，日志是空的；开发样例不进 Git，按新写法重新生成。
2. Agent 在文字里改了值：照常写入、值不改，回话提示改值用 `set`。
3. 条件只在一段之内，跨段的拒收。
4. 删掉 `{地址 = 值}` 注记与 `writeBack`。
5. 给 Agent 的条件每个判断带 `value="true|false|null"`。
6. 登记标签的描述用条目文字模板，做 t04 时出演示对齐。

执行位置：worktree `.worktree/w00055-entry-rich-text`，分支 `feat/w00055-entry-rich-text`（从 master `236fd578c` 开）。

- S0（分支 `451d94623`）：`packages/nb-canon/tests/legacy-render.test.ts` 与 `fixtures/legacy-render.json`：星瑕样本 6 块在 7 个读取位置、两种模式上共 84 份的三种渲染（纯文字与三样、给作者的显示文字、给 Agent 的值），只记与写法无关的部分，S5 拿来逐块对照。样本里没有 `<Ref>`、`<Image>`、出问题的块，这几类由 `rendering.test.ts` 的场景 5 覆盖。
- S1（master `13a8ff591`）：`canon/rendering.md` 改写成标签写法（条目级 planned；回写的输出 12、13 与相关失败码标“planned：删除”；新加输出 17 到 21），新 ADR 0064 部分取代 0038 的决策 1 与 3，`agent-tools`、`author-ui`、`components`、`model`、`revisions`、`project`、`workspace/markdown-syntaxes` 跟改；`docs:check` 通过。快速审查：Opus 子代理的 21 条按[处理记录](evidences/design-review-resolution.txt)改成计划第 3 稿（master `02efc37fd`）；omp `@review` 的 23 条（阻断 1、重要 19、建议 3，审的是第 2 稿）对照第 3 稿逐条归类，按[处理记录](evidences/design-review-omp-resolution.txt)改了 Spec（函数名只在调用处认、不占命名空间；非有限数得未知；纯文字里有字面标签报 `syntax`；套着的 If 与被丢掉的标签的码）与计划第 4 稿（master `20b46503c`），13、21 两条接受取舍。
- S2（分支 `7a0ff46b0`、`e8c94239c`）：nb-markdown 拆出纯入口 `./marked`（core 与原样语法的 marked 配置、`createLexing`、原子的遮罩与 `atomAt`、转义规则、不读 frontmatter 的选项），编辑器的语言建在它上面；拆出的词法与编辑器的 core 语言在全部编解码语料上逐字相同。
- S3（分支 `079ab764c` 到 `5da1c66c1`）：
  - nb-markdown：`lexAtoms` 交回每个原子落在哪；跨行的原子范围拒绝；读法另分词时也遮罩（omp 第 2 条）；表格里原子中的 `|` 不切单元格、写出不转义（omp 第 4 条，编解码器对照测出来的）。
  - nb-canon `./grammar`：标签词法、落点（活的、代码、转义、链接、图片、白名单外、被丢掉）、`If` 在同一层兄弟单元里配对（转义与代码里的闭标签不算，被强调切开的报 `cross-block`）、写入检查的各码、式子的节点表与三值逻辑（四则运算、七个函数、非有限数得未知）、规范写法、带值写法与去值。`tests/grammar.test.ts` 103 条，含 fast-check 的两条性质（每个标签恰好一个去处、还原无残留；去值(带值写法(源文)) 逐字等于源文，各 300 份），[变异检查](evidences/s3-mutations.txt) 18 个里 15 个被测出，3 个的处理写在里面。
  - canon 插件 `web/entry-syntax.ts`（编辑器一侧的最小条目语法模块）与 `web/entry-syntax.test.ts`：真实编解码器读出的条目节点与内核的活标签逐个相同、原样写回不变、整篇重写过写入检查（10 例加 300 份随机）。
  - S0 的快照测试补了类型（`451d94623` 起 nb-canon 的 typecheck 是坏的，S3 修好）。应用的 typecheck 通过；`src/architecture.test.ts` 有一条失败来自 w00056 t06 的 Lab 草稿引了别的插件的图片，分支起点上就有，与本 Task 无关。

- S3 的实现审查（快速审查，Opus 子代理与 omp `@review` 同时审 `451d94623..5da1c66c1`）：Opus 10 条、omp 15 条（含 1 条阻断：嵌套 If 的检查指数级），按[处理记录](evidences/s3-review-resolution.txt)修了 23 条，两条接受取舍（提示块与原子同在一门语言里的另分词、`atomAt` 原文的用法约束）。修正提交 `d51958ec9` 到 `a0d8d6e7b`，在单独的 worktree 里做、快进合入 Work 分支。Spec 跟着改：`tag-malformed` 收进单引号等近似写法，链接里写坏的候选照正文判，表格行比表头多拒收，`round` 的舍入与负位数，`too-many-tags` 按不同的私用区字计，`of` 认存下来的地址写法；markdown-syntaxes 写明另分词的时机与私用区字共用占位。

- S4（分支 `938996b32`）：`packages/nb-canon/src/render/legacy/convert.ts`，按旧 `parseBlock` 给的偏移拼接：单地址写成 `of`，`ref(…)` 写成 `entry` 加 `of`，别的表达式写成 `expr`（字符串换成单引号），顶层三元式写成 `If`（else 支的三元式接成 `ElseIf`，各支的字面量按旧的作者显示写成正文），只含注释的去掉并计数，`<Ref>`、`<Image>` 写成规范写法，`<Image src={地址}>` 写成 `of`；转完用新的写入检查再查一遍，转不了的交回原因。`tests/legacy-convert.test.ts` 17 条；星瑕样本里 44 处全部转成功。

- S5（分支 `f4efdd8ce`、`94307cd50`）：
  - 内核换上 `./grammar`：`render/syntax.ts` 按源文缓存分析（每个标签的意思、条件各支的起止），预览不进缓存；嵌套深到读不出结构的块按出错给、写入拒收（`unsupported-markdown`，Spec 输出 1 补了这一句）。旧解析器挪到 `render/legacy/syntax.ts`，只给转换器用。
  - 三种渲染：给作者的是源文加值表；给 Agent 的是带值写法（`decorateEntryText`）；纯文字按全部标签静态收集 `reads`、`mentions`，条件只留生效的支，加 `unknown-tag`。
  - 写入：`#publish` 在去重之后把新写的块与补丁规范化（BOM、LF、规范写法），`editEntries` 的建条目、增块、整段替换与 `replace` 的结果也规范化；原样留着的旧块与补丁不再查；没登记的标签按条目已有的规范写法放行。删掉 `writeback.ts` 与服务的 `writeBack`。
  - 数据：样本 44 处与 nb-canon、plot、canon testing、Lab fixture、perf 脚本里的测试数据换成标签写法；样本适配器用 `rewriteEntryIds` 重绑条目 id。
  - 验证：`rendering.test.ts` 按新 Spec 在真实世界上重写（81 条，覆盖输出 1、3、5 到 9、15、16、18、19、22 与场景 1、3、5、6、7）；S0 快照逐块相同，另加样本每一块在每个位置、两种模式上“去值(带值写法) = 源文”；worldlines 的两条线渲染断言改成逐字；nb-canon 全量 835 条与 typecheck 通过，plot 简报 87 条通过。[变异检查](evidences/s5-mutations.txt) 19 个，两个活下来的处理写在里面。应用的 typecheck 在 S6 接上之前不过（`remote.ts` 还在转发 `writeBack`）。
  - 快速审查：Opus 子代理（11 条：重要 3、建议 8）与 omp `@review`（12 条：重要 7、建议 5）同时审 `938996b32..94307cd50`，两份去重后 18 条，按[处理记录](evidences/s5-review-resolution.txt)改了 17 条（Lab 的三个旧写法场景归 S6，几条里有部分接受取舍），修正提交 `46e03bd08`、`ff07795b6`、`7860665c7`（最后一个是复核时发现的：`editEntries` 的读回核对要按同一份换法换掉临时 id，临时 id 的替换也要兜住读不出结构的块）：授权按原样请求核对、补偿修订不规范化、基线只收生效的变更与自闭合的写法、旧补丁按内容认原样、同一请求里新建的条目在主文字里的临时 id 换成正式 id、式子限 1000 个字符、纯文字里读不到值的判断报 `unavailable`、结果确定时不标读不到、BOM 全去、预览的行列认 CR、规范化与写入检查共用一次解析。Spec 跟着改：rendering 输出 1、6、15、19 与实现合同，components 输出 18。修正后（`7860665c7`）nb-canon 全量 852 条与 typecheck 通过，应用的 entry-syntax 与 plot 简报共 102 条通过；修正本身（`94307cd50..7860665c7`）还没人审，并进 S6 的后端审查范围；这一轮的变异检查 19 个全部测出（一个补了用例后）。

- S6（分支 `391132728`、`cc4930729`）：
  - 后端：删掉远程合同的 `writeBack`，`nbook.canon/world` 升到版本 2；`canon_read`、`canon_write` 的说明写标签写法与带值写法，工具版本升到 2；Agent 写主文字时 `create`、`addBlock`、`set text[块]` 整段去值，`replace` 在这一块按实际模式的带值写法里找、整块去值后写成带 `read` 的 `set`，交回的值与当时不同的按（标签、地址或式子）配对写进回话（“文字里的值不写入：… 现在是 …，改值用 set”），一批里全是去值后与现在相同的主文字时不发布（`backend/agent-entry-text.ts`）。
  - 前端：阅读视图与预览对源文跑 `./grammar`、按词法单元画，值表按“名字与起点”对回活的标签，对不上的整块按出错显示；条件只画生效的支；Monaco 着色换成标签（`of`、`expr`、`test` 的值照式子画）；“插入”写 `<V of="…" />`；Lab 的 EntryText 场景与编辑器夹具换成源文加值表，三个“写得不对”的场景换成内核真实的诊断。架构测试的注释改准（`./grammar` 本来就放行）。
  - 删掉旧解析器、转换器（`render/legacy/`）与 9 个 MDX 解析依赖。
  - 验证：nb-canon 全量 836 条与 typecheck、应用 typecheck、canon 与 plot 与架构测试（574 条里只有一条原有失败：w00056 t06 的 Lab 草稿引了别的插件的图片）、canon 的 vitest 261 条都通过；e2e `canon-write`、`canon-author`、`canon-character`、`plot-author` 共 30 条全过（基线在分支起点 `236fd578c` 上同样 30 条全过）。
  - 审查：前端派 Sonnet；后端（`94307cd50..cc4930729`，含 S5 审查之后没审过的修正）快速审查，Opus 子代理与 omp `@review` 同时审。

- S6 的审查与处理（修正提交 `c1e414245`、`b92bdcbe5`、`93a460ea1`）：Opus 有效 12 条（重要 7、建议 5）、omp 1 条（重要，与 Opus 第 10 条同一个问题）、Sonnet 10 条（重要 2、建议 8），三份到齐后一起归类，按[处理记录](evidences/s6-review-resolution.txt)改了 21 条，O13 接受取舍、S10 改 Spec。
  - 内核：单元嵌套超过 100 层拒收、渲染照出错的块给（与运行时的栈深无关）；预览按写入时的基线查没登记的标签；主文字里的临时 id 只换新写的块与补丁；世界服务的 `render` 可以只渲染一块，给 Agent 的那一块另带存下的源文；原样 HTML 的诊断不写内部单元名。
  - Agent 工具：`set text[块]` 的读取值用存下的源文，“没有改动”按规范化以后比；原样交回的块不论同批有没有别的改动都不写，失败回话的项号换回交来的第几项；先比读取戳再翻译；主文字里写 `$代号`；`field: "text[块 id]"` 分页读一块，超过一页的块 `set` 拒收、改用 `replace`；交回的文字先比长度、只解析一次。
  - 界面：HTML 形式的强调；块一级元素的行号按行数算；来历只画在画出了这个值的块后面；嵌套过深的块按出错显示；着色只认 `名="值"`、链接文字里的标签照标签画；过期文字与 `tagName`。
  - 验证：nb-canon 全量 843 条与 typecheck、应用 typecheck、canon 与简报与架构的 bun 测试（314 条里只有那条原有失败）、canon 与 Lab 的 vitest 257 条都通过；[变异检查](evidences/s6-review-mutations.txt)后端 14 个、前端 10 个全部测出。
  - Spec：rendering 输出 1（嵌套层数、请求最坏的耗时记为已知限制）、7（去掉“并报诊断”）、16（预览按基线）；agent-tools 输出 5、6、7；components 输出 18；计划同步去掉“并报诊断”。
  - 交开发者知悉：一次请求最坏能占住项目进程十几分钟（刻意构造的输入，已知限制）；值表对不上不报诊断；带值写法超过 8000 字的块只能用 `replace` 改。
  - 修正交顾问复核后补了 `506123dd5`：Opus 第 4 条的原例（一块 5088 字，整篇读截在 4000 字）仍落在截断线与拦截线之间，改成整篇读不在块中间截断；交回文字栈溢出时回一句话；比“没有改动”时交回的一侧不再解析；补长度闸门与出错块的用例（处理记录的“修正之后的复核”）。canon 与 Lab fixtures 的 vitest 264 条（261 加这次 3 条）。这轮修正（`cc4930729..506123dd5` 的后端）另派 Opus 子代理审：9 条建议（[报告](evidences/s6-fix-review-opus.txt)），按处理记录的“修正的复审”改了 8 条（块里原有的 `$` 写法原样留着、交回的文字先去 BOM、“没有改动”不走服务端的缓存、读回核对只对原样的旧块认没换、新写的判定只算一次、用内核的 `staleRead`、层数的说法、补用例），第 1 条（交回 10 万字的闸门在服务端先解析，最坏 112 秒）接受取舍；修正 `4eabd2f98`，变异 6 个全部测出。之后 nb-canon 全量 843 条、canon 与简报与架构的 bun 测试（318 条里只有那条原有失败）、vitest 264 条、e2e 四个文件 30 条全过。

## 下一步

1. 等真实 Agent 的评测（t01 的评测台移到新内核，luna）交回，有产品问题先修；之后合入 master，在 master 上按[晋升核对](evidences/promotion-check.txt)改 Spec 字面、去掉 t02 的（planned）。

2026-11-27 开发服务上的走查（样例作品，探针脚本，亮色）：阅读视图的值、引用、嵌套列表、`<strong>` 与 `**粗体**` 都画对了，控制台没有错误；编辑时引用与嵌套列表放在文档中段（前后各二三十段），在其中打字后预览栏滚到那一项（不是滚回顶上，最里层的列表项在栏内）。第一次探针用 Monaco 打字写入，自动缩进把列表后面几十段都缩进了列表项里，量错了对象，改用粘贴写入重测。没在真实页面上看的：同一个值在两块里时来历画在哪块（作者界面提交后只有一块，由 `EntryText.dom.test.ts` 用真实文法覆盖）。看到的已有问题（不是 t02 引入的，转 t03 定）：整篇编辑以后主文字是一块，点开头的值，来历画在整块后面、几十段之外；出错的块写的原因是内核的英文。

2026-11-27 晋升前逐条核对（Opus，[报告](evidences/promotion-check.txt)，29 条）：
- 代码问题 1 条（第 9 条）已修（`da4cd4497`）：纯文字对转义或代码里不成标签、名字也不是内置的 `<A` 不再报 `syntax`；t03 的编辑器会把文字里的 `<A` 一律转义，不修的话简报会把这样的块整块扣下。用例补在纯文字的表里，变异检查测出。
- 要保持（planned）的：登记的标签那几句（第 8、13 条，归 t04，要和 t02 的句子拆开标）；`agentView` 按主文字写法解释（第 12、23 条，没有任何代码解释它）。
- 要改 Spec 字面的：第 1、2、4、5、6、7、10、11、14、15、16、17、20、22、24、25、26、29 条；ADR 0064 说花括号写法成出错的块，与 Spec、代码不一致（第 16 条）。
- 缺测试、接受现状的：第 3、18、19、21、28 条。工具层面造不出出错的块与非规范的旧块（写入都会拒收或规范化），只有内核与纯函数的用例。
2. 原 S6 的清单（已做完）：应用接入（`remote.ts` 去掉 `writeBack` 转发并升合同版本、作者界面读值表、预览、着色与“插入”、agent-tools 去值与“值改了”的提示、Lab 的三个旧写法场景、三个 dom 测试、架构测试、删 micromark 链与转换器），前端部分派 Sonnet 审查。

开发者 2026-11-26：“可以设长度限制”（Opus S5 审查第 6 条：marked 在嵌套强调这类输入上超线性）。主会话先定为一块 1 万字（`97bfc88f8`），理由里说作者界面按段落一块一块提交；做 S6 时发现说错了：作者整篇编辑时整篇写进第一块，1 万字实际是“作者改过的条目整篇最多 1 万字”。改问开发者，开发者选“改成 5 万字”（与预览一次肯渲染的长度相同）。上限只管写入（超过的不解析、直接拒收，`block-too-large`），渲染不看它，存下来的旧数据照常渲染。实测最坏的写法 1 万字约 1 到 2 秒、2 万字约 6 秒，正常文字 2 万字约 50 毫秒。Spec rendering 输出 1 与失败表写明。
