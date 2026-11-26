---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: network.egress
owners:
  - nbook.network
---

# 网络出口与代理

## 目标与非目标

NeuroBook 自己发起的对外请求（模型对话与检测、服务商的模型列表、OMP 的在线目录、协议检测、网页工具的搜索与读取、“测试代理”）都经同一个网络出口选路：按用户的代理设置走代理或直连，选不出路时报带原因的错误、不发请求。用户在设置窗口的“网络”页设应用级的代理，在服务商详情的“高级”里给某家另设。

不承诺：
- SOCKS 代理与自动配置脚本（PAC、自动发现 WPAD）：报不支持，提示改用代理软件的 HTTP 端口（决定 21）。
- 代理地址里的用户名与密码（自定义地址不收；环境变量与系统设置里带的照用，界面不显示）。
- 跟随重定向：出口不改 `redirect`，由调用方决定（模型请求 `error`，列表与在线目录 `manual`，网页工具 `manual`）。
- 本机中继、按域名的分流规则、代理链。
- 选路前做 DNS 解析：本机与私网只按主机串判断。
- macOS 的系统代理读法没有在真机上验证（按 `scutil --proxy` 的输出格式实现）；只读全局设置，按网卡或域名的配置（`__SCOPED__`）不读。
- Windows 的“自动检测设置”（WPAD）不读：它在 Windows 上缺省开着、多数网络里找不到配置，系统自己退回手动设置或直连；按手动设置与 `AutoConfigURL` 判断。
- GNOME 的设置存在 keyfile 后端、文件读不了时，`gsettings` 自己答“没设”且退出码为 0，分辨不出读不到。

## 术语与参与者

- **出口**：nb-host 的 `@notnotype/nb-host/network`（`createEgress`），与应用无关；`nbook.network` 插件持有设置项、服务键与网络页。
- **路**：一次请求交给 Bun 按次 `proxy` 的值：代理地址，或 `false`（直连）。
- **旁路**：本该走代理，但目标是本机、私网，或在旁路清单（`NO_PROXY`、系统设置的例外）里，于是直连。

## 输入与前置条件

设置项（都只允许用户层，都由网络页画）：

| 键 | 形状 | 缺省 | 含义 |
|---|---|---|---|
| `nbook.network/proxyMode` | `"system"` \| `"custom"` \| `"direct"` | `"system"` | 跟随系统、自定义、直连 |
| `nbook.network/proxyUrl` | 字符串，≤ 2048 | `""` | 自定义时的代理地址 |
| `nbook.network/catalogAutoUpdate` | 布尔 | `true` | 模型列表与在线目录的自动更新（读它的是模型服务，见 [`models/service.md`](../models/service.md) 输出 25） |

服务商自己的代理：服务商配置的 `proxy`（[`models/service.md`](../models/service.md) 输入），`{mode: "system"}`、`{mode: "direct"}` 或 `{mode: "custom", url}`；不写是跟随应用。

启动环境：`HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY`、`NO_PROXY`（大小写都认，小写优先）；读系统设置用 `XDG_CURRENT_DESKTOP`、`XDG_CONFIG_HOME`、`HOME`；`NBOOK_NETWORK_TEST_URL` 换掉“测试代理”的目标（测试用）。

公开接口：服务键 `networkKey`（`routeFor(override?)`、`fetchFor(override?)`、`describe(target?, override?)`），远程合同 `nbook.network/settings` 版本 1（`describe`、`test`）。

## 输出与可观察行为

