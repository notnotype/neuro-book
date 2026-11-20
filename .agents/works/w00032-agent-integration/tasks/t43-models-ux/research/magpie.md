调研对象 magpie 提交 9494a38（2026-11-20），日期 2026-11-20。

# Magpie 服务商与模型设置调研

说明：Magpie 是 Go 写的本地网关，界面是系统 webview 里的一个大 `internal/gui/assets/app.js`（约 2.5 万行，无前端框架）。下文路径都相对 magpie 仓库根；后文单写 `app.js` 指 `internal/gui/assets/app.js`，`pasteread.js`、`proxies.js`、`balfound.js` 同在该目录；行号取自该提交，个别区间是读到的大致范围。只读源码，没有运行任何东西，也没有读 `~/.config/magpie/` 里的密钥文件。“服务商”在 Magpie 里叫 provider，“模板”叫 preset。

## 1. 服务商图标

结论：三层来源。(a) 模板自带的图标是随程序打包的 lobehub/icons 文件，按名字引用；(b) 用户自定义服务商可以上传文件、填图片 URL、让程序按 Base URL 抓站点 favicon、用“名字首字母色块”、或从内置图标网格里挑；(c) 所有“用户给的图”都以内容哈希命名存进 `~/.config/magpie/icons/`，服务商里只存 `file:<哈希>.<扩展名>`。

### 1.1 内置图标：打包的 lobehub/icons

- `internal/gui/assets/icons/` 里 216 个文件，其中大多是 lobehub 的 SVG（带 `-color` 后缀的是彩色版，`kling-color.svg` 内部 id 形如 `lobe-icons-kling-0-...`，是 lobehub 导出物的特征）；少数 PNG 是 Magpie 自己加的第三方应用图标（`internal/gui/assets/app.js:375` 的 `pngIcons` 集合）。
- 出处声明只有一句：`docs/reference.md:88-89`“brand icons from lobehub/icons”。`THIRD_PARTY_NOTICES` 里没有 lobehub 的条目（只列了 moejs、CLDR 等），仓库里也没找到单独的图标许可证文件。
- 模板的 `Icon` 字段就是这些文件名（`internal/provider/presets.go:26-27` 的 `PresetDef.Icon`，例如 `presets.go:200` 的 `claude-color`）。保存时服务商 `Icon` 为空就取模板的（`internal/provider/provider.go:2053-2054`）。
- 没有模板的图标另有一份名单：`internal/gui/assets/app.js:8571-8587` 的 `MORE_ICONS`（约 90 个，注释说是用户反馈“内置图标太少”后补的），与所有模板图标合并去重，在选图网格里用。
- 渲染：带 `-color` 或在 `pngIcons` 里的当 `<img>`，其余 SVG 当 CSS mask（单色，随主题着色）；加载失败退回 `generic` 线框图标（`app.js:378-420`，函数 `icon(name)`）。

许可证：lobehub/lobe-icons 仓库自述为 MIT（我从 GitHub 页面核对：“This project is MIT licensed. Copyright 2023 LobeHub”，页面没有谈商标）。MIT 只覆盖 lobehub 的图形文件；这些图形画的是各厂商的品牌标志，商标归各厂商，lobehub 页面没说明二者的关系，Magpie 也没写。这一点是“没有记录的结论”，NeuroBook 若打包同一批图标要自己判断商标风险。

### 1.2 运行时抓取：站点 favicon（只给自定义服务商）

- 入口 `internal/provider/favicon.go:36` `FaviconFor(ctx, base, name)`，HTTP 路由 `internal/gui/providers.go:1863` `POST /api/icons/favicon`，界面里是编辑器的“Get icon → Automatic”（`app.js:8663`、菜单项在 `app.js:8657-8659`）。
- 抓取顺序（`favicon.go:71-93` `faviconSites`、`:95-147` `favicon`、`:262-` `pageIcons`）：先试 API 主机本身，再逐级去掉前缀域名直到两段（`api.deepseek.com` 再 `deepseek.com`）；每个站点读首页 `<head>` 里的 `<link rel="icon">`，排序为 SVG、较大的 apple-touch-icon、其余按页面顺序，最后才试 `/favicon.ico`；`data:` URI 也接受。首页最多读 512 KB，整个流程 30 秒超时。
- 特例（`favicon.go:153-` `statusLogo`）：new-api / one-api 面板所有站的 `/favicon.ico` 都是面板自己的图，所以先问 `/api/status` 取站点自配 logo，没配就不用站点图，改用“名字首字母色块”。注释里记着这是用户抱怨“每个中转站都是 new-api 的图标”之后加的。
- 只抓公开 https 主机：`favicon.go:75-77` 对内网/本机地址直接报错；`internal/provider/icon.go:100-127` 的 `guardClient` 在拨号时再检查解析结果不是私网地址（防 DNS 重绑定），并兼容 Clash/Surge 的 fake-ip（198.18.0.0/15，`icon.go:217-222`）。
- 另一个自动触发点：往“添加”框里粘贴一段 URL+密钥时，粘贴解析成功后自动调用 favicon 抓取（`internal/gui/assets/pasteread.js:198`）。

### 1.3 用户怎么改图标（只有自定义服务商有）

`app.js:10043-10044` 写着：`// A user-defined provider can have its own picture; presets keep theirs.` 只有 `custom` 服务商渲染图标选择器 `iconPicker`（`app.js:8589-8745`），含：

