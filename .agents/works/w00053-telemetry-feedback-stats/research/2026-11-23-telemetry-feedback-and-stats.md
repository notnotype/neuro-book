# 统计、遥测与非阻塞反馈插件调研（2026-11-23）

本调研梳理 NeuroBook 新规划的两类互补能力——**面向用户的本地统计插件**与**面向产品改进的遥测/非阻塞反馈上报插件**——以及背后的服务端选型（Cloudflare / 重写 `neuro-book-site` / Umami），供后续立项与 Spec 设计使用。

## 1. 需求起点与历史线索核对

### 1.1 历史记录核对

- **此前记住的开源项目**：开发者已确认为 **Umami**（`umami-software/umami`）。
- **在仓库与本机归档中未发现先前已落盘的选型或 Work**，并排除了几类误报：
  - `openpanel` 在历史归档与代码中的大量命中，实际为布局包 API `openPanel` / `openPanelAtEdge`（`packages/nb-workbench-layout`）；
  - `docs/research/memory-engines-mem0-graphiti.md` 第 102 行的 PostHog 指向外部依赖自带遥测（文档要求本地优先产品默认关闭），并非 NeuroBook 自身选型；
  - 2026-10-07 会话归档里的“数据收集”对应智能输入法 RLHF 训练数据；
  - `.agents/works/w00037-official-site/` 当前仅登记官网与配套服务（账号、备份与同步、社区、官方插件市场），`t01-requirements` 仍为 `planned`。

### 1.2 开发者本轮明确的产品目标（2026-11-23）

1. **自动使用统计（匿名分析）**：采集安装数据（版本、平台/架构、渠道等）、使用情况等匿名指标。
2. **Harness 错误与 Agent/用户反馈上报（参照 omp `report_issue` 并强化用户控制）**：
   - Agent 既可在发现工具行为异常/Harness 错误时主动记录，也可帮用户整理其提出的问题或建议；
   - **关键交互红线**：Agent 写入反馈文件/队列时**绝不阻塞**当前 ReAct 循环；写入后**不自动上传**；由用户界面弹出**非阻塞审批入口/窗口**，用户审阅并点击确认后才上传。
3. **用户自用统计插件**：面向用户本人展示使用记录、字数统计、总消耗 Token 等数据，并提供**仪表盘视图**与**贡献点**，允许其它插件向仪表盘贡献指标/卡片。
4. **隐私开关时机**：安装阶段（首次启动）即可选择，默认匿名且勾选，说明用于提供匿名数据以改善产品体验。

## 2. 仓库现有约束与可复用基础（已验证）

| 维度 | 现状与真相源 | 对本设计的约束或复用方式 |
|---|---|---|
| 诊断日志红线 | [`docs/specs/runtime/diagnostics.md`](../../../../docs/specs/runtime/diagnostics.md) | 明确非目标：“不建立遥测平台：不上报远端……不采集用户行为，不因诊断接入网络”。遥测与反馈必须是**独立插件/通道**，禁止复用诊断出口偷偷联网。脱敏策略可复用其敏感字段名与凭据模式口径。 |
| 安装与首次启动界面 | [`w00046 t02-installer`](../../w00046-desktop-release/tasks/t02-installer/README.md) | 桌面端继续使用 Electrobun 2.0.6 原生安装程序（界面写死、无自定义配置项），安装期配置统一落在 **`FirstRunWizard`（首次启动向导）**（当前 4 步：欢迎 → 外观 → 桌面 → 数据位置）。“安装时可选隐私开关”应落在 `FirstRunWizard` 与设置页（npm CLI 用户亦在首次启动/设置页覆盖），不改 Electrobun 原生壳安装包。 |
| 非阻塞通知与审批入口 | [`docs/specs/workbench/notifications.md`](../../../../docs/specs/workbench/notifications.md) | `nbook.workbench/notifications` 已支持右下角非阻塞常驻通知（`sticky`、带 `action`、`detail` 对话框）与通知中心。Agent 写完反馈草稿后，可直接推送带“审阅并上传 / 忽略”动作的非阻塞通知，点开再进审阅弹窗，完全不打断写作或正在跑的 ReAct。 |
| 插件与贡献点机制 | [`docs/specs/runtime/plugin-manifest.md`](../../../../docs/specs/runtime/plugin-manifest.md)、[`docs/specs/agent/contributions.md`](../../../../docs/specs/agent/contributions.md) | 平台原生支持声明式 `contributionPoints`、懒激活事件前缀与 `agent.tools` / `agent.extensions` 贡献点。个人统计插件可按平台规范定义贡献点；反馈能力可经 `agent.tools`（或专用工具/内部地址）暴露给 Agent。 |
| 已有字数数据源 | [`docs/specs/runtime/projects.md`](../../../../docs/specs/runtime/projects.md) | 项目实例已按统一口径计算并缓存 `projects.stats`（总字数、篇数、今天净增、最近编辑），书架直接读缓存而不强开项目。统计插件可直接消费并扩展按日历史，不重复扫描文件。 |
| 已有 Token 与费用数据源 | [`docs/specs/harness/runtime.md`](../../../../docs/specs/harness/runtime.md) 输出 70、[`docs/specs/agent/request-trace.md`](../../../../docs/specs/agent/request-trace.md) | `SessionCore` 与模型请求追踪已记录每次请求的 `input`、`output`、`cacheRead`、`cacheWrite`、`cost`、`unpriced`。统计插件可直接汇总，避免第二套计量口径。 |
| 官网现状 | [`w00037-official-site`](../../w00037-official-site/README.md)、[`Task 128`](../../../tasks/128-neuro-book-site-deployment/README.md) | 现网 `neuro-book-site`（`nbook.notnotype.com`）运行于单台生产 VPS、单实例 SQLite、容器限 768 MiB，处于 owner-only 内测；`w00037` 尚未开工。开发者倾向后续重写 `neuro-book-site`，不背历史包裹。 |

