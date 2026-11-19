# t37 计划：写入底座

第 2 稿（第一轮设计审查后，处理见 [`evidences/design-review-resolution.txt`](evidences/design-review-resolution.txt)）。

## 一、Context

开发者 2026-11-19 看过 t31 第二批第一期后定的方向（Work README 决定表同日）：

- 原话：“要用户和 agent 都能改，这个是最重要的”；“先把底座做好，然后再考虑做通一个闭环（候选的闭环就是人物 Component 设定）”。
- 优先级：先做功能与基本 UX，UI 与 UX 的打磨排到最后。
- 空状态要改：“没有设定还是一个白板，需要右键才能创建设定”。

现状（主会话 11-19 核实，独立设计与两份审查复核一致）：

- **Agent 一侧**：canon、剧情插件没有贡献任何 Agent 工具、Skill 或 eval 对象。canon 的项目入口注释写明第一版不建服务端入口（`canon/backend/plugin.ts` 头部）。Agent 在主服务进程，世界在项目进程，Agent 读写不了设定。
- **作者一侧**：
  - 条目页只能就地改数、文字、选项、是否四种字段（`canon/web/rows.ts` 的 `EDITABLE_KINDS`）；
  - 另外能新建、删除条目，能记一笔（只在面板分页）、还原；
  - 下面这些在界面上都改不了：列表、引用、图片、语义档的起点、条目的名字简介别名、主文字、出场与另一个身份；给已有条目加或去 Component；移动；
  - 没有主文字的条目连“文字”分页都没有。
- **新建与删除**：由界面自己拼整份条目再发布，各拼一份（`web/new-entry.ts`、`EntryPageHost.vue` 的删除段）。
- **空状态**：条目树空着时只有一行灰字“还没有条目”；“+”在侧栏标题栏，空白处右键也能新建，都不显眼。
- **内核**：
  - 发布、就地改（`nb-canon/src/world/edits.ts`）、记一笔、还原都有，但一次只改一处；同一对象连着就地改两次拼不成一次修订（会撞 `id-taken`）；
  - 列表的增删、Component 的加去、移动都没有按意图路由的写法；
  - 审查另查出现有就地改的两处缺陷：剧情变化写在章首时读回核对必然失败；显式写主线的位置被改成“按章选线”。

本 Task 的范围就是“底座”（主会话对开发者原话的理解，记在待确认清单）：

- 作者在界面上、Agent 用工具，都能改设定的数据：各种字段、列表与元素、引用、图片、语义档、条目的名字简介别名、主文字的块、出场与另一个身份、Component 的加与去、移动、删除与恢复；
- 例外写在“八、不做与风险”：面板的字段声明、图片的选文件；
- 写入走同一条通道，一次操作一条修订；
- 作者看得到 Agent 改了什么，能撤销；
- 空状态有明显的新建入口。

人物 Component 的闭环（一次填一组的设定表单、闭环的验收脚本）在底座之后和开发者定。

依据：

- 已接受的[内核提案](../../../../../docs/proposals/world-engine-kernel.md)第 9 节（Agent 的工具）；
- Spec：
  - [`canon/revisions.md`](../../../../../docs/specs/canon/revisions.md)（输出 1、7、8、10、16、19、22 到 24）；
  - [`canon/components.md`](../../../../../docs/specs/canon/components.md)（输出 3、5、7、15、18 到 20）；
  - [`canon/worldlines.md`](../../../../../docs/specs/canon/worldlines.md)（输出 12、19）；
  - [`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md)（新建、条目页、就地改与确认条、保存后的提示）；
- [`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)（`agent.tools`）、[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（`ctx.invocation`）、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)（`{project}` 目标）、[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md)（租约）、[`ui/forms.md`](../../../../../docs/specs/ui/forms.md)。

开发者确认过的决定：

- 所有写入走同一条发布通道，带版本、留改动记录、可逐条还原；Agent 可以改作者的东西（11-02）。
- 作者在看到的样子上就地改，默认算改设定、写回给出这个值的记录；另有“剧情里变了”（11-02）。
- Agent 工具按提案第 9 节（提案 11-02 接受）；工具名加前缀，不和 harness 自带的撞名（11-02，t20）。
- 11-19 的方向（上文）。

工作方式：

- autonomous-delivery：主会话写代码；前端审查派 Sonnet，后端审查派 omp；不 push；验证后合入 master。
- 独立设计（Sonnet，`evidences/independent-design.txt`）的对照结论写在本计划各处，没采纳的写在“八、不做与风险”。

## 二、技术选型

