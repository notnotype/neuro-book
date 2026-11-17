---
schema: nbook.task/v2
taskId: t10-frontmatter-panel
status: done
updated: 2026-11-16
---

# frontmatter 属性面板

## 目标与范围

正文上方的属性面板，参照 Obsidian：按字段显示与编辑、可切到 YAML 源码、没有时显示“添加属性”

合同：[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 22（frontmatter 的编辑另定）。来源：t06 决定 13 与 `analysis.md` 第 7 项。

## 当前状态

开发者 2026-10-16 定先搁置；2026-11-16 说“可以做 t09 t10 了”，开始设计；同日说“t10 这里先出静态稿”；设计定稿、计划第二稿确认后开工，2026-11-16 四片都已合入 master（64d563b73），Spec 的条目去掉了“（planned）”。进度见下文“实施”。

静态稿第 1 轮：草稿在 `.worktree/w00025-t10-drafts`（分支 `chore/w00025-t10-drafts`，不合并、不提交），Lab 组件 `PropertiesDraft`；评审板 [`artifacts/review/index.html`](artifacts/review/index.html)。问题 1 面板的样子（平铺、卡片），问题 2 缺省展开还是收起，问题 3 到 5 是会话里问过的文字题（没有属性时的入口、类型怎么定、表示不了的内容）。

### 决定

评审板第 1 轮（开发者 2026-11-16 在面板上答，五题都取推荐）：

1. 面板的样子：卡片（淡底，没有线）。开发者附言：“表单、样式细节再优化一下。看看这个地方是否能和 nb-form 复用组件？还是说没必要复用，这里不复杂，代码量不多，重新写一份适配 frontmatter？”第 2 轮回答并改细节。
2. 打开文件时缺省收起成一行摘要，展开状态按文件记住。
3. 没有 frontmatter 时不画面板；从命令面板、更多菜单、斜杠菜单添加，或在文件开头打 `---`。
4. 类型按值推断（文字、数字、勾选、日期、列表），点类型图标可以改类型；不做全书统一的类型登记。nb-ui 新加日期输入与标签式列表输入。开发者附言：“讲解一下全书统一是什么？这个有什么用？”第 2 轮回答。
5. 表示不了的字段逐个退回只读的一行“在源码里改”；YAML 写错时整块显示源码并标出错处；注释、没动的字段与写法原样保留。

第 2 轮（2026-11-16 发布）：板上回答两条附言（不在 nb-form 层复用，在 nb-ui 控件层复用、面板单写；日期与列表输入用 reka-ui 的 DatePicker、TagsInput 搭进 nb-ui；解释了全书统一），并把卡片的细节画全（悬停、改日期、改列表、改类型、表示不了的字段、源码、写错、暗色、390px），问题 6 请开发者确认细节。草稿组件 `PropertiesCardDraft`。

6. （第 2 轮问题 6，开发者 2026-11-16 确认）卡片的细节照第 2 轮的图。附言：“你这些图标是怎么映射的？要不要提供贡献点？或者提供直接在 frontmatter 指定图标的能力？”在会话里答：图标按推断出的类型取（文字、日期、列表、数字、勾选、复杂各一个），它同时是改类型的按钮；不在 frontmatter 里写图标（数据里混进显示用的东西，别的工具会读到）；按属性名给图标、类型与显示名的贡献点是“全书统一类型”的轻量版，等有第一个要用它的插件（例如设定插件想让“视角”指向角色条目）时再做，这次写进不做。开发者 2026-11-17 答：“可以给图标、类型提供贡献点”，同意做。不并进 t10（t10 已合入）：另建 Task 设计与实现，见 [Work README](../../README.md)；t10 的 Spec 不承诺里那一条到那个 Task 实现时再改。

### 现状与参照（2026-11-16 调研）

- 编解码器：`nb-markdown/src/language/codec/source.ts` 的 `splitFrontmatter` 拆出 frontmatter，原样放在原文对照的 `prefix` 里（不在编辑器文档中），写回时拼在正文前并校验没变。没有读写字段的接口；现在改它只能用源码编辑器改整份文本。
- 控件：`MarkdownControl.vue` 的根里依次是工具栏（传送到编辑组的工具栏位）、页边、滚动容器、版心；正文上方没有现成的位置。组件文档把 frontmatter 面板列为不支持。
- YAML：应用依赖 `yaml` 2.x（实装 2.9.0），新应用只用 `parse`；它的 `parseDocument` 能保留注释与没改的写法。`nb-markdown` 不依赖它。
- 组件：nb-ui 有文本框、数字、复选框、开关、下拉、`SearchSelect`；没有日期输入，也没有标签式的列表输入。nb-form 按 TypeBox 画表单，没有日期控件，属性的类型按值推断、不是先有 schema，不合用。
- 别处读 frontmatter：Lab 组件索引、Skill 包、字数统计（只剥掉）；工作区索引不读。Spec `workbench/editor.md` 写着富文本不含 frontmatter 面板，要改。
- 旧应用：`TipTapFrontmatterPanel.vue`，正文上方可折叠的一块，收起时显示第一行，展开是 YAML 文本框；能添加、去掉 frontmatter；角色、地点、规则三类文件另有“档案表单”按钮。
- Obsidian：属性在笔记顶部，设置“Properties in document”可选显示、隐藏、源码；类型有文字、列表、数字、勾选、日期、日期时间、标签，按属性名在整个库统一；嵌套属性不支持，要看用源码模式；用命令、`Ctrl+;`、菜单，或在文件开头打 `---` 添加。

## 实施

计划第二稿：[plan.md](plan.md)（2026-11-16）。第一稿经 Claude Sonnet 设计审查（阻断 2、重要 8、建议 2，处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)）：frontmatter 改为编辑器文档的属性、面板改到控件层，改一个字段只替换这一项的原文。开发者 2026-11-16 说“可以，按第二稿开工”。

