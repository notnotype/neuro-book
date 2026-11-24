# t41 实施计划：人物与形象两组设定（清单第一期）

2026-11-24 第 1 稿。开发者同日看过要点：“同意，同时还有静态稿可以再出一次”。同意的五条：

1. 种类的登记：一张“种类 → 默认带哪几组设定”的表，插件可以登记；新建人物直接带人物与形象，“添加一组设定”里适用的在前（清单第六节的第 1、2 条随之确认）。
2. 星瑕样本：外观搬到形象的“外貌”；“身体”“现在的样子”“现在的态度”变成星瑕这个条目上自己加的三项。
3. 就地展开本期只做人物、形象两个分页，其余分页照旧用页面顶上的确认条。
4. 动两个界面前再出一轮静态稿，与内核的几片并行。
5. 剧情变更里原样留着的旧补丁不再因为“不适用”拒收，新写的照旧拒收。

## Context

开发者 2026-11-23：“第一个设定组——人物，能放图片，并且提供一份生动的表单给作者填数据”；11-24 定了[内置设定组的清单](../t10-setting-schema/component-catalog.md)（第 3 稿）与评审板第 1 轮的四条答复（见 [README](README.md)）。本计划做清单的第一期：

- 人物重整成十个通用字段，形象（立绘、外貌、服装、现在穿的）单独成组；
- 人物分页是角色卡，立绘读自同一条目上的形象组；形象分页是大图、外貌、衣柜、现在穿的；
- 作者能在某个人物上自己加一项资料（预设里点，或自己写名字），能改名、去掉；
- 改一项时就地展开，不再跳到页面顶上的确认条；
- 图片能显示、能从作品里选、能上传；
- 新建人物直接带人物与形象两组；“添加一组设定”只列适用于这个种类的。

依据：[`canon/components.md`](../../../../../docs/specs/canon/components.md)（输出 4 写了实例字段的增、改名、删，内核的写入操作里没有）、[`canon/revisions.md`](../../../../../docs/specs/canon/revisions.md) 输出 25（一次改几处）、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md)（输出 4、12、13、16、38 与输入一节的两个贡献点）、[`canon/agent-tools.md`](../../../../../docs/specs/canon/agent-tools.md) 输出 6。

开发者已定的（不再讨论）：

1. 一个设定组是数据加展示，一个分页对应一个设定组；展示部分先用 Vue 组件，MDX 模板的想法记在 t38。
2. 形象单独成组，人物的展示可以引用它。
3. 改一项时就地展开；“添加”分两个入口（添加一项资料、添加一组设定）。
4. 预设选项做成可以自己填的建议值；模板不写示例内容。
5. 重整人物字段时直接改声明、重做样本，不做升级函数。
6. 界面的三处打磨要求：短项就地改不推动别的区域；有建议值的项用选择控件；引用条目的项用能搜索的条目选择。

写计划前跑过的探针（真实内核，脚本在本机 `/tmp/t41-probe/`，不入库）得到的事实：

- 条目初值里的 `declared` 改了以后，修订记成 `init.data.<命名空间>.declared[<字段 id>]`（新增、删除整项）、`….declared[<id>].label`（改名）与 `….declared#order`，都是现有的叶子写法。**日志格式不用改。**
- 删掉声明后值留在初值里、读不到；对它的 `set` 得到 `field-unavailable`；再声明同一个 id 时值与补丁都回来，种类不合时 `field-redeclare-mismatch`。与 components.md 输出 4、16 一致。
- 还原“加字段”的那次修订：之后的改名算依赖，之后剧情变更里对这个字段的补丁不算；还原后那些补丁按“不适用”跳过。与删声明的效果相同。
- 删掉被另一个字段的 `max` 指着的声明，世界层报 `type-mismatch`，路径是数组下标，看不出原因。
- 类型没开 `instanceFields` 时，直接写 `declared` 的请求世界层照收（值存下、读不到）。
- **旧限制**：一条剧情变更里有对已删字段的补丁时，之后再改这条变更的任何地方（哪怕只改文字）都被拒收（`unknown-field`）。去掉一整组设定今天就是这样（`component-disabled`），加了“去掉一项”以后更容易碰到。

## 技术选型