1. “Choose a picture…”：本地文件，`accept` 为 PNG、JPEG、GIF、WebP、ICO、SVG（`app.js:8598`）；页面把文件读成 base64 放进 JSON 提交（`app.js:8606-8612`，原因是桌面 webview 不给 scheme handler 传 File 体），服务端 `POST /api/icons`（`providers.go:1838`）。
2. “Get icon”下拉三项（`app.js:8654-8664`）：Automatic（站点图标）、Image URL…（`POST /api/icons/url`，`providers.go:1878`，`favicon.go:50` `IconFromURL`）、Letter icon（名字首字母色块）。
3. “Built-in icons”：展开网格，带“Find an icon…”搜索框（`app.js:8666`、`8693-8715`）。
4. “Default”：清空图标（`app.js:8668-8671`）。
- 填过的图片 URL 会记在 `Provider.IconFrom`（`provider.go:62-65`），只是记录，不会再次抓取；图标不是 `file:` 时 `IconFrom` 被清掉（`provider.go:1292-1293`）。
- 图片地址不可用时不报错退出，而是回退为字母色块并把原因放进 `failed` 字段，界面提示“That picture couldn't be used, so the icon is the name's letters: …”（`favicon.go:54-69`、`app.js:8641`）。
- 字母色块 `letterIcon`（`favicon.go:217-247`）：CJK 名字取第一个字，否则取前两个词首字母或单词前两个字母；颜色是名字的 FNV 哈希取 hsl 色相，生成一个 64x64 的 SVG 圆角方块，再走同一个存储函数。

### 1.4 存储与缓存：`~/.config/magpie/icons/` 的 350 个文件

- 存储函数 `internal/provider/icon.go:49-72` `StoreIcon`：上限 1 MiB（`icon.go:31`）；按魔数识别类型（`icon.go:264-286`，`http.DetectContentType`，SVG 靠前 1 KB 内含 `<svg`）；文件名 = `sha256(内容)` 前 8 字节十六进制 16 位 + 扩展名（`icon.go:33` 的正则 `^[0-9a-f]{16}\.(png|jpg|gif|webp|ico|svg)$`），同一张图只存一份；服务商字段存 `file:<名字>`（`icon.go:28`）。
- 提供图片：`GET /api/icons/{name}`（`providers.go:1891`）。PNG/JPEG/WebP 长边超过 256 像素时，首次访问生成 256 像素的 PNG 副本放在缓存目录 `icons-small/`（`internal/provider/icon_small.go:16-98`，注释说有 1254 px 的图每张占 6 MB webview 内存）。
- 清理：`icon.go:288-318` `pruneIcons` 在保存服务商时删除没有任何服务商/插件/合作方引用、且超过 1 小时的文件。
- 我本机目录的构成（只用 `ls` 与插件图标索引的结构，没读密钥文件）：350 个文件，共约 12 MB（185 svg、144 png、12 ico、7 webp、2 jpg）；`plugin-icons.json` 里有 358 条“URL 哈希 -> file:…”映射，其中 344 个文件被它引用。也就是说**这 350 个文件的绝大多数不是用户给服务商选的图，而是 Magpie 的“插件市场”和“合作方”列表里的远程图标**：`internal/provider/plugin_icon.go:33-52` `MarketIcon` / `:102-` `pluginOwnIcon` 把插件注册表给出的 https URL 或 `data:image` 抓下来，同样走 `StoreIcon`，失败 1 小时后重试；合作方（赞助商）列表来自 `https://usemagpie.ai/api/partners`（`internal/provider/partners.go:35`），其图标由 `partners.go` 的 `fetchPartnerIcon = FetchIcon` 抓取，`keptPartnerIcons`（`partners.go:537-555`）让清理逻辑留着它们。剩下 6 个应是用户上传/抓取/字母色块或导入链接带来的，我没法从目录里区分。
- 隐私：从远程抓用户之外的图标（插件、导入链接、合作方）一律绕道 `https://usemagpie.ai/api/icon?url=...` 代理，不让图标托管方看到用户 IP（`internal/iconproxy/iconproxy.go:1-28`，`internal/provider/icon.go:78-89`）。用户自己填 URL 和抓 favicon 则是本机直连（走系统代理）。

### 1.5 可借鉴点（本节）

- 图标按内容哈希存文件、服务商里只存一个引用，天然去重、可清理；1 MiB 上限与按魔数判类型很朴素。
- “抓 favicon”必须做 SSRF 防护（私网拒绝、解析结果复检），且对 new-api 类面板要特判，否则全是同一个默认图。
- 抓不到时用“名字首字母+哈希色”的色块兜底，比通用占位图好区分。

## 2. 服务商模板（preset）

结论：模板是写死在 Go 源码里的静态表（约 70 个内置，另有从 usemagpie.ai 拉取的赞助合作方），添加页按“分区 + 自适应多列网格 + 一个搜索框”组织。**从模板建出来的服务商与自定义的并不一视同仁**：模板服务商的协议地址、图标、模型列表地址、目录、余额地址等在界面里只读或不显示，只有自定义服务商可改；模板之间也不能在建好后互相切换。

### 2.1 模板有哪些字段

`internal/provider/presets.go:24-94` `PresetDef`，常用的：

- 身份与展示：`ID`、`Name`、`Short`（名字长时添加页用的短名）、`Icon`（内置图标文件名，见第 1 节）、`Kind`（vendor 厂商、relay 中转、local 本机、remote 另一台电脑的 magpie，`presets.go:12-21`）、`Note`（名字下一行说明）、`Sponsored`（置顶并带标签）。
- 协议地址：`Chat`、`Responses`、`Anthropic`（各一个基地址；另有 `Decide`，一种“决策接口”，服务商自己的 `Gemini` 地址在 `Provider` 里有，见第 3 节）。
- 目录与外链：`Catalog`（models.dev 的 id，见第 5 节）、`Website`、`KeysURL`（“Get a key”链接）、`KeyHint`、`NoKey`（本地服务可不填密钥）。
- 变体：`Regions`（`presets.go:96-` `Region`，同一模板的多个基地址或套餐，每个 region 可覆盖自己的协议地址、密钥页、官网、目录、模型名单）、`RegionLabel`、`KeyPlans`、`Endpoint`/`EndpointHint`（Azure 这类需要用户填自己资源地址的）、`NoList`+`Models`（没有 /models 接口的厂商，如 Bedrock，由模板给模型名单）、`Only`（只留某前缀的模型）、`HeaderHints`（厂商文档里的可选请求头，编辑器提示用户加）。
- 非对话模型：`Embeddings`、`Rerankers`、`Drawers`、`Videos`、`Speakers`、`Transcribers`。
- 创建：`FromPreset`（`presets.go:995-1010`）把模板的 ID、名字、图标、三个协议地址、目录、官网、密钥页**复制**进一个 `Provider`，并记 `Provider.Preset = 模板 id`（`internal/provider/provider.go:66`）。此后服务商自己存一份地址。
- 合并：`Presets()`（`presets.go:870-883`）返回时赞助模板排在各自分类的最前。

