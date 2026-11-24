# 上报形态调研（逐系统追加）

## 1. Mozilla Glean
- 形态：混合。内置 ping 分几种，各装不同东西：
  - baseline：SDK 自己管的指标（os、duration 等），应用变为 active 时发 reason=active、变为 inactive 时发 reason=inactive；进程被杀没发出的，下次启动补发 reason=dirty_startup。不含 duration 的是 active 那种。https://mozilla.github.io/glean/book/user/pings/baseline.html
  - metrics：应用定义的除 event 外所有指标（counter、labeled counter、timing distribution 等的汇总值）。目标每天本地 04:00 发一次，但只在应用运行时才能发；没发出的下次启动以 reason=overdue 补发；升级版本时立刻发一次（reason=upgrade），避免新旧版本数据混在一起；崩溃后未发的随下一次 metrics ping 发出。https://mozilla.github.io/glean/book/user/pings/metrics.html
  - events：只装 event 指标；应用变 inactive 且有事件时发；队列超过 maxEvents（Glean.js 默认 1，其他 SDK 默认 500）立刻发；启动时发现磁盘上有未发事件也发。每条事件 = 相对本 ping 第一条事件的毫秒时间戳 + category + name + 可选 extra（键最多 50 个，键名 40 字节，值 500 字节）；Glean 自己还插入 glean.session_start / session_end / restarted 边界事件。https://mozilla.github.io/glean/book/user/pings/events.html 、 https://mozilla.github.io/glean/book/reference/metrics/event.html
  - 自定义 ping：应用显式发送，在 pings.yaml 定义，可单独设 include_client_id: false；指标用 send_in_pings 指定进哪个 ping。https://mozilla.github.io/glean/book/user/pings/custom.html
  - deletion-request：关闭采集时发。
- metric 类型：counter（只增，0 不上报，饱和于 2147483647，“让 Glean 自己计数”）、labeled counter（动态标签最多 16 个、超出进 __other__；静态声明最多 4096 个；标签最长 111 字符）、timing distribution（指数分桶，每 2 的幂 8 个桶，作为直方图汇总上报）、event 等。https://mozilla.github.io/glean/book/reference/metrics/counter.html 、 https://mozilla.github.io/glean/book/reference/metrics/labeled_counters.html 、 https://mozilla.github.io/glean/book/reference/metrics/timing_distribution.html
- 离线与去重：待发 ping 存盘重试；磁盘上最多 10MB 或 250 个待发 ping，超出从最旧的删，deletion-request 不受此限；每分钟最多发 15 个 ping；单个 ping 压缩后最多 1MB。URL 里带 document-id（唯一 UUID），服务端流水线“发现重复提交就丢弃后来者”（decoder 做校验、去重、富化）。https://mozilla.github.io/glean/book/user/pings/index.html 、 https://docs.telemetry.mozilla.org/concepts/pipeline/gcp_data_pipeline.html
- 标识：有。client_info.client_id 是 UUID，User 生命周期（随 profile 存在），“允许以用户为单位关联数据”；可按 ping 设 include_client_id: false 不带。关闭采集时：发 deletion-request ping（含 client_id）、取消待发上传、清掉客户端的指标和 ping 数据（first_run_date 除外）；重新开启时重新初始化核心指标（first_run_date 除外）。重新开启后是否生成新 client_id：官方这页没直接写，未核实。https://mozilla.github.io/glean/book/user/pings/deletion-request.html 、 https://raw.githubusercontent.com/mozilla/glean/main/docs/user/reference/general/toggling-collection-status.md 。另有 client_id.txt 恢复机制（v66.1 起）防数据库重置导致 id 意外再生：https://raw.githubusercontent.com/mozilla/glean/main/docs/dev/core/internal/client_id_recovery.md
- client_info 其它字段：app_build、app_display_version、architecture、first_run_date（日精度）、os、os_version、locale、attribution 与 distribution 等；ping_info 里有 seq（该类型 ping 的发送序号，可用于发现丢包）、start_time/end_time（默认毫秒精度、本地时区，自定义 ping 可降到分钟精度）。
- IP 与 UA：解码阶段“用请求元数据富化：HTTP 头、GeoIP 信息、提交时间”；官方这些页面没写原始 IP 是否落库，未核实。UA：新版 SDK 不再改写 User-Agent，改发 X-Telemetry-Agent（SDK 版本与平台）；浏览器发出的 UA 仍可在 metadata.user_agent 查询。https://docs.telemetry.mozilla.org/concepts/pipeline/gcp_data_pipeline.html 、 https://mozilla.github.io/glean/book/user/pings/index.html
- 保留期：raw 数据存入 payload_bytes_raw 仅作恢复与回填，不用于分析；官方这几页没写具体天数，未核实。敏感数据“有限保留、自动删除”是原则性说明（https://docs.telemetry.mozilla.org/concepts/pipeline/gcp_data_pipeline.html 末节）。
- 公开可见：每个指标在 metrics.yaml 里有 description、bugs、data_reviews 链接，指标字典公开（Glean Dictionary）；未在本次逐条核实 Dictionary 页面，标未核实。