| 问题 | 选用 | 理由与否决 |
|---|---|---|
| 字段 id 的生成 | 内核已有的 `generateFieldId` | 已导出、有测试，只是没有生产调用方 |
| 图片的取图地址、列目录、上传 | 文件插件的服务 `filesKey`（`rawUrl`、`list`、`upload`） | 设定插件的浏览器入口已经可选依赖它；不另写上传接口 |
| 图片存放的目录 | 章节插图的规则（`editor/shared/image-location.ts`） | 一部作品只有一套“图放哪”；不在设定这边另定目录 |
| 浮层、选择、条目选择 | nb-ui 的 `Popover`、`Select`，设定插件的 `EntryPicker` | 都是现成的 |
| 可点选也可自己填的输入 | 第 2 轮稿子里定（nb-ui 现在没有能自填的下拉；候选是输入框加建议值按钮，或给 nb-ui 加一个组合框） | 属于界面决定，不在计划里先选 |

## 关键设计

### 一、内核：字段声明的三个写入操作（`packages/nb-canon/src/core/schema.ts`、`world/entry-edits.ts`）

`EntryOpSchema` 加三项，照 `listAdd`、`listRemove` 的命名：

```ts
// 字段声明去掉 id 必填：不写时由内核按 label 生成（generateFieldId）
{op: "fieldAdd", entry: Id, namespace: Text, field: FieldDraft, value?: unknown}
{op: "fieldRename", at: Address /* <命名空间>.<字段 id> */, label: Text}
{op: "fieldRemove", at: Address}
```

另外，`component` 的 `add` 与 `create` 里的 `components[]` 各加可选的 `declare: FieldDraft[]`：这一批新加的设定组，自己的字段在加它的那一项里声明（沿用“这一批新建的东西初值写在建它的那一项里”，不为 `fieldAdd` 开例外）。

规则（都在 `planEntries` 里判，改的是条目初值的工作副本，路由是 `entry`，世界层的校验照旧兜底）：

- 类型没开 `instanceFields`：`fields-not-declarable`。
- `fieldAdd`：id 不写就生成，写了要合法、没被现有声明占用；显示名与现有字段（固定的与实例的）重复：`label-taken`；数据里还没有 `declared` 时先补空数组；`value` 不写是未知。重新声明删过的 id 时留着的值恢复，带了 `value` 就用它；种类不合由世界层报 `field-redeclare-mismatch`。
- `fieldRename`、`fieldRemove`：只能动实例声明的；指到类型固定的字段：`field-fixed`；没有这个声明：`field-missing`；改名撞显示名：`label-taken`。
- `fieldRemove`：别的声明的 `max` 指着它时 `field-referenced`（带是谁指着），不落到世界层的 `type-mismatch`。
- 同一批里：两项 `fieldAdd` 可以并存（后一项看得到前一项占的 id）；对刚加的字段再 `set` 得到 `created-in-batch`；同一个字段既改名又删、或既 `set` 又删得到 `duplicate-address`（`fieldRename`、`fieldRemove` 的地址就是字段地址，`fieldAdd` 用 `$declared.<命名空间>[+序号]`）。
- 只在创作修改里有意义：`intent` 是 `story` 的一批里照样按改初值处理，同 `component`、`place`。

世界层（`world/world.ts` 的 `validate`）补两处：

1. 类型没开 `instanceFields` 而数据里有非空的 `declared`：新写或改过的拒收（`fields-not-declarable`）。只查新写或改过的，旧数据不受影响。
2. **原样留着的补丁不因为“不适用”拒收**：被碰到的剧情变更里，某处补丁不适用的原因是字段没声明、设定组去掉或没启用，而这处补丁与写入前存着的那份逐字相同时，不报问题；新写或改过的补丁照旧拒收。这样删字段、去掉一组设定、类型改了字段以后，旧的剧情变更还能改别的地方。这一条改的是已有的校验，是本计划里风险最高的一处，高风险审查的重点；审查认为不该在本 Task 改时，退路是不改、把它写进“不承诺”，并在“去掉一项”的预览里列出哪几条剧情变更里有对它的改动。

不改：修订的形状、`core/id-lists.ts`、日志格式、还原与依赖的算法、类型版本的比较。

