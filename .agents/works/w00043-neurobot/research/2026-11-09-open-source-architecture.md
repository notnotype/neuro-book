# NeuroBot 外部调研：开源 bot 的技术架构

- 调研日期：2026-11-09
- 范围：只写事实，不写推荐。
- 调研问题：
  1. OpenClaw 的 gateway、nodes、channels、会话路由、多 agent、压缩、记忆、定时、安全、插件、QQ 与 B 站支持。
  2. 开发者所说的“OpenBOT”指哪个开源项目，及其架构。
  3. 记忆整理（“做梦”）的开源参照：Letta 的 sleep-time 及其它。
  4. QQ 机器人接入现状：OneBot、NapCat、LLOneBot、官方开放平台、Koishi 适配器架构。
- 方法：浅克隆各仓库到 `/tmp/nbot-research/` 读原文，GitHub 元数据用 `gh api` 查。Koishi 与 cordis 的关系见已有调研 `docs/research/cordis-plugin-kernel.md`，本文不重复。

## 证据等级与版本

| 标记 | 含义 |
|---|---|
| 源码 | 读过仓库里的源码原文，给出路径 |
| 官方文档 | 读过该仓库自带的 docs 或 README 原文（克隆在本地） |
| 检索摘要 | 经网络检索或网页抓取小模型摘要得到，没读原文，可信度较低 |

文中未标记的段落沿用所在小节标题的等级。

| 对象 | 版本 | 取得方式 |
|---|---|---|
| openclaw/openclaw | 提交 `93f9678855c9`（2026-11-09），package.json 版本 `2026.11.2`；star 394253，创建于 2025-11-24，MIT，TypeScript | 浅克隆，读 docs 与 src |
| CopilotKit/OpenBot | 提交 `adb868199188`（2026-11-09）；star 10565，创建于 2026-08-17，MIT（应用模板） | 浅克隆 |
| nightly-labs/openbot | 提交 `bb287ece1dd2`（2026-11-09）；star 6698，创建于 2026-08-12，PolyForm Noncommercial | 浅克隆，只读 README |
| HKUDS/nanobot | 提交 `5c72ced2feb3`（2026-11-09），版本 `0.4.1`；star 49975，创建于 2026-02-01，MIT，Python | 浅克隆 |
| letta-ai/letta | 主分支（提交 `8816d3a85168`）只剩说明，源码迁到 `letta-ai/letta-code`（star 3807，提交 `17838a76cd88`）；sleeptime 源码读自 `archive` 分支（提交 `56ba9c255526`；仓库 star 25396） | `gh api` 读单个文件 |
| koishijs/koishi | 提交 `97d5c395750c`，core 4.18.11，依赖 `cordis ^3.18.1`、`@satorijs/core ^4.6.0` | 浅克隆 |
| satorijs/satori | 提交 `db22bb3c22f8` | 浅克隆 |
| koishijs/koishi-plugin-adapter-onebot | 提交 `4109eb95c34e`，版本 6.9.5 | 浅克隆 |
| NapNeko/NapCatQQ | 默认分支提交 `98d781d19815`，最新发布 v4.18.42（2026-10-30），star 12421，许可证 GitHub 显示 NOASSERTION | `gh api` |

---

## 1. OpenClaw

OpenClaw 前名 Clawdbot、Moltbot。本次没有在仓库里核对改名史，改名只是开发者给的信息，未验证。

### 1.1 总体与技术栈（官方文档 + 源码）

- README 自述：运行在自己设备上的开源 AI 助手，一个 Gateway 既可当个人用，也可当多人共用（“multiplayer claw”）。包描述为 “Multi-channel AI gateway with extensible messaging integrations”。
- 语言与运行时：TypeScript，Node（`engines: node >=24.16.0 <25 || >=26.1.0`），pnpm 工作区。核心依赖含 `ws`、`express`、`grammy`、`kysely`、`pg`、`typebox`、`croner`、`zod`、`playwright-core`、`@modelcontextprotocol/sdk`、`@earendil-works/pi-tui`（终端 UI）。README 感谢 pi 的作者，agent 核心在 `packages/agent-core`，模型传输在 `src/llm/`（`docs/agent-runtime-architecture.md`）。
- 原生客户端：`apps/` 下有 android、ios、linux、macos；`crates/` 下有 Rust 写的 `openclaw-node-host`、`openclaw-gateway-client`、`openclaw-iroh-*`。
- 规模：`extensions/` 下 194 个目录（模型提供方、渠道、记忆、浏览器等都以插件形式存在），仓库约 66000 个文件。
- 持久化：SQLite（每个 agent 一个库）与可选 PostgreSQL，`package.json` 的 `openclaw.databaseEngines` 为 `["sqlite","postgres"]`。
- 组件关系（`docs/concepts/architecture.md`）：一个常驻 Gateway 守护进程持有所有消息渠道连接；控制面客户端（macOS 应用、CLI、Web UI、TUI、自动化）与 nodes（手机、电脑）都用 WebSocket 连 Gateway。每台主机一个 Gateway，因为 WhatsApp 会话只能开一个。

### 1.2 Gateway：进程、协议、鉴权

证据：官方文档 `docs/concepts/architecture.md`、`docs/gateway/protocol/*.md`、`docs/gateway/operator-scopes.md`。

- 进程：单个长驻 Node 进程，默认绑定 `127.0.0.1:18789`，由 launchd 或 systemd 托管。同一端口还提供 HTTP（Control UI 静态页、hosted canvas `/__openclaw__/canvas/`、A2A、OpenAI 兼容 HTTP、工具调用 HTTP 等）。
- 协议：WebSocket，文本帧，JSON。
  - 首帧必须是 `connect` 请求，否则硬关闭。连接前帧上限 64 KiB；握手后的上限由 `hello-ok.policy.maxPayload` 给出（示例 25 MiB）。
  - 请求 `{type:"req", id, method, params}`，响应 `{type:"res", id, ok, payload|error}`，事件 `{type:"event", event, payload, seq?, stateVersion?}`。事件不重放，客户端发现间隙要自行刷新。
  - 有副作用的方法（`send`、`agent`）要求幂等键，服务端有短期去重缓存。
  - `agent` 调用先返回 ack（`runId`、`status:"accepted"`），过程以 `agent` 事件流式推送，最后再返回终态。
  - 协议用 TypeBox 定义（`packages/gateway-protocol/src/schema.ts`），生成 JSON Schema，再生成 Swift 模型；发布了 npm 包 `@openclaw/gateway-protocol` 与 `@openclaw/gateway-client`（含浏览器入口）。当前协议版本号 4。
  - 方法族：状态与身份、模型与用量、渠道与登录、插件管理、消息与日志、运维终端、Talk/TTS、配置与更新、agent 与 workspace、会话控制、设备配对与令牌、节点配对与调用、审批、cron、技能与工具等（`docs/gateway/protocol/rpc-methods.md`）。
  - 事件族：`agent`、`chat`、`presence`、`health`、`heartbeat`、`cron`、`tick`、`shutdown` 等。
  - 协议层另外有一个封闭的 worker 角色（`/__openclaw__/worker`），只允许 `worker.heartbeat`、`worker.transcript.commit` 等五个方法，用于把会话托管到远端节点。
