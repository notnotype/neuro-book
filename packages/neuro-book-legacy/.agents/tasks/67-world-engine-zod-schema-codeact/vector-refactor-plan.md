# 改造计划：向量列式存储 + CodeAct 向量搜索

> 隶属 [Task 67](README.md)。本计划落地 Decision #8 / #16 / #17 / #18 / #19 / #20 / #21 / #22 的设计：
> 向量内联在 WorldMutation 表（列式抽取），搜索不 reduce，硬切不兼容。
>
> **前置依赖**：[Schema 地基 Zod-native 重构（Phase 2.5）](schema-zod-native-plan.md) 先完成——
> embedding 字段识别由它的 `extractEmbeddingFields` / `findAttrSchema` 一等提供，本计划不再用 `_def` 标记 hack。
>
> 起草：2026/06/26。状态：待实施（阻塞于 Phase 2.5）。

## 背景与决定（讨论结论）

原计划（README Decision #8 旧版）要建独立 sqlite-vec 表（WorldVectorIndex / WorldVectorChunk）。
2026/06/26 讨论后**推翻**，改为：

1. **向量作为 WorldMutation 的列**，与事件溯源同源，不另建表。
2. 只复用 subject-rag 的 **embedding 生成**，不复用其 vec 表 / 分块 / 去重。
3. `value` 保持 JSON，不结构化（Decision #17）。
4. embedding 字段**一条 = 一行 mutation**，禁止整块 replace（Decision #16）。
5. `eventsRich` → `events`（Decision #18）。
6. 多 embedding 模型并存，searchText **按 model 过滤同维度**，不锁单一模型、不删旧向量（Decision #19）。
7. **未向量化兜底**：searchText 对命中范围内未向量化文本**即时 embed 并持久化**（Decision #20）。
8. **events append-only 不可变**；只有 memory（record）有覆盖/删除（Decision #21）。
9. 写入走**独立 `write_world_slice` 工具**，CodeAct 只读；`vectorize` 归写/服务侧（Decision #22）。


## 数据模型变更

### WorldMutation 新增三列（`prisma/project.schema.prisma`）

```prisma
model WorldMutation {
  // ... 现有列 id/sliceId/subjectId/instant/seq/attr/op/value/summary
  text   String?   // EmbeddingText 文本（仅 embedding mutation）
  vector Bytes?    // Float32 紧凑字节（4B × dim）
  model  String?   // 向量化模型，搜索按此过滤同维度
}
```

- 普通 mutation：三列 NULL，照常用 `value`。
- embedding mutation：三列填值，`value` 留 NULL；reduce 从三列重建 `{ text, model }`（vector 不进 state）。
- 索引：考虑 `@@index([model])` 辅助按模型过滤（数据量小可先不加）。
- **硬切**：旧数据直接丢弃，无迁移。

### Float32 BLOB 编解码

- 写：`new Float32Array(vector)` → `Buffer.from(f32.buffer)`。
- 读：`new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)`。
- 维度由 model 决定，不写死 1536。

## 实施步骤

### Step 1 — schema 改名（Decision #18）
- `world-engine/schema/index.ts`：`eventsRich` → `events`，注释同步。
- 检索全仓引用 `eventsRich` 一并改（目前仅 schema + 本任务文档）。

### Step 2 — 数据库列（数据模型变更）
- 改 `prisma/project.schema.prisma`，`bun prisma generate`（提权在沙盒外执行）。
- `WorldMutationRow` 类型（`server/world-engine/types.ts`）加 `text / vector / model`。
- `repository.toMutation` / `appendMutations` / `encodeMutationValue` 适配三列读写。

### Step 3 — patch 层粒度约束（Decision #16）
- `server/world-engine/patch-operations.ts`：对 embedding 字段的整块 `replace`（路径正好落在 record/array 容器本身，如 `/memory`、`/events`）报错；
  仅允许按 key/元素（`/memory/<key>`、`append /events`）。
- 判定 embedding 字段：**直接用 Phase 2.5 提供的** `findAttrSchema`（识别 `embedding` kind）/ `extractEmbeddingFields`（来自 [schema-zod-native-plan](schema-zod-native-plan.md)）。本计划不再新增 `_def` 标记。
- 写 embedding mutation 时：把 `{ text, vector?, model? }` 拆进三列，`value` 置 NULL。

### Step 4 — reduce 适配
- `server/world-engine/world-engine.service.ts` `reduceWithIssues`（:385）/ `decodeRowMutation`：
  embedding mutation 从三列重建 `{ text, model }` 写入 state（**不含 vector**）。
- 确认 `get()` 返回的 state 不带 vector（满足"不撑爆结果"，且 Agent 仍可见 text/model）。

