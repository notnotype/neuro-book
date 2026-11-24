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

第 1 轮设计审查（2026-11-24，Opus 审内核、Sonnet 审界面、omp 在后台；三路都被额度或时限打断，各写了 3、6、2 条，逐条核实后都成立）改了三处设计，没审到的部分另派：

- 去掉一项从“删声明、再加同名时恢复”改成“打标记、另有恢复”（设计一）；
- 原样留着的补丁不拒收，判据从“逐字相同”细化成四条，并连依据检查一起跳过（设计一第 3 处）；
- 界面：每一项上的入口、谁来画就地改、浮层里放弃的规则、固定的浮层大小、建议值的控件、换装、来历与语义档的去处（设计五、六）。

写计划前跑过的探针（真实内核，脚本在本机 `/tmp/t41-probe/`，不入库）得到的事实：

- 条目初值里的 `declared` 改了以后，修订记成 `init.data.<命名空间>.declared[<字段 id>]`（新增、删除整项）、`….declared[<id>].label`（改名）与 `….declared#order`，都是现有的叶子写法。**日志格式不用改。**
- 删掉声明后值留在初值里、读不到；对它的 `set` 得到 `field-unavailable`；再声明同一个 id 时值与补丁都回来，种类不合时 `field-redeclare-mismatch`（审查另查出：只比初值，初值是未知时什么种类都收，旧补丁套不上会让整条剧情变更失效）。
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
| 可点选也可自己填的输入 | nb-ui 的 `SearchSelect`（远程模式）上加“用‘某某’”一行，做法同设定插件的 `EntryPicker` | 现成的组合框，键盘与输入法都处理过；不给 nb-ui 另加组件，不用“下拉里选‘自己填’再换成输入框”的两步做法 |

## 关键设计

### 一、内核：字段声明的写入操作（`packages/nb-canon/src/core/schema.ts`、`world/entry-edits.ts`、`components/registry.ts`）

**去掉一项是打标记，不是删声明**（第 1 轮设计审查后改；原稿是删声明、再加同名时恢复）。实例声明多一个可选的 `removed: true`：去掉时声明连同种类留在 `declared` 里，读取、渲染、补丁都当它不在；恢复就是去掉标记。和去掉一组设定的做法相同（components.md 输出 7）。这样：

- 去掉过的 id 一直占着，新加的一项不会撞上它，也就不会把很久以前的值和补丁意外带回来；
- 恢复时种类不可能变，不会出现“旧补丁按新声明套不上、整条剧情变更跟着失效”（审查用真实内核复现过：去掉数的“种族”再加成文字，第 45 章那条变更整条套不上，同一条里别的字段也退回旧值）；
- 界面能列出去掉过的各项给“恢复”。

`EntryOpSchema` 加四项，照 `listAdd`、`listRemove` 的命名：

```ts
// 字段声明去掉 id 必填：不写时由内核按 label 生成（generateFieldId）
{op: "fieldAdd", entry: Id, namespace: Text, field: FieldDraft, value?: unknown}
{op: "fieldRename", at: Address /* <命名空间>.<字段 id> */, label: Text}
{op: "fieldRemove", at: Address}
{op: "fieldRestore", at: Address}
```

另外，`component` 的 `add` 与 `create` 里的 `components[]` 各加可选的 `declare: FieldDraft[]`：这一批新加的设定组，自己的字段在加它的那一项里声明（沿用“这一批新建的东西初值写在建它的那一项里”，不为 `fieldAdd` 开例外）。

规则（都在 `planEntries` 里判，改的是条目初值的工作副本，路由是 `entry`，世界层的校验照旧兜底）：

