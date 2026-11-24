# 使用数据收集分档调研（w00053 t02）
调研日期 2026-11-24。每条事实后附一手来源。

## 1. VS Code
- 档位：`telemetry.telemetryLevel` 四级 all / error / crash / off。all=崩溃报告+错误遥测+使用数据；error=崩溃报告+错误遥测；crash=只有崩溃报告；off=全无。三类定义：Crash Reports（崩溃时的诊断信息）、Error Telemetry（不致崩溃的意外错误）、Usage Data（功能使用与性能）。来源：https://code.visualstudio.com/docs/configure/telemetry.md
- 默认：all（源码 `'default': TelemetryConfiguration.ON`，枚举说明 “Sends usage data, errors, and crash reports.”）。来源：https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/telemetry/common/telemetryService.ts
- 告知：文档称“在产品内为所有新旧用户放一条通知”让用户可退出；FAQ 称 “The VS Code product notifies all users that they can opt out of telemetry collection”。通知的当前具体形态（首次启动弹窗还是别处）本次未在源码里核实。来源：https://code.visualstudio.com/docs/configure/telemetry.md（GDPR 一节）、https://code.visualstudio.com/docs/supporting/faq.md
- 持久匿名标识：有。桌面端是网卡 MAC 的哈希（客户端哈希一次、管线再哈一次），网页版是随机 UUID；文档明说“不保证唯一”。源码里存储键有 `telemetry.sqmId`、`telemetry.devDeviceId`。用户界面里能否重置：未核实。来源：同上 GDPR 一节；https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/telemetry/common/telemetry.ts
- 可查看：命令 “Developer: Show Telemetry” 打开 Telemetry 输出通道、同时写本地 `telemetry.log`（重载窗口才关闭追踪）；`code --telemetry` 输出“这个构建可能发送的全部事件”的 JSON（每个事件带 classification、purpose、endpoint 元数据）。来源：同上“Output channel / Viewing all telemetry events”。
- 关闭后：设置改动由配置监听即时更新级别（源码）；文档措辞“going forward”，并说关闭前已发送的不追回；FAQ 说崩溃上报改动要重启生效。关闭会同时关掉 A/B 实验（实验依赖 usage 数据；另有独立开关 `workbench.enableExperiments`）。本地队列是否清空：未核实。来源：同上；FAQ。
- 扩展的遥测不受此设置统一控制（需看各扩展），企业策略 `TelemetryLevel`、`EnableFeedback`（控制反馈入口与问卷）可集中管。来源：https://code.visualstudio.com/docs/enterprise/telemetry.md
- 更新检查：设置 `update.mode`（none/manual/start/default，默认 default），与遥测等级独立，可单独关；请求 URL 为 `{updateUrl}/api/update/{platform}/{quality}/{commit}`，参数 `bg=true`（后台检查）与 `u=none|<内部组织>`；Windows/macOS 的 User-Agent 带产品版本与系统版本（用于 EOL 检测）。来源：https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/update/electron-main/abstractUpdateService.ts；https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/platform/update/common/update.config.contribution.ts；https://code.visualstudio.com/docs/enterprise/updates.md
- 另：`@tag:usesOnlineServices` 可在设置里列出所有会联网的开关。来源：telemetry.md “Managing online services”。

## 2. Firefox（Mozilla）与 Glean
- 档位（数据收集类别，Category 1 到 4）：
  - 1 “Technical data”：设备/软件信息、几乎无识别风险；例：OS、崩溃与错误、更新等自动流程的结果、版本号；也含“功能必需的设置信息”，例如用户连接了哪些应用、用 Mozilla 账号登录了哪些服务。
  - 2 “Interaction data”：用户与服务的直接互动、几乎无识别风险；例：已同步设备数量、功能点击、会话时长、偏好设置状态、**账号活跃度**。
  - 3 “Stored Content & Communications”：用户存储、同步、通信的内容（保存的网址、历史、笔记、文件、密码）。
  - 4 “Highly sensitive or clearly identifiable personal data”：能直接识别个人，或不同类别合并后能识别个人/设备/家庭/账号的数据（例：账号姓名邮箱、付款、精确位置、语音；“类别 1 日志与类别 3 网址合并”也算 4）。
  来源：https://wiki.mozilla.org/Data_Collection