### 二、内核：声明多三个只转交的属性（`core/schema.ts`、`components/registry.ts`）

| 属性 | 在哪 | 规则 |
|---|---|---|
| `suggestions?: string[]` | 字段声明 | 只用于 `text`；内核不校验值在不在里面；列表的子字段也可以带 |
| `kinds?: string[]` | 类型声明 | 这组设定适用的条目种类（条目的 `type` 那个词）；不写是没有特别适用的种类。只是提示，内核不拒收不适用的 |
| `presets?: FieldDeclaration[]` | 类型声明 | 只在 `instanceFields` 为真时可写；“添加一项”里列出的预设字段，id 要写、不与固定字段和别的预设重复，按 `fieldsProblem` 校验 |

`ComponentDeclarationSchema` 是 `additionalProperties: false`，三个都要加进 schema；`ComponentDeclaration`、`ComponentType` 两个接口与 `buildRegistry` 里逐项复制的那一段、`digest` 的输入都加上（登记变了的通知靠它）。`components` 读取返回的是登记的类型原样，界面与 Agent 都读得到，远程合同不用另改。

### 三、内置类型与样本（`packages/neuro-book/src/plugins/canon/shared/components.ts`、`scripts/canon-sample.ts`）

- **人物**（`nbook.canon.person`，命名空间 `character`，版本仍是 1，开 `instanceFields`，`kinds: ["人物"]`）：性别（建议值：男、女、不明）、年龄、身份、所属（引用，`targets: ["组织"]`）、性格（`retold`）、背景、说话方式（`retold`）、现在的状态（语义档）、现在在哪（引用，`targets: ["地点"]`）、生死（建议值：活着、已故、失踪）。`presets`：种族、生日、身高、喜好、弱点、动机、初次登场（都是文字）。
- **形象**（新，`nbook.canon.look`，命名空间 `look`，版本 1，开 `instanceFields`，`kinds: ["人物"]`）：立绘（图片）、外貌（文字，`retold`）、服装（列表：样子、图片；元素的名字用列表自带的 `label`）、现在穿的（文字）。
- 版本不升：升了以后旧数据整组只读、又没有升级函数。不升时，试验作品里旧字段的值留在数据里、界面上读不到，不报错（关键设计一的第 2 处保证旧的剧情变更还能改）。
- **面板**先不动（显示名改“数值”与它的预设项在第二期），只加 `kinds: ["人物"]`。
- 剧情插件的五个类型按各自的用法补 `kinds`（`plot/shared/declarations.ts`，实施时逐个对照它们 `targets` 的用法）。
- **星瑕样本**：`character.外观` 与马甲的 `identity.外观` 写到形象组的 `look.外貌`；`性格` 不变；星瑕这本书专有的“身体”“现在的样子”“现在的态度”变成星瑕这个条目上自己声明的字段（样本生成时带 `declared`，种类照原型：两个选项、一个语义档文字），原型里对它们的补丁地址不变。主文字源文里的 `.identity.外观`、`.character.外观` 一并换成 `.look.外貌`。
- 写死了旧字段名的地方跟着改：应用这一侧按字段名粗搜到 36 个文件（`canon` 与 `plot` 插件的测试与测试夹具、`canon-write`、`canon-author` 两份 e2e、样本的脚本与测试、两个性能脚本、Lab 的场景登记），其中一部分是剧情插件同名的“态度”，实施时先分清再改。内核的测试用自己的夹具与原型自带的声明，不受影响。先列全读法再逐处迁移，不批量替换。

### 四、条目的种类（新贡献点 `canon.entry-kinds`，`canon/shared/entry-kinds.ts`）

种类仍然只是条目上的一个词，内核不知道这张表。登记的是“这个词默认带哪几组设定”：

```ts
// 贡献 id 按插件 id 的前缀核对；不交实现；声明在插件清单里，各个位置都读得到
interface EntryKindDeclaration {
    kind: string;                 // 存进条目的那个词，例如 "人物"
    components?: string[];        // 新建这个种类时默认带的设定组（类型 id）
    order?: number;               // 新建对话框里的先后
}
```

