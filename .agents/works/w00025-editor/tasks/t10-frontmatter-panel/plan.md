# t10 属性面板：实施计划（第二稿）

第一稿经 Claude Sonnet 设计审查（[`evidences/design-review-sonnet.txt`](evidences/design-review-sonnet.txt)，阻断 2、重要 8、建议 2），逐条处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)。第二稿的主要变化：frontmatter 从“编辑器文档的第一个子节点”改为“编辑器文档的属性”，面板从节点视图改为控件层的组件；改一个字段只替换这一项的原文，不用 `yaml` 重新整段写出。

## Context

Markdown 文件开头的 frontmatter 现在不进富文本（方言 Spec [`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 22“它的编辑另定”），要改只能换到源码编辑器。这个 Task 在正文上方加属性面板。

开发者已定（评审板第 1 轮，见 [README](README.md) 的“决定”）：

1. 卡片样子（淡底，没有线）；细节以第 2 轮问题 6 的答复为准。
2. 打开文件时缺省收起成一行摘要，展开状态按文件记住。
3. 没有 frontmatter 时不画；从命令面板、更多菜单、斜杠菜单添加，或在文件开头打 `---`。
4. 类型按值推断（文字、数字、勾选、日期、列表），点类型图标能改；不做全书统一的类型登记。
5. 表示不了的字段退回只读的一行“在源码里改”；YAML 写错时整块显示源码并标出错处；注释、没动的字段与写法原样保留。

板上“不用答”的几条照做：面板在正文上方随正文滚动、宽度同版心；源码在面板里就地改；面板的修改进正文的撤销历史；属性之间上下键或 Tab 走、Esc 回到正文。

开发者在场，计划确认后实施；不 push。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| frontmatter 在编辑器里放哪 | 编辑器文档 `doc` 的属性 `frontmatter`（原文字符串或 null），改它用 `tr.setDocAttribute` | 撤销、重做走历史插件（`DocAttrStep`）；全选删除、剪切、粘贴、块菜单、位置偏移都碰不到它，不要守护；审查者用 prosemirror-transform 1.12 实验过改、撤销、重做、删除后撤销与全选删除 | 文档的第一个子节点：要守护插件（会拦掉撤销、重做与重载）、块菜单上移会丢块、写回要跳过它、块按钮与下标都要排除（审查第 2、3、4、10 条） |
| 改一个字段时保留别的字节 | `yaml` 的 `parseDocument` 只用来解析与定位（每一项的源码范围），改动按范围替换原文；新值用 `yaml` 单独写出一个标量或流式序列 | `Document.toString()` 会改写没动的项：块序列缩进、长行折行、`[x,   y]`、空行、`0x1F`（审查第 1 条，实测 yaml 2.9.0） | 整段 `toString()`；`js-yaml`：丢注释 |
| 日期输入 | reka-ui 的 `DatePicker`，包成 nb-ui `DateInput` | nb-ui 本来就建在 reka-ui 上，键盘与读屏现成；`@internationalized/date` 随 reka-ui 已装 | 原生 `type=date`：样子随浏览器；手写日历 |
| 列表输入 | reka-ui 的 `TagsInput`，包成 nb-ui `TagInput` | 回车、退格、组字期间不提交都现成；分隔符可给正则 | nb-form 的 `string-list`：设置表单的样子 |
| 属性的一行 | 不经 nb-form，在控件层复用 nb-ui | 先有值后有类型、名字能增删改、类型能换；nb-form 是先有 schema 再画（第 2 轮评审板“答复：能不能复用 nb-form”） | `SchemaField` 加紧凑样式 |

## 关键设计

### nb-ui：`DateInput`、`TagInput`（`packages/nb-ui/src/components/form/`）

- `DateInput`：值是 `YYYY-MM-DD` 或 `null`；`variant: "default" | "bare"`、`size` 同 `Input`；点值、Enter 或下方向键打开日历浮层，周首日按界面语言（`getWeekStart`，中文为周一），选一天即确定，Esc 关；清空（删掉文字或日历里的“清除”）给 `null`。
- `TagInput`：值是 `string[]`；两种外观；每项一个淡底小块，改的时候带 ×；末尾接着打，Enter 或分隔符（`,`、`，`、`、`）加一项，空着按退格删最后一项；组字期间不提交（reka-ui 自己跳过）；去重、去掉首尾空白。
- 每个组件先写同名 `.md` 再写 `.vue`；登记 Lab 场景（含 390px 与英文场景）；DOM 测试经键盘与点击。nb-ui 的 `package.json` 显式加 `@internationalized/date`。

### nb-markdown：文档属性与编解码器

- 文档节点：core 的 StarterKit 关掉 `document`，core 自己给 `doc`（内容仍是 `block+`），带属性 `frontmatter`（缺省 `null`）。展示器、提示词编辑器也是这个 schema，属性一直是 `null`，不分两份语言。
- 读（`codec/read.ts`）：`SourceMap` 把 BOM 单独存一个字段（`bom`），`prefix` 照旧是 BOM 加 frontmatter 原文。读出的文档 `attrs.frontmatter` = 前缀去掉 BOM 后的原文（没有为 `null`）。
- 写（`codec/write.ts`）：“这次的前缀” = `bom` + `doc.attrs.frontmatter ?? ""`。`writeOnce`、`plainFallback`（抢救正文）、文末闭合补换行、前缀校验、结果文字五处都改读它。属性没改时与 `map.prefix` 相同，所以未编辑的文档仍逐字节写原文；正文的块不变。
- 前缀校验（`write.ts` 的“正文开头会被读成 frontmatter”）抽成一个函数 `isWholeFrontmatter(raw)`：`raw` 加上一个正文探针后，`splitFrontmatter` 切出的前缀恰好是 `raw`。面板提交前用同一个函数挡下缺围栏、中间有单独一行 `---` 的源码（第 5 条），写回不会因此进入“写不出”。
- 重载（`codec.reload`）：比较正文之外，再比较 `attrs.frontmatter`，不同就在同一笔事务里 `setDocAttribute`（不进历史，同正文的替换）。

### nb-markdown：属性模型（`editor/properties/model.ts`，纯 TS）

- `readProperties(raw)` → `{ok: true, rows}` 或 `{ok: false, line, message}`。写错包括：YAML 语法错、重复键（`DUPLICATE_KEY`）、顶层不是映射、多文档、指令。空 frontmatter（`---\n---\n`）与只有注释的是“零行、合法”。
- 一行以它在映射里的下标与源码范围定位，不以键名（键可能是数字、布尔）。显示名 `String(key)`；非标量键与合并键 `<<` 的行是“复杂”。
- 推断：布尔为勾选；数字为数字；`YYYY-MM-DD`（带不带引号都算）为日期；全是标量的序列为列表；`null` 与空为文字（空值）；映射、含映射的序列、多行字符串、块标量、锚点与别名为复杂。日期时间（`2024-01-01T10:00:00Z`）按文字。
- 编辑都返回新的 `raw`，只替换被改那一项的源码范围，其余字节不变：`setValue`（保持原来的引号风格；文字值按 YAML 1.1 与 1.2 都读回同一个字符串，`yes`、`no`、`on`、`off`、`~` 这类加引号；清空写回 `null`，原来是 `""` 的保持 `""`）、`rename`（与已有显示名相同时拒绝）、`remove`（这一项的行，连同行尾注释；它上方紧贴的注释留着）、`add`（末尾追加一行 `名字:`）、`changeKind`。
- 改类型只做无损的：文字与数字互转（能解析时）、文字与日期互转（值合格或为空时）、文字转列表（整串作为一项）、只有一项的列表转文字、勾选与文字（`true`、`false`）。别的组合在菜单里置灰。
- 换行符：沿用 `raw` 自己的；新建时用文档的换行符（宿主给出）。`raw` 文末不带换行时改完也不带。
- `nb-markdown` 加依赖 `yaml`（只进 `./editor` 入口）。

### nb-markdown：面板组件（`editor/properties/MarkdownProperties.vue`）

- 控件层的组件，不在 ProseMirror 的 DOM 里：输入、焦点、样式都不与正文交错，`.nb-markdown` 的正文样式碰不到它。
- 输入：`raw`、`readonly`、`open`（展开状态）、`eol`；输出：`commit(raw)`（宿主用 `setDocAttribute` 提交成一笔事务）、`update:open`、`leave(direction)`（Esc 或从第一行往上、最后一行往下时把焦点交回正文）。
- 卡片、头行（折叠、收起时的摘要、源码切换）、各行（类型图标与菜单、属性名、值）、“添加属性”、源码区（等宽 `Textarea`，失焦或 Ctrl+Enter 提交，先过 `isWholeFrontmatter`，不合格时留在源码区并标出原因）。写错时不管记下的展开状态都展开，摘要行也标错。复杂字段那一行的“在源码里改”打开源码区并把光标放到这一项的行。
- 草稿：每个输入在 `input` 时登记到组件的“待交”里，`flush()` 同步把它提交成一笔事务。宿主在 `commitNow`、换文档、`reload` 之前先调 `flush()`；控件交给 `binding.attach` 的“手里有没有没交出的输入”也算上待交（自动保存据此顺延）。
- 撤销：焦点在面板的输入框里时，Ctrl+Z 是输入框自己的撤销（只撤草稿）；草稿提交后，在正文里 Ctrl+Z 撤这一笔。实现时核对工作台的快捷键层对可编辑目标的处理，写进验收。
- 只读：`readonly` 时不能改值、不出“添加属性”与类型菜单，源码区只读。

### nb-markdown：输入规则（`editor/frontmatter-rule.ts`）

- 文档没有 frontmatter、光标在第一个块开头、打出 `---` 或 `—-` 时：删掉这三个字符，`setDocAttribute` 一个空的 frontmatter（`---` 两行，换行符取文档的），面板展开并把焦点放到新属性名（面板挂载后的下一帧）。光标后原有的文字留在第一段。
- 优先级高于 StarterKit 的分隔线规则；有 frontmatter 时或不在第一块开头时不命中，`---` 照旧是分隔线。触发后立即按退格还原成 `---` 文字（Tiptap 的 `undoInputRule`）。要在文件开头放分隔线，用 `***`。

### neuro-book：接入（`packages/neuro-book/src/plugins/markdown/`、`editor/`）

- `MarkdownControl` 在版心（`.markdown-control`）里、编辑器内容之前挂 `MarkdownProperties`：在版心里面，展开、收起时版心的高度跟着变，批注页边的 `ResizeObserver` 照常重排（审查第 10 条补充）。文档的 `frontmatter` 属性为 `null` 时不挂。
- 正文第一块开头按上方向键进面板的最后一行；面板交回焦点时正文光标回到原处。
- 写不出的提示照旧指向正文的块（frontmatter 不是块，不占下标）。
- 展开状态：新记录 `editor.properties-open`（项目分区、本机），内容是“文件地址 → 展开”的映射，最多 200 项、按最近使用淘汰；提交用 `commit((current) => 只改这个文件)`，几个窗口各改各的文件不互相覆盖。没有绑定作品时只在内存里记（同 `memoryCommentMargin`）；记录读不出、保存失败时按收起，切换只改显示、不重试。文件改名后旧状态丢失（已知限制）。
- 命令 `nbook.edit.properties`（“添加属性”）：进编辑动作目录，斜杠菜单的 blocks 组、工具栏的更多菜单、命令面板都有；没有 frontmatter 时建一个空的并聚焦新属性名，有时展开面板并聚焦“添加属性”。
- 组件文档：`MarkdownControl.md` 删掉“不支持 frontmatter 面板”，写属性面板一节。

## Spec 与文档改动

- [`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)：新增输出 39 起“属性面板”：
  - 显示与收起、摘要；按文件记住，写错时总展开；
  - 添加的入口与 `---`（只在没有 frontmatter、第一块开头；退格还原；文件开头的分隔线用 `***`）；
  - 各类型的编辑、改类型（只做无损的）、添加、删除、改名；
  - 表示不了与写错、源码、在源码里改的跳转；
  - 撤销的归属、键盘进出；
  - 只读与写不出时的表现。

  对应验收场景；不承诺加“全书统一的类型、日期时间类型、嵌套字段的表单编辑、属性名与值的补全、拖动排序、隐藏面板的设置、不特殊处理 `tags`、`aliases` 这类键”。