- 类型没开 `instanceFields`：`fields-not-declarable`。
- `fieldAdd`：id 不写就生成，写了要合法；现有的声明（固定的、实例的、去掉过的）占着的 id 都不能用，另外照 `usedElementIds` 的先例，初值里留着键、或任何剧情变更的补丁指过的 id 也算占着（旧数据里可能有没有声明的值）。显示名与现有字段重复：`label-taken`；撞的是去掉过的一项时问题里带上它的 id，界面据此给“恢复”。数据里还没有 `declared` 时先补空数组；`value` 不写是未知。
- `fieldRename`、`fieldRemove`、`fieldRestore`：只能动实例声明的；指到类型固定的字段：`field-fixed`；没有这个声明：`field-missing`；改名撞显示名：`label-taken`；去掉已经去掉的、恢复没去掉的：`field-missing`。
- `fieldRemove`：别的没去掉的声明的 `max` 指着它时 `field-referenced`（带是谁指着），不落到世界层的 `type-mismatch`。恢复一个 `max` 指着已去掉字段的声明同理。
- 同一批里：两项 `fieldAdd` 可以并存（后一项看得到前一项占的 id）；`Draft.fresh` 另记这一批新加的字段（`条目/命名空间.字段`），对它再 `set` 在取当前值之前就得到 `created-in-batch`（现在的 `fresh` 只认设定组与列表元素，不补的话会落成 `field-unavailable`）；同一个字段既改名又去掉、或既 `set` 又去掉得到 `duplicate-address`（后三个操作的地址就是字段地址，`fieldAdd` 用 `$declared.<命名空间>[+序号]`）。
- 只在创作修改里有意义：`intent` 是 `story` 的一批里照样按改初值处理，同 `component`、`place`。

读取这一侧：`effectiveFields` 跳过去掉的声明（读 `declared` 的地方都经它或 `namespaceFields`，实施时先列全再改）；条目读取另给 `removedFields`（命名空间到去掉过的各项的 id 与显示名，没有时不写），同 `removedComponents`。

世界层（`world/world.ts` 的 `validate`）补三处：

1. 类型没开 `instanceFields` 而数据里有非空的 `declared`：新写或改过的拒收（`fields-not-declarable`）。只查新写或改过的，旧数据不受影响。
2. 固定字段的声明里出现 `removed`：登记时整条不登记（`component-declaration-invalid`）。
3. **原样留着的补丁不因为“不适用”拒收**。被碰到的剧情变更里，一处补丁同时满足下面四条时不报问题，也不查它的依据：
   - 写入前这条变更已经存在，并且是已写、生效的（待定转生效、计划改成已写、撤销后恢复都算新写，照旧整条校验，revisions.md 输出 17）；
   - 安放与所在的世界线没变（挪到设定组还没启用的章是这次写入造成的不适用）；
   - 把补丁稳定序列化后计数，这处补丁在新列表里出现的次数不超过旧列表（多出来的那几份照新写的查）；
   - 不适用的原因是字段没声明、设定组去掉或没启用。

   依据检查一并跳过的理由：审查复现过，面板的数值字段去掉以后，它后面那条带“由核对点推出”依据的补丁复算不上，只放宽不适用那一段的话这条变更照样改不了。这一条改的是已有的校验，是本计划里风险最高的一处；审查认为不该在本 Task 改时，退路是不改、把它写进“不承诺”，并在“去掉一项”的预览里列出哪几条剧情变更里有对它的改动。

