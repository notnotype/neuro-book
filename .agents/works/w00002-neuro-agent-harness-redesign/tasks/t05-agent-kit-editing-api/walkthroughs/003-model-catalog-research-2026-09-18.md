# t05 追加范围：model catalog 调研（决策前取证）

日期：2026-09-18。来源：开发者要求「agent-kit 提供一个 model catalog（要最全面的，pi、omp 都有，还有第三方 models.dev 之类），并包含更新功能」，并注明**需讨论**。本文件是讨论用的取证记录，**未实现任何代码**。

取证方式：两个只读 scout 并行调查（`ModelCatalogPiOmp`、`ModelCatalogThirdParty`），全部数字为 2026-09-18 实测；未实测的一律标注「未验证」。

## 一、第三方数据源（实测）

| 数据源 | URL | 规模（实测） | 体积 | 关键字段 | 更新 | 许可 |
| --- | --- | --- | --- | --- | --- | --- |
| **models.dev** | `https://models.dev/api.json` | **221 providers / 7,842 models** | 4,689,924 B | provider：`id/env/npm/api/name/doc`；model：`cost{input,output,reasoning,cache_read,cache_write,input_audio,output_audio,context_over_200k,tiers[]}`、`limit{context,input,output}`、`modalities{input,output}`、`reasoning_options[]`、`tool_call`、`structured_output`、`knowledge`、`release_date`、`status`、`open_weights` | 小时级（GH Actions cron `17 * * * *` 按 provider 矩阵同步 → 自动 PR/merge → Cloudflare 部署）；`ETag` 可用 | MIT（仓库）；ToS 未验证 |
| **LiteLLM 价表** | `model_prices_and_context_window.json` | 4,307 顶层条目 / 132 providers | 2,793,090 B | 价格维度最细：per-token / audio / image / second / search、priority、batches、above-200k/272k/128k 阶梯；`max_input_tokens`/`max_output_tokens`、`mode`、`deprecation_date`、`supports_*` | 每日多次 bot 提交 | MIT（`enterprise/` 除外） |
| **OpenRouter** | `https://openrouter.ai/api/v1/models` | 445 models | 738,674 B | **`architecture.tokenizer`（唯一带分词器信息的源）**、`pricing`（per-token + 分时段 overrides）、`canonical_slug`/`alias_target`、`top_provider{context_length,max_completion_tokens,is_moderated}`、`supported_parameters`、`reasoning` | 连续更新，`max-age=120` | ToS 未验证 |
| llm-prices.com（备选） | `current-v1.json` | 条目数未验证 | 未验证 | `{id,vendor,name,input,output,input_cached}`；历史时间线 | `updated_at` 落后约 14 天 | 未验证 |
| 官方 provider API | 例 `api.openai.com/v1/models` | 各自覆盖 | — | 通常仅 `id/created/owned_by` | 实时 | 各 provider 条款；匿名 401 |

`models.dev` 另有派生视图：`models.json`（模型本体：`license/links/weights/benchmarks`，无 cost）、`catalog.json`（体积/条目数未测）。

三源标识符互不兼容：models.dev 用 AI SDK 风格 `provider/model`；OpenRouter 用带日期的 `canonical_slug` 与 `~alias`；LiteLLM 用 `litellm_provider` 前缀键且**存在仅大小写不同的重复键**（实测 `together_ai/baai/...` 与 `together_ai/BAAI/...`，PowerShell 5.1 `ConvertFrom-Json` 直接拒绝解析）→ 聚合层必须保留原始键、不得 case-fold 归一。

## 二、pi 与 omp 的目录形态（实测）

| 维度 | pi | omp |
| --- | --- | --- |
| 载体 | `@earendil-works/pi-ai` 包内 `dist/providers/data/<provider>.json`（**39 个**文件 + `.manifest.json` 3.45 KB）→ `*.models.js` → `models.generated.ts` | 独立包 `@oh-my-pi/pi-catalog`（`src/models.json`，**10.45 MB**、约 13.7k 行） |
| 生成来源 | `scripts/generate-models.ts`，输入是 **models.dev 形状**数据 + OpenRouter reasoning 元数据；发布前烘焙 | `scripts/generate-models.ts`，来源为 stencil.so + provider discovery + OpenCode docs；另 `compat/rules.json` 由 KDL 树编译 |
| 记录字段（样例实测） | `id,name,api,baseUrl,provider,reasoning,input[],cost{input,output,cacheRead,cacheWrite}(+tiers),contextWindow,maxTokens,compat{…约 25 项},thinkingLevelMap{off…max}` | 同左 + `thinking{mode,efforts[],effortMap,effortBudgets}`,`identity{class}`,`supportsComputerUse`,`requiresGlyphTokenization`,`compat{约 20 项}`；价格支持 `timeBased`（峰谷时段/effectiveRates） |
| 运行时更新 | 目录否；pi-ai 对动态 provider 提供 `refreshModels()`（`allowNetwork/force`）+ `ModelsStore` 持久化 | **有**：`model-manager` 2h TTL 磁盘缓存（默认 `<agent-dir>/models.db`）、5min 非权威重试、`online/offline/online-if-uncached` 策略、`ModelsDevFallback`（可 `additiveOnly`）兜底 |
| 用户覆盖 | `~/.pi/agent/models.json`，custom wins（provider+id），`modelOverrides` 可覆盖内置 | `~/.omp/agent/models.yml`，provider/model 双层 + `modelOverrides`，旧 `models.json` 自动迁移 |
| 许可 | 发布包根**未见 LICENSE**（仓库 LICENSE 未读取）→ 未验证 | MIT（Can Bölük / Stencil Labs），另有 1.03 MB THIRD-PARTY-NOTICES 未读 |

