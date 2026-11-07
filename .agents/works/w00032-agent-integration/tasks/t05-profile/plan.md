# t05 实施计划：Profile 设置页

开发者 2026-11-07 确认第一稿（文末“确认结果”）；评审板三轮的决定与设计审查（2026-11-07，omp、Sonnet）的修订已改进下文。修订后的计划等开发者确认，然后实施。

## Context

Profile 的后端早已做完（`agent/contributions.md`、t10、t18），但用户没有地方看和改：工具绑定 `toolBindings`、Profile 设置 `profileSettings` 只有配置项，不可用的 Profile 被选择器过滤掉、看不到原因，`modelNeeds` 只有类型没人读，用户级 Profile 只能到状态根里手工建文件。开发者 2026-11-07 定：t05 改成实施 Task，排在 t14 之前。

依据：本 Task 的三轮决定；t04 决定 4（绑定存用户配置，必需工具删不掉）；[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md) 输出 4、7、8、13。

## 技术选型

无通用问题。下拉用 nb-ui 的 `SearchSelect`、`Select`，对话框用 `Dialog`。

## 关键设计

### 设置页（`plugins/agent/web/`）

新增 `profile-page.ts`（包装，同 `permission-page.ts`）。page 分区 `nbook.agent.profiles`，分类 `ai`，`order: 25`（模型角色之后、运行可靠性之前），`layout: "fill"`，`layers: ["user"]`。`toolBindings`、`profileSettings` 写 `section` 指向它，不再落进“插件设置”。

组件各带同名 `.md` 与 Lab 场景，文字进 Agent 插件的 zh-CN、en-US 目录（含分区标题、说明、写失败的 `subject`），拆法同 `ProvidersPage`：`ProfileSettingsPage`（状态、选中、写入）、`ProfileRail`、`ProfileDetail`（头部、模型、审批）、`ProfileToolsSection`、`AddToolsDialog`、`NewProfileDialog`。页面组件只吃普通属性，取数在包装里。

