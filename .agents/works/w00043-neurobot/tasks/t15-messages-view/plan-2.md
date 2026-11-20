# t15 计划：阶段 ② “消息”视图（草稿 3）

## Context

阶段 ① 做出了能聊的 bot 视图（左侧栏、单独的视图）。阶段 ② 按 t03 的定稿把它和会话面板、对话视图合成一个“消息”视图（t03 决定 6、8、12–14；t15 决定 1）：顶上 bot、会话两个标签，宽时左边列表、右边聊天，窄时左边一列头像、列表收进抽屉。取代会话面板 `nbook.agent.sessions`、对话视图 `nbook.agent.conversation` 与 bot 视图 `nbook.bots.chat`。

开发者已确认的：

- t03 决定 6、8、12–14：
  - bot 与会话放进同一个视图，两个标签、不混排；
  - bot 一侧是 IM 列表，未读在右边，子会话不挂在列表里；
  - 会话一侧照会话面板，不按日分组、按最近活动排；
  - bot 标签上带未读；
  - 窄时左边一列头像，列表在抽屉里。
- t15 决定 4：入口显示未读数。
- t15 决定 5：
  - 一个聊天区，档位按打开的会话有没有归属定；
  - 消息视图在右栏，左侧栏不再有会话面板与 bot 入口；
  - 宽窄分界 600 像素；
  - 会话标签的滚到底分页这次不做。
- t15 决定 6（2026-11-20，设计审查后问的两题，都按推荐）：
  - bot 行的第二行先写通用状态：在跑时蓝字“正在回复…”，等你时黄字“等你处理”，平时是最后一句话；具体在做什么等后端有活动摘要再补；
  - 宽版时对话的头画在聊天区上方（同 t03 r5），只有窄版接管面板头。
- t15 决定 7（2026-11-20，第二轮设计审查后问的一题，按推荐）：右栏收起时入口角标看不到，状态栏的 Agent 活动条目在有未读时也写“N 条新消息”，点了打开消息视图里那个 bot。

