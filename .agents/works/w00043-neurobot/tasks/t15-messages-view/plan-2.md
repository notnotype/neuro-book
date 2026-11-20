# t15 计划：阶段 ② “消息”视图（草稿 1）

## Context

阶段 ① 做出了能聊的 bot 视图（左侧栏、单独的视图）。阶段 ② 按 t03 的定稿把它和会话面板、对话视图合成一个“消息”视图（t03 决定 6、8、12–14；t15 决定 1）：顶上 bot、会话两个标签，宽时左边列表、右边聊天，窄时左边一列头像、列表收进抽屉。取代会话面板 `nbook.agent.sessions`、对话视图 `nbook.agent.conversation` 与 bot 视图 `nbook.bots.chat`。

开发者已确认的：

- t03 决定 6、12–14：bot 与会话放进同一个视图，两个标签、不混排；bot 一侧是 IM 列表（第二行平时是最后一句话，在跑时蓝字“正在……”，等你时黄字“等你批准：……”，未读在右边；子会话不挂在列表里）；会话一侧照会话面板，不按日分组、按最近活动排；bot 标签上带未读。
- t03 决定 8：侧栏窄时左边一列头像，列表在抽屉里。
- t15 决定 4（2026-11-20）：活动栏入口显示未读数。
- 2026-11-20 开发者问“为什么不让 bot 聊天和 session 聊天共用一个聊天组件”，主 Agent 答阶段 ② 合成一个聊天区、档位按打开的会话有没有归属定，开发者答“可以，继续”。

