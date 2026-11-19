# t15 开工调研（2026-11-19）

三位 Haiku 子代理只读调研，主 Agent 汇总。路径相对 `packages/`。

## 现有的两个视图与对话宿主（`neuro-book/src/plugins/agent/web/`）

- 视图 `nbook.agent.conversation`（右栏，`ConversationHost.vue`）与 `nbook.agent.sessions`（左栏“项目”容器，`SessionPanelHost.vue`）在 `plugin.ts:78-94` 声明、`:722` 交实现；编辑区另有同 id 的页面。状态栏活动条目 `nbook.agent.activity` 点击走 `nbook.agent.focus-session`。
- 对话宿主是 `session-host.ts`（约 1,900 行），按位置（视图、页面）各一份：
  - `create`、`open`、`restore()` 恢复“最近的会话”（存储记录 `agent.recent-session`）；
  - `/` 命令只处理 `compact`、`new`、`fork`、`rename`、`plan`、`mode`；
  - `submit`：空闲 `send`，运行中按 `delivery` 走 `enqueue`（steer 或 followup）；
  - 停止 `abort{keepQueue}`；改写历史（编辑、重试、从此处分支、切分支、归档）都在宿主的 `act` 里分支。
- 会话面板一次取全部（`remote.list`），每 15 秒刷新，没有分页；打开会话经 `session.select` 再 `nbook.view.open` 把对话视图带到前面。活动条目、子代理卡片、子代理浮层、请求页都经 `session.select` 或 `nbook.agent.focus-session` 打开会话。
- 浏览器入口对外只提供 `stickerAllowlistUsageKey`；“服务里交组件”的先例是 `markdownKey`（交出 `MarkdownDisplay` 等组件）。
- 测试：没有两个宿主组件的 dom 测试；单元测试 `session-host.test.ts` 等；e2e `agent-conversation`、`agent-subagents`、`workbench-shell`、`workbench-containers` 等直接用两个视图 id。

## nb-agent-ui（对话视图包）

- `AgentConversationView` 的选项：`header`、`newSession`、`sessionsOpen`、`statusBar`、`composerLayout`、`processDisclosure` 等，宿主接口是 props 加 `action` 事件。
- 作者：新内核适配器 `kernel-transcript.ts` 对 `by.kind` 为 `session`、`host` 的话调宿主给的 `authorOf` 写 `author`；排队区有 `author` 时标来源，`editable: false` 时没有“取出来改”。
- 阻塞的待处理事项在向导里（替换输入框），带来源或异步的在停靠区；**没有切换位置的选项**。
- 停止键的“停止并清空排队”下拉已有（`interaction.stopClearing`）。
- **没有**按天分隔线、未读分隔线；时间用运行环境的本地时区。
- 文案在包内目录 `nb-agent-ui`；**没有**视图级的文案覆盖（只有会话列表有 `labels`）。

## 书架、工作台与草稿

- 案头 `projects/web/components/ShelfDesk.vue` 写死三栏（统计、最近写到、看板娘 `NeuroBookMood`），**没有**贡献位，要新开。
- 工作台视图声明在 `workbench.views`，`badge()` 在视图实现上（已有，通知视图在用）；位置 `sidebar`、`auxiliarybar`、`panel`。nb-ui 有右侧 `Drawer`（380px）；产品里还没有业务用它。
- t03 的草稿（`.worktree/w00043-t03-drafts`）：`MessagesTabs`（两个标签）、`ShelfBotDraft`（书房入口与滑出聊天）、`QueueDraft`、`ScheduleForm` 等，全靠写死的样本与 Lab 的假宿主，文案写死中文；搬进产品按重写算，只沿用版式。
- `nbook.bots` 现在没有浏览器入口。头像在 `bots/builtin/lyra/avatar.webp`；小猫形态是 `ui/brand/NeuroBookMood.vue`。

## 与 t06 决定的关系

- 等用户的期限（`expired`、`expired-run`）不做（t06 决定 4），t15 里“过期的说法与占位”随之不做。
- 主对话只读解除没有推送（t06 设计审查第二轮第 6 条），待定。
