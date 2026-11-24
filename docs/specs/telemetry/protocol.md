---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: telemetry.protocol
owners:
  - nb-site-telemetry-contract
---

# 遥测：上报协议与收集清单

## 目标与非目标

定义 NeuroBook 应用与官方站统计模块之间的三种上报：每日上报、在线心跳、立即事件，以及哪些字段、哪些取值可以出现在里面（收集清单）。它是两边共用的合同：应用一侧何时发见 [`telemetry.client`](client.md)，服务端收到后怎么处理见 [`site.telemetry-ingest`](../site/telemetry-ingest.md)。

不承诺：

- 没有安装标识、账号标识、设备标识；任何上报都不带登录凭据。
- 不承载用户写的内容、文件名、路径、模型服务的地址。
- 诊断报告、反馈、问卷不在本协议里。
- 上报方的真实性无法验证。

## 术语与参与者

- **收集清单**：本 Spec 的字段表与取值表，分两档各带一个整数版本：匿名档、使用档。
- **上报编号**：发送方为一份每日上报或一条立即事件生成的随机串，只用于重发去重；不同的上报用不同的编号。
- **服务端日**：服务端按 UTC 算的日期。
- **分档**：把一个数映射到固定的几个区间之一；发出去的是区间的名字。

## 输入与前置条件

三个写入口在遥测写入口地址下，请求体是 JSON，至多 16 KiB；不需要也不接受登录凭据。

`POST /v1/daily`：

| 字段 | 档 | 取值 |
|---|---|---|
| `manifest` | — | `{"anonymous": 整数, "usage": 整数?}`，发送方所用清单的版本 |
| `reportId` | — | 22 到 64 个字符的随机串 |
| `appVersion` | 匿名 | 语义化版本号，至多 32 个字符 |
| `channel` | 匿名 | `canary`、`preview`、`stable` |
| `form` | 匿名 | `desktop`、`cli` |
| `os`、`osMajor`、`arch` | 匿名 | `windows`、`macos`、`linux`、`other`；系统大版本（清单里列出的取值，其余 `other`）；`x64`、`arm64`、`other` |
| `locale` | 匿名 | 清单里列出的界面语言，其余 `other` |
| `region` | 匿名 | 八个大区之一，由发送方从本机时区换算 |
| `daysSinceLast` | 匿名 | `first`、1 到 28 的整数、`more` |
| `installWeek` | 匿名 | 形如 `2026-W48` 的周；安装满 12 周后发 `older` |
| `usageEnabled` | 匿名 | 布尔 |
| `noticeSeen` | 匿名 | `wizard`、`workbench`、`settings` |
| `usage` | 使用 | 见下表；只在使用档打开时出现 |

`usage`（第一版只有“稳定性”一类）：

| 字段 | 取值 |
|---|---|
| `errors` | 至多 50 项 `{owner, code, count}`：`owner` 是清单里列出的内置插件 id，其余 `other`；`code` 是 1 到 64 个字符的小写字母、数字、点、下划线、连字符；`count` 是次数分档 |
| `crashes` | 次数分档 |
| `upgrade` | `none`、`succeeded`、`failed` |

次数分档（版本 1）：`0`、`1`、`2-4`、`5-9`、`10-49`、`50+`。

`POST /v1/heartbeat`：`manifest`、`appVersion`、`form`。

`POST /v1/event`：`manifest`、`reportId`、`appVersion`、`form`、`kind`（`crash`、`upgrade_failed`）、`code`（规则同上表的 `code`，可省）。

## 输出与可观察行为

1. **每日上报的回应。** 合格的每日上报得到 200 与 `{"serverDay": 服务端日, "duplicate": 布尔, "dropped": [被丢弃的字段名]}`。`serverDay` 是这份上报被记入的日期。
2. **重发去重。** 同一个 `reportId` 在 48 小时内再次到达时不重复记入，回应里 `duplicate` 为真，`serverDay` 是第一次记入的日期。
3. **不认识的字段。** 清单里没有的字段被丢弃并列在 `dropped` 里，其余字段照常记入。
4. **不合格的值。** 清单里有的字段取值不在表内时，整份上报被拒，回 400 与 `invalid_report` 及出问题的字段名。
5. **清单版本。** 服务端认识的每个版本各按自己的字段表与分档表校验与记入；`manifest` 里的版本比服务端认识的新时，匿名档的字段照服务端认识的最新版本处理（多出来的字段按输出 3），使用档整段丢弃并列在 `dropped` 里。
6. **使用档的出现。** `usage` 只在 `usageEnabled` 为真时被接受；为假却带了 `usage` 的上报被拒（`invalid_report`）。
7. **心跳的回应。** 合格的心跳得到 204，没有响应体。
8. **立即事件的回应。** 合格的立即事件得到 202；重发去重同输出 2。
9. **凭据被忽略。** 带了 Cookie 或 `Authorization` 头的请求照常处理，这些头不被读取、不被记录。
10. **限流。** 同一来源在短时间内请求过多时回 429 与 `Retry-After`；被限流的请求不记入。
11. **过大。** 请求体超过 16 KiB 回 413。

## 状态与转换

无会话、无握手；每个请求独立。

时序与寿命：

- 发送方在收到每日上报的 200 之前不能认为它已被记入；没有收到回应时用同一个 `reportId` 重发是安全的。
- 发送方拿上一次成功回应里的 `serverDay` 算下一份的 `daysSinceLast`（服务端日相减）；从未成功过时发 `first`。
- 同一个发送方在同一个服务端日里至多一份每日上报被记入由发送方保证，服务端不能核对。

## 副作用与数据

见 [`site.telemetry-ingest`](../site/telemetry-ingest.md)。

## 失败与恢复

| 码 | HTTP | 含义 | 发送方怎么办 |
|---|---|---|---|
| `invalid_report` | 400 | 取值不在清单内或结构不对 | 丢弃这一份，不重发 |
| `payload_too_large` | 413 | 请求体过大 | 丢弃这一份 |
| `rate_limited` | 429 | 来源被限流 | 等 `Retry-After` 秒后用同一个编号重发 |
| 5xx 或连不上 | — | 服务端不可用 | 退避后用同一个编号重发 |

## 边界与兼容

- 收集清单是公开合同，带中英文的字段说明；应用里的收集项说明与官网的“我们收集什么”由它生成。
- 清单的变更分三种，各自提高所属档的版本：只加取值或改说明；新增字段或改分档表；使用档新增类别。分档表改了算新的版本，不与旧版本的数混在同一个序列里。
- 写入口的路径带 `v1`；不兼容的改动用新的路径，旧路径保留到旧版本的应用不再上报。
- 信任边界：服务端把每个字段都当不可信输入。

## 验收与 Smoke

1. 同一份每日上报发两次：两次都是 200，第二次 `duplicate` 为真，聚合里只算一份。
2. 带一个清单里没有的字段：200，`dropped` 里有它，其余字段被记入。
3. `usageEnabled` 为假却带 `usage`：400。
4. 使用档版本比服务端新：200，`dropped` 里有 `usage`，匿名档字段被记入。

Smoke：合同测试包里对三个写入口各发一份合格上报的用例。

## 证据

- 批准依据：[本机统计、遥测与反馈](../../proposals/telemetry-stats-feedback.md)、[ADR 0062](../../adr/0062-telemetry-tiers-by-identifiability.md)
