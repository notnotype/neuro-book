---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: canon.agent-tools
owners:
  - canon 插件
---

# 世界引擎：给 Agent 的设定工具

## 目标与非目标

给 Agent 会话四个工具，读写这部作品的设定：

- `canon_lookup`：按名字找条目；
- `canon_tree`：看条目树；
- `canon_read`：读一个条目；
- `canon_write`：改设定。

写入与作者走同一条通道（[`canon.revisions`](revisions.md) 输出 25 的一次改几处），一次调用一条修订，作者在改动记录里看得到“Agent”、可以撤销。

不承诺：

- 提案第 9 节的 `changes`、`search`（按章列变更、检索正文与变更）；
- 自动预查用户消息里的名字、设定组用法的提醒；
- 写前预览：冷会话的只读模式在工具激活前按声明拒绝，按参数降级拿不到；
- 写入者冒充：写入者由工具填，模型改不了；别的调用方经远程服务写入时给的写入者不在本 Spec 里核对。

已知限制：

- `auto` 审批模式下 `canon_write` 每次都问审批模型（它没有路径，作品内路径的放行规则用不上）；
- 名字解析一次只看一个读取位置上的名字。

## 术语与参与者

- **版本串**：读取结果第一行的“版本 12·a1b2c3d4e5f6”，是世界版本加读取输入摘要（[`canon.model`](model.md) 输出 36）的前 12 位。写入时原样带回，工具解析成一次改几处的读取戳。
- **代号**：`create` 用 `key` 给新条目起的名字，同一次写入的后面几项写 `$代号` 引用它。同一次写入里每个代号只能用一次；没写 `key` 的新条目，结果里写成“第几项”。
- **块**：主文字的一段，有编号。工具不替模型分块：`create` 的 `text` 是一块，`addBlock` 加一块（`after` 写块 id 是放在它后面，（planned）写 `null` 是放在最前，不写是放在最后）。（planned）工具说明里写明什么时候该另起一块：会随剧情变的、带秘密的部分单独成块，因为剧情里的文字变化是整块替换，给写手的简报按块扣秘密。

## 输入与前置条件

- 工具是 canon 插件服务端入口贡献给 `agent.tools`（[`agent.contributions`](../agent/contributions.md)）的四项，都是 `defaultForAll`，组是“设定”。服务端把内置插件都列为必需，入口随启动激活；不必需它的场地里第一次调用才激活。

  | 工具 id | 给模型的名字 | 等级 | 并发 |
  |---|---|---|---|
  | `nbook.canon.lookup` | `canon_lookup` | `read` | `shared` |
  | `nbook.canon.tree` | `canon_tree` | `read` | `shared` |
  | `nbook.canon.read` | `canon_read` | `read` | `shared` |
  | `nbook.canon.write` | `canon_write` | `write` | `exclusive` |

- 会话属于一部作品（`ToolSessionContext.project`，作品的引用）。服务端要有项目登记（`projectsKey`）。
- 读取位置参数 `at`：`"initial"`，或 `{chapter, edge}`（`chapter` 写章 id 或从 1 数的序号，`edge` 缺省 `end`）；不给时是最后一章末尾（没有章时是初值）。

## 输出与可观察行为

1. **找世界。** 每次调用先按会话的作品取项目租约（没在运行的会被打开），再经远程服务的 `{project}` 目标调世界服务，结束时释放。会话不属于任何作品时回“这个会话不属于任何作品”（码 `no-project`）；取不到租约时回“作品打不开”与原因（`project-unavailable`）。
2. **读取结果的第一行**写读取位置（“第 2 章（2）末尾”）与版本串。
3. **`canon_lookup`。** `names` 1 到 20 个：
   - 每个名字最多 5 个按名字或别名完全匹配的条目，每个一行：id、种类、名字、别名、启用的设定组、简介；
   - 没有时写“没有这个名字的条目”，附名字或别名包含这个词的最多 3 个（`findEntries`）；
   - 全文最多 3000 字。
4. **`canon_tree`。** 一层的条目：id、名字（这个位置上的）、种类、有没有子条目、已删除或还没出场；`parent` 写 id 或名字，不给是最上层；`limit` 缺省 30、最多 50；有下一页时给出剩下几项与 `cursor`。全文最多 3000 字。
5. **`canon_read`。** `entry` 写 id 或名字。`show` 缺省 `fields`：
   - `fields`：每个设定组一节，每个字段一行：显示名、id、值、种类与可取的值（选项、范围、单位、可指向的种类、语义档）。列表每个元素一行，最多 20 行，另写还有几项；`field` 只读一个字段时列全。另列以后才启用的、去掉过的设定组。
   - `text`：给 Agent 的渲染（[`canon.rendering`](rendering.md)），每块写块 id。（planned）值写在标签中间、只给看（rendering 输出 8）。
   - `origins`：`field` 这个字段的来历，最近 15 步，有更早的给 `cursor`。
   - `history`：涉及这个条目的最近 10 次修订：id、版本、写入者、标题。
   - 全文最多 6000 字（只读主文字时 4000 字），超了截断并写明怎么读全。
