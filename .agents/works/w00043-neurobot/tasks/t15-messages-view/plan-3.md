# t15 计划：阶段 ③ 书房的看板娘入口与滑出聊天（草稿 3）

## Context

阶段 ② 把 bot 聊天放进了右栏的“消息”视图，但书房（没有绑定项目的窗口）没有视图区，进不去。阶段 ③ 按 t03 的定稿给书房一个入口（t15 决定 1 的第 ③ 段）：

- t03 决定 22：案头的看板娘（星璃的小猫形态）就是入口；有未读时右上角计数、下方小气泡写最新一句；等你处理时换成黄色感叹号与“等你批准：……”；没有未读时不加东西。
- t03 决定 23：点看板娘后从右边滑出聊天（选 A），书房不压暗，头部与内容同消息视图的聊天。
- t15 决定 6：第二行先写通用状态（“正在回复…”“等你处理”），具体在做什么等后端有活动摘要再补。本阶段的气泡沿用这一条（待确认 1）；聊天的头在消息视图里也没有第二行，抽屉的头同样没有（评审板图上头里的“正在整理读者评论…”等活动摘要）。

依据：[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md) 输出 2、[`bots/view.md`](../../../../../docs/specs/bots/view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 2、52、53；评审板 t03 第 7 轮（`r7/entry-unread.webp`、`entry-waiting.webp`、`open-drawer.webp`）；草稿 `ShelfBotDraft`（t03 草稿 worktree，只沿用版式）。设计审查两轮：[第一轮](evidences/design-review-4-sonnet.txt)、[第二轮](evidences/design-review-5-sonnet.txt)，处理见 [evidences/design-review-4-disposition.md](evidences/design-review-4-disposition.md)。

开工调研与审查确认的事实：

- `nbook.agent` 与 `nbook.bots` 的浏览器入口都是 `onStartup`，书房窗口里照常激活（`project` 为 null）；联系人、未读、活动在书房里已经有数据。草稿、附件、最近对话、文件提及在 `project` 为 null 时都有分支，bot 的主对话不绑作品。
- 宿主按位置建（`hostAt("view" | "page")`，`agent/web/plugin.ts`），`ConversationHost.vue` 挂上时 `borrow()` 并 `restore()`；借用数归零 30 秒后放开订阅，再借用时 `openHere` 重开同一个会话，现在会把 `opened` 加一。
- 案头 `ShelfDesk.vue` 把看板娘写死在第三列（150px，窄于 720px 时 96px），没有贡献位。
- nb-ui `Drawer` 不合用：Reka 抽屉在内容上任何鼠标按下（按钮、链接、输入框之外）与任何触摸都开始滑动关闭，没有关掉的选项；在内容里截住冒泡挡不住触摸路径，还会让别的浮层收不到“点外面”（审查第 1 条用 happy-dom 实验核实）。它也没有滑入动画、正文带内边距且自己滚动、要读屏名就得画可见的标题栏。`AgentMessages` 的窄版抽屉因同样的原因没用它。

## 技术选型

无新依赖。滑出面板做成 nb-ui 新组件 `SidePanel`，建在 Reka `DialogRoot`（`modal=false`）上：Esc、传送、层级、焦点归还由 Reka 给，没有手势代码；否决给 `Drawer` 加开关（关不干净，见上）与在业务里手写侧栏（焦点与层级要重做一遍）。

## 关键设计

### nb-ui `SidePanel`（`packages/nb-ui/src/components/feedback/SidePanel.vue` 新、同名 `.md`、导出）

非模态、贴窗口右边、全高的面板。

```ts
interface SidePanelProps {
    open: boolean;            // 受控
    /** 读屏名（对话框角色的名字），不画可见标题。 */
    label: string;
    /** 宽度，缺省 420px；不超过传送目标宽度的 90%。 */
    width?: string;
}
// emits: update:open、closed（内容卸载、焦点归还之后，复用 close-handoff）
// slots: trigger（as-child，打开它的元素，只能一个元素）、default（正文，无内边距、不滚动，撑满）
```

- 结构：根不是元素（Reka `DialogRoot` 只渲染插槽），调用方自己包一层；写进 `.md`。
- 位置与尺寸：传送目标同 Drawer（`useTeleportTarget`），`top: var(--nb-side-panel-inset-top, 0px); bottom: 0`，宽 `min(<width>, 90cqw)`。nb-ui 不认识桌面壳：neuro-book 在 `html[data-desktop-frame]` 里把 `--nb-side-panel-inset-top` 设成 `--nb-window-frame-height`（书房自带标题行时 `--nb-window-frame-offset` 是 0，不能用它）。
- 不压暗。点外面与焦点移出都不关（对 `interact-outside` 取消默认），点触发器是切换。
- Esc：复用 `dialog-close.ts` 的判断，组字时不关；只在焦点在面板里或触发器上时关（同 `AgentMessages` 的窄版抽屉）。关闭后只在关闭前焦点在面板里时还给触发器，程序性关闭不抢焦点。
- 打开时焦点放进面板（Reka 的缺省，不取消），调用方可以之后再挪。
- Tab 在面板里循环（Reka 非模态照样 `loop`）：键盘的出口是 Esc 与调用方给的关闭按钮，写进 `.md` 的边界。
- 层级：`z-index.ts` 新增 `sidePanel` 一档，低于 `popover`、高于页面内容，不进模态序列，补进层级测试的顺序断言；面板向内容提供 `NB_POPOVER_Z_INDEX`（取 `popover`），里面的下拉与菜单压在面板上不靠 DOM 顺序。
- 入退场：自右滑入、滑出的关键帧，退场带 `forwards`（Reka 关闭时等 `animationend`，不带会弹回一帧）；减少动画时时长 token 归零，写法同 Popover。
- 读屏：`label` 渲染成 sr-only 的 `DialogTitle`，不要描述时 `aria-describedby` 置空（免得 Reka 开发构建警告）。
- 测试：dom 测试（点外面不关、Esc 在面板里关、组字不关、焦点在外面时 Esc 不关、关闭后焦点去向、`closed` 在卸载后发、内容上没有滑动手势）；Lab 场景一个放长文本与输入框的面板。

### 案头的贡献位（`projects/shared/desk.ts` 新，`projects/web/`）

- 新贡献点 `projects.desk`：只收浏览器入口的贡献，声明为空对象；实现 `{load: () => Promise<Component>}`，同 `workbench.views`、`workbench.home` 的写法，只有书房会调 `load`，项目窗口不加载。
- 接收方是 `nbook.projects` 的浏览器入口：恰好一条时用它；没有或多于一条时不用（多于一条记诊断，同 `workbench.home` 的裁决）；`load` 失败记诊断、不用。
- 猫始终由 `ShelfDesk` 画，不随贡献换掉（换组件会让自定义元素重挂、动画从头播）：第三列的格子里先是 `NeuroBookMood`，贡献的组件叠在同一格上（单格网格，`grid-area: 1 / 1`），只画触发按钮、角标、气泡与面板。贡献的组件发 `update:mood` 改猫的心情，没有贡献时是 `idle`。
- `BookshelfHost` → `BookshelfPage` → `ShelfDesk` 加可选属性 `companion: Component | null`。格子的宽（150px、案头窄时 96px）与圆角在格子上；贡献的组件有自己的根元素，根与按钮都取 `border-radius: inherit`。宽窄按案头 `section` 的容器查询（`@container (max-width: 720px)`），贡献的组件用同一个查询，不另设容器。这些约束写进 `ShelfDesk.md`。
- 空书架时第三列照样是这一格。
- 依赖方向：`agent → projects/shared`；projects 不认识 agent。

### 看板娘入口（`agent/web/DeskCompanion.vue` 新、同名 `.md`）

`nbook.agent` 的浏览器入口贡献 `nbook.agent.desk`，`load` 动态导入 `DeskCompanion.vue`；面板里的对话部分（`ConversationHost` 及其依赖）用异步组件，第一次打开时才加载。

- **代表谁**：按提供者表的次序，第一个有联系人的归属插件的第一个联系人（第一版只有 bots 一个归属插件、一个 bot）。没有联系人（bots 停用、读不到、还没读到）时画不能点的看板娘，与现在相同；读不到时按钮的提示写原因。
- **画法**：根元素铺满格子；里面是盖在猫上的透明按钮（焦点环画在按钮上）、角标与气泡（按钮的兄弟，不可点）、`SidePanel`。
  - 心情：等你处理时发 `update:mood` 为 `ask`，其余 `idle`（待确认 2）。在跑与等你处理按会话树的根算，同消息视图。
  - 角标：右上角，计数（超过 99 写 99+，复用 `entryCountText`，从 `workbench/web/components/entry-count.ts` 移到 `workbench/shared/`）；有等你处理的事时换成警示色的“!”。`unread` 为 null 按 0。
  - 气泡：绝对定位在格子下方（`top: 100%`，落在案头与书架之间的间距里，不推动布局）、右对齐、`pointer-events: none`，尖角对准格子中线（按格宽算），单行截断，最宽 260px。等你处理时写警示色“等你处理”（与“!”同一状态，待确认 1）；否则有未读时写最后一句话（`last.text`）；都没有时不画。案头窄于 720px 时不画气泡（待确认 4），只留角标。
  - 读屏名：同头像列（“星璃，3 条未读”、“星璃，等你处理”）；最后一句话只在气泡里，不进读屏名（取舍写进 `DeskCompanion.md`）。
- **点击**：按钮是 `SidePanel` 的触发器。打开时调 `ensureStarted()`（读模型、Profile、Skill），再打开联系人；面板开着时看板娘被面板盖住（窗宽约 1560px 以内），关闭靠头上的“关闭”与 Esc；宽窗口里看板娘露在外面时再点也关。

### 滑出聊天（同一个 `DeskCompanion.vue`）

- 面板：`SidePanel`，`label` 是联系人名字，宽 420px。
- 内容：`ConversationHost`，宿主是新位置 `hostAt("desk")`，不给面板头（`head` 为 null，对话的头画在内容里）。
  - 头的右列最后是“关闭”（`AgentConversationView` 的 `closable` 与 `close`，见下）。
  - 不放会话列表（`ConversationHost` 的 `sessions: false`）。子代理入口照常；进了子会话后，头里的路径是回主对话的路。
  - `desk` 位置的“最近的会话”不读不写，也不记“最近用过的位置”（命令不会落到书房面板）。
- 盖层：画法从 `MessagesHost.vue` 拆成 `components/ContactCover.vue`，两处共用。面板里没有会话时一律盖着：有在途的联系人时按它的步骤（没有模型、正在打开、取不到），没有时写“找不到 bot”。抽屉里因此不会露出第一屏、建不出无归属的会话。
- 联系人消失（提供者撤回、bots 停用）时关面板。
- 面板开着期间 `DeskCompanion` 自己借用宿主（`host.borrow()`，关面板时交还），不等 `ConversationHost` 挂上：开会话之前一定有借用，释放照现有的 30 秒规则。
- 焦点：打开时先在面板里（缺省）；第一次满足“没有盖层、输入框已挂上”时，焦点还在面板容器或看板娘上就 `focusComposer()`，用户已把焦点放到别处不抢。盖层显示时下面的对话加 `inert`（消息视图同改），盖层里的按钮是唯一能聚焦的。关闭后焦点规则见 `SidePanel`。
- 输入框里 Esc（没有补全菜单、不在输入法组字中）也关面板：`PromptEditor` 已经发 `escape`，经 `AgentConversationComposer`、`AgentConversationView` 往上发，`ConversationHost` 给了 `close` 时调它。
- 关面板时作废在途的联系人（`opener.cancel()`），免得关着面板时模型配好、在没人借用的宿主上打开会话。
- 看到：面板开着、窗口有焦点、没有盖层时，把已应用的 seq 交给归属插件。窗口焦点抽成 `useWindowFocus()`（监听 window 的 focus、blur，初值 `document.hasFocus()`），消息视图与书房共用。书房里“可见”就是面板开着。

### 宿主的 `opened`（`agent/web/session-host.ts`）

`opened` 只在换了会话或调用方打开时加一；借用时重新订阅同一个会话（`borrow()` 里的 `openHere`）不加，也不写“最近的会话”。做成 `openHere` 的一个选项，重开照样走取回向导与停靠区状态那一段。否则书房面板重开时，挂载引起的重订阅会作废刚点的联系人（审查第 6 条）。消息视图不受影响（它一直挂着）。`session-host.test.ts` 加“借用重开不算打开”。

### 打开联系人的公共部分（`agent/web/contact-opener.ts` 新，`messages-model.ts` 改用它）

把 `messages-model.ts` 里与列表无关的部分搬过去，行为不变：

```ts
interface ContactOpener {
    readonly pending: ShallowRef<PendingContact | null>;
    activityOf(sessionId: string | null): "idle" | "running" | "waiting";
    find(key: string): FoundContact | null;
    openContact(key: string): Promise<void>;
    cancel(): void;
    watchSeen(active: () => boolean): () => void;
}
function createContactOpener(options: Pick<MessagesModelOptions, "host" | "providers" | "activity" | "hasModel">): ContactOpener;
```

- 搬过去的：`asking` 记号、`opening` 标志与 `host.opened` 的同步监视、提供者撤回时撤盖层、等模型读到再开、看到。
- `messages-model.ts` 留下分段、标签、选中、`pickBot`、头像列的最近会话，组合 `createContactOpener`。
- 现有的 `messages-model.test.ts` 不改断言，照常通过；入口一侧的用例写在 `contact-opener.test.ts`（宿主与提供者用同一套响应式替身）。

### 对话的头与输入框（`nb-agent-ui`）

- `AgentConversationView` 加 `closable?: boolean` 与事件 `close`：头的右列最后画“关闭”；加事件 `escape`（输入框里的 Esc 往上发）。同名 `.md` 与 Lab 场景随改。
- `AgentConversationComposer` 把编辑器的 `escape` 往上发。

### 插件装配（`agent/web/plugin.ts`、`ConversationHost.vue`）

- 位置类型提成 `ConversationPosition = "view" | "page" | "desk"`，`hostAt`、`conversationComponent`、`hostDeps`、`initAt` 共用；`hostAt("desk")` 的 `recent` 换成不读不写的实现。
- 消息视图与书房面板交给 `ConversationHost` 的那一大组属性抽成一个函数 `conversationProps(position, host)`，两处调用。
- `ConversationHost` 加 `close?: () => void`（给了就 `closable`，`close` 与 `escape` 都调它）与 `sessions?: boolean`（缺省 true；false 时不放 `#sessions`，`ownList` 与标题弹出状态的写回都跟着它）。
- 浏览器入口声明对 `projects.desk` 的贡献。

## Spec 与文档改动

- `workbench/bookshelf.md`：输出 2 的看板娘改为“看板娘一格可由 `projects.desk` 的贡献替换”；新增贡献点一条（声明、`load`、裁决、格子尺寸与单根）；Lab 场景名。
- `agent/conversation.md`：新输出“书房的看板娘入口与滑出聊天”（代表谁、角标、气泡、心情、点击、面板、盖层、关闭与焦点、看到、`desk` 位置不恢复）；贡献表加 `projects.desk`。
- `bots/view.md`：不承诺里的“书房入口”删掉；输出 5 计数的去处加看板娘角标；验收加一条书房场景。
- `ui/agent-conversation-view.md`：`closable`、`close`、`escape`。
- 组件 `.md`：`SidePanel.md`（新）、`ShelfDesk.md`、`BookshelfPage.md`、`DeskCompanion.md`（新）、`ContactCover.md`（新）、`AgentConversationView.md`、`AgentConversationComposer.md`。

## 切片

1. **nb-ui `SidePanel`**：组件、`.md`、导出、`z-index.ts` 的 `sidePanel` 一档与层级测试、dom 测试、Lab 场景；neuro-book `styles.css` 的 `--nb-side-panel-inset-top`。提交。
2. **拆出 `contact-opener.ts`、`ContactCover.vue`、`useWindowFocus()`，宿主 `opened` 改语义**：`messages-model.test.ts` 不改照过；`session-host.test.ts` 加借用重开不算打开。提交。
3. **案头贡献位与 `entryCountText` 移到 shared**：`projects.desk` 点、接收、`ShelfDesk` 的 `companion`；`ShelfDesk.dom.test.ts` 加“有贡献时叠在猫上、猫不重挂、心情跟着贡献发的值”，`projects.test.ts` 加多于一条的裁决与 `load` 失败。提交。
4. **头的 `closable`、`escape` 与 `ConversationHost` 两个属性、位置类型与属性函数**：nb-agent-ui dom 测试（关闭、输入框 Esc 往上发、有菜单时不发）、Lab 场景。提交。
5. **看板娘入口与滑出聊天**：`DeskCompanion`、`hostAt("desk")`、贡献；`contact-opener.test.ts`；Lab 场景 `DeskCompanion`（未读、等你处理、没有联系人、读不到四态，加英文场景看气泡截断）；e2e 书房一组。提交。
6. **Spec 改动**（master）与收口验证、实现审查（前端 Sonnet）。

每片自跑：受影响包的 `bun test <文件>`、`bun run typecheck`（nb-ui、nb-agent-ui、neuro-book）、`bun run docs:check`（改 Spec 时）。

## 验收映射

- `SidePanel.md` → `SidePanel` 的 dom 测试与 Lab 场景；层级与传送只在产品页验收（见下面的 e2e）。
- `agent/conversation.md` 新输出：入口四态 → `DeskCompanion` 的 dom 测试与 Lab 场景；联系人消失时关面板、没有会话时的盖层、借用 → dom 测试与 `contact-opener.test.ts`；借用重开 → `session-host.test.ts`；其余见 e2e。
- `workbench/bookshelf.md` 贡献位 → `ShelfDesk.dom.test.ts`（有贡献时猫不重挂、心情跟贡献）、`projects.test.ts`。
- `bots/view.md` 新验收（书房），`bots-chat.e2e.ts` 里单独一组（面板按 `role=dialog` 与名字定位，起点先读出未读为 0，回复带唯一文字）：
  - 打开 `/`；点看板娘，右边滑出她的主对话，书房不压暗，焦点在输入框；
  - 看到的正向：面板开着、有焦点时回复，不产生未读；
  - 看到的反向：模拟失焦（`window` 的 `blur` 事件）后发一句、脚本端点回复，按“关闭”，看板娘角标“1”、气泡写那句回复；模拟拿回焦点、再点开，角标清零；
  - 输入框里 Esc 关面板、焦点回到看板娘；
  - 输入 `@`，菜单项中心点 `elementFromPoint` 命中菜单（压在面板上）；
  - 发一条带附件的话（书房没有作品时的对话）；
  - 面板里的文字能拖选、选区非空；
  - 桌面外框（同 `desktop-frame.e2e.ts` 的能力标记）下，面板头“关闭”的矩形与窗口按钮组的矩形不相交。

## 验证

- 合入前 e2e：`bots-chat`（含新书房组）、`bookshelf`（案头没回归）、`agent-conversation`（`ConversationHost` 改了属性）、`lab-agent-ui`（头的关闭），4 个文件。
- 实施中改动后只重跑覆盖改动的那个文件与失败项。
- 截图：书房 1440、780（案头宽跨过 720）、390 三个宽的入口各态与面板打开态，亮色。
- 未验证的边界：真实桌面壳里面板与窗口按钮的命中。

## 不做与风险

- 不做：多个归属插件时入口代表谁的选择（第三方插件的 id 排在 `nbook.bots` 之前、又交出联系人时，入口会换成它的；第一版只有 bots，记为已知限制）；书房里的会话列表与新建会话；入口的活动摘要文字（等后端）；书房窗口标题的未读数（提案“触达”，另排）；`AgentMessages` 的窄版抽屉改用 `SidePanel`（它在视图里、不传送，另议）。
- 风险：书房窗口没有项目，对话里的 `project://` 链接打不开（没有编辑器），照现在“打开地址失败”的提示，不另做。

## 待确认

1. 等你处理时气泡写“等你处理”（与 t15 决定 6 一致），不写 t03 决定 22 的“等你批准：具体的事”：后端还没有具体的事的摘要，而且等你处理的也可能是提问，不只是批准。推荐这样，等后端有摘要再补。
2. 看板娘的表情：等你处理时换成“提问”，其余照旧空闲。t03 决定 22 没提，是新加的；在跑不换表情，免得 bot 在后台频繁起停时看板娘反复播切换动画。不要就全用空闲。
3. 滑出聊天宽 420px（草稿值），点外面不关（边看书架边聊）；面板开着时会盖住看板娘，关闭靠头上的“关闭”与 Esc（输入框里按 Esc 也关；焦点在书架上时 Esc 不关面板）。键盘 Tab 在面板里循环，出口是 Esc 与“关闭”。
4. 案头窄于 720px（窗口约 760px 以下）时看板娘缩到 96px，气泡放不下（会压住统计与“继续写作”），只留角标。