## 2. Go 工具链遥测（Transparent Telemetry）
- 形态：A（计数汇总），而且是“只有计数器、没有事件流”。一次上报 = 一份按周的 Report：Config 版本、Week、LastWeek、随机数 X、各程序（名称、版本、Go 版本、GOOS、GOARCH）的计数器列表（名称 + 64 位总数）；崩溃类用 stack counter（计数器名里带函数名与相对行号，不含参数与路径）。https://research.swtch.com/telemetry-design 、 https://go.dev/doc/telemetry
- 频率与采样（原文设计）：本地按周计数，周起点每台机器随机（分散负载、新问题及时出现）；周结束后上报程序先抽随机数 X，X>=0.1 就连配置都不下载（硬上限 10%）；之后只报配置里写明采样率不低于 X 的计数器。在“默认开启”的假设下预计每台安装约每年不到一次。2023-02-24 改为默认关闭（opt-in）后这些概率要上调。同一设计里“目标约 16,000 份报告就能在 99% 置信度下得到 1% 误差”，所以报告数不随安装数增长。https://research.swtch.com/telemetry-design 、 https://research.swtch.com/telemetry-opt-in
- 现行官方文档：mode 有 local（默认，只存本机）、on、off；约每周把上周计数汇总成报告；“用户 opt-in 足够多之后，上传会随机跳过一部分报告”；上传后副本存本机目录。https://go.dev/doc/telemetry
- 离线与去重：报告带 Week；超过七天的旧周报告不再上传，“服务端可以在七天后封账”。LastWeek 字段让服务端知道客户端是否中间隔了几周没有用过，用来估算数据缺失量，也可估算 4 周或 52 周的活跃用户数。去重：原文设计没写服务端怎样识别同一份报告重复提交，未核实。
- 标识：无。原文：“报告里不含用户 ID、机器 ID 或任何其它 ID”“没有持久标识可以把某一周的上传和另一周的上传关联起来”。活跃数靠“抽样 + 周报告数”估计；LastWeek 给跨周活跃估计。
- 为什么只用计数、按周：（1）“从不保留任何事件日志或轨迹，也降低本地收集的隐私影响”，直接维护计数器而非从明细推导，主要动机是磁盘空间与更新延迟；（2）按周汇总的两个目的：让人明白“无法重建任何细粒度的用户行为轨迹”，以及减少周末等持续波动造成的统计噪声，“在客户端去噪既更私密又更干净”。https://research.swtch.com/telemetry-design
- 为什么不要事件流：作者把 VS Code、Kindle、.NET 的细粒度事件描述为“侵入性强的详细轨迹”，开源项目通常因两个原因不用：详细活动轨迹的隐私代价大；这种数据必须限制访问，使项目不再开放。并说 VS Code 的高分辨率事件轨迹“几乎没有新信息”，用透明遥测可得到相近洞察、隐私代价低得多。https://research.swtch.com/telemetry-intro
- 为什么公开上报配置：只收“我们想看到的图表所需要的计数器”，配置由图表配置自动生成、没有通配符，所以收不到未登记的计数器；配置变更走公开提案流程（需 Go 团队成员批准，不能带敏感信息，必须有用且可行）；配置用透明日志提供、难以对不同系统发不同配置；每次上传的 JSON 原样存本机可查；服务端每天公布完整的原始报告与汇总图表（“项目维护者作为直接收集者没有专有优势”）。https://research.swtch.com/telemetry-design 、 https://go.dev/doc/telemetry
- 只能收已知字符串：报告只含服务端已知的计数器名、程序名、版本；因此“不能收任意值”，如编辑器分布用“已知编辑器列表 + other”，other 多了再用调查补。https://research.swtch.com/telemetry-uses
- IP 与 UA：“服务端会看到 TCP 会话的来源 IP，但不会把它和报告一起记录”；系统维护（防 DoS）的日志可能含 IP，但与报告分开。https://research.swtch.com/telemetry-intro 。官方隐私政策仍写“按 Google 隐私政策收集”：https://telemetry.go.dev/privacy 。UA 未专门说明，未核实。
- 保留期：官方文档与设计文章都没写服务端保留天数；公开数据集是“每天的合并报告”。未核实。
- 可见性：本地 `gotelemetry view` 看本机计数；上传的原文 JSON 存本机；服务端公开合并报告与图表（telemetry.go.dev）；配置公开（golang.org/x/telemetry/config）；源码公开。https://go.dev/doc/telemetry 、 https://telemetry.go.dev/privacy
- 作者自己写的局限：遥测“只是决策的一项输入，不是唯一依据”（比如某些构建机关了遥测就看不到）。https://research.swtch.com/telemetry-uses