- **左栏**：同 `ProviderRail`：两行（名称；来源，有问题时换成“不可用”“有错误”），`aria-current`，上下键、Home、End 移动并选中，只有当前项在 Tab 序列里。可选的在前，`hidden` 的（会话标题）放最后一组“后台”，上下键把两组当一个序列，“新建 Profile”不在序列里。
- **头部**：一行，高度等于小号控件。名称（超长截断）、说明（截断）、右边问题块与用户级的“打开文件”“删除”图标按钮。名称加说明这一整块是悬停提示的触发器（可聚焦），提示写全文、key 和来源：说明为空或被挤没时也拿得到。
- **问题**：都不占新的一行，有没有问题下面的内容位置不变（`ui-development-spec.md` 的“几何、排版与动效”）。Profile 级的（不可用、有错误）放头部右边，全文在悬停；字段级的放标题后的图标和说明行。外观同设置窗口标题区的提示：把 `SettingsSectionHeading` 的 `notice` 块抽成 `ui/settings/SettingsNotice`（加同名 `.md`），两边共用，行为不变。
- **模型**：`SearchSelect`，顺序“跟随默认、角色、模型”，角色带图标区分。选项值：`""` 跟随默认，`role:<key>` 角色，`<服务商>/<模型>` 模型。写 `model` 与 `role` 只留一个，读到两个都有时按 `model`（`models/service.md` 输出 8）。说明行写跟随默认时用哪个角色（`setting.role ?? 声明的 role`）。绑定值不在选项里（模型停用、删了、没凭据、角色没了）时补一个停用项标“不可用”，同 `RolesPage`，并按字段级问题提示；这时不算能力缺口。角色未绑定同样提示。
- **审批模式**：`Select`，哨兵 `"default"` 是跟随默认，写回时删掉 `approvalMode`；四档。说明行写只影响新会话的初值，选 `auto`、`yolo` 时换成它们的后果。`hidden` 的没有这一行。
- **工具**：只列开着的（`hidden` 的不显示这一节，因为没有工具；从未打包成功的也不显示），按提供者分组，组头同 `ProviderDetail` 的模型系列：折叠箭头（`aria-expanded`）、组名、个数，折叠状态不存。一个工具一行，带分隔线，工具名、等级（读、写、执行）、说明各占一列上下对齐，说明截断，悬停看全文；右边一格定宽，必需的标“必需”，其余“×”去掉，可访问名称带工具名和 id（`去掉 edit（nbook.agent.edit-replace）`），同名的也分得清。绑定里有、现在不存在的工具单独一组“已卸载”放最后，用户加的能移除，Profile 必需的只标“必需”。“下一次模型请求起生效”在标题旁的 `InfoTip`。这个 Profile 在 `toolBindings` 里有项时标题行显示“恢复默认”，点了删掉这个 key。
- **工具说明**：声明里的 `description` 是写给模型的（`edit` 的是英文，`read`、`ask` 一段几十字），不能直接给人看。Agent 插件自带的工具在 Agent 目录里写一句短说明（`tools.summary.<id>`）；别的插件的工具取 `description` 第一行，截断。不加声明字段。
- **提供者名**：Agent 插件自带的写“内置”。别的插件：第三方取 `pluginsRegistryContract.list()` 的 `displayName`；内置的把 `plugins/web/builtin-names.ts` 挪到 `plugins/shared/`，按 `nbook.plugins` 命名空间的文字引用取（目录在窗口挂载时已登记，不用激活那个插件）；都没有时写插件 id。左栏的来源用同一个函数。
- **添加工具**：`AddToolsDialog` 同 `ManageModelsDialog`：搜索，按提供者分组，每行“+”，点过变“−”，只列打开时还没开的。改动留在对话框里，只交相对打开时的差，没有差直接关；写入时 `busy`，失败留在对话框、原因写进 `Dialog` 的 `status`（不走通知）。选中的 Profile 变了或没了就关。
- **同名工具**：`edit` 与 `edit-replace`、`ask` 与 `ask-form` 交给模型的名字相同，内核遇到同名先出现的胜出、后面的不放进工具集（[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 15，`nb-harness/src/kernel/run/tools.ts`）。对话框按 `toolCatalog` 的 `providerName` 判断：已开的同名工具是可去掉的，这一行说明后面写“加入后换掉已开的同名工具”，同一次写入里加新的、把旧的写进 `removed`；已开的同名工具是这个 Profile 必需的，这一行停用并写原因。
- **窄**：同 `ProvidersPage`，容器查询 600px 收成顶上的下拉加“+”，下拉选项的说明写状态，后台的排最后。这时工具行改成两行（名字、等级、右边一格；说明），模型与审批的控件换到标题下面（同 `SettingsRow`）。

### 状态

| 情况 | 页面 |
|---|---|
| 目录或工具目录加载中 | 占满内容区居中，转圈加一句说明，`aria-busy`、`role="status"` |
| 读失败 | 占满内容区居中，原因加重试，`role="alert"` |
| 没有可选的 Profile | 不会发生：内置的主创总在；只有“后台”时照常显示 |
| `writable: false` | 所有写入控件停用（含“新建”“删除”“恢复默认”），“打开文件”可用；分区标题区已有层的警告 |
| “本作品”标签 | 窗口按 `layers` 原位说明（`settings-window.md` 输出 8），页面不处理 |
| 选中项消失（删了、重载后没了） | 回到第一项；删除后焦点落到新选中项 |
| 新建等待出现 | 建好就打开文件，收到目录变化、它出现时选中它（状态是“有错误”也选中）；等不到不阻塞 |
| 有错误，从未成功 | 没有工具一节；模型、审批仍能写：键是 Profile key，修好就生效 |
| 有错误，之前成功过 | 问题块写错误；工具一节按上次成功的（会话也还在用它） |
| 不可用（缺必需工具） | 问题块写缺哪个；缺的列在“已卸载”，标“必需” |
| 模型服务不在 | 模型一行停用，说明行写“模型服务不可用” |

打开页面时先订阅 `profileCatalogChanged`，再取目录与 `toolCatalog`；收到事件和 `onResync` 都两个一起重取，用请求序号丢掉迟到的结果（同 `agent/sessions.md` 输出 7、8 的先订阅后取）。

### 写入（`plugins/agent/web/setting-writes.ts`、`shared/`）

`createSettingWriter(settings, setting)` 从 `permission-writes.ts` 抽出，排队加 `expect`，冲突策略由调用方选：

```ts
interface SettingWriter<T> {
    /** 写的那一刻对当时的值求值；别处抢先写了按新值再求一次，最多一次重试。 */
    edit(change: (current: T) => T): Promise<SettingWriteResult>;
    /** 照着旧值改好的整份：别处抢先写了得 `conflict`、不写。 */
    replace(value: T): Promise<SettingWriteResult>;
}
```

规则写入建在它上面，`append` 用 `edit`，`replace` 用 `replace`，行为不变。工具绑定和 Profile 设置只用 `edit`：一次改动写成意图（去掉一个、加几个并换掉同名的、恢复默认、设模型），在写的那一刻对当时的 Record 求值，只动这一个 key，所以连点、两个 Profile、两个窗口都不互相盖。回执前页面显示 `editing` 临时值，队列清空后回到配置服务的值（同规则页）；× 点了立刻消失。写失败走 `context.reportWriteFailure`（对话框除外）。结果为空时删字段：`{added, removed}` 都空、Profile 设置都空，都删掉这个 key，不留 `{}`。

工具集的纯函数抽到 `shared/profile-tools.ts`：`profileToolIds(requirements, defaultForAllIds, binding)` 按 `forProfile` 现在的顺序（required、optional、`defaultForAll`、added，再减 removed，required 不减）交回 id，`forProfile` 改用它，行为不变；`visibleTools(ids, catalog)` 按 `providerName` 先出现的胜出，算“模型实际看到的”，页面列的就是它。意图换算也在这里：开回 Profile 本来就有的工具时从 `removed` 删掉，不写进 `added`。

服务端读的仍是这两个设置项。

### 目录与远程（`plugins/agent/backend/`、`shared/`）

- `ProfileEntry` 加 `tools?`、`defaultTools?`、`role?`、`modelNeeds?`。插件 Profile 来自声明。用户级来自成功过的包（上次成功的值，有错误时 `status` 说明），从未成功时不带；用户级没有 `role`。
- `agent.profiles` 的声明加 `modelNeeds?`：页面不能为了读它激活提供方。`agent.tools` 声明的 `group?` 不动：它在公开的 SDK 类型与清单 schema 里，删除是接口变更，不值得放在这里做；页面不读它（w00036 可以拿它分 MCP 服务器）。
- 远程新增只读方法 `toolCatalog`，交回 `{id, description, providerName, effect, plugin}`，`providerName` 是换算好的（同内核的 `providerToolName`）。
- `ProfileEntry.reason` 换成判别式 `problem`：`{code: "tools-missing", tools}`、`{code: "key-taken"}`、`{code: "module-not-shared", module}`、`{code: "invalid-export"}`、`{code: "build-failed" | "load-failed", file, line?, message}`。`file` 是相对名，`message` 去掉状态根与缓存路径（设置窗口不向浏览器发绝对路径）；原文只进诊断。
- 新事件 `profileCatalogChanged`，只说“目录变了”。`ProfileBundles` 分开两个回调：`changed(keys)` 仍只在生效的包变了时让会话重新解析；新的 `catalogChanged()` 在新建、失败、之前成功后又失败、恢复（哈希不变也算）、删除时都发。工具贡献的 `published`、`revoke` 也发。

### 用户级 Profile

新增远程方法，目录归 `ProfileBundles` 管，不走浏览器文件客户端：它的 `create` 只建空文件、`write` 只存已有文件，分两步时打包器会先读到空文件，第二步失败还留下空文件。

- `createUserProfile({name})`：校验名字（小写字母、数字、连字符，同 key 规则 `user.<名>`），骨架写到同目录的临时文件再 `link` 成 `<名>.profile.tsx`，已有同名得 `exists`，不覆盖。交回 `user://` 地址，页面用 `nbook.editor.open` 打开。设置窗口是非模态的，不用关。
- `deleteUserProfile({key})`：删入口文件。文件没有回收站（`workspace/files.md`），确认文字写明不能恢复、用它的会话变只读（内核已有，码 `unknown-profile`），不写会话数。
- 骨架只依赖 SDK 的 `@notnotype/nb-plugin-sdk/agent`，含名称、说明、工具要求和一段系统提示；测试里真实打包，断言状态 `ok`。不做“复制内置 Profile”：内置的主创依赖插件内部模块（`modesExtensions` 等），复制出去打包不过，这改判第一轮决定“从模板新建即复制”。

### 模型能力提示（`shared/`、`web/`）

`modelNeedGaps(needs, capabilities)`：入参是投影 `{vision, reasoning, contextWindow}`，交回缺看图、思考（`thinking` 对 `reasoning`），或窗口小于 `minContext` 的哪几项；`contextWindow: null` 不算缺。模型找不到时不调它，走“不可用”的提示，不说“能力齐全”。

取数：把 `plugin.ts` 里模型快照的订阅从 `ensureStarted` 拆成 `ensureModels()`，设置页与对话都调它。`RoleOption` 加 `model: string | null`（角色绑定的模型）。设置页另写映射（要保留已绑定但不可用的模型），不用 `modelOptions`。解析顺序同 `agent.ts`：`setting.model`，否则 `setting.role ?? 声明的 role` 经角色到模型。

两处提示，都不拦：

- 设置页模型一行：标题后警告图标，说明行写“这个模型不支持看图”；
- 对话里：`availability` 保持 `ready`，`message` 写缺口。现有的 `profile-unavailable` 会让输入框只读，不能用；横幅只看 `message` 非空。`agent/conversation.md` 写明 `ready` 时 `message` 是不拦发送的提示。

### 给 t14、t15 留的

白名单字段不在这里加，没有使用方的字段就是今天 `modelNeeds` 的样子。这里只定形状：Profile 声明缺省，用户在 `profileSettings` 里按 Profile 增删，页面加一节（已写进 t14、t15 的 README）。`settingsSchema` 表单继续不做，同第一轮决定。

## Spec 与文档改动

- 新建 `docs/specs/agent/profile-settings.md`（planned）：页面的行为、状态、写入、失败；`docs/specs/README.md` 登记。
- `agent/contributions.md`：删“没有界面”那条，声明加 `modelNeeds`，目录加字段与 `problem`（条目级 planned）；远程方法与事件写进 `agent/sessions.md`。
- `agent/conversation.md`：加模型能力提示一条。
- `settings/` 不用改：page 分区规则已有。本 Task README 改范围。

## 切片

每片都含：要显示的文字两份目录、新组件的同名 `.md` 与 Lab 场景。

0. 静态稿：已定稿。
1. 目录字段、`problem`、`toolCatalog`、`profileCatalogChanged` 与 `ProfileBundles` 的两个回调、声明 `modelNeeds`；Spec。验证：`profiles.test.ts`、`agent.test.ts`。
2. `createSettingWriter` 与 `shared/profile-tools.ts` 抽取，规则写入、`forProfile` 改用它们，行为不变。验证：`permission-rules.test.ts`、`permission-page.dom.test.ts`，新增写入器的冲突与重算用例。
3. `SettingsNotice` 抽取；提供者名函数；页面的状态、左栏、头部、模型、审批；拆出 `ensureModels`。验证：新增 `profile-page.dom.test.ts`，真实配置实例。
4. 工具一节与添加对话框。验证：同上，加“页面算的和 `forProfile` 一致”。
5. 用户级新建、打开、删除。验证：真实打包的 `profiles.test.ts`，e2e。
6. 模型能力提示。验证：`session-host.test.ts`、dom 测试。

## 验收映射

Spec 编号写定后补。先列场景与失败方式：

- 工具：改绑定后下一次请求工具集变（`agent/contributions.md` 验收 3，经页面写入）；必需的关不掉；页面列的和 `forProfile` 加内核去重后的一致（required、optional、`defaultForAll`、added、removed 各带同名）。
- 写入：连点两个不同的工具不等结算，两个都生效；两个窗口同时改不同 Profile、同一 Profile 的不同字段都不丢（真实配置服务）；重试后仍冲突走失败通知；空了删 key；规则页 `replace` 仍得 `conflict`。
- 对话框：完成一次写入多项、取消不写、失败留在对话框、同名替换在同一次写入里、必需的同名候选停用、打开期间选中项没了就关。
- 模型与审批：写 `model` 清掉 `role`，跟随默认删字段，审批哨兵不落盘，绑定值不在选项里时显示停用项；对新会话生效（输出 13）。
- 状态：上面状态表每行；`writable: false` 时控件全停用；键盘走左栏；提示的有无不改变下面内容的位置（dom 测位置）。
- 目录：先订阅后取，事件落在两步之间不丢，`onResync` 重取；首次失败、成功后失败、恢复（哈希不变）、删除都发事件；`problem` 里没有绝对路径（语法错误、表外模块、导出错误、求值抛出各一例）。
- 用户级：新建的骨架打包成功、出现在列表和新建会话的选择器里；同名不覆盖；过程中不出现“有错误”的中间状态；删除后选中项与焦点去向，用它的会话变只读。
- 能力提示：角色、模型、跟随默认三条路径；`contextWindow: null` 不提示；有缺口时对话仍能发送。

## 验证

- 自动：`test:affected`；e2e 只跑 `settings`、`agent-conversation`、`lab-agent-ui`；`docs:check`、`governance:check`。
- 真实浏览器：开发服务里走一遍新建 Profile、给它去掉一个工具、绑模型、新建会话用它发一条（本机假端点或开发者同意的真实模型），亮色截图看版式，含 r3 定稿后没出过图的窄屏工具行。
- 未验证边界：`modelNeeds` 现在没有内置 Profile 声明，产品里只有用户写了才看得到，靠测试 Profile 验证。

## 不做与风险

- 不做：`settingsSchema` 表单；按 Profile 的压缩设置；按 Profile 的 Skill、子代理白名单；插件 Profile 的启用与停用。
- MCP 工具都来自 `nbook.mcp` 一个插件，按提供者分组时不同服务器挤在一组：留给 w00036（可以用 `group`）。
- 风险：别的插件的工具说明取第一行，可能是英文或很长。

## 确认结果（开发者 2026-11-07，都按推荐）

1. 版式与注意力顺序：列表加“名称、说明 → 问题 → 模型 → 审批模式 → 工具”，工具默认全部展开。
2. 用户级 Profile 的新建、打开、删除纳入本 Task；新建用骨架文件，不做复制内置（改第一轮决定）。
3. `modelNeeds` 做两处提示、不拦发送。
4. 白名单字段随 t14、t15 加，这里只定形状。
