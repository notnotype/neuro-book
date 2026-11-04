---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: ui.forms
owners:
  - packages/nb-form
  - packages/nb-ui
---

# Schema 表单

## 目标与非目标

给整个项目一套按数据 schema 画出的表单：调用方交出一份 TypeBox（标准 JSON Schema）描述与当前值，表单按描述选控件、显示与编辑值、报告问题，值由调用方保管。设置（配置项与插件页面里的表单）、nbdev 的提问、Agent 向用户提问与审批、命令参数都用它。表单用 nb-ui 的控件画，本 Spec 同时规定这些控件为此要满足的合同。

不承诺：

- 生成式视图（模型生成、在沙箱里运行的界面）：另做，只复用本 Spec 的组件。
- 终端界面（TUI）的渲染：本 Spec 只规定每种控件在终端里退回成什么（输出 25），不画。
- 分步向导、日期时间、文件选择、颜色；字段之间除条件显示（输出 13）以外的联动。
- 表单自己取数据：选项、跨字段与异步校验由调用方算好交进来。
- 外观的细节（间距、色调的具体取值）：随 nb-ui 的设计语言，另行收口。

## 术语与参与者

- **描述**：一份数据 schema，加上可选的界面提示（`x-form`）与可选的布局。
- **字段**：描述里一个可编辑的值，有自己的路径与种类（输出 2）。
- **控件**：画一个字段的组件；内建控件由 nb-ui 与本包提供，调用方可以登记自定义控件（输出 22）。
- **字段外壳**：一个字段的标签、说明、必填标记、清除动作与问题标记，中间放控件。
- **问题**：校验或调用方给出的一条错误或警告，挂在一个路径上（输出 9）。
- **草稿**：文字、数字、JSON 控件里还没提交的输入（输出 15）。
- **编辑态**、**展示态**：表单的两种模式，后者给审批用（输出 17）。
- 参与者：调用方（设置、nbdev、Agent 宿主、命令面板）；`@notnotype/nb-form` 的核心（不依赖 Vue）与 Vue 渲染层；nb-ui 的表单控件；用户。

## 输入与前置条件

### 描述

数据是 TypeBox 生成的 JSON Schema，或手写的同等 JSON。界面提示：

- JSON Schema 自带的关键字：`title`、`description`、`default`、`readOnly`、`writeOnly`、`format`，以及类型约束（`minimum`、`maximum`、`multipleOf`、`minLength`、`maxLength`、`pattern`、`minItems`、`maxItems`、`uniqueItems`）。
- 其余放在命名空间键 `x-form` 里，校验器忽略它：

| 键 | 含义 |
|---|---|
| `label`、`help` | 盖过 `title`、`description` |
| `placeholder`、`unit` | 占位文字、数字的单位 |
| `widget` | 指定控件：`segmented`、`radio`、`select`、`search-select`、`checkboxes`、`multiline`、`secret`、`json`、`list`、`master-detail`、`confirm`，或已登记的自定义控件名 |
| `choices` | 字面量联合的选项：`[{value, label, description?, disabled?}]`，与字面量一一对应 |
| `options` | 动态选项源名（输出 11） |
| `searchable` | 选项要能搜索 |
| `visibleWhen` | `{field, schema}`：条件显示（输出 13） |
| `itemLabel` | 对象列表里当作每项标题的字段名 |
| `recommend` | 推荐的值，只作标记（写在选项的说明里，不预选），必须在选项里 |
| `rows` | 多行文字的初始行数 |

文字取值 `FormText` 就是[界面语言与消息目录](i18n.md)的文字值：字符串、目录里的键（文字引用，例如插件目录里的单位），或按语言给出的文字（例如 `{"zh-CN": "名称", "en-US": "Name"}`）。按语言给出的文字显示时取当前语言，没有就取 `en-US`，再没有取第一种，键不核对是不是语言标签；文字引用由渲染层经翻译端口按当前语言翻译（输出 24），核心没有目录，不翻译它。

### 布局

可选。`{type: "field", path}`、`{type: "column" | "row", items}`、`{type: "group", label, collapsed?, items}`。布局只排根上的字段（`path` 是根字段的 JSON Pointer），嵌套对象的成员按属性顺序排在对象里；布局漏写的根字段补在末尾。没有布局时按对象属性的顺序排成一列。布局与提示都不写宽度、颜色这类外观。