| 问题 | 选用 | 理由；否决了什么 |
|---|---|---|
| 列表元素的表单 | `@notnotype/nb-form` 的 `SchemaForm`（仓库已有，设置页在用），加 canon 登记的自定义控件（条目选择、图片、数），字段声明经一个纯函数转成它的描述 | 列表的增删与焦点、问题显示、受控提交它已做；否决手写。它的选项源是静态清单（forms.md 输出 11），条目选择要远程搜，所以做成自定义控件；数用 canon 的 `parseDecimal`，与确认条一致 |
| 条目选择器 | 给 nb-ui 的 `SearchSelect` 加远程模式（宿主收搜索词、不在本地过滤、已选项的显示名由宿主给），canon 的 `EntryPicker` 建在它上面 | 远程搜索选择是通用需要，放进 nb-ui；否决在 canon 里另搭一套弹层，也否决一次读全部条目进下拉 |
| Agent 工具的参数 | TypeBox 写 schema，扁平对象，`strict: false`，各操作的必填项由工具层校验并用中文回话 | 大的 `anyOf` 在严格模式下受提供商限制，模型也容易写错；否决每种操作一个工具（失去原子性，多占声明的 token） |
| 跨进程调世界 | 工具实现先 `projects.acquire(会话的项目)` 取租约，再经插件信道的 `{project}` 目标调 `nbook.canon/world`，调完释放 | 同 `projects://` 文件方案（`plugins/files/backend/projects-scheme.ts`）；否决无租约访问：项目在 `idle-grace` 时会被拒，作者关了窗口后 Agent 会随机失败 |

没有新的外部依赖。

## 三、关键设计

### 1. 内核：一次改几处（新文件 `packages/nb-canon/src/world/entry-edits.ts`）

公开 `editEntries(world, input, time)`、`previewEntries(world, input, time)` 与 `findEntries(world, query)`。

```ts
interface EntryEdits {
    readonly requestId: string;
    readonly by: Actor;
    readonly what: "edit" | "creative";       // 作者保存或 Agent 的创作修改（revisions.md 的 `what`）
    readonly baseVersion?: number;            // 读到的世界版本；只在全部是 create 时可以不给
    readonly sameVersion?: boolean;           // true：世界版本不等于 baseVersion 就整批拒收（stale-read）
    readonly title: string;
    readonly why?: string;
    readonly intent?: "creative" | "story";   // 缺省 creative
    readonly position?: ReadPosition;         // creative：从哪个位置看当前值；story：落点（不能是初值）
    readonly ops: readonly EntryOp[];         // 1 到 50 项
}
type EntryOp =
    | {op: "create"; id: string /* tmp: 开头 */; entry: NewEntry}   // 名字、种类、分组、上级、出场、马甲、启用的类型与各自的初值、主文字的块
    | {op: "set"; at: Address; value: unknown; read?: unknown}       // 带 read 时值不同拒收 value-conflict
    | {op: "replace"; at: Address; find: string; with: string}       // 文字或一块里把 A 换成 B（输出 10）
    | {op: "listAdd"; at: Address; element: unknown}                  // at 是列表字段；元素 id 缺省由内核生成
    | {op: "listRemove"; at: Address}                                 // at 是 `ns.字段[元素]`
    | {op: "aliases"; entry: string; add?: string[]; remove?: string[]}
    | {op: "addBlock"; entry: string; source: string; after?: string}
    | {op: "removeBlock"; at: Address}                                // `text[块]`
    | {op: "component"; entry: string; type: string; action: "add" | "remove"; fields?: Record<string, unknown>}
    | {op: "place"; entry: string; parent?: string | null; folder?: string; kind?: string; after?: string | null; appears?: Placement | null; sameAs?: string | null}
    | {op: "delete" | "restore"; entry: string}
    | {op: "add"; at: Address; delta: number; reason?: string}        // 只在 story
    | {op: "note"; at: Address; text: string};                        // 只在 story
```

#### 候选、核对与发布

`previewEntries` 与 `editEntries` 共用同一份候选计算：

- 定路由，合成写入请求，用 `world.publish` 算出候选世界；
- 在候选世界上做全部读回核对（`set` 的值、`result-mismatch`）。

只有都通过的候选才交给 `WorldService` 追加日志、推进版本、发事件，与现有 `finish`/`checked` 的结构相同。核对失败时日志、版本、请求 id 与事件都不动。

#### 规则

- **一次修订**：受影响的条目与变更按对象克隆成工作副本，结束时每个改过的对象出一份 `put`，发布一个写入请求。成功时全部生效，失败时世界不变（输出 1）。
- **读前提**：
  - `sameVersion: true` 时，世界版本不等于 `baseVersion` 就整批拒收，码为 `stale-read`，详情列出之间的修订（标题、写入者）。
  - 按对象判冲突（输出 7）兜不住“作者另加了一条剧情变更、Agent 按旧设定写剧情变化”，所以 Agent 工具一律带它。
  - 作者界面的 `set` 照旧带读到的值（输出 19）。