### Step 5 — searchText（`server/world-engine/codeact-api.ts:154`，只读）
替换占位实现：
```
embed(query, model) → 平表查 embedding 行（看该 attr 全部行定存活集）
→ 存活集窗口查：
   record（memory）：PARTITION BY subjectId, attr ORDER BY instant DESC, seq DESC 取 rn=1 且 op<>'remove'
   array（events，append-only）：全保留（Decision #21）
→ 未向量化兜底（Decision #20）：候选里 vector 为空的，即时 embed(text) 并 UPDATE 回 vector 列
→ 过滤同 model（Decision #19）→ 余弦排序 top-k（k 默认值、threshold）
→ 仅命中行取 text → 返回 [{ subjectId, attr, text, score }]
```
- 字段是 record 还是 array：查 Phase 2.5 的 schema 容器类型。
- **存活集坑**：memory 的 `remove` 行不带 vector，不能先 `WHERE vector IS NOT NULL` 再取最新——要看该 attr **全部行**定最新、再判 remove，否则删除被忽略。
- 可选参数 `{ k, threshold, types, attrs, at }`；`at` → `WHERE instant <= at` 支持时间旅行。
- 即时 embed 是网络调用 → 不计入 CodeAct 5s 沙箱超时（world API I/O 豁免）。
- 新增 repository 查询方法（存活集窗口查 SQL）。

### Step 6 — vectorize（写/服务侧，Decision #22）
**不放只读 CodeAct 沙箱**——作为写侧能力（随 `write_world_slice` 工具或独立写入口暴露）：
```
reduce 出 attr 当前值 → 对缺 vector / contentHash 变化的条目 embed(text)
→ 定位"最后写入该文本的那行 mutation"（按 subjectId+attr 取最新，校验 text 命中）
→ repository.updateMutationValue：UPDATE vector(+model) 列
→ contentHash 未变跳过
```
- 新增 `repository.updateMutationValue(mutationId, { vector, model })`。
- contentHash：对 text 做哈希，存哪里待定（可加第四列或比对现有 text+vector 存在性）。**初版**可简化为"vector 为空才 embed"，contentHash 留 follow-up。
- 注：有了 Step 5 的即时兜底，显式 vectorize 主要用于"提前批量预热"，非必须。

### Step 7 — embedding 生成复用
- 从 `server/agent/tools/subject-rag-index.ts` 抽出/复用文本→向量函数与 `loadEffectiveConfigForAgentRuntime` 配置加载；不引入其 vec 表逻辑。

### Step 8 — 写入工具 write_world_slice（Decision #22）
- `server/agent/tools/world-engine-tools.ts`：补回 `write_world_slice(projectPath, slice)` 结构化写工具，直调 `facade.writeSlice`；CodeAct（`execute_world_query`）保持只读。
- 写工具承载 Step 3 的粒度校验（禁 embedding 整块 replace）与三列拆分入口。
- `vectorize` 作为写侧能力一并暴露（或独立写入口）。
- 注：这是引擎已有 `facade.writeSlice` 的工具层补全；旧写工具在上轮重写中被删，至今 Agent 无写世界的工具。

### Step 9 — 测试
- `server/world-engine/` 下补测：
  - patch 拒绝 embedding 整块 replace；
  - 三列读写 + reduce 重建（state 不含 vector）；
  - searchText 存活集：memory 覆盖后旧行不返回、remove 后不返回、events 全返回；
  - searchText 未向量化兜底：写了未 vectorize 的条目也能被搜到；
  - 同 model 过滤；time-travel `at`。
- 余弦/编解码属复杂逻辑，值得测；简单 getter 不测。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `world-engine/schema/index.ts` | eventsRich→events |
| `prisma/project.schema.prisma` | WorldMutation +text/vector/model |
| `server/world-engine/types.ts` | WorldMutationRow 加三列 |
| `server/world-engine/world-engine.repository.ts` | 三列读写、updateMutationValue、存活集查询 |
| `server/world-engine/world-engine.service.ts` | reduce 重建 embedding 条目（不含 vector） |
| `server/world-engine/patch-operations.ts` | embedding 整块 replace 拦截、拆三列写入 |
| `server/world-engine/codeact-api.ts` | searchText（含未向量化即时兜底） |
| `server/agent/tools/world-engine-tools.ts` | 补回 write_world_slice、暴露 vectorize（Decision #22） |
| `server/world-engine/*.test.ts` | 新增/更新测试 |
| `server/agent/tools/subject-rag-index.ts` | 复用 embedding 生成（只读/抽取） |

> `extractEmbeddingFields` / embedding 字段识别归 [Phase 2.5](schema-zod-native-plan.md)，不在本表。

## 不在本计划内（按需 follow-up）

- 派生型内存向量缓存（条目逼近上万再加）。
- snapshot 降 reduce 成本（单 subject 历史过长再加）。
- ref 边表加速 findRefs（引用涨到数千再加）。
- contentHash 持久化、自动/批量向量化。
- Agent profile 提示词更新（TODO 第 2 点，单独推进）。

## 验证标准

- 创建 character、按 key 写 memory、append events、vectorize 后 searchText 命中并按相似度排序。
- memory 覆盖/删除后，searchText 不返回旧版本；events append-only 全可搜。
- 整块 replace embedding 字段被拒。
- 测试通过。