- 内置登记四个：人物（人物、形象）、组织、地点、物品（后三个现在没有默认的设定组，第三期补）。
- 同一个词登记两次：两条都不用，写一条诊断（同命名空间撞名的做法，不按先后决定谁赢）。
- 用它的三处：新建条目的对话框（种类的候选 = 登记的，加上已有条目用过的；选了登记的种类就把默认的设定组勾上，作者还能改；空状态的“新建人物”改走这张表，不再写死人物的类型 id）、条目页的“添加一组设定”（适用的在前，其余收在“全部”里）、Agent 的 `create`（没写 `components` 时按种类的默认，写了就照写的）。

### 五、展示组件的接口（`canon/shared/component-views.ts`、`canon/web/component-views.ts`、`components/EntryPageHost.vue`）

贡献点 `canon.component-views` 的声明加 `uses?: string[]`（会用到的别的设定组的类型 id）。`ComponentViewContext` 加：

```ts
/** 同一条目上另一组设定：只能取声明里 `uses` 列了的；条目在所选位置上没有这一组时为 null。 */
other(type: string): ComponentPeer | null;
/** 给这个条目加上 `uses` 里的一组设定（一次创作修改）。 */
addComponent(type: string): Promise<{ok: true} | {ok: false; reason: Text}>;
/** 切到那一组的分页。 */
showTab(type: string): void;
/** 就地改的编辑器：界面把它放在字段的位置上，这个字段正在改时它画输入、意图、预览与保存取消，别的时候不画。 */
readonly FieldEditor: Component<{path: string; layout?: "popover" | "block"}>;
/** 正在就地改的字段（本组里的路径），没有时为 null。 */
readonly editing: string | null;
/** `inline` 为真时不出页面顶上的确认条，由界面里的 `FieldEditor` 接手。 */
edit(path: string, options?: {inline?: boolean}): void;
/** 在这个条目的这一组上加一项、改名、去掉（类型开了 `instanceFields` 才有）。 */
fieldAdd?(field: FieldDraft): Promise<…>;  fieldRename?(path: string, label: string): Promise<…>;  fieldRemove?(path: string): Promise<…>;
```

`ComponentPeer` 是 `ComponentViewContext` 里与数据有关的那几项（`namespace`、`fields`、`declarations`、`origins`、`edit`、`record`、列表的三个入口），不含对方分页的状态。宿主里各组的 context 本来就是同一个函数造的（`contextFor`），`other` 只是按 `uses` 放行。

就地改沿用现有的那一份编辑状态（`in-place-edit.ts` 的草稿、预览、保存、冲突处理都不变），只是换一个地方画：草稿里记下是不是就地的，就地的由 `FieldEditor` 画，不是的照旧出确认条。本期只有人物、形象两个界面用就地的；通用字段表与面板照旧用确认条，第二期各组做专门界面时跟进。

### 六、两个界面（`canon/web/components/CharacterView.vue`、`LookView.vue`，各带同名 `.md` 与 Lab 场景）

- **人物分页**：左边立绘（`other(形象)` 的立绘；没有形象组时是“添加形象”，有形象没立绘时是“添加立绘”，点立绘切到形象分页），右边性别、年龄、身份、所属、现在在哪、生死与现在的状态，下面性格、说话方式、背景，再下面作者自己加的各项，末尾“添加一项资料”。
- **形象分页**：大图、外貌、衣柜（一套一张卡：名字、样子、图）、现在穿的（从衣柜的名字里选，也能自己填）。
- “添加一项资料”：列类型的 `presets` 里还没加的，另有自己写名字的一栏；自己加的项各有改名、去掉（去掉时写“数据会保留，可以再加回来”，同去掉一组设定）。
- 短项（性别、年龄、身份、所属、现在在哪、生死）在锚在这一项上的浮层里改，不推动别的区域；成段的文字原地换成输入框，高度变化有过渡。控件按声明选：有建议值的用选择控件，引用用 `EntryPicker`，图片用下面的选图。
- 版式、控件形态与文案在动手前出第 2 轮稿子（草稿 worktree，人物分页、形象分页、添加一项资料、新建条目各一两张），与内核的几片并行，不等它。

### 七、图片（`canon/web/images.ts`、`components/ImageInput.vue`、新的 `CanonImage.vue`）