- 握手与角色：服务端先发 `connect.challenge`（带 nonce）。客户端回 `connect`，带 `role`（`operator` 或 `node`）、`scopes`、`caps`、`commands`、`permissions`、`auth`、`device`（设备公钥与对 nonce 的签名）。服务端回 `hello-ok`（含协议版本、可用方法与事件列表、快照、策略、实际授予的角色与 scopes，可能带 `deviceToken`）。
- 鉴权方式：
  - 共享密钥：token 或 password，由 `gateway.auth.mode` 选择。
  - 身份型：Tailscale Serve（`allowTailscale`）、非回环的 `trusted-proxy`（反向代理注入身份头）。
  - 设备配对后发放设备令牌（绑定设备、角色、授予的 scopes），可轮换与撤销。
  - `mode: "none"` 仅限私有入口。
  - 移动端扫码或设置码走 bootstrap token，换回节点令牌加一个范围受限的操作员令牌。
  - 本机回环的后端客户端（`client.mode: "backend"`）用共享密钥可免设备身份，用于内部控制面调用。
  - 签名载荷 v3 绑定 `platform` 与 `deviceFamily`，网关固定已配对设备的元数据，元数据变化需要重新配对。
- 操作员 scopes：`operator.read`、`sessions.read`、`sessions.write`、`write`、`cron`、`admin`、`pairing`、`approvals`、`questions`、`talk`、`talk.secrets`。文档明确说这些是“同一可信域内的护栏，不是多租户隔离”。
- 限流：未认证连接每个客户端 IP 默认最多 128 个并发（`docs/gateway/protocol/transport.md`，官方文档）。
- 重启恢复：优雅停止时给每个运行中的根会话写一个小标记；启动后向这些会话各发一条普通的系统输入，要求 agent 先检查文件、进程、子代理和外部动作再继续。崩溃（无标记）时用已持久化的未终态运行标识恢复（`docs/concepts/session.md`）。

### 1.3 Nodes / devices：设备接入与能力

证据：官方文档 `docs/nodes/*.md`、`docs/gateway/pairing.md`、`docs/gateway/protocol/handshake.md`。

- 定位：node 是“外设”，不是网关。node 不运行网关服务，渠道消息只落到网关。node 用同一个 WebSocket 连网关，声明 `role: "node"`，并在 `connect.commands` 里声明自己支持的命令，通过 `node.invoke` 被调用。
- 形态：macOS 菜单栏应用（可同时作为 node）、iOS、watchOS（直连 Apple Watch 用已签名的 HTTPS 轮询，因 watchOS 限制通用网络）、Android、无头 node host（`openclaw node run`，Linux/macOS/Windows，另有 Rust 实现）。无头 node 可经 SSH 隧道接入回环绑定的网关。
- 配对两步（`docs/nodes/pairing-and-status.md`）：
  1. 设备配对：node 在 `connect` 里出示签名的设备身份，网关生成设备配对请求（`openclaw devices list/approve`）。待处理请求在设备最后一次重试后 5 分钟过期；重试时若鉴权信息变化，旧请求被取代。
  2. 命令面配对：批准后 node 重连，产生单独的“命令面”请求（`openclaw nodes pending/approve`）。设备批准本身不授予任何命令。批准所需 scope 随请求声明的命令而定：无命令需 `operator.pairing`；普通命令加 `operator.write`；`system.run` 系列加 `operator.admin`。
  - 例外：SSH 验证（网关通过 SSH 读回设备公钥并要求完全匹配）与管理员生成的设置码可自动批准首个命令面；`gateway.nodes.pairing.autoApproveCidrs`（默认关闭）只批准首次 node 设备，不批准命令面。
  - 回环直连可自动批准设备；tailnet 与局域网仍需显式批准。
- 命令的三道门（`docs/nodes/command-policy.md`）：node 必须声明该命令；命令必须在该设备记录里已批准的命令面内；网关按平台与批准派生的允许列表必须包含它。之后还有 node 本机的 exec 批准与操作系统权限。
- 各平台默认允许的命令（节选）：
  - iOS：`camera.list`、`location.get`、`device.info/status`、`contacts.search`、`calendar.events`、`reminders.list`、`photos.latest`、`motion.*`、`system.notify`。
  - Android：另含 `notifications.list/actions`、`device.permissions/health/apps`、`callLog.search`、`mobile.ui.observe/act`（仅在开启无障碍控制时才声明）。
  - macOS：`camera.list`、`location.get`、`device.*`、`computer.act` 等；Canvas 插件另加 `canvas.present/hide/navigate`。
  - Windows 与 Linux：`system.notify`、`computer.act` 等。
  - 桌面主机命令（`system.run`、`system.run.prepare`、`system.which`、`browser.proxy`、`mcp.tools.call.v1`、`screen.snapshot`、`desktop.stream`）不在静态默认表里，需批准声明了它们的配对请求后才可用。
- 危险或涉隐私的命令（`camera.snap`、`camera.clip`、`camera.ptz.control`、`screen.record`、`contacts.add`、`calendar.add`、`reminders.add`、`health.summary`、`sms.send`、`sms.search`）要在 `gateway.nodes.commands.allow` 里一次性持久启用；`deny` 优先于一切。
- 执行路由：`tools.exec.host: "node"` 把 agent 的 exec 路由到已配对 node，可用 `tools.exec.node` 指定某台，也可按 agent 覆盖。
- node 还能发布自己本机的 MCP 服务、skills 和本地模型推理（`docs/nodes/mcp-and-skills.md`，仅读到目录摘要）；还可在 node 上托管 OpenClaw 会话（`docs/nodes/session-hosting.md`，仅读到目录摘要）。
- 在线状态：node 每 60 秒上报 CPU、负载、内存、磁盘；网关把最近活跃的 Mac 作为“活跃电脑”路由 node 告警。
- 发现：局域网用 Bonjour 插件（`extensions/bonjour`），文档还有 Tailscale 与稳定 HTTPS URL 的页面。

### 1.4 Channels：适配器接口与入站路由

证据：官方文档 `docs/channels/channel-routing.md`、`docs/concepts/session.md`、`docs/plugins/sdk-channel-plugins.md`；源码 `src/channels/plugins/types.plugin.ts`、`src/routing/session-key.ts`、`src/routing/resolve-route.ts`。

- 适配器形态：渠道是插件（`api.registerChannel(...)`）。`ChannelPlugin` 类型（`types.plugin.ts`）的字段包括：`config`（账号解析）、`configSchema`、`pairing`、`security`、`groups`、`mentions`、`outbound`、`status`、`gateway`（`startAccount` / `stopAccount`，由网关为每个账号启动长连接）、`auth`、`identityLink`、`approvalCapability`、`commands`、`lifecycle`、`allowlist`、`doctor`、`bindings`、`conversationBindings`、`streaming`、`threading`、`message`、`messaging`、`agentPrompt`、`directory`、`resolver`、`actions`、`heartbeat`、`agentTools`。
- 职责切分（文档）：渠道插件不实现发送、编辑、回应工具，核心提供统一的 `message` 工具；插件负责账号配置、DM 安全与配对、会话语法（平台会话 id 映射到基础会话、线程 id）、出站发送（文本、媒体、投票）、线程规则、格式提示、可选的“正在输入”信号。核心负责共享 `message` 工具、提示词装配、外层会话键形状、`:thread:` 记账、派发，以及配置的多 agent 群线程的参与者选择、续轮与回合预算。
- 出站能力矩阵：`ChannelPresentationCapabilities` 声明渠道是否支持按钮、选择菜单、表格等，以及文本长度上限与 Markdown 方言，核心据此降级。
- 入站持久化：支持“持久入口”的渠道（Discord、Telegram、QQ 官方机器人）先把原始事件落盘再推进恢复序号，重启后待处理回合保留且按会话串行；用服务商事件 id 去重，但从队列到 agent 的交接仍是至少一次（`docs/channels/qqbot.md`，`docs/plugins/sdk-channel-plugins/durable-ingress.md`）。
- 路由规则（`channel-routing.md`，与 `resolve-route.ts` 的 tier 名称一致）：一条入站消息只选一个 agent，按以下顺序取第一个命中的 binding：
  1. 精确 peer（`peer.kind` + `peer.id`）；
  2. 父 peer（线程继承）；
  3. peer 通配；
  4. Discord guild 加角色；
  5. Discord guild；
  6. Slack team；
  7. 渠道账号（`accountId`）；
  8. 渠道通配（`accountId:"*"`）；
  9. 兜底所有者：调用方给的、或唯一配置的 agent、或遗留所有者。多 agent 且无所有者时必须有匹配 binding，不会取名册第一个。
  - 同一档内按配置顺序取第一个；一条 binding 写了多个匹配字段时是与关系；省略 `accountId` 只匹配默认账号。