## 3. Aptabase
- 形态：B（逐条事件流）。一条事件 = timestamp、sessionId、eventName、systemProps（locale、osName、osVersion、deviceModel、isDebug、appVersion、sdkVersion）、props（只允许字符串与数字）。POST {host}/api/v0/events，一次最多 25 条；SDK 把事件放在内存队列里异步发，“用来应对断网”。https://github.com/aptabase/aptabase/wiki/How-to-build-your-own-SDK （原文 raw：https://raw.githubusercontent.com/wiki/aptabase/aptabase/How-to-build-your-own-SDK.md ）
- 离线与去重：官方 Tauri 插件源码里队列是内存 VecDeque，每 25 条一批；网络错误或服务端 5xx 的批次放回队列重试，4xx 直接丢弃；没看到客户端事件 id 或服务端去重机制（从插件源码读到，服务端未核实）。https://raw.githubusercontent.com/aptabase/tauri-plugin-aptabase/main/src/dispatcher.rs 。内存队列意味着进程退出时未发的事件会丢（从代码推断）。
- 标识：SDK 不发任何持久标识。sessionId 由 SDK 随机生成（秒级时间戳拼 8 位随机数），Tauri 插件里闲置超过 4 小时换新会话（SESSION_TIMEOUT）。https://raw.githubusercontent.com/aptabase/tauri-plugin-aptabase/main/src/client.rs
- 没有标识时怎么算用户：服务端用 SipHash(密钥=每应用每 24 小时轮换的随机盐, 客户端 IP + User-Agent) 生成“每日伪匿名用户 id”，盐在创建后 48 小时内永久删除。官方文档明说 MAU、留存这类跨日用户指标“不可用”。https://aptabase.com/legal/privacy 、 https://aptabase.com/docs
- IP 与 UA：只在内存中处理，不落库；用 IP 推出国家与地区后存国家/地区。https://aptabase.com/docs 、 https://aptabase.com/legal/privacy
- 保留期：分析数据最多保留 5 年；官方说用户无法请求删除，“因为无法知道哪些数据属于你”。https://aptabase.com/legal/privacy
- 可见性：服务端与 SDK 全部开源（可自托管）；“数据收集”清单在官方文档列出（事件名与自定义属性、应用版本、系统、设备型号、语言、国家地区、会话 id 与时间戳）。终端用户在应用里能否看到上报内容：未见官方说明，未核实。https://aptabase.com/docs
- 计费口径：每次 track 算一条事件（免费 2 万条每月）。https://aptabase.com/docs
- 备注：aptabase.com/docs/privacy 页 404；以上来自 /docs 的“Data & privacy”与 /legal/privacy。

