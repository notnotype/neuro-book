# 耦合审查汇总（2026-11-18）

开发者 2026-11-18 定 bot 先做成 NeuroBook 的内置插件，并要求深查现有组件的耦合：功能与业务功能能不能关，哪些可以拆开、哪些不推荐耦合、哪些可以接受。四位只读审查者按范围各审一份，主 Agent 抽查了每份的关键结论（都与代码对得上）后汇总在这里。原始报告：

| 范围 | 审查者 | 条数 | 报告 |
|---|---|---|---|
| nb-agent-ui 与 NeuroBook 的对话宿主 | Claude Sonnet | 15（不推荐 5、可拆 8、可接受 2） | [agent-ui](../tasks/t01-direction/evidences/coupling-audit-agent-ui-sonnet.txt) |
| NeuroBook 前端：工作台、各插件界面、前端包 | Claude Sonnet | 14（不推荐 1、可拆 7、可接受 6） | [frontend](../tasks/t01-direction/evidences/coupling-audit-frontend-sonnet.txt) |
| NeuroBook 后端：内置插件、`nbook.agent`、两端宿主 | Claude Opus | 9（不推荐 2、可拆 3、可接受 4），另列 bot 缺口 G1 到 G12 | [backend](../tasks/t01-direction/evidences/coupling-audit-backend-opus.txt) |
| 共享包：nb-harness、nb-runtime、nb-host、nb-models、nb-session、nb-profile | Claude Opus | 21（不推荐 3、可拆 10、可接受 8） | [packages](../tasks/t01-direction/evidences/coupling-audit-packages-opus.txt) |

三类的定义（审查说明里给定）：**可以拆开**是拆的代价小或中、能换来说得出名字的好处；**不推荐耦合**是挡住了 bot、关掉某功能或第二个应用这类具体场景，或违反已写下的边界；**可以接受**是本来一体，或拆的代价高于收益。

“关了坏什么”都按依赖图推断，没有测试去掉某个内置插件再起整套应用。

## 一、功能能不能关

**今天用户关不掉任何内置插件。** 插件管理对内置插件的启用、禁用一律拒绝（`runtime/plugin-install.md` 输出 4，`builtin-fixed`）。而且服务端把第三方插件以外的全部插件列为启动必需（`server/start.ts` 的 `requiredPlugins`），必需插件的入口不看 `activationEvents`、启动时全部激活（`nb-runtime` 的 `application/bootstrap.ts`）：贴纸、剧情、Agent 这类可选功能激活失败一次，整个服务端就起不来；Agent、后台任务声明的懒激活也不起作用。这从 w00027 t03（2026-10-17）起就是这样，没查到写下来的理由；ADR 0022 只说“启动必需的内置插件不能禁用”，没说全部必需。`runtime/server-host.md` 还写着必需插件只有 3 个，已过时。

按依赖图：

| 类别 | 插件 |
|---|---|
| 基础，关不掉 | state、settings、storage、files、projects、commands、workbench（浏览器），宿主插件 runtime.diagnostics、nbook.http |
| 可以关，别的只降级 | agent（是叶子，没有模块依赖它）、models（关了 Agent 跑不了模型）、stickers、tasks、plugins、editor、explorer、html-preview、image-viewer、theme-study、desktop |
| 要成组关 | plot 硬依赖 canon（关 canon 必须连 plot）；markdown 被 editor 与 agent 当必需依赖 |

会话引用了缺席插件的东西时已有降级规则：Profile 缺工具标不可用，解析不到 Profile 或缺扩展时会话只读（`agent/contributions.md`）。浏览器按服务端交来的插件集合登记，服务端少一个插件，浏览器就少一个。

## 二、按主题的发现

### 对话视图（nb-agent-ui）

核心已经无界面，会话列表与面板在视图外，Markdown 与编辑器由宿主注入。bot 缺的五样都落在消息或待处理事项上：

1. 分轮只认普通用户消息开头：提醒、任务结果、别的 bot 的话并进上一轮。
2. 审批向导一律替换输入框，没有开关。
3. 整段历史一次取完：宿主没实现 `history.loadPrevious`，适配器没有只应用后缀的入口。
4. 适配器跳过扩展写的事件，没有映射入口。
5. 助手身份整个视图只有一份，bot 之间讨论画不出说话者。

审查者推荐的形状：保持“无界面核心加一个编排好的视图”，差别做成消息与事项上的可选字段（轮次起点与来源、说话者、事项的停靠位置）和少数插槽，不拆几种外壳、不堆布尔开关；会话、bot、会话加 bot 三种用法写成 Spec 里的“用法档”，每档配 Lab 场景与挂载测试。会话加 bot 档是 bot 视图与子会话视图并排，子会话的待处理事项经事项来源进 bot 的停靠区。

### 对话接线（NeuroBook 前端）

网页一侧的对话宿主（`session-host.ts` 1,751 行加挂载组件）只在 `nbook.agent` 浏览器入口的激活里建，没有对外服务；按 `architecture.test.ts`，bot 插件不能导入 `agent/web/`，只能抄一份。对话的位置名写死为 `"view" | "page"`。