- 默认规则（官方站规则，按类别）：类别 1、2：正式版与预发布版均“可默认开”（Default ON，用户必须有办法关）；类别 3：正式版默认关，默认开须先经 Trust 批准，预发布版可默认开；类别 4：默认关，须事先 Trust 批准并满足“事先告知、同意、可退出”三项。“Default OFF”的定义是用户做出明确动作（配置项、提示、账号资料更新）才收集。来源：同上“Eligibility for Default on Data Collection”。
- 新增采集的门禁：补丁必须标 data-classification-low（仅类别 1、2）或 high（走敏感数据评审），Glean 指标的 `data_sensitivity` 要与分类一致；每年复查所有采集是否仍必要。来源：同上。
- 用户设置：官方隐私声明里的开关名是 “Allow Firefox to send technical and interaction data to Mozilla”（对应 1 加 2 类）；崩溃报告桌面端“需用户选择自动发送”，每次崩溃会询问是否附带更多信息（含打开的站点）；研究实验（studies）可单独退出。来源：https://www.mozilla.org/en-US/privacy/firefox/
- 与总开关解耦的“每日使用 ping”：声明称 “Daily Usage Ping” 只提供“有人在用 Firefox”的去标识信息，“不与其它数据关联”，取消上述技术与互动数据开关**不影响**它，需另行在设置里退出。来源：同上。
- 更新检查：桌面版 “regularly connect to Mozilla's servers … to check for software updates”，隐私声明把它放在“为了安全”一节；更新结果（成功/失败）属类别 1 技术数据。来源：同上；wiki 类别 1。
- 预发布版（Nightly/Beta/Developer Edition）默认发送更多（含某些网页活动与崩溃数据）。来源：隐私声明“pre-release”段；构建定义里 Nightly/Developer Edition 为 MOZ_TELEMETRY_ON_BY_DEFAULT：https://firefox-source-docs.mozilla.org/toolkit/components/telemetry/internals/preferences.html
- 总开关的实现：首选项 `datareporting.healthreport.uploadEnabled` 控制是否发送遥测（unified 开启时）；`toolkit.telemetry.archive.enabled` 允许 ping 在本地归档。来源：同上 preferences 页。
- 标识：Desktop Telemetry 有 clientId（及 profileGroupId，出现在 deletion-request ping 的“common ping data”里）；Glean 的 `client_info.client_id` 是可选标识。用户关闭上传后：Glean 清除所有已持久化的指标、事件、ping（`first_run_date` 除外）、发送待发的 deletion-request ping、随后移除 client ID；再次开启会生成新的 client ID。来源：https://mozilla.github.io/glean/book/reference/general/initializing.html ；https://firefox-source-docs.mozilla.org/toolkit/components/telemetry/data/deletion-request-ping.html
- deletion-request ping：用户选择退出技术与互动数据时发送，带 client id，用来通知数据管线删除该用户已上报数据，发送失败会持续重试；即使上传被关闭也会尝试发送它。来源：https://mozilla.github.io/glean/book/user/pings/deletion-request.html
- Glean 内置三种 ping：
  - baseline：SDK 自己管理的指标（os、版本、时长等），应用进入前台（reason active）、进入后台（inactive）时提交；进程被杀时下次启动补发 reason dirty_startup（第二次启动起）；不含 duration 的 active ping。含 client_info（os、os_version、architecture、app_build、app_display_version、client_id、first_run_date 等）。来源：https://mozilla.github.io/glean/book/user/pings/baseline.html
  - metrics：应用自定的非事件指标；目标是每个日历日一次，本地时间 04:00 之后第一个可用时机提交（只在应用运行时提交；新安装、升级会立即提交，reason 码 overdue/today/upgrade/tomorrow/reschedule）。来源：https://mozilla.github.io/glean/book/user/pings/metrics.html
  - events：承载事件指标；应用转入不活跃时（若有事件）、事件队列超过 maxEvents（默认 500，Glean.js 为 1）时、启动时发现磁盘上有未发送事件时提交；每条事件含 category、name、可选 extra（键 40 字节、值 500 字节上限）与相对时间戳。来源：https://mozilla.github.io/glean/book/user/pings/events.html
  - 另：Glean 默认限速每 60 秒最多上传 15 个 ping。来源：initializing 页的 rateLimit。
- 可查看：`about:telemetry` 页本次未能用官方文档核实（Mozilla 帮助站对爬取返回挑战页，source docs 里对应页面 404）——标“未核实”。Firefox 隐私声明与 source docs 均提到可在隐私设置里查看与关闭。
- 首次启动如何告知：本次没有从官方文档里查到“首次启动弹窗”的描述——标“未核实”（隐私声明称数据设置可随时在设置里改）。