## 4. TelemetryDeck
- 形态：B（逐条信号 signal，可数组批量）。一条信号：appID、clientUser（用户 id 的哈希）、type（事件名）、可选 sessionID、isTestMode、floatValue、receivedAt、payload（平铺的 JSON 基本类型）。POST https://nom.telemetrydeck.com/v2/…，body 是数组。https://telemetrydeck.com/docs/ingest/v2/
- 离线补发：API 允许客户端缓存后再发，用 receivedAt 填发生时间；服务端把早于 24 小时的时间拉回到“24 小时前”，把未来时间拉到当前（v1/v2；v3 照存）。去重机制：这页没写，未核实。https://telemetrydeck.com/docs/ingest/v2/ 、 https://telemetrydeck.com/docs/ingest/default-parameters/
- 标识：有“每个安装固定”的匿名用户 id。做法：SDK 接受开发者自定义的用户标识，没给就生成随机的（某些平台向系统要，如 iOS identifierForVendor）；在设备上加盐哈希一次，到服务端后再加服务端的盐用 SHA256 哈希一次（“双重哈希”），所以 TelemetryDeck 和开发者都无法还原原值；相同盐与相同原值可跨平台识别同一用户。https://telemetrydeck.com/docs/articles/anonymization-how-it-works/ 、 https://telemetrydeck.com/docs/ingest/v2/
- 会话：sessionID 可由客户端给；不给时服务端用 appID + clientUser 生成“每天变一次”的会话 id。https://telemetrydeck.com/docs/ingest/v2/
- 活跃数：有 MAU、DAU 的现成洞察（基于 clientUser 去重），也有留存查询（TQL Retention）。https://telemetrydeck.com/docs/articles/insights-about-monthly-users/
- 时间精度：隐私 FAQ 写“时间戳取整到最近的一小时”。https://telemetrydeck.com/docs/guides/privacy-faq/
- IP 与 UA：FAQ 写“IP 地址从不存储，数据库、日志、任何地方都没有”；Web SDK 看 IP 前三段（triplets）推断可能的国家。UA：未专门说明，设备元数据由 SDK 自报（系统版本、应用版本、设备型号等），完整列表公开。https://telemetrydeck.com/docs/guides/privacy-faq/ 、 https://telemetrydeck.com/docs/ingest/default-parameters/
- 保留期：官方写“目前没有删除冷存储事件的计划，因其不受 GDPR 约束；预计 7 到 10 年后删，但不保证”；关账号时删除个人身份信息，保留组织元数据与分析数据。热存储的保留天数这几页没写，未核实。https://telemetrydeck.com/docs/guides/privacy-faq/
- 可见性：SDK 源码开源，FAQ 列出收集的数据类别，默认参数清单公开。服务端是否开源：页面写“可以查看我们的代码来验证”，具体仓库未核实。
- 备注：官方文档的 /docs/api/ 等旧路径多数 404，以 /docs/ingest/ 为准。