### 2.2 添加页的组织

`internal/gui/assets/app.js:7252-7420` `renderAdd` / `drawTiles`：

- 顶部一行：搜索框“Find a vendor, or paste a URL and key…”（`app.js:7275`；搜索命中名字、id、协议主机名、说明文字，含翻译后的说明，`app.js:7314`）、按钮“Custom provider”（提示“any OpenAI or Anthropic compatible URL”，`app.js:7288-7291`）、按钮“Import…”（导入其它应用里配置好的服务商，`app.js:7292-7294`）。
- 其下是分区，每区一个标题加一句话说明，区内是网格，一行多个（`app.css:3681` `.sheet .grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)) }`，代码注释“three to a line”）：
  1. Partners（赞助合作方，带“Become a sponsor”按钮和一次性的高亮动画；名单来自 usemagpie.ai，可按页面语言过滤，`app.js:7326-7352`）
  2. Subscriptions（“sign in, no key”，登录订阅账号而不是填密钥）
  3. From plugins（插件带来的登录入口）
  4. Removed from magpie（已移除但仍登录的）
  5. Vendors（“the makers' own APIs”）、Relays（“one key, many vendors”）、On this machine、Another computer's magpie（`app.js:7405`）
- 同一厂商的国际与中国站是两个模板（id 约定 `xxx` 与 `xxx-cn`），在添加页合并为一行（`pairTile`，`app.js:7510-7516`），进编辑器后用“Global / China”分段按钮选（`app.js:9554-9570`）。已经添加过的模板显示“已添加”并直接打开已有的那个，要再加一个需要走“Add another”（`app.js:7558-7570`）。
- 搜不到时出现“Nothing called ... / Add it as a custom provider / look for a plugin”（`app.js:7412-7420`）。

### 2.3 模板服务商与自定义服务商的差别

判定在 `app.js:9512`：`custom = !pr && !p?.account`（没有模板且不是账号型）。

- 自定义服务商的编辑器有：Name、Base URL + 协议分段（OpenAI 兼容 / Responses / Anthropic / Gemini / Decide，`app.js:9648-9720`）、“Detect”按钮、“More endpoints”（其它协议的 URL）、Models URL、Catalog、Balance URL、图标选择器、TLS 证书、socket 等（`app.js:10044`、`10369-10440`）。
- 模板服务商：名字（可改，留空取模板名，`app.js:9601-9606`）、ID（建好后可改，引用它的 agent 和路由组一起迁移，`app.js:9608-9625`）、密钥、模型挑选、Advanced（Headers、Extra body 等）都可改；协议地址只读展示（“Endpoints”行，`app.js:10369-10383`、`renderEndpoints` 在 `app.js:11133-`，旁边有“Test”按钮对每个协议端点发一个极小请求）；地址只能通过 Region 分段按钮在模板预设的几个之间切（`app.js:10269-10300`）；图标是模板的，`app.js:10043` 明文写“presets keep theirs”。
- 我没搜到“把模板服务商转成自定义”的入口（搜了 convert/detach/as custom/Preset = ""）。“复制”（`duplicateProvider`，`app.js:9477`）对模板服务商仍保留 `preset`。结论：模板之间不能互改；想改协议、地址、图标只能另建一个自定义服务商（粘贴 URL 与密钥会自动识别协议并抓图标，见第 3、1 节）。
- 服务端兜底：保存时若 `Icon`、`Catalog`、`Website`、`KeysURL` 为空，就用模板的补上（`provider.go:2052-2069`），且跟随 Region（`provider.go:2070-2084`）；模板改了端点后有 `movedEndpoints` / `presetAliases` 迁移旧数据（`presets.go:885-` ），所以“模板”是随版本演进的、用户只持有引用 id。

### 2.4 可借鉴点（本节）

- 分区（厂商 / 中转 / 本机）加一个能搜名字、id、主机名的搜索框，对 70 个以内的条目足够；“搜不到则建自定义”的出口很自然。
- 同厂商的国际站/中国站合并为一行是个小设计，避免列表翻倍。
- 反面：模板与自定义的编辑能力不对称，用户想给模板服务商换个地址或图标就没路。NeuroBook 若要“模板只是预填”，应当让模板创建的服务商完全可编辑，模板仅提供默认值。

## 3. 协议检测

结论：不是嗅探 URL 或读响应头，而是**向同一个端点按四种协议各发一个最小的真实对话请求，HTTP 2xx 就算该协议可用**，四个并行发；界面把每种协议的地址、通过/失败、耗时或错误一行行列出，点“Use these”才把通过的协议地址写进表单（失败且是 404/405 的会被清空）。协议名单是 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages、Gemini generateContent（另有给路由组用的 System One“决策接口”，单独探）。

### 3.1 触发与入口