## 3. Go 工具链遥测
- 档位：三种模式 off / local / on，只有一个总开关。local=在本机收集计数器并存本地，从不上传；on=收集并可能上传（抽样）；off=不收集也不上传。来源：https://go.dev/doc/telemetry （Configuration）
- 默认：local（只在本机，不上传）。Go 1.23 发布说明写明“Go telemetry is an opt-in system”。设计过程：最初想默认开，经公开讨论后改为上传须用户明确同意（2023 年 4 月接受）。来源：https://go.dev/doc/go1.23 ；https://go.dev/blog/gotelemetry
- 告知与询问：命令行不在安装时询问；`go telemetry on|off|local` 手动切换，`go telemetry` 查看当前模式，`go env GOTELEMETRY` 读模式。编辑器里 gopls 会弹提示问用户是否选择加入，选“Yes”等同 `on`（官方说明理由：保持样本新鲜，因为换机器后须重新选择，称为“campaign cost”）。来源：https://go.dev/doc/telemetry （IDE Prompting）
- 收什么：只收计数器。基础计数器（命名事件的计数，如 `gopls/client:vscode`，也用桶名做直方图如 `gopls/completion/latency:<50ms`）与堆栈计数器（崩溃或“不可能发生”的断言触发时的调用栈，只含 Go 工具链函数名与行号，不含用户输入、源码名称或内容）。本地计数器文件按 程序名@版本-Go版本-GOOS-GOARCH-日期 命名，因此上传报告的维度只有这些。隐私政策称不含个人或可识别信息。来源：同上；https://telemetry.go.dev/privacy
- 上报节奏与抽样：约每周一次把计数器汇总成 `<日期>.json` 报告；开启上传后只上传“upload config”里列出的计数器子集；当足够多用户开启后，会对一部分报告随机跳过上传，以减量并增强隐私。上传后本地留一份在 `<gotelemetry>/upload`（隐私政策称 `remote`）。来源：https://go.dev/doc/telemetry
- 上报配置公开且需公开提案：新增计数器必须走公开提案流程（改 chartconfig 的 config.txt、提 proposal、Go 团队成员批准；上传配置由图表配置自动生成，“只收我们想看到的数据”）；批准标准：不含敏感用户信息、有用、可行。上传的数据在 telemetry.go.dev 公开可见（合并报告与图表）。来源：同上
- 持久标识：文档与隐私政策里没有提到持久的用户标识，维度只有程序、版本、系统、架构；上传报告里是否带随机抽样用的数字：本次未核实。重置：因无标识，不适用（未核实）。
- 可查看：`gotelemetry view` 看本地数据；本地目录 `os.UserConfigDir()/go/telemetry`；`gotelemetry clear` 可随时清本地数据；上传过的报告副本留在本地；公开站可看全部上传汇总。来源：https://telemetry.go.dev/privacy ；https://go.dev/doc/telemetry
- 关闭后：`off` 即不再收集（本地也不写）；`local` 不上传。已上传数据的删除：本次没查到（计数器无标识，大概无从删除，属推断）。
- 采样规模备忘：官方写“约 16,000 名参与者即可得到统计显著的结果”，博客称当时每周约 1800 人参与。来源：同上；https://go.dev/blog/gotelemetry

## 4. Homebrew analytics
- 档位：单档（匿名聚合使用统计），一个开关，没有分级。收什么：安装/升级/重装事件（按操作计数而非按用户）的包名与非私有 tap 名、所选安装选项、是否用户显式请求（对比作为依赖）、是否在 CI/开发者模式、CPU 架构与 OS 名称或大版本、Homebrew 版本、是否默认前缀（其它前缀只报 custom-prefix）；命令事件只含命令名与去掉值的选项名；对常用命令随机抽样一个配置变量，只记变量名与“未设/默认/非默认”，不记值；构建错误事件不含日志或异常详情。来源：https://docs.brew.sh/Analytics
- 默认：开，但首次需要先“看到通知”才会开始发。代码逻辑：通知没显示过（`analyticsmessage` 等三个 git 配置项未置位）时本次运行设 `HOMEBREW_NO_ANALYTICS_THIS_RUN`，首次通知出现的那一次运行及之前一条事件也不发；通知输出到终端后（仅 stdout 是 TTY 时）才记为“已看到”，非 TTY 视为可能没看到、不记。来源：https://github.com/Homebrew/brew/blob/HEAD/Library/Homebrew/cmd/update-report.rb （analytics_message），https://github.com/Homebrew/brew/blob/HEAD/Library/Homebrew/utils/analytics.sh ，https://github.com/Homebrew/brew/blob/HEAD/Library/Homebrew/utils/analytics.rb
- 首次提示文字（源码原文）：`==> Homebrew collects anonymous analytics.` / `Read the analytics documentation (and how to opt-out) here:` / `https://docs.brew.sh/Analytics` / `No analytics have been recorded yet (nor will be during this \`brew\` run).`；输出前还发一声终端响铃，并用加粗避免被忽略。文档同时声明 “Homebrew displays a notice before analytics are enabled so a user can opt out before sending an event.” 来源同上；https://docs.brew.sh/Analytics
- 标识：载荷“不含用户标识与 IP 字段”，也“不据此为单个用户建立历史”。历史上有 UUID 文件（`~/.homebrew_analytics_user_uuid`），现在启动时会主动删除旧 UUID，所以没有可重置的标识（`brew analytics on` 也会调用 delete_uuid）。来源：https://github.com/Homebrew/brew/blob/HEAD/Library/Homebrew/utils/analytics.sh ；analytics.rb ；docs.brew.sh/Analytics
- 保留期：事件在 InfluxDB 保留 365 天（公开聚合报告可覆盖更短周期）。数据放在欧盟的 InfluxDB（更新报告里写“our InfluxDB instance in the EU”）。来源：docs.brew.sh/Analytics ；update-report.rb
- 公开统计页：Homebrew Formulae 分析页，含报告、RSS、事件，并有 JSON 版（`brew generate-analytics-api` 生成）；多数维护者只有这些公开聚合的访问权。来源：https://formulae.brew.sh/analytics/ ；docs.brew.sh/Analytics
- 可查看：`HOMEBREW_ANALYTICS_DEBUG=1` 对单条命令打印将发送的请求并同步发送（它不是退出手段，响应被丢弃）；`brew analytics state` 看当前设置。来源：docs.brew.sh/Analytics
- 关闭：`brew analytics off`（持久）或环境变量 `HOMEBREW_NO_ANALYTICS=1`；`brew analytics on` 再开启。传输在后台分离进程里通过 HTTPS 发，超时短、失败静默。关闭后是否清理本地队列：没有本地队列（发完即弃，属从代码结构推断），未核实。
- 已有更改记录：它们曾迁离 Google Analytics，更新时若检测到“已关闭且没看过新通知”会显示一条说明并劝用户重新开启（“Please reconsider re-enabling analytics…”）。来源：update-report.rb