## 5. Plausible 与 Umami（网站统计，逐条事件流，作为“无 cookie 算独立访客”的参照）
### Plausible
- 形态：B（每次页面浏览与自定义事件一个请求，服务端存逐条事件与会话记录；仪表盘展示聚合）。https://plausible.io/data-policy
- 独立访客算法（官方原文）：hash(daily_salt + website_domain + ip_address + user_agent)；盐每 24 小时轮换并删除；原始 IP 与 UA 从不存储。https://plausible.io/data-policy
- 源码里的具体做法：user_id = SipHash(key=当前盐, UA <> IP <> domain <> root_domain)（企业版再拼一段 replay_session_id）；盐是 16 字节随机数，持久化在数据库 salts 表，轮换时保留“当前”和“上一个”两把（跨午夜时会话不断），超过 48 小时的盐被删除。https://github.com/plausible/analytics/blob/master/lib/plausible/ingestion/event.ex （generate_user_id）、 https://github.com/plausible/analytics/blob/master/lib/plausible/session/salts.ex
- 存什么：页面 URL（只主机与路径，查询参数除活动与来源参数外丢弃）、来源、浏览器与系统（只存主、次版本号）、设备类型、国家/地区/城市、停留与滚动、自定义事件与属性、收入；事件有接收时间。IP 与 UA 仅用来算每日标识与推出浏览器、位置，“不存原始 IP 与 UA”。https://plausible.io/data-policy
- 客户端不存任何东西（无 cookie、不写 localStorage）。同上。
- 保留期：官方 data-policy 页没写具体天数（只写用户可随时删除账号与站点数据）；未核实。
- 可见性：源码开源，数据政策列出收集清单。
### Umami
- 形态：B（逐条事件，自定义事件、pageview、性能指标都是一条条的）。https://umami.is/docs/faq
- 独立访客算法（源码）：sessionId = UUIDv5(sha512(sourceId + IP + UserAgent + 盐 + distinctId + 应用密钥))；盐由 SALT_ROTATION 决定，默认按月轮换（startOfMonth 的哈希），可设 day、week、month 或固定串；visitId 另用“每小时的盐”，且同一会话超过 1800 秒（30 分钟）后换新 visit。https://github.com/umami-software/umami/blob/master/src/lib/crypto.ts 、 https://github.com/umami-software/umami/blob/master/src/lib/collection-session.ts
- IP 与 UA：只用来算 sessionId、推浏览器、系统、设备、国家、地区、城市；Session 表的字段里没有 IP 和原始 UA（浏览器 20 字符、国家 2 字符等），可选的 distinct_id 由开发者传入。https://github.com/umami-software/umami/blob/master/prisma/schema.prisma
- 可选标识：支持开发者自己传 distinctId（identify），此时会话 id 把它也拼进哈希。https://umami.is/docs/faq
- 保留期：自托管“无限期保留，除非手动删除”；云版见其 Cloud FAQ，本次没抓到该页（原链接 404），未核实。https://umami.is/docs/faq
- 没有 cookie：官方 FAQ 写 web 追踪器不使用 cookie。https://umami.is/docs/faq

## 6. PostHog（自托管）
- 形态：B（逐条事件）。每个事件至少有 api_key、distinct_id、event，可选 properties 与 timestamp（ISO 8601，可用于离线补发）；有单条与批量端点。https://posthog.com/docs/api/capture 。事件 uuid 去重、SDK 离线队列细节本次没读到，未核实。
- 匿名事件与已识别事件的区别：“底层区别是，已识别事件会为用户创建 person profile，匿名事件不会”。匿名事件无 person 属性、不进 group 分析，成本最多约低 4 倍；JS SDK 默认 person_profiles: 'identified_only'（先匿名抓取，直到有人 identify 才建档）。后端 SDK 与 API 默认就是已识别事件，要抓匿名事件需加 $process_person_profile=false，并用随机的、不关联到人的 distinct_id（如 UUID，一次访问内复用）。https://posthog.com/docs/data/anonymous-vs-identified-events
- distinct_id 与 identify：前端 SDK 首次访问自动分配匿名 id 并存在本地；用户登录后调 identify(distinct_id)，“把匿名 person 合并进已识别 person，把两个 id 链接起来”，此后用任一 id 都能查到登录前后的完整事件历史。alias 可把另一个 id 并入；有“合并限制”（已 identify 的 id 不能随便当别名）。PostHog 不会自己推断两个 id 属于同一人，“能合并你告诉它合并的，不能替你做身份解析”。https://posthog.com/docs/product-analytics/identify 、 https://posthog.com/docs/product-analytics/identity-resolution
- 隐私含义：（官方文档字面）identify 之后匿名历史被关联到可识别的账号；同一 distinct_id 被不同人共用时数据会被合并成一个人；person 档案与属性“保留到你删除为止”，不受事件保留期限制。要匿名就别 identify、用随机 distinct_id 并关掉 person 处理。https://posthog.com/docs/privacy/data-storage
- IP：默认事件上会带 $ip，GeoIP 转换默认会用它；可在项目设置里打开“丢弃客户端 IP”（“GeoIP 与机器人检测仍能在丢弃前使用 IP”）。https://posthog.com/docs/privacy/data-storage
- 保留期：事件保留依套餐：免费 1 年、按量 2 年、最长 7 年（对 2026-11-05 之后开始付费的组织）；自托管“不受事件保留限制，保留到你删为止”；person 档案保留到删除。https://posthog.com/docs/data/events-retention
- 可见性：自托管时数据归自己；SDK 开源。终端用户能否看到上报内容：未见官方说明，未核实。
- 与我们的关系：自托管也只是“事件库 + 可选身份合并”，没有计数汇总形态。

