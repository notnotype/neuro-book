# t15 计划：阶段 ① 能和 bot 聊（草稿 1）

## Context

t06 做完了服务端：缺省 bot 星璃、主对话 `bot-lyra`、远程服务 `nbook.bots/bots`（`list`、`ensureMain`、`botsChanged`），但浏览器里没有入口。开发者 2026-11-19 定 t15 分阶段（Task README 决定 1），阶段 ① 做完就能聊：

- `nbook.bots` 的浏览器入口与一个单独的 bot 视图；
- `nbook.agent` 对外的“固定会话”对话宿主；
- 未读数；
- 有归属的会话从活动条等处打开时转到 bot 视图。

依据：[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 11 小节（固定会话档的取值表）、[t03 的决定](../t03-web-design/README.md)（第 1、13、20、21 项）、[调研](evidences/survey.md)。t06 决定 4：没有期限，所以“过期”的说法不做。

## 技术选型

无新依赖。头像经 `nbook.bots` 自己的 HTTP 路由交给浏览器，做法同 `nbook.stickers` 的取图路由；右侧抽屉留给阶段 ③（nb-ui 已有 `Drawer`）。

## 关键设计

### `packages/nb-agent-ui`：两项视图选项

- `SessionView.avatar?: string`：头像图片地址；给了时顶栏画头像图片，不画 Profile 图标。缺省时现在的行为不变。
- `AgentConversationView` 新属性 `pendingPlacement?: "wizard" | "dock"`，缺省 `wizard`：
  - `dock` 时，阻塞的审批与提问也进停靠区（现有的 `AgentDock`：一次一个、各自提交），输入框不隐藏；
  - 对应提案“待处理事项：停靠区，不替换输入框”。
- 回归：不传两项新选项时，现有场景的渲染不变（dom 测试照旧通过）。
- Lab 登记“bot 档”场景：头像、停靠区里的审批、没有新建会话与会话列表、命令白名单。

### `packages/neuro-book/src/plugins/agent/web/`：固定会话的对话宿主与转交

- **固定会话模式**：`createSessionHost` 加选项 `fixed: {sessionId}`。这个宿主：
  - 不读写“最近的会话”，挂载时直接打开这个会话；
  - 不受理换会话的动作（`session.create`、`/new`、`/fork`）；`session.select` 到别的 id（子会话卡片、子代理浮层）时交给通用视图打开（现有的 `nbook.agent.focus-session`），自己不换；
  - `interaction` 里 `canMutateHistory`、`canArchive`、`canRestore`、`canOpenTree` 为假，命令白名单只有 `compact`、`plan`、`mode`；
  - 发送：运行中按插话（steer）入队；有挂着的同步事项时 `send` 带 `settlePending: "deny"`；
  - 停止照现有：缺省“停止，排队的留着”，有自己的话时多给“停止并清空排队”。
- **服务**：在 `agent/shared/contracts.ts` 加浏览器侧服务键 `agentConversationKey`，交出组件工厂（先例：`markdownKey` 交组件）：
  - `fixedConversation(options) → Component`；
  - `options`：`session: () => Promise<{ok: true; sessionId} | {ok: false; code}>`（调用方取会话，例如 `ensureMain`）、`identity: {name, avatar}`（顶栏显示）、`emptyTitle`（没有消息时的标题）；
  - 取会话失败时只显示失败原因与“重试”，打字与附件不隐式建会话。
- **有归属的会话转交**：浏览器入口新加贡献点 `agent.sessionOwners`：
  - 贡献 id 是归属插件的 id，实现是 `{open(sessionId): void | Promise<void>}`；
  - 通用宿主打开会话（`open(id)`）读到会话头带 `owner`、而且有这个插件的贡献时，交给它打开，自己不换；没有贡献（插件没装或停用）时照常在通用视图里打开；
  - 活动条、子代理卡片、请求页都经 `open`，一处拦住。固定宿主自己打开时不转交。

### `packages/neuro-book/src/plugins/bots/`：未读、头像与 bot 视图

- **服务端**：
  - 未读：记录 `bots-seen`（应用级）存每个 bot“看到”的 seq，只进不退；
  - 主对话持有期间订阅它的日志帧，数助手消息；持有时从“看到”之后补数一次；
  - `list()` 的项加 `unread` 与 `latestSeq`；新方法 `markSeen({botId, through})`，`through` 小于已存的值时不动；变了推 `botsChanged`。
  - 头像路由 `GET /api/nbook.bots/avatar/<botId>`：读 bot 目录里的 `avatar.*`；没有这个 bot 或文件得 404。
- **浏览器入口**（新）：
  - 视图 `nbook.bots.chat`：左侧栏，不写容器（有自己的活动栏图标），标题“bot”，`badge()` 是缺省 bot 的未读数；
  - 视图内容：调 `ensureMain` 取会话，用 `agentConversationKey.fixedConversation` 画聊天，顶栏是 bot 的名字与头像；
  - 第一版只有一个 bot，视图里直接是它的聊天，不画联系人列表（列表在阶段 ② 的“消息”视图里）；
  - 看到：视图可见、窗口有焦点时，按 `latestSeq` 调 `markSeen`；
  - 贡献 `agent.sessionOwners` 的 `nbook.bots`：打开时揭示 `nbook.bots.chat`。
- 登记：描述加 `browser` 位置；`web/plugins.ts` 与消息目录；locales。

## Spec 与文档改动

- `ui/agent-conversation-view.md`：`avatar`、`pendingPlacement`，“用法档”一节先写会话档与 bot 档的取值表（会话加 bot 档在阶段 ②）。
- `agent/conversation.md`：固定会话的对话宿主服务、`agent.sessionOwners` 与转交。
- `bots/main-conversation.md`：未读与“看到”的位置、`markSeen`、`list` 的新字段。
- `bots/bots.md`：头像路由、浏览器入口。
- 新建 `bots/view.md`：bot 视图（位置、标题与计数、顶栏、取不到会话时、看到的规则）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | nb-agent-ui 两项选项、Lab 场景、dom 测试 | nb-agent-ui `bun run test`、typecheck |
| 2 | agent web：固定会话模式、`agentConversationKey`、`agent.sessionOwners` 与转交 | `session-host.test.ts`；neuro-book typecheck |
| 3 | bots 服务端：未读、`markSeen`、头像路由 | `bots.test.ts` |
| 4 | bots 浏览器入口与 bot 视图；登记 | 新的 e2e `bots-chat.e2e.ts`：打开视图、发话、等审批时发话一并结算、计数 |
| — | 前端实现审查（Sonnet）与后端实现审查（omp） | |

## 验证

- e2e 只跑新的 `bots-chat.e2e.ts` 与受影响的 `agent-conversation.e2e.ts`（转交改了打开路径）。
- 真实进程：开发服务里打开 bot 视图，和星璃说一句、批一次审批，截图（亮色）给开发者看。

## 不做与风险

- 不做：联系人列表、“消息”视图（阶段 ②）；书房入口（③）；按天与未读分隔线（④）；日程（t10）；人设进提示词（t09）。
- 风险：固定模式改的是 1,900 行的 `session-host.ts`。只加选项分支，不动通用路径；回归靠现有的 `session-host.test.ts` 与 e2e。
- 待定（t06 设计审查第二轮第 6 条）：主对话只读解除没有推送。阶段 ① 在视图重新可见时重取快照，不加内核推送。