## 5. Syncthing（使用报告与崩溃报告）
- 档位：两个相互独立的上报。(a) 匿名使用报告（usage reporting）：总体统计，如版本、平台、内存与处理性能、文件夹数与总量、文件夹各种功能的使用数；(b) 自动崩溃报告：崩溃时的版本信息与线程调用栈，“不含日志、文件名、设备 ID、统计数据、唯一标识或其它可识别信息”。来源：https://docs.syncthing.net/users/crashrep.html ；字段见 https://docs.syncthing.net/rest/svc-report-get.html
- 默认：使用报告默认不发：配置项 `urAccepted` 默认 0=用户还没做选择，-1=拒绝，正数=接受的报告版本；报告服务只有在 `urAccepted >= 2` 时才发送。崩溃报告默认开（`crashReportingEnabled` 默认 true，文档“enabled out of the box for most users”，可在高级配置里关）。来源：https://docs.syncthing.net/users/config.html ；https://github.com/syncthing/syncthing/blob/main/lib/config/optionsconfiguration.go ；https://github.com/syncthing/syncthing/blob/main/lib/ur/usage_report.go
- 何时询问：网页界面（GUI）弹模态框让用户接受或拒绝。`urAccepted===0` 时，不在首次设置期间打扰：记录首次访问时间，超过四小时之后才弹（代码注释）。拒绝时 `urAccepted` 设为 -1。来源：https://github.com/syncthing/syncthing/blob/main/gui/default/syncthing/core/syncthingController.js
- 版本号机制：`ur.Version` 常量（现为 3），源码注释规定“字段增减时必须递增，使用户被重新询问”。`urAccepted` 存的是用户接受的版本；`urSeen` 存界面上已展示过的最高版本；界面在“已接受版本 < 当前最大版本且未拒绝且没展示过当前版本”时再弹窗让用户重新接受（弹窗时同时拉取 `/rest/svc/report` 把将发内容展示出来）。报告结构按字段的 `since` 标签，只含用户所接受版本及以下的字段（`ClearForVersion`）。可选择只接受较旧版本（设置里有版本下拉）。来源：同上 controller 与 usage_report.go；https://github.com/syncthing/syncthing/blob/main/lib/ur/contract/contract.go
- 预览：REST `GET /rest/svc/report` 返回“匿名使用报告将发送的数据”；GUI 弹窗与设置里都可预览（代码里有 `reportDataPreview`）。来源：https://docs.syncthing.net/rest/svc-report-get.html ；controller.js
- 发送节奏：启动后延迟 `urInitialDelayS`（默认 1800 秒，让系统稳定）发第一次，之后每 24 小时一次；目的地 `urURL` 默认 `https://data.syncthing.net/newdata`。来源：usage_report.go ；config 文档
- 标识：有。`urUniqueID`，在接受使用报告且为空时随机生成 8 位字符串（`rand.String(8)`），随报告发送；崩溃报告不带。能否在界面重置：本次未核实（文档说“Generated when usage reporting is enabled”）。来源：optionsconfiguration.go；config 文档
- 关闭：把 `urAccepted` 改成 -1 后服务不再发送（Serve 里每天检查）；本地没有待发队列（每次现取现发，属从代码推断），已发数据的删除途径：本次没查到。