- 只在自定义服务商的编辑器里有“Detect APIs”按钮（`internal/gui/assets/app.js:11260-11330` `detectAPIs`；按钮提示“Send the smallest request to each API ... at this URL, to see which answer”）。旁边有一个“model to try”输入框（留空则自动选）和“Each picked model”按钮（逐个已选模型 x 每种协议做一张表）。
- 后端路由 `internal/gui/providers.go:3131-3185` `case "detect"`：用表单当前的值（包括尚未保存的 URL、密钥；已保存服务商的密钥会被沿用），不写盘，不路由。普通检测超时 25 秒，逐模型检测 2 分钟。
- 另一条“零按钮”路径：在添加框里粘贴 curl 命令或 `KEY=...`/`BASE_URL=...` 环境变量时，`internal/gui/assets/pasteread.js` 的 `curlOf` / `envOf` / `plainOf` 直接解析出基地址与密钥，协议只用 URL 路径粗判：路径含 `/anthropic` 或 `/claude` 当 Anthropic，否则当 OpenAI chat（`pasteread.js:213` `urlAPI`），随后异步抓 favicon（第 1 节）。这条是启发式，不发请求。

### 3.2 发什么请求

`internal/provider/detect.go`：

- 协议顺序 `detectProtocols = Chat, Responses, Anthropic, Gemini`（`detect.go:28`），用户只输入一个 URL 时，`DetectBase`（`detect.go:44-68`）把它整理成每种协议要的形状：先剥掉粘贴进来的整段端点后缀（`/chat/completions`、`/responses`、`/v1/messages`、Gemini 的 `:generateContent`），Anthropic 取根（去掉 `/v1`），OpenAI 两种在裸域名上补 `/v1`，Gemini 补 `/v1beta`。已经单独填了某协议地址的，就用它自己的（`detect.go:131-163` `detecting`）。
- 请求体在 `internal/provider/test.go:239-` `tinyBody`，都是一句 "hi"、16 个输出 token：
  - Chat：`POST {base}/chat/completions`，`{"model","messages":[{"role":"user","content":"hi"}],"max_tokens":16}`；对 OpenAI 自家、Azure、Bedrock 改用 `max_completion_tokens`（它们拒绝 `max_tokens`）。
  - Responses：`POST {base}/responses`，`input` 里一条 `input_text`，`max_output_tokens:16`。
  - Anthropic：`POST {root}/v1/messages`，带 `anthropic-version: 2023-06-01`，`max_tokens:16`（`test.go:875-` `probeOnce` 设置头）。
  - Gemini：`POST {base}/models/{model}:generateContent`（`GeminiPath`），密钥走 `x-goog-api-key`，`generationConfig.maxOutputTokens:16`。
  - Embedding / rerank 模型只能打 OpenAI 基地址的 `/embeddings` 或 `/rerank`，其它协议直接标“该模型走另一端点”（`detect.go:176-186`、`test.go:125-157`）。
- 用哪个模型：用户填的；没填就从“表单里已选的模型”，再不行从该服务商已有模型列表，再不行现场 GET 一次 `/models`（`detect.go:87-110` 与 `:322-` `detectModels`）。每种协议挑“为它造的”模型：Anthropic 挑 Claude，Responses 挑 OpenAI 系，Gemini 挑含 gemini 的，Chat 挑非 Claude（`detect.go:348-377` `detectModel`）；跳过绘图和检索模型。
- 并发：四种协议一个 goroutine 各一个；逐模型检测最多 30 个模型、同时 8 个请求、每个等 12 秒（`detect.go:242-246`）；单个探测默认等 20 秒，连接 10 秒连不上就判定主机不可达，同次检测里对同一主机的其它请求直接复用这个失败（`test.go` 的 `testWait`/`connectWait`/`unreached`）。

### 3.3 怎么判定

`internal/provider/test.go:875-1060` `probeOnce`：

- 2xx 即通过；若请求是流式，还会读到第一个有内容的事件或错误事件，流里 200 之后才报错也算失败（`streamAnswer`，`test.go:1065-`）。
- 其它状态码保留状态码并取响应体前 4 KB 解析出错误文字（`APIError`）。
- 为了容错的自动重试（`test.go:815-873`）：404 时若基地址缺 `/v1`，改打 `base/v1/...` 再试一次，通过就把 `/v1` 记下来，界面用 `Result.V1` 修正地址；Chat 的 400 若错误里说该用另一个长度字段（`max_tokens` / `max_completion_tokens`）就换字段重发；错误里要求 `stream=true` 的后端就改流式重发；Anthropic 只认 `x-api-key` 或只认 `Authorization` 的网关，会换另一种认证头再试（`RetryOneAuth`）。
- 对“模型存在但不在这个协议下提供”的 4xx（如 "not a chat model"、"use v1/responses"、`unsupported_api_for_model`），标 `otherAPI`，表示这是别的协议的事，不是密钥问题（`internal/catalog/catalog.go:2542-` `WrongEndpoint`）。
- 没有任何“请求头/响应头指纹”类的判断，也没有“只探 /models”的做法；`/models` 只用来挑测试用的模型。

### 3.4 呈现给用户

- 结果每个协议一行：协议名（OpenAI / Responses / Anthropic / Gemini，悬停有“most agents / what Codex speaks / what Claude Code speaks”之类说明）、解析出的基地址、对勾或叉、耗时或 `状态码 · 错误`，悬停显示所用模型，失败项旁有“复制错误”按钮（`app.js:11287-11302`）。
- 一个“Use these”按钮：通过的协议填进对应 URL，404/405 的清空，点完变成“Taken · save to keep”（还要点保存才落盘）。
- 若检测的是某个具体模型且只有部分协议通过，会出现“Ask {model} on {api} only”按钮，把这个模型钉到那个协议上（存到模型设置的 `api` 字段，`app.js:11306-11320`、`stageAPI`）。
- “Each picked model”产出一张模型 x 协议的网格，单协议通过的模型会被自动分配到那个协议（`app.js:11335-11390`）。
- 另有每个**已建好的**服务商都能点的“Test”（`app.js:11133-` `renderEndpoints`）：对已配置的每个端点各发一次最小请求，行内显示结果。检测用于“还不知道支持啥”，测试用于“已配置的是否可用”。