- 会话键（源码 `buildAgentPeerSessionKey`）：
  - 私信（`direct`）按 `session.dmScope`：
    - `main`（默认）：`agent:<agentId>:main`，所有渠道的私信汇入同一个“主会话”；
    - `per-peer`：`agent:<id>:direct:<peer>`；
    - `per-channel-peer`：`agent:<id>:<channel>:direct:<peer>`；
    - `per-account-channel-peer`：`agent:<id>:<channel>:<account>:direct:<peer>`。
    - `session.identityLinks` 可把同一个人在不同渠道的身份映射成一个 peer id。即便私信汇入主会话，沙箱与工具策略仍用按账号派生的私信运行时键，外部私信不当作本地主会话运行。
  - 群聊与频道：默认 `groupScope: "per-group"`，键为 `agent:<id>:<channel>:group:<id>` 或 `...:channel:<id>`；`groupScope: "main"` 把非私信也汇入主会话；binding 上的 `session.groupScope` 覆盖全局。
  - 线程：Slack、Discord 线程在键后加 `:thread:<id>`；Telegram 论坛话题嵌入 `:topic:<id>`。
  - 其它：子代理 `agent:<id>:subagent:<uuid>`；cron 每次运行新会话；webhook 每个 hook 独立。
- 回复路由：回复一律回到消息来源渠道，模型不选渠道；会话记录 `lastRoute`；只有一个 `allowFrom` 条目时，非所有者的私信不会改写主会话的 `lastRoute`。
- 群聊与 @提及（`docs/channels/groups.md`）：
  - 默认 `groupPolicy: "allowlist"`，群和群内发送者都要在白名单；默认要求 @提及（`requireMention`）。
  - 流程：群策略禁用则丢弃；不在白名单则丢弃；需要提及但没提及，则“仅存为上下文”；提及、回复、命令、私信才是用户请求。
  - 可选“旁听室事件”（`unmentionedInbound: "room_event"` 加 `visibleReplies: "message_tool"`）：没提及的群消息作为静默上下文处理，agent 可更新记忆和会话状态，只有显式调用 `message` 工具才会在群里发言（`docs/channels/ambient-room-events.md`；目前 Discord、Slack、Telegram 支持）。
  - 主会话还会把各群的活动合并成紧凑通知，在下次运行或下次定时检查时让 agent 看到（`docs/concepts/main-session.md`）。
- 队列（`docs/concepts/queue.md`）：每个会话串行，全局 `main` 车道并发有上限；会话进行中收到新消息的默认模式是 `steer`（注入到正在运行的 agent，包括工具执行期间），另有 `followup`、`collect`、`interrupt`；默认 500ms 去抖、队列上限 20、溢出 `summarize`。
- 渠道清单（`docs/channels/index.md`）：WhatsApp（Baileys）、Telegram（grammY）、Slack、Discord、Signal、iMessage、Google Chat、Matrix、Teams、Mattermost、LINE、IRC、Nostr、Twitch、Feishu、QQ Bot（官方 Open Platform，腾讯自己的插件 `@tencent-connect/openclaw-qqbot`）、WeChat（外部插件 openclaw-weixin）、WeCom（外部插件）、Yuanbao（外部插件）等；另有 WebChat（内部）与 A2A。

### 1.5 多 agent 与子代理

证据：官方文档 `docs/concepts/multi-agent.md`、`docs/concepts/session-tool.md`、`docs/tools/subagents/*.md`、`docs/channels/broadcast-groups.md`、`docs/channels/a2a.md`、`docs/channels/bot-loop-protection.md`。

- 一个 Gateway 进程可跑多个相互隔离的 agent。每个 agent 有自己的 workspace（`AGENTS.md`、`SOUL.md`、`USER.md` 等）、`agentDir`（认证、模型注册表）、会话库（`<agentDir>/openclaw-agent.sqlite`）。路径示例：`~/.openclaw/agents/<agentId>/agent/openclaw-agent.sqlite`。不配置时只有一个 `main` agent。
- 创建 agent：`openclaw agents add`，可 `--bind <channel[:accountId]>`。agent 也可通过自己的工具请求创建别的 agent，需操作员批准；记录创建者（`operator` / `agent` / `template`）。
- 团队预设：`openclaw agents team create` 创建 coordinator、researcher、writer、reviewer；coordinator 的 `subagents.allowAgents` 列出可派发对象，`delegationMode: "prefer"` 只是提示词引导，不是调度器。
- agent 间通信：
  - 会话工具：`sessions_list`、`sessions_history`、`sessions_search`、`sessions_send`（在同一网关上运行另一个会话并可等待）、`sessions_create`、`sessions_spawn`、`sessions_yield`、`subagents`、`session_status`。外部会话地址用 `conversations_list/send/turn`。
  - 访问控制：`tools.sessions.visibility` 默认 `all`，`tools.agentToAgent.enabled` 默认 `true`；可用 `allow` 限定 agent 对；也可按 agent 配“只发送”的 `agentToAgent.send` 列表。
  - 跨渠道的 A2A：`channels.a2a` 实现 Linux Foundation 的 A2A 1.0 JSON-RPC 绑定（`/.well-known/agent-card.json`、`/a2a/v1`，每个对端一个 bearer token）。
- 群里的多个 agent（实验性）：顶层 `broadcast` 配置，键为 `"<channel>:<peerId>"`，值为 agent 列表或 `{agents, mentionGating, maxRounds, maxTurns}`。每个参与 agent 在该房间有自己的会话，被提及的 agent 可参与，允许有限轮次的后续回复（`maxTurns` 限制参与者运行总数）。旧的 WhatsApp 数组形态保留，是对所有列出的 agent 单轮并行。
- 机器人之间的环路保护：核心的入站回复运行器对一对 bot 身份做滑动窗口限流，默认 60 秒内最多 20 个事件，超限后冷却 60 秒。
- 子代理（`sessions_spawn`）：
  - 从已有 agent 运行派生后台运行，键 `agent:<agentId>:subagent:<uuid>`，默认隐藏；默认把结果“announce”回请求者。
  - 嵌套深度默认最大 5（`maxSpawnDepth`，范围 1 到 5），每个会话最多 5 个活跃子代理（`maxChildrenPerAgent`），并发 8（`maxConcurrent`），可设 `runTimeoutSeconds`。
  - 结果逐级上报：后代只向直接父级 announce，父级汇总后再向上。
  - 默认不给子代理会话与消息工具；`context: "fork"` 可把当前对话记录带给子代理；可给子代理单独设更便宜的模型。
  - `visible: true` 的子会话是可交互的、会出现在会话树里的普通会话。
  - 重启后：运行中的子代理静默停止，只有根请求者收到一次恢复输入，可检查结果、发新指令或重新派发。
  - 线程绑定子代理会话：把一个渠道线程绑到子代理（Discord/Slack 等，`tools/subagents/thread-bound-sessions`，仅读到索引）。
