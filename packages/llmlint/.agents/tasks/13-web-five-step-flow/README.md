# Web 五步通路：UX + Schema 定稿（走通版）

> 本文是 web 通路（采集线 B）的 **UX 流程 + Schema + API 的权威规格**，按 walkthrough 规则持续更新。
> 上游规范：[METHODOLOGY §2.3](../../../evals/METHODOLOGY.md)（五步权威操作流程）、[Task 12](../12-unified-data-model/README.md)（统一数据模型 schema 增量）、[CONTEXT.md](../../../CONTEXT.md)（D1–D5）。
> 本文只定**流程级 UX（状态机/数据流）+ schema + API**；UI 视觉打磨明确后置，不在本任务范围。

## Relative documents refs

- [Task 09 web-revision-persistence](../09-web-revision-persistence/README.md) — Revision 脊 + 四步状态机（本任务在其上做增量，不推翻）
- [Task 10 repair-flow-ux](../10-repair-flow-ux/README.md) — 改文屏编辑面接入 + stepper（已落地，本任务复用）
- [Task 12 unified-data-model](../12-unified-data-model/README.md) — origin 三变体 / MachineScan+MachineDetect 拆分 / DocJudgment 增维（本任务执行其「实施切分 2」）
- `web/prisma/schema.prisma`、`web/server/api/*`、`web/app/pages/contribute.vue` — 改造对象

## User Request / Topic

用户指令（2026-07-07）：

1. public 仓库 / corpus 泄露 / 版权问题**先不考虑**，以后再处理。
2. 当前最重要的是**跑通 web 通路 + llm render helper 通路**（后者见 Task 14，线 A 修复一轮循环）。
3. 两条通路**并行**推进。
4. web 通路复杂，**先定好 UX + schema**（让用户能按 METHODOLOGY §2.3 定稿的五步流程走通），UI 设计后续慢慢来。

## Goal

> 把 web 采集流从「Task 09 四步机 + Task 06 旧 schema 残留」升级为**完整承载五步权威流程的 UX 状态机 + Task 12 目标 schema**：
> ① schema 落 Task 12 增量（origin 三变体、MachineScan/MachineDetect 拆分、DocJudgment 四维、分类三值三源）；
> ② 机器信号改**服务器计算写入**（浏览器扫描只服务展示）；
> ③ 揭示时机显式化（`revealedAt`），blind 语义可审计；
> ④ 五步每一步的写操作都有 API 承载，多轮循环血缘正确。
>
> - **Verification**：schema 在近 0 数据上重建干净；API 闭环覆盖五步（含负路径）；typecheck 绿；旧四步流不断。
> - **Constraints**：不破 D1–D5；沿用 DTO 纪律（服务器字段客户端不可设）；不推翻 Task 09 状态机与 Task 10 编辑面。
> - **Boundaries**：只动 `web/`（可只读引用 `evals/lib/taxonomy.ts`、`evals/lib/scan.ts` 口径）。

## Current State（2026-07-07 盘点）

已有（Task 09/10 落地，playwright 验证过）：

- `contribute.vue` 四步状态机 `draft → report → edit → verdict` + stepper；edit 步嵌完整编辑面（TextPanel piece-table + 命中列表 + 一键替换）。
- Revision 脊全量持久：`Text`（信封）+ `Revision`（body/charCount/ordinal/parentId 软指针/transitionKind/provenanceJson）+ `DocJudgment`（两轴，`@@unique(userId,revisionId)`）+ `SpanAnnotation`（挂 revision 坐标）+ `MachineRecord`（`revisionId @unique`）。
- blind 服务器判定（现规则 = 该 revision 无 MachineRecord）；D5 双条件验收屏（命中↓ 且 wantReadOn 不降，检测器腿未接）。
- 迁移机制 = `scripts/init-db.ts` 手写 SQL（绕开 prisma 引擎 Windows 坑）；数据近 0，可 reset 重建。

对照五步流程的缺口：

| 步 | 缺口 |
|---|---|
| ① 上传+自报 | DTO 无 体裁/题材/作品名 字段；盲评两轴是必填（应全可选）；`declaredProvenance` 必填（应默认 unknown） |
| ② 机器评测 | 扫描是**浏览器算 + 客户端 POST**（与 Task 12「机器断言仅服务器写」矛盾）；先算后藏没有承载（现 blind 派生 = 「存在 MachineRecord 即已揭示」，服务器一旦上传即扫就全错）；外部检测器 / LLM 规则未接 |
| ③ 润色 | 静态替换未按「强判别静态规则」过滤（task profile 产品消费缺失）；`llm_fix` agent 改写未实现 |
| ④ 复测+反馈 | DocJudgment 缺 `improvementScore` + `comment` 两维 |
| ⑤ 循环 | 提交改后版本 parent 固定 rev0（多轮血缘断）；span 标注入口未接进改文循环 |
| schema | origin 仍 `user_upload\|seeded_gold` + `goldProvenance`；MachineRecord 未拆；分类列无来源标记 |

## Decisions（本轮拍板，均可推翻但需记录）

### D-A 揭示时机显式化：`Revision.revealedAt`

**问题**：机器评测改为「上传即服务器算」（先算后藏）后，「存在机器记录 = 已揭示」的 blind 派生失效。
**决策**：`Revision` 加 `revealedAt DateTime?`（服务器写、首次揭示时设置、幂等）。**统一 blind 规则：`blind = 判定写入时该 revision 的 `revealedAt` 仍为 null`**（创建与更新都重算——已揭示后更新打分，blind 翻 false）。机器结果读取端点被 `revealedAt` 闸住，D2 从「前端自觉」变「服务器强制」。
**边界注记**：引擎与检测页公开，用户本地永远可以自测——blind 是「本产品流程内未向其揭示」的软信号，不是密码学保证。改文流程里 verdict 屏先揭示（reveal）再收复评，故 rev_k(k≥1) 的复评自然 blind=false；rev0 盲评先于揭示，blind=true。众评（他人评 public 文本）需要 per-user 揭示记录，随众评管线后置。

### D-B 分类三值三源（per-field 来源）

**问题**：Task 12 提的 `classifiedBy` 单列装不下混源（用户报题材 + LLM 补视角是常态）。
**决策**：`Text` 上 `genre/textType/pov` 三值列（已有）配 `genreSource/textTypeSource/povSource` 三来源列（enum `curator|user|llm`，值空则源空）。「只补空不覆盖、curator>user>llm」逐字段可执行、可查询（闸门切片可按来源过滤）。不用 JSON——强类型、非法状态少。

### D-C 机器信号一律服务器计算写入

**问题**：现状浏览器扫完 POST hits 上来（`/api/scans`），与 Task 12「机器断言仅服务器写」正面矛盾，且客户端可伪造。
**决策**：**采信 Task 12，废除 `/api/scans`**。nitro 服务端 import 同一套引擎（registry.json + materializeRules + scanText，docScore 与 `evals/lib/scan.ts` 同口径），在 Text/Revision 创建时同步扫描写 `MachineScan`；外部检测器（W3）服务端异步写 `MachineDetect`。浏览器本地扫描保留，但只服务公开检测页与编辑面**展示**，不再是落库来源。engineVersion 单源 = 服务端所用 registry 的版本戳。

### D-D 静态替换的「强判别」过滤 = report.json 烘焙进 registry

**问题**：五步③「静态替换只对强判别静态规则」需要 verdict 数据源。
**决策**：`web/scripts/build-registry.ts` 构建时读 `evals/report/report.json`（若存在），把 per-rule `verdict/effectiveLift` 烘进 `registry.json`；编辑面把「产品级一键静态替换」过滤到 `verdict=strong && fixability=auto`（其余命中仍展示、仍可手动处理）。report 缺失时该过滤降级为仅 fixability 过滤并在 UI 注明。不走运行时 API——报告是 evals 产物，构建期烘焙即可，版本随 engineVersion 固化。（W2 落地）

### D-E LLM 通道模型统一先用 mimo（用户拍板 2026-07-07）

**决策**：所有新接 LLM 通道（`llm_fix` agent 改写、web 异步分类补空、后续 LlmJudgment）统一先用 `xiaomi-token-plan-cn/mimo-v2.5-pro`；配置与 key **复用 `evals/eval.config.json` 一条链**（web 服务端读同一配置，缺配置或缺对应节则优雅跳过该通道、不阻塞主流程，key 不进任何入 git 文件）。evals 侧 `classifier.model` / `repair.model` 已同步改为 mimo（此前 repair 验证样本 5 篇是 deepseek，保留为数据点）。整体验收 = 全部工单完成后用户一次性做。

## 目标 Schema（delta，全部落 W1）

基于现 `web/prisma/schema.prisma`，迁移方式 = 重写 init 迁移 + reset（近 0 数据，Task 09 先例）：

```prisma
enum OriginKind {
  uploaded    // 用户上传（原 user_upload 更名）：declaredProvenance 自述不可信
  curated     // 人工策展人类正文（ground-truth: human）
  generated   // 管线自产 AI 正文（ground-truth: modelKey）
}

enum ClassificationSource { curator  user  llm }

model Text {
  // 保留：id/genre/pov/textType/visibility/consent/uploaderId/createdAt/关系
  originKind         OriginKind            @default(uploaded)
  declaredProvenance Provenance?           // 仅 uploaded；上传默认 unknown
  sourceNote         String?               // uploaded=可选作品名；curated=书名/章节来处（导入时必填语义）
  modelKey           String?               // 仅 generated
  genParamsJson      String?               // 仅 generated：{briefVersion, renderPromptVersion, sourceRef?}
  genreSource        ClassificationSource? // 三值三源：值空则源空
  textTypeSource     ClassificationSource?
  povSource          ClassificationSource?
  // 删除：goldProvenance、enum TrueProvenance（真值由 originKind 派生，防矛盾字段）
}

model Revision {
  // 保留全部现有字段
  revealedAt DateTime?   // D-A：机器结果首次向用户揭示时刻；服务器写、幂等
  machineScans   MachineScan[]
  machineDetects MachineDetect[]
  // 删除关系：machineRecord
}

// llmlint 引擎扫描（机器断言之一；仅服务器写）
model MachineScan {
  id            String   @id @default(cuid(2))
  revisionId    String
  engineVersion String
  hitsJson      String   // [{ruleId, span:{start,end}, level, review}]
  docScore      Float    // 去重span/千字，服务器按 evals 口径算
  scannedAt     DateTime @default(now())
  revision      Revision @relation(fields: [revisionId], references: [id], onDelete: Cascade)
  @@unique([revisionId, engineVersion])   // 引擎升版可 re-scan，历史保留
  @@index([engineVersion])
}

// 外部 AIGC 检测器（机器断言之二；含热力图槽位；仅服务器写；W3 接通道，行存在即完成）
model MachineDetect {
  id              String   @id @default(cuid(2))
  revisionId      String
  detectorName    String   // 如 "hf:yuchuantian-aigc-text-detector:predict_zh"
  detectorVersion String
  chunkChars      Int      // 分块口径（跨口径不可比）
  docPAi          Float    // 长度加权 mean P(AI)
  maxPAi          Float?
  chunksJson      String   // [{span:{start,end}, pAi}] 热力图（UI 消费后置，数据先收）
  checkedAt       DateTime @default(now())
  revision        Revision @relation(fields: [revisionId], references: [id], onDelete: Cascade)
  @@unique([revisionId, detectorName, detectorVersion, chunkChars])
}
// 删除：model MachineRecord（llmAiFlavor/llmNote stub 一并删除；LLM 判将来单开 LlmJudgment）

model DocJudgment {
  // 保留：id/revisionId/userId/blind/时间戳/关系/@@unique(userId,revisionId)
  aiFlavor         Int?     // 0–5，改为可选（五步①全可选）
  wantReadOn       Int?     // 0–5，改为可选
  improvementScore Int?     // 0–5：这轮改得好不好；仅 parentId 非空的 revision 合法（服务器校验，rev0 提交即 400）
  comment          String?  // doc 级自然语言反馈，原样存（D3）
  // 约束：四字段至少一项非空（DTO 层 refine）
}
```

`PairJudgment` / `LlmJudgment` 维持 Task 12「规范先行、建表后置」，本任务不建。

## API 面（目标态）

| 端点 | 变化 | 要点 |
|---|---|---|
| `POST /api/texts` | 改 | DTO + `genre?/textType?`（taxonomy 白名单）`sourceNote?`；`declaredProvenance` 默认 unknown；服务器：建 Text（originKind 恒 uploaded、自报字段 `*Source=user`）+ rev0 + **同步 MachineScan**（先算后藏）+ 触发异步 detect（W3）；响应只回 `{textId, revisionId}`，**不带任何机器结果**（D2） |
| `POST /api/revisions` | 改 | 服务器建 rev_k 后同步 MachineScan + 触发 detect；parent 校验属同一 Text（多轮血缘 W2 收紧为「客户端送当前 head」） |
| `POST /api/revisions/:id/reveal` | 新 | 鉴权 owner；`revealedAt` 空则设为 now（幂等）；返回 `{scan, detects[]}` |
| `GET /api/revisions/:id/machine` | 新 | **`revealedAt` 为 null 时 403**（D2 服务器强制）；已揭示则返回 scan + detects（detect 异步未到则空数组，前端可轮询此端点） |
| `POST /api/judgments` | 改 | 四字段全可选 + 至少一项；`improvementScore` 对 rev0 拒绝；blind 按 D-A 规则在每次写入时重算；整行覆盖语义（未提供字段置 null） |
| `POST /api/scans` | **删除** | D-C：客户端不再上报机器信号 |
| `POST /api/annotations` | 不变 | 已挂 revision 坐标，五步⑤直接复用 |
| `GET /api/export` | 改 | 按拆分后的表 dump（machineScans/machineDetects 数组）；保留 byEngineVersion 索引 |

## 五步 UX 状态机（delta on Task 09 四步机）

```
draft ──提交──► [服务器: Text+rev0+Scan(藏)] ──► blind(盲评两轴,可跳过) ──reveal──► report
                                                                                    │ 开始改文
             ┌──────────────────────────────────────────────────────────────────────┘
             ▼
           edit(编辑面: 高亮+命中+静态替换[strong过滤 W2]+手改+span标注) ──提交rev_k──► [服务器: rev_k+Scan(藏)]
             ▼
           verdict(先 reveal rev_k → 展示对比+D5) + 复评四维(aiFlavor/wantReadOn/improvementScore/comment)
             │ 「继续润色」= 回 edit，parent=当前 head（第⑤步循环）
             └ 结束
```

- 步①=draft+blind（自报三项 + 盲评两轴全可选，跳过盲评直接 reveal 合法，blind 语义仍成立）。
- 步②=report（reveal 后展示 MachineScan 命中 + docScore + MachineDetect 概率/缺省占位）。
- 步③=edit；步④=verdict（reveal 先于复评收集 → 复评 blind=false 语义自洽）；步⑤=verdict→edit 循环 + 循环内 span 标注（「哪里没改好」）。
- 浏览器本地扫描继续给 report/edit 屏做即时高亮（展示层）；落库真相 = 服务器 MachineScan。

## 工单拆分