6. **`canon_write` 的写入。**
   - 参数：`title`（最多 60 字）、`why`、`intent`（`setting` 缺省，即创作修改；`story` 是在 `at` 记一条剧情变化）、`at`、`version`、`edits`（1 到 30 项）。
   - 每一项换成一次改几处的一项操作，整次一条修订、全部生效或整批不生效。

   | `op` | 参数 | 换成 |
   |---|---|---|
   | `create` | `name`、`kind`、`key`、`parent`、`folder`、`summary`、`aliases`、`components`（设定组的 id、名字或命名空间）、`fields`（`{"设定组.字段": 值}`）、`text` | `create` |
   | `set`、`replace` | `entry`、`field`、`value`；`find`、`with` | `set`、`replace` |
   | `add`、`note` | `entry`、`field`、`delta`；`text` | `add`、`note` |
   | `listAdd` | `entry`、`field`（列表字段）、`value`（元素：子字段的 id 或名字到值；别的列表写 `label`）、`target`（以条目为键的列表指向的条目） | `listAdd` |
   | `listRemove` | `entry`、`field`（写到元素） | `listRemove` |
   | `aliases` | `entry`、`add`、`remove` | `aliases` |
   | `addBlock`、`removeBlock` | `entry`、`text`、`after`；`block` | `addBlock`、`removeBlock` |
   | `addComponent`、`removeComponent` | `entry`、`component`；加的时候可以带 `declare`（这个条目在这组设定上自己的字段，写法同 `addField` 的声明项，类型要允许） | `component` |
   | `addField` | `entry`、`component`（设定组）、`label`（显示名）、`kind`（缺省 `text`）与别的声明项（`unit`、`min`、`max`、`options`、`suggestions`、`precision`、`item`）、可选的 `id` 与初值 `value` | `fieldAdd` |
   | `renameField` | `entry`、`field`、`label` | `fieldRename` |
   | `removeField`、`restoreField` | `entry`、`field`（恢复时认去掉过的字段） | `fieldRemove`、`fieldRestore` |
   | `move` | `entry`、`parent`（id、名字或 null）、`after`（同上）、`folder`、`kind` | `place` |
   | `delete`、`restore` | `entry` | `delete`、`restore` |

   - 写主文字（planned）：`create` 与 `addBlock` 的 `text`、`set` 写到 `text[块]` 的值整段按 [`canon.rendering`](rendering.md) 输出 22 去值再写。`replace` 写到 `text[块]` 时，`find` 与 `with` 不单独去值：按读取位置、实际模式渲染这一块的带值写法，`find` 在里面恰好出现一次，换成 `with`，整块去值后照输出 1 检查再写回；读取之后这一块变过时按版本冲突拒收。找不到、而 `find` 里带着装饰时，回话写明“按实际模式重读这一块再抄”。交回的文字里有值与当时的不同时（按标签名与地址或式子配对，配不上的不算），照常写入、字段不改，回话写明“文字里的值不写入，现在是 X，改值用 set”。工具说明里写出每种标签的写法与例子。
7. **名字与地址的解析。**
   - `entry`、`parent`、`after`、引用字段的值、`target` 可以写 id、名字（别名也行）或 `$代号`。按读取位置上的名字完全匹配：没有时回“没有叫 X 的条目”与相近的几个，多于一个时列出候选、请它写 id，不替它选。
   - `field` 写“设定组.字段”或“设定组.字段[元素].子字段”。设定组写命名空间或类型名，字段、元素、子字段写 id 或名字；“名字”“简介”“别名”是条目自己的。写 id 的总是认得；写名字时只有唯一命中才认，几个设定组、字段、元素或子字段同名时列出它们的 id，不替它选。
   - `create` 的 `components` 写类型 id、命名空间或名字，同一组列两次拒收；`fields` 写到的设定组没列在 `components` 里时一并启用。没写 `components` 时用这个种类登记的默认设定组（[`canon.author-ui`](author-ui.md) 的贡献点 `canon.entry-kinds`）；写了就照写的，空列表表示不要默认；两种情况下 `fields` 写到的设定组都并上。`create` 可以带 `declare`（`{"设定组": [声明…]}`）：新建时就在那组设定上声明这个条目自己的字段，`fields` 里可以接着给它们初值（按显示名写也认得：没写 id 的声明在工具里先按内核同一个规则生成好 id，显示名带空格、括号时也对得上；`max` 按显示名写的换成那个字段的 id）。`components`、`declare`、`fields` 写了却不是该有的形状（一个名字、null、数组当对象）时拒收、说明该怎么写，不当成没写；`declare` 里同一组设定用两个名字写了两次时拒收。写入成功的回话在每个新条目后面写出它带了哪几组设定（没有时写“没有设定组”）。
   - 字段声明的四个操作只能用在允许条目自己加字段的设定组上（[`canon.components`](components.md) 输出 4、23）；`field` 写“设定组.字段”，字段写 id 或显示名。回话里把拒收的原因写成能照着改的话：类型不允许、这个显示名已经有了、字段是类型固定的、没有这个字段；声明里 `kind` 写错时列出几种种类，显示名是空的、写了不认识的键（初值 `value` 写进了声明）时说明。`addField` 不给初值时新字段是未知，数与引用也照加。`addComponent` 加一组条目上已经有的设定时回“这个条目已经有这组设定”。给 Agent 的字段说明里，文字字段有建议值时列出来，并写明可以写别的。
   - 写不对时回话列出有哪些。