### 接口

```ts
// 核心（@notnotype/nb-form）
resolveForm(schema, {layout?}): FormModel
checkDescription(schema, {layout?, policy?: "trusted" | "agent"}): {status: "structured" | "json" | "invalid", problems: DescriptionProblem[]}
validateForm(model, value, {meta?}): FormIssue[]
setAt(value, path, next), removeAt(value, path)
fallbackWidget(widget: BuiltinWidget): TerminalWidget   // 终端里的退回画法（输出 25）

// Vue 渲染层（@notnotype/nb-form/vue）
<SchemaForm  :schema :layout? v-model :mode? :readonly? :disabled? :issues? :meta? :options? :widgets? :locale? :commit? :revision? :summary? @draft-state @focus-issue />
            // expose: commit(): boolean、reset(path?)、focusIssue(path): Promise<boolean>、focusFirstIssue(): Promise<boolean>
<SchemaField :schema :hints? v-model :id? :bare? :labelledby? :describedby? v-model:selected? （其余同上，没有 layout、summary、focus-issue） />
            // expose: commit(): boolean、reset()、focus(): Promise<boolean>；commit、reset 作用到字段里的全部成员
widgetLayout(schema, hints?): {block: boolean; width: "narrow" | "medium" | "wide" | "content"}
useFormText(): FormTextApi   // 在组件的 setup 里取表单当前用的翻译端口（输出 24），交给 describeIssues
describeIssues(schema, value, issues, text: FormTextApi, hints?): string[]   // 按看得见的先后，每条是“所在字段的名字：问题文字”，根上的没有名字
```

`SchemaField` 的 `bare` 只画控件：标签与说明由调用方画，出错的文字只给读屏、没有问题汇总；字段自己的状态（选项源不可用的原因、“已不存在”之类的警告）也不画，经 `field-state` 事件（`{error: string | null; warnings: string[]; status: string | null}`，变化时发出）交给调用方，由调用方画在自己的标题旁（输出 14）。调用方要在自己的位置写出出错原因时用 `describeIssues`。

## 输出与可观察行为

### 种类与控件

1. **支持的写法**：描述按下表推出每个字段的种类。表外的写法（`Record` 即 `patternProperties`、`additionalProperties` 是 schema 的对象、没有 `properties` 的开放对象、元组、允许重复的字面量数组、其它联合、其它数组、引用 `$ref`）与超过深度上限 6 层的部分，用 JSON 编辑；只降级这一个字段，不连累兄弟与父级。`additionalProperties` 省略与写 `true` 一样。`checkDescription` 把描述分成“可结构化编辑”“要用 JSON 编辑”“不合格”三类，不合格时返回问题列表，不抛异常。

| 写法 | 种类 |
|---|---|
| `boolean` | 布尔 |
| 字面量联合（`anyOf` 的 `const`，或 `enum`），值为字符串、数或布尔 | 单选 |
| 上面那种联合的数组，且 `uniqueItems: true` | 多选 |
| `number`、`integer` | 数字 |
| `string`（`format` 只认 `uri`、`email`） | 文字 |
| 字符串数组 | 字符串列表 |
| 有 `properties` 的对象；关闭额外属性（`additionalProperties: false`）的空对象也算，画成没有成员（命令的“无参数”） | 对象 |
| 元素是上一种对象的数组 | 对象列表 |
| `T` 与 `null` 的联合 | 按 `T`，清除写 `null`；两层的注解合并，外层优先 |

2. **控件选择**：没有 `widget` 时按种类选；有就用它，`json` 对任何种类都成立，其余内建控件要与种类相配、带上它要的提示（文字的下拉要有 `options`）；写了却没有生效的（与种类不配，或被别的规则盖过，例如有 `options` 时写 `multiline`、`writeOnly` 时写 `multiline`）按没写选，`checkDescription` 报 `widget-mismatch`。单选 3 项以内、各项都没有说明（也没有 `recommend` 标记，它写在说明里）、名字都不超过 16 个字符（各语言的名字都算）用分段控件，3 项以内的其余情况用横排单选组，多于 3 项用下拉，多于 15 项或 `searchable` 用可搜索的下拉；布尔用开关，`confirm` 用“是 / 否”单选组；多选用复选组；文字用单行输入，`multiline` 用多行，`writeOnly` 或 `secret` 用密钥输入（输出 31 做好之前按文字画）；对象画成一组字段；对象列表画成可增删排序的列表，`master-detail` 画成左列表右详情；JSON 用等宽文本框。

