# t37 计划：写入底座

## 一、Context

开发者 2026-11-19 看过 t31 第二批第一期后定的方向（Work README 决定表同日）：

- 原话：“要用户和 agent 都能改，这个是最重要的”；“先把底座做好，然后再考虑做通一个闭环（候选的闭环就是人物 Component 设定）”。
- 优先级：先做功能与基本 UX，UI 与 UX 的打磨排到最后。
- 空状态要改：“没有设定还是一个白板，需要右键才能创建设定”。

现状（主会话 11-19 核实，独立设计复核一致）：

- **Agent 一侧**：canon、剧情插件没有贡献任何 Agent 工具、Skill 或 eval 对象。canon 的项目入口注释写明第一版不建服务端入口（`canon/backend/plugin.ts` 头部）。Agent 在主服务进程，世界在项目进程，Agent 读写不了设定。
- **作者一侧**：条目页只能就地改数、文字、选项、是否四种字段（`canon/web/rows.ts` 的 `EDITABLE_KINDS`）。另外能新建、删除条目，能记一笔（只在面板分页）、还原。下面这些在界面上都改不了：列表、引用、图片、语义档的起点、条目的名字简介别名、主文字；给已有条目加或去 Component；移动。
- **新建与删除**：由界面自己拼整份条目再发布，各拼一份（`web/new-entry.ts`、`EntryPageHost.vue` 的删除段）。
- **空状态**：条目树空着时只有一行灰字“还没有条目”；“+”在侧栏标题栏，空白处右键也能新建，都不显眼。
- **内核**：发布、就地改（`nb-canon/src/world/edits.ts`）、记一笔、还原都有，但一次只改一处。同一对象连着就地改两次拼不成一次修订（会撞 `id-taken`）。列表的增删、Component 的加去、移动都没有按意图路由的写法。

本 Task 的范围就是“底座”（主会话对开发者原话的理解，记在待确认清单）：

- 作者在界面上、Agent 用工具，都能改设定的全部数据：各种字段、列表与元素、引用、图片、语义档、条目的名字简介别名、主文字的块、Component 的加与去、移动、删除与恢复；
- 写入走同一条通道，一次操作一条修订；
- 作者看得到 Agent 改了什么，能撤销；
- 空状态有明显的新建入口。

人物 Component 的闭环（一次填一组的设定表单、闭环的验收脚本）在底座之后和开发者定。

依据：