## 3. 参考实现拆解：`oh-my-pi` 的 `report_issue`

对照本机 `oh-my-pi` 仓库中的 `packages/coding-agent/src/tools/report-tool-issue.ts`（已读源码）：

- **触发方式**：系统提示词告知模型，当工具输出与参数描述不一致时，向虚拟设备 `xd://report_issue` 写入纯文本 `<tool>: <concise description>`。
- **不阻塞模型**：工具调用立即返回 `"Noted, thanks!"`，绝不等待用户弹窗或网络请求，也不抛出网络异常影响主循环。
- **身份脱敏**：`redactUserIdentity` 自动把本机 home 路径改写为 `~`，把特定路径/反向域名/`user@host` 中的登录用户名改写为 `<user>`，并在写入与发送前两端都执行长度裁剪与脱敏。
- **队列与坏行隔离**：先落本地 SQLite（`grievances` 表，`pushed = 0`），后台批量 POST 到收集端（默认 `qa.omp.sh`），附带版本、`installId`、`platform`、`arch`、`model`。遇到 `400/413/422` 永久拒收时二分批次定位毒丸行标记 `pushed = -1`，不卡死其余队列。
- **与 NeuroBook 要求的差异**：omp 是首次触发时弹一次全局同意弹窗，同意后后续自动静默上传；NeuroBook 要求**先落本地待审队列、不自动上传、通过非阻塞 UI 让用户逐条（或显式授权后）点击确认再上传**，对写作软件用户更透明可控。

## 4. 关键架构拆分：为何应将「本地统计」与「遥测/反馈」分成两个插件

| 维度 | 个人统计插件（如 `nbook.stats`） | 遥测与反馈插件（如 `nbook.telemetry` / `nbook.feedback`） |
|---|---|---|
| 服务对象 | **用户自己** | **产品开发者** |
| 网络行为 | **100% 本地，零网络请求** | 联网外发（需防刷、重试、离线静默降级） |
| 数据敏感度 | 允许精细到作品名、每日写作字数、会话明细、具体费用 | 严禁出现正文、设定、文件名、本地路径、凭据、作品名；仅白名单匿名字段或用户审阅后的脱敏反馈文本 |
| 开关影响 | 即使彻底关闭遥测、完全断网，仍完整可用 | 随时可在设置中一键关闭或仅留手动反馈 |
| 核心扩展点 | 对外定义统计贡献点（仪表盘卡片/指标数据源），供项目、Agent、第三方插件接入 | 向 Agent 暴露非阻塞反馈写入能力，向首次启动向导与设置页注册隐私开关 |

把两者拆开能直接换来清晰的信任承诺（“统计插件永不联网”）和更低的维护耦合；两者只需保持单向极窄接口（例如用户反馈可选附带环境版本，不读个人写作明细）。

## 5. 服务端方案对比（基于官方一手文档核实）