1. **最内层总是显式写 `proxy`**：每个对外请求交给 Bun 的按次 `proxy` 要么是代理地址，要么是 `false`；不写时 Bun 会读进程环境的 `HTTP_PROXY`、pi-ai 会按 `PI_PROXY` 自己加，选路就不归设置管。
2. **本机与私网总是直连**：主机是 `localhost`、`*.localhost`、回环、私网、链路本地（含 IPv4 映射的 IPv6）时不走代理，说明里写旁路。
3. **直连**：`direct` 时一律 `proxy: false`，盖过进程环境的代理变量。
4. **自定义**：地址只收 http 或 https、不带用户名密码（服务端写设置与服务商配置时都拒收；设置文件里手写的不合规地址在选路时报 `proxy-invalid`）；目标命中环境的 `NO_PROXY` 时直连、说明写旁路（Bun 对显式的代理同样按它旁路）。
5. **跟随系统**：先按目标的协议取启动环境的 `HTTPS_PROXY` 或 `HTTP_PROXY`，再 `ALL_PROXY`，按 `NO_PROXY` 旁路；环境都没有时读操作系统设置：Linux 的 KDE（`kioslaverc`）或 GNOME（`gsettings`），macOS 的 `scutil --proxy`，Windows 的注册表（`Internet Settings`）；手动的按协议取地址（GNOME 的 HTTPS 没单独设时用 HTTP 的，HTTP 代理开了认证时带上用户名密码），按系统的例外与启动环境的 `NO_PROXY` 旁路；系统没设直连。旁路清单认通配、子域名、端口、IPv4 与 IPv6 网段、IP 字面量（按规范化后的地址比）、Windows 的 `<local>`。系统设置读一次缓存 60 秒，命令 2 秒没答就报读不到（不等它收尾）。
6. **选不出路时不发请求**：码 `proxy-unsupported`（SOCKS、自动配置脚本或自动发现、KDE 的反向例外“只有例外走代理”）、`proxy-invalid`（地址不合规）、`proxy-unreadable`（系统设置读不到：命令失败、超时、输出认不出来、配置文件读不了；Linux 上没有 gsettings、配置文件不存在算“没设”）。模型请求以 `local` 类别交回这个码，不重试；列表与在线目录以 `proxy` 失败；协议检测那一行的码是它；网页工具得 `unreachable`、详情写原因；“测试代理”的结果写它。
7. **服务商的代理盖过应用的**，每个请求现读：改了代理从下一个请求起生效，已有的会话不用重新解析；改了服务商的代理，它的连接版本跟着变（协议检测的结果置灰）。
8. **说明**（`describe`）：某个目标（缺省是测试目标）在现在的设置下怎么走：方式、`route`（`proxy` 走代理、`bypassed` 旁路、`direct` 没有代理）、来源（设置、环境变量名、哪种系统设置、没设、本机）、代理的协议主机端口、有没有用户名密码、选路的错误；不含用户名与密码。
9. **测试代理**（`test`）：经选出的路 `GET https://www.cloudflare.com/cdn-cgi/trace` 一次（外联清单），10 秒截止、不跟随重定向、响应读至多 16 KB，交回出口 IP（`ip=` 一行，不是 IPv4 或 IPv6 时为 null）与耗时；调用方中止即取消。选路出错时不发；目标旁路或直连时结果里的 `route` 如实写，界面不说“通了”。
10. **网络页**（设置窗口“通用”分组，page 分区 `nbook.network`，只在用户标签下可用）：
    - 小组“代理”：代理方式（三段）；自定义时多一行代理地址（失焦或回车写，不合规的原位写原因、不写）；跟随系统时代理方式下面写现在用的代理与来源，系统没设写直连，选不出路写原因（危险色）；自定义时只在出错或旁路时写；直连时不写。
    - “测试代理”（直连时没有这一行）：点了先交出地址框的草稿、等写完再测；进行中按钮换成“取消测试”；结果写出口 IP 与耗时，没走代理时写“测试目标没有走代理”，失败写原因；改了代理设置后旧结果清掉；离开页面取消在跑的测试。
    - 小组“模型目录”：自动更新的开关；“现在更新”写上次更新的时间与模型数、还没取过、这台机器关掉了在线目录或读不到状态，进行中写“更新中”，上次失败写原因（经模型服务的 `refreshCatalog` 与快照的 `catalog`，[`models/service.md`](../models/service.md)）。
    - 界面不写选路规则的解释（[设计语言](../../../packages/nb-ui/docs/design-language.md)“界面不靠说明文字解释自己”）。
11. **凭据不出服务端**：服务商配置里手写进去的自定义地址带用户名密码时，模型服务的快照只交去掉凭据的地址，这样的地址选路时报 `proxy-invalid`；代理在错误正文里回显 `Proxy-Authorization` 时，凭据（密码、`用户:密码`、Basic 的值）从模型错误与检测原文里遮掉；说明不含用户名与密码。

## 状态与转换

- 选路无状态；系统设置的读取结果缓存 60 秒（成功与失败都缓存），并发的读共用一次。
- 时序与寿命：设置每次选路现读，改了设置下一次请求就按新的走；“测试代理”的请求随调用方的中止或 10 秒截止结束；网络页离开时取消在跑的测试，旧的说明或测试结果晚到不覆盖新的。

## 副作用与数据