## 7. Homebrew（InfluxDB analytics）
- 形态：B（逐条事件，每次 install、build-error、命令运行一条，经 HTTPS 直接写 InfluxDB；measurement 如 command_run）。分离的后台进程发送，超时短、失败静默，不阻塞操作。https://docs.brew.sh/Analytics 、源码 https://github.com/Homebrew/brew/blob/HEAD/Library/Homebrew/utils/analytics.rb
- 一条上报装什么：包名与非私有 tap 名、选定的安装选项、是否用户显式请求（而非依赖）、是否在 CI/开发者模式、CPU 架构与系统名或主版本、Homebrew 版本、是否默认前缀（其它前缀统一报 custom-prefix）；命令事件只含命令与选项名（选项值被去掉）；对常用命令随机抽样一个环境变量，只记其名与“未设置/默认/非默认”，不记值；构建错误事件不含日志与异常细节。https://docs.brew.sh/Analytics
- 频率、离线、去重：每个事件当下发一次，没有离线补发；官方未写去重，（从源码推断）不存在补发队列。
- 标识：官方说“payload 不含用户标识符，也没有 IP 地址字段；Homebrew 不用 payload 为个别用户建立历史”。源码里有 analyticsuuid 设置项，关闭分析时会删除它（delete_uuid!），应是旧版遗留；当前是否仍发送该 id 以源码为准，本次未逐行核实。https://docs.brew.sh/Analytics
- 统计口径：官方明确“安装事件包括升级与重装，计的是操作次数，不是独立用户或机器”；所以没有活跃用户数。https://docs.brew.sh/Analytics 、 https://formulae.brew.sh/analytics/
- IP 与 UA：官方只说 payload 里没有 IP 字段；服务端（analytics.brew.sh 的 InfluxDB 入口）是否看到、记录 IP 与请求头，文档没写，未核实。
- 保留期：InfluxDB 里的事件保留 365 天；公开聚合报告按 30、90、365 天三档（安装事件表）。https://docs.brew.sh/Analytics 、 https://formulae.brew.sh/analytics/
- 可见性：首次启用前会显示提示；`HOMEBREW_ANALYTICS_DEBUG=1` 可打印请求；公开聚合与 JSON 在 formulae.brew.sh；`brew analytics off` 与 `HOMEBREW_NO_ANALYTICS=1` 关闭；多数维护者只能看公开聚合。https://docs.brew.sh/Analytics
- 官方的用途声明：用来排序维护优先级，“分析不能取代技术证据或维护者判断；低使用量本身不足以证明删除是安全的”。