### 值

3. **受控**：表单不持有值。每次提交出一个新的根值；未改动的分支保持原引用，传入冻结的值也能用，表单从不原地修改传入的值。路径与值的形状不合（数组上的字符串段、小数或负数下标、越过末尾超过一位、中间遇到基本类型）时，`setAt`、`removeAt` 不改值、原样返回。
4. **缺失与清除**：表单不补默认值。缺值时，文字与数字的占位文字写“默认：X”（有 `default` 时），选择类不预选、在标题旁写“默认：X”，开关显示 `default` 的状态并标“默认”。可选字段有值时外壳给“清除”，清除删去这个键（不写 `undefined`、`0`、`""`），焦点回到这个字段的控件；必填字段没有清除。可为 null 的对象值为 null 时给“填写”，把它设成空对象。
5. **只读**：`readOnly` 的字段，以及父级 `readOnly` 下的全部成员，不能改；结构操作与 JSON 编辑同样不能改它们。这由表单统一的提交入口保证，不靠控件自己挡：用 JSON 编辑一个对象时改到其中只读的成员，这次提交被拒，字段报 `read-only`，草稿留着；字段变得不可改（只读、停用、展示态）时没提交的草稿作废。
6. **路径**：对外的路径是按 RFC 6901 转义的 JSON Pointer（属性名里的 `~`、`/` 转义），由表单自己生成；属性名 `"a/b"` 与嵌套的 `a.b` 是两个不同的路径。

### 校验与问题

7. **问题的形状**：`{path, code, params, severity: "error" | "warning", source: "schema" | "caller", message?}`。schema 的问题不带文字，显示时按 `code` 与 `params` 以当前语言写出；调用方的问题可以带 `message`。
8. **校验**：`validateForm` 逐个字段校验：必填缺失报在缺的那个字段上（`required`，包括 `required` 里有、`properties` 里没有的键）；每个字段自身的约束（对象的 `minProperties`、`dependentRequired`，数组的 `minItems`、`contains` 等）都报；单选与多选的值不是选项之一报一条 `not-in-choices`，JSON 字段里不满足联合任何一支报一条 `no-match`（`enum` 与 `const` 仍是 `not-in-choices`），都不报每一支的错误；最后对整值检查一次，字段树没有表达的约束（JSON 字段与引用里的，包括引用里对象的必填与额外属性）按位置报在那个 JSON 字段上，归不到字段的记在根上；同一位置同一个码只报一次。校验中的异常（例如写错的正则）记为出错的那个字段上的 `schema-error`，不抛出。
9. **调用方的问题**：跨字段、异步、服务端的校验由调用方算好，经 `issues` 交给表单，与 schema 的问题一起显示；表单不调用调用方的校验函数。异步结果过期由调用方按值的版本丢弃。
10. **带外状态**：`meta` 按路径给出值之外的状态。`writeOnly` 的字段在 `meta` 说“已设置”时不报必填。

### 选项

11. **选项源**：`options` 指向调用方给的源，源是 `{status: "ready", items} | {status: "loading"} | {status: "unavailable", reason}`，可以是响应式的、可以按表单值计算。加载中显示加载；不可用时字段停用并显示原因。
12. **选项的值与“已不存在”**：选项值可以是字符串、数或布尔，`1` 与 `"1"`、`true` 与 `"true"` 是不同的选项。当前值不在选项里时照常显示并标“已不存在”（警告），值保留，不算错误；选项变化不改值。带 `disabled` 的选项不能选。

### 条件与显示