### 3.5 可借鉴点（本节）

- “真实发一条 16 token 的请求”比任何嗅探都可靠，代价是花一点点钱、需要密钥；四协议并行 + 20 秒上限，体验可接受。
- 把“检测”和“采纳”分成两步（Use these），用户能看到每种协议的原始错误并复制。
- 针对中转站的细碎容错（缺 `/v1`、字段名、必须流式、认证头）累积了大量特判，NeuroBook 若做可只先做缺 `/v1` 与认证头两项。

## 4. 代理

结论：三级。应用级一个字符串（空=自动，`direct`=直连，其它=代理地址或对“已保存代理”的引用 `@id`），服务商级同样形状（空=跟随应用级），再往下还有每个密钥/账号级。“自动”不是读一个来源，而是按固定顺序依次尝试环境变量、操作系统代理设置、登录 shell 里的 `*_PROXY`。支持 `http://`、`https://`、`socks5://`、`socks5h://`，另外有一种自家扩展的 `ssh://`（程序自己登录 SSH 服务器并起本地 SOCKS5 隧道，类似 `ssh -D`）。

### 4.1 数据形状

- 应用级：`internal/settings/settings.go:153-156` `Proxy`（`""` 跟随环境再系统，`"direct"` 不走代理，其它是代理；注释“http://, https:// or socks5://; host:port means http”）；另外还有 `ProxyCustom`（切换到直连或自动后记住上次自定义的地址，再选“自定义”时能找回，`settings.go:157-162`）、插件下载专用的 `PluginProxy`、更新专用的 `UpdateProxy`（各自“跟随上面 / 直连 / 自定义”，`settings.go:163-`）。
- 已保存代理：`internal/settings/proxies.go:21-45` `NamedProxy{ID,Name,URL,User,Pass,Key,HostKey}`，任何能选代理的地方都可以存 `@<id>` 引用，改一处全部生效；用户名密码分开存（`settings.json` 为 0600，页面拿不到密码）；校验函数只接受 `http, https, socks5, socks5h`（`proxies.go:212-217` `checkAddress`），`ssh://` 另有登录校验。
- 服务商级：`internal/provider/provider.go:544` `Proxy` 字符串，同样的取值；`AccountProxies`（`provider.go:550`）按“密钥指纹 / 账号名”再细分。
- 选择函数 `Provider.ProxyChoice`（`internal/provider/proxy.go:49-70`）：先看这把密钥/这个账号有没有自己的代理，没有用服务商的，再没有就是空串；`Provider.Via(ctx)`（`proxy.go:24-45`）把选择塞进请求的 context（`netproxy.With`）。

### 4.2 三种模式怎么实现

界面上服务商里叫：“Global proxy / Direct / Custom”（再加“Saved”，`internal/gui/assets/app.js:7903`），应用级设置里叫：“Auto / Off / Custom”（再加“Saved”，`app.js:20945`），插件下载与更新那两行叫“Same as above / Direct / Custom”（`app.js:20964`）。

- 服务商级覆盖应用级：`internal/netproxy/netproxy.go:77-96` `Func` 是装在 `http.DefaultTransport.Proxy` 上的函数，`netproxy.Install`（`netproxy.go:34-46`）负责安装。顺序：回环地址一律直连；请求 context 里带了服务商选择（`choiceOf`）就用它（`forChoice`：`direct` 返回 nil，其它 `Parse`）；否则走应用级 `For`。更直接的是 `dispatch` 这层 RoundTripper（`netproxy.go:231-` ）：请求带了服务商自己的代理，就用该代理单独克隆一份 Transport（最多缓存 32 份），连接池因此不会把走 A 代理建立的 HTTP/2 连接借给走 B 代理的请求；全局代理改了会关掉旧空闲连接。
- “直连”：`forChoice("direct")` 返回 nil（`netproxy.go:193-198`）；应用级“Off”存的是同一个 `direct`。
- “自动 / 跟随全局”：`For(u)`（`netproxy.go:394-`）按顺序：①设置里的 `Proxy`（`direct`/自定义，非空就不再往下）；②环境变量，`http.ProxyFromEnvironment` 再补 `ALL_PROXY`（`fromEnv`，`netproxy.go:602-`，含 `NO_PROXY` 规则）；③操作系统代理 `System()`（见下）；④登录 shell 里 `export` 的 `*_PROXY`（`netproxy/shell.go`：从桌面启动的程序没有终端环境变量，这是为 Clash 之类让用户在 `.zshrc` 里 export 的场景加的，回环地址的代理要端口正在监听才采用）。前面任何一步找到就停。局域网地址（私网、链路本地、100.64/10、`.local`）在没有服务商自带代理时一律直连（`netproxy/lan.go:1-50`）。
- 读操作系统代理（`netproxy/system_*.go`，结果缓存 15 秒，没有代理时只缓存 2 秒，读取最多等 2 秒，`netproxy.go:672-733`）：
  - Windows：注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings` 的 `ProxyEnable` / `ProxyServer` / `ProxyOverride`，解析 `http=h:p;https=h:p;socks=h:p` 与 `<local>`（`system_windows.go:12-27`、`windows.go`）。
  - macOS：执行 `scutil --proxy` 解析（`system_darwin.go`、`scutil.go:35-73`），HTTPS 优先，其次 HTTP，再次 SOCKS（得到 `socks5://`）。
  - Linux：KDE 会话读 `~/.config/kioslaverc`，否则 `gsettings list-recursively org.gnome.system.proxy`（只认 mode 为 manual，PAC 的 auto 不读），两者互为备选（`system_linux.go:15-62`、`desktop.go:15-`）。其它系统视为没有。
  - 读到的是 `Proxy{URL, HTTP, SOCKS, Bypass}`，对话请求只用 `URL`（HTTPS > HTTP > SOCKS 的优先次序）。