## 三、本仓库现状（实测）

- **没有自建模型清单**：全仓检索 `models.dev|model-catalog.json|modelCatalog` 零匹配（宽模式命中的多为 `contextWindow`）。
- 唯一真相源是锁定的 `@earendil-works/pi-ai@0.80.6` 内置表；本地只有薄层：`server/models/model-library.ts`（只读 Model Library，字段 `id/name/source/reasoning/thinkingLevelMap/input/contextWindowTokens/maxTokens`，**无 cost**）、`provider-template-library.ts`（24 模板，仅 3 个带模型快照）、`utils/pi-model-cost.ts`（价格归一化，负数哨兵=未知）、`models/discovery.ts`（四个 provider `/models` 发现 adapter，5 MiB/30s 上限，11 个稳定错误码）。
- 模型 key 规则既有：`buildModelKey(providerId, modelId) = "providerId/modelId"`。
- 现状缺口：价格在 Model Library 里没有；llmlint 的价格恒为 0；harness 明确「Core 不内置 tokenizer」，`contextWindow` 曾因无来源暂缓（ADR 0038）。

## 四、讨论要点（待开发者决策，未开工）

1. **边界**：agent-kit 是否承载网络更新，还是只做装载/合并（网络与缓存由宿主注入）。
2. **数据源组合**：单源 models.dev，还是 models.dev + LiteLLM + OpenRouter 三源合并（价格精度 + tokenizer + 别名），或再纳入 pi-ai / pi-catalog。
3. **字段保真度**：是否保留各源特有字段（`compat`/`thinking`/`identity`/分时段价），还是只暴露归一化公共面；tokenizer 只存名称还是要接真实分词器依赖。
4. **覆盖语义**：是否提供「内置目录 + 宿主覆盖层（custom wins）」的合并，还是只读目录。

## 四之二、开发者转向：允许依赖 OMP 库、目标运行时改为 Bun（2026-09-18）

开发者决定：

- **agent-kit 可以转向 OMP 生态、目标 Bun**；理由：「现在没有地方消费 node，全都是 bun」。
- **初步阶段允许 agent-kit 依赖 OMP 提供的库**。
- agent-kit 的定位收敛为「提供一套可组装的组件 API」，`./models` 可以是套壳（facade），而不是自研数据与协议。

由此新增的实测约束（本机验证，2026-09-18）：

| 实验 | 结果 |
| --- | --- |
| `bun add @oh-my-pi/pi-catalog@18.2.5` | 成功；5 个包（含 `pi-natives`、`pi-natives-win32-x64` 原生包），pi-catalog 自身 15.0 MB |
| `import "@oh-my-pi/pi-catalog/models.json"`（数据子路径） | Bun ✅ / Node 24 ✅ / vitest ✅ —— 无副作用 |
| `import "@oh-my-pi/pi-catalog"`（根入口，裸 TS） | Bun ✅（249 导出）/ `bun test` ✅ / Node ❌ `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` / **vitest ❌**（worker 内 `Bun` 未定义，报在 `pi-utils/src/env.ts:293`） |
| import 期副作用 | `@oh-my-pi/pi-utils/env.ts` 顶层：解析 `$HOME/.env`、configRoot/agentDir/projectDir 的 `.env` → 删除 `Bun.env` 中不合规键 → 注入解析值 → `refreshDirsFromEnv()`；`$env` 即 `Bun.env`。**凡是 import 该模块的进程都会受影响** |

含义：套壳 OMP **运行时模块**（而非仅数据）要求 (1) Bun 运行时、(2) 接受 OMP 的 dotenv/环境与目录约定、(3) agent-kit 相关测试改用 `bun test`（或仅数据路径才保留 vitest）。仅取 `models.json` 数据则三条都不需要。

## 五、未验证项

- pi 仓库与发布包 LICENSE；pi 是否有 CLI 目录更新命令；`pi-ai@0.80.6`（本仓库锁定版本）目录内容与 0.85.1 的差异。
- omp `models.json` 的 provider/模型条目数；`THIRD-PARTY-NOTICES.txt` 内容；`model-tokenizer.ts` 实现。
- models.dev 的 API 使用条款与速率限制；OpenRouter 匿名端点条款；Anthropic/Google 官方列表接口认证要求。
- `models.dev/catalog.json` 的体积与条目数。
- 本仓库根 LICENSE 与 `@notnotype/neuro-book-contracts` 对模型元数据的定义。
