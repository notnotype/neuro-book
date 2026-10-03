# Pi Request Trace Observability

## Status

本文档是 Pi 请求可观测层（trace 记录 / 查看 / 清理）的稳定契约与将来抽独立库的 runbook。历史决策与实现过程见 `.agents/tasks/86-pi-request-observability/`。

## 模块分层

分层原则：**可分离核心零 NeuroBook 依赖，全部 NeuroBook 耦合收敛在粘合层**。将来抽库时核心整体搬走，粘合层留在 NeuroBook。

| 层 | 文件 | 说明 |
| --- | --- | --- |
| 核心（后端） | `server/agent/observability/pi-request-recorder.ts` | writer：串行写队列、seq、retention、clearBucket、bucket/id 白名单。只依赖 node:fs/path，tracesRoot 与 onWriteError 由调用方注入。 |
| 核心（后端） | `server/agent/observability/pi-trace-reader.ts` | 只读 reader：listBuckets / listIndex / readRecord。只依赖 node:fs + recorder 类型。 |
| 核心（后端） | `server/agent/observability/traced-provider.ts` | 统一入口透明代理：`tracedStreamSimple` / `tracedCompleteSimple`，采集 + finalize 兜底 + 响应头过滤。只依赖 pi-ai + recorder。 |
| 核心（前端） | `trace-viewer/trace-view-model.ts`、`AgentTraceList.vue`、`AgentTraceDetail.vue` | 纯 props/events，只吃 `shared/dto/agent-trace.dto.ts`。注意：仍依赖 useI18n / CSS 主题变量 / JsonViewer（见「抽库剩余工作」）。 |
| 粘合 | `neuro-agent-harness.ts` 注入点 | 持有全局唯一 recorder 实例（注入 `repo.tracesRoot` + appLogger 包装的 onWriteError）；`piTraceSettings/piTraceBinding` 从 config 组装 binding；turn / compaction 等 provider 调用点。 |
| 粘合 | `server/api/agent/traces/**`（3 GET + 1 DELETE） | 参数校验转 4xx、从 `useAgentHarness().repo.tracesRoot` 取根；DELETE 必须复用 harness 的 recorder 实例。 |
| 粘合 | `AgentTraceViewerDialog.vue`、`useAgentTraceApi.ts`、设置面板 | $fetch、session 标题 join、trace↔session 跳转、config 开关 UI。 |

## 存储布局契约

tracesRoot 由调用方注入；NeuroBook 内为 `JsonlSessionRepository.tracesRoot`（= `<rootWorkspace>/.nbook/agent/traces`，`.nbook/agent/*` 布局知识统一收敛在 repo 类）。

```
<tracesRoot>/traces-seq.json        全局单调 seq 计数器（清空 bucket 不回收）
<tracesRoot>/<bucket>/<seq>.json    单条完整 PiTraceRecord
<tracesRoot>/<bucket>/index.jsonl   每 bucket 汇总行（列表只读它，不读全量 payload）
```

- bucket 命名白名单：`^\d+$`（sessionId）或 `_system`（无 session 的调用）。`isValidTraceBucket/isValidTraceId` 定义在 recorder，reader re-export；HTTP 路径参数必须先过白名单（防路径穿越）。
- retention：每 bucket 保留最近 `maxRecords` 条（config `observability.piTrace.maxRecords`，默认 100；0 = 不裁剪）。
- 写入 / prune / clearBucket 全部走 recorder 串行队列；record 为 best-effort（失败经 onWriteError 上报不抛），clearBucket 失败向上抛（用户显式动作要区分成败）但不毒化队列。

## 隐私边界

- trace 含完整 prompt / 小说正文，**绝不进入 task 72 的可分享日志包或任何导出诊断流程**；将来动导出 / 日志打包时必须复核。
- 请求侧 `options.apiKey / options.headers / options.metadata` 从不落盘（字段白名单组装 draft）。
- 响应头经 `sanitizeResponseHeaders` denylist 过滤后落盘：固定凭据头（set-cookie/cookie/authorization/proxy-authorization/www-authenticate）+ 名字含 token/secret/api-key 的头被删；**含 ratelimit 的头豁免**（`anthropic-ratelimit-*-tokens-*` 名字含 "token"，是限流排查的核心信息）；其余未知网关头保留 debug 价值。

## 统一入口约束

所有 provider 调用必须走 `tracedStreamSimple` / `tracedCompleteSimple`（binding 缺省等同关闭、零开销），禁止直接 import pi-ai 的 `streamSimple` / `completeSimple`。机器强制点是 `server/agent/observability/unified-entry-guard.test.ts`（扫描 `server/` 全部非测试 .ts）；allowlist 只有 traced-provider 自身与 `server/utils/model-settings.ts`（health-check 已划出 trace 范围）。新增合法直连点必须显式改 allowlist 并写明理由。

## 抽库剩余工作（runbook）

时机：出现第二个消费者或发布需求时再建仓；现状"机械可搬运"。

1. **搬运物**：recorder + reader + traced-provider + `agent-trace.dto.ts` 类型 + 前端 view-model/List/Detail + 各自测试。`nbook/*` 别名 import 改包内相对路径。
2. **前端三阻力**（搬运前解决）：
   - i18n：`t("agent.traceViewer.*")` 改 label props 注入或库内自带 locale。
   - 主题：组件用的 `--text-main` 等 CSS 变量走 nb-ui 的主题变量契约（见 task 85）。
   - JsonViewer：`app/components/common/JsonViewer.vue` 是通用组件，抽进 nb-ui 或库内复制一份。
3. **消费模式二选一**（参照先例）：
   - vendored sync（llmlint / task 84 模式）：sibling 仓为 truth，同步脚本拷回 NeuroBook。适合不发布 npm；缺点是 TS 源码 import 的 vendored 同步比独立 CLI 别扭。
   - npm 发布：peer-depend `@earendil-works/pi-ai`（正常 npm 包，可行），NeuroBook 走正常依赖。成本是发布流水线。
   - 注意：NeuroBook 生产构建（Portable/GHCR）不消费 sibling `link:`，本地 link 只适用于开发期。
4. **harness 注入点、routes、Dialog、设置面板留在 NeuroBook**（业务粘合，不搬）。