- 主会话是 agent 的“根”：心跳唤醒它，后台工作回报给它，新建会话通知排队给它。

### 1.6 会话与上下文、压缩

证据：官方文档 `docs/concepts/session.md`、`docs/concepts/compaction.md`、`docs/concepts/session-pruning.md`、`docs/concepts/main-session.md`。

- 存储：每个 agent 一个 SQLite 库（会话行与转录都在里面；旧版是 `sessions.json` 加转录 JSONL，需要 `openclaw doctor --fix` 导入，网关启动时遇到旧存储会拒绝就绪）。网关拥有会话状态，所有 UI 客户端向网关查询；Control UI、TUI、移动端、编码 harness 都可挂到同一个会话上。
- 会话生命周期：默认不自动重置（`mode: "none"`），靠压缩控制上下文；可选 `daily`（本地某小时）与 `idle`（`idleMinutes`），可按类型（direct、group、thread）和渠道覆盖。心跳、cron、exec 等系统事件不延长空闲新鲜度（用 `lastInteractionAt`）。`/new`、`/reset` 手动重置。`session.maintenance` 有裁剪（默认 30 天、5000 条）、归档、可选冷存储。
- 用户感受：用户可以不管会话——默认私信全部汇入一个滚动的主会话，由压缩维持；Control UI 另有 Threads、Groups、Coding 分类，可手动新建会话。
- 自动压缩触发（`compaction.md`）：
  - 默认开启。内置客户端侧压缩在“上下文窗口的 75%”与“窗口减去压缩预留（默认 20000 token）”两者中较小者处开始维护，例如 100 万窗口在 75 万处开始。
  - 模型返回上下文溢出错误时，压缩后重试。
  - 工具循环里用已完成的服务商用量在下一次请求前触发。
  - 可选的“活动转录字节上限”触发本地压缩；可选的 `midTurnPrecheck`（默认关）。
  - ChatGPT 原生登录路径在已知或预测占用达到“预留基准预算与窗口的 90%”中较小者时用服务端 V2 压缩；直连 Anthropic API key 路径可让服务端在请求内压缩，OpenClaw 重放返回的摘要。
- 压缩方式：一次模型请求总结较早历史，摘要存回转录，近期消息保留；保持工具调用与结果成对；摘要输入上限 160000 字符（约 4 万 token），并按“最新消息、较早的用户消息、最旧消息、均匀抽样”的顺序分配；每次压缩保留一份当前人类请求的有界副本；全部历史仍在磁盘上。摘要超时会不带摘要提交压缩以免阻塞回合。可用 `agents.defaults.compaction.model` 指定别的摘要模型，也可用插件“压缩提供方”替换。
- 压缩前记忆刷新（memory flush）：压缩前可跑一个静默回合，让 agent 把持久事实写进记忆文件；可选，失败不影响回复。持久会话里这类可选维护要等回复发送完毕、前台所有者关闭后才跑，新消息会取消它。
- 上下文引擎可插拔：`plugins.slots.contextEngine`，内置 `legacy`，可装第三方（如 `@martian-engineering/lossless-claw`）（`docs/concepts/context-engine.md`）。
- 空闲压缩/按缓存过期压缩：
  - 在 OpenClaw 文档范围内没搜到“空闲一段时间后自动压缩整段对话”的机制（grep “idle” 与 “compact” 的组合只命中重置策略和字节阈值）。
  - 有的是 **缓存 TTL 工具结果裁剪**（`agents.defaults.contextPruning.mode: "cache-ttl"`）：等服务商提示词缓存 TTL 过期（未设时 5 分钟，Anthropic 插件种子值 1 小时），且上下文占用超过约 30% 才修剪；先对超过 4000 字符的工具结果保留首尾各 1500 字符，占用仍达约 50% 且可修剪内容达 5 万字符时整条清除为占位符。只作用于工具结果，不改写对话文本，投影记录在转录里的隐藏 `openclaw.cache-ttl` 标记，重启可恢复。直连 Anthropic API key 时改用 Anthropic 服务端 `clear_tool_uses`（触发为 `max(5万, 窗口30%)` 输入 token，保留最近 3 次工具使用）。
- 跨会话回忆：`memory.search.rememberAcrossConversations` 可在同一 agent 的其它私人会话里检索上下文；个人默认配置（`dmScope=main`）下默认开启，群与频道在默认分组下互不进入对方的私人回忆来源。
- 无痕会话：Control UI 可建只存在于内存的会话，24 小时或网关重启即销毁。

### 1.7 记忆

证据：官方文档 `docs/concepts/memory.md`、`memory-architecture.md`、`memory-search.md`、`dreaming.md`、`active-memory.md`、`user-model.md`。

- 原则（`memory-architecture.md`）：没有隐藏状态，模型只记得写进 agent workspace 文件的内容；写入是难点，所以把整理挪出回复路径；写路径是安全边界（用来源标记而不是事后检测坏记忆）；评分、阈值、资格用固定代码规则，语言模型只在界限内做判断；记忆失败不阻塞回复。
- 分层：
  - 指令层：`AGENTS.md` 等，仅人写，每次会话开头注入；
  - 精选核心：`MEMORY.md`、`USER.md`，由 dreaming 整理或用户直接要求写入，会话开头按来源资格注入并受预算限制，超预算时磁盘文件完整、注入副本截断；
  - 情节层：`memory/YYYY-MM-DD.md` 日记与会话转录，按需检索，不在每次会话开头注入；`/new` 后会重注入最近的日记；
  - 前瞻层：standing intents（SQLite）与 cron 任务，仅在触发时注入；
  - 审阅层：`DREAMS.md` 和 dreaming 报告，仅供人读。
- 检索（`memory-search.md`）：`memory_search` 与 `memory_get` 工具；把 Markdown 分块，用嵌入向量、关键词或混合检索；内置索引支持 SQLite 与 PostgreSQL（pgvector 等）；嵌入提供方可选 OpenAI、Gemini、Voyage、Mistral、Bedrock、本地 llama.cpp、Ollama、LM Studio 等；也有 LanceDB 记忆插件（`extensions/memory-lancedb`）与 Memory Wiki 插件（`extensions/memory-wiki`）。
- Active Memory：对话类会话的深度回忆通道；默认 `escalate` 模式只在消息在问过去、且基于规则的记忆通道没找到强触发时，才运行一个阻塞的回忆子代理。
- 离线整理 “Dreaming”（默认开启，`memory-core`）：
  - 每次扫描依序跑三个阶段：浅睡（整理并暂存最近的短期材料，不写 `MEMORY.md`）、REM（反思主题，不写 `MEMORY.md`）、深睡（加权打分、阈值门（`minScore`、`minRecallCount`、`minUniqueQueries` 同时通过）后晋升，唯一写 `MEMORY.md` 的阶段）。
  - 深睡把通过门限的候选交给一个无工具的补全，由模型针对当前 `MEMORY.md` 选择新增、合并、取代，返回的是操作决定而非整段新文本；写入前校验：保留旧条目的损失比例上限（`maxPriorEntryLossFraction` 默认 0.25）、必须带每个候选的来源引用 `Source: path#Lx-Ly`、不超 `MEMORY.md` 注入预算、结构可解析；不通过则回退到旧的仅追加晋升。
  - 写前把旧 `MEMORY.md` 存入 SQLite 插件状态以便审阅与回滚；`DREAMS.md` 收到新增、合并、取代的计数与摘要。
  - 候选带标签 `<!-- trigger: ... -->` 与 `<!-- importance: N -->`（1 到 10）。
  - 来源污染门：候选来源为 `untrusted` 或 `system` 的在构建合并提示词前被结构性剔除；只有交互式会话的转录可进入语料，cron、心跳、子代理、未知会话不进。
  - 调度：作为一个自动管理的 cron 任务，默认 `0 3 * * *`（每天凌晨 3 点）；可设 `dreaming.model`；用后台优先级的子代理队列，受 `subagents.maxConcurrent` 限制。
  - Dream Diary：每次扫描生成一条叙事日记写入 `DREAMS.md`。