- “自定义”：地址输入框 + 可选用户名/密码两个框（`app.js:20970-` `proxyRow`；用户名密码在保存时折进 URL，`proxyAddress` 做 URL 编码，`proxyFields` 能把粘贴的 `user:pass@host` 拆开，`app.js:20882-20895`）。placeholder 是 `http://127.0.0.1:7890`；没写协议头按 http 处理（`Parse`，`netproxy.go:511-525`）；服务商级提示语“Requests to it go through this proxy: http://, https:// or socks5://”（`app.js:7851-7856` `PROXY_HINT`）。
- 命令行代理工具（子进程）：`EnvWith`（`netproxy.go:427-`）按同一套选择把 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`/`NO_PROXY` 写进被启动的 CLI（Codex、Claude Code 等）的环境。

### 4.3 呈现与验证

- 应用级设置里有一行副标题把“正在生效的来源”说出来：`settings`（你设置的）/ `system`（跟随系统代理）/ `environment`（跟随 HTTPS_PROXY）/ `off` / `down`（找到的代理没响应，请求直连直到它恢复）/ `none`（没找到）（`app.js:20932-20945`、`netproxy.go:527-` `Describe`）。
- “Test”按钮（`app.js:21044` 的 `renderProxyCheck`；后端 `internal/gui/proxycheck.go`）：通过代理和直连各请求一次 `https://www.cloudflare.com/cdn-cgi/trace`，比较两条路径出口的 IP 与国家，并判断连接是否真的连到了代理（源码注释专门讨论了 TUN/VPN 下两个地址相同的情形）。服务商编辑区在选了“已保存代理”时，旁边也有一个 Test（`internal/gui/assets/proxies.js:45` `proxyPickTest`）。
- 代理连不上时的错误会被翻译成人话（`netproxy/why.go:37-80`：比如对 HTTP 代理却得到 SSH 横幅会说“answered, but not as this kind of proxy: check whether it is HTTP, SOCKS5 or SSH”）。

### 4.4 可借鉴点（本节）

- “自动”应该是有序降级链并把当前来源说出来；对 NeuroBook 在 Linux/macOS/Windows 上读系统代理，各有现成做法可抄：Windows 注册表、macOS `scutil --proxy`、Linux 读 gsettings/kioslaverc；至少环境变量那一级必须有。
- 服务商级覆盖用“同形状字符串”最省事；每个代理单独一份连接池这点要注意，否则 HTTP/2 连接会跨代理复用。
- “已保存代理 + 引用”让多个服务商共用同一个代理配置，改一处全生效。

## 5. 模型发现与“添加全部”；模型目录

结论：没有一个显式的“添加全部”按钮，而是“没挑就是全给”的默认语义：新服务商不勾选任何模型时，自动取服务商 `/models` 列表，列表不超过 24 个就全部提供给 agent，超过 24 个只给前 24 个（取厂商列表原顺序，厂商通常新的在前）；编辑器里另有“Pick all / Pick none / Pick those shown”按钮和 `AutoInclude` 通配规则。模型目录（能力、上下文、价格）来自开源的 models.dev 的 `api.json`，程序里内置一份快照，运行时每天在线更新一次，所以不更新程序也能拿到新模型。

### 5.1 模型发现

- 列表来源（`internal/provider/models.go:838-` `fetchOne`）：用户填了 Models URL 就只问那里（`ModelsURL`，`provider.go:651`）；否则对该服务商**每个有地址的协议**各问一次它的模型列表，合并去重（同一模型在多个协议的列表里算一个，图像能力取交集）；Azure、Vertex、Bedrock 等有各自的方式（部署列表、模板里给定的 `Models`+`NoList`）。用户可以勾掉“Fetch the model list”（`ListOff`，`provider.go:652-661`）完全不请求列表，只用手输的 id。
- 什么时候取：新服务商不勾选时，界面文案说“保存后由 magpie 去取列表”；保存时服务端的做法是：服务商可用且没关闭、密钥是新的或有变化，就同步调用一次 `p.Fetch`，最长等 8 秒（`internal/gui/providers.go:2801-2815`），所以添加成功时列表通常已经取到了；同一处还会给新加的密钥取各自的模型列表（`PrefillNewKeys`）；编辑器里“Fetch models”按钮（`internal/gui/assets/app.js:11191`，已保存的是“Fetch models again”，`app.js:12269`）手动取；输入框提示“Optional: Fetch models to pick from the vendor's list, or type ids; none picked, magpie asks for the list after saving.”（`app.js:10331`）。登录型账号则启动时和刷新时批量取（`FetchNew`，`models.go:728-758`，每个最多 8 秒）。
- 定时刷新：每个服务商可设 `RefreshEvery`（如 `30m`、`6h`、`1d`，最短 10 分钟；`internal/provider/autolist.go:41-70`），网关每分钟检查一次谁到期（`KeepListsFresh`，`autolist.go:270-284`），失败后 15 分钟重试。重取时厂商已下架的、用户之前勾选过的模型会从勾选里去掉（`Refetch` 注释，`models.go:311-322`），用户手输的 id 保留。
- 自动纳入新模型：`AutoInclude` 是对模型 id 的通配规则（`provider.go:705-708`，`autolist.go:170-210`）：重取列表后，新出现且匹配的模型自动加入勾选；规则只增不减，用户取消勾选的模型不会再被加回来。
- “全给”的实现（`models.go:1789-1858` `Exposed` / `ExposedOf`）：用户有勾选 → 用勾选；没有 → 模板自带的 → 否则厂商列表；若 `BestInFamily`（“Best in family”开关）则每个模型系列只留最新的一个（`catalog.BestInFamily`）；列表不超过 `manyModels = 24`（`models.go:30`）就全给，超过只给前 24 个，源码注释说“Show the first slice of the vendor's own list ... let the user pick from the rest; nothing here is compiled in”。“Select none”是显式的 `NoModels`，勾选了任何模型就会清掉它（`provider.go:663-670`、`1901-1908`）。
- 编辑器里的挑选界面（`app.js:11205-11260`）：模型以“芯片”显示，超过 24 个多出一个过滤框，按钮“Pick all”（有过滤词时变“Pick those shown”）、“Pick none”，计数“N of M picked”；超过 120 个只画已勾选的，其余点“Show the other N”再展开。