- 一个图片端口（`provide`/`inject`，同文字端口的做法，Lab 里可以给假的）：路径换成取图地址、列出作品里的图、上传一张并得到作品内路径。条目页宿主用 `filesKey` 实现；没有文件服务的窗口里端口不在，图片只显示路径、输入退回现在的两个输入框。
- `CanonImage`：按端口取图显示；文件不在时显示“图片找不到”的占位（components.md 输出 15 已写）。
- `ImageInput` 升级：缩略图、从作品里选、上传、说明；手填路径留作退路。确认条、元素对话框与 `FieldEditor` 都用它。

### 八、回执与 Agent（`canon/web/receipt.ts`、`canon/backend/agent-tools.ts`）

- 回执页：`declared` 的三种改动写成“添加了一项：某某”“去掉了一项：某某”“某某 改名为 某某”，不再落进“数据：改了”。
- `canon_write` 加 `addField`（`entry`、`component`、`label`、`kind` 等声明项、可选 `value`）、`renameField`、`removeField`（`entry`、`field`），映射到上面三个操作；`addComponent` 与 `create` 可带要声明的字段；`create` 没写 `components` 时按种类的默认。给 Agent 的字段说明里带出建议值。

## Spec 与文档改动

新条目都标（planned），本 Task 做完不自行晋升（开发者定：等试用）。

| 文件 | 改什么 |
|---|---|
| `canon/components.md` | 输入的两张表加 `suggestions`、`kinds`、`presets`；输出 4 补写入操作与拒收的几种情况、id 由内核生成去掉 planned 的前提；新输出：建议值、适用的种类、预设字段各一条；输出 21 的返回项补这三样；输出 5、7 补“原样留着的补丁不因不适用拒收” |
| `canon/revisions.md` | 输出 25 的操作清单加 `fieldAdd`、`fieldRename`、`fieldRemove` 与 `declare`，问题码加 `fields-not-declarable`、`field-fixed`、`field-missing`、`label-taken`、`field-referenced` |
| `canon/agent-tools.md` | 输出 6 的表加三行，`create` 按种类的默认 |
| `canon/author-ui.md` | 输入一节：`canon.component-views` 的 `uses` 与 context 的新增项，新贡献点 `canon.entry-kinds`；输出 4（新建条目的种类与默认设定组）、13（人物的界面改为角色卡）、16（就地展开）、38（添加一组设定按适用排）各补 planned 的句子；新输出：形象的界面、添加一项资料、图片的显示与选图上传；验收场景加一条“从新建人物到换装” |
| `docs/specs/README.md` | 注册表里这几份的说明列各补半句 |
| 组件同名 `.md` | `CharacterView`、`LookView`、`CanonImage` 新写；`ImageInput`、`NewEntryDialog`、`EntryPageHost`、`ConfirmBar` 跟着改 |

## 切片

每片单独提交，自跑验证；S1、S2 是内核，做完交高风险审查（Opus 先审，omp 用 `@review` 在后台），其余按前端或普通后端派 Sonnet。

| 片 | 内容 | 对应设计 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 的 planned 条目（主工作区） | 上表 | `bun run docs:check` |
| S1 | 内核三个操作、`declare`、世界层两处 | 一 | `nb-canon` 的 `entry-edits`、`components`、`revisions`、`edits` 几份测试，类型检查 |
| S2 | 声明的三个属性；内置类型重整、形象、样本；迁移应用侧写死旧字段的测试 | 二、三 | `nb-canon` 的 `components`；应用的 `canon`、`plot` 插件测试与样本测试 |
| S3 | 回执与 Agent 工具 | 八 | `agent-tools.test.ts`、`receipt-page.dom.test.ts` |
| S4 | 种类的登记、新建对话框、添加一组设定 | 四 | `entries-view`、`NewEntryDialog`、`entry-page` 的 dom 测试 |
| S5 | 展示接口与就地改的编辑器 | 五 | `component-views`、`entry-page` 的 dom 测试 |
| S6 | 图片端口、`CanonImage`、`ImageInput` | 七 | 各自的 dom 测试，Lab 场景 |
| S7 | 人物、形象两个界面（第 2 轮稿子定了以后） | 六 | dom 测试，Lab 场景（含 390 宽与英文场景） |
| S8 | e2e、开发服务真实页面走一遍、收口审查、合入 | 验证 | 见“验证” |