不改：修订的形状、`core/id-lists.ts`、日志格式（`removed` 是声明上多一个可选属性，按“只加字段”处理）、还原与依赖的算法、类型版本的比较。

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
- 版本不升：升了以后旧数据整组只读、又没有升级函数。这是一处明说的取舍，不是兼容：还没有发布过带世界引擎的版本，真实数据只有样本与开发时的试验作品（开发者定“直接改声明、重做样本，不做升级函数”）。不升的后果：试验作品里旧字段（外观、状态、态度、身体、样子）的值与对它们的补丁留在数据里，界面与主文字里读不到，主文字里引用它们的地方显示占位，不报错；这些作品里的人物也没有形象这一组，要作者自己加。关键设计一的第 3 处保证旧的剧情变更还能改别的地方。
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
/** 同一条目上另一组设定：只能取声明里 `uses` 列了的（没列的抛错）；条目在所选位置上没有这一组、或它的类型不可用时为 null。 */
other(type: string): ComponentPeer | null;
/** 给这个条目加上 `uses` 里的一组设定（一次创作修改）。 */
addComponent(type: string): Promise<{ok: true} | {ok: false; reason: Text}>;
/** 切到那一组的分页。 */
showTab(type: string): void;
/** 就地改的编辑器：界面把它放在字段的位置上，这个字段正在就地改时它画输入、意图、预览与保存取消，别的时候不画。 */
readonly FieldEditor: Component<{path: string; layout?: "popover" | "block"; suggestions?: readonly string[]}>;
/** 一个值的细节：来历、语义档的起点与各句、记一句。界面放进浮层或展开处。 */
readonly FieldDetail: Component<{path: string}>;
/** 正在就地改的字段（本组里的路径），没有时为 null。 */
readonly editing: string | null;
/** `inline` 为真时由界面里的 `FieldEditor` 接手，不出页面顶上的确认条；`value`、`intent` 预先填好（换装用）。 */
edit(path: string, options?: {inline?: boolean; value?: unknown; intent?: "creative" | "story"}): void;
/** 在这个条目的这一组上加一项、改名、去掉、恢复（类型开了 `instanceFields` 才有）。 */
fieldAdd?(field: FieldDraft): Promise<…>;  fieldRename?(path, label): Promise<…>;  fieldRemove?(path): Promise<…>;  fieldRestore?(path): Promise<…>;
/** 这一组上去掉过的各项，给“恢复”用。 */
readonly removedFields?: readonly {id: string; label: string}[];
```

`ComponentPeer` 只有读的那几项（`namespace`、`fields`、`declarations`、`origins`），没有 `edit`：改别的组的字段要到它自己的分页去（`showTab`），不然草稿开在看不见的地方。宿主里各组的 context 本来就是同一个函数造的（`contextFor`），`other` 只是按 `uses` 放行。条目页之外的宿主（Lab、测试场地）这几项都可以不给，界面要能在没有它们时只读地画出来。

就地改沿用现有的那一份编辑状态（`in-place-edit.ts` 的草稿、预览、保存、冲突处理都不变），只是换一个地方画。规则：

- **谁来画**：`FieldEditor` 挂上时向宿主登记自己的路径。草稿标了就地、并且此刻有登记了这条路径的编辑器时由它画；别的情况（专门界面还在加载、加载失败、贡献方停了退回通用字段表）一律出页面顶上的确认条，草稿不会落到没人画的地方。
- **浮层里的短项**：点浮层外面、按 Escape、点“取消”都是放弃这次填写，草稿不留（短项重填的代价小；浮层关了以后没有地方接着改）。Escape 在输入法组字时不算（现有确认条同样补上这一条）。保存或放弃以后焦点回到触发它的那个值（带 `data-edit="<完整路径>"`，沿用现在找“改”按钮的做法）。浮层的大小固定：预览占两行的位置（更多的收成“还有 N 项”），报错与预览共用这块位置，保存与取消的位置不动。
- **成段的文字**：编辑层浮在原处、向下长，盖在后面的内容上，原来那一段的占位不变，别的内容不动；输入框从原文的行数起步。草稿照旧存在标签状态里，切走再回来还在。
- 草稿所在的字段被去掉或改名时清掉草稿。
- 本期只有人物、形象两个界面用就地的；通用字段表与面板照旧用确认条，第二期各组做专门界面时跟进。

有建议值的文字用一个小组件 `SuggestInput`（设定插件里，建在 nb-ui 的 `SearchSelect` 上，做法同 `EntryPicker`）：下拉里列建议值，也可以直接打字，没有同名的建议值时末尾多一行“用‘某某’”。确认条、元素对话框与 `FieldEditor` 三处都用它（`ConfirmBarKind` 加一种），同一个字段在哪里改都是同一个控件。

### 六、两个界面（`canon/web/components/CharacterView.vue`、`LookView.vue`，各带同名 `.md` 与 Lab 场景）

- **人物分页**：左边立绘（`other(形象)` 的立绘；没有形象组时是“添加形象”，有形象没立绘时是“添加立绘”，点立绘切到形象分页），右边性别、年龄、身份、所属、现在在哪、生死、作者自己加的各项与“添加一项资料”，下面是现在的状态，再下面性格、说话方式、背景。
- **形象分页**：大图、外貌、现在穿的（建议值是衣柜里各套的名字，也能自己填）、衣柜（一套一张卡：图、名字、样子；“换上”打开现在穿的的编辑器并填好这一套的名字，意图预选“从这一章起”）。
- **每一项上的入口**：
  - 值本身是按钮，点了就改（数、文字、建议值、引用、图片）；写不了时（按计划、只读、独占写入）停用并在提示里写原因，同通用字段表的“改”。
  - 值在剧情里变过时旁边有“第 N 章改过”，它也是按钮，点了在浮层里看来历（`FieldDetail`）。只有初值的值没有这个入口。
  - 语义档的项（现在的状态）点了展开细节：起点与之后记下的各句、记一句、改起点。
  - 累出来的数改设定被拒时（`accumulated-value`），编辑器里写原因并给“看来历”，换成 `FieldDetail`。
  - 自己加的项行尾有“更多”：改名、去掉；位置一直留着，指到这一行或聚焦时显出来。
- **添加一项资料**：浮层里列类型的 `presets` 里还没加的、去掉过的各项（写“恢复‘某某’”），另有自己写名字的一栏（本期只加文字的项；重名时原因写在这一栏下面）。去掉一项时确认里写“数据会保留，可以恢复”。
- 版式、控件形态与文案在动手前出第 2 轮稿子（草稿 worktree），与内核的几片并行，不等它。

### 七、图片（`canon/web/images.ts`、`components/ImageInput.vue`、新的 `CanonImage.vue`）

- 一个图片端口（`provide`/`inject`，同文字端口的做法，Lab 里可以给假的）：路径换成取图地址、列出作品里的图、上传一张并得到作品内路径。条目页宿主用 `filesKey` 实现；没有文件服务的窗口里端口不在，图片只显示路径、输入退回现在的两个输入框。
- `CanonImage`：按端口取图显示；文件不在时显示“图片找不到”的占位（components.md 输出 15 已写）。
- `ImageInput` 升级：缩略图、从作品里选、上传、说明；手填路径留作退路。确认条、元素对话框与 `FieldEditor` 都用它。

### 八、回执与 Agent（`canon/web/receipt.ts`、`canon/backend/agent-tools.ts`）

- 回执页：`declared` 的四种改动写成“添加了一项：某某”“去掉了一项：某某”“恢复了一项：某某”“某某 改名为 某某”，不再落进“数据：改了”。
- `canon_write` 加 `addField`（`entry`、`component`、`label`、`kind` 等声明项、可选 `value`）、`renameField`、`removeField`、`restoreField`（`entry`、`field`），映射到上面四个操作；`addComponent` 与 `create` 可带要声明的字段；`create` 没写 `components` 时按种类的默认。给 Agent 的字段说明里带出建议值。

## Spec 与文档改动

新条目都标（planned），本 Task 做完不自行晋升（开发者定：等试用）。

| 文件 | 改什么 |
|---|---|
| `canon/components.md` | 输入的两张表加 `suggestions`、`kinds`、`presets` 与实例声明的 `removed`；输出 4 改写：去掉是打标记、声明留着，恢复是去掉标记，新加的一项不用占过的 id，并补写入操作与拒收的几种情况（输出 16 只剩直接写初值时才碰得到）；新输出：建议值、适用的种类、预设字段各一条；输出 21 的返回项补这三样与条目读取的 `removedFields`；输出 5、7 补“原样留着的补丁不因不适用拒收”的四条判据 |
| `canon/revisions.md` | 输出 25 的操作清单加 `fieldAdd`、`fieldRename`、`fieldRemove`、`fieldRestore` 与 `declare`，问题码加 `fields-not-declarable`、`field-fixed`、`field-missing`、`label-taken`、`field-referenced`；输出 3、17 补原样留着的补丁那四条 |
| `canon/agent-tools.md` | 输出 6 的表加三行，`create` 按种类的默认 |
| `canon/author-ui.md` | 输入一节：`canon.component-views` 的 `uses` 与 context 的新增项，新贡献点 `canon.entry-kinds`；输出 4（新建条目的种类与默认设定组）、13（人物的界面改为角色卡：每一项上的入口、来历、语义档的各句都写明去处）、16（就地改的两种画法、谁来画、浮层里放弃的规则、Escape 不打断输入法组字）、30（焦点回到触发的那个值）、38（添加一组设定按适用排）各补 planned 的句子；新输出：形象的界面、添加一项资料与恢复、图片的显示与选图上传；验收场景加一条“从新建人物到换装” |
| `docs/specs/README.md` | 注册表里这几份的说明列各补半句 |
| 组件同名 `.md` | `CharacterView`、`LookView`、`CanonImage` 新写；`ImageInput`、`NewEntryDialog`、`EntryPageHost`、`ConfirmBar` 跟着改 |

## 切片

每片单独提交，自跑验证；S1、S2 是内核，做完交高风险审查（Opus 先审，omp 用 `@review` 在后台），其余按前端或普通后端派 Sonnet。

| 片 | 内容 | 对应设计 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 的 planned 条目（主工作区） | 上表 | `bun run docs:check` |
| S1 | 内核四个操作、`declare`、读取跳过去掉的声明、世界层三处 | 一 | `nb-canon` 的 `entry-edits`、`components`、`revisions`、`edits` 几份测试，类型检查 |
| S2 | 声明的三个属性；内置类型重整、形象、样本；迁移应用侧写死旧字段的测试 | 二、三 | `nb-canon` 的 `components`；应用的 `canon`、`plot` 插件测试与样本测试 |
| S3 | 回执与 Agent 工具 | 八 | `agent-tools.test.ts`、`receipt-page.dom.test.ts` |
| S4 | 种类的登记、新建对话框、添加一组设定 | 四 | `entries-view`、`NewEntryDialog`、`entry-page` 的 dom 测试 |
| S5 | 展示接口、就地改的编辑器、`SuggestInput`、`FieldDetail` | 五 | `component-views`、`entry-page`、`ConfirmBar` 的 dom 测试 |
| S6 | 图片端口、`CanonImage`、`ImageInput` | 七 | 各自的 dom 测试，Lab 场景 |
| S7 | 人物、形象两个界面（第 2 轮稿子定了以后） | 六 | dom 测试，Lab 场景（含 390 宽与英文场景） |
| S8 | e2e、开发服务真实页面走一遍、收口审查、合入 | 验证 | 见“验证” |

第 2 轮稿子在 S1 到 S6 期间出，S7 等它的答复。

## 验收映射

Spec 条目在 S0 写入后回填编号；这里先按行为列。

| 行为 | 覆盖 |
|---|---|
| 加一项：生成 id、显示名撞名拒收、类型没开时拒收、带初值 | `nb-canon/tests/entry-edits.test.ts` |
| 改名、去掉、恢复：固定字段拒收、没有这个声明拒收、被 `max` 指着拒收 | 同上 |
| 去掉后读不到、值与补丁保留；恢复后都回来；去掉过的 id 与初值、补丁里用过的 id 不会分给新加的一项；同名时 `label-taken` 带上去掉过的那一项 | 同上（经 `editEntries` 走，不直接写初值） |
| 对刚加的字段再 `set` 得到 `created-in-batch` | 同上 |
| 同一批里的并存与冲突；新建条目与新加设定组时带声明 | 同上 |
| 修订的形状与还原（加、改名、去掉各还原一次） | `nb-canon/tests/revisions.test.ts` |
| 原样留着的补丁不拒收（字段去掉、设定组去掉各一例，另一例是带“由核对点推出”依据的数）；新写的、挪了安放的、待定转生效的、多出来一份相同的都照旧拒收 | `nb-canon/tests/edits.test.ts`，先让用例在旧代码上失败；“不比安放”“不比旧状态”“不计数”各做一次变异 |
| 人物重整以后，带旧字段的旧数据读得出来、不报错，旧的剧情变更还能改文字 | `canon.test.ts`（照旧声明写一份数据，换成新声明再读、再改） |
| 三个声明属性的校验与读取 | `nb-canon/tests/components.test.ts`、`canon.test.ts` 的 `components` 读取 |
| 样本照新声明生成、数值不变；星瑕自己声明的三项读得到 | `scripts/canon-sample.test.ts` |
| 新建人物默认带两组；种类撞名的诊断；添加一组设定的排序 | `entries-view.dom.test.ts`、`entry-page.dom.test.ts` |
| Agent 的四个操作与按种类的默认 | `agent-tools.test.ts` |
| 回执里四种改动的写法 | `receipt-page.dom.test.ts` |
| `other`、`addComponent`、就地改的编辑器（真的过渡，不用替身）；专门界面没挂上时退回确认条；浮层点外面与 Escape 放弃、组字时的 Escape 不放弃；字段被去掉时草稿清掉；浮层里的下拉选一项不关掉浮层 | `entry-page.dom.test.ts`、`component-views.dom.test.ts`、`ConfirmBar.dom.test.ts` |
| 建议值的控件在确认条、元素对话框、就地编辑器里是同一个 | `ConfirmBar.dom.test.ts`、`ElementDialog.dom.test.ts` |
| 图片的显示、找不到的占位、选图、上传 | `ImageInput.dom.test.ts`、`CanonImage` 的 dom 测试 |
| 从新建人物到换装的主路径 | 新的 `e2e/canon-character.e2e.ts`（1440 宽） |

## 验证

- 每片跑表里的测试与受影响包的类型检查；S2 之后跑 `canon-write`、`canon-author` 两份 e2e（它们依赖样本）。
- S8：`bun run build && bun run build:e2e` 后跑 `canon-character`、`canon-write`、`canon-author` 三份 e2e；`nbdev dev start --sample` 起开发服务，在真实页面（不减弱动效）走主路径：新建人物、填性别与所属、加一项“种族”、加形象、上传立绘、加两套服装、换装、去掉“种族”再恢复、看回执、撤销。亮色截图发评审板或报告。
- 明确留下的未验证边界：真实输入法在浮层里的输入；很大的图片的上传时间；第三方插件用 `uses` 的情况只有 dom 测试里的测试插件。

## 不做与风险

不做（本期）：

- 数值的显示名与预设项、技能、物品栏、关系（第二期）；组织、地点、物品三组与作品级“各种类默认带哪些设定组”、新建条目的模板（第三期）。
- 通用字段表与面板的就地展开；剧情插件给自己的种类登记默认设定组。
- 用显示名写字段（components.md 输出 8 的 planned 句子）、类型版本的升级函数、按引用反查（角色卡上列重要物品）。
- 条目页页头与内容列差 32 像素的对齐（记在 README，另行处理）。

风险：

- **世界层校验的那一处放宽**（设计一的第 3 处）碰的是已有的写入校验。兜底：四条判据各有用例，用例先在旧代码上失败；新写的不适用补丁仍被拒收的用例保留并做变异检查；高风险审查把它列为第一重点。
- **实例声明多一个 `removed`** 是存进日志的数据多一个可选属性。兜底：读 `declared` 的地方先列全，都经 `effectiveFields`；还原“去掉”“恢复”各有用例。
- **类型以后加的固定字段或预设，id 与某个条目上已有的实例字段相同**：审查的探针显示这时那个条目的这一组写不进去（重复的 id）。等这条发现写全后定处理办法，记在本节。
- **重整人物字段牵动的文件多**（粗搜 36 个）。兜底：S2 单独一片，先列全读法再逐处改，改完跑两份 e2e。
- **就地改与确认条共用一份状态**：切走再回来、世界在别处变了、保存失败这几条路径要在两种画法下都成立。兜底：`entry-page.dom.test.ts` 里现有的确认条用例照旧通过，就地的另写同样几条，用真的过渡。
- **图片端口在没有文件服务的窗口里不在**：两个界面与输入都要有退路，Lab 里各登记一个没有端口的场景。