### 5.2 模型目录（能力、上下文、价格）从哪来

- 数据源：<https://models.dev/api.json>（`internal/catalog/catalog.go:585` `modelsDevURL`）。每个模型的字段读取在 `catalog.go:438-486` `mdModel`：`reasoning` 与 `reasoning_options`（推理档，见第 6 节）、`modalities.input/output`、`limit.context/input/output`（上下文与最大输出）、`cost`（美元/百万 token，含缓存读写与分档价、`experimental.modes` 里的 fast/flex 档）、`release_date`、`family`、`canonical_model_id`（用来把不同厂商对同一模型的不同命名归并）。另有第二份“实验室目录” `models.json`（`catalog/labs.go:1-45`，按模型制造商而非托管商，只含与托管无关的事实），主目录里没有的模型可以从它补描述。
- 服务商怎么对上目录：服务商（或模板）的 `Catalog` 字段是 models.dev 的 provider id，可写多个“openai, deepseek”按顺序匹配（`provider.go:2086-2092` `Catalogs`；编辑器 `app.js:10419`：“Display names, reasoning levels and list prices for the models; for a gateway that serves several vendors, list them all, first match wins”）。自定义中转站可以自己填，也有用户在服务商或模型上手填上下文、最大输出、价格覆盖（`ModelPrices` 等，`settings.go:1180-1190`）。
- 内置快照：`internal/catalog/bundled/api.json.gz`（约 600 KB 压缩，`catalog/bundled.go:21-36`，`bundledAt` 2026-11-10），注释说明原因：在中国大陆网络下首次启动连不上 models.dev，没有目录就没有价格、窗口、推理档、名字。刷新方式是 `go generate`（`bundled.go:28`）。
- 在线更新：`internal/catalog/fresh.go`
  - `KeepFresh`（`fresh.go:44-60`）由应用后端（`internal/gui/backend.go:86`）和 `magpie serve`（`internal/cli/providers_cli.go:1740`）以 goroutine 启动：每小时检查一次，缓存文件超过 24 小时（`staleAfter`，`fresh.go:19`）就重取；失败时 2 分钟后重试并翻倍退避，上限 1 小时。
  - 某次调用的模型没有价格时，`Missing()`（`fresh.go:76-`）在后台补取，但距上次尝试要超过 6 小时（`missingAfter`）。
  - 单次请求 30 秒超时（`fetchBound`，`fresh.go:131`），响应上限 64 MiB，先验证是合法 JSON 且非空才写入，写文件用临时文件加 rename，字节相同则只更新时间戳不触发重新计算（`catalog.go:916-975` `Sync`）。
  - 读取顺序（`catalog.go:654-700`）：Magpie 自己的缓存 `~/.cache/magpie/models.json` -> OpenCode 的缓存 `~/.cache/opencode/models.json` -> 内置快照；读不出来的文件跳过换下一个。本机实测 `~/.cache/magpie/models.json` 约 6.8 MB，`labs.json` 约 530 KB，修改时间是今天 04:06。
- 没有“从服务商 `/models` 里读上下文/价格”的路径：多数 OpenAI 兼容端点的 `/models` 不含这些，所以只靠目录；目录没有的模型会靠“同名家族”推断（例如 `mdProvider.levels` 对新模型借同系列的推理档，`catalog.go:516-545`）或用户手填。

### 5.3 可借鉴点（本节）

- “没勾选就等于列表里的前 24 个；勾了才限定”这个默认值，让新增服务商立刻可用，同时避免把几百个模型塞给 agent。
- “取消勾选的不再被自动加回”的规则对 `AutoInclude`/刷新很关键。
- 目录采用“内置快照 + 每天在线更新 + 失败指数退避”的组合，既离线可用又能跟上新模型；用 models.dev 作单一数据源意味着 NeuroBook 不必自己维护模型能力表。

## 6. 思考档/推理等级

结论：模型的推理档就是 models.dev 里的一个字符串列表，原样当作该模型的“可用档位”；用户可以逐模型勾选保留哪几档；agent 侧用滑块或下拉选其中一档；某模型没有已知档位时给一个通用七档让用户勾，全不勾表示“不发任何推理字段”。

### 6.1 表示

- 目录里的形状：`reasoning`（布尔，是否会思考）和 `reasoning_options`（数组，元素 `{type: "effort"|"toggle", values: [...]}`），`internal/catalog/catalog.go:446-450`。`effort` 给出具体档位如 `low/medium/high`，`toggle` 表示只有开关；`internal/catalog/catalog.go:499-514` `efforts()`：只对少数已验证接受 `none` 的服务商（`reasoningOffProviders`，deepseek、两个 kimi-code，`catalog.go:488-494`）把“关”加成一档，其它服务商保持目录原样，因为它们可能拒绝 `none`。
- 目录没给档位但标了会思考的新模型：借同一 family 里发布时间不晚于它的最新思考模型的档位（`catalog.go:516-545` `levels`）。
- 通用档位表（兜底）：`Levels = none, minimal, low, medium, high, xhigh, max`（`internal/provider/modelprefs.go:234`）；路由组里给成员固定档位用同一张表 `MemberEfforts`（`internal/provider/groupeffort.go:41`），写法 `provider/model:high`。
- 在 UI 排序用的次序：`off, none, minimal, low, medium, high, xhigh, max`（`app.js:4961` `EFFORT_ORDER`）。

