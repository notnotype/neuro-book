# World Engine — SQLite Schema 与 API 设计草案

> 本文件是 [README.md](README.md) 的子文档，承载 Project SQLite 表结构与世界引擎 API 契约。
> 状态：**第一版已落地，本文记录当前契约与后续留口**。配套模型见 [schema-design.md](schema-design.md)。
> 项目惯例对齐：Prisma + libSQL adapter、Project SQLite（`.nbook/project.sqlite`）、按 projectPath 缓存 client、facade → service → repository 分层、写操作走 `$transaction`、后端 class 模式。

## 1. 存储分层（定论）

- **schema（subject 类型定义）/ calendar（项目日历 parse/format）= 项目配置文件**，**不进 SQLite**。当前入口是 Project Workspace 里的 `world-engine/schema/index.ts`（TypeScript + Zod）与 `world-engine/calendar.ts`，二者都是单文件配置入口；`schema.yaml` / `calendar.yaml` 是历史方案。
- **subject type 名 = 稳定 key**：schema subject type 名不能为空，也不能包含空白或括号；运行时 `createSubject(type)`、`queryState(type)`、`listWorldSubjects(type)` 也复用同一规则。schema 中 `ref(type)` 必须指向已声明的 subject type；subject 创建和按 type 查询也依赖同一组稳定 type 名。
- **schema attr 名 / attr path = 稳定路径段**：schema attr 名不能为空，不能包含首尾空白或点号；点号只作为运行时 attr path 的段分隔符。写入 / 查询 attr path 每段必须非空且不能包含首尾空白。
- **subject 引用格式 = `subject://<id>`（纯 id）**：对齐项目 `{kind}://{targetId}` 惯例（同构于 `thread://22`），单一 scheme 覆盖所有 subject 类型（character/item/location/faction…，type 从 `WorldSubject` 表查，不编码进 URI）。id 全局唯一，不能为空或带首尾空白；写入 ref 时 `subject://<id>` 内部 id 也遵守同一规则。反查 `value = '"subject://<id>"'` 直接命中。未来可加进 `shared/reference-core.ts` 的 kinds，让正文 `@subject://erina` 自然提及。
- **Project SQLite 只存运行态**：subject 实例、切面（slice）、逐条 patch。**与现有 plot 表共用同一个 `project.sqlite`**（一套 Prisma schema 维护，model 用 `World*` 前缀隔离）。
- **patch 一行一条（关系化）**：reduce 走 `(subjectId, instant)` 索引直接取相关 subject 的行，反查 / 曲线都是带索引 SQL。
- **instant 用 SQLite INTEGER（64 位）**：原生整数索引，排序 / 范围查询飞快。上限约 2920 亿年（秒为刻）。API 层仍是 `bigint`，但第一版 service / HTTP / Agent 公开边界会拒绝超出 SQLite 64 位整数范围的 instant；超 64 位如未来需要，再升级存储编码并保持 API 心智不变。
- **reduce 在应用层算**：DB 只负责「高效取出某 subject ≤t 的全部 patch，按 (instant, patch 序) 排好」；按 op 叠加状态由应用层 reduce 函数完成（SQL 无法表达 JSON Pointer 路径 / collection 增删）。

### 第一版范围（最小化）

- **第一版已做**：subject 实例、切面写入 / 整块编辑 / 删除、`getWorldState`、`queryState`、`listSlices`、schema/calendar 加载、E/A issues、HTTP API 与 Agent 工具。
- **第一版不做**（推到后续）：`WorldSnapshot` 缓存、`findReferers` / `getAttrHistory` 等细分查询、可恢复撤销 API、旧 `simulation/` workflow 接入。当前只提供不可恢复的 `deleteSlice` 物理删除。

## 2. SQLite 表结构（Prisma schema 草案，第一版最小）