- 导入：Control UI 可导入 Codex、Claude Code、Hermes 的 Markdown 记忆。

### 1.8 定时、心跳、主动消息

证据：官方文档 `docs/automation/cron-jobs.md`、`docs/gateway/heartbeat.md`、`docs/automation/standing-orders.md`、`docs/architecture` 内的调度一节。

- 内置调度器（“Automations”，CLI `openclaw automations`，`cron` 为别名）：网关内核有一个 `GatewayScheduler`，持久化任务；唤醒后按任务配置运行；睡眠后的迟到唤醒合并错过的周期；任务产出可投递到聊天渠道、webhook 或不投递。调度类型含单次时间、间隔、cron 表达式、条件监视、流来源、动态节奏；载荷含 agent 回合、系统事件、命令、脚本；执行风格含主会话、当前会话、隔离、自定义会话；cron 运行的会话默认全新。
- 心跳：旧的心跳配置已迁成普通 automation 任务（`gateway/heartbeat.md` 是迁移说明）。显式设置会为“环境所有者”agent 建一个启用的 “Proactive check” 任务，默认每 30 分钟，使用 agent 的主会话，等空闲再跑，投递到解析出的所有者私信。任务带 scratch（草稿清单），空清单则跳过。输出带 `HEARTBEAT_OK` 或 `NO_REPLY` 表示静默。
- 常驻命令（standing orders）：在 `AGENTS.md` 里写程序、触发条件、审批门、升级规则，每次会话自动注入，配合 cron 做定时执行。
- 另有 Gmail PubSub、webhook、mcp-events、IMAP 触发（`docs/automation/`）。
- 主动发送：agent 用统一的 `message` 工具可向任意渠道会话发消息（默认可跨会话与跨渠道，可用配置限制）；`suggest_task` 只生成建议卡片，不会自行开工。

### 1.9 安全

证据：官方文档 `docs/gateway/security/*.md`、`docs/channels/pairing.md`、`docs/gateway/sandboxing.md`。

- 信任模型：一个网关一个信任边界（单一操作员或互相信任的团队）；不是对抗性多租户边界；对抗性用户要分开网关、操作系统用户或主机。`sessionKey` 是路由选择器，不是授权令牌。
- 私信配对（`channels/pairing.md`）：DM 策略 `pairing` 下，陌生发送者收到一个短码，消息不被处理，直到所有者批准。码 8 位大写且去掉易混字符，1 小时过期，每个渠道账号最多 3 个待处理请求；批准命令 `openclaw pairing approve <channel> <code>`，也可在 Control UI 批准；批准只授予私信访问，不授予群访问。策略还有 `allowlist`、`open`（需白名单含 `*`）、`disabled`。命令所有者（`commands.ownerAllowFrom`）与聊天访问分开。可复用的发送者组 `accessGroups`。
- 群：默认白名单加提及门。
- 提示词注入（`gateway/security/prompt-injection.md`）：文档承认不能靠检测消除；措施是模型选择、锁紧私信、把链接与附件当敌对、工具策略、exec 审批、沙箱、只读或无工具的“读者 agent”先摘要不可信内容再交给主 agent；外部不可信内容（OpenResponses 的 `input_file` 等）被边界标记 `<<<EXTERNAL_UNTRUSTED_CONTENT ...>>>` 包裹；对自托管模型剥离聊天模板特殊 token；出站回复在最终投递边界剥离泄漏的 `<tool_call>`、`<system-reminder>` 等内部标记。
- 沙箱（`gateway/sandboxing.md`）：默认关闭；开启后网关进程始终在主机上，只有工具执行进沙箱；后端有 Docker、Podman、SSH、OpenShell、Crabbox；范围按会话、agent 等；`tools.elevated` 是逃生口。文档称“不是完美的安全边界”。
- 工具权限层次：工具允许/拒绝策略先于沙箱规则；exec 批准（allowlist 加 ask）；默认信任的单操作员配置下主机 exec 不提示（文档称这是有意的 UX）。
- 审计：`openclaw security audit`，另有元数据审计账本。
- 其它：记忆来源标记与隔离（`memory-provenance`），不受信来源的 `MEMORY.md` 会被排除并在 `openclaw doctor` 里列出。

### 1.10 插件与技能

证据：官方文档 `docs/plugins/architecture.md`、`docs/tools/skills.md`；源码目录。

- 插件：原生插件通过 `openclaw/plugin-sdk/*` 子路径入口注册能力：文本推理提供方、CLI 推理后端、嵌入、语音、实时转写与语音、媒体理解、图像/音乐/视频生成、网页抓取与搜索、渠道、网关发现、迁移等；也可以只注册钩子、工具、命令、后台服务、路由。有 manifest（`docs/plugins/manifest.md`）、依赖解析、兼容性声明、权限请求。插件通过 ClawHub 分发（`openclaw plugins install <npm 包>`）。
- 技能：目录里放 `SKILL.md`（YAML frontmatter 加 Markdown），按“workspace、项目 `.agents/skills`、个人、托管目录、Workshop、内置、额外目录”优先级加载，按环境、配置、二进制是否存在做门控，有每个 agent 的允许列表。Skill Workshop 是 agent 自己学出来的技能（有变更历史与撤销）。
- MCP：内置 MCP 客户端与服务端支持；node 可托管 MCP。
- 钩子：`docs/automation/hooks.md`、`docs/plugins/hooks.md`。

### 1.11 中国平台

- QQ：有官方 QQ Bot 渠道（腾讯 Connect 团队的 `@tencent-connect/openclaw-qqbot`，文档称“official downloadable plugin”），走官方 Open Platform 的 WebSocket 网关；支持 C2C 私聊与群 @提及，富媒体；频道子频道仅文本和远程 URL 图片；不支持表情回应和线程。用 `AppID:AppSecret` 或扫码绑定（`docs/channels/qqbot.md`，官方文档）。
- OneBot / NapCat / LLOneBot：本仓库的文档和渠道目录里没有这些（在整个仓库内 grep `onebot|napcat|llonebot` 只命中一处，`src/channels/plugins/setup-promotion-helpers.ts` 的注释写道“已发布的未声明适配器仍依赖这些键，包括 OneBot（用 `accessToken` 与 `httpUrl`）”，说明存在第三方发布的 OneBot 适配器，本次未查其仓库）。
- B 站（bilibili）：在整个仓库内 grep `bilibili` 无命中，没搜到。
- 其它中国平台：Feishu（官方插件，`extensions/feishu`）、WeChat（外部插件 openclaw-weixin）、WeCom（外部插件）、Yuanbao（外部插件）、`zaloclawbot`、Synology Chat、Nextcloud Talk 等见渠道目录。