### `nbook.agent` 的后端接缝（bot 插件建在它上面缺什么）

已经能用：经服务建会话、发消息、插话、订阅、开后台任务；经贡献点交工具、Profile、扩展、压缩方法；经 `files.schemes` 登记自己的方案。挡第一版的：

| 缺口 | 现状 |
|---|---|
| G1 审批规则插不进来 | 规则只来自用户设置与作品文件 |
| G2 新方案写不进去 | 资源分类按方案名写死，`bot://` 一律只读 |
| G3 工作目录写死 | 有主项目是 `project://`，否则 `session://` |
| G4 工具集不能按会话裁剪 | 任务会话的工具清单做不到 |
| G5 无人值守的审批没有出口 | 要问人的一律交给用户，没有期限；后台会话照样挂起等人 |
| G6 会话没有归属 | 所有会话同一个库，任何会话都能读别的会话的日志与 home；bot 的主对话会混进会话列表，读过外部网页的任务会话也能读主对话 |

小缺口：同进程订阅失败时调用方拿不到失败（G7）；插件不能在自己激活期间开会话，没有“实例已就绪”的回调（G8）；调用方身份只有用户与会话（G9）；会话列表不能按 Profile 或归属筛（G10）。

### 内核（nb-harness）与 bot 用法冲突的假设

提案第三节列的几条复核后都仍成立，另找到几条：

1. 发出者只有用户与会话：宿主送进来的提醒、任务结果在日志里与用户亲手输入无法区分；`auto` 审批模型会把它们当成用户授权，是提示注入的放大口（新发现）。
2. 扩展排着的外部事实只在对话循环的边界写出，只压缩的运行与运行收口不写出；空闲时写进来的事件没有累计上限。
3. 上一轮已完成时 `start` 一律失败，宿主没法不伪造用户输入就开一轮。
4. 审批与提问没有期限，也没有“过期”这个结算值。
5. 宿主发起的压缩不带原因与方法，固定按阈值的方法顺序；阈值触发关不掉。模型适配器不显式传缓存档位，环境变量 `PI_CACHE_RETENTION` 能改掉它（新发现）。
6. 句柄表空闲 30 秒关会话是写死的，持一个订阅能绕过，但不是写下来的合同。
7. 一直写下去的会话：打开从头归约、全部事件常驻内存。负载约 24 时实测 24,667 条事件打开 578 ms、堆增 33 MB；98,667 条 1,140 ms、105 MB。
8. 花费上限按会话一生累计，常驻的主会话没有按天的口径。

### 共享包的复用

应用概念漏进包里的很少，六个包没有依赖指向 NeuroBook、没有环，机检都过。影响以后第二个应用复用的：

- kit 各块的行为合同写在 `docs/specs/agent/*`，主语是 `nbook.agent`；代码与应用无关，合同没有。
- 子代理与任务中心在 `nbook.agent`，不在 kit（任务中心 341 行，只依赖内核的时钟，可以直接搬）。
- nb-harness 根入口 `.` 仍是旧的 `createHarness`，nb-session、nb-profile、pi-agent-core 只为旧实现留着，第二个应用会一并带上。
- 审批模型的系统提示词写死在 kit，以“current project”为工作范围。

### 新增内置插件要改别人的封闭名单

命令域词表 `COMMAND_DOMAINS`、设置类别 `app | ai | plugins`、内置插件显示名表三处是封闭名单；现有命令域里没有 bot、schedule；`nbook.tasks` 已被后台任务占用，日程插件不能叫 tasks。`"nbook.editor.open"` 字面量散在 6 处；工作台按字符串读 `nbook.agent/active`；models 的两项设置用字符串反向引用 `nbook.agent.reliability`（不推荐耦合）。主题素材的后端住在 `nbook.files`，工作台因此运行时依赖它。

### 本机进程可信

RPC 端口与 HTTP 写请求对不带 `Origin` 的本机程序放行；经 RPC 进来的调用一律当成用户本人，能结算审批、把审批模式改成 `yolo`、改审批规则与模型凭据、从本机路径装插件。bot 无人值守地跑命令时，等于把用户本人的权限交给模型。

### 可以接受的耦合（不动）

plot 建在 canon 上；editor 与 markdown 是一个能力的两面；宿主插件按 id 装配（ADR 0026）；agent 借插件平台的内部打包用户 Profile（导入规则必须一致）；约 40 处只引类型的跨插件导入；Lab 场景的例外；浏览器窗口宿主留在应用里（ADR 0045 决策 6）；nb-layout 的 IDE 形状是设计意图。

### 文档与现状不一致

`runtime/server-host.md` 的启动必需插件数；`docs/modules/monorepo-boundaries.md` 说 nb-agent-ui 核心不依赖任何包（实际依赖 `nb-ui/text`）；`ui/agent-conversation-view.md` 说当前宿主只有 Lab（实际是 `nbook.agent` 与 nb-story）。