13. **条件显示**：`visibleWhen.field` 指同一个对象里的兄弟字段（数组项里是同一项的兄弟），以 `/` 开头时指根上的字段；那个字段的值满足 `schema` 时显示。求值只做 schema 检查，不执行任何代码；字段缺值时按缺值检查。隐藏只影响显示：值保留，完整的 schema 照样校验。必填字段上不许写 `visibleWhen`（`checkDescription` 报不合格），条件里写错的正则、指向不存在的字段同样报不合格；运行时条件求值仍出错时按显示处理。隐藏的字段不卸载，草稿与折叠状态在重新显示后还在。
14. **问题的显示**：字段只标出错（`aria-invalid`），第一条错误的文字给读屏；警告不标出错，用图标与色调。字段标题后面有出错图标（危险色）或警告图标，悬停图标或焦点在控件上时用提示（nb-ui `Tooltip`，不用浏览器原生的 `title`）显示第一条错误或全部警告；图标的出现与消失不改变字段的高度。只有控件、标题由调用方画的字段（`bare`）不画图标，把第一条错误与警告交给调用方画在它自己的标题旁（开发者 2026-10-22 定）。看得见的文字集中在一个固定位置：`SchemaForm` 底部一行问题汇总（“N 个问题”，展开列出，点一条聚焦到字段）；调用方可以关掉它（`summary: false`），经 `focusIssue(path)`、`focusFirstIssue()` 放到自己的固定位置。聚焦一条问题时，字段在折叠的分组、折叠或别的页的列表、未选中的详情里就先打开它们；焦点确实移过去了才发出 `focus-issue`、resolve 为 true。汇总按看得见的先后排（根上的字段按布局，往下按成员与列表项的下标），列表项里的问题写出项的标题（“人物 · 林照 · 名字”）。被条件隐藏的字段上的问题不进汇总，也不计入问题数（校验照样报给调用方；开发者 2026-10-20 定）。字段下不插文字，排版不因校验结果跳动（没有问题时汇总一行照样占位）。必填缺失在字段失过一次焦点、或调用方调用 `commit()`、`focusIssue`、`focusFirstIssue()` 之后才显示，其余问题一直显示：新打开的表单不一上来满屏标红。折叠的分组与列表项在头部标出“含 N 个问题”。

### 提交与草稿

15. **提交时机**：`commit` 缺省为 `change`：文字、数字、JSON 在失焦或回车时提交，开关与选择类立即提交；`input` 时每次输入提交。解析不了的草稿（`1.`、`-`、残缺的 JSON）不提交，以 `draft-state`（`{path, state: "clean" | "dirty" | "unparseable", issues}`）报告；失焦或回车提交失败一次之后，`issues` 里才有 `unparseable`，字段标出错、汇总列出，输入到一半的 `-` 不马上标红。可选的数字清空后离开是清除，必填的算解析不了。
16. **外部更新**：传入的值或 `revision` 变化时，没有焦点的字段丢掉草稿、显示新值；有焦点的字段保留草稿。调用方在写入被拒、值没变时把 `revision` 加一，字段回到实际值。`reset(path?)` 与 `commit()` 可以由调用方显式调用。

### 模式

17. **展示态**：`mode: "view"` 时文字类的值画成可换行的静态内容，超长时折叠、可展开；多行、JSON 与长的文字（40 字以上或有换行）给“复制”按钮，短值可以直接选中复制；只有展开与复制按钮是 Tab 停靠点。对象与列表照样排成结构，没有结构操作。“同意 / 拒绝”这类动作由调用方画。
18. **只读与停用**：`readonly` 与 `disabled` 向下传给每个字段；只读的控件可以聚焦、可以复制、不能改，停用的控件不进 Tab 顺序。

### 列表编辑

19. **增删排序**：列表每项有稳定的身份，不随删除与排序串到别的项；添加后焦点进新项的第一个控件；删除后焦点到下一项的同类控件，没有就上一项，列表空了到“添加”；排序用“上移 / 下移”按钮与 `Alt+↑ / ↓`，焦点跟着被移动的项，读屏播报移动结果。焦点在调用方把新数组传回来、渲染出来之后才移；传回来的可以是内容相同的副本（经过 JSON 或 RPC）；连着几次操作都在传回之前发出时，身份跟着最后采纳的那次；调用方没采纳时身份与焦点都不动；调用方先采纳、随后又传回采纳之前的数组（写入失败）时换回原来的身份，焦点留在原处，播报“刚才的改动没有生效”；外部换成长度不同、或不是本表单发出过的数组时重建身份。焦点在多行文字框或下拉上时 `Alt+↑ / ↓` 留给它们。`minItems`、`maxItems` 到界时停用删除或添加；`uniqueItems` 下的重复项标问题（与校验同一种等值判定）；空列表显示“还没有项”与“添加”；超过 50 项默认折叠成“N 项”，展开后分页。
20. **左列表右详情**：`v-model:selected` 给出选中项；新增项自动选中并聚焦详情；删除选中项后选中下一项；列表项的选中区与操作按钮并列，不嵌套按钮；项标题取 `itemLabel` 的字段，空时写“第 N 项”。