- **线**：
  - 读取位置的线 id 一路明确传下去（解析、来历、副本、核对、后面改过的记录），只在构造存下来的安放时省略主线；
  - 显式写主线就按主线，不写线才按那一章讲的线（worldlines 输出 12）。
  - 现有入口一起修。
- **set 的路由**：
  - 照输出 8 的路由表，看的是原世界、读取位置那条线的来历。
  - 列表元素的子字段另有规则：元素完全来自初值、这条线上没有任何变更碰过它才按初值改，否则拒收 `element-from-change`。碰过包括增删这个元素 id、整表赋值、元素路径上的补丁；带过去的值也算。详情给出碰过它的变更，指向“剧情里变了”。
  - Spec 输出 8 “增元素带的值，改那个补丁带的值（planned）”这一行不做，保留 planned。
- **剧情变化（story）**：
  - 这一批里对已有数据的字段操作（set、replace、listAdd、listRemove、aliases、addBlock、removeBlock、add、note）合成落点上的一条新剧情变更，补丁按操作顺序排，`involves` 是涉及的条目；
  - 精确档的数用 `set` 时照输出 8 换成加减；
  - 读回核对在新变更之后的那一点（引擎的 `slotAfter`），不在章首读，现有入口一起修；
  - 结构操作（create、component、place、delete、restore）不分意图，都是对象的新值；
  - `component` 的“从第 N 章起有”（剧情里的 `启用`）不在本次。
- **改设定（creative）的增删只写初值**：
  - `listAdd`、`aliases` 的 add、`addBlock` 加进初值；
  - `listRemove`、`aliases` 的 remove、`removeBlock` 只能去掉完全来自初值、没被任何变更碰过的元素、别名或块，否则拒收 `element-from-change`，规则同上。
- **这一批新建的东西**：新建的条目、新加的设定组、新加的元素，初值只能在建它的那一项里给，后面的项不能再改它，码为 `created-in-batch`。两种意图都一样。可以引用它：值里写 `{ref: "tmp:…"}`，`place.parent` 写它的临时 id，发布时按 `idMap` 换掉。
- **新建条目**：顺序排在同层最后（同层最大的 `order` 加 1），由内核算。带实例声明的类型，内核补 `declared: []`。
- **移动**：
  - `place.after` 取它与下一个兄弟的中数，落不进两者之间时拒收，码为 `order-exhausted`，不做整层重编号；
  - 成环、指向自己照旧按 `invalid-tree` 拒收；
  - `appears`、`sameAs` 的校验照现有的出场与马甲规则。
- **同一处不改两次**：两项操作的地址相同，或一个是另一个的前缀（例如去掉一个元素，又改它的子字段），拒收 `duplicate-address`。
- **新的问题细项**：都放在 `validation-failed` 的 `problems` 里，`path` 写 `ops[2]` 这样的序号：
  - `duplicate-address`、`element-from-change`、`created-in-batch`、`op-not-in-intent`（例如 creative 里用了 `add`、`note`）、`order-exhausted`；
  - 已经启用的类型再加时复用现有的码；加的元素 id 已存在时复用 `id-taken`。
  - `stale-read` 是顶层失败码，不是细项。
- **元素 id**：缺省由内核生成，复用 `generateFieldId` 的算法（`registry.ts`），避开这个列表在初值与全部变更里用过的 id。以引用为键的列表，元素 id 是被引用条目的 id（components.md 输出 19），不带 `label`；别的列表元素要带 `label`。
- **结果**：修订、`idMap`、各项的 `route`（`init`、`patch`、`change`，增删再加“写进初值”）、后面改过同一地址的记录。
- **请求 id**：按调用方给的整份输入算摘要，同输出 16、24。
- **单项入口**（`editInPlace`、`recordDelta`、`recordNote`、`previewEdit`）：
  - 改成共用这里的路由与候选计算，但各自的请求摘要算法、`what`、章、缺省标题、失败码与 `route` 照旧；
  - 已落盘的旧请求重发得到原来的结果，不变成 `request-id-reused`；
  - 差分测试守其余的合同，章首与显式主线两处修正另写断言。
- **条目读取加 `removedComponents`**：被去掉过的设定组（命名空间与类型），界面据此列“恢复”。
- **`findEntries(world, {query, kinds?, types?, position?, cursor?, limit?})`**：
  - 匹配：名字或别名包含 `query`，不分大小写；名字与别名按给的位置取，缺省是世界的缺省读取位置；
  - 不列删除的条目；那个位置上还没出场的也列，标“还没出场”；
  - 排序：全等、前缀、包含，同档按树序；
  - 带视图令牌时拒，并记进视图审计；
  - 游标摘要带上位置、筛选与排序参数；
  - 性能：量内核方法，样本按 canon.project 输出 14 的参考规模（约 520 个条目），预热后 50 次取中位数，阈值 20 毫秒，证据写负载。