---

## 2. “OpenBOT” 指哪个项目

### 2.1 候选与数据（`gh api` 实查，2026-11-09）

| 仓库 | star | 创建 | 语言 | 描述 |
|---|---|---|---|---|
| CopilotKit/OpenBot | 10565 | 2026-08-17 | TypeScript | AI coworkers，每个有自己的计算机（浏览器、文件、工具），每个动作事前决策、事后记录；可接任何 AG-UI agent |
| nightly-labs/openbot | 6698 | 2026-08-12 | TypeScript | 本地优先的桌面工作区，常驻 AI 队友，agent 间协作 |
| meetopenbot/openbot | 347 | 2026-01-29 | TypeScript | “OS for Agents” |
| openbotx/openbotx | 101 | 2026-01-31 | Python | 多 agent 编排平台 |
| regnull/openbot | 42 | 2026-09-13 | Python | 自托管的一队 AI bot，带长期记忆、互相交接工作 |
| HKUDS/nanobot | 49975 | 2026-02-01 | Python | 轻量个人 agent |
| ob-f/OpenBot | 3654 | 2020-07-31 | Swift | 手机当机器人大脑（无关） |

### 2.2 结论

- 按“约 1 万 star、开源、较新（OpenClaw 之后出现）”，最匹配 **CopilotKit/OpenBot**（10565 star，创建于 2026-08-17）。
- nightly-labs/openbot（6698 star，创建于 2026-08-12）是第二候选；它的主题（常驻队友、agent 间消息、任务队列）与 NeuroBot 设想更接近，但 star 数与“约 1 万”差距较大。
- “跟风速成”是开发者的判断，本次没有找到仓库自身证据证明或否定。
- 我没有向开发者核实过具体指哪个，所以这是推断。

### 2.3 CopilotKit/OpenBot 的架构（官方文档 + 源码目录）

- 产品定位：企业用的“AI 同事”工作区，不是个人聊天渠道网关。README：模块化、可自托管；模型自选；可自带 agent（AG-UI 协议）；公司登录、角色、工具权限、审批、审计。
- 组成（`docs/architecture.md`）：
  - `app`（React/Vite，3010）；
  - `server`（Hono API，3001；运行时、鉴权、角色、渠道、策略、审计、凭据、插件）；
  - `agent-computer`（4100，每个 bot 的 Chromium、`/workspace`、浏览器配置与文件工具）；
  - `supervisor`（创建、停止、重置每个 bot 的计算机容器）；
  - PostgreSQL（含 pgvector）；
  - CopilotKit Intelligence（外部，单独授权：持久会话线程、记忆、实时网关、自动学习）；
  - 内置的示例 Bot 与其它 `agent-*` 目录（LangGraph、Mastra、Claude SDK 等）。
- 前端形态：Mac、Windows 桌面应用（内含 Docker 后端），Web、iOS、Android（README 称早期访问），Slack 与 Teams。运行时用 Bun（`bunfig.toml`、`bun.lock`）。
- 运行流：app 打开频道或直连 bot 会话；server 解析登录者与所选 coworker；CopilotKit 运行时把回合经 AG-UI 发给 agent 端点；agent 的每次浏览器、文件、MCP 调用回到 server 授权并审计，才转给计算机。
- 动作治理：server 网关是动作边界——解析目标、评估当前策略（CEL 表达式，deny 先于 allow，策略引擎默认失败即拒绝）、写审计行、通过才调用计算机。每行审计记录 `initiator_kind`（person、deployment、routine、responsibility、memory、handoff），区分“有人在场”和“无人在场”。
- 计算机隔离：一人一容器（可选），或标记 Isolated 的 bot 单独容器；每台计算机有自己的派生令牌（HMAC），出站连接经过过滤代理按 bot 的网络策略放行；可选 gVisor（`COMPUTER_RUNTIME=runsc`）。
- Coworker（持久 bot）：`agents` 表（运行时身份与端点）、`agent_profiles`（名称、职位、角色、所有者、可见性）；常驻角色作为系统消息每次运行都发；可发布为 Team Bot。
- 路由与会话：一个频道是与一个 coworker 的对话，对应一个 Intelligence 线程；消息没指定 bot 时有意图路由器从用户名册里选，选不准则用默认 bot。
- 群与 bot 之间：群会话里有多个 bot；一个 Intelligence 线程只准一个 agent，所以每个 bot 在群里各有一个线程，人看到的是共享转录（`group_messages`，每条回复标注说话者）；bot 用 `@Name` 把对话交接给同伴，走同样的授权、上限和审计（`docs/architecture.md` 的“Coworkers and channels”）。
- 定时：routines（让 bot 在对话里创建 cron 式例行任务，以创建者身份运行，回复发到频道）与 goals/responsibilities；任务进 PostgreSQL 表 `work_items`，用 `select ... for update skip locked` 抢占，租约用数据库时钟；还有“主动巡检（proactive check-ins）”：bot 在后台静默查看用户已连接的应用，多数无输出，只在有事时产出 item，按人每小时最多一次提醒（`server/src/proactive/engine.ts` 头部注释）。
- 记忆：`server/src/memory/` 有本地存储（`personalMemories`、`memorySources` 表）并与 Intelligence 同步，可从已连接应用导入事实；自动学习（`docs/automatic-learning.md`）：从已完成对话收集证据，由 Intelligence 分析并提出 skill（SKILL.md）候选，人在 “Proposed skills” 里批准发布，之后在 bot 运行时注入；个人版有“自动批准”（默认开）与“Learn now”。记忆与学习的服务端核心不在本仓库（Intelligence 单独授权）。
- 上下文压缩：在 `server/src` 里 grep `compaction` 无命中，grep `compact` 只命中 `server/src/responsibilities/signatures.ts` 一处（未核对是否指上下文压缩），没找到压缩实现，上下文管理推测在 AG-UI agent 端或 Intelligence 内，未验证。
- 中国平台：README 与文档里未提及 QQ 等。

### 2.4 nightly-labs/openbot（仅 README，官方文档等级）

- Electron 桌面应用，本地优先；agent 是外部 CLI 会话的封装（Codex App Server、Claude Code、Grok CLI、OpenCode、Gemini、Cursor CLI、Cline、Kimi、Devin、GitHub Copilot CLI、Mistral Vibe、Hermes，经 ACP）。
- 每个 agent 有独立 workspace 与会话；本地 FIFO 队列（可暂停、取消、崩溃安全）；agent 间消息、回复、回应、图片、受管文件传输；共享频道聊天（一个任务所有者、显式委派）；每 agent 上下文监控，长线程在撑满窗口前自动压缩；内置浏览器。
- 以 `danger-full-access` 与 `approvalPolicy: never` 运行（README 警告）；许可证 PolyForm Noncommercial。
- 账号 API 跑在 Cloudflare Workers 与 D1 上。

---

## 3. 记忆整理（“做梦”）的开源参照

### 3.1 Letta（MemGPT）sleep-time compute（源码，旧服务端在 `archive` 分支）