## 8. 隐私增强聚合技术（只列事实）
- Prio / DAP（Divvi Up、Firefox）：客户端把一个度量值拆成两份“秘密分享”，在本机加密后分别发给两台互不串通的聚合服务器，每台只拿到一份，单看任何一份都推不出原值；两台各自验证输入并聚合，再把部分聚合值交给收集者合成最终结果（可算求和以外的多种聚合）。Divvi Up 是 ISRG（Let's Encrypt 的运营方）的服务；Mozilla 宣布与 Divvi Up 合作由其运营 Firefox 的一台 DAP 聚合器。Mozilla 说明 DAP/Prio 适用于“载荷本身可能识别个人”的场景，目标例子是按网站收集性能指标而不泄露浏览历史。来源：https://divviup.org/ 、 https://blog.mozilla.org/en/firefox/partnership-ohttp-prio/ 、 https://divviup.org/blog/divvi-up-in-firefox/ 。DAP 是 IETF PPM 工作组的标准草案：https://datatracker.ietf.org/doc/draft-ietf-ppm-dap/ 。Firefox 当前生产部署状态本次未核实。
- Oblivious HTTP（RFC 9458）：把加密后的 HTTP 请求经一个中继转发给目标服务器，中继看不到内容，目标服务器看不到来源 IP，也无法把多次请求关联到同一客户端；“限度地信任转发节点”。Mozilla 与 Fastly 合作由 Fastly 运营 Firefox 的 OHTTP 中继；Mozilla 称它“更灵活，可用于交互场景”。来源：https://www.rfc-editor.org/rfc/rfc9458.html 、 https://blog.mozilla.org/en/firefox/partnership-ohttp-prio/
- Brave P3A：阶段一只收“固定问题的多选答案”（如打开标签数分档 0-1、2-5…），每个答案是独立数据点，约每小时发一个（随机延迟 0 到 5 分钟），附 OS、渠道、安装周（仅安装后 90 天内）、国家（安装数少于 6000 的国家被去掉）、推荐码；到 Fastly CDN 边缘时剥掉 IP 与精确时间；设计目标是 Brave 无法把同一用户的不同答案关联起来；全部问题公开列出；可在设置里关。阶段二计划用 SGX 安全飞地合并多个答案。来源：https://brave.com/privacy-preserving-product-analytics-p3a/ 。后续：STAR（k 匿名，数据只在至少 k 个用户提交相同值后才可读）已并入 P3A（https://brave.com/privacy-updates/19-star/ ）；Nebula（用户侧阈值 + sample-and-threshold 的差分隐私，2024）（https://brave.com/blog/nebula/ ）。P3A 当前实际跑的是哪一套，本次未核实。
- k 匿名阈值：Brave STAR 的做法是“数据收集者只有在至少 k 个用户提交了相同值时才能读到它”，因此看不到独一无二的值，能找出“热门值”；Brave 声称它适合几十到几百万用户的规模。Brave P3A 阶段一另有“国家安装数少于 6000 就不报国家”的阈值。来源同上。
- Apple 差分隐私：在设备上先做本地差分隐私随机化，再传给服务器，服务器永远收不到清晰数据；去掉设备标识、丢弃 IP 与其它元数据；对每个功能设“每次贡献的隐私预算 epsilon”并限制每天贡献次数（如 Lookup Hints 一天 2 次 epsilon 4，emoji 一天 1 次 epsilon 4，QuickType 一天 2 次 epsilon 8，Health 一天 1 次 epsilon 2）；采用 opt-in；数据最多保留 3 个月；用户可在设置里看到上报的分析数据。来源：https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf 、 https://machinelearning.apple.com/research/learning-with-privacy-at-scale
- 注：以上技术除 k 匿名外，都需要特殊的客户端协议或额外一方运营中继、聚合器；单机自建服务端不能直接复现 OHTTP（需要独立的中继方）与 DAP（需要两个互不串通的聚合者）。这条是依据上述“两个独立方”的描述作出的推论，非官方原话。

