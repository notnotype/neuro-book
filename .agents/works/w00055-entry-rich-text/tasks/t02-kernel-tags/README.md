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

- S0（分支 `451d94623`）：`packages/nb-canon/tests/legacy-render.test.ts` 与 `fixtures/legacy-render.json`：星瑕样本在每个读取位置、两种模式上 84 块的三种渲染（纯文字与三样、给作者的显示文字、给 Agent 的值），只记与写法无关的部分，S5 拿来逐块对照。样本里没有 `<Ref>`、`<Image>`、出问题的块，这几类由 `rendering.test.ts` 的场景 5 覆盖。
- S1（master `13a8ff591`）：`canon/rendering.md` 改写成标签写法（条目级 planned；回写的输出 12、13 与相关失败码标“planned：删除”；新加输出 17 到 21），新 ADR 0064 部分取代 0038 的决策 1 与 3，`agent-tools`、`author-ui`、`components`、`model`、`revisions`、`project`、`workspace/markdown-syntaxes` 跟改；`docs:check` 通过。快速审查：Opus 子代理的 21 条按[处理记录](evidences/design-review-resolution.txt)改成计划第 3 稿（master `02efc37fd`）；omp `@review` 的 23 条（阻断 1、重要 19、建议 3，审的是第 2 稿）对照第 3 稿逐条归类，按[处理记录](evidences/design-review-omp-resolution.txt)改了 Spec（函数名只在调用处认、不占命名空间；非有限数得未知；纯文字里有字面标签报 `syntax`；套着的 If 与被丢掉的标签的码）与计划第 4 稿（master `20b46503c`），13、21 两条接受取舍。
- S2（分支 `7a0ff46b0`、`e8c94239c`）：nb-markdown 拆出纯入口 `./marked`（core 与原样语法的 marked 配置、`createLexing`、原子的遮罩与 `atomAt`、转义规则、不读 frontmatter 的选项），编辑器的语言建在它上面；拆出的词法与编辑器的 core 语言在全部编解码语料上逐字相同。
- S3（分支 `079ab764c` 到 `5da1c66c1`）：
  - nb-markdown：`lexAtoms` 交回每个原子落在哪；跨行的原子范围拒绝；读法另分词时也遮罩（omp 第 2 条）；表格里原子中的 `|` 不切单元格、写出不转义（omp 第 4 条，编解码器对照测出来的）。
  - nb-canon `./grammar`：标签词法、落点（活的、代码、转义、链接、图片、白名单外、被丢掉）、`If` 在同一层兄弟单元里配对（转义与代码里的闭标签不算，被强调切开的报 `cross-block`）、写入检查的各码、式子的节点表与三值逻辑（四则运算、七个函数、非有限数得未知）、规范写法、带值写法与去值。`tests/grammar.test.ts` 103 条，含 fast-check 的两条性质（每个标签恰好一个去处、还原无残留；去值(带值写法(源文)) 逐字等于源文，各 300 份），[变异检查](evidences/s3-mutations.txt) 18 个里 15 个被测出，3 个的处理写在里面。
  - canon 插件 `web/entry-syntax.ts`（编辑器一侧的最小条目语法模块）与 `web/entry-syntax.test.ts`：真实编解码器读出的条目节点与内核的活标签逐个相同、原样写回不变、整篇重写过写入检查（10 例加 300 份随机）。
  - S0 的快照测试补了类型（`451d94623` 起 nb-canon 的 typecheck 是坏的，S3 修好）。应用的 typecheck 通过；`src/architecture.test.ts` 有一条失败来自 w00056 t06 的 Lab 草稿引了别的插件的图片，分支起点上就有，与本 Task 无关。

- S3 的实现审查（快速审查，Opus 子代理与 omp `@review` 同时审 `451d94623..5da1c66c1`）：Opus 10 条、omp 15 条（含 1 条阻断：嵌套 If 的检查指数级），按[处理记录](evidences/s3-review-resolution.txt)修了 23 条，两条接受取舍（提示块与原子同在一门语言里的另分词、`atomAt` 原文的用法约束）。修正提交 `d51958ec9` 到 `a0d8d6e7b`，在单独的 worktree 里做、快进合入 Work 分支。Spec 跟着改：`tag-malformed` 收进单引号等近似写法，链接里写坏的候选照正文判，表格行比表头多拒收，`round` 的舍入与负位数，`too-many-tags` 按不同的私用区字计，`of` 认存下来的地址写法；markdown-syntaxes 写明另分词的时机与私用区字共用占位。

- S4（分支 `938996b32`）：`packages/nb-canon/src/render/legacy/convert.ts`，按旧 `parseBlock` 给的偏移拼接：单地址写成 `of`，`ref(…)` 写成 `entry` 加 `of`，别的表达式写成 `expr`（字符串换成单引号），顶层三元式写成 `If`（else 支的三元式接成 `ElseIf`，各支的字面量按旧的作者显示写成正文），只含注释的去掉并计数，`<Ref>`、`<Image>` 写成规范写法，`<Image src={地址}>` 写成 `of`；转完用新的写入检查再查一遍，转不了的交回原因。`tests/legacy-convert.test.ts` 17 条；星瑕样本里 44 处全部转成功。

## 下一步

1. S5：内核换上新文法，连同样本与测试数据迁移（一个提交范围）。