只读环境变量与操作系统设置，不写；设置项存在用户层设置文件。对外请求只有用户发起的“测试代理”是出口自己发的（目标见输出 9）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `proxy-unsupported` | 代理是 SOCKS 或自动配置脚本、自动发现 | 改用代理软件的 HTTP 端口，或在网络页填自定义地址 |
| `proxy-invalid` | 地址不合规（自定义为空、不是 http/https、带用户名密码，或环境变量里写错） | 改地址 |
| `proxy-unreadable` | 系统的代理设置读不到 | 改用自定义或直连 |

“测试代理”另有 `unreachable`（连不上）、`timeout`、`cancelled`、`bad-response`（测试目标没回 200）。

## 边界与兼容

- 公开接口：`@notnotype/nb-host/network`（与应用无关；harness 与模型服务不依赖它，只按 `NetworkRoute` 的形状收选路函数），`networkKey`，远程合同 `nbook.network/settings` 版本 1。
- 已知行为：Bun 对显式的代理也按进程环境的 `NO_PROXY` 旁路，出口用启动环境的同一份规则判断并写 `false`，两边的匹配写法不完全一致时以出口的说明为准；Bun 对回环目标不走代理。
- 升级：段 C 之前模型请求一律直连（决定 29）；之后缺省跟随系统，设了环境代理的用户模型请求改走代理。“自动更新模型列表”的键从 `nbook.models/catalogAutoUpdate` 换成 `nbook.network/catalogAutoUpdate`（旧键没有发布过）。

## 验收与 Smoke

1. 应用级的自定义代理：一轮对话、检测与重新拉取都经本机代理到达端点；服务商改成直连后不再经代理，已有的解析从下一个请求起换路；清除后又跟随应用。
2. 进程环境设了代理、出口直连：代理一个连接也没收到。
3. 环境里的代理是 SOCKS：检测、协议检测、重新拉取与网页工具都报代理的原因，请求没发出去。
4. 网络页：切到自定义、填地址写进设置；测试代理经本机代理取到出口 IP；直连时没有测试一行；自动更新的开关写进设置；390 宽不横向溢出。

Smoke：`packages/neuro-book/e2e/network.e2e.ts`。

## 实现合同

- 公开入口：`@notnotype/nb-host/network`（`createEgress`、`EgressError`、`EGRESS_TEST_URL`）；`nbook/plugins/network/shared/contracts`（`networkKey`、`networkSettingsContract`、`networkSettings`）；nb-harness 的 `NetworkRoute`、`DIRECT_ROUTE` 与 `OmpTarget.route`、`ResolveHooks.route`、`listModels`/`fetchOnlineCatalog`/`probeProtocol` 的 `route`。
- owner 与依赖方向：`nbook.network` 的服务端入口依赖设置与启动环境，`nbook.models`、`nbook.web` 的服务端入口依赖 `networkKey`；网络页依赖 `nbook.network/settings` 与 `nbook.models/settings`。
- 不变量：harness 没收到选路函数时用 `DIRECT_ROUTE`（直连），不读进程环境；选路失败在 `ompCall` 里与发出前的地址核对走同一条路（记下、中止整次调用、优先交出），各协议不重试。

## 证据

- 批准依据：w00032 t43 决定 5、7、13、16、21、22、25、29、32（[Task README](../../../.agents/works/w00032-agent-integration/tasks/t43-models-ux/README.md)），[计划](../../../.agents/works/w00032-agent-integration/tasks/t43-models-ux/plan.md)的段 C。
- 实现入口：[`packages/nb-host/src/network/egress.ts`](../../../packages/nb-host/src/network/egress.ts)、[`packages/neuro-book/src/plugins/network/backend/plugin.ts`](../../../packages/neuro-book/src/plugins/network/backend/plugin.ts)、[`packages/neuro-book/src/plugins/network/web/components/NetworkPage.vue`](../../../packages/neuro-book/src/plugins/network/web/components/NetworkPage.vue)
- 合同测试：[`packages/nb-host/src/network/egress.test.ts`](../../../packages/nb-host/src/network/egress.test.ts)、[`packages/neuro-book/src/plugins/network/network.test.ts`](../../../packages/neuro-book/src/plugins/network/network.test.ts)、[`packages/neuro-book/src/plugins/models/models.test.ts`](../../../packages/neuro-book/src/plugins/models/models.test.ts)、[`packages/neuro-book/src/plugins/network/web/components/NetworkPage.dom.test.ts`](../../../packages/neuro-book/src/plugins/network/web/components/NetworkPage.dom.test.ts)
- Smoke：[`packages/neuro-book/e2e/network.e2e.ts`](../../../packages/neuro-book/e2e/network.e2e.ts)