| 工单 | 内容 | 前置 | 状态 |
|---|---|---|---|
| **W1 schema + 服务端通道** | 目标 schema 迁移（init-db 重写+reset）、服务端扫描（engine import + evals 口径 docScore）、reveal/machine 端点、blind 新规则、DTO 改造、删 `/api/scans`、export 适配、contribute 最小适配保流程不断、API 闭环验证 | 本规格 | ✅ 完成（见 W1 执行记录） |
| **W2 五步 UX 完形** | 自报三项 UI、盲评可选化、复评四维 UI、多轮循环（parent=head）、verdict-bake 强判别静态替换（D-D）、机械清理 commit 记 `static_fix`、循环内 span 标注入口、阶段三 i18n（顺 Task 10 R2） | W1 | ✅ 完成（见 W2 执行记录） |
| **W3 检测器服务端腿** | MachineDetect 异步通道（句界分块复用 evals/detector 口径；**undici 不吃 proxy env，需显式 dispatcher**）、失败不阻塞（UI 显示不可用）、report/verdict 屏接概率与 D5 检测腿 | W2（与 W4 合并派发，避免 contribute.vue 并发冲突） | ✅ 完成（见 W3+W4 执行记录） |
| **W4 血缘与 provenance 收紧** | `provenanceJson` hunk 规范（静态替换逐规则记录）、**`llm_fix` agent 改写真实现**（D-E：mimo；复用线 A `repair-v1` prompt 与命中清单组装，经 `evals` alias；edit 屏「AI 改写」入口） | W2（与 W3 合并派发） | ✅ 完成（见 W3+W4 执行记录） |
| **W5 数据出口与闸门** | `liftAdmissible` 闸门 helper（web+evals 对齐 Task 12 闸门表；**含 revision 维度：rev_k≥1 与 repair 不进 lift**）、export 输出 admissible 标记、curated/generated 语料导入脚本（**visibility 强制 private 守 I11**；repair 按 `repairOf` 挂为 render 文本的后继 revision） | W1 | ✅ 完成（见 W5 执行记录） |
| **W6 LLM 异步分类补空** | 上传后服务端异步调分类 agent（D-E：mimo；复用 evals classifier 纯函数；只补空、`*Source=llm`、失败静默降级不阻塞上传）；注意 nitro=node/undici **不吃 proxy env**，mimo 国内直连优先、必须代理时显式 dispatcher | W1 | ✅ 完成（见 W6 执行记录） |
| **W7 llm_fix 前端流程返工** | 用户审查判定 W4 前端形态偏离原设计（Task 07 编辑器工作流）→ AI 改写改为「建议 diff 进编辑面、人审后才定版」；规格见 [W7 规格节](#w7-规格llm_fix-前端流程重设计2026-07-08用户审查返工) | W3+W4 | ✅ 完成（F1/F2/F3 全落，见 [F1](#f1-执行记录2026-07-08)、[F2](#f2-执行记录2026-07-08)、[F3 执行记录](#f3-执行记录2026-07-08)） |
| **W8 五步流程引导完形** | 全程 stepper（五步映射+锁定原因+轮次）、每屏引导条、主 CTA 纪律（D5 驱动）、谱系进度条、完成态+再传一篇；规格见 [W8 规格节](#w8-规格五步流程引导完形2026-07-08与用户讨论定稿) | W7 F1（串行：F1 → W8 → F2 → F3，同文件防冲突） | ✅ 完成（见 W8 执行记录；G1–G4+G6 全落，双 typecheck+101 测试绿，浏览器验收 18–25 步待用户） |
| **W9 内网信任模式 + 入口统一** | 用户三点指令（2026-07-08）：① admin env seed（现状无任何内置管理员）② 「贡献数据」tab 改名「检测」并成为唯一检测入口（`/` 重定向 /contribute，playground 迁 /playground 退出导航）③ 默认信任所有用户（匿名自动会话免登录走全流程、consent 默认勾选）；规格见 [W9 规格节](#w9-规格内网信任模式与入口统一2026-07-08用户拍板) | W8（同文件串行） | ✅ 完成（见 [W9 执行记录](#w9-执行记录2026-07-08)） |

## Verification / Test

- W1：`rm web/data.db && bun run db:init && bun run db:generate` 干净重建；`bun run typecheck` 绿；curl API 闭环：register → 上传（响应无机器数据）→ 盲评（blind=true）→ reveal → machine 有 scan → 建 rev1 → machine(rev1) 未揭示 403 → reveal(rev1) → 复评四维（blind=false、improvementScore 收下）→ rev0 提交 improvementScore 400 → export 结构含拆分表。
- W2+ 各自工单内定义；浏览器验证建议用户参与（不自动跑）。

## Implementation Walkthrough / 执行记录

（各工单 agent 在此追加执行记录：实际改动、验证输出、与本规格的出入。）

### W1 执行记录（2026-07-07）

**改动清单**（全部在 `web/`）：

| 件 | 文件 | 内容 |
|---|---|---|
| schema | `prisma/schema.prisma` | OriginKind 三变体（uploaded/curated/generated）+ ClassificationSource enum；Text 加 sourceNote/modelKey/genParamsJson + genreSource/povSource/textTypeSource，删 goldProvenance 与 TrueProvenance；Revision 加 `revealedAt DateTime?`、关系换 machineScans/machineDetects；MachineRecord 删除，拆 MachineScan（`@@unique(revisionId, engineVersion)`，docScore 非空）+ MachineDetect（`@@unique(revisionId, detectorName, detectorVersion, chunkChars)`，含 chunksJson 热力图槽位）；DocJudgment 两轴改可选 + 加 improvementScore/comment |
| 迁移 | `prisma/migrations/20260701000000_init_detection_data/migration.sql` | 沿 Task 09 先例**重写 init 手写 SQL 到最终形态**（文件夹沿用原名），配合删库 reset |
| engineVersion 单源 | `scripts/build-registry.ts`、`app/types.ts` | registry 原有 `version`（=LLMLINT_VERSION）不随规则内容变 → 补内容戳：`engineVersion = {version}+r{sha256(regexRules)[:8]}`（本轮 `2.0.0+r40d8072a`）。服务端落库与前端展示同源 |
| 服务端扫描 | `server/utils/scan.ts`（新） | import 浏览器同源引擎：registry.json（其 regexRules 即构建期 materializeRules(默认配置) 产物，服务端无用户覆盖故直接消费）+ `llmlint/scanner` 纯函数；hits 为 UTF-16 span（与 SpanAnnotation/前端同坐标系，转换算法同 `app/utils/review-ranges.ts`）；docScore 同 `evals/lib/scan.ts` 口径（码点区间 countDedupSpans / visibleCharCount × 1000）；`recordMachineScan`（创建即扫、先算后藏）+ `revisionMachineDto`（reveal/machine 共用读取） |
| 揭示端点 | `server/api/revisions/[id]/reveal.post.ts`、`server/api/revisions/[id]/machine.get.ts`（新） | reveal：owner 鉴权、revealedAt 空则设 now（幂等）、返回 {scan, detects}；machine：`revealedAt` 为 null → **403**（D2 服务器强制），detects 现阶段恒空（W3） |
| blind 新规则 | `server/api/judgments.post.ts`、`server/utils/ownership.ts` | `blind = 写入时该 revision 的 revealedAt 仍为 null`（创建与更新都重算，揭示后重打翻 false）；删掉「存在 MachineRecord 即非盲」旧派生；ownership 的 OwnedRevision 增返 parentId/revealedAt |
| DTO | `server/utils/dto.ts` | CreateTextDto + `genre?/textType?`（白名单从 `evals/taxonomy` alias 引，nitro 侧验证可用）+ `sourceNote?`，declaredProvenance 默认 unknown；CreateJudgmentDto 四字段全可选 + refine 至少一项 + improvementScore 服务器校验 parentId 非空否则 400；SubmitScanDto 删除 |
| 删 /api/scans | `server/api/scans.post.ts`（删）、`server/middleware/auth.ts` | D-C：客户端不再上报机器信号；middleware 白名单去 `/api/scans` |
| 同步扫描 | `server/api/texts.post.ts`、`server/api/revisions.post.ts` | 建 rev0 / rev_k 后同步 `recordMachineScan`；响应仍只回 {textId, revisionId, charCount} / {revisionId, ordinal}，**不带机器结果**；texts.post 落 originKind 恒 uploaded、自报字段 `*Source=user` 当且仅当提供了值 |
| export | `server/api/export.get.ts` | 按拆分表 dump（每版 machineScans/machineDetects 数组 + revealedAt；judgment 含 improvementScore/comment）；byEngineVersion 索引保留；origin 块输出三变体字段 |
| 类型导出 | `server/database/prisma.ts` | 去 TrueProvenance，加 OriginKind/ClassificationSource |
| contribute 最小适配 | `app/pages/contribute.vue` | 去掉两处 POST /api/scans；上传流改「texts → 盲评 → reveal → 用服务器 scan 展示（本地扫描只作行内高亮层）」；提交修订流改「revisions → reveal(rev_k) → verdict」（复评在揭示后收集，blind=false 自洽）；报告屏 header 展示服务器 命中数/docScore/engineVersion，验收屏命中与 docScore 对比改用服务器扫描数。自报三项/复评四维 UI 未做（W2，只保证服务端能收） |

**验证结果**（全绿）：

1. `rm data.db && bun run db:init && bun run db:generate`：迁移干净应用，prisma client 重生成。
2. typecheck：`bun run typecheck`（app 侧）exit 0；服务端另跑 `vue-tsc --noEmit -p .nuxt/tsconfig.server.json` exit 0（注入故意错误可被捕获，确认非空转）。注意：仓内 `typecheck` 脚本的根 tsconfig 只覆盖 app 侧，**不含 server/**，服务端需该独立命令。
3. API 闭环（真 dev server + bun 脚本 `web/.agent/workspace/w1-api-loop.ts`，**34/34 断言通过**）：register → 上传（带 genre/textType/sourceNote；响应仅 textId/revisionId/charCount）→ 盲评 blind=true → reveal 前 GET machine **403** → reveal 返回 scan（8 命中 / docScore 53.33 / engine `2.0.0+r40d8072a`，detects=[]，幂等）→ 揭示后重打 rev0 blind 翻 false 且整行覆盖（wantReadOn 置空）→ 建 rev1（响应无机器数据）→ machine(rev1) 未揭示 **403** → reveal(rev1) → 复评四件套 blind=false → rev0 提交 improvementScore **400** → 四轴全空 **400** → export 含 machineScans/machineDetects/revealedAt/improvementScore/comment + byEngineVersion 3 条。
4. 负路径：genre 白名单外 400；body 伪造 originKind/modelKey/blind/goldProvenance → zod 剥除，落库 originKind=uploaded、modelKey=null、declaredProvenance 缺省 unknown（直接查库断言）。
5. span 抽查：hitsJson 的 UTF-16 span 切回正文与命中串逐条一致（8/8）。
6. 既有 web 相关测试：`tests/repair-draft.test.ts` 24/24 绿。浏览器验证未做（留给用户）。

**与规格的出入**（均已按规格精神取舍，未 hack）：

- 服务端扫描**未应用 Markdown 遮罩**：D-C 决策文列的是 registry.json + materializeRules + scanText；docScore 必须对齐 evals（全文扫描口径），contribute 现状也是 scanAll 全文——故全文扫描，`computeMaskedRanges` 未引入服务端。
- 服务端未重跑 materializeRules：registry.json 的 `regexRules` 就是构建期 materializeRules(默认配置) 的产物，服务端无用户覆盖，直接消费单源产物（与 engineVersion 同一次构建，行为等价）。
- reveal/machine 响应在 {scan, detects} 之外附了 `revisionId` + `revealedAt`（幂等可断言；无额外机器数据语义）。
- `evals` alias 在 nitro 侧可用（@nuxt/nitro-server 会把 `nuxt.options.alias` 并入 nitro alias 并写进 tsconfig.server paths），无需退回相对 import。
- `web/README.md` 的 schema 描述停在 Task 06/09 之间的旧状态，本轮未顺手改（非 W1 范围），待 W2+ 一并更新。

### W2 执行记录（2026-07-08）

**改动清单**（全部在 `web/`；evals/ 只读，report.json 只作构建期数据源）：

| 件 | 文件 | 内容 |
|---|---|---|
| D-D verdict 烘焙 | `scripts/build-registry.ts` | 构建时读 `evals/report/report.json`（存在时），把 per-rule `verdict/effectiveLift` 烘成 `registry.ruleVerdicts`（ruleId → {verdict, effectiveLift}）；report 缺失/缺 rules 时整个字段缺省 + console.warn 降级提示，构建不失败。verdict 不改变扫描行为 → **不入 engineVersion hash**（两态 engine 同为 `2.0.0+r40d8072a`） |
| types | `app/types.ts` | `RuleVerdictBake`（verdict 值集经 `import type {RuleStat} from "evals/types"` 单源）+ `LlmlintRegistry.ruleVerdicts?` |
| strong 过滤 | `app/composables/useLlmlint.ts` | `autoFix(text, scanAll, strongOnly=false)`：strongOnly 且 registry 烘有 verdicts 时，auto 规则再过「已测规则须 strong、未入报告的保留」过滤；新导出 `hasRuleVerdicts`（false = 降级口径，UI 注明） |
| transitionKind 源 | `app/components/TextPanel.vue` | 新暴露 `getRepairEditKinds(): RepairEditKind[]`（读 piece-table plan 的编辑来源，无影子记账） |
| span 标注组件 | `app/components/AnnotatableRevisionText.vue`（新） | 只读高亮正文 + DOM 选区反算 UTF-16 span + 标注表单（POST /api/annotations）；`revisionId` prop 决定挂哪一版；report 屏（rev0）与 verdict 屏（rev_k）共用，替换 contribute 内联的 offsetInHost/captureSelection 一套 |
| 五步完形 | `app/pages/contribute.vue` | ① draft 屏自报三项（genre 13 值/textType 4 值下拉，taxonomy 单源中文 label + 「不填」空值；sourceNote 文本框）+ 盲评可跳过（「提交盲评」/「跳过打分直接看报告」双路，跳过不 POST judgment 直接 reveal，`submittedScores` 变 nullable）；④ verdict 屏补 improvementScore（0–5 滑条）+ comment（多行，空则不提交该字段），复评目标恒为当前 head（必有 parent，rev0 天然不出现该控件——rev0 判定只在 draft 屏两轴）；⑤ 「继续润色」回 edit，`headRevisionId/headBody/headOrdinal` 追踪谱系头，编辑基底（TextPanel original-text）与提交 parent 都换 head，D5 对比锚定 rev0 ↔ 最新 rev 不变；机械清理消费 `autoFix(..., strongOnly=true)` + 口径注明行（strong 生效 / 降级）；verdict 屏加改后正文标注区（挂 head）；无盲评基线时 D5 出「仅命中腿可判」第三态，不冒充通过/失败 |
| 阶段三 i18n（还 Task 10 R2） | `app/i18n/messages.ts` | edit/verdict/stepper 及 W2 全部新 UI 文案走 `t()`：新增 63 个 `contribute.*` key，zh-CN/en-US 两套；题材/体裁选项 label 用 taxonomy 领域中文标签（两语言一致，域值不翻译） |
| 文档 | `web/README.md` | 流程（五步）、数据模型（Task 12/13 后 schema）、API 面（reveal/machine、scans 已删）、构建期预烘（ruleVerdicts）全部更新到 W1+W2 现状 |

**transitionKind 判定规则（最终形态）**：提交修订时读 `TextPanel.getRepairEditKinds()`（= piece-table plan 里每条编辑的 kind）——**非空且全部为 `static`（接受命中替换 / 机械清理 / Markdown 格式化）⇒ `static_fix`；出现任何 `user`（手打）或 `llm`（剪贴板整段替换）⇒ `user_fix`；拿不到编辑面状态（ref 缺失）⇒ 保守 `user_fix`**。方向保守（误判只会 static→user）。已知粗粒度：a) 仅 Markdown 格式化的一轮也记 static_fix（编辑面把格式化标为 static 来源，确定性变换，沿用既有语义）；b) 中途离开 edit 屏再回来时 TextPanel 重挂，未提交的既有改动被折成一条 user 编辑 ⇒ 该轮必为 user_fix（保守方向）。逐 hunk provenance 细化归 W4。

**验证结果**（全绿；隔离纪律：独立库 `web/.agent/workspace/w2-test.db`（.agent/ 已 gitignore）跑完已删、`web/data.db` 未动、dev server 用 3007 端口跑完已停）：

1. **registry 烘焙两态**：有 report.json → `ruleVerdicts` 160 条与 report.rules 逐条一致、strong 7 = report strong 7、`effectiveLift` 抽查一致；临时移开 report.json 重跑 → exit 0、registry 无 `ruleVerdicts` 字段（降级路径不报错），跑完已放回并重建烘焙态 registry。两态 engineVersion 均 `2.0.0+r40d8072a`（verdict 不入 hash 的设计验证）。
2. **双 typecheck**：`bun run typecheck` exit 0、`bun run typecheck:server` exit 0。
3. **API 级流程脚本**（`web/.agent/workspace/w2-api-loop.ts`，真 dev server + 直接查库，**35/35 断言通过**）：register → 上传 A（genre=xuanyi/textType=prose/sourceNote，断言落库三值 + `*Source=user`、未报 pov 值/源皆空）→ **跳过盲评直接 reveal 合法**（rev0 scan 8 命中；查库 rev0 零 DocJudgment 行）→ 建 rev1（static_fix，未揭示 machine 403 → reveal）→ 四维复评（aiFlavor=2/wantReadOn=4/improvementScore=4/comment，逐字段查库断言 + blind=false）→ 建 rev2（parent=rev1）→ 查库血缘链 rev0(null)→rev1(rev0)→rev2(rev1) + transitionKind 三值落库 → reveal(rev2) + span 标注挂 rev2（坐标查库断言）→ rev0 提交 improvementScore 400 → 文本 B「先盲评再 reveal」路径 blind=true、揭示后重打翻 false → export：3 revisions、血缘链、transitionKind、rev1 判定含 improvementScore+comment、rev2 标注 target=edit、每版 1 条 machineScan。
4. **既有测试**：`tests/repair-draft.test.ts` 24/24 绿。
5. 浏览器验证未自动跑（纪律），验收清单见下。

**与规格的出入 / 注记**：

- **strong∩auto 现状为空集**：report 的 7 条 strong 规则 fixability 全是 `candidate`，而 3 条 auto 规则（零宽/标点去重）2 条有 verdict（insufficient/noise）1 条未测。若按字面 `verdict==="strong" && fixability==="auto"` 过滤，一键清理今天会恒为空。落地采工单降级句的 per-rule 读法：**已测规则须 strong；未入报告（无判别数据）的规则保留 fixability 判据**——今天的净效果 = 一键清理只剩未测的 `mechanical-zero-width`（insufficient/noise 两条被 strong 闸截掉），命中列表照常全量展示、可逐条手动应用。判据集中在 `useLlmlint.autoFix` 一处 + UI 口径注明两条文案，用户如拍板改回字面严格口径是一行改动。
- **transitionKind 分类采用 plan-kind 口径**而非工单允许的「有任何手动键入即 user_fix」退化式——piece-table plan 本身携带编辑来源，比击键记账更可靠（用户手改后又撤销/reject 掉，plan 里只剩 static 时仍正确记 static_fix）；Markdown 格式化被计入 static 是该口径的已知粗粒度（见上）。
- **与 W6 异步分类的测试时序 race（已知脆弱点）**：本轮 dev server 上 W6 的 LLM 补空真实触发（A 补 pov=third、B 补 textType/pov），脚本的「未报字段为空」断言（ok 06/27）因先于 LLM 完成（16s/42s）而通过——语义无冲突（W6 只补空、`*Source=llm`，不碰用户自报），但**重跑脚本若 LLM 更快可能挂这两条**。后续修法：断言放宽为「空 或 source=llm」，或测试环境用坏配置副本禁用分类通道（W6 的负路径手法）。
- verdict 屏改后正文高亮用本地扫描（展示层，同 report/edit 屏既有口径）；标注 span 坐标相对 head body 本身，与服务器校验（`span.end <= body.length`）一致，不受高亮口径影响。
- 报告屏进入改文（`startEditing`）沿用既有「重置草稿为基底」语义（基底从 rev0 固定改为当前 head）；中途返回报告再进入仍会丢未提交改动——既有行为，非本轮引入，未改。
- `contribute.vue` 重写后约 530 行（< 800 上限），选段标注抽成 `AnnotatableRevisionText` 复用组件，未再拆自报表单/复评表单（单处使用，无复用点，遵循「不为拆而拆」）。

**用户手动浏览器验收清单**（`cd web && bun run dev` 后逐步）：

1. **步① 自报 + 双路提交**：`/contribute` 粘贴一段带 AI 味正文 → 见 题材/体裁 下拉（中文 label，默认「不填」）与作品名输入框；选 题材=悬疑、体裁=小说、填作品名 → 勾授权 → 点「提交盲评」→ 进报告屏，头部显示「盲评分已保存 AI 味 x/5 想读 x/5 · 服务器扫描 N 处 · docScore · engine」。
2. **步① 跳过路径**：换一篇新文本（刷新页面）→ 不动滑条 → 勾授权 → 点「跳过打分直接看报告」→ 报告屏头部显示「已跳过盲评」（无分数），扫描信息照常。
3. **未勾授权**：两个按钮任一 → 通知「请先确认授权与保留说明」，不跳屏。
4. **步② 标注**：报告屏左栏选中一段文字 → 出现选段表单 → 填一句 → 「保存标注」→ 成功通知；点正文命中处右侧卡片联动激活。
5. **步③ 编辑面**：「开始改文优化」→ stepper 高亮「改文」；右栏头部第二行显示一键清理口径文案（当前构建有 report：「一键清理口径：仅强判别或未评测的可自动修复规则（D-D）」）；正文含零宽字符时左上出现「清理机械问题 (N)」按钮（普通文本多半不出现——strong 口径下仅零宽规则参与，属预期）；右侧命中列表点「应用」可接受替换。
6. **步③→④ static_fix**：只点命中「应用」/机械清理（不手打字）→ 「提交改后版本」→ 验收屏；（可查库 `Revision.transitionKind = static_fix`）。
7. **步④ 四维**：验收屏见 命中/docScore 对比（原文→改后）+ 四个控件（AI 味、想追更——有盲评时括注「盲评时 x」、这轮改得好不好、文字反馈多行框）→ 填写后「提交复评」→ D5 结果框：盲评路径显示 通过/未完全通过；跳过盲评路径显示「△ 无盲评基线：仅命中腿可判」且两轴旁括注「（无盲评基线）」。
8. **步⑤ 循环**：验收屏下方「改后正文 rev1（选中片段可标注…）」选段提交一条标注 → 点「继续润色」→ 回改文屏，编辑器基底 = 刚提交的 rev1 正文（不是原文）→ 手打几个字 → 提交 → 验收屏标题变 rev2、命中对比仍以原文为基线；（可查库 rev2.parentId=rev1、transitionKind=user_fix）。
9. **i18n**：设置切 English → stepper、改文屏、验收屏、draft 新增字段全部跟随英文（题材/体裁选项值保持中文域标签，属预期）；切回中文正常。
10. **落库抽查（可选）**：`SELECT ordinal, parentId, transitionKind FROM Revision` 看血缘链；`SELECT aiFlavor, wantReadOn, improvementScore, comment, blind FROM DocJudgment` 看四维与 blind。

### W6 执行记录（2026-07-07）

**改动清单**（全部在 `web/`，evals/ 只读复用未动一字）：

| 件 | 文件 | 内容 |
|---|---|---|
| alias | `nuxt.config.ts` | 新增 `evals-classifier` → `../evals/classifier`、`evals-generator` → `../evals/generator`（既有 `evals` alias 语义 = evals/lib 且被 app 侧类型消费，不能改指向）；新增 `runtimeConfig.evalConfigPath`（构建期按仓根解析出 eval.config.json 绝对路径，运行期可用 `NUXT_EVAL_CONFIG_PATH` 覆盖） |
| 分类服务 | `server/utils/classify.ts`（新） | ① 惰性通道初始化：web 侧 mini 加载器读同一 `evals/eval.config.json`（只认 classifier/modelsConfig/retry/rateLimit 节，类型 `import type` 自 `evals-generator/eval-config`），modelsConfig 相对路径按仓根解析 → 运行时复用 `evals-generator/config` 的 `loadConfig/resolveModel` + `configureModelClient`（重试/限流与 evals CLI 同一套）；配置缺失/解析失败 = 通道整体禁用（记日志，其余照常）。② `backfillTextClassification(textId, body)`：运行时复用 `evals-classifier/classify-agent` 的 `classifyText`（report_classification 工具 + sanitize 白名单，unknown/白名单外不写）；写库用 `updateMany` 带「字段 IS NULL」条件逐字段补值 + `*Source='llm'`（写库瞬间重查，防竞态覆盖 user/curator 值）；任何异常只记日志不重试不上抛。③ 结构化日志：通道就绪 / 完成（textId+耗时+补空/已占用/模型不确定三桶）/ 跳过 / 失败（textId+错误）各一条 |
| 触发 | `server/api/texts.post.ts` | 建 Text+rev0+同步扫描后 `event.waitUntil(backfillTextClassification(...))`——nitropack 2.13.4 给每个 event 注入 `waitUntil`（dev/build 同一 runtime `internal/app.mjs`，类型已在 nitropack 的 h3 增强里），只登记 promise 不阻塞响应 |
| 类型 shim | `shared/evals-compat.d.ts`（新） | evals 的 bun CLI 模块用 `import.meta.dir`（Bun 专有，根仓靠 bun-types）；web 两个 tsc 程序（app 程序经 nitro InternalApi 也会拉进 server 端点 import 链）都不含 bun-types → 补窄声明；放 `shared/` 因它同时进两个 tsconfig include |
| 文档 | `.env.example` | W6 通道说明注释（key 只在 modelsConfig 指向的 NeuroBook config.json，绝不进 web/.env*；`NUXT_EVAL_CONFIG_PATH` 覆盖说明） |
| 验证脚本 | `.agent/workspace/w6-classify-loop.ts`（非产品件） | 正/负路径断言脚本（直查测试库） |

**验证结果**（全绿；隔离纪律：dev server 端口 3006、独立测试库 `data-w6.db`（跑完已删）、`web/data.db` 前后 md5 一致 `6efa39a1…` 未动）：

1. 正路径 1（无自报，武侠味第三人称片段）：上传响应 **211ms** 且响应瞬间查库分类字段仍全空（分类未阻塞响应）→ **12s 后**落库 `genre=wuxia / textType=novel / pov=third`，三者 `*Source='llm'` 且全在 taxonomy 白名单（12 断言中 7 项）。
2. 正路径 2（自报 genre=kehuan，科幻味第一人称片段）：上传即 `genre=kehuan/genreSource=user`；**8s 后** `textType=novel / pov=first` 补为 llm，genre/genreSource=user **原样未动**；服务端日志 `已占用=[genre=kehuan]` 证明 null 条件写库真实拦下了 LLM 的 genre 返回值（其余 5 项断言）。
3. 负路径（classifier.model=不存在的模型）：上传仍 **200**（170ms）、Text 正常落库、30s 后分类字段保持全空；服务端日志 `[classify] 失败 textId=… 耗时=1249ms：…终态失败（auth/client-error: 400）`——复用链把上游 400 判为 terminal 不做无谓重试（4/4 断言）。
4. typecheck：`bun run typecheck` exit 0、`bun run typecheck:server` exit 0；且加 shim 前 server 程序确实报出 eval-config.ts 的 `import.meta.dir` TS2339，证明检查真实覆盖了 evals import 链（非空转）。
5. 观测日志样例：`[classify] 通道就绪：model=xiaomi-token-plan-cn/mimo-v2.5-pro maxChars=2000（直连，忽略 eval.config.proxy）`、`[classify] 完成 textId=… 耗时=10604ms 补空=[genre=wuxia textType=novel pov=third] 已占用=[] 模型不确定=[]`。

**与规格的出入**（均按规格预留的备选路径落地，未 hack）：

- **复用达成度**：classify-agent（分类+sanitize）、model-client（callModelForTool+gate/重试）、config（loadConfig/resolveModel）、rate-limit 四件**运行时直接复用**；唯 eval-config 的加载器走了工单预判的备选①——它的默认路径常量 `join(import.meta.dir, …)` 在 nitro/node 下 `import.meta.dir === undefined`、模块**加载即抛 TypeError**，连带 `loadEvalConfig(explicitPath)` 也不可运行时 import → web 侧 mini 加载器 + 类型复用（`import type` 构建期擦除，不触发该模块加载）。
- **负路径手法**：未按验证清单临时改 `evals/eval.config.json`（与「evals/ 只读」纪律冲突），改用**无密钥坏配置副本 + `NUXT_EVAL_CONFIG_PATH` 覆盖**，等价验证且原配置全程保持 mimo、无需改回；副本跑完已删。
- **proxy**：实测 mimo（fufu.iqach.top）在 node/undici 无 proxy env 下直连 200（7.5s 首包）→ 未接 undici ProxyAgent（规格允许「先试直连」）；`eval.config.proxy` 显式忽略并在通道就绪日志注明，将来需代理时再补 dispatcher util。
- **waitUntil**：查证结果 = h3 1.15.11 本身无此 API，但 nitropack 2.13.4 运行时给每个 event 注入并在类型里增强，dev 与 build 共用同一 runtime → 直接用 `event.waitUntil`，无需等价替代。
- **运维注记**：用 `bun node_modules/nuxt/bin/nuxt.mjs dev` 起服务时 nitro dev worker（bun loader）曾持续报 `ModuleNotFound resolving .nuxt/dev/index.mjs`（与并行 agent 多 dev server 共用 `.nuxt/` 的重建窗口叠加）；换 `node node_modules/nuxt/bin/nuxt.mjs dev` 一次即稳。本仓 web dev server 建议用 node 起。

### W5 执行记录（2026-07-07）

**改动清单**：

| 件 | 文件 | 内容 |
|---|---|---|
| evals 闸门 | `evals/lib/gates.ts`（新） | `liftAdmissibleRole(role)`（corpus 口径：reference/render→true，repair→false，I5/D1）+ `liftAdmissibleOrigin({originKind, ordinal})`（统一模型口径：`originKind ∈ {curated, generated}` 且 `ordinal === 0`；rev_k≥1 是改写后继不进 lift——revision 维度已在注释写明） |
| 消费点显式化 | `evals/lib/metrics.ts` | 3 处 lift/AUC 消费点（computeMetrics 的 human/ai 分类、holdout train 子集 ruleScans、holdoutStat 两侧 AUC）改为先过 `liftAdmissibleRole` 再按 role 分类，替换原「role 相等比较隐式排除 repair」；countByRole（纯计数）与 computeRepairStat（I5 repair 专属消费口）不动 |
| 谓词单测 | `evals/lib/gates.test.ts`（新） | 双谓词真值表 + metrics 接线守门（塞入高命中 repair 扫描，detector/rules/modelRanking 必须逐位不变、仅 counts.repair 变） |
| web 闸门 | `web/server/utils/gates.ts`（新） | `liftAdmissible({originKind, ordinal})` 同一规则，类型用 prisma 生成 `OriginKind` |
| export 标记 | `web/server/api/export.get.ts` | 每个 revision 输出 `liftAdmissible` 布尔标记，下游 lift/检测器训练过滤有据 |
| 导入脚本 | `web/scripts/import-corpus.ts`（新） | evals corpus → web 库，照 Task 12 映射表；`--corpus/--genre/--plot/--limit/--dry`；reference→curated Text+rev0（sourceNote=title｜author｜sourceFile 拼）、render→generated Text+rev0（modelKey + genParamsJson={briefVersion, renderPromptVersion, sourceRef=pairRef}）、repair→按 `repairOf` 挂为源 render 的 rev1（llm_fix，provenanceJson 记 repairModel/repairPromptVersion），不建新 Text；每个导入 revision 调 W1 `recordMachineScan`；**visibility 硬编码 private（I11，不设开关）**、consent 恒 false（导入无「上传者勾选」语义）；uploader=幂等系统账号 `corpus-import`（admin、随机密码不打印）；幂等键 = rev 级 provenanceJson 的 `corpusKey`（`genre/plotId/file`，SQLite contains 检索，三种 role 一个键覆盖）；分类：genre=题组目录名（genreSource=curator），pov/textType 取 meta.classification（`*Source=llm`、unknown 留空） |

**验证结果**（全绿；隔离纪律：独立测试库 `data-w5.db` 跑完已删、`web/data.db` 未动、dev server 用 3005 端口）：

1. **gates 单测 + evals 测试**：`bun test evals/lib` 13/13（原 10 + 新 3）；evals 侧 typecheck 用仓内脚本根 `bun run typecheck`（tsc 覆盖 skill/evals/tests）exit 0。
2. **score 零漂移**：改动前后各跑 `bun evals/score.ts`（detector sidecar 复制进出目录，externalDetector 与 repair 外部口径都参与对比），默认与 `--holdout 0.25` 两组 **report.json 均逐字节相等**（diff 为空）。基线数字：AUC 0.743｜强判别 7（holdout train 拟合下 11）｜docScore 中位 人类 19.48 / AI 25.20｜误杀率 8.94/千字｜repair 配对 5：docScore 25.32→19.58（改善 5/5）、外部 P(AI) 0.923→0.919（下降 5/5）｜holdout train AUC 0.715 / test 0.827。
3. **导入真跑**（gongdou/zhenhuan-zhuan，reference+render+repair 三种 role 全覆盖）：curated 5｜generated 30｜repair 3；查库断言 **34 条全过**——originKind 与变体字段互斥（curated 无 modelKey/genParams、generated 有 modelKey+genParams 三件套、declaredProvenance 全空）、visibility 全 private、consent 全 false、genre=gongdou+genreSource=curator、pov=first/textType=novel（Source=llm）、38 个 revision（35 rev0 + 3 rev1）每个恰 1 条 MachineScan（engineVersion 单一 `2.0.0+r40d8072a`）、3 组 repair 血缘正确（与源 render 同 Text、ordinal=1、parent=render rev0、transitionKind=llm_fix、provenance 记 deepseek/repair-v1）。
4. **幂等重跑**：0 新增、38 跳过，34 条断言原样通过；**--dry** 只打印计划（38 行）不写库（dry 后四表计数全 0）。
5. **export 标记**（3005 dev server 挂测试库，真实 API 走查，9 断言）：uploaded rev0 **false**、curated 5×rev0 **true**、generated 30×rev0 **true**、repair 3×rev1 **false**；导出共 36 篇（35 导入 + 1 条 API 上传的对照 uploaded）。
6. **web typecheck**：`bun run typecheck` exit 0、`bun run typecheck:server` exit 0。

**与规格的出入**：

- scan 复用无障碍：`bun scripts/import-corpus.ts` 在脚本环境直接 import `server/utils/scan.ts` 成功——bun 按 `web/tsconfig.json`（extends `.nuxt/tsconfig.json`）解析 `llmlint`/`evals` alias，未触发「抽共享位置」备选路径。
- genParamsJson 字段名从工单行的 `{promptVersion, pairRef}` 对齐为 schema 注释与 Task 12 的 `{briefVersion, renderPromptVersion, sourceRef}`（同一信息，采规范字段名）。
- 顺带导入 meta.classification 的 pov/textType（`*Source=llm`、unknown 留空）——工单只点名 genre/genreSource，但 D-B 三值三源已建模且 meta 数据现成；consent 恒 false 为本轮自行拍板（工单未规定，注释写明理由）。
- evals 侧 `detector/detect.ts` 的外部检测器 summary 也按 role 隐式过滤（reference/render AUC），但它是「对照仪表，不进 lift」（CONTEXT §3）且不在工单范围（evals/lib），未动——留作后续对齐候选。
- 运维注记：并行 agent 的 nuxt dev-lock 残留（lock 内 PID 已死、3006 有孤儿进程仍在服务）挡住 3005 启动，用 `NUXT_IGNORE_LOCK=1` 绕过（未杀他人进程）；Windows 上 nuxt dev 监听 IPv6 loopback，走 API 的验证脚本需用 `http://[::1]:3005` 而非 127.0.0.1。

### W3+W4 执行记录（2026-07-08，合并工单）

**改动清单**（全部在 `web/`；evals/ 只读未动一字，eval.config.json 全程未改）：

| 件 | 文件 | 内容 |
|---|---|---|
| alias | `nuxt.config.ts` | 新增 `evals-detector` → `../evals/detector`（复用句界分块纯函数）；新增 `node-fetch-native-proxy` → `node_modules/node-fetch-native/dist/proxy.cjs`（代理 fetch；nitro 自带别名 `node-fetch-native`→`node-fetch-native/native` 会把 `/proxy` 子路径错误改写成 `…/native.mjs/proxy`，独立别名直指 node 实现文件绕开） |
| 类型 shim | `shared/vendor-compat.d.ts`（新） | `node-fetch-native-proxy` 的类型 re-export（别名目标是 .cjs，TS 拿不到类型；re-export 原包 `./proxy` 的 lib/proxy.d.ts） |
| 通道公共基建 | `server/utils/eval-channel.ts`（新） | W6 mini 加载器抽公共：`readEvalConfig()`（读 runtimeConfig.evalConfigPath，失败返回带原因的 err 值）+ `resolveChannelModel()`（modelsConfig 仓根解析 + resolveModel + configureModelClient 一次性注入，首个通道生效防替换在用 gate）；classify（W6）/detect（W3）/llm-fix（W4）三通道共用 |
| classify 重构 | `server/utils/classify.ts` | 消费 eval-channel，行为与日志语义不变（W6 验证过的逻辑仅换配置读取来源） |
| W3 检测通道 | `server/utils/detect.ts`（新） | `recordMachineDetect(revisionId, body)`：分块（`evals-detector/chunk` 的 chunkBySentence/visibleLen，chunkChars 与 evals 同源）→ 逐块 gradio 调用（POST→event_id→SSE，与 hf-client 同协议同算法；**代理 fetch = node-fetch-native/proxy 的 createFetch(eval.config.proxy)，按通道构造不污染全局**；无 proxy 配置降级直连并注明）→ P(AI) 归一化 + 长度加权 mean/max 聚合 → 落 MachineDetect（detectorName 与 evals sidecar 同命名 `hf:yuchuantian-aigc-text-detector:predict_zh`）。幂等双道（先查 @@unique 再 catch P2002）；单块重试 ×3 退避；**整次 120s 总超时**（每段 fetch 超时取余量与 hf-client 同款上限的较小值）；进程级 ProviderGate(concurrency 1 + minIntervalMs) 防并发上传打爆免费实例；任何失败只记结构化日志不落行不上抛 |
| detect 触发 | `server/api/texts.post.ts`、`server/api/revisions.post.ts` | 建 rev0 / rev_k 后 `event.waitUntil(recordMachineDetect(...))`（texts.post 与 W6 classify 并存） |
| scan 补导出 | `server/utils/scan.ts` | 新导出 `scanBodyIssues(body)`（引擎 Issue 原始命中，rule.title/review + match）——llm-fix 组问题清单用；`scanRevisionBody` 改内部复用之 |
| W4 llm-fix 通道 | `server/utils/llm-fix.ts`（新） | 通道惰性初始化（`repair.model` + `repairPrompt(promptVersion)`，未知版本抛=I8）；**进程内存 job 表**（pending/done/failed + TTL 1h 清扫；重启丢任务=前端轮询 404，注释写明）；`runLlmFixJob`：scanBodyIssues → `collectRepairFindings`（agent 桶）→ `buildRepairUser` + repair-v1 → `callModelDetailed`(maxTokens 16000 同 repair.ts) → 拒答守门（可见字 < min(400, 原文×0.5) 判失败）+ 原样返回判失败 → 建 Revision(parent=基底, transitionKind=llm_fix, provenanceJson={version:1, edits:[{kind:"llm"}], model, promptVersion}) + 同步 MachineScan → **job 置 done 后**再 await detect（不阻塞前端拿结果，waitUntil 生命周期内完成） |
| W4 端点 | `server/api/revisions/[id]/llm-fix.post.ts`、`server/api/llm-fix-jobs/[id].get.ts`（新） | POST：owner 鉴权 → 通道未配置 503 → 建 job + waitUntil 执行 → 立即返回 `{jobId}`；GET：owner 鉴权（非本人/不存在一律 404 防枚举）返回 status/result/error |
| provenance 规范 | `shared/revision-provenance.ts`（新） | `RevisionProvenance`/`RevisionProvenanceEdit` 类型（version 1；static 带 ruleId 逐规则计数、user/llm 按来源计数、llm_fix 顶层 model/promptVersion）+ `aggregateProvenanceEdits()` 聚合函数；app（contribute 提交）与 server（llm_fix 写入）经 `#shared` alias 共用 |
| 编辑面 | `app/components/TextPanel.vue` | `getRepairEditKinds()` → **`getRepairEdits()`**（返回 {kind, ruleId?}，transitionKind 分类与 provenance 聚合共用一份数据）；**cleanMechanical 从整体替换改为逐 AutoFixChange splice**（每条携带 ruleId 溯源 → provenance 逐规则可记，且每处清理可在 diff 里单独 reject；change 坐标从「修复后文本」反算回草稿坐标、从后往前应用；错位条目跳过再点收敛；调用方未传 changes 时保留整体替换兜底） |
| 五步页 | `app/pages/contribute.vue` | ① detect 轮询（4s×30≈120s 对齐服务端总超时；每槽代数计数防过期轮询写状态；reveal 带回非空则免轮询）；② 报告屏 P(AI) 行三态（数值+检测器名 / 检测中 / 暂不可用）；③ 验收屏 P(AI) 对比行（**同口径配对**：detectorName+version+chunkChars 一致才可比）+ D5 升级：`machineLegPass = 检测概率下降（两端有数据）｜命中↓（降级，口径注明）`，结果框标题与说明按口径切换；④ 「AI 改写」按钮（edit 屏；有未提交手改或通道 503 后禁用并注明；running 状态禁重复点击与提交/返回）→ job 轮询（3s×140≈7min）→ 成功 reveal 新 rev 推进 head 进验收屏，失败通知停留；⑤ 提交修订带 `provenanceJson`（buildProvenanceJson 聚合编辑面 plan） |
| i18n | `app/i18n/messages.ts` | 新增 21 个 `contribute.*` key（detect 三态/对比、llmFix 全套、D5 口径文案），删 2 个失效 key（detectorPending/verdictDetectorNote），更新 verdictPassTitle/verdictNoBaselineTitle/postJudgmentHint 至新口径；zh-CN/en-US 两套 |
| 文档 | `web/README.md` | MachineDetect 描述、API 面补 llm-fix 两端点与 provenanceJson/异步 detect 注记 |
| 验证脚本 | `.agent/workspace/w34-loop.ts`（非产品件） | 正/负/503 三模式断言脚本（直查测试库 + 真 API 走查） |

**验证结果**（全绿；隔离纪律：独立测试库 `data-w34.db`（跑完已删）、dev server 端口 3008（node 起，W6 结论）、`web/data.db` 前后 md5 一致 `6efa39a1…` 未动、坏配置副本走 `NUXT_EVAL_CONFIG_PATH` 跑完已删、真 `eval.config.json` 全程未改）：

1. **detect 真跑**（走代理 `127.0.0.1:7890` 调真 HF Space，脚本 25 断言中 6 项）：上传 1231 可见字 AI 味中文 → reveal 后轮询 **≈6s** detects 落库；`docPAi=0.9991`（∈(0,1)）、`maxPAi=0.9997`、**3 块** chunksJson 合法且 span 首尾相接覆盖全文 [0, len)、detectorName 与 evals 命名一致；服务端日志 `[detect] 完成 … 耗时=4955ms 块=3`。**幂等**：对同 revision 直接再调 `recordMachineDetect`（stub useRuntimeConfig 供 nitro 外执行）→ 日志「同口径已有记录」+ 库中仍恰 1 行。
2. **llm-fix 真跑**（mimo 真调用）：POST 立即返回 jobId（7ms）→ **57.3s** job done；断言 rev1 `transitionKind=llm_fix`、`parentId=rev0`、provenanceJson `{version:1, edits:[{kind:llm}], model=xiaomi-token-plan-cn/mimo-v2.5-pro, promptVersion=repair-v1}`、MachineScan 已同步落、正文确实被改写。**改写前后：命中 84 → 48｜docScore 38.18 → 29.39**（问题清单 17 类，字数 1231→1157）。
3. **D5 升级口径前提**（两端有 detect）：rev1 detect 落库后与 rev0 行按 (name, version, chunkChars) 配对成功；**检测概率腿 docPAi 0.9991 → 0.9990（下降）**——强 AI 味测试文两端都近饱和，降幅真实记录不粉饰；顺带验证 static_fix 提交的 rev2 也自动触发 detect（第三行落库，`revisions.post` 触发点生效）。
4. **失败路径 1**（坏配置副本：无 detector 节 + `repair.model=xiaomi-token-plan-cn/mimo-nonexistent-w34`，9 断言全过）：上传照常 200；reveal/machine detects 恒空 + 10s 后库中无行 + 日志 `[detect] 通道禁用：… 缺 detector 节`（=UI 轮询超限显「暂不可用」与 D5 降级口径的数据前提）；llm-fix 通道就绪（模型 id 不在列表仍放行）→ job **1.3s 失败**（上游 400 判 terminal 不重试风暴）→ `status=failed` + 错误摘要 + **未落任何新 revision**。
5. **失败路径 2**（配置无 repair 节，3 断言全过）：POST llm-fix 直接 **503**「AI 改写通道未配置」（前端捕获后禁用按钮并注明原因）。
6. **provenance**：模拟编辑面投影（同规则×2 + 单规则×1 + 无规则 static×1 + user×1）经 `aggregateProvenanceEdits` 提交 static_fix → 查库逐规则计数正确（`static:cliche-yimo-huxian=2`、`static:mechanical-zero-width=1`、无规则 static 与 user 各自成桶）。
7. **D5 三态**：升级口径（两端配对成功，见 3）与降级口径（detects 恒空，见 4）的数据前提均已验证；配对/降级/无盲评三态的展示逻辑在 contribute computeds（`detectPair`/`machineLegPass`/`wantReadOnKept`），留浏览器验收。
8. `bun run typecheck` exit 0、`bun run typecheck:server` exit 0（nuxt prepare 后新 alias 进两侧 tsconfig paths）；`bun test tests/repair-draft.test.ts` **24/24 绿**。

**与规格的出入**（均按规格预留的备选路径落地，未 hack）：

- **「undici 为 node 内置」前提不成立**：Node 24.13 无 `node:undici`、无全局 ProxyAgent，undici 运行时包也不在 node_modules（nitropack 只 devDep）。守「不引新依赖」纪律改用 **nitro 自带传递依赖 `node-fetch-native`（1.6.7）的 `./proxy` 导出**——内部即捆绑的 undici ProxyAgent dispatcher，`createFetch({url: proxy})` 得到按通道的代理 fetch，语义与工单要求的「显式 dispatcher、不污染全局」一致。端到端已验真（代理下 gradio POST 200 + SSE 拿到 `["AI","0.9996"]`）。
- **hf-client 复用达成度**：`chunkBySentence`/`visibleLen`（导出的纯函数）经 alias 直接复用（分块口径单源）；gradio IO/parseSse/toPAi/聚合在 hf-client 是**未导出的私有函数**、其 IO 用全局 fetch 无 dispatcher 注入点（= 工单预判的「nitro 不兼容」情形）→ IO 薄层 web 侧按同协议同算法实现，detect.ts 注释逐处标明与 hf-client 对应关系；evals 只读未动。
- **job result 额外带 `body`**：工单 D 的返回定义是 `{revisionId, ordinal}`；job done 结果多带改写正文，前端免加 GET revision 端点即可推进 head（数据本就归 owner 可见，无越权面）。
- **「配置缺失时按钮隐藏/禁用」为反应式**：不加 capabilities 端点（避免为一个布尔开新 API）；首次点击 503 → 按钮禁用 + 注明原因。刷新页面前不再重试。
- **detect 轮询参数取 4s×30（120s）**而非工单示例 3s×20（60s）——对齐服务端整次 detect 的 120s 总超时，避免「UI 已放弃、数据 90s 落库」的假不可用窗口。
- **机械清理行为演化**（W4 provenance 的前提）：原「整体替换成 autoFixText 一条 static 编辑」会把 plan 里既有的逐规则编辑吸收合并、销毁 provenance 信息 → 改为逐 AutoFixChange 并入（带 ruleId）。已知边界：顺序应用的 auto 规则互相影响时（fix.ts 对重叠 change 有丢弃逻辑）错位条目跳过、按钮再点一次收敛——当前 strong 口径下仅 `mechanical-zero-width` 参与，实际不触发。
- **负路径副本的运维注记**：mini 加载器按「配置文件位于 <仓根>/evals/ 下」约定推仓根解析相对 modelsConfig——副本放别处时 modelsConfig 必须写绝对路径（本轮先踩后修，负路径首跑 503 即此因）。
- W2 记录过的「与 W6 分类的测试时序 race」本轮规避：脚本不再断言分类字段为空（观察到 classify 在本轮真实补空 pov=third，与 detect/llm-fix 通道并存无冲突）。

**用户手动浏览器验收清单（在 W2 清单基础上补两段；W2 原清单 1–10 步全部仍适用）**：

11. **检测器概率（报告屏）**：上传一篇 ≥1k 字正文（盲评或跳过均可）→ 报告屏头部第三行先显示「外部检测器检测中…」→ 约 10–60s 后自动变为「外部检测器 P(AI) xx.x%（hf:yuchuantian-aigc-text-detector:predict_zh）」；期间不需要刷新（4s 轮询）。若代理未开/HF 挂：约 2 分钟后显示「外部检测器暂不可用」，其余流程不受影响。
12. **检测器概率（验收屏）**：提交一轮改文进验收屏 → 对比卡片出现「外部检测器 P(AI)：原文 xx.x% → 改后 yy.y%」+ 下降/未下降 着色；改后端未到时先显示「检测中…」行，到齐自动替换。提交复评后 D5 结果框标题为「✓ 通过 D5 双条件（检测概率降 且 想追更未降）」（或未通过），说明行注明「当前口径：外部检测概率腿」。
13. **D5 降级口径**：断开代理（或临时用无 detector 节的配置副本 + `NUXT_EVAL_CONFIG_PATH` 重启）重复上一步 → 对比行显示「数据缺失（D5 机器腿按命中数降级判定）」，结果框标题变「✓ 通过（降级口径：命中降 且 想追更未降）」，说明行注明降级口径。
14. **AI 改写：发起与 diff 并入（F1 重写）**：改文屏**先手打几个字（不提交）**→「AI 改写」按钮仍可点（旧「有手改禁用」已解除，改写基于当前草稿快照发起）→ 点击进入等待态：编辑区**不锁**（光标仍可输入；本步先不动草稿），仅「提交改后版本」「返回报告」暂时禁用 → 约半分钟至数分钟（真跑 27–36s）完成后**停留改文屏**（不再跳验收屏）：通知「已并入 AI 改写：N 处修改」、正文出现逐处 llm diff、审阅横幅出现（共 N 处 · 已巡检 k/N）且第一处已自动激活滚到视口 → 横幅「上一处/下一处」（或编辑器 Ctrl+Alt+N/P）在 llm diff 间环形跳转，「已巡检 k/N」随访问递增。
15. **AI 改写：拒绝该处 / 整批撤销 / 快照校验（F1 重写）**：横幅「拒绝该处」→ 该处回原文、自动激活相邻下一处、横幅 N 减一；并入通知里的「撤销」→ 本次改写**整批**回退（llm diff 清零、横幅自动收起）→ 再点一次「AI 改写」并在**等待期打几个字** → 完成后弹「基于旧稿的结果」确认弹窗（点遮罩不关闭）：「仍然应用」= 草稿先回置到发起时快照再并入 diff；「丢弃」（或 X / Esc）= 结果作废并通知、等待期打的字保留。两分支各试一次。
16. **AI 改写：批注参与 + transitionKind 三态（F1 重写）**：a) 发起改写**前**在报告屏对某处明显问题选段写一条针对性标注（如「这个比喻太陈词，换一个」；编辑面内加的批注同样进请求载荷）→ 回改文屏发起 AI 改写 → 改写结果在该处应体现标注意图（服务端日志「[llm-fix] 完成 … 批注=M 条」可佐证请求批注 + 谱系标注两源合并条数）；b) 全盘接受不手改 → 「提交改后版本」→ 查库该 revision `transitionKind=llm_fix`、provenanceJson edits 含 `{kind:"llm"}`；c) 换一轮：并入后拒绝几处再手打几个字 → 提交 → `user_fix`；d) 换一轮：只做命中替换/机械清理（不发起 AI 改写）→ 提交 → `static_fix`。失败/503 口径保留旧步语义：坏模型配置副本 + `NUXT_EVAL_CONFIG_PATH` 重启后发起 → 错误通知、停留改文屏、按钮恢复可点；配置无 repair 节 → 503 文案、按钮转禁用并注明原因。
17. **provenance 落库抽查（可选）**：接受几条命中替换 + 一键机械清理 + 手打几个字 → 提交 → `SELECT provenanceJson FROM Revision ORDER BY ordinal DESC LIMIT 1` 应见 `{version:1, edits:[{kind:"static", ruleId:"…", count:n}, …, {kind:"user", count:1}]}` 逐规则计数。

### W7 规格：llm_fix 前端流程重设计（2026-07-08，用户审查返工）

> 用户审查结论："前端的 llmfix 还完全没有做好"——W4 的前端形态偏离了用户在 [Task 07](../07-web-review-editor/README.md) 已定的编辑器工作流设计。本节为返工规格；**W4 的服务端管线（扫描→组清单→repair prompt→mimo→守门）全部保留**，返工的是产物的去向与前端交互。
> ⚠ W3+W4 浏览器验收清单 **14–16 步作废**（AI 改写三步），随本工单落地后重写；1–13、17 步不受影响。

#### 核心诊断

W4 把 AI 改写做成了「后端管线产品化」：整篇一键 → 服务端直接建 Revision → 前端跳验收屏。用户原设计（Task 07 外部 LLM 工作流 + METHODOLOGY §2.3 五步⑤）是「编辑器中心的协作改写」。逐维对照：

| 维度 | W4 现状 | 用户原设计 |
|---|---|---|
| AI 输出的地位 | 直接成为不可变 Revision（落库即定版） | 一种编辑来源（`source:"llm"`）的**建议 diff**，进 piece-table 草稿 |
| 用户审阅 | 无（直接跳验收屏看前后对比） | Ctrl+Alt+N/P 逐处巡检、Ctrl+Alt+Enter 拒绝该处（回原文）、整批撤销，满意才提交定版 |
| 粒度 | 仅整篇 | 整篇 / 选区 / 单命中（Task 07 外部 LLM 三条路径） |
| 批注参与 | 无（repair-v1 只有命中清单） | prompt 携带「相关用户批注」（Task 07 `## 相关用户批注` 节）——五步⑤「标注即反馈通道」 |
| 与手改共存 | 有未提交手改则按钮禁用（改写基于 head） | 改写基于**当前草稿**，是草稿上的又一笔编辑 |

根本差异一句话：**改写结果是否经用户审阅才成为版本**。用户设计里 LLM 与「接受命中替换」「机械清理」地位相同——都是往草稿里写建议的手，出版权在用户。这也正是五步⑤闭环缺失的根源：AI 直接定版，用户的 span 标注根本没有机会流回改写输入。

#### 复用盘点（几乎全是接线，不是新建）

编辑面基建（`TextPanel.vue` + `useRepairDraft`）已具备全部所需能力：

- `repair.spliceDraft(0, len, newText, "llm", title)` —— 整篇替换 → llm diff（「剪贴板替换全文」`TextPanel.vue:331` 就是它）；
- `replaceSelection({from, to, replacement, source:"llm"})` —— 选区替换 → llm diff（`TextPanel.vue:300`）；
- diff 巡检 / 逐处拒绝 / plan 快照撤销 —— Task 09 阶段二以来的既有能力；
- `getReviewComments()` 已 expose —— 批注的草稿投影（quote+note+stale），喂 prompt 的现成出口；
- `getRepairEdits()` 已 expose —— transitionKind / provenance 数据源，diff 化后自动如实记录 llm 编辑；
- Task 07「复制选区优化指令」已定 prompt 结构（`## 选中文本` / `## 选区上下文` / `## 相关用户批注` / 只返回改写后的选中文本）——内置化 = 同样的输入不经剪贴板、直接调服务端通道。

⚠ **一个不能直接复用的点（2026-07-08 核实）**：`deriveDiffs` 是一条 edit 映射一条 diff、无内部细化（`repair-draft.ts:111`），且 web 无 diff 库——整篇改写若单条 `spliceDraft(0, len, …)` 并入，只会出**一条整篇大 diff**，逐处巡检/拒绝落空。F1 需引入 `diff-match-patch`（`diff_main` + `diff_cleanupSemantic`，语义聚块即「一处处改动」，deadline 参数兜底长文），对（当前草稿 × 改写稿）做 diff 后**逐 hunk 从后往前 splice**（每 hunk 一条 llm edit；cleanMechanical 的逐 AutoFixChange 反向应用是同款模式先例）。hunk 落在用户既有手改区时被吸收为 llm 编辑是**正确语义**（AI 确实改写了该处，内容来源如实变为 llm）。

服务端：`runLlmFixJob` 管线保留，摘掉尾部「建 Revision + MachineScan + detect」，改为把改写正文放进 job result 由前端消费。

#### 目标流程（重设计后的步③）

```
edit 屏（当前草稿 = 工作对象）
  ├─ 整篇 AI 润色（工具条按钮）
  │    输入 = 当前草稿快照 + 服务端按该快照扫描的命中清单
  │         + 编辑面批注(getReviewComments) + 该文本谱系已落库 SpanAnnotation（quote+note 形式，免坐标换算）
  │    → POST /api/llm-fix-jobs {textId, body, comments[]} → 轮询 → result.body
  │    → applyLlmRewrite(result.body)（= spliceDraft 整篇, source:"llm"）并入草稿
  ├─ 选区 AI 改写（选区 inline 菜单动作，秒级~几十秒）
  │    输入 = 选中文本 + 前后上下文窗 + 范围重叠的批注（对齐 Task 07 选区指令结构，不带命中清单）
  │    → 同端点 {textId, mode:"selection", selection, contextBefore, contextAfter, comments[]}
  │    → replaceSelection({source:"llm"})
  └─ （既有）接受命中替换 / 机械清理 / 手改 / 外部 LLM 剪贴板路径（通道 503 时的降级路）
  ▼ 巡检 llm diff：Ctrl+Alt+N/P 逐处看、Ctrl+Alt+Enter 拒绝该处、通知撤销整批、可继续手改
  ▼ 「提交改后版本」→ POST /revisions（transitionKind 见下）→ 验收屏（复评四维 + 标注 + D5，不变）
```

#### 服务端配套改动

1. **job 改「产出不落库」**：输入从 `revisionId`（恒 head）改为 `{textId, body, mode?, …}`；`runLlmFixJob` 尾部不再建 Revision / scan / detect；result = `{body}`（整篇）或 `{replacement}`（选区）。伪造面评估：body 本就是自由文本的改写输入，产物必须经用户 `POST /revisions` 才成版本、机器信号仍全部服务器算（D-C 不破），无新增伪造面。
2. **prompt 升版（I8 纪律）**，均进 `evals/generator/prompts.ts` 注册表单源：
   - `repair-v2` = repair-v1 + 「用户标注（哪里没改好）」节（有批注才出节；线 A 无批注时行为与 v1 等价，但版本号如实区分）；
   - `repair-selection-v1` = Task 07 选区优化指令内置化（选中文本 / 选区上下文 / 相关批注 / 只返回改写后的选中文本）。
3. **transitionKind 语义修正**（对齐 Task 12「llm_fix=纯AI档 / user_fix=人类含AI辅助档」）：kind = **改动内容的来源**，优先级 **user > llm > static**——出现任何 `user` 手改 → `user_fix`；否则出现 `llm` → `llm_fix`（含 static+llm 混合：内容全为机器产物且 llm 参与）；全 `static` → `static_fix`。「拒绝」不产生新内容（该处回原文），不影响剩余改动的来源判定；人的审阅监督由通道属性（web 采集 + 经巡检 + 有复评）承载，不用 kind 编码。现规则把 llm 归 user_fix 是 Task 07「剪贴板=人操作」时代的遗留。provenance 聚合不变（已逐来源忠实计数）。
4. **删除直接落库端点** `POST /api/revisions/[id]/llm-fix`：两条语义并存会让「llm_fix revision 是否经人审阅」不可判读（决策点 1）。

#### 前端配套改动

- `TextPanel` 新 expose `applyLlmRewrite(newText, title)`（= 整篇 spliceDraft + 撤销通知，「剪贴板替换全文」的程序化孪生）；
- edit 屏「AI 改写」按钮：**解除「无未提交手改」限制**（基于草稿快照发起）；等待期不锁编辑（决策点 3），返回时草稿快照校验——未变则直接并入，变了则弹「基于旧稿的结果」确认（仍然应用 / 放弃）；选区模式校验选区文本未变，变了提示重选重试；
- 选区菜单加「AI 改写选区」动作（与「复制选区优化指令」并排；通道 503 时只剩复制降级路）；
- 长文引导（决策点 4）：正文超过 maxTokens 换算的安全阈值时禁用整篇按钮、提示改用选区改写（选区模式天然规避截断——同时拍掉 TODO 的「llm_fix 长文边界」项）。

#### 决策点（已全部拍板，2026-07-08 用户「全部同意」按推荐执行）

1. **直接落库快捷路径**：✅ **删除**，统一审阅语义。
2. **transitionKind 口径**：✅ **内容来源口径**——全 llm 未手改 → `llm_fix`。
3. **整篇改写等待期**：✅ **不锁编辑** + 返回时快照校验（确认分支：仍然应用 / 放弃）。
4. **长文整篇改写**：✅ **按字数禁用 + 引导选区改写**（同时收掉 TODO「llm_fix 长文边界」项）。

#### 工单拆分（F1–F3，依次派发）

| 分片 | 内容 | 验证 |
|---|---|---|
| **F1 整篇改写 diff 化（核心返工）** | job 不落库模式 + `repair-v2`（两种批注进 prompt）+ `applyLlmRewrite` 接线（**dmp diff 细化逐 hunk 并入**，见复用盘点⚠注）+ **G5 diff 审阅横幅**（N 处修改、上/下一处、拒绝该处、已巡检 k/N 计数）+ 快照校验 + transitionKind 修正 + 删直接落库端点 + i18n | 改写返回后 edit 屏出现**逐处** llm diff 可巡检/拒绝/撤销；全盘接受提交 → `transitionKind=llm_fix` + provenance `[{kind:"llm"}]`；拒绝后手改提交 → `user_fix`；批注内容出现在发给模型的 user prompt（日志抽查） |
| **F2 选区 AI 改写** | `repair-selection-v1` + job selection 模式 + 选区菜单动作 + `replaceSelection` 接线 + 选区快照校验 + 长文引导（整篇按钮阈值禁用） | 选区改写秒级返回并入 llm diff；选区文本变更后返回 → 提示不并入；超长文整篇按钮禁用且提示引导 |
| **F3 体验打磨** | 等待态（可取消=停止轮询+解除状态）、失败重试、contribute 编辑屏补齐 Task 07「外部 LLM」整篇三动作（复制指令/复制指令+正文/剪贴板替换全文）作为内置通道降级路 | 取消后可重发；503 时外部剪贴板路径可用 |

#### F1 执行记录（2026-07-08）

**改动清单**（A 后端 / B 编辑面 / C 整合三分片合并交付；evals/ 只动 prompt 注册两件——线 A `repair.ts`、`repair-v1` 全冻结未动，`eval.config.json` 未改）：

| 件 | 文件 | 内容 |
|---|---|---|
| prompt 升版（I8） | `evals/generator/prompts.ts`、`evals/generator/repair-prompt.ts` | 注册 `repair-v2`（v1 基础上支持「用户标注」节，system 自包含；`DEFAULT_PROMPT_VERSIONS.repair` 仍 `repair-v1`）；`buildRepairUser(text, findings, comments = [])` 加可选第三参（`RepairComment = {quote, note}` 与 `COMMENT_QUOTE_CHARS = 120` 均导出）：comments 空 → 渲染与 v1 **逐字节等价**；非空 → 追加【用户标注（哪里没改好）】节（条目 `n. 原文「quote」——note`，quote 压空白 + 120 码点截断加省略号），收尾指令改「请只修复问题清单和用户标注里指出的问题」 |
| job 改「产出不落库」 | `web/server/utils/llm-fix.ts` | 输入从 `revisionId`（恒 head）改 `LlmFixJobInput = {textId, body, comments}`；W4 管线保留（scanBodyIssues → collectRepairFindings → buildRepairUser → mimo → 拒答守门），**摘掉尾部建 Revision / MachineScan / detect**，done ⇒ `result = {body}`（改写正文不落库，须经前端并入草稿、用户提交才成版本）；promptVersion 代码内固定 `WEB_REPAIR_PROMPT_VERSION = "repair-v2"`；批注**两源合并** = 请求 comments 优先 + 该文本谱系 SpanAnnotation（quote = 所挂 revision.body.slice(start, end)）按 note 去重补入；findings 与合并批注**同时为空**才判失败；debug 日志记 promptVersion 与批注条数（防泄漏不落正文） |
| 端点换代 | `web/server/api/revisions/[id]/llm-fix.post.ts`（**删**）、`web/server/api/llm-fix-jobs/index.post.ts`（新）、`web/server/api/llm-fix-jobs/[id].get.ts`、`web/server/middleware/auth.ts`、`web/server/utils/dto.ts`、`web/server/utils/ownership.ts` | 删直接落库端点（决策点 1）；新 `POST /api/llm-fix-jobs`：`CreateLlmFixJobDto = {textId, body(1..60000，沿上传口径), comments?(≤50 条：quote 1..60000、note 1..2000)}` → `{jobId}`；鉴权 middleware + `requireCurrentUser` 双层、`resolveOwnedText` 非本人/不存在一律 404 防枚举、通道未配置 503；GET 的 result 同步为 `{body}` |
| diff 细化纯函数 | `web/app/utils/llm-merge.ts`（新）、`tests/llm-merge.test.ts`（新）、`web/package.json` | 新依赖 `diff-match-patch`（+@types）；`computeLlmHunks(base, rewritten): LlmHunk[]`（`{from, to, replacement}`，base 上 UTF-16 码元半开区间、与 piece-table 同坐标系；diff_main + cleanupSemantic 语义聚块 + Diff_Timeout 1s 兜底——超时仅粒度变粗不破坏不变量；hunk 升序、互不重叠、相邻隔非空 EQUAL 段；**不变量 = 逐 hunk 从后往前应用 === rewritten**，全等返回 []）；11 条 vitest 用例（133 expect，含不变量与 piece-table 应用语义） |
| TextPanel 审阅能力 | `web/app/components/TextPanel.vue`、`web/app/components/ReviewEditor.vue` | 新 expose：`applyLlmRewrite(rewritten, title)`（computeLlmHunks 后逐 hunk 从后往前 spliceDraft 成多条 llm 编辑 + 整批一个 plan 快照撤销通知，返回 hunk 数；hunk 覆盖既有手改区吸收为 llm 编辑 = 契约语义）、`getLlmDiffs()`（llm diff 队列，id = plan edit id，拒绝后撤销恢复 id 不变）、`getActiveDiffId()`、`navigateLlmDiff(direction)`（llm 队列内环形跳转）、`rejectActiveLlmDiff()`（激活处回原文 + 自动激活相邻下一处）、`getRepairPlan()` / `restoreRepairPlan()`（stale 分支回置快照用）；ReviewEditor 最小 `defineExpose({activateDiff, activeDiffId})` 仅供 TextPanel 内部转调，宿主不直接依赖 |
| contribute 主循环 | `web/app/pages/contribute.vue`、`web/app/components/LlmReviewBar.vue`（新）、`web/app/utils/repair-draft.ts`、`tests/repair-draft.test.ts` | AI 改写改**草稿快照**发起（解除「无未提交手改」禁用；等待期编辑不锁，仅「提交改后版本」「返回报告」暂禁防跨屏竞态）→ 存 bodySnapshot + planSnapshot → POST（comments = `getReviewComments()` 滤空档、note 截 2000、≤50 条）→ 3s×140 轮询 → done 快照校验：未变直接并入；已变弹 stale 确认（common/Dialog，closeOnOverlay=false，X/Esc = 丢弃）——「仍然应用」= `restoreRepairPlan` 回置发起时快照再并入、「丢弃」= 作废并通知 → `applyLlmRewrite` 逐 hunk 并入 + LlmReviewBar 审阅横幅（共 N 处、上一处/下一处、拒绝该处、已巡检 k/N、llm diff 清零自动收起；拒绝时激活项非 llm diff 先 navigateLlmDiff("next") 不盲拒；已巡检 watch getActiveDiffId——横幅导航与 Ctrl+Alt+N/P 都计入）→ **改写后停留 edit 屏**（删 adoptLlmFixRevision 跳屏逻辑）；transitionKind 修正 = `classifyTransitionKind` 纯函数（内容来源口径 **user > llm > static**，决策点 2；附单测用例） |
| i18n | `web/app/i18n/messages.ts` | 新增 `notify.llmRewriteApplied`（「已并入 AI 改写：{count} 处修改」）与 `llmFix*` 新流程、`llmReview*` 横幅 key（zh/en 两套）；删旧 key，`llmFixDone` / `llmFixNeedCommit` 引用清零 |
| 修复轮（审查 blocker → 0） | `web/app/pages/contribute.vue` | 审查轮唯一 blocker：`mergeLlmRewrite` 在 `applyLlmRewrite`（同步改 plan）后**同一 tick** 调 `navigateLlmDiff`，`ReviewEditor.activateDiff` 读到未 flush 的旧 props.diffs 必然早退——首处自动激活静默失败且不自愈，同步返回的新 id 还是假信号；修法 = 库内既有先例同款 `void nextTick(() => …)`（contribute.vue 仅两处改动；stale 路径两次同步变更同函数一并修复）；无 DOM 复现脚本（@vue/runtime-core 自定义 renderer，调度语义与浏览器一致）4/4 PASS：修复前三个诊断点全复现、修复后激活成功 |
| 验证脚本（非产品件，保留复用） | `web/.agent/workspace/w7-f1-prompt-check.ts`、`f1-verify.ts`、`w7-f1-blocker1-repro.mjs` | prompt 双态 16 断言、API 真跑正负路径 27 断言、blocker1 复现 4 用例 |

**验证结果**（全绿；隔离纪律：隔离库 `data-f1.db` 与坏配置副本（`NUXT_EVAL_CONFIG_PATH` 注入）跑完已删、`web/data.db` md5 前后一致 `6efa39a1…` 未动、`evals/eval.config.json` md5 未动且不在 git status、dev server 3009 跑完已停端口已释放、无 git 提交）：

1. **静态**：`bun run typecheck` / `bun run typecheck:server` 双双 exit 0；`bun test` 全量 **143 pass / 0 fail / 511 expect**（9 文件，含新 llm-merge 11 pass / 133 expect）；vitest 风格 3 文件 `bunx vitest run` **101 passed**——evals/ 下 6 个 bun:test 风格文件 vitest 天然不认（双运行时既有现状，非 F1 引入），其本职 runner `bun test evals` **42 pass**。
2. **repair-v2 双态**（prompt-check 16/16）：无批注渲染与 repair-v1 **逐字节等价**（线 A 冻结的落地证明）；带批注含【用户标注（哪里没改好）】节头；quote 超 120 码点截断加省略号；默认版本仍 repair-v1；未知版本直接抛。
3. **API 真跑**（f1-verify 27 断言全绿，mimo 真调用）：register → 上传 1231 可见字（84 命中 / docScore 38.18）→ 挂 1 条谱系 SpanAnnotation → POST 带 2 条请求批注 **14ms** 返 jobId → **27.1s** done → `result.body` 非空且 ≠ 原文、该 text 的 **Revision 仍只有 rev0、MachineScan / MachineDetect 行数均不变 = 不落库成立**；服务端日志「[llm-fix] 完成 … 批注=3 条 字数=1231→932（产出未落库，待前端并入草稿后定版）」——**批注 3 = 请求 2 + 谱系补 1，两源合并如实**。共真跑两轮：job 总耗时 36.2s / 27.1s（POST 均 14–17ms 立即返回，3s 轮询）；改写前后命中 **84 → 62**、docScore **38.18 → 43.99**（缩稿致千字密度升，模型随机性如实记录——W3+W4 轮同文本曾降至 29.39）；detect 基线落库 ~10s（docPAi 0.9991）。
4. **负路径**（含 503 轮 3 断言）：不存在 textId → 404；A 对 B 的 textId → 404（防枚举）；B 轮询 A 的 job → 404；不存在 jobId → 404；未登录 POST → 401；comments 51 条 → 400；配置副本无 repair 节重启 → POST **503**「AI 改写通道未配置」+ 日志「通道禁用」；旧端点 `POST /api/revisions/:id/llm-fix` 已**无 API handler**（文件已删、web/ 产品代码引用零；判据字面出入见下「审查轮登记」）。
5. **修复轮全量回归**：blocker1 定点复验 4/4 PASS + typecheck×2 exit 0 + vitest 101 + `bun test evals` 42 全绿。

**与规格的出入**（实现申报 + 审查轮登记全量合并，不粉饰；审查轮 1 个 blocker 已在修复轮清零，**未解决 blocker：无**）：

*实现侧申报（拍板与取舍）*：

- **web 通道 promptVersion 不再消费 `eval.config.repair.promptVersion`**：真配置固定 repair-v1（冻结不可改）而 W7 web 语义必须 v2（批注节 + 版本如实，I8）→ 代码内固定 repair-v2 并注释说明；配置里该字段自此只约束线 A CLI。
- **findings 为空但合并批注非空不再判失败**（原实现 findings 空即抛）：v2 里用户标注是与问题清单并列的改写驱动源，纯标注驱动的改写放行；两者皆空才失败。
- 带批注时收尾指令由「请只修复问题清单里列出的问题」改「…问题清单和用户标注里指出的问题」（无批注保持 v1 原句，逐字节等价已断言）——规格未明说，属 v2 语义自然延伸。
- 批注 note 在 prompt 渲染时压掉换行/连续空白成单行（防多行 note 破坏编号列表结构），落库 / DTO 层原样；note 另在客户端按 DTO 上限静默截 2000 字（quote 不截，由服务端 120 码点截断兜底）。
- comments DTO 上限自行拍板（契约未定）：quote ≤ 60000（整段选区投影可能很长，prompt 侧统一截 120）、note ≤ 2000（对齐 SpanAnnotation 口径）、条数 ≤ 50（防 prompt 爆炸）。
- 新文案 key 落 `notify.` 前缀而非工单说的 `text.` / `review.`——唯一新文案是通知类，按仓内既有惯例。
- `llm-merge.ts` 额外导出 `computeLlmHunksWithTimeout`（仅测试注入超时）；生产入口 `computeLlmHunks` 签名与契约逐字一致。
- 导航/拒绝暴露形式选「expose 方法 + defineExpose」（与 TextPanel 既有 4 个 expose 一致；工单授权自选形式）。
- 整合分片由主循环人工完成而非 subagent（两轮 API 中断，半成品逐件复核后保留）。
- stale 确认复用 `common/Dialog`（closeOnOverlay=false；X/Esc 映射为「丢弃」并通知）。
- 等待期「提交改后版本」「返回报告」保持禁用（W4 原状语义）：编辑自由但不许中途换屏，规避轮询回调跨屏竞态。

*审查轮登记（minors，均不阻塞浏览器验收；规格审查据此判 pass=false，如实留档）*：

- **旧端点 404 判据字面不成立（平台行为出入，非产品残留）**：nitro 对一切未匹配 `/api/*` 返回 200 + HTML 页面 fallback 而非 404 JSON（对照 `/api/definitely-not-a-route` 同现象）；后续验收清单措辞应改「无 API handler / 非 JSON API 响应」。
- **`web/README.md:48` 仍记载已删除的 `POST /api/revisions/:id/llm-fix` 与 repair-v1**：F1 删了端点但本工单纪律不许动该 README，待后续更新为 `POST /api/llm-fix-jobs` + repair-v2 + 产出不落库语义。
- 工单验证判据写 `bunx vitest run`，但 evals/ 下 6 个既有测试是 bun:test 风格（vitest 天然不认，非 F1 引入）；仓根正统入口是 `bun test`（package.json verify script，143/143 绿）。
- llm-fix 两源合并明细 debug 日志（「请求 N + 谱系补 M」）在 nuxt dev 默认 consola 级别下不可见，仅 info 级「完成」行的批注总数兜底——排查两源合并问题需调日志级别。
- **批注条数封顶只挡请求侧**：DTO comments ≤ 50，但谱系 SpanAnnotation 合并无上限、`buildRepairUser` 对 comments 也无条数封顶（findings 有 maxRules=25 对照）——谱系标注多轮累积时 prompt 仍可能膨胀，「防 prompt 爆炸」守卫不完整。
- **已解决（resolved）与 stale 的编辑面批注未从 prompt 载荷过滤**（`getReviewComments` 全量返回，contribute 只滤空档）——用户已标记解决的意见继续喂模型语义存疑；规格未规定，待拍板。
- `notify.llmRewriteApplied` 的 {count} 用 applyLlmRewrite 返回值、横幅 N 用 `getLlmDiffs().length`——hunk 吸收合并手改区或恰好把某处改回原文时两数可不一致（契约已声明差异，同屏两数打架属可感知小瑕疵）。
- `web/shared/revision-provenance.ts` 注释过期：仍写「llm_fix 端点写入」「model/promptVersion 仅 llm_fix 的服务端写入非空」——W7 后该写入方已不存在，llm_fix 修订的 model/promptVersion 不再有持久化记录（行为符合规格示例 `[{kind:"llm"}]`，promptVersion 仅在 debug 日志），注释待清理。
- llm-fix 轮询无瞬时错误容忍：任一次 GET 抛错（网络抖动）立即终止整个 ≤7 分钟等待（对照 pollDetects 的 catch-continue 模式）——F3 体验打磨候选。
- F1 验收句「批注内容出现在 user prompt（日志抽查）」实际不可用日志核验：debug 日志按防泄漏原则只记条数，覆盖改由 `w7-f1-prompt-check.ts` 断言承担（已声明取舍，登记备查）。
- 第二轮真跑 docScore 改写后上升（38.18 → 43.99）：命中 84→62 但 1231→932 缩稿使密度指标升——模型行为非 F1 代码问题，如实记录。

*修复轮摘要*：round 1 解决 1 / 剩 0——blocker = 「并入后首处 llm diff 自动激活静默失败」（同 tick 读旧 props.diffs），修法与复验见改动清单「修复轮」行；**未解决 blocker：无**。

*验证后 minor 修复轮（主循环，2026-07-08，回归双 typecheck + vitest 101/101 全绿）*——上表 4 条 minor 已修，其余保持登记：

- ✅ llm-fix 轮询瞬时容错：GET 抛错按一次未命中计继续等（照 pollDetects 口径）；唯 404（job 丢失=服务重启/TTL 清扫）快速失败——继续等不会有结果。
- ✅ 谱系批注合并封顶：两源合并后 `.slice(0, 50)`（与 DTO 请求侧同参，请求批注优先），debug 日志谱系计数改为封顶后真实值。
- ✅ `web/README.md` API 面更新为 `POST /api/llm-fix-jobs` + repair-v2 + 产出不落库语义。
- ✅ `web/shared/revision-provenance.ts` 过期注释清理（W7 后服务端无写入方；model/promptVersion 持久化与否仍待拍板，见 TODO）。

落地后重写浏览器验收 14–16 步（diff 巡检、拒绝、transitionKind 三态、选区改写、长文引导）。

### W8 规格：五步流程引导完形（2026-07-08，与用户讨论定稿）

> 用户诉求：「希望能对用户进行显式的流程引导，而不是现在这样几乎没有流程引导」。讨论后三点拍板（2026-07-08 用户「全部同意」）：**① stepper v1 不可点击回跳、纯展示**（现状「离开 edit 再回来丢未提交改动」的坑不放大，导航仍走各屏显式按钮）；**② 引导浓度 = 常显一行紧凑 + 可折叠且记住偏好**（localStorage）；**③ 排期串行 F1 → W8 → F2 → F3**（全部动 `contribute.vue`，避免并发冲突；W3+W4 合并派发同因）。G5（diff 审阅横幅）归 W7 F1，不在本工单。

#### 现状问题（引导为什么「几乎没有」）

① draft 屏看不到旅程（stepper 提交后才出现且仅 3 节点）；② 盲评的「为什么」无解释（D2 闸门表现为"什么都不显示"）；③ 每屏不回答「我在哪/做什么/下一步」；④ 标注的价值没讲（W7 后「标注喂 AI」已是真实数据流）；⑤ 无完成态（换新文本靠刷新页面）；⑥ 主次动作不分（双提交按钮并排同权重）；⑦ 循环无轮次感。

#### 设计原则

- **每屏三问**：任何时刻能回答「我在第几步 / 这步做什么（为什么）/ 下一步是什么」。
- **一屏恰好一个主 CTA**：推荐动作实心主按钮，其余降为次按钮/文字链接。
- **门控显式化**：因 D2 隐藏的内容用「锁定 + 原因」表达，不静默缺席。
- **引导可收敛**：常显一行、可折叠、记住偏好，老手不被打扰。
- **不做**：首访 onboarding 弹窗（G1+G2 已覆盖其职责，多弹窗是打扰）；stepper 点击回跳（v1）。

#### 交付件 G1–G4、G6

| 件 | 内容 |
|---|---|
| **G1 全程 stepper 升级** | 进页面即显示（draft 屏也有）；五步映射方法论编号 `① 上传·盲评 → ② 检测报告 → ③ 润色 → ④ 验收·复评`，⑤循环 = ③④ 间回环标记 + 轮次徽标（「第 k 轮 · revN」）；未到步灰显 + 悬停给解锁条件（如 ②「提交盲评或跳过后揭示」= 门控显式化落点）；节点不可点击 |
| **G2 每屏引导条** | stepper 下一行紧凑文案（做什么 + 为什么 + 下一步预告），可折叠（localStorage 记忆）。文案要点：draft=「凭第一印象打分，先打分再看报告直觉不被带偏，可跳过」；report=「高亮为规则命中；选中片段写标注——AI 改写会参考你的标注；看完开始改文」；edit=「推荐顺序：一键清理 → 逐条处理命中 → AI 改写（diff 逐处审阅）→ 手改；随时可撤销」；verdict=「对比指标、打分写评语；不满意处在下方正文选中标注，继续润色开始下一轮」。zh/en 两套 |
| **G3 主 CTA 纪律** | 每屏一个主按钮：draft=「提交盲评」（跳过降为文字链接）、report=「开始改文」、edit=「提交改后版本」、verdict=「提交复评」；**复评提交后主 CTA 跟 D5 结果走**：未通过 → 「继续润色」为主，通过 → 「完成本篇」为主 |
| **G4 谱系进度条** | edit/verdict 屏显示 rev 链 chips：`rev0 原文 → rev1 静态 → rev2 AI改写(当前)`，transitionKind 标类型（upload/static_fix/llm_fix/user_fix 各一标签色），当前 head 高亮；轮次感由它承载 |
| **G6 完成态 + 再传一篇** | verdict 屏新增「完成本篇」出口 → 贡献总结卡：rev 链、盲评 vs 终评分数、D5 结论、标注条数 + 感谢语 + 「再传一篇」（**原地重置全部状态**，替代刷新页面）+「查看数据集」链接 |

#### 组件抽取（contribute.vue 破 800 行的预防）

`FlowStepper.vue`（G1）、`StepGuideBar.vue`（G2，折叠记忆内聚在内）、`LineageStrip.vue`（G4）、`ContributionSummary.vue`（G6 总结卡）四个展示组件进 `web/app/components/`；状态与流转逻辑留在 `contribute.vue`（组件只收 props / emit 动作，不自持流程状态）。

#### 验证

- 脚本级：typecheck 双侧绿；既有 repair-draft 测试不破。
- 浏览器验收（并入总清单）：draft 屏即见五步 stepper（②③④ 灰显 + 悬停解锁条件）；引导条四屏各就位、折叠后刷新仍记住；各屏主按钮唯一且正确（跳过为链接样式）；复评后 CTA 随 D5 结果切换；第二轮润色 stepper 出现轮次徽标、谱系条 chips 与库中 transitionKind 一致；「完成本篇」出总结卡、「再传一篇」原地清态可直接开始新流程；切 en-US 全部文案跟随。

### W8 执行记录（2026-07-08）

**改动清单**（全部在 `web/app/`，服务端零改动）：

| 件 | 文件 | 内容 |
|---|---|---|
| G1 stepper | `components/FlowStepper.vue`（新） | 五步映射 ①–④ + ⑤回环标记（③④ 间 repeat 图标 + title 说明）+ 轮次徽标；三态节点（✓/当前/灰显+锁定 title=门控显式化）；纯展示不可点击（拍板①）。轮次 k 语义按 headOrdinal 定：edit 屏=第 headOrdinal+1 轮、verdict/done=第 headOrdinal 轮、**k≥2 才显示**（第 1 轮是主线不是循环） |
| G2 引导条 | `components/StepGuideBar.vue`（新） | 四屏引导文案（做什么+为什么+下一步）+ 折叠 localStorage 记忆（key `llmlint.contribute.guideCollapsed`；折叠偏好内聚组件内=纯展示纪律唯一例外，拍板②） |
| G4 谱系条 | `components/LineageStrip.vue`（新） | rev 链 chips，transitionKind 四类标签色（upload 中性/static 蓝/llm 紫/user 绿，类别识别色），当前 head accent 描边；edit 屏右栏头部与 verdict 屏标题下两处渲染 |
| G6 总结卡 | `components/ContributionSummary.vue`（新） | rev 链（复用 LineageStrip）+ 盲评 vs 终评两列（跳过盲评/未复评各有占位文案）+ D5 结论五态（pass/passDegraded/fail/noBaseline/**none=未复评**）+ 标注条数 + 感谢语 + 「再传一篇」（emit restart）/「查看数据集」（/dataset） |
| 接线 | `pages/contribute.vue` | `SubmitStep` 加 `done`；`lineage` 数组（上传 push rev0、提交修订 push 新边、resetFlow 清空）+ `annotationCount` 轻量计数；G3 主 CTA 纪律（draft 跳过降为文字链接、verdict 复评后 CTA 跟 D5：`continueIsPrimary` 仅在「已复评+有盲评基线+未通过」时让「继续润色」为主，其余「完成本篇」为主）+ `finalScores`/`summaryVerdict` 折算 computed；**`resetFlow()` 全量重置**（逐项对照 ref 清单，豁免项带理由注释：请求生命周期态/503 配置态/用户过滤偏好）；旧 3 节点 stepper（W2）删除 |
| 事件 | `components/AnnotatableRevisionText.vue` | 新增 `annotated` emit（标注保存成功时），report/verdict 两处入口 `annotationCount += 1` |
| i18n | `i18n/messages.ts` | 新增 31 个 `contribute.*` key（flowStep*/flowLock*/flowLoopHint/flowRoundBadge/guide*/lineage*/summary*/restartButton/viewDataset/finishButton），zh-CN/en-US 两套 |

**验证结果**：`bun run typecheck` 与 `bun run typecheck:server` exit 0；`bunx vitest run tests/` 101/101；模板新增段全部走 `t()` 无硬编码中文；`web/data.db`、`eval.config.json`、服务端代码未动。浏览器验收留用户（清单见下）。

**与规格的出入**（如实）：

- **实施途中执行 agent 两次死于上游 API 中断**（47 次与 2 次工具调用后）：四个组件、脚本侧状态/computeds/resetFlow、i18n 由 agent 完成；contribute.vue 模板接线与 `finishButton` key 由主循环人工收尾（照 F1 先例，收尾后全量回归）。
- 「完成本篇」**不设复评门槛**：未复评也可完成，总结卡 D5 行显示「未复评」（none 态）——规格未规定，采宽松口径防流程死角（总结卡 SummaryVerdict 的 none 态即为此设计）。
- ContributionSummary 落为独立组件（规格允许「独立组件或 verdict 屏内完成态视图」二选一）；标注条数采前端轻量计数（AnnotatableRevisionText 加 annotated 事件）而非从简省略。
- G3 的 verdict 屏「完成本篇」在复评通过与「无盲评基线」第三态下都作主按钮（规格只写了通过态；第三态无人评腿可判、留在本屏无更多可做，同按「完成」引导）。

**W8 浏览器验收清单**（接总清单 17 步之后）：

18. **全程 stepper**：进 `/contribute`（draft 屏）即见五步 stepper，① 高亮、②③④ 灰显；悬停灰节点出现解锁条件提示（如 ②「提交盲评或跳过后揭示」）；点击节点无任何反应（纯展示）。
19. **引导条**：stepper 下方一行引导句随屏切换（draft/report/edit/verdict 四套）；点右侧箭头折叠 → 只剩「流程引导」短标签；**刷新页面仍保持折叠**；再点展开。
20. **主 CTA 纪律**：draft 屏「跳过打分直接看报告」为文字链接样式、「提交盲评」唯一实心主按钮；report 屏「开始改文优化」主按钮；edit 屏「提交改后版本」主按钮（AI 改写/返回报告为次级）。
21. **谱系条**：edit 屏右栏头部与 verdict 屏标题下见 rev 链 chips（`rev0 原文` 起），当前 head 有 accent 描边；提交一轮静态清理后链变 `rev0 → rev1 静态清理`（蓝）、AI 改写全盘接受提交后出现紫色 `AI 改写` chip、手改提交绿色（可对照库中 transitionKind）。
22. **轮次徽标**：第一次「继续润色」回改文屏后，stepper 右侧出现「第 2 轮 · rev1」徽标；③④ 之间连接符是回环图标（悬停有循环说明）。
23. **复评后 CTA 切换**：提交复评且 D5 未通过 → 底部「继续润色」变实心主按钮；通过（或跳过盲评的无基线态）→ 「完成本篇」变主按钮。
24. **完成态与再传一篇**：点「完成本篇」→ 总结卡（rev 链 / 盲评 vs 终评两列 / D5 结论 / 标注 N 条 / 感谢语）；跳过盲评路径盲评列显示「跳过」；未复评就完成 → D5 行显示「未复评」；点「再传一篇」→ 回 draft 屏且全部清空（正文/自报三项/授权/滑条），直接可开始新一篇（无需刷新）；「查看数据集」跳 `/dataset`。
25. **i18n**：切 English → stepper/引导条/谱系 chips/总结卡全部跟随英文；切回中文正常。

### W9 规格：内网信任模式与入口统一（2026-07-08，用户拍板）

> 用户三点指令：① 「管理员密码是什么」——核查结论：**系统无任何内置管理员**（register 恒建 role=user，无 seed），须补引导；② 「不要贡献数据这个 tab 了，改成『检测』。目前不用登录的用户统一走原有的贡献数据流程」；③ 「默认信任所有用户，服务内网私有部署」。

实施拍板（用户方向下的细节由本轮定，写明理由）：

- **W9-A 匿名自动会话**：middleware 对受保护路径（写 API / 流程页）在无 session 时**自动创建匿名用户并落 session**（`username=anon-{随机8}`、随机密码散列、role=user），用户无感免登录走完整五步流程。数据仍归属该匿名用户——ownership / blind(D2) / `@@unique(userId, revisionId)` 语义全部保留（选匿名会话而非「共享单用户」正是为此）。清 cookie/换设备 = 新匿名身份（内网可接受，注明）；正式注册/登录保留，匿名期间数据留在匿名账号不迁移（v1 不做合并）。
- **W9-B admin env seed**：nitro 启动 plugin 读 `NUXT_ADMIN_USERNAME` / `NUXT_ADMIN_PASSWORD`（放 gitignored 的 `.env`，密码绝不进 git）——用户不存在则创建为 admin；已存在则仅确保 role=admin、**不覆盖密码**；env 缺省则跳过（零副作用）。`/api/export` 保持 requireAdmin。
- **W9-C 入口统一**：导航去掉 playground 检测链接；「贡献数据」label 改「检测」；`/` 重定向 `/contribute`（直访与客户端导航都生效）；playground 页迁 `/playground` 保留（编辑器调试用，不进导航）。报告 / 数据集 tab 不动。
- **W9-D consent 默认勾选**：内网私有部署，授权开关默认 true（仍可手动关闭；DTO 校验不变）。
- middleware 相应简化：`/contribute` 页面 gate 删除（页面即入口）；写 API 名单保留但由匿名自动会话满足（同时把 TODO 里「名单失真」项顺手收敛：动态路径 reveal/machine/llm-fix-jobs/:id 的 handler 层鉴权不变，是主防线）。

### W9 执行记录（2026-07-08）

**改动清单**（W9-A/B/C/D 四件全落）：

| 件 | 文件 | 内容 |
|---|---|---|
| W9-A 匿名自动会话 | `web/server/middleware/auth.ts` | 重写为内网信任模式：`protectedWriteApiPaths` 精确集合（/api/texts、/api/judgments、/api/annotations、/api/llm-fix-jobs、/api/export）命中且无 session → 自动建匿名用户（username = `anon-` + 8 位随机 hex，displayName 同名；密码 = randomBytes(24).base64url 一次性强密码经既有 hashUserPassword 只存散列、明文不进日志；role=user / identityRole=reader / status=active 走 schema 默认）→ `setAuthSession` 落 session 放行 + info 日志一条（username+userId+path）。不再 401 拦截；旧 `publicApiPaths`/`isPublicPath` helper 与 `/contribute` 页面 gate 一并删除（新逻辑只对写名单动作，其余路径天然放行）。动态路径端点（reveal/machine/llm-fix-jobs/:id）不在名单，依赖首个写请求已落 cookie，handler 层鉴权仍是主防线；`/api/export` 命中后仍被 requireAdmin 挡 403，无提权面。并发首访可建多个匿名用户 = 可接受（代码注释注明）；清 cookie = 新匿名身份，旧数据不迁移 |
| W9-B admin env seed | `web/server/plugins/admin-seed.ts`（新）、`web/nuxt.config.ts` | nitro 启动插件，读 `NUXT_ADMIN_USERNAME` / `NUXT_ADMIN_PASSWORD`（Nuxt 惯例路径：runtimeConfig.adminUsername/adminPassword 空串默认 + 环境变量运行期覆盖）。三态幂等：两者齐备且用户不存在 → 建 admin（scrypt 散列落库）；用户已存在 → 仅确保 role=admin、**绝不覆盖密码**；env 缺任一 → 跳过零副作用。三态各一条日志、绝不落密码；种子失败 catch 住不拦启动 |
| W9-C 路由终态 | `web/app/pages/index.vue`（新）、`web/app/pages/playground.vue`（迁）、`web/app/components/AppHeader.vue`、`web/app/i18n/messages.ts` | `/` = 新 index.vue 的 `definePageMeta({redirect: "/contribute"})`（路由级 redirect 编译进 vue-router 路由表，ssr:false 下直访与客户端导航都在渲染前生效）；原 playground 页整体迁 `/playground`（内容一字未动，可直访、不进导航）；导航 = 检测(/contribute，占原检测首位) \| 评测报告(/report) \| 数据集(/dataset)；i18n `header.contribute` = zh「检测」/ en「Detect」，`header.check` key 连同消费点清零删除（类型联合 + zh + en 三处）；账号下拉 contribute 项 label 随 header.contribute 联动 |
| W9-D consent 默认勾选 | `web/app/pages/contribute.vue` | `consent = ref(true)`（内网私有部署拍板注释），resetFlow 复位值同步 true；DTO 校验不变 |
| 文档 | `web/README.md`、`web/.env.example` | README 鉴权节改写为内网信任模式说明 + admin seed 占位符示例；.env.example 追加 NUXT_ADMIN_* 注释占位块 |

**验证结果**（全绿）：运行断言合计 **61 项**：phase api 39（静态 9 + 路由 4 + 匿名五步链 15 + 权限边界 7 + 注册通路 4）+ phase admin 7 + phase admin2 3 + phase promote 6 + 编排级 6（hash 摘要幂等对比 2、三态日志 3、密码零泄漏 1）。dev server 真跑 **4 形态**（3010 无 env / 3011 首种 / 3012 幂等重启 / 3013 promote），全部 node 起、跑完停、端口释放。静态：双 typecheck exit 0、`bunx vitest run tests/` 101/101（3 文件）。

**与规格的出入**（如实）：

- 工单写「删 playground 检测链接（桌面 NuxtLink 与移动端下拉两处）」——实际 AppHeader 不存在移动端导航下拉，只有桌面 NuxtLink 一处（已删）；唯一下拉是账号菜单，其 contribute 项 label 随 header.contribute 自动变「检测」，无移动端 select 逻辑可同步。
- 导航顺序自行拍板：/contribute（检测）放原 playground 检测 tab 首位（工单未指定顺序，报告/数据集不动）。
- 三处小范围超字面但同向的一致性修缮：① 账号下拉 contribute 项图标 database-zap → scan-text；② nuxt.config head meta description/og:description 更新（原「贡献流程登录后落库」「注册用户贡献」在 W9 后为假陈述）；③ .env.example 追加 NUXT_ADMIN_* 占位块。
- `/api/export` 保留在匿名会话触发名单内（规格「名单保留」字面执行）：未登录探测 export 会先建一个匿名用户再被 403（旧行为 401）——垃圾账号面极小、内网可接受。
- **触发面按 path 不按 method**（minor，留 TODO 观察项）：契约按 method+path 措辞（POST /api/texts…、GET /api/export）而实现是 `protectedWriteApiPaths.has(pathname)` 无 method 条件——实测 GET /api/texts（该路径无 GET handler）也创建了匿名用户；HEAD/OPTIONS 探测同理。与 export 探测同性质（无提权面），一行可修（加 event.method 判断）但属行为语义拍板项，未顺手改。
- `GET / → /contribute` 在 ssr:false 下是 vue-router 路由表行为，HTTP 层无法观测 302：以「index.vue definePageMeta({redirect}) 静态断言 + 三路径 200 SPA shell」作等效判据（工单「重定向或等效」允许），浏览器直访跳转留用户验收。
- 验证脚本 `w9-verify.ts` 按工单要求保留于 `web/.agent/workspace/`（与 f1-verify.ts 同列复用）；admin 编排脚本用后已删。

**未解决 blocker：无**。

### F2 执行记录（2026-07-08）

**改动清单**（W7-F2 选区 AI 改写 + 长文引导；repair-v1/v2 与线 A `evals/generator/repair.ts` 逐字节未动，eval.config.json 未改）：

| 件 | 文件 | 内容 |
|---|---|---|
| prompt 注册（I8） | `evals/generator/prompts.ts`、`evals/generator/repair-prompt.ts`、`evals/generator/repair.test.ts` | 注册 `repair-selection-v1`（repairPrompt() 可解析；DEFAULT_PROMPT_VERSIONS 仍 repair-v1）；新导出 `buildRepairSelectionUser({selection, contextBefore, contextAfter, comments?})`：渲染 = `## 选中文本`(围栏) → `## 选区上下文`（before+【selection】+after 重组原文窗，两窗皆空整节省略）→ `## 相关用户批注`（有才出节，quote 压空白+120 码点截断）→ 收尾「只返回改写后的选中文本，不要输出其他内容。」；**不组命中清单**（Task 07 选区指令结构）；+2 条选区测试 |
| DTO 判别联合 | `web/server/utils/dto.ts` | `CreateLlmFixJobDtoSchema` = z.preprocess(缺 mode 补 "full" 向后兼容) → z.discriminatedUnion("mode")：full={mode,textId,body:1..60000,comments?}；selection={mode,textId,selection(raw≤60000 且可见字≤8000),contextBefore/contextAfter(≤2000,default "")，comments?}；comments 两模式同形 ≤50 条 |
| 服务端 selection 管线 | `web/server/utils/llm-fix.ts`、`web/server/api/llm-fix-jobs/index.post.ts`、`web/server/api/llm-fix-jobs/[id].get.ts` | `LlmFixJobInput` 改 full\|selection 判别联合；`LlmFixJob.result?: {body} \| {replacement}`；channel 双 prompt = full:repair-v2 / selection:repair-selection-v1；selection 管线**只用请求批注**（谱系 SpanAnnotation 不并入，坐标映射不安全已注释）、maxTokens=min(16000, 选区可见字×4+1000)、守门=非空且≠原选区（trim 比较），长度异常仅 warn 不硬拒 |
| 前端发起链 | `web/app/components/ReviewSelectionMenu.vue`、`ReviewSourceSelectionMenu.vue`、`ReviewEditor.vue`、`TextPanel.vue` | 选区菜单新增「AI 改写选区」（prop `llmRewriteEnabled` + emit，与「复制指令」并排，i-lucide-bot）→ ReviewEditor 组 payload（text=modelValue.slice(from,to)，前后各 300 UTF-16 码元上下文窗）→ TextPanel 同签名透传；TextPanel 新 expose `replaceSelection(payload)`（notify 联合扩 "llmSelection"） |
| contribute 接线 | `web/app/pages/contribute.vue` | `:llm-rewrite="!llmFixUnavailable"`（503 后入口隐藏只剩复制降级路）；`startLlmFixSelection` 只送与选区区间相交的批注；1.5s×280 轮询（≈7min 与整篇上限对齐）、共用 llmFixRunning 互斥；返回做**三级快照校验**（`applySelectionRewrite`：① 原坐标文本未变原位并入 ② 全文唯一命中新坐标并入 ③ 失效提示作废）成可审 llm diff；长文引导 = `LLM_FIX_FULL_MAX_VISIBLE_CHARS = 12000` 超限禁用整篇按钮，title 三态 = 503 原因 > 长文引导 > 常规 |
| i18n | `web/app/i18n/messages.ts` | 新 key：contribute.llmFixBusy / llmFixTooLong / llmFixSelectionDiffTitle / llmFixSelectionStale、notify.selectionLlmRewritten、review.llmRewriteSelection / llmRewriteSelectionTitle（MessageKey 联合 + zh + en 三处齐） |
| 验证脚本（非产品件） | `web/.agent/workspace/f2-verify.ts`（新）、`w7-f2-prompt-check.ts` | 真跑断言脚本，gitignored 保留复用 |

**验证结果**（全绿）：脚本断言 **61 条**（f2-verify 真跑 29 + w7-f1-prompt-check 16 + w7-f2-prompt-check 16）；`bunx vitest run tests/` 101/101（3 文件）；`bun test evals/` **44 pass / 0 fail / 124 expect**（F1 基线 42 + F2 新增 2）；typecheck 三连 exit 0（web app / web server / 仓根 tsc）；**真调 mimo 两轮**：selection job ≈42.5s（126→107 可见字）、full job ≈27.2s（640→599 可见字），POST 均 ≤12ms 立即返回。

**与规格的出入**（实现申报 + 复核轮登记合并，如实）：

- `startLlmFix` 错误出口重构为整篇/选区共用 `notifyLlmFixError`：POST 404（文本不存在）现在也走「AI 改写失败：{reason}」包装（F1 原实现为裸消息），503 与其余路径行为不变。
- 选区改写并入**不打开 F1 审阅横幅**（单处 diff + 专属撤销通知已足够；若横幅已开，新 llm diff 自然进队列计数）——规格未规定，自行拍板。
- 服务端 selection 守门在工单要求外加「空结果」硬拒；「长度异常只记日志」的比例阈值（>3倍+60 或 <约1/3）自行拍板——申报措辞「<1/3−60」与实现（rewritten×3+60<selection ⇔ rewritten<selection/3−20）有微差，仅日志阈值无行为影响，留档备查。
- 批注行渲染格式在 `buildRepairSelectionUser` 内复制 repair-v2 同款而未抽公共函数——防触碰 v1/v2 冻结路径（行为逐字节不变优先于复用）。
- 上下文在 prompt 中以 before+【选中文本】+after 重组为连续原文窗并用【】标位（Task 07 原型是含选区的整段窗，重组等价；【】仅定位提示已在注释说明）。
- TODO「llm_fix 长文边界」行为已落地，README TODO 行由本链尾环节统一收口（见 TODO 区）。
- 复核轮核对：实施 agent 原自验脚本与验证清单口径有出入（注册用户非匿名会话、正文 555 字、选区 26 字）——已按清单口径重写 f2-verify.ts 并全绿，产品代码无问题；选区真跑 ≈42.5s 高于「秒级~几十秒」预期上沿（mimo 延迟波动，轮询预算内富余）；`web/.agent/workspace/` 残留更早任务 spike 库文件 4 个（非 F2 产物，gitignored，纯观感）。

**未解决 blocker：无**。

### F3 执行记录（2026-07-08）

**改动清单**（W7-F3 体验打磨，全部 `web/app/` 前端，服务端零改动）：

| 件 | 文件 | 内容 |
|---|---|---|
| ① 等待可取消 | `web/app/pages/contribute.vue` | 取消令牌 = 组件内 `let llmFixGeneration` 代数计数（照 detect 槽既有手法）：发起 `runLlmFixFull/Selection` 时 `++` 并置 running；`cancelLlmFix()`（仅 running 时可用）= 代数+1 + running=false + info 通知（后端无取消端点，job 跑完落内存表无人轮询、TTL 1h 清扫丢弃，注释注明）。`pollLlmFixJob(jobId, intervalMs, maxAttempts, generation)` 签名变更，返回 `LlmFixJobDto \| "timeout" \| "cancelled"`——每次 sleep 后与 GET 返回后各查一次代数，过期即 "cancelled"；run* 的 POST 返回处与 catch 同样查代数，finally 只在代数仍当前时收 running（取消后立即重发时旧调用不覆盖新状态）。取消按钮 = edit 屏工具区 AI 改写按钮右侧，`v-if="llmFixRunning"`（i-lucide-x） |
| ② 失败重试 | `web/app/pages/contribute.vue` | 发起函数拆「捕获快照 + run」两层：`startLlmFix()` 捕获 `{bodySnapshot, planSnapshot, comments}` → `runLlmFixFull(input)`；选区同构；重试闭包 = `() => void runLlmFix*(同一 input)` 快照原样重发（返回后走原快照校验路径）。`notifyLlmFixFailure(message, retry)` = error 通知 + `action:{label:重试, run}`（撤销通知同款机制）；job failed / timeout / 网络与 404 都带重试；503 不带（通道禁用态，入口同步禁用）；选区 stale 作废不带（重发必再定位失败）。run* 入口守卫：running → busy 通知；`step!=="edit"` → 静默忽略（重试通知离屏后点击） |
| ③ 外部 LLM 降级三动作 | `web/app/pages/contribute.vue` | 复用 `utils/llm-optimization-prompt.ts` 的 `buildLlmOptimizationPrompt`（本就是 playground/SummaryBar 共享 util，零抽取）+ `common/Dropdown.vue`：edit 屏工具区（返回报告与 AI 改写之间）SummaryBar 同款三项菜单——复制指令 / 复制指令+正文（→ `copyEditOptimizationPrompt`，输入 = editDraft + editFilteredIssues + 新 computed editSummary + filters + getReviewComments()）/ 剪贴板替换全文（→ 确认 Dialog 复用 llm.replaceFull* 键 → TextPanel 既有 `replaceTextFromClipboard()`，替换成功且有 llm diff 时打开 LlmReviewBar 审阅横幅 + nextTick 激活）；**入口永不禁用**（503 时是唯一 AI 路径） |
| ④ i18n | `web/app/i18n/messages.ts` | 新 key：contribute.llmFixCancel / llmFixCancelTitle / llmFixCancelled / llmFixRetry（MessageKey 联合 + zh + en 三处齐）；菜单/弹窗复用既有 llm.* 与 notify.optimizationPrompt* 键；resetFlow 补 `replaceFullTextConfirmOpen=false` |

**验证结果**：双 typecheck exit 0（build-registry + vue-tsc app / vue-tsc server）；`bunx vitest run tests/` 101/101（无回归）。纯前端改动未起 dev server（双 typecheck 已覆盖模板绑定）；evals/、eval.config.json、web/data.db 未动。

**与规格的出入**（如实）：

- 失败/超时重试通知 duration 用 8000ms（普通 error 5200ms）：等待期不锁编辑、用户可能不在盯屏，放宽反应窗口；规格「同撤销通知款式」指 label+run 机制，已一致（代码注释注明）。
- 重试通知在离开改文屏后被点击 = 静默忽略（run* 的 step 守卫，无编辑面可并入）；选区 stale 与 503 不带重试动作——前者重发必再定位失败、后者重发必然同 503，均无意义。
- 外部 LLM 菜单未抽公共组件：prompt 构造本就是共享 util（import 即复用），下拉 items 仅 ~20 行且 SummaryBar trigger 样式不同，按「不为拆而拆」在 contribute 内联，SummaryBar/playground 未动。
- 剪贴板替换全文在 contribute 侧加了与 playground 同款确认弹窗（工单未明说，按 Task 07 既有 UX 对齐）；替换成功后主动打开审阅横幅并激活该 diff（工单「与审阅横幅天然衔接」的落地解释）。

**未解决 blocker：无**。

### 链尾终验（2026-07-08，W9→F2→F3 串行完成后全量回归）

- `cd web && bun run typecheck` exit 0（registry：303 regex 规则 / 311 active，engine `2.0.0+r40d8072a`，verdict 烘焙 160 条 strong 7）；`bun run typecheck:server` exit 0。
- 仓根 `bunx vitest run tests/`：**3 文件 101/101 passed**；`bun test evals/`：**44 pass / 0 fail / 124 expect**（6 文件）。
- F3 取消/重试逻辑读代码走查：代数令牌双点检查（sleep 后 + GET 后）、POST 返回/catch/finally 三处代数守卫、快照重试闭包、503/stale 不带重试、外部 LLM 三动作与横幅衔接、resetFlow 复位、i18n 4 key 三处齐——全部与 F3 契约一致，无损。
- 隔离纪律核对：`web/data.db` md5 `6efa39a1…` 与 W3+W4/F1 基线一致且 gitignored 不入 git status；`evals/eval.config.json` gitignored、内容抽查（classifier/repair.model=mimo-v2.5-pro、repair.promptVersion=repair-v1）与 D-E/F1 记录一致未动。
- W9-A middleware / W9-B admin-seed / W9-C index redirect + AppHeader + header.contribute / W9-D consent=true / F2 DTO 判别联合 + repair-selection-v1 注册 + 三级快照校验，抽查代码与各执行记录申报一致。

**用户手动浏览器验收清单（W9/F2/F3，接总清单 25 步之后）**：

26. **W9 入口统一**：直访 `/` → 立即到 `/contribute`（无闪屏）；顶栏导航 = 检测 \| 评测报告 \| 数据集（无 playground 链接），「检测」在 /contribute 下高亮；直访 `/playground` 编辑器页照常可用；切 English 后 tab 显示「Detect」。
27. **W9 免登录五步**：清 cookie（或隐身窗）不登录直接在 `/contribute` 走完整五步（上传→盲评→报告→改文→验收→循环），全程无登录跳转；（可查库：数据归属新建的 `anon-xxxxxxxx` 用户）；清 cookie 再传一篇 → 归属另一个新匿名用户。
28. **W9 admin seed 与 export**：`.env` 设 `NUXT_ADMIN_USERNAME/PASSWORD` 重启 → 启动日志「已创建 admin」（再次重启 → 「admin 已就绪（密码未动）」）→ 用该账号登录后 `GET /api/export` 200；匿名/普通用户访问 export → 403。
29. **W9 consent 默认勾选**：进 `/contribute` 授权开关默认已勾（手动取消后提交被拦，文案不变）；「再传一篇」重置后仍默认勾选。
30. **F2 选区 AI 改写**：改文屏选中一段文字 → 选区菜单出现「AI 改写选区」（与「复制指令」并排）→ 点击进入等待（编辑不锁、可继续输入别处）→ 数秒至几十秒后该选区变一条 llm diff 并入（通知「已并入选区 AI 改写」），可巡检/拒绝/撤销；等待期「AI 改写」整篇按钮显示运行中（共用互斥）。
31. **F2 选区失效提示**：发起选区改写后在等待期**把选中的那段文字改掉** → 返回时通知「选区内容已变化，无法在当前草稿中唯一定位，AI 改写结果未并入」，草稿不被动；若只在选区**外**增删（选区文本全文唯一）→ 结果仍按新坐标正确并入。
32. **F2 长文引导**：粘贴 >12000 可见字正文进改文屏 → 「AI 改写」整篇按钮禁用、悬停提示「正文较长…请选中片段用『AI 改写选区』」；选区菜单的「AI 改写选区」仍可用（≤8000 可见字选区）。
33. **F3 等待取消**：发起 AI 改写（整篇或选区）→ 按钮旁出现「取消改写」→ 点击 → info 通知「已取消…后台任务结果将被忽略」、运行态立即解除、可马上重新发起；被取消的旧任务即使后台跑完也不再并入（观察 ≈1 分钟无 diff 出现）。
34. **F3 失败重试**：用坏配置副本（`repair.model` 指向不存在模型）+ `NUXT_EVAL_CONFIG_PATH` 重启 → 发起改写 → 失败通知带「重试」按钮（8s 停留）→ 点击用同一输入快照重发（同样失败，行为一致）；配置无 repair 节 → 503 通知**不带**重试、整篇按钮转禁用并注明原因、选区菜单入口隐藏。
35. **F3 外部 LLM 三动作**：改文屏「外部 LLM」下拉（返回报告与 AI 改写之间，永不禁用）三项——「复制优化指令」/「复制指令+正文」→ 剪贴板得到 prompt（含命中清单与批注，后者含当前草稿正文）；「用剪贴板替换全文」→ 确认弹窗 → 确认后全文变单条 llm diff + 审阅横幅打开并激活该处，撤销可整批回退；内置通道 503 时该菜单照常可用（唯一 AI 路径）。

## 2026-07-11 三维机器通道与持久化 Agent 换代
## 2026-08-14 t133 NeuroBook SSO 与生产服务器切换准备

### 已完成

- llmlint 已切换为 NeuroBook 官方 OAuth 2.0 Authorization Code + PKCE `S256`，生产唯一浏览器登录入口；删除本地 password login/register/admin seed。官方用户 ID 只写 `User.neuroBookUserId`，本地 `User.id` 与历史外键保持不变。
- 真实 provider 与 llmlint 侧 typecheck、OAuth 聚焦回归和 Nuxt `node-server` build 已通过。Windows Nitro/Prisma 生成客户端的虚拟 `file:///_entry.js` 启动崩溃已通过构建期兜底修复；`node .output/server/index.mjs` + 隔离 SQLite smoke 已通过 health `200`、SSO disabled `503`、未认证 style-review `401`。
- 生产服务器已确认 Ubuntu `24.04.3`、Node / Bun 版本、目标回环端口空闲和磁盘可用。已创建 `/srv/llmlint`、`llmlint` service user、systemd/Nginx/ACME/发布脚本模板，并留存入口配置 hash 备份。

- `llmlint.notnotype.com` 当前 DNS 为 NXDOMAIN，Let's Encrypt webroot 签发因此失败；未写入 443 stream map、未安装正式 TLS vhost、未启动 llmlint unit。计划要求 DNS/证书完成后才进入生产切换，当前未停旧测试入口、未复制或改写生产库。
- 计划原拟将 Node 构建放到上传源包后执行；当前已将 Linux release 脚本改为根目录 `bun install --frozen-lockfile` 后进入 `web/` 再 frozen install、migration、Prisma generate、build，避免只安装 `web/` 而遗漏 evals/根依赖。首次 Linux build 因生产服务器宿主内存不足 OOM，被 kernel 杀死；启用临时 swap、外部化 Nitro 模型运行时依赖、构建堆默认限制为 1536 MiB 后重跑成功。
- 产物运行时依赖已在生产服务器 Node 下解析通过（含 `@libsql/isomorphic-ws`、`@earendil-works/pi-ai`、OAuth 与模型 SDK）；使用独立临时 SQLite 启动 `/srv/llmlint/releases/t133-style-eval/web/.output/server/index.mjs` 的 Node smoke 通过 health 200 与 `auth/me` 合同。上述 smoke 不写生产库，也未启动 systemd unit。
- 前置构建告警保持真实记录：缺少 `evals/report/report.json` 时 verdict 烘焙降级；Vue 报 `[Vue] Load plugin failed: vue-router/volar/sfc-route-blocks`，但 typecheck/build exit 0。不能把这些 warning 写成生产评测报告已完成。

### 验证记录

```text
cd web && bun run typecheck:server && bun run typecheck && bun run build  -> exit 0
node .agent/tmp/t133-sso-isolated-verify-20260814/smoke.mjs                    -> health ok / me authEnabled=true,ssoEnabled=false,user=null / 503 / 401
ssh <生产服务器>: node v22.14.0; bun 1.3.14; nginx -t successful; nbook loopback ready
```

Task 13 的机器断言 DTO 现统一增加 `analysis`：规则引擎、外部检测、LLM Agent 各自携带 status/score/error/runId 或 sessionId，并由服务端计算 30%/45%/25% 综合参考分。D2 不变：未 reveal 的 revision 仍不暴露任何机器报告；owner 校验覆盖新增 Agent session 与 detector run 路由。

数据库新增 `AgentSession`、`AgentSessionEntry`、`AgentInvocation`、`MachineDetectRun`；`MachineLlmReview` 重建为结构化 score/confidence/reportJson 并关联 session/invocation。开发阶段按拍板直接清理旧 review 行，不提供 legacy 解析。旧内存 llm-fix job API 已退役，AI 改写结果仍不直接落 Revision，必须先进入前端 diff 审阅，再由用户“再次检测”定版，因此 revision/provenance/D5 主链不变。

登录关闭模式已覆盖新增全部动态 API；登录开启模式继续由 `requireCurrentUser` owner 防枚举。隔离 libSQL 数据库已完整应用三次 migration，Prisma Client 重新生成。

## TODO / Follow-ups

- [x] **→ 后续演进已移交 [Task 15 检测工作台](../15-detection-workbench/README.md)**（2026-07-09 用户 8 点反馈：五步向导重塑为版本化工作台+规则页+历史恢复+热力图+校对批注+流式；本文件的五步语义与 W1–W9 记录仍是数据模型/采集语义的权威）——**Task 15 P0-A/P0-B/P1-C/P1-D/P2-E 已全部落地**（2026-07-09，中期+终验+修复轮全绿，见其执行记录；浏览器验收 36–49 待用户）

- [x] W1–W6 依次落地（见工单表；W1 ✅、W2 ✅、W3 ✅、W4 ✅、W5 ✅、W6 ✅）
- [x] **W7 llm_fix 前端返工**：✅ 全部完成——F1（2026-07-08，整篇改写 diff 化 + 审阅横幅 + 不落库 job + repair-v2 批注节 + transitionKind 修正，见 [F1 执行记录](#f1-执行记录2026-07-08)）、F2（选区改写 + 长文引导，见 [F2 执行记录](#f2-执行记录2026-07-08)）、F3（取消/重试/外部 LLM 三动作，见 [F3 执行记录](#f3-执行记录2026-07-08)）；未解决 blocker 无
- [x] **W8 五步流程引导完形**：✅ 完成（2026-07-08，G1–G4+G6 全落，见 [W8 执行记录](#w8-执行记录2026-07-08)；浏览器验收 18–25 步待用户）
- [x] **W9 内网信任模式 + 入口统一**：✅ 完成（2026-07-08，匿名自动会话 + admin env seed + `/` 重定向与「检测」入口 + consent 默认勾选，见 [W9 执行记录](#w9-执行记录2026-07-08)；浏览器验收 26–29 步待用户）
- [x] ~~LLM 异步分类补空需先拍板模型/key~~ → 已拍板（D-E：mimo + 复用 eval.config.json），转入 **W6 工单**
- [x] ~~`llm_fix` agent 改写的 provider/预算/产品形态~~ → 已拍板（D-E：mimo；产品形态 = edit 屏「AI 改写」入口），转入 **W4 工单**

**审查轮发现（2026-07-08，全量走查执行记录 + 抽查代码后登记；均不阻塞浏览器验收）**：

- [ ] **detect 长文超时边界（需拍板）**：`DETECT_TOTAL_TIMEOUT_MS=120s`，而上传上限 60k 字 ≈ 134 块 × ≥1.5s 限流间隔 ≥ 200s——**约 3 万字以上的文本外部检测必超时**，落「暂不可用」（D5 自动降级判定，流程不断，但长文永远缺检测腿）。候选：按块数动态放宽总超时 / 长文抽样分块 / 降上传上限 / 接受现状注明。
- [x] ~~**llm_fix 长文边界**~~：`maxTokens 16000`（≈2 万余汉字）vs 上传上限 60k 字——长文 AI 改写输出会被截断、再被拒答守门判失败。已拍板（W7 决策点 4）并**随 F2 落地**：整篇按钮超 `LLM_FIX_FULL_MAX_VISIBLE_CHARS = 12000` 可见字禁用 + title 引导「AI 改写选区」（选区 ≤8000 可见字、maxTokens 按选区收敛，天然规避截断）
- [ ] **import-corpus 不产 MachineDetect**：导入语料只有 MachineScan；evals sidecar `report/detector-scores.json` 已有同文本分数（内容 hash 键）——应补「从 sidecar 搬运」（快、免代理、免打 HF），真打 HF 只作缺失兜底。
- [x] **middleware 匿名会话触发面按 path 不按 method**：该历史 TODO 已由配置式鉴权整体取代；旧 middleware 与路径名单均已删除，不再需要 method 级修补。
- [x] **配置式鉴权替代路径名单（2026-07-11）**：`NUXT_AUTH_ENABLED` 开关已落地，原匿名 middleware 删除；登录关闭时统一身份边界提供稳定本地用户，动态路径不再依赖“之前某个 POST 恰好写过 Cookie”。

## 2026-07-11 W9 鉴权模式纠正

用户在 AI 改写 job 轮询中复现 `GET /api/llm-fix-jobs/:id → 401 请先登录`。根因是 W9 的“免登录”由 `protectedWriteApiPaths` 静态名单模拟：POST `/api/llm-fix-jobs` 会建匿名 session，但动态 GET 不在名单；Cookie 丢失、localhost/127.0.0.1 切换或 dev server 重启后，handler 的 `requireCurrentUser` 必然失败。

本轮用配置式模式替代路径补丁：开发默认 `NUXT_AUTH_ENABLED=false`，生产默认 true。关闭时 `getCurrentUser` 统一返回数据库中的稳定本地开发用户；开启时只认正常 session。原匿名 middleware 整体删除，避免今后每加一个动态 API 都要同步名单。前端账号菜单和 `/contribute` 路由守卫消费同一 `/api/auth/me.authEnabled`。

回归：隔离数据库 + 3017 dev server，无 Cookie 连续请求 `auth/me` 得到同一 userId；不存在 job 从 401 变为正确的 404；login 在关闭模式返回 409。与 W9 原计划的出入：关闭登录不再按浏览器生成多个匿名身份，而是整个开发部署共享一个普通用户；这是保证异步任务 owner 稳定所需的明确语义，admin 权限仍不放开。
- [ ] llm_fix job 表持久化（现内存 + TTL 1h，重启丢任务=前端 404；单机量小可接受，上生产前再议）
- [ ] 测试脚本已知 race：w2-api-loop 的「未报字段为空」断言可能与 W6 异步分类赛跑（修法已记录：断言放宽为「空 或 source=llm」，或用坏配置副本禁用分类通道）
- [ ] evals `detector/detect.ts` summary 的 role 隐式过滤对齐 gates 谓词（对照仪表不进 lift，低优先；W5 记录在案）
- [ ] strong∩auto 空集观察项：一键清理产品价值等新规则测出 strong+auto 后自动显现（判据集中于 `useLlmlint.autoFix` 一处）；若要放宽口径是一行改动（用户拍板）
- [ ] **llm_fix 的 model/promptVersion 持久化（需拍板，F1 衍生）**：W7 产出不落库后 provenance 无服务端写入方，llm_fix 修订的模型/prompt 版本只在服务端 debug 日志——若要持久化，可让 job result 带回 `{model, promptVersion}` 由前端并进 provenanceJson 顶层（I8 资产追溯 vs 现状够用，用户拍板）。
- [ ] **resolved/stale 编辑面批注是否喂改写 prompt（需拍板，F1 衍生）**：现 `getReviewComments` 全量随行（contribute 只滤空档）——用户已标记解决的意见继续喂模型语义存疑；候选：过滤 resolved / 全量保留（历史反馈仍有指导价值）。

**用户已明确后置**：

- [ ] 众评 per-user 揭示记录 + PairJudgment 建表（随小游戏/众评管线）
- [ ] LlmJudgment 通道口径（用户拍板）
- [ ] 部署宿主/备份/注册限流（用户拍板）