服务端实际承载**两类不同性质的负载**：
1. **负载 A（匿名使用统计）**：高频轻量事件（安装、启动、功能频次、版本/系统分布、留存趋势、聚合异常），核心诉求是**免自研分析看板与图表**。
2. **负载 B（Agent / 用户结构化反馈与 Harness 错误）**：低频文本工单（标题、工具名、模型名、版本、环境、脱敏正文，可能较长），核心诉求是**持久化存储、防刷限流、查看/筛选/归类/转 Issue**。

### 5.1 第三方平台关键一手数据（2026-11-23 核实）

- **Umami**（`umami-software/umami`，MIT 许可）：
  - 原生提供 HTTP 接口 `POST /api/send` 与 `POST /api/batch`（无需鉴权 token，仅需合规 `User-Agent`），支持 `type: "event" | "identify" | "performance" | "error"` 与自定义 `data` 对象；
  - 限制：**事件属性字符串上限 500 字符**、最多 50 个键；v3.5+ 的 `Error tracking` 面向浏览器 JS 异常堆栈（message 上限 2,000 字符、stack 16,000 字符），**不适合承载长文本用户/Agent 反馈工单**；
  - 部署要求：Node 20.19+（Next.js）+ PostgreSQL 12.14+（或 ClickHouse），**不能直接跑在 Cloudflare Workers + D1 上**；
  - **Umami Cloud 免费 Hobby 档**：$0/月，含 **100K 事件/月**（注意：保存的每个自定义事件属性单独计 1 个事件）、1 个站点、**6 个月保留**、无 API 读取；Pro 档 $20/月（100 万事件/月、2 年保留、含 API/MCP）。自托管完全免费且无条数和保留期上限。
- **Cloudflare Workers + D1 + Analytics Engine + R2**（官方定价与限制页）：
  - **Workers Free**：100,000 请求/天、10ms CPU/次；**Paid $5/月**含 1,000 万请求/月、3,000 万 CPU ms/月、无出站流量费；
  - **D1 Free**：500 万行读/天、10 万行写/天、5 GB 存储、10 个库；**Paid（随 $5 Workers 计划）**含 250 亿读/月、5,000 万写/月、5 GB 存储；
  - **Workers Analytics Engine Free**：10 万数据点写/天、1 万次 SQL 读/天，**但数据仅保留 3 个月**，且无现成产品分析前端看板；
  - **R2 Free**：10 GB 存储/月、100 万 Class A 写/月、无出站流量费。

### 5.2 三种备选方案与推荐组合对比

| 方案 | 覆盖匿名统计（负载 A） | 覆盖反馈/Harness 错误（负载 B） | 运维与开发成本 | 核心风险与短板 |
|---|---|---|---|---|
| **方案 1：纯 Cloudflare（Workers + D1 + Analytics Engine + Pages）** | 仅提供写入与 SQL API，**无现成分析看板** | **极佳**：零运维数据库、自带边缘限流与防刷、免费额度极充裕 | 免管服务器和数据库；但统计图表页和反馈管理页都要自写 | Analytics Engine 仅留 3 个月；自己维护多维统计看板容易变成长期负担；国内直连偶有延迟抖动（异步上报可容忍） |
| **方案 2：重写 `neuro-book-site` 一起承担** | 仍需自研图表或内嵌分析引擎 | 可共用账号、管理台和 `nb-ui` 风格 | 前置开发量最大（与 `w00037` 账号/备份/插件市场/社区耦合） | 严重拉长插件上线周期；若仍沿用单机 SQLite（768 MiB），不适合直接抗公网高频埋点与刷量 |
| **方案 3：只搭 Umami（自托管或 Cloud）** | **极佳**：开箱即用看板、自定义事件、留存、错误追踪 | **装不下**：无文本工单流，事件属性限 500 字符 | 自托管需维护 VPS + PostgreSQL + 备份；Cloud 免费档免运维但有 100K 事件/月和 6 个月上限 | 无法解决 Agent/用户审批后的反馈文本收集；客户端直连 Umami 地址会强耦合 |
| **推荐组合：Cloudflare 统一网关 + D1（收反馈） + Umami（看统计），客户端只认自有域名，与 `neuro-book-site` 重写解耦** | **极佳**：Worker 清洗/限流后转发给 Umami（初期可用 Umami Cloud 免费档，量大了无缝切自托管） | **极佳**：Worker 验参/二次脱敏/限流后落 D1，配极简后台或转 GitHub Issues / Webhook 通知 | 初期**零服务器/零数据库运维**，上线最快；客户端永不绑定具体后台 | 需管理两处配置（Cloudflare + Umami），但经同一网关域名对外呈现为单一后端 |

### 5.3 专题评估：Cloudflare Workers 能否承载 `neuro-book-site` 的多模块/微服务架构？