- 机制（`letta/groups/sleeptime_multi_agent_v4.py`）：一个 “sleeptime” 组由一个前台主 agent 加若干后台 sleeptime agent 组成（`ManagerType.sleeptime`）。
  - 主 agent 每完成一轮 `step` 或 `stream`，调用 `run_sleeptime_agents`。
  - 组上有 `sleeptime_agent_frequency`：每 N 轮才触发（轮次计数器取模）；为空则每轮都触发。
  - 触发时为每个 sleeptime agent 创建一个后台 Run，异步执行 `_participant_agent_step`，不阻塞主 agent 的回复。
  - 喂给 sleeptime agent 的是“自上次处理的消息 id 之后到现在”的对话转录，加一段系统提醒：你是后台 agent，不是主 agent，正在审阅已经发生的对话，主要职责是管理记忆块。
  - 它的工具是编辑记忆块：精确编辑加整块重组的 `rethink`，直到记忆块有条理、无冗余、不过时，然后调用 finish；没有有意义的更新则直接 finish（`letta/prompts/system_prompts/sleeptime_v2.py`）。要求写具体日期而不是“今天”“最近”，因为记忆长期保存。
  - 失败只标记该 Run 为 failed，不影响主 agent。
- 来源：`letta-ai/letta` 的 `archive` 分支，文件 `letta/groups/sleeptime_multi_agent_v2.py`、`v3`、`v4.py`、`letta/prompts/system_prompts/sleeptime_v2.py`。另有 `voice_sleeptime_agent.py`、`sleeptime_doc_ingest.py`（文档摄入用）。
- 当前形态（`letta-ai/letta-code`，源码 + README）：主仓库已把活跃源码迁到 letta-code。README 称 “Configure periodic dreaming with `/sleeptime`”，手动命令 `/dream`、`/reflect`。设置里 `ReflectionTrigger` 有三种：`off`、`step-count`（每 N 步）、`compaction-event`（每次压缩事件后）（`src/reflection-settings.ts`）。反思由一个子代理执行（`src/cli/helpers/reflection-prompt.ts`）：读取转录负载（单个会话，或跨多个会话的 manifest），更新记忆目录里的文件（记忆在 MemFS 里，用 git 跟踪，子代理在 `$MEMORY_DIR` 里提交，harness 负责合并，可配 merge 模式 auto 或 explicit）；提示词要求偏向跨会话的持久模式、以最新证据为准解决矛盾、去重、不存一次性任务状态。native Windows 上默认关闭自动反思。

### 3.2 其它

- OpenClaw Dreaming：见 1.7，三阶段（浅睡、REM、深睡）加 cron 每日 3 点，带晋升门、来源污染门、可回滚的重写（官方文档）。
- nanobot（HKUDS）Dream（官方文档 `docs/memory.md` + 源码 `nanobot/agent/autocompact.py`）：
  - 两阶段：Consolidator 在会话变大、空闲超时或 `/compact` 时把被压缩的对话摘要追加到 `memory/history.jsonl`（每行 `{cursor, timestamp, content}`）；Dream 按 cron 在网关运行期间读取 `history.jsonl` 的新条目，加当前 `SOUL.md`、`USER.md`、`memory/MEMORY.md`，一次性外科手术式编辑这三个文件。
  - 每次 Dream 用 `GitStore` 记录版本，有 `/dream-log`、`/dream-restore <sha>`；可用 `prompts/dream.md` 自定义整理指引；`history.jsonl` 在 Dream 处理后按保留目标（默认 1000 条）裁剪，未处理的保留。
  - 空闲压缩：`agents.defaults.idleCompactAfterMinutes` 默认 15，`idleCompactCheckIntervalSeconds` 默认 60；会话空闲超过阈值就总结上下文，下次回来时模型收到摘要加新消息；文档说明“若服务商的提示词缓存保留更久，可调大超时”，设 0 关闭（`docs/configuration.md` 的 Auto Compact）。
- CopilotKit/OpenBot 的 Automatic Learning：从完成的对话里提技能候选，人审批（2.3）。
- Letta 之外的论文依据：OpenClaw 文档引用 LongMemEval（arXiv:2410.10813）作为“写入质量比索引更重要”的依据（官方文档，未读论文）。

---

## 4. QQ 机器人接入现状

### 4.1 三条路线

| 路线 | 是什么 | 个人可用 | 群聊 | 主动发消息 |
|---|---|---|---|---|
| 官方开放平台（q.qq.com，QQ Bot API） | 腾讯官方机器人，WebSocket 事件加 HTTP API，官方 SDK botpy（Python，star 919，最后推送 2024-09） | 个人主体可创建，可用于自己是群主或管理员的群 | 是，但 V2 只投递 @了机器人的群消息 | 有限制，见 4.2 |
| OneBot 协议实现（NapCat、LLOneBot 等） | 在普通 QQ 账号上通过 NTQQ 协议端实现 OneBot；机器人以一个真实 QQ 号的身份出现 | 是，用自己的 QQ 号 | 是，完整群功能（踢人、禁言、群事件等） | 无官方额度限制；账号有被风控的风险（见 4.3） |
| Satori 的 QQ 适配器 | 对接官方 QQ Bot API（频道与群） | 同官方 | 同官方 | 同官方 |

### 4.2 官方开放平台的限制

- 开放平台 wiki 抓取（`https://bot.q.qq.com/wiki/`，**检索摘要**：小模型对网页的摘要，非原文）：
  - 个人主体：个人认证开发者可创建 5 个机器人；企业主体每主体最多 10 个，上限 50。
  - 个人主体暂不支持“公开使用”，群数量上限 500；企业可把所有场景设为公开。老平台已获公开服务批准的个人是例外。
  - 未认证的创建者只能把机器人加到自己是群主或管理员的群。
  - 内部测试号最多 20 个用户账号。
  - 修改服务范围无需审核；企业认证需营业执照、对公账户与小额打款验证。
  - 页面摘要没给单聊规则与主动消息额度。
- 检索（WebSearch，**检索摘要**）：官方 Python SDK 文档页称被动回复有效期 5 分钟；频道里主动推送每天每个频道 20 条、每天可往 2 个子频道推送（一篇帮助文章称 3 个，说法不一）；子频道内每秒最多发 5 条。群聊和单聊的每月主动消息次数没找到；一篇个人博客称官方机器人已关闭主动发送，只能被动回复，该说法与官方文档不一致，未采信。
- 第三方文档的描述（官方文档等级，来自 nanobot 与 OpenClaw 自带文档）：
  - nanobot：官方 `qq` 渠道用 botpy SDK，WebSocket，无需公网 IP，“目前仅支持私聊”；测试需先把自己的 QQ 号加入沙箱成员；正式使用要在机器人控制台提交审核并发布；可用扫码绑定自动保存 AppID 与 AppSecret（`docs/chat-apps.md`）。
  - OpenClaw：官方 QQ Bot 渠道支持 C2C 与群 @提及，频道子频道仅文本与远程 URL 图片，不支持回应与线程（`docs/channels/qqbot.md`）。
- 推断（未验证）：个人在官方平台上能私聊（沙箱成员）并加入自己管理的群，需要 @才收得到群消息，主动消息有额度限制。

### 4.3 OneBot 协议、NapCat、LLOneBot