```prisma
// —— subject 实例：身份注册表（不含状态，状态全靠切面 reduce）——
model WorldSubject {
  id        String   @id            // subject 稳定 id，如 "erina"（ref 指向它）
  type      String                  // schema 里的类型名：character / quest / faction…
  name      String   @default("")   // 人读名（冗余便于列表展示，非状态真相）
  createdAt DateTime @default(now())
  patches   WorldPatch[]
  @@index([type])
}

// —— 切面：一个时间点 + 一组变更的容器 ——
model WorldSlice {
  id        String   @id @default(cuid())
  instant   BigInt   @unique        // 唯一时间真相源（INTEGER 64 位），可负；同 instant 只能有一个切面
  title     String   @default("")
  summary   String   @default("")
  kind      String   @default("event")  // event / init / backstory… 便于区分 timeline 标签
  createdAt DateTime @default(now())
  patches   WorldPatch[]
  @@index([instant])                // reduce 截断 + timeline 排序主索引
}

// —— 逐条变更：reduce 的原子单位 ——
model WorldPatch {
  id        String   @id @default(cuid())
  sliceId   String
  subjectId String
  instant   BigInt                  // 冗余自所属 slice，便于 (subjectId, instant) 复合索引直接取
  seq       Int      @default(0)    // 同切面内 patch 的应用顺序
  path      String                  // JSON Pointer，如 "/hp" / "/equipment/weapon" / "/memory/师门"
  op        String                  // replace / increment / remove / append
  value     String?                 // JSON 编码载荷；remove 可省略
  summary   String?
  text      String?                 // EmbeddingText 检索文本
  vector    Bytes?                  // 系统维护向量
  model     String?                 // 系统维护 embedding model id
  slice     WorldSlice    @relation(fields: [sliceId], references: [id], onDelete: Cascade)
  subject   WorldSubject  @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  @@index([subjectId, instant, seq])     // ★ reduce 单 subject 主索引
  @@index([subjectId, path, instant])     // 属性历史 / HP 曲线（后续查询用）
  @@index([path])                         // 反查引用（后续查询用）
}
```

> `WorldSnapshot` 表第一版不建。reduce 直接从头叠（`fromInstant = -∞`），结果一致；subject/切面规模变大后再引入缓存。

### 切面 kind 集合

`WorldSlice.kind` 是切面的分类标签，**主要给 UI / timeline 列表 / 过滤 / 日志用，不影响 reduce 语义**（reduce 只看 patches，不看 kind）。

| kind | 用途 |
| --- | --- |
| `event` | 默认。世界里实际发生的事件（战斗、对话、出生、移动…） |
| `init` | subject 创建时写 schema default 的初始化切面；没有 default 时只注册 subject，不创建空切面。world subject 的 init 切面可同时锚定纪元（`instant=0`）；生成或追加的 init patches 同样遵守单切面 100 条上限，且自动追加只允许落到已有 `kind=init` 切面 |
| `backstory` | 往过去补设定或补历史时的可选标签 |

**校验严格度**：允许扩展。未知 kind 不报错；省略时默认 `event`。但显式传入的 kind 必须是稳定标签，不能为空，也不能包含首尾空白，避免空字符串绕过默认值或生成不可稳定过滤的 timeline 标签。模板不强制约束枚举集合，后续可加 `tick`、`battle`、`dream` 等特殊 kind。这与「patch 可打未声明属性」的宽松校验风格一致。

### 关键设计说明