## 6a. Next.js（Vercel）
- 档位：单档“完全匿名的使用遥测”，一个开关。收什么：被调用的命令（next build/dev/export）、Next.js 版本、一般机器信息（CPU 数、macOS/Windows/Linux、是否在 CI）、项目里有哪些 Next.js 插件、build 耗时与应用规模（页面总数）、开发时 MCP server 各工具的调用次数（只有工具名与计数）。不收环境变量、文件路径、文件内容、日志、序列化的 JS 错误。开发期错误提示里的“有帮助/没帮助”反馈需用户点按钮才发，只带错误码。来源：https://nextjs.org/telemetry
- 默认：开。首次运行（构建或开发命令）在终端打印一段通知：`Attention: Next.js now collects completely anonymous telemetry regarding usage. / This information is used to shape Next.js' roadmap and prioritize features. / You can learn more, including how to opt-out ... by visiting the following URL: https://nextjs.org/telemetry`；记 `telemetry.notifiedAt` 之后不再提示，“如有重大变化会重新告知”（代码注释）。通知之后同一次运行是否已开始上报：本次未核实。来源：https://github.com/vercel/next.js/blob/canary/packages/next/src/telemetry/storage.ts
- 标识：有。`telemetry.anonymousId`（32 字节随机数，十六进制）和 `telemetry.salt`（16 字节随机，用于所有哈希值，盐“永不发送给我们”，保证单向性），存在用户级配置（Conf，projectName nextjs）；CI 或 Docker 里存到 distDir/cache。用户能否一键重置：本次未核实（可手动删配置文件，属推断）。来源：同上 storage.ts
- 可查看：`NEXT_TELEMETRY_DEBUG=1` 把将发的事件打印到 stderr（前缀 `[telemetry]`），此时**不发送**。来源：nextjs.org/telemetry
- 关闭：`next telemetry disable|enable|status`（写用户级偏好），或环境变量 `NEXT_TELEMETRY_DISABLED=1`（代码里最先检查，且会让通知也不出现）。来源：nextjs.org/telemetry ；storage.ts
- 传输：事件批量写文件，由分离的子进程发出，POST 带 5 秒超时（代码）。来源：storage.ts

## 6b. .NET SDK / CLI
- 档位：单档（使用遥测），总开关环境变量；另有“安装器的一条成功安装记录”也受同一变量控制；另有一个只有用户明确选择才用的“telemetry profile”（Microsoft 内部）。收什么：命令名（哈希）、参数与选项（多数哈希）、目标框架（哈希）、MAC 地址 SHA256 哈希、当前工作目录哈希、是否在 CI、SDK 版本、各步骤耗时、构建属性（哈希）等；`dotnet` 仅用于启动应用时不收集。数据以 CC BY 协议汇总公开。来源：https://learn.microsoft.com/en-us/dotnet/core/tools/telemetry
- 默认：对微软发行的 SDK 默认开；首次运行任一 CLI 命令时显示一段文字作为告知（“This ‘first run’ experience is how Microsoft notifies you”）：“The .NET tools collect usage data in order to help us improve your experience. The data is collected by Microsoft and shared with the community. You can opt-out of telemetry by setting the DOTNET_CLI_TELEMETRY_OPTOUT environment variable to '1' or 'true'…”。同文说可用 `DOTNET_NOLOGO` 关掉这段提示，对遥测退出无影响。来源：同上
- 标识：机器标识是 MAC 的 SHA256 哈希；用户重置：未核实。
- 关闭：`DOTNET_CLI_TELEMETRY_OPTOUT=1`（需在安装前设置才能同时关掉安装器那一条）。没有 CLI 子命令开关；查看：本次文档页未见“预览将发送内容”的手段，只有文档公布的字段清单——未核实是否有调试选项。
- 来源：同第一条