### 表单根

21. **根元素**：`SchemaForm` 的根是 `role="group"` 的容器，不是 `<form>`，回车不隐式提交，可以放进调用方自己的 `<form>`。渲染的递归深度与核心的上限相同；折叠的分组与未选中的详情不挂载：里面写坏而没能提交的草稿随之丢掉（能解析的草稿在失焦时已提交）。

### 自定义控件

22. **登记**：`{name, component, score(node) => number | null, fallback}`。组件收到 `{modelValue, node, readonly, disabled, invalid, id, labelledby, describedby, locale, issues, options, meta}`（`locale` 是表单当前用的语言，输出 24；`id` 写在可聚焦的元素上、外壳的 `<label for>` 指向它；由几个元素组成的控件用 `labelledby` 写 `aria-labelledby`），发出 `update:modelValue`（草稿，按输出 15 的时机提交：`change` 时在 `commit` 事件或焦点离开字段时）与 `commit`，暴露 `focus()`。显式写了 `widget` 时直接选中；写的名字没登记时按这个种类的内建控件画；没写时参与打分，返回 `null` 或不大于 0 表示不适用，得分最高的压过内建控件。与内建名或已登记名重名时登记报错（`FormWidgetError`）。

### Agent 生成的描述

23. **Agent 策略**：`checkDescription(…, {policy: "agent"})` 只接受这个子集：根是对象；种类限于布尔、单选、多选、数字、文字、字符串列表、对象、对象列表，不许要用 JSON 编辑的字段；根对象之下至多一层对象（对象列表的元素算一层）；不许 `pattern`、`patternProperties`、`writeOnly`、`$ref`、`$defs`、`allOf`、`oneOf`、`not`、`if`、`contains`、`propertyNames`、`prefixItems`、`dependentSchemas` 与自定义控件、`secret` 控件，`format` 只认 `uri`、`email`；schema 嵌套至多 8 层（`anyOf` 等组合器的每一层都算），节点至多 100、联合宽度至多 50、描述 JSON 至多 32 KB、每段文字至多 2000 字符，布局一起计入节点、字节与文字长度。关键字只在 schema 的位置上识别，名叫 `pattern` 的字段不算；条件里的 schema 同样检查。不合格时返回问题，从不抛异常。可信作者写的 `pattern` 照常支持，异常按输出 8 处理。

### 文字

24. **内建文案**：表单自己的文字（添加、删除、上移、下移、第 N 项、N 项、已设置、未设置、清除、替换、已不存在、推荐、默认、是、否、问题汇总，以及按码写出的问题文字）在本包自带的消息目录里（命名空间 `nb-form`，源语言 zh-CN，中英两份，经 `@notnotype/nb-form/locales` 导出），按[界面语言与消息目录](i18n.md)显示。宿主注入了翻译端口时登记这份目录，语言以端口为准，`SchemaForm`、`SchemaField` 的 `locale` 不起作用；没有注入时表单的根按 `locale`（缺省 zh-CN）用缺省端口，交给其中的字段、控件与 nb-ui 控件，在表单的根之外取文字（例如调用方为 `describeIssues` 调用 `useFormText`）时用中文。缺省端口里目录没有的语言按源语言显示中文。用到的 nb-ui 控件里写死的读屏名称（增加、减少、清空输入、展开选项）由表单按当前语言覆盖。宿主注入了端口却没有登记本包目录时，本包的文字显示为键名，由宿主的翻译引擎报缺键，不悄悄换成包内的中文。

### 终端退回

25. **退回规则**：每种控件在终端里退回成一种基础画法：开关与确认为是 / 否；单选（含分段、下拉、可搜索下拉）为上下键选择；多选为带勾的列表；数字与文字为一行输入；多行与 JSON 为打开外部编辑器；密钥为遮住字符的输入；列表为逐行编辑；对象为缩进的字段组；自定义控件按登记的 `fallback`，没写按它的种类。`fallbackWidget` 给出这份对照。