### 2. canon 的远程合同与服务（`plugins/canon/shared/contracts.ts`、`backend/remote.ts`、`nb-canon/src/service`）

- **新方法**：
  - `editEntries`：write，带可选的独占令牌，同现有写入；
  - `previewEntries`：read；
  - `findEntries`：read。
- **WorldService**：加同名方法，并照第 1 节“候选、核对与发布”只追加通过核对的候选。
- **合同版本**从 1 升到 2，照 `nbook.projects/projects` 加方法时升版本的先例。老页签得到 `version-changed`，照现有提示刷新。
- **浏览器端**：新建、删除改走 `editEntries` 的 `create`、`delete`，删掉 `web/new-entry.ts` 的 `lastOrder` 与拼整份条目的代码，删掉 `EntryPageHost.vue` 删除时的拼装。
- **事件**：浏览器的 `CanonWorld` 加事件出口，在“版本不大于已知版本就丢”的比较之前，按修订 id 去重交出 `changed` 的 `{version, revision, by, what, title}`，给 Agent 的提示用（第 4 节）。

### 3. Agent 工具（新文件 `plugins/canon/backend/agent-tools.ts`，canon 的服务端入口）

- **入口**：
  - canon 插件描述的位置从 `["project", "browser"]` 加上 `"server"`，新建服务端入口，依赖 `projectsKey`；删掉“第一版不建服务端入口”的注释。
  - 每个工具用 `agentTool(id, 声明)` 写声明与激活事件，第一次调用才激活。
- **找世界**：执行时用会话的 `context.project` 先 `projects.acquire` 取租约，再调 `use(canonWorldContract).at({project})`，最后释放。
  - 会话不属于任何作品时，回“这个会话不属于任何作品”；
  - 取不到租约时，回“作品打不开”及原因。
- **写入者**：一律记为 `{kind: "agent", session: context.sessionId}`，`what: "creative"`，由实现填写，模型改不了。
- **请求 id**：`agent:<会话 id>:<ctx.invocation>`，`invocation` 是全局唯一的调用身份，`callId` 只在一条回复里唯一（harness/runtime.md）。
  - 同一次调用的重发复用已经解析好的整份请求；
  - 链路断了先按请求 id 查结局（`outcome`），再决定要不要重发。
- **读前提**：`canon_write` 一律带 `sameVersion: true`。世界在它读过之后有新修订就拒收，回话列出之间的修订，请它重读再写。
- **谁拿到**：四个工具都是 `defaultForAll: true`、`group: "设定"`。写作助手、临时帮手默认都带，`defaultTools: false` 的 Profile 不带（记进待确认）。

| 工具（模型看到的名字） | 参数 | 返回与上限 |
|---|---|---|
| `canon_lookup` | `names`（1 到 20 个）、`at?` | 每个名字最多 5 个匹配，每行一个：id、名字、别名、种类、启用的设定组、简介。没有这个名字时写“没有叫 X 的条目”，附 `findEntries` 最相近的 3 个。总长不超过 3000 字 |
| `canon_tree` | `parent?`（id 或名字，缺省最上层）、`limit?`（缺省 30，最多 50）、`cursor?`、`at?` | 一层的条目：id、名字、种类、有没有子条目、未出场或已删除；共几条、续读游标 |
| `canon_read` | `entry`（id 或名字）、`at?`、`mode?`、`show?`（`fields` 缺省；`text`、`origins`、`history`）、`field?`、`cursor?` | 第一行写位置与世界版本。<br>`fields`：每个启用的设定组一节，每个字段一行，写显示名、id、值、种类、选项或范围、可指向的种类；列表每个元素一行，最多 20 行；超过 6000 字截断并写明怎么读全。<br>`text`：给 Agent 的渲染（`render` 的 `audience: "agent"`），4000 字一页。<br>`origins`：一个字段的来历，最近 15 步。<br>`history`：涉及它的最近 10 次修订 |
| `canon_write` | `version`、`title`、`why?`、`intent?`（`setting` 缺省或 `story`）、`at?`、`edits`（1 到 30 项，扁平对象：`op`、`key?`、`entry?`、`field?`、`value?` 等，同第 1 节的操作）；或单独一项 `revert: {revision, withDependents?}` | 成功：修订、新版本、新建条目的 id、带来的变化的前 20 条（1500 字以内）。<br>失败：码、第几项、为什么、该怎么改（2000 字以内）；冲突时附被改过的对象的当前字段或之间的修订 |