第 2 轮稿子在 S1 到 S6 期间出，S7 等它的答复。

## 验收映射

Spec 条目在 S0 写入后回填编号；这里先按行为列。

| 行为 | 覆盖 |
|---|---|
| 加一项：生成 id、显示名撞名拒收、类型没开时拒收、带初值 | `nb-canon/tests/entry-edits.test.ts` |
| 改名、去掉：固定字段拒收、没有这个声明拒收、被 `max` 指着拒收 | 同上 |
| 去掉后读不到、值保留；重新加同一个名字恢复，种类不合拒收 | 同上（经 `editEntries` 走，不直接写初值） |
| 同一批里的并存与冲突；新建条目与新加设定组时带声明 | 同上 |
| 修订的形状与还原（加、改名、去掉各还原一次） | `nb-canon/tests/revisions.test.ts` |
| 原样留着的补丁不拒收；新写的照旧拒收（字段没声明、设定组去掉各一例） | `nb-canon/tests/edits.test.ts`，先让用例在旧代码上失败 |
| 三个声明属性的校验与读取 | `nb-canon/tests/components.test.ts`、`canon.test.ts` 的 `components` 读取 |
| 样本照新声明生成、数值不变；星瑕自己声明的三项读得到 | `scripts/canon-sample.test.ts` |
| 新建人物默认带两组；种类撞名的诊断；添加一组设定的排序 | `entries-view.dom.test.ts`、`entry-page.dom.test.ts` |
| Agent 的三个操作与按种类的默认 | `agent-tools.test.ts` |
| 回执里三种改动的写法 | `receipt-page.dom.test.ts` |
| `other`、`addComponent`、就地改的编辑器（真的过渡，不用替身） | `entry-page.dom.test.ts`、`component-views.dom.test.ts` |
| 图片的显示、找不到的占位、选图、上传 | `ImageInput.dom.test.ts`、`CanonImage` 的 dom 测试 |
| 从新建人物到换装的主路径 | 新的 `e2e/canon-character.e2e.ts`（1440 宽） |

## 验证

- 每片跑表里的测试与受影响包的类型检查；S2 之后跑 `canon-write`、`canon-author` 两份 e2e（它们依赖样本）。
- S8：`bun run build && bun run build:e2e` 后跑 `canon-character`、`canon-write`、`canon-author` 三份 e2e；`nbdev dev start --sample` 起开发服务，在真实页面（不减弱动效）走主路径：新建人物、填性别与所属、加一项“种族”、加形象、上传立绘、加两套服装、换装、去掉“种族”再加回、看回执、撤销。亮色截图发评审板或报告。
- 明确留下的未验证边界：真实输入法在浮层里的输入；很大的图片的上传时间；第三方插件用 `uses` 的情况只有 dom 测试里的测试插件。

## 不做与风险

不做（本期）：

- 数值的显示名与预设项、技能、物品栏、关系（第二期）；组织、地点、物品三组与作品级“各种类默认带哪些设定组”、新建条目的模板（第三期）。
- 通用字段表与面板的就地展开；剧情插件给自己的种类登记默认设定组。
- 用显示名写字段（components.md 输出 8 的 planned 句子）、类型版本的升级函数、按引用反查（角色卡上列重要物品）。
- 条目页页头与内容列差 32 像素的对齐（记在 README，另行处理）。

风险：

- **世界层校验的那一处放宽**（设计一的第 2 处）碰的是已有的写入校验。兜底：用例先在旧代码上失败；新写的不适用补丁仍被拒收的用例保留并做变异检查；高风险审查把它列为第一重点。
- **重整人物字段牵动的文件多**（粗搜 36 个）。兜底：S2 单独一片，先列全读法再逐处改，改完跑两份 e2e。
- **就地改与确认条共用一份状态**：切走再回来、世界在别处变了、保存失败这几条路径要在两种画法下都成立。兜底：`entry-page.dom.test.ts` 里现有的确认条用例照旧通过，就地的另写同样几条，用真的过渡。
- **图片端口在没有文件服务的窗口里不在**：两个界面与输入都要有退路，Lab 里各登记一个没有端口的场景。