### nb-ui 控件合同

26. **统一的属性**：`Input`、`Textarea`、`NumberInput`、`Checkbox`、`CheckboxGroup`、`RadioGroup`、`SegmentedControl`、`Select`、`Switch`、`SearchSelect` 都满足（`SecretInput` 随输出 31 以后做）：`modelValue` 可选，`undefined` 有安全的显示；`disabled`；`readonly`；`invalid` 时输出 `aria-invalid` 与出错外观；从 `Field` 的上下文取 `id`、`aria-describedby`、`required`、`invalid`，也接受同名属性。
27. **组合控件的名字**：`Field` 有“组”形态（根不是 `<label>`，标签是带 id 的元素），上下文给出 `labelId`；单选组、分段控件、复选组读 `labelId` 写 `aria-labelledby`。组里的单个复选框不读字段上下文，id 不重复，字段出错只标在组上。`Switch` 没有缺省的 `aria-label`，名字来自字段标签或调用方。`useFieldContext`、上下文类型与键从 `@notnotype/nb-ui/components` 导出。
28. **只读的语义**：只读的控件可以聚焦，写 `aria-readonly`，点击、空格、方向键都不改值；下拉不打开浮层；文字可以选中复制。每种控件在“停用”“只读”下的键盘、指针与 Tab 顺序按下表：

| 控件 | 只读时 |
|---|---|
| 开关、复选 | 可聚焦；点击与空格不切换 |
| 单选组、分段控件 | 可聚焦当前项；方向键不移动选中 |
| 下拉、可搜索下拉 | 触发器可聚焦；不打开浮层 |
| 单行、多行、数字 | 原生 `readonly` |
| 密钥 | 只显示状态，没有替换与清除 |

29. **单选组横排**：`RadioGroup` 有横排，作为表单里 3 项以内、带说明或名字长的单选；其余 3 项以内的单选用分段控件（输出 2）。
30. **可搜索的下拉**（`SearchSelect`）：输入的文字只是搜索词，只有选中选项才改值，失焦恢复显示已选项；列表项的样子、截断与滚动与 nb-ui 的其它弹出列表相同。
31. **密钥输入**（`SecretInput`，planned：凭据存储搁置，见下文“边界与兼容”；在此之前 `writeOnly` 与 `secret` 的字段按文字画）：`state` 为 `set`、`unset`、`unreadable`；`modelValue` 是新输入的值；“清除”发出 `clear` 事件；从不显示已有的值；`autocomplete="new-password"`。

## 状态与转换

一个文字、数字或 JSON 字段：

| 当前 | 事件 | 下一状态 |
|---|---|---|
| 干净 | 输入 | 草稿（可解析或不可解析） |
| 草稿（可解析） | 失焦、回车（`change`）或每次输入（`input`） | 提交，回到干净 |
| 草稿（不可解析） | 失焦、回车 | 保留草稿，报告 `unparseable`，不提交 |
| 草稿 | 外部值或 `revision` 变化，且没有焦点 | 丢掉草稿，回到干净 |
| 任意 | `reset(path)` | 干净 |

**时序与寿命**：

- 一次提交只发出一个新的根值；同一事件里不会对同一字段发两次。
- 条件显示的切换不改值，因此不会触发别的条件。
- 选项源从 `loading` 变成 `ready` 不改值；当前值不在新选项里时按输出 12 显示。
- 列表项的身份在一次挂载内稳定；外部整体替换为与最近发出的值不同的数组时重建。

## 副作用与数据

无。表单不写存储、不发请求；值、问题、选项与带外状态都由调用方给出与保管。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `required` 等约束码 | 值不满足 schema | 让用户改；表单已经标出 |
| `not-in-choices` | 值不是选项之一 | 同上 |
| `no-match` | 值不满足联合里的任何一种写法 | 同上 |
| `unparseable` | 草稿解析不了 | 等用户改；不提交 |
| `read-only` | 提交会改到只读的成员（JSON 编辑） | 等用户改回；不提交 |
| `schema-error` | schema 本身求值出错（例如写错的正则） | 修描述；表单照常显示其余字段 |
| 描述检查的问题 | 描述不合格或违反 Agent 策略 | 不渲染这份描述，把问题交回给描述的来源 |