- **名字与地址的解析**：在工具层做，内核只认 id。
  - `entry`、引用的值、`parent`、`after`、`sameAs` 可以写名字。工具层先收齐，一次 `lookup` 按 `at` 位置解析：没有匹配时回最相近的几个，多于一个时列候选让模型选，不替它选。
  - `create` 用 `key` 起代号，后面的项在引用与 `parent` 里写 `$代号`。不能再对它 `set`，初值写在 `create` 里。
  - `field` 写 `设定组.字段`，或 `设定组.字段[元素].子字段`；设定组与字段写 id 或显示名都行，显示名有歧义时回候选。
  - 值按声明预检：选项不在范围内时回允许的取值，数超范围时回范围，引用的种类不符时回允许的种类。预检只为回话好懂，内核的校验才是最终的。
- **审批**：
  - `canon_write` 的 `effect` 固定为 `write`，照会话的审批模式走，询问模式下作者会被问到。
  - 不提供预览参数：冷会话的只读模式在工具激活前就按声明拒绝，按参数降级拿不到；界面有预览，Agent 写错了可以撤销。
  - 已知的摩擦：`auto` 模式下它没有路径，每次都问审批模型，本次不改权限规格。
  - 其余三个工具是 `read`、`concurrency: "shared"`；`canon_write` 是 `exclusive`。
- **说明文字**：用中文，每种操作一行，写清地址的写法、两种意图、`version` 从哪来、新建的东西初值写在哪；总长不超过 1200 字。

### 4. 作者界面（`plugins/canon/web`）

#### 写入走哪条

- **就地改与 `previewEdit`**：单字段的改，包括数、文字、选项、是否、引用、图片、语义档的起点、条目的名字与简介；
- **`editEntries` 与 `previewEntries`**：列表元素的增改去、别名、主文字的块、移动（含出场与另一个身份）、加或去一组设定、新建、删除、恢复。

保存前都显示“会写回哪里”和“带来的变化”。保存后出现现有的“保存后的提示”（看回执、撤销）。

#### 草稿与确认条

- **草稿**：标签状态里的 `edit` 改成按种类区分的一份，同一时间只有一份；切走再回来还在（输出 7）。种类有字段、条目头、元素、块、移动。值的类型改成 `unknown`。
- **确认条**：
  - 移到页头之下、分页之上，各分页共用这一处，数据分页里不再各挂一份；
  - 条目头的草稿读条目读取里的名字、简介，意图规则同字段；
  - 输入区按字段种类分：现有的标量输入照旧；引用用 `EntryPicker`，图片用 `ImageInput`，这两个是新的受控组件，元素对话框也用它们。
- **`ComponentViewContext`**：新方法一次列进 author-ui 的输入一节，剧情插件的专门分页经它用到。新方法有列表的加一项、改一项、去一项，记一句，以及去掉这组设定。

#### 入口与状态

| 入口 | 已删除 | 按计划模式 | 世界只读、别人独占、断开（`writeBlocked`） | 读取位置是初值 |
|---|---|---|---|---|
| 新建（空状态、标题栏、右键、选择器里新建） | — | 可用 | 禁用并写原因 | 可用 |
| 页头的改名字、简介、别名 | 不出 | 禁用（同字段） | 禁用并写原因 | 可用，只能改设定 |
| “更多”：移动、添加一组设定 | 不出 | 禁用 | 禁用并写原因 | 可用 |
| “更多”：删除 | 不出 | 照现有 | 禁用并写原因 | 可用 |
| 恢复 | 最简页头上出 | — | 禁用并写原因 | 可用 |
| 字段、列表、块的改 | 不出 | 禁用（照现有） | 禁用并写原因 | 只能改设定 |

已删除的条目页补一个最简的页头：名字、“这个条目已删除”、恢复。

#### 各处的改法

- **空状态**：条目树一个条目都没有时，换成 nb-ui 的 `EmptyState`：
  - 标题“还没有设定”，一句说明“人物、地点、物品、规矩，都可以建成设定”；
  - 主按钮“新建人物”：打开新建对话框，种类预填“人物”，勾上人物设定组；
  - 次按钮“新建条目”；
  - 侧栏窄时两个按钮纵排。
- **新建对话框**：
  - 种类快捷按钮是“人物、地点、物品、其它”与已用过的种类合并去重；
  - 选了种类时，与种类同名的设定组预勾；
  - 上级与另一个身份的候选改用 `EntryPicker`；
  - 创建后打开条目页。