8. **值的预检。** 选项不在范围内时回允许的取值；精确档的数超出最小、最大时回范围；引用写的名字换成 `{ref: id}`。预检只为回话好懂，内核的校验才是最终的。
9. **版本。**
   - `version` 带回版本串，工具解析成一次改几处的 `baseVersion` 与读取戳；只写版本号时只比版本。
   - 读过之后有新修订、或读取的输入变了，整批拒收，回话写“你读过之后世界变了”、之间的修订（标题与写入者），请它用 `canon_read` 重读再写。
   - 只建新条目时可以不给；不全是新建却没给时回“要带 version”。
10. **写入者与请求 id。**
    - 写入者是 `{kind: "agent", session: 会话 id}`，`what` 是 `creative`。
    - 请求 id 是“`agent:` 会话 id `:` 这次调用的 `invocation`”。同一次调用重发得到第一次的结果，回话写明：先按请求 id 查这次调用写过没有（`outcome`），写过就照那次修订回话，不再解析参数里的名字（第一次可能改了名字或删了条目）；两条回复里的调用即使 `callId` 相同也各算一次。
11. **结果。** 成功写修订 id、新版本、新建条目的代号到 id、带来的变化的前 20 处（改前改后，另写让几条剧情变更套不上、待处理的增减）、后面还有几条记录改过同一处；最多 1500 字。`details` 里有修订、版本与 id 对照。
12. **失败的回话。** 写码、第几项、为什么、该怎么改：
    - `accumulated-value` 指向 `story` 的 `add`、`note`，或用 `origins` 找到那一笔；
    - `element-from-change` 指向 `story`；
    - 校验细项列前 5 条。
13. **还原。** 不写 `edits`、写 `revert: {revision, withDependents}`：还原那次修订，写入者同上；有依赖时照 [`canon.revisions`](revisions.md) 输出 11、12 拒收或连同依赖一起还原。

## 状态与转换

工具不存状态；每次调用取租约、调用、释放。

## 副作用与数据

写入是世界日志里的修订（[`canon.project`](project.md)），没有别的落点。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `no-project` | 会话不属于任何作品 | 在作品里开会话 |
| `project-unavailable` | 打不开作品、没有项目登记 | 告诉作者 |
| `bad-position` | `at` 写错了，或没有这一章 | 照回话改 |
| `not-found`、`unknown-field`、`bad-edit` | 名字、字段或某一项写得不对 | 照回话改 |
| `bad-version`、`no-version`、`no-edits`、`too-large` | 参数不全或太多 | 照回话改 |
| 世界服务的失败码（`stale-read`、`version-conflict`、`validation-failed` 等） | 见 [`canon.revisions`](revisions.md) | 照回话改或重读 |

## 边界与兼容

工具的名字与参数是给模型的公开接口；改参数的含义要升工具声明的 `version`。

## 验收与 Smoke

1. **建、查、读、改。** 一次写入建“学院”和挂在它下面的“星瑕”（带别名与外观初值），按别名查得到；读出外观与版本串；带版本改外观与别名。改动记录里这次修订的写入者是这个会话的 Agent。
2. **读过之后作者改了。** Agent 读过以后，作者改了同一个条目的简介；Agent 带旧版本串的写入被拒，回话写出作者那次修订的标题，并提到 `canon_read`。
3. **两条回复同一个 callId。** 两次调用 `callId` 相同、`invocation` 不同，各写一条修订；同一个 `invocation` 重发返回第一次的修订。

Smoke：在应用里让写作助手“给星瑕加别名小瑕、把性格改成沉默”，看条目页与改动记录（真实模型的验收留到人物闭环）。

## 证据

- 批准依据：[作者视角的世界引擎内核（第一版）](../../proposals/world-engine-kernel.md)第 9 节；w00039 Work README 决定表 2026-11-19（作者与 Agent 都能改设定）。