执行位置：`.worktree/w00025-t10-frontmatter-panel`，分支 `feat/w00025-t10-frontmatter-panel`。

- 第 1 片（nb-ui `DateInput`、`TagInput`、Lab 场景与 DOM 测试）：d5eb7b6a3。nb-ui 全量测试 617 条通过；neuro-book 的 Lab 测试与 `vue-tsc -p tsconfig.web.json` 通过；`governance:check`、`docs:check` 通过；Lab 截图（亮、暗、390、日历打开）没有溢出与裁切。偏离计划：没跑不带 `--files` 的 `test:affected`，因为 `bun.lock` 只多了 nb-ui 的一行依赖声明（`@internationalized/date` 原本就随 reka-ui 装着，没有版本变化），它会把选择扩到全仓。nb-ui 自己没有 CHANGELOG（按发布规范在下次提版时建），应用的变更记录在第 4 片面板可见时写。另补一条 DOM 测试：界面语言是英文时日期按英文的段顺序排（98a687bce），代替计划里“英文场景”（Lab 没有按场景换语言的办法）。
- 第 2 片（文档属性与编解码器，`MarkdownControl` 只读显示原文）：01dcf3bae。新增 `codec/frontmatter.test.ts`（fast-check：没编辑逐字节写原文、换了属性只换正文前那一段、不完整的原文被 `isWholeFrontmatter` 挡下；撤销与重做、全选删除、重载）与 `MarkdownControl` 的一条 DOM 测试；10 个种子都过；变异检查 5 处都被测出。nb-markdown 全量（bun 283、Vitest 267）、markdown 插件的 Vitest 157 与 bun 41、nb-story 的 `link-refs` 通过；nb-markdown 与 neuro-book 的类型检查（含两份 `vue-tsc`）通过；`e2e/editor-area.e2e.ts` 的两个用例（第 1312、1632 行）通过。相对计划的一处改动：frontmatter 闭栏后没有换行、后面有正文时补的换行从第一个间隔挪进前缀，否则面板把 frontmatter 改成闭栏后没有换行的写法时，沿用的第一个间隔不带换行，闭栏与正文粘在一起、写不出。
  - 本片的实现审查（Claude Sonnet，[`evidences/impl-review-s2.txt`](evidences/impl-review-s2.txt)）：阻断 0、重要 1、建议 5，都接受，修正在 85d6f0e44。
    1. （重要）写回没校验属性：属性里放了不完整的原文时，正文开头会被读成 frontmatter。写出时按 `isWholeFrontmatter` 校验（空正文的写法同样经过），不合格就写不出，原因指向 frontmatter 属性；抢救正文把它的原文留成开头的纯文字段落。
    2. 本组改了属性、别处又改了 frontmatter、再撤销时，换回的是整段旧原文，别处的修改丢掉：路径窄，不加机制，记为已知限制（`MarkdownControl.md`，Spec 写属性面板时一并写）；不加固定这一行为的用例。
    3. 测试：换 frontmatter 的性质去掉前置条件、补“闭栏后没有换行”的预期；生成器的 frontmatter 与正文换行符分别取；抢救正文加两条（闭栏后没有换行、属性不完整）。
    4. `splitFrontmatter` 直接给出 frontmatter，前缀改称 head。
    5. 测试文件头对历史插件的说法改正；`MarkdownControl` 的 DOM 测试加一条只改属性的事务（交出写回新原文、撤销回到原来的）。切走再切回的那半条没加：第 4 片换成面板后由 e2e 覆盖。
    6. 空白正文不补换行的理由写进 `headOf` 的注释。
  - 验证：编解码器 bun 175 条、`frontmatter.test.ts` 10 个种子、`MarkdownControl` DOM 57 条、nb-markdown 类型检查、neuro-book `vue-tsc -p tsconfig.browser-test.json`、`governance:check` 通过；变异检查 4 处（去掉校验、去掉抢救、不补换行、补换行用主换行符）都被测出。