## 7a. Zed
- 档位：客户端两类 + 服务端一类。客户端：diagnostics（崩溃报告：minidump 加调试元数据，下次启动时发送）与 metrics（匿名使用数据：打开文件的扩展名、使用的功能与工具、项目统计如文件数、检测到的框架；不含代码）；服务端：使用 Zed 托管服务（AI、协作）时为限流与计费收集元数据（如 token 用量），“是这些功能工作所必需的”，无法单独关闭；Zed 不存提示词与代码，除非用户明确分享反馈或选择加入 Edit Prediction 训练数据收集。来源：https://zed.dev/docs/telemetry
- 默认：diagnostics 与 metrics 默认都是 true。来源：https://github.com/zed-industries/zed/blob/main/assets/settings/default.json
- 告知与询问：首次启动的 Onboarding 基础页里有两个开关：“Help improve Zed by sending anonymous usage data”（metrics）与“Help fix Zed by sending crash reports so we can fix critical issues fast”（diagnostics），打开状态读自当前设置值（默认开）。来源：https://github.com/zed-industries/zed/blob/main/crates/onboarding/src/basics_page.rs
- 标识（分层）：源码里有四个：`system_id`（每台系统）、`installation_id`（每次应用安装，dev/nightly/preview/stable 各不相同）、`session_id`（每次启动）、`metrics_id`（每个登录用户）。文档原文：“Usage data is tied to a random telemetry ID. If you've authenticated, this ID may be linked to your email so Zed can analyze patterns over time and reach out for feedback.” 重置：本次未核实。来源：https://zed.dev/docs/telemetry ；https://github.com/zed-industries/zed/blob/main/crates/client/src/telemetry.rs
- 登录与匿名数据的关系（对本次需求关键）：Zed 的文档**没有**声明二者不关联，反而明说登录后遥测 ID 可能与邮箱关联；代码上，metrics 关闭时 `set_authenticated_user_info` 直接返回，不把登录用户的 `metrics_id` 附到事件上，且 `report_event` 在 metrics 关闭时直接丢弃事件、不入队。来源：同上 telemetry.rs
- 可查看：命令 “zed: open telemetry log” 或菜单 Help > View Telemetry Log，查看已上报内容；完整事件类型见仓库 `telemetry_events.rs`，崩溃数据结构见 `crates/crashes/src/crashes.rs`。来源：https://zed.dev/docs/telemetry
- 发送节奏：每 5 分钟或积累 50 条事件时发出（调试构建 1 秒/5 条），HTTPS、限速；下游为 Sentry（崩溃）、Snowflake（数据仓库）、Hex 与 Amplitude（看板）。来源：同上；telemetry.rs
- 关闭后：设置 `telemetry.metrics`/`telemetry.diagnostics` 改为 false；metrics 关闭后新事件不入队（代码）；已入队未发的事件是否清空：未核实。企业版（Zed Business）管理员可全组织禁止数据分享。来源：同上

## 7b. Obsidian
- 档位：无遥测。隐私页（更新于 2023-11-01）：桌面与移动端“All data is saved locally on your device and is never sent to our servers”，“We do not collect any telemetry data”；第三方插件与主题的开发者政策禁止采集客户端遥测，且网络使用须明确披露。所以没有分档、没有默认值、没有首次询问、没有标识（在 App 内）。来源：https://obsidian.md/privacy
- 更新检查：“Obsidian may connect to the internet to check for updates, but you can disable this in Settings → About.” 即更新检查是应用里唯一提到的联网项，可单独关。更新请求具体带哪些字段：未核实（隐私页未写）。来源：同上
- 账号与云服务：Sync 与 Publish 才会在服务器上存数据（Sync 端到端加密，含文件名）；账号邮箱不与第三方共享（支付处理商除外）；删除账号可在账号仪表盘一键永久删除账号、许可与订阅；Sync/Publish 订阅过期后数据保留一个月、自行取消则立即删除。隐私页没有写“设备列表”“最后活跃时间”如何处理。来源：同上

## 7c. JetBrains IDE
- 档位（产品数据收集与使用声明 v1.6，2026-07-07）：(a) 匿名遥测（泛化的功能使用统计，如时间、点击）；(b) 运营与产品元数据（用 JetBrains AI 服务时，API 调用数、错误率，经假名化）；(c) 基于事件的数据（假名化会话数据）；(d) 行为数据；(e) Web 产品的 cookie；(f) “详细的代码相关数据”（含与大模型交互的完整文本，可能含代码片段，可用于训练 AI 模型）。设置页里对应三个复选框：自动发送错误报告、发送匿名使用统计、发送详细的代码相关数据。来源：https://www.jetbrains.com/legal/docs/terms/product_data_collection/ ；https://www.jetbrains.com/help/idea/settings-usage-statistics.html
- 默认与询问：按许可证类型分开：个人非商业许可“基于合法利益默认收集，可在设置里退出”；个人商业、试用、EAP、组织许可、免费社区许可（开源、学生等）“只有在明确同意后才开始收集”；免费 Community 版 IntelliJ IDEA 与 PyCharm “数据收集被禁用且无法开启”；远程开发模式与 Code With Me 访客端不提供开启选项；“详细代码相关数据”对组织许可默认不允许，只有公司管理员允许后才向用户询问同意。帮助页：“By default, data sharing options are disabled in all release versions, except for automatic error reporting”（自动错误报告默认开）；预览与 EAP 构建数据共享默认开（该页与声明里 EAP 的写法不一致，以声明为准，是否是各自生效范围不同：未核实）。询问的位置：“在产品内、网站上或其它环境以显著方式提示同意”，具体首次启动对话框本次没有查到官方文字——未核实。来源：同上；隐私声明 https://www.jetbrains.com/legal/docs/privacy/privacy/
- 标识：“用户标识由随机 ID 生成，并额外哈希加盐”；声明“收集的分析数据不含与你账号的直接关联，不保留可直接把这些数据与个人账号关联的标识”。帮助页：“We strictly separate product usage data and personal information associated with your name and JetBrains account.” 能否重置标识：未核实。来源：同上
- 数据精度处理（可借鉴）：值取整（如项目文件数）、用允许列表限制可上报的插件/库名、强制预定义的 schema 校验后才记录、无法记录的值用占位符。来源：https://www.jetbrains.com/help/idea/settings-usage-statistics.html
- 可查看：启用数据共享时，事件会记录到本地日志目录（`event-log-data/logs/FUS`，各系统路径见页面），用户可直接打开看。关闭后再开要重启 IDE 才会重新出现这些目录。来源：同上
- 数据共享偏好：声明写明“这些偏好一旦配置，适用于所有已安装的 JetBrains 产品”，并可在账号里管理。第三方插件的数据收集不受 IDE 设置控制。来源：声明；帮助页
- 更新检查：隐私声明把“license validation and checking for updates”列为“为提供软件而收集数据（含个人数据）”的合法目的，不属于需要同意的分析类。请求字段：未核实。来源：隐私声明（目的 a）
- 隐私声明里账号：JetBrains Account 含姓名、邮箱、用户名，可选头像；用户可在账号里管理个人数据与部分数据收集的退出。来源：同上

