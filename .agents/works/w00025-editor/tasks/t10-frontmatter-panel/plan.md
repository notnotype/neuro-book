# t10 属性面板：实施计划

## Context

Markdown 文件开头的 frontmatter 现在不进富文本（方言 Spec [`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 22“它的编辑另定”），要改只能换到源码编辑器。这个 Task 在正文上方加属性面板。

开发者已定（评审板第 1 轮，见 [README](README.md) 的“决定”）：

1. 卡片样子（淡底，没有线）；细节以第 2 轮问题 6 的答复为准。
2. 打开文件时缺省收起成一行摘要，展开状态按文件记住。
3. 没有 frontmatter 时不画；从命令面板、更多菜单、斜杠菜单添加，或在文件开头打 `---`。
4. 类型按值推断（文字、数字、勾选、日期、列表），点类型图标能改；不做全书统一的类型登记。
5. 表示不了的字段退回只读的一行；YAML 写错时整块显示源码并标出错处；注释、没动的字段与写法原样保留。

板上“不用答”的几条照做：面板在正文上方随正文滚动、宽度同版心；源码在面板里就地改；面板的修改进正文的撤销历史；属性之间上下键或 Tab 走、Esc 回到正文。

开发者在场，计划确认后实施；不 push。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| YAML 读写、保留注释与写法 | `yaml` 2.x 的 `parseDocument` 与 Document API | 已是新应用的依赖；改一个键时别的键、注释、引号与流式写法原样 | `js-yaml`：丢注释；手写：YAML 太大 |
| 日期输入 | reka-ui 的 `DatePicker`（日历与日期字段），包成 nb-ui `DateInput` | nb-ui 本来就建在 reka-ui 上，键盘与读屏现成；`@internationalized/date` 随 reka-ui 已装 | 原生 `type=date`：样子随浏览器、跟不了主题；手写日历 |
| 列表输入 | reka-ui 的 `TagsInput`，包成 nb-ui `TagInput` | 同上；回车与退格的行为现成 | nb-form 的 `string-list`：设置表单的样子（一列带框输入加“添加”） |
| 属性的一行 | 不经 nb-form，在控件层复用 nb-ui | 属性先有值后有类型、名字能增删改、类型能换，nb-form 是先有 schema 再画；它的控件是设置表单的样子（第 2 轮评审板“答复：能不能复用 nb-form”） | `SchemaField` 加紧凑样式：要改 nb-form 的控件与布局，省下的只是最简单的值输入 |

## 关键设计

### nb-ui：`DateInput`、`TagInput`（`packages/nb-ui/src/components/form/`）

- `DateInput`：值是 `YYYY-MM-DD` 字符串或 `null`；`variant: "default" | "bare"`、`size` 与 `Input` 一致；点值或按 Enter、下方向键打开日历浮层（周一开头，按界面语言写月份），选一天即确定，Esc 关。日期与字符串的换算放在组件里（`@internationalized/date` 的 `parseDate`）。
- `TagInput`：值是 `string[]`；同样两种外观；每项一个淡底小块，改的时候带 ×；末尾接着打，Enter 或逗号加一项、空着按退格删最后一项；输入法组字时的 Enter 归输入法；去重、去掉首尾空白。
- 每个组件先写同名 `.md`，再写 `.vue`；登记 Lab 场景（含 390px 与英文场景）；DOM 测试经键盘与点击测行为。nb-ui 的 `package.json` 显式加 `@internationalized/date`（组件直接导入它）。

### nb-markdown：frontmatter 节点与编解码器

- 新语法模块 `language/syntax/frontmatter/`：块节点 `frontmatter`，属性 `raw`（frontmatter 的原文，含两条 `---` 与结尾的换行），原子、不可选、不可拖。只有编辑器的语言带它；展示器与提示词编辑器不带，它们照旧按前缀处理。
- 文档的内容：core 的 StarterKit 关掉 `document`，由语言组装时给 `doc`：带 frontmatter 语法时内容为 `frontmatter? block+`（只能在最前面），否则 `block+`。
- 读（`codec/read.ts`）：语言带 frontmatter 时，前缀里 BOM 之后的部分成为第一个节点的 `raw`；原文对照 `map.prefix` 不变。
- 写（`codec/write.ts`）：用到前缀的地方改用“这次的前缀” = BOM + 文档第一个节点的 `raw`（没有节点时为空）。正文的块不含这个节点。没改的 `raw` 与原来逐字节相同，所以未编辑的文档仍写原文。现有的“正文开头会被读成 frontmatter”“文末闭合补换行”两条照旧按这次的前缀算。
- 重载（`reload`）不变：节点按块参加比较，别处改了 frontmatter 时只换这一个节点。

### nb-markdown：属性模型（`editor/properties/model.ts`，纯 TS）

- `parseProperties(raw)` → `{ok: true, rows}` 或 `{ok: false, line, message}`（YAML 写错、顶层不是映射）。
- 一行：`{key, kind, value}`。推断：布尔为勾选；数字为数字；`YYYY-MM-DD` 的字符串或 YAML 日期为日期；全是标量的序列为列表；`null` 与空为文字（空值）；映射、含映射的序列、多行字符串、锚点与别名为“复杂”（只读）。
- 编辑都返回新的 `raw`：`setValue`、`rename`（撞名拒绝）、`remove`、`add`（新键缺省文字类型、空值）、`changeKind`（能转就转：文字与数字互转要能解析，列表转文字用“、”连接，文字转列表按“、”与逗号拆；转不了的拒绝并保留原值）。都走 Document API，换行符沿用原文。
- `nb-markdown` 加依赖 `yaml`。

### nb-markdown：节点视图与守护（`editor/frontmatter-view.ts`、`editor/properties/MarkdownProperties.vue`）

- 节点视图照 `image-views.ts` 用宿主的 `context` 挂 Vue 组件；`stopEvent` 让面板里的输入、点击不进 ProseMirror；`ignoreMutation` 为真。
- `MarkdownProperties.vue`：卡片、头行（折叠、收起时的摘要、源码切换）、各行（类型图标与菜单、属性名、值）、“添加属性”、源码区（`Textarea` 等宽，就地改，失焦或 Ctrl+Enter 提交）、出错时整块源码与错处。值改动在失焦、Enter、选定（日期、勾选、列表加减）时提交成一笔事务（`setNodeMarkup` 改 `raw`），进撤销历史；正文里 Ctrl+Z 能撤。
- 守护插件：一笔事务删掉了 frontmatter 节点而没有带“删除属性”的元数据时（全选删除、剪切），在同一笔里补回原节点；“删除全部属性”的动作带元数据。
- 输入规则：文档没有 frontmatter、在第一段开头打 `---` 时建一个空的 frontmatter 节点并展开、焦点到新属性名（Obsidian 的做法），其它位置的 `---` 照旧是分隔线。
- 键盘：上下键与 Tab 在行间走；Esc 回到正文开头；正文第一段开头按上方向键进面板的最后一行。

### neuro-book：接入（`packages/neuro-book/src/plugins/markdown/`、`editor/`）

- `MarkdownControl` 的语言带 frontmatter 语法；节点视图要的“展开状态”经视图宿主给出。
- 展开状态按文件记：新记录 `editor.properties-open`（项目分区、本机，同 `comment-margin-record.ts` 的做法），存展开过的文件地址，最多 200 个、按最近使用淘汰；读不出时按收起。
- 命令 `nbook.edit.properties`（“添加属性”）：进编辑动作目录，斜杠菜单的 blocks 组、工具栏的更多菜单、命令面板都有；已有 frontmatter 时它展开面板并聚焦“添加属性”。
- 组件文档：`MarkdownControl.md` 删掉“不支持 frontmatter 面板”，写属性面板一节。

## Spec 与文档改动

- [`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)：新增输出 39–4x“属性面板”（显示与收起、按文件记住、添加入口与 `---`、各类型的编辑、改类型、表示不了与写错、源码、撤销、键盘）与对应验收场景；不承诺加“全书统一的类型、日期时间类型、嵌套字段的表单编辑、属性名与值的补全”。
- [`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 22：编辑见属性面板；面板改了的字段按 YAML 重写，没改的字段、注释与写法原样。
- [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 的不承诺：去掉“frontmatter 面板”。
- 组件文档：`DateInput.md`、`TagInput.md`、`MarkdownProperties.md`、`MarkdownControl.md`。

## 切片

1. **nb-ui 两个输入**：`DateInput`、`TagInput` 与 Lab 场景、DOM 测试。自跑：`bun run test:affected --files`、`vue-tsc`、`lab-scenes` 里这两个组件。
2. **节点与编解码器**：frontmatter 语法、`doc` 的内容、读写；属性模型。自跑：编解码器的往返测试（含 fast-check：带 frontmatter 的任意文档不编辑时逐字节相同）、模型测试。
3. **面板**：节点视图、`MarkdownProperties`、守护、输入规则、键盘。自跑：DOM 测试（经点击与按键）。
4. **接入**：`MarkdownControl`、展开状态记录、命令与菜单、Spec 与组件文档。自跑：受影响的测试、类型检查、e2e。

每片单独提交；Spec 在第 4 片之前写好，与计划审查同一轮看。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 方言输出 22（不编辑时逐字节相同；改一个字段时别的字段与注释不变） | 编解码器往返测试、属性模型测试 |
| markdown-editing 新输出：显示、收起与摘要、按文件记住 | `MarkdownProperties` DOM 测试；e2e 重开文件仍展开 |
| 各类型的编辑、改类型、添加、删除、改名 | 属性模型测试；DOM 测试经点击与按键 |
| 表示不了、写错、源码 | 模型测试；DOM 测试 |
| 撤销 | DOM 测试：改值后在正文里 Ctrl+Z 回到原值 |
| 添加入口（命令、斜杠、更多、`---`） | DOM 测试；e2e 经斜杠菜单添加 |
| 全选删除不丢 frontmatter | DOM 测试 |
| nb-ui 两个输入 | 各自 DOM 测试与 Lab 场景 |

## 验证

- 每片：`bun run test:affected --files`（再去掉 `--files` 跑一次），`tsc --noEmit`、两份 `vue-tsc`。
- e2e：新文件 `e2e/markdown-properties.e2e.ts`（打开带 frontmatter 的文件、展开、改一个值、保存后磁盘上只变这一行、重开仍展开、斜杠菜单添加属性）。合入前跑一次：`markdown-properties`、`markdown-editing`、`markdown-input`、`editor-area`、`lab-scenes`（新组件与场景）。之后只重跑改到的文件与失败项。
- 未验证边界：真实输入法在属性值里组字（CDP 不能代表），留给开发者试用。

## 不做与风险

- 不做：全书统一的类型；日期时间类型；嵌套字段的表单编辑；属性名与值的补全；多文件批量改属性；源码编辑器（Monaco）里的面板。
- 风险：编解码器改动破坏“没编辑就写原文”。由 fast-check 往返测试兜底，用真实的编解码器与带 frontmatter 的生成文档。
- 风险：节点视图里的输入框与 ProseMirror 抢焦点、选区（点值、Tab、Esc 回正文）。DOM 测试经真实按键，e2e 再走一遍。
- 风险：守护插件补回节点时与撤销历史交错。DOM 测试覆盖“全选删除后撤销”。