开发者同时计划重写 `neuro-book-site`，未来将承载 **OAuth 登录、备份与同步、Skill / 插件 / Profile 市场（含杀毒扫描与审核）、小说发布、用户交流与论坛**（已记入 [w00037-official-site](../../w00037-official-site/README.md)），并提出：能否直接用 Cloudflare Workers 构建这类微服务架构？

**结论：技术上可行，但对单人/小团队不建议一开始就拆成七八个细粒度微服务 Worker；更稳妥的做法是在 Cloudflare 上按「少数粗粒度部署单元 + 主站模块化单体 Worker + R2 存大文件与正文 + Containers 按需跑重任务」演进。**

#### Cloudflare 生态做多服务的真实优势（2026-11-23 核实官方文档）

1. **Service Bindings（零网络开销 RPC）**：Worker 之间通过 `WorkerEntrypoint` 直接调用方法，默认运行在同一节点的同一线程中，无公网跳数也不重复计费；且被调 Worker 可完全不暴露公网（适合内部 Auth / 审核服务），单次请求最多 32 次 Worker 调用。
2. **R2 零出站流量费**：Free 档即含 10 GB 存储、100 万 Class A 写、1,000 万 Class B 读，超出存储 $0.015/GB-月、出站带宽永久 $0。非常适合承载 **Skill / 插件 / Profile 压缩包分发、小说正文与封面、客户端加密云备份**，避开单台 VPS 磁盘与带宽瓶颈。
3. **Cloudflare Containers 补齐了重计算短板**：Workers Paid（$5/月）已支持按需容器（空闲自动休眠到零、按 10ms 计费，月含 25 GiB-小时内存、375 vCPU-分钟、200 GB-小时磁盘，规格 `lite` 256 MiB 至 `standard-4` 12 GiB）。`w00037` 要求的插件**杀毒扫描（如 ClamAV）、深度静态检测、大包解包**这类超出 V8 Isolate 能力的任务，可通过 Queues + Containers 异步处理。
4. **Paid 计划起步成本低且免运维**：$5/月包含 Workers 1,000 万请求、3,000 万 CPU ms（单次请求 CPU 上限可调至 5 分钟，默认 30 秒）、D1 250 亿读 / 5,000 万写 / 5 GB（最多含 10 万个库）、Queues 100 万操作、Workflows 50 万步。

#### 必须提前面对的 6 个真实硬约束

1. **D1 不是无限扩展的 PostgreSQL**：单个 D1 数据库硬上限 **10 GB（不可申请提高）**；每个库由单个 Durable Object 串行执行 SQL（平均 1ms 查询 ≈ 上限 1,000 QPS，10ms 写 ≈ 上限 100 QPS），查询结果上限 50 MB（2026-11-04 生效），`LIKE` 模式限 50 字节。**对策**：小说正文、附件与压缩包必须放 **R2**，D1 只放元数据与索引；或按域分库。
2. **中文全文检索偏弱**：D1 支持 SQLite FTS5，但内置分词器（`unicode61` / `trigram`）对中文小说、帖子和插件搜索效果一般，索引体积容易膨胀；站内搜索做深时仍需外接专用搜索服务或额外索引方案。
3. **微服务拆分税（分布式复杂度）**：官方明确要求 Service Bindings 各 Worker 按依赖顺序分步部署（先发兼容版被调方 → 再发调用方 → 再删旧方法）；多 Worker 本地联调需起多个 `wrangler dev`（单命令多 `-c` 仍标为 experimental）；**跨 D1 库无分布式事务**，单人维护过度拆分会大幅拖慢迭代速度。
4. **100 MB 请求体上限与 128 MB Isolate 内存**：Free/Pro 域名单次 HTTP 请求体上限 100 MB，Worker Isolate 内存固定 128 MB（Containers 出站 HTTP 单体同样默认限 100 MiB）。云备份与大插件包必须走 **R2 预签名 URL / Multipart 直传**，不能由 Worker 整包缓冲中转。
5. **成熟开源服务端跑不进纯 Workers**：Umami（Next.js + Postgres）、Discourse / Flarum / Fider 等社区软件无法直接部署到 Workers + D1。若官网全栈押 Cloudflare，论坛/市场/小说发布界面需自研（优点是能统一复用 `nb-ui` 与 OAuth）；若想复用成熟开源社区或统计，仍需保留少量容器/托管服务。
6. **中国大陆访问延迟与平台锁定**：Cloudflare 标准节点国内直连偶有绕路与晚高峰丢包；异步遥测/反馈可完全容忍，但小说阅读、论坛与 OAuth 页面在国内直连体验需提前预期。同时应通过 Drizzle ORM + 标准 SQL + 定期 D1 导出备份到 R2 降低锁定风险。