- OneBot v11：仓库 `botuniverse/onebot-11`（star 721，最后推送 2024-04-27）。目录：`api`、`communication`、`event`、`message`。通信方式四种：HTTP（正向，调 API）、HTTP POST（反向，推事件）、正向 WebSocket、反向 WebSocket；事件字段 `post_type`（message、notice、request、meta_event），消息类型 `private` 与 `group`（本次从 nanobot 的 NapCat 实现里核对，源码）；认证用 access token（HTTP 头 `Authorization: Bearer`）。
- OneBot v12：草案仓库 `botuniverse/onebot`（star 2089，最后提交 2023-03-23），README 注明 12 是最新草案，已正式发布的版本见 onebot.dev。12 主要为统一多平台（目录有 `connect`、`interface`、`specs`）。实现生态仍以 v11 为主：NapCat 配置只有 OneBot 11（`packages/napcat-develop/config/onebot11.json`）；LLOneBot README 写 “OneBot 11, Satori, Milky Server”；Koishi 的 OneBot 适配器是 v11（`OneBot v11 标准 API` 小节）。“Milky”是另一个协议，本次未查。
- NapCatQQ（`NapNeko/NapCatQQ`，star 12421，v4.18.42，2026-10-30，TypeScript）：README：“基于 NTQQ 的现代化 Bot 协议端实现”，致谢 Lagrange 并推荐 AstrBot、MaiBot。网络配置（源码 `packages/napcat-onebot/config/config.ts`）支持五种通道，可同时启用多个：`httpServers`（可附带 WebSocket）、`httpSseServers`、`httpClients`、`websocketServers`、`websocketClients`，另有 `plugins`；每种有 `token`、`messagePostFormat`（默认 `array`）、`reportSelfMessage`、心跳间隔（默认 30 秒）。有 WebUI 配置和 Docker 部署（NapCat-Docker），可快速登录保存账号。项目说明不提供对接和基础问题解答。
- LLOneBot（`LLOneBot/LuckyLilliaBot`，star 3711，GPL-2.0，要求 Node 24 以上）：OneBot 11、Satori、Milky 服务端；参考 LagrangeV2。
- Lagrange.Core（star 3003）是纯 C# 的 NTQQ 协议实现，被 NapCat、LLOneBot 引用。
- 风险（检索缺失，仅从类别推断）：这类方案让真实 QQ 号以非官方客户端登录，属于非官方协议；本次未检索到腾讯对封号的说明，不下结论。
- 现成的 LLM bot 框架已经支持 NapCat：AstrBot（star 46537，自称 OpenClaw 替代品）、MaiBot（star 6940）、nanobot（`napcat` 渠道）、NoneBot2（star 7781）。

### 4.4 nanobot 的 NapCat 渠道（源码参照）

- `nanobot/channels/napcat/runtime.py`：连接 NapCat 的正向 WebSocket（`ws://127.0.0.1:3001`，`Authorization: Bearer <accessToken>`）；启动时用 `get_login_info` 取自己的 QQ 号（用 `echo` 字段关联请求与响应）；入站帧 `post_type == "message"`，`message_type` 为 `group` 或 `private`，会话 `chat_id` 形如 `group:<id>` 或私聊号；消息段遍历，`type == "at"` 且 `qq` 等于自己的号就算被提及；发送用 `send_msg`，参数 `message_type`、`group_id`。
- 群策略 `groupPolicy`：`"mention"`（只回 @与回复）、`"open"`（每条都回）、或 0 到 1 的概率值（被 @或被回复必回，其余按概率回）；可按群 id 覆盖；有 `welcomeNewMembers`（处理 `group_increase` 通知）；`allowFrom` 为 QQ 号白名单（`["*"]` 表示任何人）。
- 这是“bot 在 QQ 群里像群友一样偶尔插话”的一个现成实现样例。

### 4.5 Koishi 的适配器架构（源码）

- Koishi（`koishijs/koishi`，star 6319，MIT，TypeScript，core 4.18.11）：核心包 `packages/core/src` 有 `bot.ts`、`context.ts`、`session.ts`、`middleware.ts`、`command`、`database.ts`、`permission.ts`、`i18n.ts`、`filter.ts`；依赖 `cordis ^3.18.1` 与 `@satorijs/core ^4.6.0`。Koishi 的 `Bot`、`Adapter` 直接取自 `@satorijs/core`（`bot.ts` 第 3 行 `import { Adapter, Bot, Fragment } from '@satorijs/core'`），并通过 `ctx.mixin` 补充 `getGuildMemberMap` 与 `broadcast`。这印证了“Koishi 基于 cordis”的检索说法（cordis 本身见已有调研）。
- 适配器层是 Satori（`satorijs/satori`）：
  - `packages/protocol/src/index.ts` 定义统一的事件（`Event`：`type`、`login`、`selfId`、`platform`、`channel`、`guild`、`member`、`message`、`user` 等）、方法表（`Methods`：`channel.get/list/create/...`、`message.create/update/delete/get/list`，每个对应 `getChannel`、`createMessage` 等 Bot 方法）、`Login`、`Status`（ONLINE、OFFLINE、CONNECT、DISCONNECT、RECONNECT）、WebSocket 的 Opcode；
  - `packages/core/src/bot.ts` 的 `Bot` 抽象类：每个机器人账号一个实例，有 `status`、`connect/disconnect`、`session(event)`、`dispatch(session)`、`createMessage/sendMessage/sendPrivateMessage`、`supports`、`getLogin`；
  - `packages/core/src/adapter.ts`：`Adapter` 与 `WsClientBase`/`WsClient`（带重连：初次最多重试 6 次、间隔 5 秒，断开后每分钟重试）；
  - 内置适配器目录：dingtalk、discord、kook、lark、line、mail、matrix、qq、slack、telegram、wechat-official、wecom、whatsapp、zulip、satori。OneBot 不在这个仓库，是单独的 `koishijs/koishi-plugin-adapter-onebot`（版本 6.9.5，star 52）。
- OneBot 适配器结构（源码）：`OneBotBot extends BaseBot`，构造时按 `config.protocol` 选 `http`（`HttpServer`）、`ws`（`WsClient`，作为客户端连 OneBot 实现，Bearer token）、`ws-reverse`（`WsServer`，借 `@koishijs/plugin-server` 监听路径，默认 `/onebot`）三种传输；`initialize` 里 `getLogin` 加可选的 QQ 频道服务（`QQGuildBot`）；`bot.internal` 与 `session.onebot` 暴露 OneBot v11 原生 API（`sendPrivateMsg`、`sendGroupMsg`、`getForwardMsg`、`setGroupKick` 等）；自带 CQ 码转换（`cqcode.ts`）。
- 配置用 `Schema`（schemastery）声明，WebUI 自动生成表单；`ctx.plugin(adapter, config)` 即启用一个机器人账号。
- 会话模型：事件经 `bot.session(event)` 变成 `Session`，`bot.dispatch(session)` 进入 Koishi 的中间件链与指令系统（`packages/core/src/middleware.ts`、`command/`），Koishi 另有数据库、权限、多语言。这些细节本次只读了入口，没有逐个读。

---

## 5. 未覆盖与已知缺口

- OpenClaw 的 `docs/gateway/protocol/rpc-methods.md` 的完整方法清单、`sdk-channel-inbound.md` 的入站事件字段、`src/auto-reply` 的派发细节本次没逐个读。
- OpenClaw 的 `agent-loop.md`、`queue-steering.md`、`session-controller.md`、`user-model.md`、`standing-intents.md` 只读了目录摘要。
- 没有运行过任何被调研的软件，所有结论来自读文档与源码。
- “OpenBOT”的指向是按 star 数与创建时间的推断；开发者的“跟风速成”没有在仓库里找到佐证。
- QQ 官方平台的主动消息额度没有查到官方原文，只有小模型摘要与检索摘要，且各来源有出入。
- 腾讯对非官方协议端的封号政策本次没有检索。
- Letta 的 sleeptime 在 `archive` 分支中读了 v4 的触发与参与者逻辑，没有读各版本的差异，也没有读 `letta-code` 的触发调度实现（只读了设置类型和提示词）。
- OpenClaw 的 “Milky” 协议、B 站相关第三方项目均未检索。