- **条目页头部**：
  - 名字、简介各有“改”，走确认条（条目头草稿）；
  - 别名是一行小标签，各带“×”，末尾“＋”，走 `aliases`；去掉某章变更加的别名时，照 `element-from-change` 写明是哪一章加的；
  - “更多”菜单加“移动到……”与“添加一组设定”。
- **移动对话框**：
  - 上级用 `EntryPicker`，排除自己，成环由内核拒；
  - 分组缺省跟着种类，规则同新建；
  - 顺序选“放在最后”或“放在某项之后”，候选按新上级读一层树；
  - 出场（开头或某章开头）与另一个身份也在这里改；
  - 树的右键菜单加“移动到……”，打开同一个对话框。
- **加或去一组设定**：
  - 加：分页条末尾“＋ 添加设定”，列出登记了、有命名空间、这个条目还没有的类型，`removedComponents` 里的标“恢复”。选中后发 `component add`，新分页的字段都是“未知、可填写”。
  - 去：每个数据分页的“更多”里“去掉这组设定”，确认时写“数据会保留，可以再加回来”。去掉当前分页后回到第一个分页。
  - 界面上不出现“Component”“命名空间”，说“设定”“一组设定”。
- **字段表**：每种字段都能改，值未知时按钮写“填写”。行的模型带元素 id，元素来自变更的标出来。
  - **引用**：确认条里用 `EntryPicker`（按声明的 `targets` 筛），可清空，清空写成未知（`null`）；
  - **图片**：`ImageInput`，作品内路径与说明两个输入，路径不合规则时显示服务给的原因；
  - **语义档**：“改起点”走确认条，用起点预填，不用显示的归纳文字；每个数据分页都能“记一句”（现在只有面板分页能记一笔）；
  - **列表**：每个元素一行，带“改”与“去掉”，列表末尾“添加”。
- **元素对话框**（nb-form 的 `SchemaForm`）：
  - 描述由一个纯函数从元素的子字段声明生成：
    - 引用写成可空，`targets` 用闭包按字段路径查给 `EntryPicker` 控件；
    - 数用 canon 的数字控件（`parseDecimal`）；
    - 非引用列表多一个“名字”输入（元素的 `label`）；
    - 以引用为键的列表先用 `EntryPicker` 选条目，已在列表里的灰掉，不带名字。
  - 语义档子字段在对话框里只读，旁边有“改起点”（用起点预填）与“记一句”。
  - 保存：
    - 先让表单 `commit`；
    - 只发改过的子字段，按对象读取的原始值比，不按显示值比；
    - 服务端的问题写在对话框顶部；
    - 底部同样选意图（改设定、剧情里变了，初值上没有后者）。
- **去掉一个元素**：点“去掉”先预览。来自变更时写明是第几章加的，只给“剧情里变了（在第 N 章末尾去掉）”一个出路：变更详情页没有去掉补丁的入口。
- **选择器选不到时**：`EntryPicker` 的空结果行给“新建‘词’”。种类取 `targets` 的第一项，与种类同名的设定组预勾，建好后自动选上。
- **主文字**：
  - 能写的条目总出“文字”分页，空时写“还没有主文字”加“加一段”（输出 9 跟着改）；
  - 每一块旁边“改这一段”，打开条目读取里所选位置上的源文字，走 `set`，地址 `text[块]`；
  - 文末“加一段”（`addBlock`）；块的菜单里“删掉这一段”（`removeBlock`）；
  - 渲染错误不在保存前预览，保存后照现有的“出错的块”显示（已知限制）。所见即所得的编辑器是 t28 的范围。
- **Agent 改了东西**：
  - 事件出口交来的修订 `by` 是 Agent 时，给一条 Agent 提示，单独一格：“Agent 改了设定：<最近一次的标题>”，之后再改写“又改了 N 次”；
  - 带“看回执”“撤销”（都指最近一次）与“看改动记录”（按写入者 Agent 筛）；
  - 不顶掉作者自己的保存提示，还原对话框开着时不替换；
  - 没有页面挂着时不发工作台通知；
  - 回执与改动记录里的“Agent”已有，不重做。
- **剧情插件的专门分页**（知道什么、目标与态度、谁知道）：各自带的那一节通用字段表含这个命名空间的全部字段，知情与态度两个列表都在，随上面一起能改。专门表格里的就地操作留到人物闭环。

#### 新组件

每个都带同名 `.md`、dom 测试、Lab 场景：

- nb-ui：`SearchSelect` 的远程模式（改现有组件，补 `.md`、测试与场景）。
- canon：`EntryPicker`、`ImageInput`、`ElementDialog`、`AliasRow`、`MoveDialog`、`AddComponentMenu`、`BlockEditor`、`AgentNotice`；`EntryTree` 的空状态与 `EntryPage` 的已删除页头是改现有组件。