- [`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 22：编辑见属性面板；面板改一个字段只替换这一项的原文，别的字节不变；文字值写出后按 YAML 1.1 与 1.2 都读回同一个字符串。验收场景 1 补“面板改一个值后”的一句。
- [`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)：不承诺里去掉“frontmatter 面板”；“副作用与数据”登记记录 `editor.properties-open`。
- 组件文档：`DateInput.md`、`TagInput.md`、`MarkdownProperties.md`、`MarkdownControl.md`。

## 切片

1. **nb-ui 两个输入**：`DateInput`、`TagInput` 与 Lab 场景、DOM 测试。
2. **文档属性与编解码器，接进控件**：`doc` 的属性、`bom`、读写与重载、`isWholeFrontmatter`；`MarkdownControl` 挂一个只读的占位（只显示源码）。当场跑 `editor-area.e2e.ts` 里含 CRLF 与 frontmatter 的两个用例（“打开、切走、关闭不改字节，编辑最后一段只变一行”与“换源码编辑器再换回”），确认写回在真实运行时没变。
3. **属性模型**：读、推断、各项编辑与改类型，按范围替换。
4. **面板与输入规则**：`MarkdownProperties`（替换占位）、草稿与 `flush`、只读、键盘进出、输入规则、命令与菜单、展开状态记录、Spec 与组件文档、e2e。