### 6.2 界面怎么调

- 逐模型保留档位：服务商编辑器的“Model settings”（按钮提示“Rename the models agents see, set what each costs at this provider, or offer fewer of their reasoning levels”，`app.js:12321`）里，每个模型一行复选框列出它的所有档位（`app.js:12040-12075`）：保留的发给 agent，没保留的不提供（对应后端 `settings.ModelEfforts`，`modelprefs.go:241-` `SetModelEfforts`；注释说明“请求里要别的档位仍照发给厂商”）。全部勾上等于“全部提供”；全部取消勾选会设置 `reasonless`，界面提示“No reasoning field sent”，网关不再给该模型发任何推理字段，即使 agent 要求。档位未知的模型（`m.given`）显示通用七档让用户勾，勾哪个就当它支持哪个。
- 模型清单上的徽标：把档位压成一个小芯片，三档以上显示“最低–最高”（`effortSpan`，`app.js:7116-7120`），悬停显示全部；路由组显示成员共有的档位（`app.js:7122-7133` `modelInfo`）。
- agent 页的“当前档位”选择：用“越亮越多的条”的小图标表示高低（`effortIcon`/`effortBars`/`effortLit`，`app.js:4951-5008`，一格对应列表中的一档，关/none/auto 记 0 格），展开后是一根带刻度点的滑块（`effortSeg`，`app.js:5011-`，可键盘操作，ARIA `slider`，写入有排队避免快速拖动乱序），两端标出最低、最高档名；档位值不在选项里时当作单独一格插入滑块；“默认”显示成 `default (medium)` 这样带出实际值。
- 对不能承载推理档的 agent（Cursor），Magpie 自己存一个按 agent 的档位，网关在请求里替换（`internal/provider/agenteffort.go:1-45`）。

### 6.3 可借鉴点（本节）

- 档位直接用字符串列表、顺序即强弱；UI 不需要知道每档的含义，只要有序列表加一个 UI 排序表，未知值单独成格。
- “按模型限制可选档位”和“全不选 = 不发推理字段”两个小开关，对中转站的非标准模型很实用。

## 7. 其它值得 NeuroBook 借鉴的服务商/模型设置体验

1. **把厂商文档里的示例直接粘进添加框就能建服务商。** 搜索框 placeholder 是“Find a vendor, or paste a URL and key...”；粘贴 curl 命令、`KEY=...` 环境变量、JSON、或“地址+密钥”两行，都会被解析成名称、基地址、协议、密钥、模型，打开一个已填好的自定义服务商编辑器，并说明“Filled in from the pasted text: ...”，占位密钥（`$KEY`、`<API_KEY>`）会被识别并提示“粘你自己的”；同时异步抓站点图标（`internal/gui/assets/pasteread.js:8-` `curlOf`、`:84-` `envOf`、`:178-205` `pastedProvider`）。对写 Agent 的人来说，厂商文档几乎总给 curl 示例，这是最短路径。
2. **“测试”体系分三层并且能复制错误。** 服务商级“Test”对每个已配置协议发最小请求并行内显示耗时或 `状态码 · 错误`；“Test models”对 agent 看得到的每个模型各发一次（右键单测一个，多密钥时用第一把能服务它的密钥）；失败行旁有“复制错误”按钮便于交给 agent（`app.js:11133-11170`、`12285-12320`）。测试请求会写进请求日志，便于事后查（`probelog`，`test.go:803-806` 的注释）。
3. **逐模型的“Model settings”。** 改显示名、改价格（中转站有倍率，`priceRate`）、限定可见推理档、固定“只走某个协议”（Auto 或 OpenAI/Responses/Anthropic/Gemini）、覆盖上下文/最大输出（`app.js:11850-12080`，`internal/provider/modelprefs.go`）。这些覆盖都存在设置里、按“服务商/模型”为键，不写进服务商的模型列表，所以重取列表、升级、重启后都不丢（`modelprefs.go:13-20` 注释）。
4. **导入别的应用里已配好的服务商和“导入链接”。** “Import...”按钮读取 CC Switch、Alma、Claude Code 自己的设置、OpenCode 的登录等，只读不写，逐条标出“新增 / 已在 / 会占用已有 id”，用户勾选才加入（`internal/provider/importapps.go:1-40`）；`magpie://import?preset=...&key=...` 或 `?name=&chat=&anthropic=&models=&catalog=` 链接让厂商给用户发一键配置（`internal/provider/importurl.go:11-40`）。
5. **中转站余额自动探测，可关闭。** 手填的中转站没配余额地址时，程序会按两个已知路径试探：sub2api 的 `/v1/usage`，再是 new-api/one-api 的 `/api/usage/token`，只带密钥；找到的结果缓存 24 小时、没找到缓存 6 小时（`balance_probe.go:15-30`）。成功后在编辑器里显示“找到的地址”，带“Use”按钮复制到字段、带“Auto-detect”开关可关闭（`internal/provider/balance_probe.go`、`internal/gui/assets/balfound.js:1-25`）。

### 补充观察（不在要点内，供设计时避坑）

- Magpie 的服务商编辑器非常重（一千多行的 JS 函数 `drawEditor`（`app.js:9511-10620`），有数十个高级字段，如 TLS 固定、连接地址覆盖、并发/队列/每分钟限速、备用服务商、路由权重），产品范围远大于 NeuroBook 的“服务商与模型”页；借鉴时取上面几个点即可，不要照搬字段量。
- 它的“模板”和“自定义”是两条路径（见第 2 节），代价是两套编辑器分支；NeuroBook 若让模板只当预填值，可省掉这类分支。
- 许可证：Magpie 本体 MIT（`LICENSE`），可参考其思路；其内置的 lobehub 图标 MIT，但图形里是各厂商品牌标志，是否可再分发要自行评估（第 1 节）。