- **`instant` 在 patch 冗余存一份**：避免 reduce 时 join slice。复合索引 `(subjectId, instant, seq)` 让「取 erina 在 ≤t 的全部变更并排好序」是一次纯索引扫描。
- **同 instant 唯一切面**：`WorldSlice.instant` 唯一，禁止同一时间点出现多个切面。修改已有时间点走 `editSlice`，不通过 `writeSlice` 自动合并。首写 subject 可在 patch 上声明 `type/name` 自动注册 subject，并把 schema default 作为本切面的前置 patch 写入。`patch.seq` 解决「同一切面内多条变更的应用先后」（如先 replace hp 再 append events）。reduce 排序键 = `(instant, patch.seq)`。
- **`value` 用 JSON 字符串**：op 的载荷类型多样（数字 / 字符串 / ref / 对象），统一 JSON 编码，应用层按 path 的 schema kind 解析；patch 不存旧值字段。schema default 的纯形状 / 类型错误在 schema 加载期暴露；patch value 必须是严格 JSON 值，非有限数、`Date` 等非普通对象、对象 / 数组内部的 `undefined` 都会被拒绝，不会通过 JSON 序列化静默改写；`int` default / patch 必须是 JS safe integer，避免 JSON number 超出安全整数范围后丢精度；`increment` 的 reduce 结果必须仍是有限数，`int increment` 的 reduce 结果还必须保持 safe integer，溢出会作为 E issue 返回；`list` / `collection` 的 `replace` 表示整组替换，value 必须是 array，数组项按 `itemType` / `type` 校验；默认 EmbeddingText 公共写入只接受 `{text:"非空文本"}`，`vector/model` 由系统维护。ref default 的目标存在性依赖 Project SQLite subject 身份，仍在创建 subject 或首写初始化时校验。
- **后续查询索引已预留**：`(subjectId, attr, instant)` 与 `(attr)` 索引为 HP 曲线、反查引用预留，第一版不暴露对应 API 但表结构已支持。

## 3. 世界引擎 API 契约（第一版最小）

分层对齐 plot：`WorldEngineFacade`（按 projectPath 建 client、事务边界）→ services（slice 写入、reduce、schema 校验）→ repositories（Prisma 访问）。

HTTP API 边界使用项目日历字符串，不暴露 raw instant；公开时间字段 `time` / `at` / `from` / `to` 传 `instant:<number>`、带首尾空白，或解析后超出 SQLite 64 位整数范围都会返回 400，底层 facade/calendar 的 raw instant 解析与 trim 只保留给测试和调试。catch-all path segment 的 URL 编码必须合法，坏的 percent encoding 会返回稳定 400。`schema/index.ts` 和 `calendar.ts` 是单文件 TypeScript 配置入口：入口内容变化可热加载，本地相对文件、绝对路径和 URL/protocol import/export 会被拒绝；允许包级 import 与 `node:` 内置模块。query 参数不做静默裁剪，空字符串视为未传，带首尾空白的 `type` / `limit` / `withPatches` / `at` / `from` / `to` 会返回 400；重复 query 形成数组时返回 `${key} 只能传一个值`。