## 8. 桌面应用更新检查本身带出的信息
- Tauri updater：端点 URL 支持模板变量 `{{current_version}}`（请求更新的应用版本）、`{{target}}`（linux/windows/darwin）、`{{arch}}`（x86_64、i686、aarch64、armv7）；不支持自定义变量，但可自定 target；“如需更多数据，可在 Rust 里加请求头”；仅非 2XX 才换下一个端点；生产环境强制 TLS。官方文档没有说明请求带标识，也没有提把更新检查当安装量统计。来源：https://v2.tauri.app/plugin/updater/
- Electron autoUpdater（macOS 基于 Squirrel.Mac，Windows 基于 Squirrel.Windows/MSIX）：文档的 `setFeedURL` 让开发者自己决定请求里放什么（url、headers、serverType）；Squirrel.Mac 要求请求“至少包含版本标识”，其余如系统版本由服务端约定（常用查询参数），服务器返回 204 表示无更新。官方托管服务 update.electronjs.org 的路径是 `/:owner/:repo/:platform-:arch/:version`，即平台、架构、版本三项。来源：https://www.electronjs.org/docs/latest/api/auto-updater ；https://github.com/Squirrel/Squirrel.Mac/blob/master/README.md ；https://github.com/electron/update.electronjs.org/blob/main/README.md 。该服务是否做安装量统计、是否留日志：本次未在其 README 里核实（README 里没写）。
- Sparkle（macOS）：默认的更新检查只是取 appcast；另有“系统画像”（`SUEnableSystemProfiling`，默认 NO，开发者开启）：随更新检查以 GET 查询参数发送匿名系统信息：macOS 版本、CPU 类型/子类型、Mac 型号、CPU 核数、32/64 位、CPU 频率、内存大小、应用名与版本、用户首选语言（Sparkle 2 可用 `allowedSystemProfileKeysForUpdater:` 进一步限制）；“为了让更新检查间隔不同的用户群统计口径一致，每周只提交一次画像”。这是一个明确把更新检查当作用户群统计来源并写进文档的例子。询问：Sparkle 默认在第二次启动时询问用户是否允许自动检查更新（`SUPromptUserOnFirstLaunch` 改成首次启动；`SUEnableAutomaticChecks` 预设后不再询问）。来源：https://sparkle-project.org/documentation/system-profiling/ ；https://sparkle-project.org/documentation/customization/
- Omaha（Google Update，Chrome 等使用）：把更新请求当作活跃用户统计的正式协议。请求带 requestid（每次请求的随机 GUID）、sessionid（每次更新流程的随机 GUID）、应用 id 与版本、`lang`、`brand`（4 字符渠道/合作代码）、`cohort`（发布批次）、`installdate`/`installsource`（安装日期、来源如 organic/scheduler/ondemand）、OS 的 platform/version/sp/arch、`ismachine`、`<ping>` 里的活跃标记与上次 ping 间隔（`a/r` 按天或 `ad/rd` 按服务器日期）；用户 ID `userid` “只在选择加入的用户上发送”，因为用户 ID 可跨天追踪用户；默认用“客户端自管的去重计数”（dedup=cr），客户端告诉服务器距上次发送过了多少天，服务器据此去重，不需要稳定标识；还要带一个每次成功响应后轮换的随机 `ping_freshness`。协议自述目标：“提供更新成败率、留存和使用量等指标，同时不损害客户端隐私”。来源：https://github.com/google/omaha/blob/main/doc/ServerProtocolV3.md
- VS Code：更新请求 URL 为 `/api/update/{platform}/{quality}/{commit}`，附 `bg=true`（后台检查）与 `u=`（内部组织标记，默认 none）；Windows 和 macOS 的 User-Agent 带产品版本与系统版本（用于判断系统是否已停止支持）。官方文档把更新列在“online services”，未说明被用作安装量统计：未核实。来源：见第 1 节。
- Firefox：隐私声明承认桌面版会定期连 Mozilla 服务器检查更新，并把“更新等自动流程的结果”归为技术数据（类别 1）；更新请求的 URL 字段，以及是否据此统计活跃安装：本次没查到官方文档（先后尝试了源码文档页、遥测文档页均 404 或无相关描述），未核实。来源：见第 2 节。
- Obsidian：更新检查是唯一承认的联网项，可在设置里关；字段未核实（第 7b）。