## 9. 崩溃上报（Sentry）与使用统计的边界
- Sentry JavaScript SDK 默认收集（官方 Data Collected 页）：报错事件与堆栈（配置了的话含源码上下文，source map 由向导默认上传）；HTTP 请求与响应头（敏感头值替换为 [Filtered]）；Cookie（服务端默认收，浏览器端默认不收）；设备、浏览器、系统与运行时信息（浏览器由 User-Agent 得出）；用户 IP 地址“默认发送”（可用 dataCollection.userInfo=false 关闭，但 IP 仍可能经 X-Forwarded-For 等头、Cookie、查询参数带入）；Sentry 不会自动填 user.id、email、username，只有 setUser() 设的才发；客户端 SDK 默认不发堆栈局部变量，Node 类运行时的 Local Variables 集成默认开启。https://docs.sentry.io/platforms/javascript/data-management/data-collected/
- breadcrumbs（面包屑）：浏览器 SDK 自动记录“DOM 元素上的点击与按键、XHR 与 fetch 请求、console 调用、所有地址变化”，可用 beforeBreadcrumb 钩子改写或丢弃。https://docs.sentry.io/platforms/javascript/enriching-events/breadcrumbs/
- Electron：设备信息含平台、架构、可用内存、系统版本；原生崩溃会把每个线程的栈作为 minidump 发送，“默认处理完就丢弃，不存储”；窗口标题可能含个人信息，默认不抓（captureWindowTitles 可开）。https://docs.sentry.io/platforms/javascript/guides/electron/data-management/data-collected/
- Session Replay 默认遮盖所有文字、图片与输入；它不受 dataCollection 控制，有自己的隐私选项。同上 Data Collected 页。
- 保留期（Sentry SaaS）：错误事件开发者档 30 天，团队与企业档 90 天。https://docs.sentry.io/security-legal-pii/security/data-retention-periods/
- 与使用统计的边界（官方文字里只能确认的部分）：Sentry 把“错误事件”（含堆栈、breadcrumbs、设备、可选用户信息与 IP）当作与使用统计不同的数据类别，各类别用 dataCollection 与各集成选项单独开关，并有前置脱敏钩子（beforeSend、beforeBreadcrumb）与服务端脱敏。https://docs.sentry.io/security-legal-pii/scrubbing/ 。产品层面“崩溃上报开关与使用统计开关分开”的官方例子：Firefox 在其数据收集文档里把“提交带内存转储的崩溃报告”列为需要“具体的选择加入同意”的单独类别（因为转储可能包含 URL 等），与常规遥测分开。https://firefox-source-docs.mozilla.org/contributing/data-collection.html 。Go 工具链则把 crash stack 计数器也放进同一套按周计数与公开配置，且只含工具链自己的函数名与相对行号，不含路径（见第 2 节）。

## 10. 公开资料中直接比较“预聚合计数”与“事件流”的取舍
- 找到的直接论证（一手）：Russ Cox 的 Transparent Telemetry 系列：
  - 隐私：事件轨迹的隐私代价大、且必须限制访问；按周计数“让人明白无法重建任何细粒度的行为轨迹”；他批评 VS Code 的高分辨率事件“几乎没有新信息，却承担收集大量数据的声誉代价”。https://research.swtch.com/telemetry-intro 、 https://research.swtch.com/telemetry-design
  - 数据量：直接维护计数器而非从明细推导，“主要出于磁盘空间与更新延迟”；一份报告约 1,000 个计数器、约 50kB；每周 16,000 份报告合计约 800MB，Brotli 压缩后一年约 4GB。https://research.swtch.com/telemetry-design
  - 能回答的问题：每个图表需要的计数器、桶与误差先在公开配置里写明（“只收我们想看到的图”）；不能收任意值，只能用“已知值 + other”；遥测只是决策的输入之一。https://research.swtch.com/telemetry-design 、 https://research.swtch.com/telemetry-uses
  - 噪声：按周汇总在客户端去掉周末等波动。https://research.swtch.com/telemetry-design
- Homebrew 的文档从另一面说明预聚合与逐条事件的差别：其逐条事件的安装计数“计的是操作次数，不是独立用户”。https://docs.brew.sh/Analytics
- Aptabase 官方文档说明：不带持久标识的事件流无法给出 MAU 与留存。https://aptabase.com/docs
- 没有找到：一篇专门比较“客户端预聚合 vs 事件流”的中立工程博客或设计文档（在 Glean、Go、Mozilla、Brave、PostHog、Plausible 的官方站点范围内没搜到）；上面的论证都是各系统为自己的设计写的理由。Glean 的设计文档里 “counter 要让 Glean 自己计数、不要自己累计再设值”（避免与发送时刻的重置冲突）可算一条实现层面的取舍：https://mozilla.github.io/glean/book/reference/metrics/counter.html
