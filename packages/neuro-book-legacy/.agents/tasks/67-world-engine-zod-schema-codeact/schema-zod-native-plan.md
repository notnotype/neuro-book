# 改造计划：Schema 地基 Zod-native 重构（Phase 2.5）

> 隶属 [Task 67](README.md)，落地 Decision #23。
> 去掉 `convertZodSchemaToOld` 预转换层与 YAML schema 路径，让 Zod 成为运行时唯一真相。
> **这是 [向量改造计划](vector-refactor-plan.md) 的前置阶段。**
>
> 起草：2026/06/26。状态：待实施。

## 为什么做

引擎现在不直接吃 Zod，而是 `convertZodSchemaToOld`（`schema-loader.ts:98`）把 Zod 压成旧格式 `WorldSchema`（`kind/type/itemType/fields`，YAML 时代遗产）。这层**有损**：

- EmbeddingText（`z.object({text,vector,model})`）作为 record value / array 元素时，只被记成 `itemType:"object"`，结构与 embedding 语义全丢（`schema-loader.ts:191/241`）。
- 任何 Zod 丰富特性过这层都被压平 → EmbeddingText 只是第一个牺牲品。
- 现状是"旧格式 + zod 抽取元数据（extractRefs/extractUniqueArrays/collectZodDefaults）"混存，概念分裂。

目标：**Zod 单一真相**，访问器直接走 Zod，删掉预转换 + YAML。

## 设计：以"访问器"为接缝

reduce / patch 校验 / dangling-ref 检测都只通过几个访问器读 schema，不直接碰 schema 内部结构。重构=**换访问器内部实现（旧格式 → 走 Zod），尽量保持签名与返回形状不变**，下游 reduce/patch 逻辑基本不动。

核心访问器（保持对外契约）：

| 访问器 | 职责 | 重构后 |
|---|---|---|
| `findAttrSchema(schema, type, path)` | 按路径取属性定义 | 走 Zod shape，按 JSON Pointer 下钻；返回结构含 `kind`，新增可表达 `embedding` |
| `collectDefaultAttrs(schema, type)` | 收集 init slice 默认值 | 走 Zod `collectZodDefaults` |
| `flattenAttrs` → `WorldSchemaProjection` | 给前端/Agent 的投影 | 走 Zod 生成，**输出形状不变** |
| `normalizeAttrKind` | 取 kind | 由 Zod 类型映射 |
| 遍历 `subjectSchema.attrs`（dangling-ref） | 扫 ref 字段 | 走 Zod + `extractRefs` |

**运行时 schema 表示**：用一个从 Zod 派生的 `SchemaMeta`（每个 subject type：Zod 对象 + 预抽取的 refs/uniqueArrays/embeddingFields/defaults 缓存），或直接持有 Zod registry + 抽取函数。倾向前者（抽取一次、缓存，避免每次 reduce 重新走 Zod）。

## 硬约束

- **`WorldSchemaProjection` 输出形状保持不变**——前端 Workbench 消费它，本任务不涉及前端，不能破坏。重构后投影必须逐字段对齐旧输出（用现有 `world-engine.facade.test.ts` / workbench preview 测试兜）。
- **硬切**：删除 YAML schema 支持（`schema.yaml` / `normalizeSchema` / `normalizeNewSchemaToOld` / `normalizeSchemaNode` 等），无历史数据迁移。

## 实施步骤

### Step 1 — 定义 SchemaMeta + 抽取
- `types.ts`：定义 `SchemaMeta`（per-type：zod schema + refs + uniqueArrays + embeddingFields + defaults）。
- 复用/补全抽取函数：`extractRefs`、`extractUniqueArrays`、`collectZodDefaults` 已有；新增 `extractEmbeddingFields(zodSchema)`（识别 EmbeddingText 容器：record/array of EmbeddingText，记录路径 + 容器类型 record|array）。
- EmbeddingText 识别：按 `z.object` 引用同一性或 shape 特征（含 text/vector/model）判定；**这是一等识别，不再需要 `_def` 标记 hack**。

### Step 2 — schema-loader 瘦身
- `load()`：只加载 `world-engine/schema/index.ts`，构建 `SchemaMeta`。删除 YAML 分支。
- 删除 `convertZodSchemaToOld` / `convertZodFieldToAttrSchema` / `normalizeSchema*` / `normalizeSchemaNode` 等旧格式转换与 YAML 规范化代码。
- ref 校验（`validateZodRefs`）保留，基于 SchemaMeta。

### Step 3 — 访问器走 Zod
- `findAttrSchema`：基于 Zod 下钻 JSON Pointer；返回结构保留 `kind` 等，并能标识 `embedding`（供向量计划用）。
- `collectDefaultAttrs` / `normalizeAttrKind` / `flattenAttrs`：改走 Zod/SchemaMeta，**投影输出对齐旧形状**。

### Step 4 — service / patch 适配
- `world-engine.service.ts`：`reduceWithIssues`（:385）、`collectDanglingRefIssues`（:410）改用新访问器/SchemaMeta；reduce 主体逻辑不变。
- `patch-operations.ts`：`uniqueArrays` 等元数据来源切到 SchemaMeta；为向量计划预留 embedding 字段识别入口。

### Step 5 — 清理类型
- `types.ts`：移除仅服务于旧格式的类型（`WorldAttrSchema` 视情况保留为访问器返回类型或重定义）；保留对外投影类型不变。

### Step 6 — 测试
- 重写/更新：`schema-loader.test.ts`、`world-engine.facade.test.ts`、`codeact.test.ts` 中依赖旧格式/YAML 的用例。
- 重点回归：reduce 正确性、dangling-ref 检测、默认值写入、**投影输出与旧版逐字段一致**。

## 涉及文件

| 文件 | 改动 |
|---|---|
| `server/world-engine/types.ts` | SchemaMeta、extractEmbeddingFields、清理旧类型 |
| `server/world-engine/schema-loader.ts` | 瘦身：删 YAML + convertZodSchemaToOld，访问器走 Zod |
| `server/world-engine/world-engine.service.ts` | reduce / dangling-ref / 投影 适配 SchemaMeta |
| `server/world-engine/patch-operations.ts` | 元数据来源切 SchemaMeta |
| `server/world-engine/*.test.ts` | 旧格式/YAML 用例重写 |

## 风险

- reduce + dangling-ref 是事件溯源正确性核心，重构有回归风险 → 以现有测试为护栏，先补齐缺失的 reduce/投影测试再动。
- 投影形状漂移会静默破坏前端 → Step 6 逐字段对齐校验。

## 验证标准

- 删除 YAML / convertZodSchemaToOld 后，现有 world-engine 测试全绿。
- 投影输出与重构前逐字段一致。
- `findAttrSchema` 能识别 embedding 字段（为向量计划铺路）。

## 完成后

- 解锁 [向量改造计划](vector-refactor-plan.md)：其 Step 3 不再需要 `_def` 标记，embedding 字段由本阶段的 `extractEmbeddingFields` / `findAttrSchema` 一等提供。