每片单独提交；Spec 在第 4 片开始前写好。

## 验收映射

“DOM”是 Vitest 加 happy-dom 能测的；Tab 走焦点、真实键入的输入规则、ProseMirror 的焦点与原生撤销只在 e2e 测。

| Spec | 覆盖 |
|---|---|
| 方言输出 22：不编辑逐字节相同 | 编解码器 fast-check：任意带 frontmatter（BOM、CRLF、文末闭合不带换行、空 frontmatter、正文为空或只有空行）的文档不编辑时写原文 |
| 方言输出 22：改 frontmatter 后正文不变 | fast-check：任意合格的 `raw` 换进去，写出 = BOM + 新 `raw` + 原正文字节；不合格的 `raw` 被 `isWholeFrontmatter` 挡下 |
| 方言输出 22：改一个字段只换这一项 | 属性模型 fast-check：任意规整或不规整的映射，改一项后别的项的源码切片逐字节相同；模型测试：数字键、`yes` 加引号、清空写 `null`、引号风格保留、重复键算写错、空 frontmatter 合法 |
| 撤销、重做 | DOM：改值、添加、删除全部属性后撤销与重做；e2e：面板改值后在正文 Ctrl+Z |
| 重载 | DOM：外部改了 frontmatter，面板更新、不进历史；草稿先结算 |
| 显示、收起与摘要、按文件记住、写错总展开 | DOM；e2e 重开文件仍展开 |
| 各类型的编辑、改类型、添加、删除、改名 | 模型测试；DOM 经点击 |
| 表示不了、写错、源码、跳转 | 模型测试；DOM |
| 添加入口：命令、斜杠、更多 | DOM；e2e 经斜杠菜单 |
| 添加入口：`---`、退格还原 | e2e（真实键入） |
| 键盘进出、Esc 回正文 | e2e |
| 只读 | DOM；e2e：文件被外部删除后面板不能改 |
| 写回字节 | e2e：带 BOM、CRLF 的文件经面板改一个值后保存，磁盘只变那一行 |
| nb-ui 两个输入 | 各自 DOM 测试与 Lab 场景 |