## 9. 登录账号之后的数据：匿名遥测与账号关联数据怎么区分
- VS Code（遥测 vs Settings Sync）：遥测文档的 GDPR 一节写明，VS Code 的遥测没有可唯一识别用户的“登录”体验，只带 MAC 哈希（网页版为随机 UUID）用于近似同一用户，“不保证唯一”，所以官方“没有可靠办法把你的数据提供给你”；这等于说遥测与 Microsoft/GitHub 账号无关联，但**原文没有直接写“不与账号关联”这句话**。Settings Sync 是需要登录 Microsoft 或 GitHub 账号的独立服务：它会记录同步过的设备，用户可在 “Synced Machines” 里查看设备（默认名由操作系统和 Stable/Insiders 决定）、重命名、远程关闭某台设备的同步；可在“Turn off”时勾选“在所有设备上关闭同步并从云端清除数据”，远端保留每类数据最近 20 个版本，本地备份 30 天后删除。关遥测与关 Sync 是各自独立的设置。来源：https://code.visualstudio.com/docs/configure/telemetry.md （GDPR 一节）；https://code.visualstudio.com/docs/configure/settings-sync.md
- JetBrains（遥测 vs JetBrains Account）：官方明确声明“我们严格分离产品使用数据和与你的姓名及 JetBrains 账号关联的个人信息”，并且“收集的分析数据不含与你账号的直接关联，不保留可直接把这些数据关联到个人账号的标识”；用户标识用随机 ID 加哈希加盐；账号数据（姓名、邮箱、用户名）按隐私声明处理，且可在账号里管理或请求删除；许可校验与检查更新属于“为提供软件而必需”的数据，不依赖遥测同意。来源：https://www.jetbrains.com/help/idea/settings-usage-statistics.html ；https://www.jetbrains.com/legal/docs/terms/product_data_collection/ ；https://www.jetbrains.com/legal/docs/privacy/privacy/ 。账号里“设备列表”“最后活跃时间”如何展示：本次未核实。
- Zed（遥测 vs 登录）：做法相反：文档明说“使用数据绑定到一个随机遥测 ID；如果你已登录，这个 ID 可能与你的邮箱关联，好让 Zed 随时间分析模式并联系你要反馈”。代码里 `metrics_id` 为“每个登录用户”的标识；用户关掉 metrics 后，登录用户信息不再附加到事件。服务端（AI、协作）的元数据是使用托管服务的必要条件，不能用客户端开关关闭。来源：https://zed.dev/docs/telemetry ；https://github.com/zed-industries/zed/blob/main/crates/client/src/telemetry.rs
- Mozilla 账号（Firefox Sync 等）：账号隐私声明把账号数据、联系数据（邮箱）、授权数据归为必要的账号数据；另收“技术与互动数据”用于运营和改进：包含你用账号连接的 Firefox 使用情况、“上次同步是什么时候”、“你用过哪些设备与我们互动”；这类数据一般保留最长 25 个月；账号数据在账号活跃期间保留，超过两年没登录的账号会被定期删除；用户可在账号的数据收集设置里更改，与 Firefox 本体设置分开。Mozilla 的数据类别把“已同步的设备数”“账号活跃度”放在类别 2（互动数据，默认可开）；“把类别 1 日志与类别 3 网址合并成能识别账号/设备的数据”则算类别 4，需要事先同意。来源：https://www.mozilla.org/en-US/privacy/mozilla-accounts/ ；https://wiki.mozilla.org/Data_Collection
- Obsidian（Sync 账号）：账号只用于许可、付款与 Sync/Publish；隐私页没有区分“匿名遥测”与“账号数据”（因为根本没有遥测）；Sync 的 Settings 里有“Copy Debug Info”能看服务器所在区域；设备列表、最后活跃时间的处理：官方隐私页与 Sync 安全页均未写——未核实。账号可在仪表盘自助删除，订阅过期数据保留一个月。来源：https://obsidian.md/privacy ；https://github.com/obsidianmd/obsidian-help/blob/master/en/Obsidian%20Sync/Security%20and%20privacy.md