- 已接受的[内核提案](../../../../../docs/proposals/world-engine-kernel.md)第 9 节（Agent 的工具）；
- Spec：[`canon/revisions.md`](../../../../../docs/specs/canon/revisions.md)（输出 1、7、8、10、16、19、22 到 24）、[`canon/components.md`](../../../../../docs/specs/canon/components.md)（输出 3、5、7、15、18、19）、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md)（新建、就地改、确认条、保存后的提示）；
- [`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)（`agent.tools`）、[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md)、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)（`{project}` 目标）、[`runtime/projects.md`](../../../../../docs/specs/runtime/projects.md)（租约）、[`ui/forms.md`](../../../../../docs/specs/ui/forms.md)。

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
| 列表元素的表单 | `@notnotype/nb-form` 的 `SchemaForm`（仓库已有，设置页在用）加两个自定义控件（条目选择、图片），字段声明经一个纯函数转成它的描述 | 列表的增删与焦点、问题显示、受控提交它已做；否决手写。它的选项源是静态清单（forms.md 输出 11），条目选择要远程搜，所以做成自定义控件 |
| 条目选择器 | nb-ui 的 `SearchSelect`，按输入调新的 `find` | 仓库已有；否决把全部条目一次读进下拉 |
| Agent 工具的参数 | TypeBox 写 schema，扁平对象，`strict: false`，各操作的必填项由工具层校验并用中文回话 | 大的 `anyOf` 在严格模式下受提供商限制，模型也容易写错；否决每种操作一个工具（失去原子性，多占声明的 token） |
| 跨进程调世界 | 工具实现先 `projects.acquire(会话的项目)` 取租约，再经插件信道的 `{project}` 目标调 `nbook.canon/world`，调完释放 | 同 `projects://` 文件方案（`plugins/files/backend/projects-scheme.ts`）；否决无租约访问：项目在 `idle-grace` 时会被拒，作者关了窗口后 Agent 会随机失败 |

没有新的外部依赖。

## 三、关键设计

### 1. 内核：一次改几处（新文件 `packages/nb-canon/src/world/entry-edits.ts`）

公开 `editEntries(world, input, time)`、`previewEntries(world, input, time)` 与 `findEntries(world, query)`。

现有的 `editInPlace`、`recordDelta`、`recordNote`、`previewEdit` 改成一项操作的 `editEntries` 的薄包装：对外的输入、失败码、结果与 `route` 不变，不留第二条路径。用差分测试兜底：同一批输入，旧实现留在测试里，和新实现比修订的 `ops` 与带来的变化，要逐字相同。

```ts
interface EntryEdits {
    readonly requestId: string;
    readonly by: Actor;
    readonly what: "edit" | "creative";       // 作者保存或 Agent 的创作修改（revisions.md 的 `what`）
    readonly baseVersion?: number;            // 读到的世界版本；只在全部是 create 时可以不给
    readonly title: string;
    readonly why?: string;
    readonly intent?: "creative" | "story";   // 缺省 creative
    readonly position?: ReadPosition;         // creative：从哪个位置看当前值；story：落点（不能是初值）
    readonly ops: readonly EntryOp[];         // 1 到 50 项，按顺序作用在同一份工作副本上
}
type EntryOp =
    | {op: "create"; id: string /* tmp: 开头 */; entry: NewEntry}   // 名字、种类、分组、上级、启用的类型、出场、马甲
    | {op: "set"; at: Address; value: unknown; read?: unknown}       // 带 read 时值不同拒收 value-conflict
    | {op: "replace"; at: Address; find: string; with: string}       // 文字或一块里把 A 换成 B（输出 10）
    | {op: "listAdd"; at: Address; element: unknown}                  // at 是列表字段；元素 id 缺省由内核生成
    | {op: "listRemove"; at: Address}                                 // at 是 `ns.字段[元素]`
    | {op: "aliases"; entry: string; add?: string[]; remove?: string[]}
    | {op: "addBlock"; entry: string; source: string; after?: string}
    | {op: "removeBlock"; at: Address}                                // `text[块]`
    | {op: "component"; entry: string; type: string; action: "add" | "remove"}
    | {op: "place"; entry: string; parent?: string | null; folder?: string; kind?: string; after?: string | null}
    | {op: "delete" | "restore"; entry: string}
    | {op: "add"; at: Address; delta: number; reason?: string}        // 只在 story
    | {op: "note"; at: Address; text: string};                        // 只在 story
```

规则：

- **一次修订**：各项依次作用在工作副本上。副本按对象克隆受影响的条目与变更，结束时每个改过的对象出一份 `put`，发布一个写入请求。成功时全部生效，失败时世界不变（输出 1）。
- **set 的路由**：照输出 8 的路由表，看的是原世界的来历。只有一处变化：值来自某条变更的增元素时，改那个补丁带的元素。这一行在 Spec 里原本标着 planned，这次做掉。
- **剧情变化（story）**：这一批里的字段操作（set、replace、listAdd、listRemove、aliases、addBlock、removeBlock、add、note）合成落点上的一条新剧情变更，补丁按操作顺序排，`involves` 是涉及的条目。精确档的数用 `set` 时照输出 8 换成加减。结构操作（create、component、place、delete、restore）不分意图，都是对象的新值。`component` 的“从第 N 章起有”（剧情里的 `启用`）不在本次。
- **创作修改（creative）的结构性改动只写初值**（独立设计 4.3 的提议，记进待确认）。
  - `listAdd`、`aliases`、`addBlock` 加进初值。
  - `listRemove`、`removeBlock` 只能去掉初值里的。要去掉的元素或块是某章变更加的，就拒收，细项 `element-from-change`，详情给出那条变更。界面与工具据此指路：去那条变更里改，或改选“剧情里变了”。
  - 理由：增删没有唯一的“给出这个值的记录”；落到某条变更里，作者在改动记录里读不懂。
- **新建条目**：
  - 顺序排在同层最后，由内核算（同层最大的 `order` 加 1）；
  - 同一批里的值可以写 `{ref: "tmp:…"}` 引用它，发布时按 `idMap` 换掉（存下来的修订那一段已有这条规则）；
  - 后面的操作直接改副本里的初值。
- **移动**：`place.after` 取它与下一个兄弟的中数；落不进两者之间时拒收，细项 `order-exhausted`，不做整层重编号。成环、指向自己照旧按 `invalid-tree` 拒收。
- **同一处不改两次**：两项操作的地址相同，或者一个是另一个的前缀（例如去掉一个元素，又改它的子字段），而且都指向原世界里已有的数据，就拒收，细项 `duplicate-address`。指向这一批里新建的条目、命名空间或元素的不算。
- **新的问题细项**：都放在 `validation-failed` 的 `problems` 里，`path` 写 `ops[2]` 这样的序号：
  - `duplicate-address`、`element-from-change`、`op-not-in-intent`（例如 creative 里用了 `add`、`note`）、`order-exhausted`；
  - 已经启用的类型再加时拒收，复用现有的码；加的元素 id 已经存在时复用 `id-taken`。
- **结果**：修订、`idMap`、各项的 `route`（`init`、`patch`、`change` 三种，增删再加“写进初值”），以及后面改过同一地址的记录。发布后逐项核对 `set` 的值，失败照旧是 `result-mismatch`，详情带序号。
- **请求 id**：按调用方给的整份输入算摘要，同输出 16、24。
- **`findEntries(world, {query, kinds?, types?, position?, includeDeleted?, cursor?, limit?})`**：
  - 匹配：名字或别名包含 `query`，不分大小写，名字取这个位置上有效的；
  - 排序：全等、前缀、包含，同档按树序；
  - 范围：带视图令牌时拒（防剧透的视图下不让枚举名字）；
  - 性能：按三百万字样本书的条目数量一次中位数。
- **元素 id 生成**：复用 `generateFieldId` 的算法（`registry.ts`）。以引用为键的列表，元素 id 就是被引用条目的 id（components.md 输出 19）。

### 2. canon 的远程合同与服务（`plugins/canon/shared/contracts.ts`、`backend/remote.ts`、`nb-canon/src/service`）

- 新方法：
  - `editEntries`：write，带可选的独占令牌，同现有写入；
  - `previewEntries`：read；
  - `findEntries`：read。
- `nb-canon` 的 `WorldService` 加同名方法。合同版本从 1 升到 2，照 `nbook.projects/projects` 加方法时升版本的先例。
- 浏览器端的新建、删除改走 `editEntries` 的 `create`、`delete`。删掉 `web/new-entry.ts` 里的 `lastOrder` 与拼整份条目的代码，删掉 `EntryPageHost.vue` 里删除时的拼装。现有的就地改、记一笔照旧调原方法：它们已经是批量编辑的包装。

### 3. Agent 工具（新文件 `plugins/canon/backend/agent-tools.ts`，canon 的服务端入口）

- **入口**：
  - canon 插件描述的位置从 `["project", "browser"]` 加上 `"server"`，新建服务端入口，依赖 `projectsKey`；删掉“第一版不建服务端入口”的注释。
  - 每个工具用 `agentTool(id, 声明)` 写声明与激活事件，第一次调用才激活。
- **找世界**：执行时用会话的 `context.project` 先 `projects.acquire` 取租约，再调 `use(canonWorldContract).at({project})`，最后释放。
  - 会话不属于任何作品时，回“这个会话不属于任何作品”；
  - 取不到租约时，回“作品打不开”及原因。
- **写入者**：一律记为 `{kind: "agent", session: context.sessionId}`，`what: "creative"`，由实现填写，模型改不了。
- **请求 id**：用会话 id 加工具调用的 `callId`；链路断了先按请求 id 查结局（`outcome`），再决定要不要重发。
- **谁拿到**：四个工具都是 `defaultForAll: true`、`group: "设定"`。写作助手、临时帮手默认都带，`defaultTools: false` 的 Profile 不带（记进待确认）。

| 工具（模型看到的名字） | 参数 | 返回与上限 |
|---|---|---|
| `canon_lookup` | `names`（1 到 20 个）、`at?` | 每个名字最多 5 个匹配，每行一个：id、名字、别名、种类、启用的设定组、简介。没有这个名字时写“没有叫 X 的条目”，附 `findEntries` 最相近的 3 个。总长不超过 3000 字 |
| `canon_tree` | `parent?`（id 或名字，缺省最上层）、`limit?`（缺省 30，最多 50）、`cursor?`、`at?` | 一层的条目：id、名字、种类、有没有子条目、未出场或已删除；共几条、续读游标 |
| `canon_read` | `entry`（id 或名字）、`at?`、`mode?`、`show?`（`fields` 缺省；`text`、`origins`、`history`）、`field?`、`cursor?` | 第一行写位置与世界版本。<br>`fields`：每个启用的设定组一节，每个字段一行，写显示名、id、值、种类、选项或范围、可指向的种类；列表每个元素一行，最多 20 行；超过 6000 字截断并写明怎么读全。<br>`text`：给 Agent 的渲染（`render` 的 `audience: "agent"`），4000 字一页。<br>`origins`：一个字段的来历，最近 15 步。<br>`history`：涉及它的最近 10 次修订 |
| `canon_write` | `version`、`title`、`why?`、`intent?`（`setting` 缺省或 `story`）、`at?`、`preview?`、`edits`（1 到 30 项，扁平对象：`op`、`key?`、`entry?`、`field?`、`value?` 等，同第 1 节的操作）；或单独一项 `revert: {revision, withDependents?}` | 成功：修订、新版本、新建条目的 id、带来的变化的前 20 条（1500 字以内）。<br>失败：码、第几项、为什么、该怎么改（2000 字以内）；冲突时附被改过的对象的当前字段 |

- **名字与地址的解析**：在工具层做，内核只认 id。
  - `entry`、引用的值、`parent`、`after` 可以写名字。工具层先收齐，一次 `lookup` 解析：没有匹配时回最相近的几个，多于一个时列候选让模型选，不替它选。
  - `create` 用 `key` 起代号，后面的项写 `$代号`。
  - `field` 写 `设定组.字段`，或 `设定组.字段[元素].子字段`；设定组与字段写 id 或显示名都行，显示名有歧义时回候选。
  - 值按声明预检：选项不在范围内时回允许的取值，数超范围时回范围，引用的种类不符时回允许的种类。预检只为回话好懂，内核的校验才是最终的。
- **版本**：`version` 作为写入请求的 `baseVersion`，按对象判冲突（输出 7）。模型不传读到的值，`set` 不带 `read`。冲突时回话写哪些条目在它读过之后被改过，以及它们现在的字段，让它重读再写。
- **审批**：
  - `canon_write` 的 `effect` 是 `write`，按参数求等级：`preview: true` 时是 `read`。照会话的审批模式走，询问模式下作者会被问到。
  - 已知的摩擦：`auto` 模式下它没有路径，每次都问审批模型，本次不改权限规格。
  - 其余三个工具是 `read`、`concurrency: "shared"`；`canon_write` 是 `exclusive`。
- **说明文字**：用中文，每种操作一行，写清地址的写法、两种意图、`version` 从哪来；总长不超过 1200 字。

### 4. 作者界面（`plugins/canon/web`）

所有新的写入都经 `editEntries`，保存前用 `previewEntries` 显示“会写回哪里”和“带来的变化”。保存后出现现有的“保存后的提示”（看回执、撤销）。

- **空状态**：条目树一个条目都没有时，换成 nb-ui 的 `EmptyState`：
  - 标题“还没有设定”，一句说明“人物、地点、物品、规矩，都可以建成设定”；
  - 主按钮“新建人物”：打开新建对话框，种类预填“人物”，勾上人物设定组；
  - 次按钮“新建条目”。
- **新建对话框**：顶部加种类快捷按钮（人物、地点、物品、其它），选了同时填种类、分组、勾对应的设定组。上级与另一个身份的候选改用 `findEntries`。创建后打开条目页。
- **条目页头部**：
  - 名字、简介各有“改”，走确认条，地址 `entry.name`、`entry.summary`；
  - 别名是一行小标签，各带“×”，末尾“＋”，走 `aliases`；
  - “更多”菜单（现在只有“删除条目”）加“移动到……”（上级、分组、种类、顺序一个对话框，走 `place`）和“添加一组设定”；已删除的条目页上有“恢复”。
- **加或去一组设定**：
  - 加：分页条末尾“＋ 添加设定”，列出登记了且这个条目还没有的类型，去掉过的标“恢复”；选中后发 `component add`，新分页的字段都是“未知、可填写”。
  - 去：每个数据分页的“更多”里“去掉这组设定”，确认时写“数据会保留，可以再加回来”。
  - 界面上不出现“Component”“命名空间”，说“设定”“一组设定”。
- **字段表**：每种字段都能改，确认条与意图（改设定、剧情里变了）沿用现在的写法。值未知时按钮写“填写”。
  - **引用**：确认条里一个条目选择器（`SearchSelect` 加 `findEntries`，按声明的 `targets` 筛），可清空；
  - **图片**：作品内路径与说明两个输入，路径不合规则时显示服务给的原因；
  - **语义档**：“改起点”走确认条；每个数据分页都能“记一句”（现在只有面板分页能记一笔）；
  - **列表**：每个元素一行，带“改”与“去掉”，列表末尾“添加”，打开元素对话框（nb-form）：
    - 以引用为键的列表先选条目，已在列表里的灰掉；
    - 对话框底部同样选意图；
    - 去掉时，元素是某章变更加的，就写明是哪一章加的，给“打开那条变更”与“剧情里变了”两个出路。
- **主文字**：每一块旁边“改这一段”，打开 MDX 源文字的文本框，走 `set` 或 `replace`；文末“加一段”（`addBlock`）；块的菜单里“删掉这一段”（`removeBlock`）。所见即所得的编辑器不做，那是 t28 的范围。
- **Agent 改了东西**：窗口收到 `changed` 事件，`by` 是 Agent 时，给一条提示“Agent 改了 3 处：星瑕的外观……”，带“看回执”“撤销”；它和保存后的提示是同一个组件，只是触发源不同。回执页与改动记录里，Agent 的修订标“Agent”。
- **剧情插件的专门分页**（知道什么、目标与态度、谁知道）：各自带的那一节通用字段表随上面一起能改。专门表格里的就地操作，留到人物闭环按需要再加。

共享的“字段声明到输入”的知识放进 `plugins/canon/shared/`，确认条与元素对话框共用。现在确认条用的 `kindOf` 搬过去。

## 四、Spec 与文档改动

- `docs/specs/canon/revisions.md`：
  - 新增输出 25“一次改几处”（输入、两种意图、工作副本、只写初值的结构性改动、新问题细项、结果）；
  - 输出 8 的路由表中“增元素带的值”那一行去掉 planned；
  - 输出 10 的“写入请求里直接写成把 A 换成 B”接上 `replace`，去掉 planned；
  - 实现合同的公开入口加上新函数。
- `docs/specs/canon/project.md`：方法表加 `editEntries`、`previewEntries`、`findEntries`，写合同版本 2。
- `docs/specs/canon/components.md`：输出 3、7 写明加、去、恢复用哪种操作；补元素 id 的生成。
- `docs/specs/canon/author-ui.md`：
  - “不承诺”里“作者编辑条目的主文字”改成只不承诺所见即所得；
  - 输出 4 的候选来源；
  - 输出 12 到 17 的各种字段；
  - 输出 19 的删除与恢复；
  - 新增：页头改名、简介、别名，“更多”菜单，加或去一组设定，空状态，Agent 修订的提示。
- 新建 `docs/specs/canon/agent-tools.md`（`canon.agent-tools`，planned）：工具清单、参数、返回与上限、名字解析、失败对照、写入者、审批、`no-project`；注册表登记。
- t20 的 README 回填：本 Task 做了四个工具，`changes`、`search` 没做及其理由。

## 五、切片

| 片 | 内容 | 对应设计 | 自跑验证 |
|---|---|---|---|
| F1 | 内核 `editEntries`、`previewEntries`、`findEntries`；单项入口改成包装；Spec revisions、components | 1 | nb-canon 全部测试、新的差分测试 |
| F2 | 远程方法、服务方法，合同版本 2；浏览器的新建与删除改走 `create`、`delete`；Spec project | 2 | canon 插件测试、`two-process.test.ts` |
| F3 | Agent 工具的服务端入口与四个工具；Spec agent-tools | 3 | 新的 `agent-tools.test.ts`（真实服务端加项目子进程、真实 Agent 会话加脚本化模型）；一条 `*.llm.test.ts` |
| F4 | 界面：空状态、新建对话框、页头（名字、简介、别名、更多菜单、移动、恢复）、加或去一组设定、Agent 修订的提示 | 4 | 组件 dom 测试、Lab 场景 |
| F5 | 界面：引用、图片、语义档、列表与元素对话框、主文字的块 | 4 | 组件 dom 测试、Lab 场景 |
| F6 | e2e 与截图 | 全部 | `canon-author.e2e.ts` 加用例，新的 `canon-agent-write.e2e.ts` |

每片单独提交。F3 做完先在汇报里写一句：在应用里已经可以让写作助手读写设定了。

## 六、验收映射

Spec 条目编号在写 Spec 时定，这里按行为列。

- 内核：
  - `nb-canon/tests/entry-edits.test.ts`（新增）：原子性；两种意图；只写初值与 `element-from-change`；`duplicate-address`；新建后同一批里改；`tmp:` 引用；`order-exhausted`；预览与写入逐字相同；请求 id；日志重放后一致。
  - 差分：现有的就地改、记一笔、预览输入经新旧两种实现，修订逐字相同。
- 远程：`canon.test.ts` 加 `editEntries` 的版本冲突、视图令牌拒绝、`findEntries`。
- Agent 工具（`agent-tools.test.ts`）：
  - 四个工具各一条；
  - 名字解析的三种结局；
  - 选项写错时回允许的取值；
  - 版本冲突时回当前字段；
  - 询问模式下 `canon_write` 会询问，`preview` 不问；
  - 写入者是 Agent；
  - 同一个 `callId` 重试不重复发布；
  - 会话不属于作品时的回话。
- LLM：真实模型照“给星瑕加别名小瑕，把性格改成沉默”写成一次修订。
- 界面：各组件的 dom 测试。e2e 的组合场景：
  1. 空作品点“新建人物”，建出人物并填字段；
  2. 作者改列表、引用、名字，然后还原；
  3. 经工具写入后，作者窗口出现 Agent 的提示，能撤销，改动记录里标“Agent”。

## 七、验证

- 受影响的测试：`bun run test:affected`；nb-canon 全部（含差分测试）。
- e2e 只跑 `canon-author.e2e.ts`、`plot-author.e2e.ts` 与新加的文件。
- 真实浏览器：`nbdev dev start` 起服务，`nbdev shot` 截空状态、页头、列表对话框，以及 Agent 写入后的提示与改动记录。
- 真实模型：只跑 F3 的那一条 LLM 测试，用 `.env` 里的测试模型。
- 未验证的边界：
  - 作者与 Agent 同时改同一条目时，只有版本冲突的测试，不做压力测试；
  - 审批卡片上 `edits` 参数的显示效果只截图看。

## 八、不做与风险

不做：

- `changes`、`search` 两个读工具：
  - `canon_read` 的 `history` 已能看到最近改动；`search` 要给正文与变更建索引。
  - 闭环用不到，记进 t20。
- 自动预查、Component 用法提醒：t20 的写手上下文与提醒扩展。
- 一次填一组的设定表单、剧情里的 `启用`（从第 N 章起有）：人物闭环再定。
- 主文字的所见即所得编辑：t28。
- 审批卡片的写前预览：要 agent 平台给插件工具开审批预览钩子，另行评估。
- UI 打磨：照开发者的优先级排到最后。

没采纳的独立设计提议：

- **第一片不动内核**：独立设计提议先用现有方法拼出工具，Agent 一次多处会变成多条修订，下一片再换。没采纳：要写一批下一片就删的拼装，而内核批量的工作量与它相当。
- **不给所有会话、另设“设定助手” Profile**：没采纳。开发者要的是 Agent 能改，写作助手本身就该能改设定；每个会话多出的声明约 2000 到 3000 token，可以接受。记进待确认，要改回只需改一个开关并加一个 Profile。

风险：

- 单项入口改成包装，可能改变现有结果。由差分测试和现有的就地改、记一笔、预览测试（都用真实世界）兜底。
- **按对象判冲突**：作者在页上填人物的同时 Agent 在补同一人物的别的字段，会反复冲突。修订本来就存到叶子，没有找到“不细到叶子”的记录理由。本次不改，冲突时回话写清楚；真实使用后再看要不要改上游（独立设计 8.2，记进待确认）。
- 模型写错参数：说明里写清写法，工具层解析与预检，回话给出能照着改的信息。LLM 测试兜底一条，更多场景留到闭环。
- 老页签调新方法：合同升到版本 2 以后，老页签得到 `version-changed`，照现有的提示刷新。