## 验证

- 每片：`bun run test:affected --files`（提交前去掉 `--files` 再跑一次），`tsc --noEmit`、两份 `vue-tsc`（改了 e2e 或测试之后再跑一次）。
- e2e：第 2 片跑 `editor-area` 的两个用例；第 4 片新文件 `e2e/markdown-properties.e2e.ts` 写上表里的 e2e 项。合入前跑一次：`markdown-properties`、`markdown-editing`、`markdown-input`、`editor-area`、`lab-scenes`（新组件与场景）；之后只重跑改到的文件与失败项。
- 未验证边界：真实输入法在属性值里组字（CDP 代表不了），留给开发者试用。

## 不做与风险

- 不做：全书统一的类型；日期时间类型；嵌套字段的表单编辑；属性名与值的补全；拖动排序；隐藏面板的设置（Obsidian 的“显示、隐藏、源码”三态，这里只有展开与收起）；`tags`、`aliases` 这类键的特殊处理；多文件批量改属性；源码编辑器（Monaco）里的面板。
- 风险：编解码器改动破坏“没编辑就写原文”。由第一条 fast-check 兜底，用真实的编解码器，生成器覆盖 BOM、CRLF 与几种边界。
- 风险：按范围替换写错位置。属性模型的 fast-check（改一项、别的项切片不变）用真实的 `yaml` 解析。
- 风险：草稿没结算就保存或换文档。DOM 测试覆盖“有草稿时保存、换文档、重载”。