## 边界与兼容

- **公开接口**：`@notnotype/nb-form` 的核心与 `./vue` 入口；nb-ui 上述控件的属性与事件。`x-form` 的键只增不改。
- **依赖**：核心只依赖 `typebox`，另从 `@notnotype/nb-ui/text` 只取类型（文字值的形状）；Vue 层只依赖 `vue`、`@notnotype/nb-ui` 与核心，不依赖应用与宿主的服务，以便以后打进生成式视图的沙箱。
- **信任**：可信作者（插件、设置）写的描述按完整写法支持；模型生成的描述必须先过 Agent 策略。
- **密钥**：应用的凭据存储暂不做，密钥输入（输出 31）与它的验收（场景 1 里的密钥项）随凭据存储一起做；在此之前没有使用方。
- **与 nb-ui 规范**：输出 26–31 是 nb-ui 表单控件的合同，真相源在本 Spec（有验收映射），nb-ui 规范的“表单与无障碍”链到这里（开发者 2026-11-04 定）；`ui-development-spec.md`“同类零件的分工”（表单里 3 项以内、没有说明的单选用分段控件，其余单选用单选组或下拉）在本 Spec 里照用。

## 验收与 Smoke

1. **服务商连接**：一份含只读 ID、名称、API 地址、两种接口格式、密钥、并排的超时与重试、只在某种格式下显示的代理、扩展参数 JSON 的描述：控件按输出 2 选出；切换格式时代理显示与隐藏、填过的值保留；密钥只显示状态；超时输入 `1.` 时不提交；扩展参数写坏时报 `unparseable` 并在汇总里列出，点击聚焦到它。
2. **nbdev 四种题**：单选、多选（至少选一项）、文字（非空、至多 10000 字）、确认（未答是缺值）各一份描述，加上 nbdev 的适配器以调用方问题报告的规则（文字按 UTF-16 计长度、去空白后非空、不许控制字符），与 nbdev 现有的答复校验在合法与非法的边界上一致。
3. **审批展示**：一份带长路径与多行文字的参数在展示态里完整可见、可复制，Tab 只停在展开与复制按钮上。
4. **列表编辑**：对象列表添加、删除中间项、上移，焦点落点与读屏播报符合输出 19，删除后其余项的草稿不串位。
5. **Agent 策略**：带灾难性正则、超宽联合、`$ref`、密钥、自定义控件的描述都被拒绝，不抛异常。
6. **可访问名称**：在真实浏览器里，每种控件的可访问名称是字段标签，说明是字段说明，出错时有错误信息；组里的复选框 id 不重复。
7. **命令参数**：应用里每条已登记命令的 `args` 经 `checkDescription` 都是可结构化编辑。
8. **独立运行**：在空文档里不装插件、不 `provide`，每种控件、自定义控件、分组与展示态都能挂出与编辑，没有 Vue 的警告与错误。
9. **界面语言**：宿主注入了英文的翻译端口、表单的 `locale` 是 zh-CN 时，表单的文字（问题汇总、按码写出的问题）是英文，端口换成中文后不重新挂载就变成中文；描述里写成插件目录里的键的标签与单位跟着翻译。没有注入时 `locale` 为 en-US 显示英文，不传显示中文；在表单的根之外取文字用中文。

Smoke：Component Lab 里 `SchemaForm` 的场景覆盖上面 1、3、4，Playwright 断言可访问名称与焦点；设置窗口改用本表单后 `settings.e2e.ts` 照常通过（断言按新行为改写）。第 9 条有挂载测试（`packages/nb-form` 的 `*.dom.test.ts`），自带目录的文字由包内测试逐条对照。

## 证据

- 批准依据：开发者 2026-10-20 在 [w00027 t07](../../../.agents/works/w00027-plugin-platform/tasks/t07-low-code-forms/README.md) 确认的决定与 [实施计划](../../../.agents/works/w00027-plugin-platform/tasks/t07-low-code-forms/plan.md)；调研见 [`docs/research/low-code-forms.md`](../../research/low-code-forms.md)、[`docs/research/generative-ui-openui.md`](../../research/generative-ui-openui.md)。
