# t15 计划：阶段 ② “消息”视图（草稿 2）

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

依据：[`bots/view.md`](../../../../../docs/specs/bots/view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 1–3、44、52、53、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 7、17、19、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的用法档。设计审查第一轮：[evidences/design-review-2-sonnet.txt](evidences/design-review-2-sonnet.txt)，处理见 [evidences/design-review-2-disposition.md](evidences/design-review-2-disposition.md)。

## 技术选型

无新依赖。

- 宽窄：消息视图的宿主组件（neuro-book 里）用 `@notnotype/nb-layout/vue` 的 `useLayoutExtent` 量视图根，按宽高定版式，交给 nb-agent-ui 的组件一个 `layout: "wide" | "narrow"`。组件只有一份 DOM，版式由根上的类切换，不用 `v-if` 换掉聊天区。
- 抽屉：视图里自己画（绝对定位、非模态），不用 nb-ui 的 `Drawer`。`Drawer` 传送到 body、是整页模态，会盖住整个工作台。

## 关键设计

### 宿主：档位按会话的归属（`agent/web/session-host.ts`）

- 归属表：宿主记 `owners: Map<sessionId, SessionOwner | null>`。
  - 打开前先查表，没有再读会话头。`openHere` 自己也走这一步，所以经 `borrow()` 重开、`restore`、`createSession` 打开的都带归属。
  - 新建的会话没有归属，直接记 null。
- 读会话头失败时不放宽：这一次打开记成打开失败（同现有的 `current.failed`，原因写“读不到会话头”），可以重试。
- 归属读到之前不建 `current`。等待期间界面保持原来的会话与 `routing` 的作废规则，不出现“档位未知”的中间态。
- `Current` 带 `owner`。下面这些都按 `current.owner !== null` 算，不再读 `deps.fixed`：
  - `interaction` 的 `canMutateHistory`、`canOpenTree`、`canArchive`、`canRestore`、`commands`；
  - 命令守卫；
  - 发话一律走 `send` 并带 `settlePending`；
  - `settleCount`、提示文字；
  - `afterChange` 清停靠区状态的条件。
- 档位的视图选项改由 `ctx` 给，视图从 `ctx` 读，宿主组件不再写死：
  - `interaction` 加 `placement: "wizard" | "dock"`（有归属为 `dock`）与 `canCreate`（有归属为 false，头上不画新建）；
  - `session` 加 `identity?: {name, avatar?}`（有归属时，取自提供者）；
  - `AgentConversationView` 的 `pendingPlacement` 属性删掉，改读 `ctx.interaction.placement`；
  - 停靠区“答完放焦点”的监听按会话 id 重置，不在两个会话的事项之间比较。
- 删掉固定会话：
  - 删 `deps.fixed`、`FIXED_COMMANDS` 之外的 `fixed` 分支、`agentConversationKey`、`FixedConversation`、`FixedConversationHost.vue`。
  - 阶段 ③ 的滑出聊天要用时，按那时的需求再加（t03 决定 23 只要求“头部与内容同消息视图的聊天”）。
  - 阶段 ① 的固定会话测试改写成“同一个宿主打开有归属的会话”的用例，断言不放宽。
- 最近的会话：有归属的也写，`restore` 照常恢复（归属会话就在消息视图里，不抢别的视图）。
  - 阶段 ① 的“恢复时遇到有归属的会话清掉记录”删掉。
  - “恢复让给用户的打开与新建”保留。
- 转交删掉：`open` 不再交给归属插件，归属只决定档位。

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
  - 同一个插件有几条贡献时取贡献 id 最小的那条。
- bot 标签的排序：按贡献，再按贡献方给的顺序（bots 按 `last.at` 新的在前，没有的按记录顺序）。
- 第二行（决定 6）：在跑、等你处理按 `nbook.agent` 的活动算，匹配用 `root === sessionId`。主对话空闲、子代理在跑或在等也算这个 bot 在跑或在等。
- 没有模型时不调 `open`：聊天区画对话视图现有的“没有模型”引导，靠 `nbook.agent` 自己的模型设置判断。
- `open` 失败：聊天区写原因与“重试”。
- `open` 的作废：消息视图记一个号，点了别的联系人或会话之后，较早的 `open` 结果不再打开。

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
    - 打开：按面板头的标题或头像列顶上的按钮，从左边拉出抽屉；
    - 尺寸与模态：宽 `min(300px, 85%)`，压在聊天区上，非模态；
    - 关闭：点抽屉外、`Esc`、选了一项都关；`Esc` 关后焦点回到打开它的那个按钮；
    - 状态：`drawerOpen` 只在内存。宽窄切换时，开着的抽屉收起，焦点回到聊天区的输入框。
- 视图接管面板头改成可以随时交还：
  - `ViewHead` 加 `claim: Ref<boolean>`（缺省 true）；
  - 宽版置 false，外壳在 `panelViewHead` 里看到 false 就按普通画法画标题与计数；
  - 改 `views.md` 输出 19。
- 列表（`AgentMessagesList`，宽版的列表栏与窄版的抽屉用同一个组件、同一份状态）：
  - 顶上两个标签“bot”“会话”，bot 标签后写未读合计。
  - bot 标签：
    - 顶上一个搜索框，按名字筛；
    - 一行一个联系人：头像、名字、时间（`last.at`）、第二行、右边未读数；
    - 提供者 `state` 是加载中、失败（原因与重试，重试调 `reload`），或一个联系人都没有时，写对应的空态。
  - 会话标签：现有的 `AgentSessionPanel`（搜索、范围、过滤、新建、行菜单、子会话展开），改两处：
    - 去掉按日分组（现在没有“还有 N 个”的截断，已核对 `AgentSessionPanel.vue`）；
    - 列表不含有归属的会话及其全部后代（`session-list.ts` 的 `items` 按 `owner` 过滤），编辑区页面的会话下拉同样过滤。
- 标签与聊天区：标签只决定列表看哪一页。
  - 宿主打开一个会话时，标签跟着它的归属切换（有归属切到 bot，否则会话）；
  - 用户点标签不换聊天区；
  - 记住的只是当前会话（“最近的会话”），不另存标签。
- 没有打开会话时（首次、选中的会话被归档）：标签是会话时画现有的第一屏；标签是 bot 时画“选一个 bot 开始聊天”与联系人列表的入口，不画会出现隐式新建的输入框。
- 会话列表的刷新从 `SessionPanelHost` 搬到 `MessagesHost`：视图挂着时每 15 秒，加上活动变化时。窄版头像列与抽屉共用。
- 计数：
  - 视图的 `badge()` 是所有提供者联系人的未读合计；
  - 宽版的面板头标题后、入口角标都写它；
  - 窄版接管面板头时标题里不写（输出 17），bot 标签与头像列上有。
- 看到：聊天区开着有归属的会话、视图可见、窗口有焦点时，把 `host.shownSeq` 交给那个提供者的 `seen`。

### 各入口的新行为（`agent/web/plugin.ts`）

| 入口 | 新行为 |
|---|---|
| 会话标签点一行、头像列点会话 | 在消息视图的聊天区打开 |
| bot 标签点联系人、头像列点 bot | 提供者 `open` 之后在聊天区打开；没有模型时不调 |
| `nbook.agent.focus-session`（状态栏活动条、请求页、子代理卡片的“打开会话”） | 有归属的会话：揭示消息视图并打开（不去编辑区页面）；没有归属：照旧按上次用的位置 |
| `nbook.agent.new-session` | 照旧在上次用的位置新建；在消息视图里时标签跟到会话 |
| 编辑区页面的对话 | 照旧（会话下拉不列有归属的会话） |
| 在 bot 聊天里打开子会话（子代理入口、卡片） | 就地在聊天区打开子会话（通用档）。头上的祖先路径里根写归属的身份名（不写会话标题），点它回到 bot 的主对话 |

### 列表的最后一句话（`bots/backend/unread.ts`、`bots/shared/contracts.ts`）

- 跟踪器给每个 bot 记 `latest: {seq, text, at} | null`：在线收到的计数消息、补数读到的那一段的最后一条都更新它。
- `markSeen` 落盘时，`latest.seq <= seenSeq` 就把 `latest` 一并写进 `bots-seen` 的记录。记录加可选字段 `last`，读旧记录照常。
- 启动补数只读“看到”之后那段（不变）：
  - 段里有计数消息，`last` 取段里最后一条；
  - 段是空的（都看过了），取记录里存的；
  - 旧记录里没有，为 null，下一条消息来了才有。
  - 不为它从头扫日志。
- 摘要规则写进 `bots.md`：
  - 只取 `text` 块拼起来，空白折叠成一个空格；
  - 按码点取前 80 个，超了加“…”；
  - 没有 `text` 块时：有图片写“[图片]”，否则写“[消息]”。
- `BotItem` 加 `last: {text, at} | null`。改到的现有断言（`service.test.ts` 的 `toEqual`、测试里的替身）在同一片改。

### 入口角标（`workbench/web/`，`workbench/views.md` 输出 17）

- 活动栏入口与右栏入口条的入口：图标右上角画容器里各视图 `badge()` 的合计，超过 99 写“99+”，可访问名称写成“消息，3 条未读”的形式（文案用工作台的消息目录）。
- 底部面板入口条照旧：文字入口写在标题后，规则同上。
  - 现在“只含一个视图才写”是因为并成一行的节头不写标题，没地方写；
  - 改成合计之后两处口径统一，输出 17 写这个理由。
- 文件：
  - `WorkbenchShell.vue` 的 `toolEntries` 与 `stripEntries`；
  - `WorkbenchToolStrip.vue`、`WorkbenchRegionStrip.vue` 与两者的同名 `.md`；
  - `WorkbenchShell.md`；
  - `ui/workbench-layout.md` 输出 47。
- 决定 4 原话是“活动栏”；消息视图在右栏，范围延到右栏入口条，记为决定 6 的补充。

### 布局里的旧视图（`workbench/shared/views.ts`、`state/default-tree.ts`）

视图声明加可选的 `replaces: string[]`：

- 只认同插件前缀的 id（声明校验拒绝别的前缀），而且只在被替换的 id 此刻在目录里没有声明时生效。第三方删不掉别人仍有效的视图。
- `reconcileViews` 先删再补：
  - 被替换的视图的标签从所在面板拿掉，面板空了按现有的关面板规则收；
  - 容器入口里的 `view:<旧 id>` 一并清掉；
  - 原来的“没有缺失就早退”挪到删除之后。
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
  - 输出 1–3 改成消息视图：两个标签、宽窄版式、会话标签不含有归属的会话、不按日分组；
  - 输出 44：只在窄版接管；
  - 输出 52：删掉固定会话组件；
  - 输出 53：改成提供者，档位按归属，入口表；
  - 贡献表删两个视图。
- `bots/view.md` 改写成“bot 标签与提供者”：联系人、第二行、空态、没有模型、`open` 失败、看到、验收。
- `bots/bots.md` 输出 7：`last` 与摘要规则；`bots/main-conversation.md` 输出 7：`last` 存进看到的记录。
- `ui/agent-conversation-view.md` 的用法档：档位由 `ctx.interaction.placement`、`canCreate` 与 `session.identity` 给，按会话变。

## 切片

1. 工作台：入口角标、`ViewHead.claim`、`replaces`。workbench 的 dom 测试；e2e `workbench-shell`、`workbench-containers` 里入口与旧视图的用例。
2. bots 后端：`last`（跟踪器、记录、摘要规则）。bots.test.ts 的未读用例加 `last` 的几种形状：只有图片、全已读后重启、旧记录。
3. nb-agent-ui：
   - `ctx` 给档位（`placement`、`canCreate`、`identity`），视图从 `ctx` 读；
   - `AgentMessagesList`（标签、bot 行、搜索、空态）、头像列、抽屉、宽窄版式；
   - `AgentSessionPanel` 去掉分组；
   - 同名 `.md` 与 Lab 场景（含英文与 390 宽），dom 测试。
4. agent 与 bots 的浏览器入口，一个提交（中间不留类型检查断开的状态）：
   - 宿主的归属表与档位，删固定会话；
   - 提供者贡献点；`MessagesHost.vue` 与入口表；会话列表过滤；
   - bots 改成提供者，删 `BotChatView`；
   - 测试：session-host.test.ts 与 MessagesHost 的 dom 测试；
   - e2e：先改辅助函数（会话面板、对话视图、`data-bot-chat*` 的定位），再迁移 `bots-chat`、`agent-conversation`、`workbench-shell`、`workbench-containers`、`editor-area`、`files-explorer`。
5. 收口：
   - 合并 master；
   - 合入前跑一次 e2e：上面 6 个加 `agent-subagents`，它覆盖“在 bot 聊天里打开子会话”的新行为；
   - 截图：右栏窄版、抽屉开、拖宽后两栏、390 宽，明暗两态；
   - 实现审查：前端 Sonnet；第 2 片与提供者合同交 omp。

## 验收映射

| 判据 | 测试 |
|---|---|
| 同一个宿主在 bot 主对话与普通会话之间切换：档位、命令白名单、发话带不带 `settlePending`、停靠区状态不串 | session-host.test.ts |
| 借用归零后重开、`restore` 恢复的有归属会话仍是 bot 档；读会话头失败记打开失败、可重试 | session-host.test.ts |
| 提供者晚到与撤回：bot 标签、`badge()` 跟着变；联系人不能冒用别的插件 | MessagesHost dom 测试 |
| 没有模型不调 `open`；`open` 失败的原因与重试；点了别的之后早先的 `open` 作废；联系人读不到与空列表的空态（替代 `BotChatView.dom.test.ts` 的 5 条） | MessagesHost dom 测试 |
| 宽窄切换不重挂聊天区（挂载计数）；抽屉 `Esc` 与焦点归还；宽窄切换时抽屉收起 | nb-agent-ui dom 测试 |
| 会话标签不含 bot 主对话及其子代理 | session-list 测试，e2e `agent-conversation` |
| `last` 的形状与全已读后重启 | bots.test.ts |
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
  - 会话标签滚到底分页（决定 5）：消息视图常驻、每 15 秒全量取一次，会话多了会慢，记进后续；
  - 多开（t03 决定 7）；
  - 书房入口（③）；
  - 按天与未读分隔线（④）；
  - 第二行的具体活动文字（决定 6）。
- 风险：宿主档位从构造时定改成按会话定，读 `deps.fixed` 的 11 处与视图的静态选项都要换。验收映射前两行兜底，阶段 ① 被改写的测试逐条对出新断言。
- 风险：e2e 迁移面大。先列出每个辅助函数依赖的旧选择器、改完辅助函数，再开大范围。