#### 推荐的粗粒度演进拓扑（兼顾 `w00053` 与 `w00037`）

```text
客户端（NeuroBook 插件） / 浏览器
  ├── telemetry.nbook.notnotype.com ──▶ [Worker 1: telemetry-gateway] (w00053 立刻落地)
  │                                       ├── 匿名事件 ──▶ Umami (Cloud 免费档起步 / 可随时切自托管)
  │                                       └── 审批反馈 ──▶ D1 (feedback-db) + 可选 GitHub Issue/Webhook
  │
  └── nbook.notnotype.com ────────────▶ [Worker 2: site-core 模块化单体] (w00037 重写官网)
                                          ├── 内部按域分包：auth(OAuth) / market / novels / forum / backup
                                          ├── 元数据 ──▶ 1~2 个 D1 库（先保留单库事务与 JOIN）
                                          ├── 大文件/正文/插件包/加密备份 ──▶ R2（预签名直传，零出站费）
                                          └── 插件审核队列 ──▶ Queues ──▶ [Worker 3 + Container: scanner] (ClamAV/静检)
```

这套拓扑既拿到 Cloudflare 免管服务器与 R2 零带宽费的好处，又把“服务数量”压在 2~3 个粗边界内；未来若论坛或小说站体量真的起来，再把对应子域拆成独立 Worker 或独立开源服务，没有任何返工浪费。

## 6. 隐私与合规风险提示（默认勾选匿名统计）

开发者倾向在安装/首次启动向导中**默认勾选匿名使用统计**，需在设计阶段明确兜底以防合规与写作社区信任风险：

1. **先确认再首报**：在 `FirstRunWizard` 走完并点击“完成”之前不发任何事件；用户在向导中取消勾选后全程零上报。
2. **严格白名单字段**：事件负载只允许版本、发行渠道、OS/arch、运行形态（桌面/Web/CLI）、匿名随机实例 ID（可随时重置，不绑定账号或设备硬件指纹）、受控事件名与受控枚举维度；禁止传任何用户输入、项目名、路径、模型 Key 或正文片段。
3. **透明可检查**：设置页提供显式开关、字段说明，以及“查看最近上报记录 / 清除匿名标识”的能力；向导页面用通俗中文直白列出“发什么、绝不发什么”。
4. **两条开关独立**：关闭“自动匿名使用统计”不影响用户主动触发“发送反馈 / 审批上传 Agent 反馈”，反之亦然。
5. **非阻塞与离线优先**：所有上报异步执行、设短超时、失败静默降级或有界缓存，绝不影响离线写作和 ReAct 循环。
6. **合规注意（未做法律审查，按工程经验提示）**：若未来面向欧盟或严格合规场景分发，持久化匿名 ID 在默认勾选（opt-out）下的合规口径较敏感，届时需评估是否按地区切换默认不勾选，或改为无持久 ID 的无状态日聚合计数。

## 7. 待开发者拍板的下一批问题

1. **后端落地选型**：采用推荐组合（Cloudflare Worker 统一网关 + D1 收反馈 + Umami 看统计），还是坚持纯 Cloudflare 或纯自托管 VPS？如果用 Umami，首版先挂 Umami Cloud 免费档还是直接自托管 Docker + PostgreSQL？
2. **插件拆分方式**：按推荐拆成两个独立内置插件——「个人统计插件（纯本地、提供仪表盘与贡献点）」和「遥测与反馈插件（联网、含隐私开关与 Agent 反馈通道）」——是否同意？
3. **Agent 非阻塞反馈的审批粒度**：每条 Agent 写的反馈都经右下角通知点开审阅后手动上传，还是同时提供一个可选项“记住选择：以后自动上传 Harness 工具错误，仅对用户建议类弹窗确认”？
4. **个人统计插件首版指标范围**：首版优先覆盖「字数统计与趋势（复用 `projects.stats`）+ Token/费用消耗（复用 `SessionCore`）+ 使用时长/活跃天数」，仪表盘入口放在书架页、工作台视图还是独立编辑区标签页？
5. **`neuro-book-site` 重写关系**：是否先把重写想法记入 `w00037-official-site`（保持独立排期，不阻塞本 Work），后续另开评估是否把新官网也迁到 Cloudflare 栈（Workers + D1 + R2）？
