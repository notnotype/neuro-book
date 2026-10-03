# Round 04 — 可搬运化 + 债务清零 (收尾轮)

2026-07-06。按批准计划执行(`可搬运化暂不建仓 / P2 挂起 / 加清空按钮`三项用户拍板)。目标:后端 core 零 NeuroBook 依赖、盘点出的债全部清掉、抽库 runbook 落档。

## 已交付

### 1. 后端 core 可搬运化

- `JsonlSessionRepository` 新增 `tracesRoot` getter——`.nbook/agent/traces` 布局知识从 recorder/reader 收敛到 repo 类（它本就独占 `.nbook/agent/*` 布局）。
- `pi-request-recorder.ts`:删 `appLogger` import(此后只依赖 node:fs/path);构造签名 `{rootWorkspace}` → `{tracesRoot, onWriteError?}`,写失败经注入回调上报(缺省静默);harness 构造处注入 appLogger 包装。`isValidTraceBucket/isValidTraceId` 从 reader 移入 recorder(bucket 命名 `_system` 本就是 writer 决定的),reader re-export 保持路由 import 面不变。
- `pi-trace-reader.ts`:构造签名改 `{tracesRoot}`。
- 调用点:harness 构造函数 + 3 个 GET route + 7 处测试构造行,typecheck 兜底全改。

### 2. response.headers 敏感头 denylist(关闭 headers 白名单 TODO)

- `traced-provider.ts` 新增 `sanitizeResponseHeaders`:固定凭据头(set-cookie/cookie/authorization/proxy-authorization/www-authenticate)+ 名字压缩后含 token/secret/apikey 的子串过滤;**含 ratelimit 的头先豁免**(`anthropic-ratelimit-*-tokens-*` 名字含 "token",是本功能核心 debug 价值,裸匹配会误杀)。未知网关头保留。
- 模块头注释矛盾修正:「请求侧 options.headers 从不落盘;response.headers 过滤后落盘」。
- 以 denylist 替代 README 原计划的"逐 provider 枚举白名单"——未知头保留比枚举更实用。

### 3. 统一入口机器强制(guard 测试)

- **前置重构**:`compaction.ts` 还留着 `input.trace` 缺省时走裸 `completeSimple` 的 fallback——正是统一入口要堵的洞。`tracedStreamSimple/tracedCompleteSimple` 的 binding 改可选(缺省等同关闭、零开销),compaction 无条件走统一入口,删掉裸 import。
- 新增 `unified-entry-guard.test.ts`:扫描 `server/` 全部非测试 .ts,禁止 allowlist 外直接 import `streamSimple/completeSimple`(命名空间 import 一律违规)。allowlist = traced-provider 自身 + `server/utils/model-settings.ts`(health-check 已划出范围;注意实际路径在 utils/ 不在 harness/)。仓库无 eslint、biome 未配置,模块级 import 限制会误伤合法的 pi-ai 类型 import,扫描测试是唯一可行的机器强制点。

### 4. 清空 bucket 入口

- `PiRequestRecorder.clearBucket(bucket)`:白名单校验 → 挂串行写队列执行 `rm`(maxRetries=2 缓解 Windows EBUSY);失败向上抛(用户显式动作要区分成败)但不毒化后续写队列;seq 不回收。
- harness `piTraceRecorder` 改 public readonly;新 route `DELETE /api/agent/traces/[bucket]` 复用 harness 的同一实例(串行队列前提,route 注释写死)。
- 前端:查看器 header 加 trash 按钮 → `useDialog().confirm` 确认 → 清空 → notification + 停留原 bucket 刷新;`useAgentTraceApi.clearBucket` + `AgentTraceClearResultDto` + i18n 4 key(zh/en)。
- 顺手关闭「孤儿 trace 目录」TODO(session 无硬删除流程,查看器清空入口即解法)。

### 5. 测试补强

- recorder +2(clearBucket 只清目标/seq 不复用/非法拒绝;与在途 record 串行)。
- traced-provider +3(binding 缺省透传不落记录;sanitize 直测两例,ratelimit 豁免钉死)。
- 新 `trace-view-model.test.ts` 6 例:invocation 分组(连续折组/隔断不合并/无 id 独立)+ context 形状探测(标准解析/toolResult note/非法形状降级不 throw)。
- `harness-trace.test.ts` 两个集成测试超时 20s → 40s:测试本体 ~14s,机器负载下会翻车(本轮全量跑时超时过一次,单跑稳定绿)。

### 6. 文档

- 新增 `reference/agent/pi-trace-observability.md`:模块分层、存储布局契约、隐私边界、统一入口约束、抽库 runbook(前端 i18n/主题/JsonViewer 三阻力的解法方向、vendored vs npm 消费模式取舍);`reference/agent/README.md` 加索引。
- 本 README TODO 同步(见下)。

## 验证

- `bunx vitest run server/agent/observability server/agent/harness/compaction.test.ts app/components/novel-ide/agent/trace-viewer` → **33 通过**(guard 一次过 = compaction 洞已堵、allowlist 正确)。
- `bun run typecheck` → 0 error。
- 全量 `bun run test`:两轮失败集不重合(第一轮 llmlint EBUSY/EPERM,第二轮 workspace-files/catalog/web-tools 等,单独重跑全绿)→ 判定为全量并发下的既有环境串扰(black-box 超时是 P0 已证实的既有问题);真失败只有 1 个,见「绕道」。

## 绕道 / 出入

- **修了一个 task 87 的陈旧测试**(跨任务小触碰):`server/openapi/generate-spec.test.ts` 还断言 plot chapter 两条路径的 `chapterPath` query 参数,而 task 87 已把 route-map 硬切为 `chapterId`(`route-map.ts:153`)——全量回归跑出的既有红灯,与本轮改动无关,按 route-map 现状把断言改为 `chapterId`(4 行)。
- 其余按计划执行,无偏离。P2 重放与真正建仓按用户决定继续挂起。

## 下一步

- 前端手动验收仍未执行(P1 起挂账):跑 agent → 查看器 → 清空按钮 → 设置开关,清单见 README「P1 验证」;可授权 Agent 浏览器验证。
- 抽库时机到来时按 `reference/agent/pi-trace-observability.md` runbook 执行。