依据：[`bots/view.md`](../../../../../docs/specs/bots/view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 1–3、44、52、53、[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 7、17、19、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的用法档。

## 技术选型

无新依赖。宽窄切换用容器查询加 `useLayoutExtent`（`nb-ui/src/composables/useLayoutExtent.ts`）量宽度，先例是 `AgentModelCatalog.vue` 的左栏收起；抽屉用 nb-ui 的 `Drawer`。

## 关键设计

### 一个聊天区，档位跟着会话走（`agent/web/session-host.ts`）

- 通用宿主不再在打开前把有归属的会话转交出去。`open(id)` 先读会话头（已有），把 `owner` 记在当前会话上；`owner` 不为 null 时这一个会话按 bot 档：
  - 顶栏用归属插件给的身份（名字、头像）；
  - 等你处理的事放停靠区；
  - 不能改写历史，命令只有 `compact`、`plan`、`mode`；
  - 发话一律走 `send` 并带 `settlePending`；
  - 不写“最近的会话”。
- 现在的 `deps.fixed` 一分为二：
  - 上面这些限制改由“当前会话有归属”决定（`interaction` 按 `current.owner` 算）；
  - `pinned: sessionId` 只管“只开这一个、别的交给通用位置”，留给阶段 ③ 书房的滑出聊天。
- `agentConversationKey.FixedConversation` 保留，内部用同一个宿主加 `pinned`。阶段 ② 没有调用方了，阶段 ③ 用。
- `restore` 遇到有归属的会话不再清记录，照常恢复：它就在消息视图里，不抢别的视图。

### 归属插件的贡献（`agent.sessionOwners` 改形状，`agent/shared/contracts.ts`）

`SessionOwnerOpener` 换成 `SessionOwnerProvider`：

```ts
interface OwnerContact {
    readonly owner: {readonly plugin: string; readonly id: string};
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
    /** 取主对话（建或持有），交回会话 id。 */
    open(ownerId: string): Promise<{ok: true; sessionId: string} | {ok: false; code: string}>;
    /** 看到了 `seq`。 */
    seen(ownerId: string, seq: number): void;
}
```

- bot 标签列所有贡献方的 `contacts`。
- “在跑”与“等你批准”的第二行不由贡献方给：`nbook.agent` 的活动（`activity`）按 `sessionId` 已经知道哪个会话在跑、在等什么。
- 会话头里的身份按 `owner` 在 `contacts` 里找。

### “消息”视图（`agent/web/`，新 `MessagesHost.vue`；nb-agent-ui 新组件）

- 视图 id 沿用 `nbook.agent.conversation`，标题改“消息”、图标 `i-lucide-messages-square`，位置照旧在右栏，保留面板头接管（输出 44）。
- 沿用旧 id 的理由：已有的布局记录里它就在右栏，不用迁移。
- `nbook.agent.sessions` 与 `nbook.bots.chat` 两个视图删掉。布局记录里留着它们的标签时，按下面“布局里的旧视图”处理。
- 版式：
  - 宽（视图宽度不小于 600 像素）：左边 260 像素的列表栏，右边聊天区；按面板头的标题收起、展开列表栏。
  - 窄：左边 52 像素的头像列，右边聊天区。头像列从上到下是：开列表的按钮、各个 bot 的头像（带未读点）、分隔、最近 5 个会话的 Profile 图标（悬停写标题）。按面板头的标题、或头像列的按钮，从左边拉出列表抽屉，选了就收起。
- 列表（宽时的列表栏与窄时的抽屉是同一个组件 `AgentMessagesList`）：
  - 顶上两个标签“bot”“会话”，bot 标签后写未读合计；
  - bot 标签：一行一个联系人，头像、名字、时间、第二行、未读数；
  - 会话标签：现有的 `AgentSessionPanel`，去掉按日分组。
- 记住上次停在哪个标签，存插件存储。
- 计数：视图的 `badge()` 是 bot 未读合计，面板头标题后与活动栏入口都写它。
- 看到：聊天区开着有归属的会话、视图可见、窗口有焦点时，把画出的最后一条计数消息的 seq 交给贡献方的 `seen`。

### 列表的最后一句话（`bots/backend/unread.ts`、`bots/shared/contracts.ts`）

`BotItem` 加 `last: {text, at} | null`：最后一条计数消息正文的前 80 个字符（去掉换行）与时间。在线跟踪与补数时一起记；补数已经按页倒读，只多取一个字段。

### 没有模型、取不到主对话（`bots/web/` 的 `BotChatView` 删掉）

- 点 bot 时调 `open(ownerId)`：
  - 没有模型时不调，聊天区画现有的“没有模型”引导；
  - 失败时聊天区写原因与“重试”。
- `bots/web/store.ts` 留着做贡献方：订阅 `botsChanged`、`markSeen` 的补交逻辑不变。`listState` 读不到时，bot 标签里写原因与重试。

### 活动栏入口的计数（`workbench/web/`）

- views.md 输出 17 改成：活动栏入口与右栏入口条的入口，在图标右上角画容器里各视图 `badge()` 的合计，可访问名称带上；底部面板照旧。
- `ToolStripEntry` 加 `count`，`WorkbenchToolStrip.vue` 画角标；`stripEntries` 的右栏分支同样算。

### 布局里的旧视图（`workbench/shared/views.ts`、`state/default-tree.ts`）

视图声明加可选的 `replaces: string[]`（同插件或依赖方的旧视图 id）：

- `reconcileViews` 读到这些 id 的标签时把它们从树上拿掉，不留占位；
- 新视图已经在树上的，旧标签的位置不保留；
- 新视图不在树上的，补在旧标签所在的分节。

消息视图写 `replaces: ["nbook.agent.sessions", "nbook.bots.chat"]`。这是有调用方的小机制，不做通用的视图改名。

## Spec 与文档改动

- `workbench/views.md`：输出 17（入口计数）；声明加 `replaces`（输入表与输出 4 的补位）。
- `agent/conversation.md`：
  - 输出 1–3 改成消息视图与两个标签（会话面板的条目并进会话标签、去掉按日分组）；
  - 输出 52 改成 `pinned`；
  - 输出 53 改成归属插件的提供者形状（不再转交，档位按归属）；
  - 贡献表删两个视图。
- `bots/view.md`：改写成“bot 标签与归属提供者”，视图 id 一节删掉。
- `bots/bots.md` 输出 7：`list()` 的项加 `last`。
- `ui/agent-conversation-view.md`：用法档补“会话加 bot”。

## 切片

1. 工作台：入口计数、`replaces`。workbench 的 dom 测试与 e2e `workbench-shell`、`workbench-containers` 里的入口用例。
2. bots 后端：`last` 字段。bots.test.ts。
3. nb-agent-ui：`AgentMessagesList`（bot 行、标签、会话面板去掉分组）、头像列；同名 `.md` 与 Lab 场景；dom 测试。
4. agent 浏览器入口：宿主的档位按归属、`pinned`；提供者贡献点；`MessagesHost.vue`；删会话面板视图。session-host.test.ts。
5. bots 浏览器入口：改成提供者，删 `BotChatView`。e2e：`bots-chat` 改写，`agent-conversation`、`workbench-shell`、`workbench-containers`、`editor-area`、`files-explorer` 里引用两个旧视图的地方迁移（约 80 行）。
6. 收口：合并 master、受影响的 e2e、实现审查（前端 Sonnet；后端 omp 只审 1、2 片与提供者合同）。

## 验收映射

- `bots/view.md` 新验收 1：右栏消息视图的 bot 标签点星璃，聊天、停靠区、发话拒绝（沿用阶段 ① 的 e2e 1）。
- `bots/view.md` 新验收 2：失焦时到的回复，bot 标签、面板头与右栏入口都有计数，拿回焦点清零（e2e）。
- `agent/conversation.md` 新验收：会话标签点一行在同一个视图里打开；窄时按标题开抽屉；宽时列表常驻（e2e）。
- `workbench/views.md` 输出 4 的 `replaces`：旧布局记录里有会话面板与 bot 视图的标签，打开后两个都不见、不留占位（dom 测试与 e2e）。

## 验证

- 每片跑 `bun run test:affected`，nb-agent-ui 的 dom 测试，`typecheck`。
- 合入前跑一次的 e2e：`bots-chat`、`agent-conversation`、`agent-subagents`、`workbench-shell`、`workbench-containers`、`editor-area`、`files-explorer`（7 个）。
- 改动后只重跑改到的文件。
- 截图：右栏窄、拖宽后两栏、390 宽，明暗两态，给开发者看。

## 不做与风险

- 不做：会话标签滚到底分页加载（`list` 没有分页，现在一次取全部，见待确认）；多开（t03 决定 7）；书房入口（③）；按天与未读分隔线（④）。
- 风险：宿主的档位从构造时定改成按会话定，`interaction`、发话、命令守卫、停靠区状态清理这些读 `deps.fixed` 的地方（11 处）都要换；阶段 ① 的固定会话测试照新档位改写，不放宽断言。
- 风险：e2e 迁移面大；先改辅助函数（会话面板、对话视图的定位），再开大范围。

## 待确认

1. 位置：消息视图照旧在右栏（对话视图现在的位置），左侧栏不再有会话面板与 bot 入口。推荐，理由是对话一直在右栏、布局记录不用迁移。
2. 宽窄的分界取 600 像素：右栏默认宽度下是窄版（头像列加抽屉），拖宽或挪到编辑区旁边才是两栏。
3. 会话标签的“滚到底加载”（t03 决定 14）这次不做，照现在一次取全部：后端的 `list` 没有分页，加分页是另一件事。