## 四、Spec 与文档改动

- `docs/specs/canon/revisions.md`：
  - 新增输出 25“一次改几处”：输入、两种意图、工作副本、候选与核对、读前提、只写初值的增删、批内新建、新问题细项、结果；
  - 输出 8 补列表元素与增删的规则；剧情变化读回核对的位置；显式主线；
  - 输出 10 的“写入请求里直接写成把 A 换成 B”接上 `replace`，去掉 planned；
  - 失败码表加 `stale-read`；实现合同的公开入口加上新函数。
- `docs/specs/canon/project.md`：方法表加 `editEntries`、`previewEntries`、`findEntries`，写合同版本 2；事件那一段不变。
- `docs/specs/canon/components.md`：输出 3、7 写明加、去、恢复用哪种操作；补元素 id 的生成与 `label` 的规则；条目读取的 `removedComponents`。
- `docs/specs/canon/author-ui.md`：
  - “不承诺”里“作者编辑条目的主文字”改成只不承诺所见即所得；
  - 输入一节加 `ComponentViewContext` 的新方法；
  - 输出 4 的候选来源与快捷种类；
  - 输出 7 的草稿；输出 9 的“文字”分页；
  - 输出 12 到 17 的各种字段与确认条的位置；输出 18 加 Agent 提示；输出 19 的删除与恢复；
  - 新增：页头改名、简介、别名，“更多”菜单，移动，加或去一组设定，空状态，入口与状态表。
- `packages/nb-ui/src/components/form/SearchSelect.md`：远程模式；`docs/specs/ui/forms.md` 里提到它的地方一并核对。
- 新建 `docs/specs/canon/agent-tools.md`（`canon.agent-tools`，planned）：工具清单、参数、返回与上限、名字解析、读前提、失败对照、写入者、请求 id、审批、会话不属于作品时的回话；注册表登记。
- t20 的 README 回填：本 Task 做了四个工具，`changes`、`search` 没做及其理由。

## 五、切片

| 片 | 内容 | 对应设计 | 自跑验证 |
|---|---|---|---|
| F1 | 内核 `editEntries`、`previewEntries`、`findEntries`、`removedComponents`；单项入口改成共用路由并修章首与显式主线；Spec revisions、components | 1 | nb-canon 全部测试、新的差分测试、findEntries 的测量 |
| F2 | 远程方法、服务方法，合同版本 2；浏览器的新建与删除改走 `create`、`delete`；事件出口；Spec project | 2 | canon 插件测试、`two-process.test.ts` |
| F3 | Agent 工具的服务端入口与四个工具；Spec agent-tools | 3 | 新的 `agent-tools.test.ts`（真实服务端加项目子进程、真实 Agent 会话加脚本化模型）；一条 `*.llm.test.ts` |
| F4 | nb-ui `SearchSelect` 远程模式；canon `EntryPicker`、`ImageInput` | 4 | nb-ui 与 canon 的 dom 测试、Lab 场景 |
| F5 | 界面：草稿与确认条上移；空状态；新建对话框；页头（名字、简介、别名、更多）；移动对话框；加或去一组设定；已删除页头与恢复；Agent 提示 | 4 | 组件 dom 测试、Lab 场景 |
| F6 | 界面：字段表的引用、图片、语义档、列表与元素对话框；主文字的块；`ComponentViewContext` 新方法 | 4 | 组件 dom 测试、Lab 场景 |
| F7 | e2e 与截图 | 全部 | `canon-author.e2e.ts` 加用例，新的 `canon-agent-write.e2e.ts`（含空作品的环境） |

每片单独提交。F4 只依赖现有接口，可以在后端第二轮设计审查期间先做。F3 做完在汇报里写一句：在应用里已经可以让写作助手读写设定了。

## 六、验收映射

Spec 条目编号在写 Spec 时定，这里按行为列。

- 内核（`nb-canon/tests/entry-edits.test.ts`，新增，用真实 `WorldService`）：
  - 原子性；
  - 候选核对失败时日志、版本、请求 id、事件都不动；
  - 两种意图；
  - `stale-read`，含“作者另加剧情变更、Agent 按旧值写剧情变化”的跨对象例子；
  - 章首写剧情变化能读回；显式主线与缺省子线；计划线不能写；
  - 列表元素的来历：只改初值里的一行、另一行增删、同 id 删后重加、整表赋值、子线带过去的 → 只有第一种按初值改，其余 `element-from-change`；
  - `created-in-batch`；`duplicate-address`；`tmp:` 引用；`order-exhausted`；
  - 预览与写入逐字相同；请求 id；日志重放后一致。