- 第 3 片（属性模型 `nb-markdown/src/editor/properties/model.ts`）：5abda58fc。模型测试 22 条（含两条 fast-check：改一项后别的项的原文切片逐字节相同；文字值按 YAML 1.1 与 1.2 都读回同一个字符串），10 个种子都过，变异检查 8 处都被测出（第一轮活下来 3 处，补了缩进的映射、带注释的列表、`%YAML` 与 `...` 的用例）。实现时定下的三处细节，与计划的字面不同：
  - 清空写成 `名字:`，不写字面的 `null`：两者读出都是空值，`名字:` 与“添加属性”新加的一行一样。
  - 改类型：文字里的日期按日期推断（计划的推断规则），所以有值的日期换不成文字；空值在文字、数字、日期之间随便换，但值还是空的，读回仍按文字推断，面板要自己记着这一行选的类型（第 4 片）。
  - 读不成属性多分了一类“顶层是写在一行里的 `{…}`”，与写错一样整块显示源码。

- Spec（第 4 片前，planned）：[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 39–51、验收场景 23–26、记录 `markdown.properties-open`、不承诺与已知限制；[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 22 指向新的输出 28（写回规则）、场景 1 补一句；[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 不承诺与输出 19。写 Spec 时定下、与计划字面不同的几处（已改 `plan.md`）：
  - 展开状态的记录改名 `markdown.properties-open`、归 `nbook.markdown`，只记展开着的文件地址；
  - 源码区照第 2 轮的图只放两条 `---` 之间的 YAML；
  - Esc 在面板任何输入里都回到正文、输入照常写回（不是放弃）；
  - 同一个文件在几个组里共用一份展开状态；
  - 方言的写回规则写成新的输出 28（编号只追加），输出 22 只加一句指向它。

- 第 4 片（面板、输入规则、命令与菜单、展开状态记录、e2e）：4a96ebb71（nb-markdown 的 `MarkdownProperties` 与 Lab 场景）、0358d41b9（接进 Markdown 控件：写回作为一次编辑、结算先写回面板、`---` 输入规则与命令 `nbook.edit.properties`、记录 `markdown.properties-open`、键盘进出）、24fead250（e2e、组件文档、应用 CHANGELOG）。实现时定下、与计划或评审板的图不同的几处（Spec 已按此写）：
  - 新建后焦点在新属性名上，“紧接着退格还原”改为在空着的新属性名上退格（撤回 `---` 那次输入规则；命令新建的只交回焦点）；
  - 写错时按 `yaml` 报的位置标行：括号没闭合时可能标在下一行（图上总指着括号那一行），报在内容之后的夹到最后一个有字的行；
  - 日期按界面语言显示（`2025 / 12 / 21`，第 1 片 DateInput 的行为），图上是 `2025-12-21`；
  - 表示不了的值显示一行源码（`林雪: 姐妹 沈舟: 旧识`），图上画的是 `{ 林雪: 姐妹，沈舟: 旧识 }`；
  - 列表的 × 只在编辑时显现，位置一直留着（平时小块比图上宽一点）。
  - 验证：nb-markdown（bun 309、Vitest 286）、nb-ui 618、nb-story 669、neuro-book 的 markdown、editor、Lab（Vitest 230、bun 271）全过；两个包的类型检查与 `governance:check` 通过；`markdown-properties.e2e.ts` 4 例通过；控件接法 3 处变异都被测出。
- 实现审查（第 3、4 片，Claude Sonnet，[`evidences/impl-review-s34.txt`](evidences/impl-review-s34.txt)）：阻断 0、重要 5、建议 5，修正在 64d563b73：
  1. （重要）空值带注释时填值吞掉冒号后的空白：值插在冒号之后，空白与注释留着。
  2. （重要）停手的计时也写回面板里打了一半的输入：拆成只交出正文的 `commitBody`，计时走它；结算才写回面板。
  3. （重要）上下方向键走不过表示不了的一行：这一行以“在源码里改”为一站。
  4. 看着源码时收起，再点源码切换没反应：收起时点它展开并看源码。
  5. （重要）只用回车换行的文档新建 frontmatter 生成 `---\r---\r`，面板挂不上、之后保存都报错：换行符只取 `\n` 或 `\r\n`；属性不完整时不挂面板。
  6. 写在一行的列表带行尾注释被当成表示不了：只有块序列的注释才算。
  7. 记录坏了时展开按钮点不开：有任何问题（读不出、坏了、保存暂停）都只改显示；补 `properties-open.test.ts`（真实存储）。
  8. 与图的差别：列表的 × 改为只在编辑时显现、源码框不多一行空行；表示不了的值保持一行源码（Spec 写的是源码，不改）。
  9. （重要）在年份那一段打字先写出 `0002-12-21`、这一行变成文字：`isIsoDate` 认 0001–9999 年；年份不到 1000 的当作没打完不写回（Spec 输出 42 加一句）；e2e 加改日期一例。
  10. 去掉没人用的导出；改名时空值选过的类型跟着走；控制字符与换行写成双引号；`aria-pressed` 与文档对齐；圆角防负值。`[2024, '2024']` 删项后类型会变，记为已知限制。顺带修了表示不了的属性改不了名。
- 合入前的 e2e（`markdown-properties`、`markdown-editing`、`markdown-input`、`editor-area`、`lab-scenes`）：109 例 108 过；`lab-scenes` 挂在 ThemeEditor 的 `scene-full`、`icons` 两个场景（w00041 的 Lab 场景引用的素材文件不存在，加载 404），与本 Task 无关；它让这一例在溢出检查之前停下，所以属性面板的场景另用 `lab:shot` 查（16 张，没有溢出、裁切与页面错误）。审查修正之后重跑 `markdown-properties`、`markdown-input`，10 例全过。
- 合入：变基到 master 后快进合入（64d563b73）；Spec 三份去掉本 Task 的“（planned）”，补实现合同与证据。

## 下一步

无。决定 6 的附言（图标、类型的贡献点）开发者 2026-11-17 同意做，另建 Task；t09 开工（Spec 与计划）。