依据：[`bots/view.md`](../../../../../docs/specs/bots/view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 1–3、44、52、53、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 7、17、19、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的用法档。设计审查两轮：[第一轮](evidences/design-review-2-sonnet.txt)、[第二轮](evidences/design-review-3-sonnet.txt)，处理见 [evidences/design-review-2-disposition.md](evidences/design-review-2-disposition.md)。

## 技术选型

无新依赖。

- 宽窄：消息视图的宿主组件（neuro-book 里）用 `@notnotype/nb-layout/vue` 的 `useLayoutExtent` 量视图根，按宽高定版式，交给 nb-agent-ui 的组件一个 `layout: "wide" | "narrow"`。组件只有一份 DOM，版式由根上的类切换，不用 `v-if` 换掉聊天区。
- 抽屉：视图里自己画（绝对定位、非模态），不用 nb-ui 的 `Drawer`。`Drawer` 传送到 body、是整页模态，会盖住整个工作台。

## 关键设计

### 宿主：档位按会话的归属（`agent/web/session-host.ts`）

- 归属表在插件级（`plugin.ts` 一份 `owners: Map<sessionId, SessionOwner | null>`，宿主经 deps 取，右栏与编辑区页面两个宿主、`focus-session` 共用）：查表，没有再读会话头。新建的会话没有归属，直接记 null。
- `openHere` 照旧立刻建 `current`，`Current.owner` 三态：`SessionOwner`、`null`、`undefined`（还没读到）。
  - 读的期间 `loading` 为真，`availability` 是“加载中”，消息与输入框都不画；档位相关的字段取最严的一档。
  - 经 `borrow()` 重开、`restore`、`createSession` 打开的都走这一步。
- 读会话头失败时不放宽：`current.failed` 记 `header-unreadable`，走现有的重试。`restore` 遇到这个码保留“最近的会话”的记录，不清。
- 宿主加只读的 `owner: ShallowRef<SessionOwner | null | undefined>`（当前会话的归属）与 `close()`（回到未选择）。
- 有归属的会话按 bot 档，下面这些都按 `current.owner` 算，不再读 `deps.fixed`：
  - `interaction` 的 `canMutateHistory`、`canOpenTree`、`canArchive`、`canRestore`、`commands`；
  - 命令守卫；
  - 发话一律走 `send` 并带 `settlePending`；
  - `settleCount`、提示文字；
  - `afterChange` 清停靠区状态的条件。
- 档位的视图选项改由 `ctx` 给，视图从 `ctx` 读，宿主组件不再写死：
  - `interaction` 加 `placement: "wizard" | "dock"`（有归属为 `dock`）与 `canCreate`（有归属为 false）。`canCreate` 为 false 时视图不画头上的新建，也不画第一屏（`welcome` 与 `draft-profile`）：没说过话的 bot 主对话画空的聊天，不画“最近对话”卡片；
  - 有归属时宿主直接把 `session.title`、`session.avatar` 写成提供者给的身份，不另加 `identity` 字段。提供者不在或找不到这个联系人时，回落到会话标题与 Profile 图标；
  - `AgentConversationView` 的 `pendingPlacement` 属性删掉，改读 `ctx.interaction.placement`；
  - 停靠区“答完放焦点”的监听按会话 id 重置，不在两个会话的事项之间比较；
  - 第 3 片对照两个宿主组件（`ConversationHost.vue`、`FixedConversationHost.vue`）里传给 `AgentConversationView` 的属性逐个列出：哪些并进 `ctx`，哪些消息视图照常传（`#sessions` 插槽与 `sessions-open` 删掉，列表改由消息视图画；`head-targets` 只在窄版给）。
- 删掉固定会话：
  - 删 `deps.fixed`、`FIXED_COMMANDS` 之外的 `fixed` 分支、`agentConversationKey`、`FixedConversation`、`FixedConversationHost.vue`。
  - 阶段 ③ 的滑出聊天要用时，按那时的需求再加（t03 决定 23 只要求“头部与内容同消息视图的聊天”）：那时复用宿主加对话视图的组合（`createSessionHost` 与 `AgentConversationView`），不再造一个固定宿主。
  - 阶段 ① 的固定会话测试改写成“同一个宿主打开有归属的会话”的用例，断言不放宽。
- 最近的会话：有归属的也写，`restore` 照常恢复（归属会话就在消息视图里，不抢别的视图）。
  - 阶段 ① 的“恢复时遇到有归属的会话清掉记录”删掉。
  - “恢复让给用户的打开与新建”保留。
- 转交删掉：`open` 不再交给归属插件，归属只决定档位。提供者不在（bots 被禁用、还没激活）时，有归属的会话照样按 bot 档打开（服务端本来就不让改写它的历史），身份回落见上。
- 编辑区页面的宿主遇到有归属的会话（页面里点祖先路径的根等）不在页面里开，改走 `nbook.agent.focus-session`，打开到消息视图：页面没有联系人列表，也不记“看到”。

### 归属插件的提供者（`agent.sessionOwners` 改形状，`agent/shared/contracts.ts`）

```ts
interface OwnerContact {
    /** 归属里的 id（bot id）；`plugin` 不由贡献方写，由 `nbook.agent` 按贡献句柄盖上。 */
    readonly id: string;
    readonly name: string;
    readonly avatar?: string;
    /** 未读数；还没数完为 null。 */
    readonly unread: number | null;
    /** 最后一条计数消息的摘要与时间；没有为 null。 */
    readonly last: {readonly text: string; readonly at: number} | null;
    /** 主对话的会话 id；还没建为 null。 */
    readonly sessionId: string | null;
}
interface SessionOwnerProvider {
    readonly contacts: Readonly<Ref<readonly OwnerContact[]>>;
    /** 联系人列表读到没有。 */
    readonly state: Readonly<Ref<{kind: "loading"} | {kind: "ready"} | {kind: "failed"; code: string}>>;
    reload(): void;
    /** 取这个联系人的主对话（建或持有），交回会话 id。 */
    open(id: string): Promise<{ok: true; sessionId: string} | {ok: false; code: string}>;
    /** 看到了 `seq`（`host.shownSeq` 的语义：已画出的最后一条日志，服务端截到最新的计数消息）。 */
    seen(id: string, seq: number): void;
}
```

- 接收器用 `shallowRef` 持有，`[{plugin, contributionId, provider}]`，按贡献 id 排；发布与撤回都触发更新。
  - 晚激活的贡献方、撤回的贡献方，bot 标签与 `badge()` 都会跟着变。
- 盖章：会话头的 `owner` 是 `{plugin, id}`。宿主按 `plugin` 找贡献，再在它的 `contacts` 里按 `id` 找身份。
  - 联系人不自带 `plugin`，第三方插件冒不了别人的 bot。
  - 每个插件至多一条贡献：接收器收到同一插件的第二条时不接、记诊断（贡献点的校验看不到别的贡献，在接收器里判）。
- bot 标签的排序：按贡献方插件 id，再按贡献方给的顺序（bots 按 `last.at` 新的在前，没有的按记录顺序）。几个贡献方的 `state` 分开画：哪个失败，就在它那一段写原因与重试。
- 提供者的订阅在插件入口激活时就开始（沿用 `createBotsStore`），视图没打开时计数照样更新。
- 第二行（决定 6）：在跑、等你处理按 `nbook.agent` 的活动算，匹配用 `root === sessionId`。主对话空闲、子代理在跑或在等也算这个 bot 在跑或在等。
- 点联系人到聊天出现之间由消息视图持有一个选择：`{kind: "contact", id, step: "no-model" | "opening" | "failed" | "ready"} | {kind: "session"} | null`。
  - `no-model`：不调 `open`，在聊天区的位置盖“没有模型”引导（对话视图现有的那张，去模型设置）；
  - `opening`：盖“正在打开”；
  - `failed`：盖原因与“重试”；
  - `ready`：露出宿主的聊天。
  - 盖的那层与宿主的聊天是兄弟元素，不卸载宿主的视图。
  - 选择记一个号：点了别的联系人或会话之后，较早的 `open` 结果不再打开。
  - 有没有模型用 `nbook.agent` 自己的模型设置判断（宿主的 `providers()`），还没读到时按“打开中”等。

### “消息”视图（`agent/web/MessagesHost.vue` 新；nb-agent-ui 新组件）

- 视图 id 沿用 `nbook.agent.conversation`，标题改“消息”，图标 `i-lucide-messages-square`，位置照旧在右栏。
  - 已有布局记录里它就在右栏，不用迁移。
  - `nbook.agent.sessions` 与 `nbook.bots.chat` 两个视图删掉，处理见“布局里的旧视图”。
- 版式（`useLayoutExtent` 量视图根）：
  - 宽：宽不小于 600、高不小于 360 像素。
  - 窄：其余情况。
  - 量到 null 或 0 时保持上一次的版式。
  - 底部面板里宽而矮的，按高度落到窄版。
- 宽版：
  - 左边 260 像素的列表栏、右边聊天区；
  - 对话的头画在聊天区上方，不接管面板头，面板头照常写“消息”与计数（外壳的输出 17）；
  - 列表栏可收起：列表栏顶上有收起按钮，收起后聊天头最左侧出现展开按钮；
  - 状态 `listCollapsed` 存插件存储。
- 窄版：
  - 左边 52 像素的头像列、右边聊天区，对话的头接管面板头（输出 44）。
  - 头像列从上到下：开列表的按钮、各个 bot 的头像（有未读写点，有等你处理时点是黄色）、分隔、最近 5 个会话的 Profile 图标。
    - 最近 5 个会话：会话标签同一份数据，只取根会话、不含归档与有归属的；
    - 每个按钮有名称（bot 名与未读数、会话标题），悬停写标题。
  - 抽屉：
    - 打开：按面板头的标题或头像列顶上的按钮，从头像列右边拉出（头像列仍看得见、可点），宽 `min(300px, 85%)`，压在聊天区上，非模态；打开时焦点到抽屉的搜索框。
    - 关闭：选了一项、`Esc`、点抽屉外都关，关后焦点回到打开它的那个按钮。
      - 点外面的判定不算面板头的标题按钮（它自己切换）、不算传送出去的浮层（行菜单、改名小窗、选 Profile 的弹窗）；
      - `Esc` 只在焦点在抽屉里或在触发按钮上时处理，已被里面的控件处理（`defaultPrevented`）的不管。
    - 内容常驻（收起只是不显示），开着改名小窗时抽屉不关，收起也不丢小窗的状态。
    - 读屏：抽屉 `role="dialog"`、带名称；触发按钮的 `aria-expanded`（窄版就是 `titlePopup`）跟着开合。
    - 状态：`drawerOpen` 只在内存。宽窄切换时开着的抽屉收起；只有焦点原来在抽屉里时才把焦点放到列表栏的同一处（窄变宽）或触发按钮，否则不动焦点。
- 视图接管面板头改成可以随时交还：
  - `ViewHead` 加 `claim: Ref<boolean>`（缺省 true）；
  - 宽版置 false。外壳在 `headOfPanel` 里看到 false 就返回 null，`activateTab`、槽位分发、`panelViewHead` 三处一起按普通画法：标题与计数照常、点标题照常折叠；
  - 视图在 `setup` 里同步写初值（取这个视图上一次的版式，存在插件作用域的内存里，首次按窄版），免得首帧接管、量完再翻；
  - 改 `views.md` 输出 19。
- 列表（`AgentMessagesList`，宽版的列表栏与窄版的抽屉用同一个组件、同一份状态）：
  - 顶上两个标签“bot”“会话”，bot 标签后写未读合计。
  - bot 标签：
    - 顶上一个搜索框，按名字筛；
    - 一行一个联系人：头像、名字、时间（`last.at`）、第二行、右边未读数；
    - 提供者 `state` 是加载中、失败（原因与重试，重试调 `reload`），或一个联系人都没有时，写对应的空态。
  - 会话标签：现有的 `AgentSessionPanel`（搜索、范围、过滤、新建、行菜单、子会话展开），改两处：
    - 去掉按日分组（现在没有“还有 N 个”的截断，已核对 `AgentSessionPanel.vue`）；
    - 列表不含有归属的会话及其全部后代：服务端的 `list` 本来就不列（`backend/agent.ts` 的 `ownedTrees`，sessions.md 输出 25），客户端不再过滤，e2e 断言看不到它们。
- 标签与聊天区：标签只决定列表看哪一页。
  - 宿主打开一个会话时，标签跟着它的归属切换（有归属切到 bot，否则会话）；
  - 用户点标签不换聊天区；
  - 记住的只是当前会话（“最近的会话”），不另存标签。
- 没有打开会话时（首次、选中的会话被归档）：标签是会话时画现有的第一屏；标签是 bot 时画“选一个 bot 开始聊天”与联系人列表的入口，不画会出现隐式新建的输入框。
- 会话列表的刷新收进 `session-list` 的 store：`start()`/`stop()` 按引用计数，几个位置（消息视图、编辑区页面的下拉）共用一个 15 秒的定时器；`host.create` 成功后重取一次。不按活动变化重取：运行状态本来就由 `items` 的计算属性按活动映射。窄版头像列与列表共用这份数据。
- 计数：
  - 视图的 `badge()` 是所有提供者联系人的未读合计；
  - 宽版的面板头标题后、入口角标都写它；
  - 窄版接管面板头时标题里不写（输出 17），bot 标签与头像列上有。
- 看到：聊天区开着有归属的会话、视图可见、窗口有焦点时，把 `host.shownSeq` 交给那个提供者的 `seen`。
- 状态栏（决定 7）：Agent 活动条目在有未读时也写“N 条新消息”（与“在跑”“等你处理”并列，等你处理优先显示），点了揭示消息视图并打开有未读的那个 bot。

### 各入口的新行为（`agent/web/plugin.ts`）

| 入口 | 新行为 |
|---|---|
| 会话标签点一行、头像列点会话 | 在消息视图的聊天区打开 |
| bot 标签点联系人、头像列点 bot | 提供者 `open` 之后在聊天区打开；没有模型时不调 |
| `nbook.agent.focus-session`（状态栏活动条、请求页、子代理卡片的“打开会话”） | 先看会话树的根：根有归属（bot 的主对话本身或它的子会话），揭示消息视图并打开这个会话（不去编辑区页面）；否则照旧按上次用的位置。根从 `ancestors` 取，`AncestorItem` 加可选 `owner`（服务端读祖先的索引时一并给） |
| `nbook.agent.new-session` | 照旧在上次用的位置新建；在消息视图里时标签跟到会话 |
| 编辑区页面的对话 | 照旧；要打开根有归属的会话时改走 `focus-session`（见“宿主”一节） |
| 在 bot 聊天里打开子会话（子代理入口、卡片） | 就地在聊天区打开子会话（通用档）。头上的祖先路径里根写归属的身份名（来自 `AncestorItem.owner` 与提供者，取不到回落到会话标题），点它回到 bot 的主对话 |
| 状态栏活动条目的“N 条新消息” | 揭示消息视图，打开第一个有未读的 bot（决定 7） |

### 列表的最后一句话（`bots/backend/unread.ts`、`bots/shared/contracts.ts`）

- 不存记录，读日志尾部：
  - 跟踪器补数时先 `log({afterSeq: 0, limit: 1})` 取 `head`，再从 `max(0, head - 200)` 往后读，找最后一条计数消息；
  - 至多读 201 条，找不到为 null；
  - 在线收到计数消息时直接更新。
- 不碰 `bots-seen` 记录，没有合并与旧记录的问题。
- 摘要规则写进 `bots.md`：
  - 文字取自内核的 `replyText`（`nb-harness` 的 `api/reply.ts`，已拼好 `text` 块）；
  - 表情包的写法（`:包/名字:`）换成“[表情]”；
  - 空白折叠成一个空格，按码点取前 80 个，超了加“…”；
  - 没有文字时：有图片块（`image`、`imageRef`）写“[图片]”，否则写“[消息]”；
  - Markdown 标记不去掉（加粗、链接的写法原样），记为已知限制。
- `BotItem` 加 `last: {text, at} | null`。改到的现有断言（`service.test.ts` 的 `toEqual`、测试里的替身）在同一片改。

### 入口角标（`workbench/web/`，`workbench/views.md` 输出 17）

- 活动栏入口与右栏入口条的入口：图标右上角画容器里各视图 `badge()` 的合计，超过 99 写“99+”。
- 可访问名称三处统一写“标题 + 数”（“消息 3”），同现在底部面板入口与面板头的写法；不写“条未读”，`badge()` 是通用计数。
- 底部面板入口条照旧：文字入口写在标题后，只含一个视图的容器才写。合计口径只用于图标入口：图标入口没有分节头，数只能画在入口上；底部面板多视图容器的各节头已经各写各的数，入口再写合计会重复。输出 17 写这个理由。
- 文件：
  - `WorkbenchShell.vue` 的 `toolEntries` 与 `stripEntries`；
  - `WorkbenchToolStrip.vue`、`WorkbenchRegionStrip.vue` 与两者的同名 `.md`；
  - `WorkbenchShell.md`；
  - `ui/workbench-layout.md` 输出 47。
- 决定 4 原话是“活动栏”；消息视图在右栏，范围延到右栏入口条，记在决定 6；右栏收起时由状态栏补上（决定 7）。

### 布局里的旧视图（`workbench/shared/views.ts`、`state/default-tree.ts`）

视图声明加可选的 `replaces: string[]`：

- 只认声明方自己插件 id（`descriptor.plugin` 加 `.`）开头的 id，声明校验拒绝别的。不用内置插件“`nbook.` 开头即可”的宽规则，否则 `nbook.agent` 能点名 `nbook.files.*`。
- 只在被替换的 id 此刻在目录里没有声明时生效：同插件仍有效的视图不会被误删。
- `replaces` 不经插件 SDK 公开（同输出 19 的标题区），只给内置插件用。
- `reconcileViews` 先删再补：
  - 被替换的视图的标签用现成的 `removeTab`（`layout-doc.ts`）拿掉，面板空了按现有的关面板规则收；
  - 几种位置都要清：容器里的分节（会话面板默认在“项目”容器里，与资源管理器同一个容器，摘掉后高度份额归还资源管理器）、被拖进别的面板的标签、浮动窗里唯一的标签、拖成的 `custom:` 容器、最大化着的；
  - 隐式容器 `view:<旧 id>` 留在入口顺序里的 id 一并清掉，这是 `settleContainers`“声明的与隐式容器的 id 留着”的例外；
  - 原来的“没有缺失就早退”挪到删除之后。
- 删除在每次重算里做、不写回，下次保存才落盘；降级回旧版本时会话面板会再出现，可以接受。
- 不做“补到旧标签的位置”：新视图沿用的 id 在旧布局里本来就在。
- 消息视图写 `replaces: ["nbook.agent.sessions"]`（发布过）。`nbook.bots.chat` 没有随任何发布版本带出（`git tag --contains 0fcdedc83` 为空），开发者本机的旧标签按输出 7 的占位手动关。
- 改 `views.md` 输出 4、7（被 `replaces` 点名的例外）与声明的输入表。

## Spec 与文档改动

- `workbench/views.md`：
  - 输出 17：入口角标、合计口径、99+、可访问名称；
  - 输出 19：`claim`；
  - 输出 4、7 与声明表：`replaces`。
- `ui/workbench-layout.md` 输出 47。
- `agent/conversation.md`：
  - 输出 1–3 改成消息视图：两个标签、宽窄版式、不按日分组（会话标签不含有归属的会话，引 sessions.md 输出 25）；
  - 输出 44：只在窄版接管；
  - 输出 52：删掉固定会话组件；
  - 输出 53：改成提供者（每插件一条），档位按归属，入口表，状态栏的“N 条新消息”；
  - 贡献表删两个视图。
- `bots/view.md` 改写成“bot 标签与提供者”：联系人、第二行、空态、没有模型、`open` 失败、看到、验收。
- `bots/bots.md` 输出 7：`last` 与摘要规则。
- `agent/sessions.md` 的远程 `ancestors`：`AncestorItem` 加可选 `owner`。
- `ui/agent-conversation-view.md` 的用法档：档位由 `ctx.interaction.placement`、`canCreate` 与会话的 `title`、`avatar` 给，按会话变；`canCreate` 为 false 时不画新建与第一屏。

## 切片

1. 工作台：入口角标、`ViewHead.claim`、`replaces`。workbench 的 dom 测试；e2e `workbench-shell`、`workbench-containers` 里入口与旧视图的用例。
2. 后端：
   - bots 的 `last`（尾部有界读取、摘要规则）。bots.test.ts 的未读用例加 `last` 的几种形状：只有表情、只有图片、全已读后重启（尾部读得到）、超过 200 条之前的找不到为 null；
   - agent 的 `AncestorItem.owner`。
3. nb-agent-ui：
   - `ctx` 给档位（`placement`、`canCreate`），视图从 `ctx` 读；对照两个宿主组件传的属性逐个落实；
   - `AgentMessagesList`（标签、bot 行、搜索、空态）、头像列、抽屉、宽窄版式；
   - `AgentSessionPanel` 去掉分组；
   - 同名 `.md` 与 Lab 场景（含英文与 390 宽），dom 测试。
4. agent 与 bots 的浏览器入口，一个提交（中间不留类型检查断开的状态）：
   - 宿主的归属表与档位，删固定会话；
   - 插件级的归属表；提供者贡献点（每插件一条）；`MessagesHost.vue`（选择与盖层、宽窄、抽屉、`claim`）与入口表；会话列表的刷新收进 store；状态栏的“N 条新消息”；
   - bots 改成提供者，删 `BotChatView`；
   - 测试：session-host.test.ts 与 MessagesHost 的 dom 测试；
   - e2e：先改辅助函数（会话面板、对话视图、`data-bot-chat*` 的定位，先 grep 数清），再迁移 `bots-chat`、`agent-conversation`、`workbench-shell`、`workbench-containers`、`editor-area`、`files-explorer`。默认版式是窄版（右栏默认宽度不到 600），多数 e2e 面对头像列与抽屉；
   - Lab：删掉 bot 档的旧场景，登记新组件的场景。
5. 收口：
   - 合并 master；
   - 合入前跑一次 e2e：上面 6 个加 `agent-subagents`，它覆盖“在 bot 聊天里打开子会话”的新行为；
   - 截图：右栏窄版、抽屉开、拖宽后两栏、390 宽，明暗两态；
   - 实现审查：前端 Sonnet；第 2 片与提供者合同交 omp。
   - 变异检查：把宿主里判档位的 `owner` 条件反过来，验收映射前两行应当失败。

## 验收映射

| 判据 | 测试 |
|---|---|
| 同一个宿主在 bot 主对话与普通会话之间切换：档位、命令白名单、发话带不带 `settlePending`、停靠区状态不串 | session-host.test.ts |
| 借用归零后重开、`restore` 恢复的有归属会话仍是 bot 档；读会话头失败记打开失败、可重试 | session-host.test.ts |
| 提供者晚到与撤回：bot 标签、`badge()` 跟着变；联系人不能冒用别的插件 | MessagesHost dom 测试 |
| 没有模型不调 `open`；`open` 失败的原因与重试；点了别的之后早先的 `open` 作废；联系人读不到与空列表的空态（替代 `BotChatView.dom.test.ts` 的 5 条） | MessagesHost dom 测试 |
| 宽窄切换不重挂聊天区（挂载计数）；抽屉 `Esc` 与焦点归还；宽窄切换时抽屉收起 | nb-agent-ui dom 测试 |
| 会话标签不含 bot 主对话及其子代理 | e2e `agent-conversation`（服务端过滤已有 sessions.md 验收 6） |
| `last` 的形状与全已读后重启 | bots.test.ts |
| `ViewHead.claim`：宽版不接管、窄版接管、翻转时面板头内容正确、宽版点标题照常折叠 | workbench dom 测试 |
| 标签跟着打开的会话的归属切换；点标签不换聊天区；没有会话时按标签给空态 | MessagesHost dom 测试 |
| bot 行第二行三种状态，子代理在跑也算；还没建主对话的行 | MessagesHost dom 测试 |
| 窄版头像列：最近 5 个只含根会话、不含归档；未读点与等你处理的黄点 | nb-agent-ui dom 测试 |
| 抽屉：点标题关得掉、开着改名小窗点里面不关、`Esc` 被里面处理时不关 | nb-agent-ui dom 测试 |
| `listCollapsed` 存插件存储并恢复 | MessagesHost dom 测试 |
| `focus-session`：bot 主对话与它的子会话都打开到消息视图；没有归属的照旧 | session-host.test.ts 或 e2e `bots-chat` |
| 看到：视图不可见、窗口没焦点、聊天区不是有归属的会话，三种各自不发 | MessagesHost dom 测试 |
| 状态栏“N 条新消息”，点了打开那个 bot | e2e `bots-chat` |
| 入口角标合计、99+、可访问名称 | workbench dom 测试 |
| `replaces`：旧布局里的会话面板标签消失、不留占位；别的前缀被拒；被替换的 id 仍有声明时不删 | default-tree 测试，e2e `workbench-containers` |
| bots/view.md 验收 1：右栏消息视图点星璃，聊天、停靠区、发话拒绝 | e2e `bots-chat` |
| bots/view.md 验收 2：失焦时到的回复，bot 标签、入口角标、宽版面板头有计数，拿回焦点清零；状态栏活动条点主对话，打开在消息视图 | e2e `bots-chat` |
| agent/conversation.md 新验收：会话标签点一行在同一个视图打开；窄版按标题开抽屉、选了关；拖宽后两栏、头在聊天区上方 | e2e `agent-conversation` |

## 验证

- 每片跑 `bun run test:affected`，nb-agent-ui 的 dom 测试，`typecheck`（第 4 片一个提交，避免中间断开）。
- 合入前跑一次的 e2e 见切片 5（7 个文件），改动后只重跑改到的文件。

## 不做与风险

- 不做：
  - 会话标签滚到底分页（决定 5）：消息视图常驻、几个位置共用一个 15 秒的全量取，会话多了会慢，记进后续；
  - 多开（t03 决定 7）；
  - 书房入口（③）；
  - 按天与未读分隔线（④）；
  - 第二行的具体活动文字（决定 6）。
- 风险：宿主档位从构造时定改成按会话定，读 `deps.fixed` 的 11 处与视图的静态选项都要换；真正容易出错的是失败通道（读头失败）、第一屏与新建、提供者缺席这几条边界。验收映射前两行与变异检查兜底，阶段 ① 被改写的测试逐条对出新断言。
- 风险：e2e 迁移面大。先列出每个辅助函数依赖的旧选择器、改完辅助函数，再开大范围。