- 单项入口的差分：现有输入经新旧实现，修订的 `ops`、带来的变化、`what`、章、标题、失败码与 `route` 相同；旧日志里的请求重发得到原结果。章首与显式主线两处另写断言。
- `findEntries`：缺省不列删除的；还没出场的标出；位置上改过的名字与别名；视图令牌拒绝并审计；性能证据。
- 远程：`canon.test.ts` 加 `editEntries` 的版本冲突与 `stale-read`、视图令牌拒绝。
- Agent 工具（`agent-tools.test.ts`）：
  - 四个工具各一条；
  - 名字解析的三种结局；选项写错时回允许的取值；
  - `stale-read` 时回之间的修订；
  - 询问模式下 `canon_write` 会询问；只读模式下拒绝；
  - 写入者是 Agent；
  - 两条回复复用同一个 `callId` 各出一条修订；同一次调用重发不多写；
  - 会话不属于作品时的回话。
- LLM：真实模型照“给星瑕加别名小瑕，把性格改成沉默”写成一次修订。
- 界面：各组件的 dom 测试（含版本冲突、值刚变了时保留输入，`element-from-change` 的出路，入口在各状态下的禁用与原因，Agent 提示不顶掉作者的提示）。e2e 的组合场景：
  1. 空作品点“新建人物”，建出人物并填字段；
  2. 作者改列表、引用、名字，然后还原；
  3. 经工具写入后，作者窗口出现 Agent 提示，能撤销，改动记录里标“Agent”；
  4. 390 像素下页头、设定视图空状态不横向滚动。

## 七、验证

- 受影响的测试：`bun run test:affected`；nb-canon 全部（含差分测试）。
- e2e 只跑 `canon-author.e2e.ts`、`plot-author.e2e.ts` 与新加的文件。
- 真实浏览器：`nbdev dev start` 起服务，`nbdev shot` 截空状态、页头、列表对话框，以及 Agent 写入后的提示与改动记录。
- 真实模型：只跑 F3 的那一条 LLM 测试，用 `.env` 里的测试模型。
- 未验证的边界：
  - 作者与 Agent 同时改同一条目时，只有冲突的测试，不做压力测试；
  - 审批卡片上 `edits` 参数的显示效果只截图看。

## 八、不做与风险

不做：

- `changes`、`search` 两个读工具：
  - `canon_read` 的 `history` 已能看到最近改动；`search` 要给正文与变更建索引。
  - 闭环用不到，记进 t20。
- Agent 的写前预览：冷会话的只读模式拦在激活前，要 agent 平台支持按参数定等级才能做；审批卡片的写前预览同样要平台的审批预览钩子。
- 改设定意图下改“某条变更增进来的元素”：拒收并指向“剧情里变了”。Spec 那一行保留 planned。
- 面板的字段声明（带实例声明的类型）：作者与 Agent 这次都还不能给面板加字段，面板分页仍写“这个面板还没有内容”。记进待确认。
- 图片的选文件、上传与“文件在不在”的检查。
- 渲染错误的保存前预览；主文字的所见即所得编辑（t28）。
- 自动预查、Component 用法提醒：t20 的写手上下文与提醒扩展。
- 一次填一组的设定表单、剧情里的 `启用`（从第 N 章起有）：人物闭环再定。
- 剧情插件专门表格里的就地操作：人物闭环再定。
- UI 打磨：照开发者的优先级排到最后。

没采纳的独立设计提议：

- **第一片不动内核**：独立设计提议先用现有方法拼出工具，Agent 一次多处会变成多条修订，下一片再换。没采纳：要写一批下一片就删的拼装，而内核批量的工作量与它相当。
- **不给所有会话、另设“设定助手” Profile**：没采纳。开发者要的是 Agent 能改，写作助手本身就该能改设定；每个会话多出的声明约 2000 到 3000 token，可以接受。记进待确认，要改回只需改一个开关并加一个 Profile。

风险：

- 单项入口改成共用路由，可能改变现有结果。由差分测试和现有的就地改、记一笔、预览测试（都用真实世界）兜底；有意的两处修正另写断言。
- **按对象判冲突**：
  - 作者在页上填人物的同时 Agent 在补同一人物的别的字段，后到的一方得到冲突；
  - Agent 一侧更严，带 `sameVersion`，只要有新修订就重读；
  - 修订本来存到叶子，没有找到“不细到叶子”的记录理由。本次不改，冲突时回话写清楚，真实使用后再看要不要改上游（独立设计 8.2，记进待确认）。
- 模型写错参数：说明里写清写法，工具层解析与预检，回话给出能照着改的信息。LLM 测试兜底一条，更多场景留到闭环。
- nb-ui 的 `SearchSelect` 是共用组件：远程模式是新增的可选模式，现有用法不变，由现有 dom 测试兜底。