```typescript
/** 唯一时间真相源 */
type Instant = bigint;

/** 一条 patch */
interface PatchInput {
    /** 只在读取既有切面时出现；写入新切面时不要传 */
    patchId?: string;
    subjectId: string;
    /** 首次写入尚未登记的 subject 时必须声明 type，可选 name */
    type?: string;
    name?: string;
    path: string;                  // JSON Pointer，如 "/hp" / "/equipment/weapon" / "/memory/师门"
    op: "replace" | "increment" | "remove" | "append";
    value?: unknown;               // replace/increment/append 需要；remove 可省略，collection remove 可带 value
    summary?: string;
}

/** 写一个切面的输入 */
interface SliceInput {
    instant: Instant;
    title?: string;
    summary?: string;
    kind?: string;                 // 默认 "event"；显式传入时不能为空或带首尾空白
    patches: PatchInput[];         // 1..100；超出时调用方应拆分切面
}

/** 某 subject 在某时刻 reduce 出的状态（ref 不展开，惰性） */
interface SubjectState {
    subjectId: string;
    type: string;
    attrs: Record<string, unknown>;  // hp:50, equipment:{weapon:"ref:..."}, memory:{...}, events:[...]
}

/** 全量世界状态 = 截断点 + 所有 subject 的状态 */
interface WorldState {
    instant: Instant;              // reduce 截断点（默认最新）
    subjects: SubjectState[];
    issues: WorldIssue[];          // reduce 时现算的持久问题（E）
}

// issue 语义、完整 code 表和作者可见文案以 reference/world-engine/issues.md 为准。
interface WorldIssue {
    code:
        | "broken-relative"
        | "dangling-ref"
        | "invalid-path"
        | "cross-ref"
        | "embedding-whole-replace"
        | "base-shifted"
        | "masked";
    label: "E1" | "E2" | "E3" | "E4" | "E5" | "A1" | "A2";
    severity: "error" | "advisory";
    sliceId?: string;              // E 表示错误显形 / ref 元素来源切面；A 表示触发提醒的下游切面
    patchId?: string;              // 非空时可定位到具体 patch 行
    subjectId: string;
    attr: string;                  // E 表示错误路径；A 表示下游实际受影响路径（支持父子路径相关）
    path?: string;                 // JSON Pointer 路径；patch/path 问题非空
    op?: "replace" | "increment" | "remove" | "append";
    title: string;                 // 作者可见短标题，由后端 catalog 生成
    message: string;               // 本次实例细节
    explanation: {
        whatHappened: string;
        whyItMatters: string;
        suggestedAction: string;
    };
}

interface SliceWriteResult {
    sliceId: string;
    issues: WorldIssue[];          // 写 / 编辑返回 E + A
}

// A issue 收集规则：对本次 replace/remove 的每个 subject + path，检查下游同一路径或父子路径相关 patch。
// 父路径整体修改会按不同下游子路径分别返回第一条相关 A issue；若遇到下游父路径整体覆盖当前路径，则返回 masked 后停止扫描该路径。
// editSlice 原样保存已有 patch 不返回 A issue；移动 instant 时会同时观察旧位置和新位置，并排除当前 slice 自身。
// editSlice 删除旧绝对 patch 时，也会用旧 patch 在旧位置观察下游相对 op，避免无 E issue 但状态语义已变化。
// editSlice 同 instant 部分修改时只对真正删除 / 修改 / 新增的 patch 收集 A issue；未变化 patch 不重复提醒。
// editSlice 同 instant 编辑时，如果共同保留的同 subject、同一路径或父子路径相关 patch 相对顺序反转，也会纳入 A issue 候选；新增 / 删除无关 patch 不会遮住该提醒。

interface DeleteSliceResult {
    issues: WorldIssue[];          // 删除后返回 E
}

interface QueryStateResult {
    subjects: SubjectState[];
    issues: WorldIssue[];          // reduce 时现算的 E；传 attrs 时只返回相关属性问题
}

class WorldEngineFacade {
    // —— subject 实例 ——
    /** 创建 subject；id 不能为空或带首尾空白，重复 id 返回 409；如果 schema 有非空 default，则生成或追加「初始化切面」写入 default 初值，且生成 / 追加后的单切面 patches 不能超过 100；没有 default 时不创建空切面 */
    createSubject(projectPath: string, input: { id: string; type: string; name?: string; at: Instant }): Promise<{ subjectId: string; issues: WorldIssue[] }>;

    // —— 切面写入 ——
    /** 写一个新切面（校验 patch 合法性，写 slice + patch 行）。
     *  instant 决定落点，往任意时间点插切面与此同路径；如果目标 instant 已存在，返回冲突错误，修改已有切面请用 editSlice。*/
    writeSlice(projectPath: string, input: SliceInput): Promise<SliceWriteResult>;

    /** 整块替换已有切面。sliceId 必须原样传回，不能为空或带首尾空白；Agent 精确编辑应优先走 world.slice.editPatches；写入后返回 E/A issues。*/
    editSlice(projectPath: string, sliceId: string, input: SliceInput): Promise<SliceWriteResult>;

    /** 物理删除切面；sliceId 必须原样传回，不能为空或带首尾空白；不可恢复，返回删除后受影响 subject 的 E issues。*/
    deleteSlice(projectPath: string, sliceId: string): Promise<DeleteSliceResult>;

    // —— 状态查询（reduce）——
    /** 全量 reduce：instant（默认最新）的全量世界状态。给 UI / 调试用，agent 不直接用（会爆 token）。*/
    getWorldState(projectPath: string, at?: Instant): Promise<WorldState>;

    /** 细粒度查询（agent 用）：按 subject / type / 属性投影 / 时刻过滤，避免一次拉全量。
     *  - subjectIds: 只 reduce 这些 subject；省略则按 type 过滤；如果传入，必须至少 1 项。
     *  - 必须提供 subjectIds 或 type 至少其一；全量世界状态统一走 getWorldState。
     *  - subjectIds: 必须唯一；重复 id 返回 400，避免静默去重导致调用方误判返回数量。
     *  - type: 只 reduce 该类型的 subject；schema 已声明 subject types 时，未知 type 返回 400，避免 typo 静默得到空结果。
     *  - attrs: 属性投影白名单（如 ["hp","location"]）；省略返回全部属性；如果传入，必须至少 1 项且唯一，issues 也会跟随 attrs 收窄。
     *  - at: reduce 截断点，默认最新。
     *  - listLimit: list/collection 属性最多返回多少条（如 events 只取最近 N 条），防止超长。*/
    queryState(projectPath: string, query: {
        subjectIds?: string[];
        type?: string;
        attrs?: string[];
        at?: Instant;
        listLimit?: number;
    }): Promise<QueryStateResult>;

    // —— timeline ——
    /** 列切面（按 instant）。range 省略 + limit 取最近 N 个；支持时间段过滤与 subject timeline 过滤。*/
    listSlices(projectPath: string, query?: {
        from?: Instant;
        to?: Instant;
        limit?: number;          // safe integer 正整数；最近 N 个（按 instant desc 取，再正序返回）
        withPatches?: boolean;   // 是否带每个切面的 patch 明细，默认 false 只给元数据
        subjectIds?: string[];   // 只返回 patch 命中这些 subject 的切面；如果传入，必须非空且唯一
        subjectMode?: "any" | "all"; // any=任一 subject 命中；all=每个 subject 都在该切面中命中
    }): Promise<Array<{ id: string; instant: Instant; title: string; summary: string; kind: string; patches?: PatchInput[]; issues?: WorldIssue[] }>>;

    /** 读取单个切面及 patch，用于 issue 定位 / Inspector 精确加载；sliceId 必须原样传回，不能为空或带首尾空白。HTTP 序列化会把 instant / previousInstant 格式化为 time / previousTime。 */
    getSlice(projectPath: string, sliceId: string): Promise<{ id: string; instant: Instant; previousInstant?: Instant; title: string; summary: string; kind: string; patches: PatchInput[]; issues?: WorldIssue[] }>;

    /** 列出 subject 身份；传 type 时同样遵守 schema subject type 校验。 */
    listWorldSubjects(projectPath: string, query?: { type?: string }): Promise<WorldSubjectListItem[]>;
}
```

