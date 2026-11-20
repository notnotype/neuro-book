# t15 计划：阶段 ③ 书房的看板娘入口与滑出聊天（草稿 1）

## Context

阶段 ② 把 bot 聊天放进了右栏的“消息”视图，但书房（没有绑定项目的窗口）没有视图区，进不去。阶段 ③ 按 t03 的定稿给书房一个入口（t15 决定 1 的第 ③ 段）：

- t03 决定 22：案头的看板娘（星璃的小猫形态）就是入口；有未读时右上角计数、下方小气泡写最新一句；等你处理时换成黄色感叹号与“等你批准：……”；没有未读时不加东西。
- t03 决定 23：点看板娘后从右边滑出聊天（选 A），书房不压暗，头部与内容同消息视图的聊天。
- t15 决定 6：第二行先写通用状态（“正在回复…”“等你处理”），具体在做什么等后端有活动摘要再补。本阶段的气泡沿用这一条（见待确认 1）。

依据：[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md) 输出 2、[`bots/view.md`](../../../../../docs/specs/bots/view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 2、52、53；评审板 t03 第 7 轮（`r7/entry-unread.webp`、`entry-waiting.webp`、`open-drawer.webp`）；草稿 `ShelfBotDraft`（t03 草稿 worktree，只沿用版式）。

开工调研确认的事实：

- `nbook.agent` 与 `nbook.bots` 的浏览器入口都是 `onStartup`，书房窗口里照常激活（`project` 为 null）；联系人、未读、活动在书房里已经有数据。
- 宿主按位置建（`hostAt("view" | "page")`，`agent/web/plugin.ts`），对话组件 `ConversationHost.vue` 挂上时 `borrow()` 并 `restore()`。
- 案头 `ShelfDesk.vue` 把看板娘写死在第三列（150px，窄时 96px），没有贡献位（调研 `evidences/survey.md`）。
- nb-ui `Drawer` 基于 Reka `DrawerRoot`：非模态时没有遮罩，但 ① 内容上任何鼠标按下（按钮、链接、输入框之外）都开始滑动关闭并抓住指针（`reka-ui/dist/composables/useSwipeDismiss.js` 的 `onPointerDown`），在聊天里拖选文字、在输入框（contenteditable 不在忽略名单里）里拖动都会拖走抽屉；② 非模态时点外面照样关。Reka 没有关掉滑动的选项。

## 技术选型

无新依赖。滑出面板用 nb-ui `Drawer`，补两个开关（见关键设计“nb-ui Drawer”），不在业务里手写侧栏。

## 关键设计

### 案头的贡献位（`projects/shared/desk.ts` 新，`projects/web/`）

- 新贡献点 `projects.desk`：只收浏览器入口的贡献，声明为空对象；实现 `{component: Component}`，组件不带属性，填满案头第三列那一格。
- 接收方是 `nbook.projects` 的浏览器入口：恰好一条时用它；没有或多于一条时用现在的看板娘（多于一条记诊断，同 `workbench.home` 的裁决）。
- `BookshelfHost` → `BookshelfPage` → `ShelfDesk` 加一个可选属性 `companion: Component | null`；`ShelfDesk` 第三列为 null 时画 `NeuroBookMood`，否则画它。格子尺寸（150px、窄时 96px、圆角）留在 `ShelfDesk`，贡献的组件按格子宽画。
- 空书架时第三列照样是这一格（问候与入口并存）。
- 依赖方向：`agent → projects/shared`；projects 不认识 agent。

### 看板娘入口（`agent/web/DeskCompanion.vue` 新、同名 `.md`）

`nbook.agent` 的浏览器入口贡献 `nbook.agent.desk`。

- **代表谁**：第一个归属插件交出的第一个联系人（第一版只有一个 bot）。没有联系人（bots 停用、联系人读不到或还没读到）时画不能点的看板娘，与现在相同。
- **画法**：按钮包住 `NeuroBookMood`（`variant="tile"`）。
  - 心情：等你处理 `ask`，在跑 `think`，其余 `idle`（见待确认 2）；在跑与等你处理按会话树的根算，同消息视图。
  - 角标：右上角，与入口角标同一种（计数，超过 99 写 99+）；有等你处理的事时换成警示色的“!”。
  - 气泡：在看板娘下方、右对齐、指向它，单行截断，最宽 260px 且不超过案头宽。等你处理时写警示色“等你处理”（待确认 1）；否则有未读时写联系人的最后一句话（`last.text`）；都没有时不画。
  - 读屏名：同头像列（“星璃，3 条未读”、“星璃，等你处理”）；`aria-expanded` 跟聊天开着没有。
- **点击**：没开时打开滑出聊天并打开这个联系人的主对话；开着时关上。

### 滑出聊天（同一个 `DeskCompanion.vue`）

- 面板：nb-ui `Drawer`，`direction="right"`、`modal=false`、关掉滑动关闭与点外面关闭；宽 420px（草稿值）、不超过视口的 90%；上沿让出桌面窗口的标题行（`top: var(--nb-window-frame-offset, 0px)`），不压住窗口按钮。读屏标题是联系人名字。
- 内容：`ConversationHost`，宿主是新位置 `hostAt("desk")`，不给面板头（`head` 为 null，对话的头画在内容里，同宽版消息视图）。
  - 头的右列最后一个是“关闭”；子代理入口照常在右列最前面。
  - 点标题不开会话列表：抽屉里没有会话列表。
  - `desk` 位置的“最近的会话”不读不写：挂上时不恢复别的会话，聊天只由点看板娘打开。
- 打开联系人与盖层：从 `messages-model.ts` 拆出 `contact-opener.ts`（见下节），盖层的画法从 `MessagesHost.vue` 拆成 `components/ContactCover.vue`，两处共用。
- 关闭：头上的“关闭”、Esc、再点看板娘。关闭后焦点回到看板娘。宿主随插件活着，再开时接着上次。
- 看到：抽屉开着、页面可见、窗口有焦点、没有盖层时，把已应用的 seq 交给归属插件（同 `bots/view.md` 输出 4）。

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

### 对话的头（`nb-agent-ui`、`agent/web/ConversationHost.vue`）

- `AgentConversationView` 加插槽 `head-end`：头的右列最后。同名 `.md` 与 Lab 场景随改。
- `ConversationHost` 加两个可选属性：`close?: () => void`（给了就在 `head-end` 画“关闭”）、`sessionList?: boolean`（缺省 true；false 时不放 `#sessions`，点标题不开下拉）。

### nb-ui Drawer（`packages/nb-ui/src/components/feedback/Drawer.vue`、`Drawer.md`）

加两个属性，缺省保持现在的行为：

- `swipeToClose?: boolean`（缺省 true）：false 时内容里的按下不开始滑动。做法：内容外包一层，在它上面截住 `pointerdown` 的冒泡，Reka 的滑动监听挂在内容元素上，收不到；文档级的“点外面”判断在捕获阶段，不受影响。实施时先在 Lab 里验证拖选文字、输入框里拖动都不动抽屉。
- `closeOnOutside?: boolean`（缺省 true）：false 时对 `interact-outside` 取消默认，点外面不关。

### 插件装配（`agent/web/plugin.ts`）

- `hostAt` 加 `"desk"` 位置：`recent` 换成不读不写的实现。
- 浏览器入口声明对 `projects.desk` 的贡献，实现是用 `DeskCompanion` 包好的组件（取插件作用域的提供者表、活动、模型有无、打开模型设置、`hostAt("desk")` 与对话属性，做法同 `MessagesHost`）。
- 入口只在书房出现（`projects.desk` 只在书架页画），绑定项目的窗口不受影响。

## Spec 与文档改动

- `workbench/bookshelf.md`：输出 2 的看板娘改为“看板娘一格可由 `projects.desk` 的贡献替换”；新增贡献点一条（声明、实现、裁决、尺寸）；Lab 场景名。
- `agent/conversation.md`：新输出“书房的看板娘入口与滑出聊天”（代表谁、角标与气泡、心情、点击、面板、关闭、看到、`desk` 位置不恢复）；贡献表加 `projects.desk`。
- `bots/view.md`：不承诺里的“书房入口”删掉；输出 5 计数的去处加看板娘角标；验收加一条书房场景。
- `ui/agent-conversation-view.md`：插槽 `head-end`。
- 组件 `.md`：`Drawer.md`、`ShelfDesk.md`、`BookshelfPage.md`、`DeskCompanion.md`、`ContactCover.md`、`AgentConversationView.md`。

## 切片

1. **nb-ui Drawer 两个开关**：属性、`.md`、dom 测试（截住冒泡后内容按下不触发滑动；点外面不关）；Lab 场景加一个非模态、两个开关都关的抽屉，真实浏览器里拖选文字验证。提交。
2. **拆出 `contact-opener.ts` 与 `ContactCover.vue`**：纯重构，`messages-model.test.ts` 不改照过，消息视图 e2e `bots-chat` 照过。提交。
3. **案头贡献位**：`projects.desk` 点、接收、`ShelfDesk` 的 `companion`；`ShelfDesk.dom.test.ts` 加“有贡献时画它、没有时画看板娘”；`projects.test.ts` 加多于一条的裁决。提交。
4. **头的 `head-end` 与 `ConversationHost` 两个属性**：nb-agent-ui dom 测试、Lab 场景。提交。
5. **看板娘入口与滑出聊天**：`DeskCompanion`、`hostAt("desk")`、贡献；`contact-opener.test.ts`；Lab 场景 `DeskCompanion`（未读、等你处理、没有联系人三态，加英文场景看气泡截断）；e2e `bots-chat.e2e.ts` 加书房一组（验收见下）。提交。
6. **Spec 改动**（master）与收口验证、实现审查（前端 Sonnet）。

每片自跑：受影响包的 `bun test <文件>`、`bun run typecheck`（nb-ui、nb-agent-ui、neuro-book）、`bun run docs:check`（改 Spec 时）。

## 验收映射

- `agent/conversation.md` 新输出：入口三态（未读计数加最后一句、等你处理、没有联系人）→ `DeskCompanion` 的 dom 测试与 Lab 场景；点击打开、再点关上、Esc、焦点回到看板娘 → e2e；看到 → `contact-opener.test.ts` 加 e2e 失焦用例。
- `workbench/bookshelf.md` 贡献位 → `ShelfDesk.dom.test.ts`、`projects.test.ts`。
- `bots/view.md` 新验收（书房）：开发服务、配好模型；书房案头的看板娘，窗口失焦时到一条回复，看板娘右上角“1”、气泡写那句话；点看板娘，右边滑出她的主对话，书房不压暗；在聊天里拖选一句话，抽屉不动；关闭后角标清零 → `bots-chat.e2e.ts` 书房一组。
- nb-ui `Drawer.md` 两个开关 → `Drawer` 的 dom 测试与 Lab e2e。

## 验证

- 合入前 e2e：`bots-chat`（含新书房组）、`bookshelf`（案头没回归）、`agent-conversation`（`ConversationHost` 改了属性）、`lab-agent-ui`（头的插槽），4 个文件。
- 实施中改动后只重跑覆盖改动的那个文件与失败项。
- 截图：书房 1440 宽与 390 宽的入口三态、抽屉打开态，亮色；桌面外框下抽屉不压窗口按钮看 `desktop-frame` 的写法（只断言计算样式），不另做 Windows 实测。
- 未验证的边界：真实桌面壳里抽屉与窗口按钮的命中（只量计算样式）。

## 不做与风险

- 不做：多个 bot 时入口代表谁的选择（第一版一个 bot）；书房里的会话列表与新建会话；入口的活动摘要文字（等后端）；书房窗口标题的未读数（提案“触达”，另排）。
- 风险：
  - Drawer 截住 `pointerdown` 的冒泡可能挡掉内容里依赖冒泡的监听（例如对话里的拖放、选区菜单）。Lab 与 e2e 里拖选文字、输入框输入、附件按钮都走一遍；挡掉了就改为只在滑动监听的元素上判断按下来源。
  - 书房窗口没有项目：对话里的 `project://` 链接打不开（没有编辑器）。照现在“打开地址失败”的提示，不另做。

## 待确认

1. 等你处理时气泡写“等你处理”（与 t15 决定 6 的第二行一致），不写 t03 决定 22 的“等你批准：具体的事”：后端还没有具体的事的摘要。推荐这样，等后端有摘要再补。
2. 看板娘的心情跟着状态：等你处理 `ask`，在跑 `think`，其余 `idle`。t03 决定 22 没提，是新加的；推荐加，成本很小，不要就全用 `idle`。
3. 滑出聊天宽 420px（草稿值），点外面不关（边看书架边聊）；关闭靠“关闭”、Esc 与再点看板娘。