> 后续按需补充：`getAttrHistory`（HP 曲线）、`findReferers`（反查引用）。可恢复撤销不在第一版计划内；如未来重启，需要另行设计，不复用当前 `deleteSlice` 语义。

## 4. reduce 算法（应用层，伪代码）

```
getWorldState(at = 最新):
  subjects = 取所有 WorldSubject
  for s in subjects:
    rows = 取 WorldPatch
           WHERE subjectId=s.id AND instant<=at
           ORDER BY instant, seq
    state = {}
    for patch in rows:
      state = applyPatch(state, patch.path, patch.op, decode(patch.value))   # replace/increment/remove/append
    收集 { subjectId: s.id, type: s.type, attrs: state }
  return { instant: at, subjects, issues }
```

- `applyPatch` 按 path 对应 attr 的 kind（从项目 schema 配置加载）决定叠加语义；未声明属性默认 scalar。
- 第一版无 snapshot，从头叠；规模变大后再引入缓存，结果不变。

## 5. 遗留待定

- subject 身份元数据（type / name 之外是否需要更多）是否也用切面承载，还是固定在 WorldSubject 表。
- 模糊时间（fuzzy / unknown）如何落到 instant INTEGER（可能需要额外的「时间不确定性」列）。
- 后续优化：snapshot 缓存策略、细分查询（单 subject / 属性历史 / 反查引用）。可恢复撤销若未来需要，单独立项设计。
