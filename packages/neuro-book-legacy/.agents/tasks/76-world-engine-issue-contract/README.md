# World Engine Issue Contract

> Active task。治理 World Engine issue 的契约、文案真相源和前后端职责边界，避免后端只给 code/message、前端再按 code 二次解释导致语义分裂。

## Related Tasks

- [Task 56](../56-world-engine/README.md)：World Engine 主任务，记录当前 `WorldSubject` / `WorldSlice` / `WorldPatch` 模型与 API 契约。
- [Task 75](../75-world-engine-api-calendar-embedding-cleanup/README.md)：World API、Calendar loader 与 EmbeddingText 写入契约收口；本任务只负责 WorldIssue catalog 与 UI 展示契约。

## User Request / Topic

- 当前 Workbench issue 面板存在两个语义源：
  - 后端返回 `WorldIssue.code` 和 `message`；
  - 前端 `WorldEngineWorkbenchPreviewMutationEditor.vue` 根据 `code` 再生成「发生了什么 / 为什么要看 / 建议处理」等解释。
- 旧截图中 `broken-relative` 的 UI 文案能展示「无法 replace EmbeddingText[]」，不是前端真的理解了 EmbeddingText，而是后端/patch 层把具体原因塞进 `message`，前端又套了一层通用 `broken-relative` 解释。
- 用户希望：
  - issue 由后端生成具体、可展示的结构；
  - issue 生成逻辑拆到单独文件；
  - 维护一张 reference 表，成为最新唯一真相；
  - 分析 E/A issues 文档是否被淡化；
  - 重新评估拟议 `WorldIssueDto` 是否合理，避免过度设计。

## Initial Baseline

本节记录建任务时的基线，用来解释为什么要治理；后续实现进展以本文件的 Implementation Notes / Verification 为准。

- 后端当时类型在 `server/world-engine/types.ts`：

```ts
export type WorldIssueCode = "broken-relative" | "dangling-ref" | "base-shifted" | "masked";

export type WorldIssue = {
    code: WorldIssueCode;
    sliceId?: string;
    subjectId: string;
    attr: string;
    message: string;
};
```

- 前端 DTO 在 `app/components/novel-ide/world-engine/world-engine-workbench.types.ts` 重复定义同形状。
- 前端解释文案在 `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue`：
  - `buildIssueExplanation()` 按 `issue.code` 生成标题、影响和建议；
  - 模板里固定展示「发生了什么 / 为什么要看 / 建议处理」；
  - `issue.message` 原样显示，所以具体底层错误会和前端通用解释叠加。
- `app/utils/world-engine-workbench-real.ts` 目前仍负责把 `WorldIssueDto["code"]` 映射成 A/E 等级，属于前端 UI 辅助逻辑。
- `server/world-engine/patch-operations.ts` 的内部 `PatchIssue` 已有更细 code：
  - `broken-relative`
  - `cross-ref`
  - `invalid-path`
  - `embedding-whole-replace`
- `server/world-engine/world-engine.service.ts` 的 `applyAndDetect()` 当前把所有 patch issue 压成 `WorldIssue.code = "broken-relative"`，但保留原始 `message`。这是截图里「code 很粗，message 很细」的主要来源。
- `server/world-engine/world-engine.service.ts` 当前有三个 WorldIssue 生成路径：
  - `collectAdvisories()` 直接手写 `base-shifted` / `masked` 的 message；
  - `reduceWithIssues()` 调 `applyAndDetect()`，再补 `sliceId` / `subjectId`；
  - `collectDanglingRefIssues()` / `collectDanglingRefIssue()` 扫描 reduce 后的 ref 值并生成 `dangling-ref`。
- `app/utils/world-engine-workbench-real.ts` 还把 `sliceId/subjectId/attr/code/message` 拼成 review queue identity。这个 identity 属于前端 triage 会话态，不应塞回后端 issue DTO。

## Deep Research Findings

### 1. 现在的 code/message 分层已经反了

`PatchIssue` 有更准确的机器 code，但 `WorldIssue` 把它压成更粗的 `broken-relative`。这会造成两个后果：

- 前端只能看到粗 code，不得不写一套通用解释。
- 具体原因只能藏在 `message` 里，机器测试和 UI 分支都不能稳定识别，例如 `embedding-whole-replace` 只能表现为「一个 broken-relative 的特殊 message」。

正确方向不是让前端继续解析 `message`，而是让后端 catalog 决定「这个问题是 issue 还是 error、它的稳定 code 是什么、该怎么对用户解释」。

### 2. issue 通道和 error 通道必须分开治理

当前发现的 code 可以先分两组：

| 当前来源 | 当前 code | 建议通道 | 说明 |
| --- | --- | --- | --- |
| reduce / apply patch | `broken-relative` | `issues[]` | 已落库 patch 在 reduce 时无法安全应用，属于持久 E issue。 |
| ref 扫描 | `dangling-ref` | `issues[]` | reduce 后状态引用了不存在或类型不符的 subject，属于持久 E issue。 |
| write/edit advisory | `base-shifted` | `issues[]` | 本次写/编辑旧时间点导致下游相对 op 基准变化，属于一次性 A issue。 |
| write/edit advisory | `masked` | `issues[]` | 本次写/编辑旧时间点会被下游绝对 op 覆盖，属于一次性 A issue。 |
| patch validation / reduce legacy | `embedding-whole-replace` | error catalog + 可选 issue catalog | 新写入应拒绝；若旧数据 reduce 时显形，需要同 catalog 生成可展示 issue。 |
| patch validation | `invalid-path` | error catalog，暂不进 `issues[]` | 多数是非法输入，应 400/throw；除非历史坏数据能落库并在 reduce 显形。 |
| patch validation / reduce legacy | `cross-ref` | error catalog + 可选 issue catalog | 新写入应拒绝；若历史坏数据 reduce 时显形，需要可展示 issue。 |

因此本任务要建的不是一个模糊的「issue 文案表」，而是一个诊断 catalog：同一个诊断条目可以服务 `issues[]` 和 error response，但两条通道的 wire shape 不必混成一个。

### 3. 前端的合理职责比之前更窄

前端仍然应该保留：

- review queue 的排序、筛选和 `open/confirmed/ignored` triage 状态；
- issue key / identity，用于当前会话内保持处理状态；
- 同 subject + attr 的 patch 时间线上下文展示；
- 视觉样式和交互。

前端不应该继续维护：

- `code -> E/A` 的业务映射；
- `code -> E1/A1 label` 的编号映射；
- `code -> 发生了什么/为什么要看/建议处理` 的解释映射。

### 4. 文档需要从「散落解释」改成「一张表 + 多个入口」

当前 `reference/world-engine/subject-lifecycle.md` 写得最完整，但它不是 issue 的唯一真相源；`quick-reference.md` 又有简表；skills 和 agent tool 文档还有自己的简化说法。这些内容未来一改 code 就容易漂。

新的文档结构应该是：

- `reference/world-engine/issues.md` 是唯一稳定 reference。
- 其它 reference 文档只保留一句上下文说明和链接。
- skills 只讲操作流程和人话处理原则，不维护 code 表。
- task 56 / sqlite-and-api 这类历史/实现文档只保留 API 形状和迁移背景，不再作为 issue 语义来源。

## E / A Issue Taxonomy Audit

E/A 没有完全消失，但稳定文档表达不够集中：

- `reference/world-engine/README.md` 有一句核心边界：E 是持久数据错误，A 是一次性提醒。
- `reference/world-engine/subject-lifecycle.md` 第 7 节解释得最完整：E 读时现算、必须修；A 写/编辑时返回、不落库、确认语义即可。
- `reference/world-engine/schema-system.md` 和 `recording-principles.md` 也提到 E/A。
- `reference/world-engine/quick-reference.md` 有 issues 速查表，但没有把 E/A 作为正式 taxonomy 入口，也没有编号/label 的唯一真相。

结论：E/A 是实际契约，但文档分散。后续应新增 `reference/world-engine/issues.md`，把 E/A 定义、issue code、显示文案、来源、持久性和处理方式合并成唯一 reference 表。其它文档只链接它，不再各自维护半套解释。

## Follow-up Documentation Audit

本轮补充调研结论：`reference/world-engine/` 已经开始收敛到 `issues.md`，但“当前契约文档”和“历史任务记录”之间的边界还不够清楚，容易让后续 Agent 读到旧 shape 后继续扩散。

### 当前已收敛的位置

- `reference/world-engine/README.md` 已把 [issues.md](../../../reference/world-engine/issues.md) 放进阅读入口，并只保留 E/A 的一句摘要。
- `reference/world-engine/quick-reference.md` 的 Issues 速查已经改为链接 `issues.md`，不再维护 code 表。
- `reference/world-engine/subject-lifecycle.md` 第 7 节已经改成讲 issue 在写、读、删生命周期中何时出现，并链接 `issues.md`。
- `reference/world-engine/schema-system.md` / `recording-principles.md` 已经只保留原则说明，具体 code 表指向 `issues.md`。
- `server/agent/world-engine-tool-description.ts` 已明确 Agent 应使用 `title/message/explanation`，不要复述 code 表。

### 仍需处理的漂移点

- `docs/tasks/56-world-engine/sqlite-and-api.md` 仍保留旧版 `WorldIssue` 接口示例，只包含 `code/sliceId/subjectId/attr/message`，且 code union 仍是四项。这是当前最危险的漂移，因为它位于 API 契约文档而不是历史 walkthrough。
- `docs/tasks/56-world-engine/README.md` 的主任务总结中仍有旧版 E/A 简表和旧 op 名称语境。它是历史任务大本营，可以保留历史语境，但当前契约段落必须加醒目标注：issue 字段和 code catalog 以 `reference/world-engine/issues.md` 为准。
- bundled skill 中 `novel-workflow-09-chapter-writing` 仍写着 “E issues（`broken-relative` / `dangling-ref`）必须修；A issues（`base-shifted` / `masked`）确认...”。这会让写作 Agent 继续学习旧 code 集合，应改成只看 `severity` 和后端 explanation。
- `app/utils/world-engine-workbench-preview-mock.ts` 为 demo/mock 生成 label 时仍有前端本地 code -> label 映射。它不是生产解释源，但会在示例和测试中形成第二套 catalog；后续应优先改成测试 fixture/helper 从后端 catalog 对齐，或至少用显式 “mock-only” 注释约束。

### 文档分层结论

- **运行时唯一真相**：`server/world-engine/world-issue-catalog.ts`。
- **人读唯一真相**：`reference/world-engine/issues.md`。
- **当前 API/Agent 契约入口**：`reference/world-engine/README.md`、`docs/tasks/56-world-engine/agent-tools.md`、`server/agent/world-engine-tool-description.ts`，只能摘要并链接 `issues.md`。
- **历史记录**：`docs/tasks/56-world-engine/walkthroughs/**` 和旧 round 描述可以保留当时事实，不强制批量重写；但不能被当作当前契约引用。

## Documentation Reorganization Plan

文档整理不是「新增一页」就结束，而是要把职责重新分层，并明确哪些文档能写完整表、哪些只能链接。

### Target Document Roles

| 文档 | 新职责 | 具体动作 |
| --- | --- | --- |
| `reference/world-engine/issues.md` | 唯一 issue 语义真相源 | 维护 E/A taxonomy、`WorldIssue` wire shape、Issue Catalog、Error Catalog、作者可见解释规则。完整 code 表只允许在这里出现。 |
| `reference/world-engine/README.md` | 入口索引和核心边界 | 保留 `issues.md` 链接；核心边界只写一句 E/A 摘要，不列 code 细节。 |
| `reference/world-engine/quick-reference.md` | 一页纸速查 | Issues 速查只保留处理口诀和 `issues.md` 链接，不再重复表格。 |
| `reference/world-engine/subject-lifecycle.md` | subject/reduce 生命周期说明 | 第 7 节只解释 issues 在写/读/删流程中何时出现；具体 code、label、文案全部迁到 `issues.md`。 |
| `reference/world-engine/schema-system.md` | schema/op/reduce 语义 | 只保留 op 可能触发 issue 的上下文，例如 increment 缺基；具体 label/code/explanation 链接 `issues.md`。 |
| `reference/world-engine/recording-principles.md` | 记录原则 | 保留「E 必修、A 确认」原则；删除 code 展开。 |
| `docs/tasks/56-world-engine/agent-tools.md` | 当前 Agent 工具契约 | 更新 `WorldIssue` shape；issues 处理章节链接 `reference/world-engine/issues.md`，不维护 code 表。 |
| `docs/tasks/56-world-engine/sqlite-and-api.md` | SQLite/API 当前契约留档 | 必须更新接口示例到新 shape，或将旧接口块标为历史草案并新增“当前 issue 契约见 reference”提示。不能继续暴露旧四字段 shape。 |
| `docs/tasks/56-world-engine/README.md` | 历史任务大本营 | 保留 round 历史，但在主契约摘要处删除完整 code 表或明确以 `issues.md` 为准。不要让它成为第二张 reference 表。 |
| `docs/tasks/56-world-engine/walkthroughs/**` | 历史 walkthrough | 允许保留旧 code/旧文案，因为它们记录当时修复背景；不纳入 anti-drift 阻断。 |
| `server/agent/world-engine-tool-description.ts` | Agent 当前工具提示面 | 简短说明 `issues[]` 已带 title/explanation；Agent 向用户解释时使用后端字段，不复述 code 表。 |
| bundled skills：`novel-workflow-world-engine-init` / `08-plot-planning` / `09-chapter-writing` | 操作流程 | 只说「检查 issues，`severity:error` 先修，`severity:advisory` 确认」；遇到具体问题用返回的 `title/message/explanation`，不硬编码 code。 |

### New `issues.md` Structure

`reference/world-engine/issues.md` 建议包含这些章节：

1. **Issue vs Error**
   - `issues[]`：写入成功但世界状态或本次写入存在需要处理/确认的问题。
   - error response / thrown error：输入非法，写入没有成功。
   - 同一个 catalog 可以服务两种通道，但调用方处理方式不同。

2. **E / A Taxonomy**
   - E = Error issue：持久、读时现算、必须修。
   - A = Advisory issue：一次性、写/编辑旧时间点返回、不落库、确认语义即可。
   - E/A 是业务分类，不是前端样式。

3. **WorldIssue Wire Shape**
   - 字段表：`code`、`label`、`severity`、`subjectId`、`attr`、`sliceId?`、`patchId?`、`path?`、`op?`、`title`、`message`、`explanation`。
   - 明确 `message` 是实例细节，`explanation` 是处理说明。

4. **Issue Catalog**
   - 每行包含：label、code、severity、是否持久、出现通道、典型触发、what happened、why it matters、suggested action。
   - 覆盖 `broken-relative`、`dangling-ref`、`invalid-path`、`cross-ref`、`embedding-whole-replace`、`base-shifted`、`masked`。
   - `invalid-path` / `cross-ref` / `embedding-whole-replace` 要明确双通道边界：新写入通常是 error response；历史坏数据或 reduce 显形时才是 E issue。

5. **Error Catalog**
   - 维护不进入 `issues[]` 的写入校验错误。
   - 初始覆盖 `invalid-path`、`cross-ref`、`embedding-whole-replace` 的写入拒绝语义。

6. **Author-facing Explanation Rules**
   - UI/Agent 不直接向用户抛 code。
   - 展示优先级：`title` -> `message` -> `explanation`。
   - code 仅用于定位、测试、过滤和开发排查。

### Doc Migration Order

1. 建立 `issues.md` 作为唯一人读表，覆盖当前 catalog 全部 7 个 code。
2. 收敛 `reference/world-engine/README.md` / `quick-reference.md` / `subject-lifecycle.md` / `schema-system.md` / `recording-principles.md`，只保留上下文和链接。
3. 更新 `docs/tasks/56-world-engine/sqlite-and-api.md` 的 API 示例。这里是当前契约文档，不能保留旧 `WorldIssue` shape 而不标注。
4. 更新 `docs/tasks/56-world-engine/agent-tools.md`，用 `severity` 和 `title/message/explanation` 描述 Agent 处理方式。
5. 更新 `docs/tasks/56-world-engine/README.md` 主契约摘要，把旧 code 表降级为历史背景或链接到 `issues.md`。
6. 更新 `server/agent/world-engine-tool-description.ts` 和 bundled skills，确保运行时 Agent 不再学习旧 code 表。
7. 保留 `docs/tasks/56-world-engine/walkthroughs/**` 的历史内容；只在它们被当前文档主动引用时加“历史记录，以 reference 为准”的提示。
8. 最后跑 anti-drift 扫描，确认当前契约面没有第二张完整 issue catalog。

### Anti-drift Checks

- 新增测试从 `WORLD_ISSUE_CATALOG` 导出 code 列表，检查 `reference/world-engine/issues.md` 的 Issue Catalog 覆盖同一组 code。
- 静态扫描当前协议文档，禁止新增独立完整 issue 表。允许简单提及 code，但必须链接 `issues.md`，且不能同时维护 label/severity/explanation。
- 扫描范围分层：
  - 阻断范围：`reference/world-engine/*.md`、`docs/tasks/56-world-engine/agent-tools.md`、`docs/tasks/56-world-engine/sqlite-and-api.md`、`server/agent/world-engine-tool-description.ts`、bundled active skills。
  - 豁免范围：`docs/tasks/56-world-engine/walkthroughs/**`、归档 task、测试 fixture 中明确标为 mock-only 的示例。
- 前端测试禁止 `WorldEngineWorkbenchPreviewMutationEditor.vue` 重新出现 `code === "broken-relative"` 这类解释分支。
- UI/demo mock 如果必须生成 issue，需要从同一个 test helper 或 catalog fixture 派生 label/severity/title/explanation，不再散落手写映射。

## DTO Design Review

此前拟议形状：

```ts
type WorldIssueDto = {
    code: WorldIssueCode;
    level: "E" | "A";
    persistence: "persistent" | "advisory";
    label: "E1" | "E2" | "A1" | "A2" | string;
    subjectId: string;
    attr: string;
    sliceId?: string;
    patchId?: string;
    title: string;
    message: string;
    explanation: {
        whatHappened: string;
        whyItMatters: string;
        suggestedAction: string;
    };
    source: {
        kind: "reduce" | "write-advisory" | "delete-reduce" | "patch-apply";
        path?: string;
        op?: "replace" | "increment" | "remove" | "append";
    };
};
```

### Reasonable Parts

- `code`：必须保留，机器契约和测试断言依赖它。
- `level`：合理。前端不应该再自己判断 `base-shifted/masked => A`。
- `label`：合理但应由 catalog 固定生成，例如 `E1` / `E2` / `A1` / `A2`。它是展示和 reference 对照入口。
- `subjectId` / `attr` / `sliceId`：合理，是定位 issue 的最小业务坐标。
- `message`：合理，但定位应收窄为「具体实例消息」，不要再承载完整解释。
- `title`：合理。前端列表、详情页需要一句话标题，不应由前端拼。
- `explanation`：合理。三个栏目文案应由后端输出，前端只排版。

### Risky Or Redundant Parts

- `persistence` 和 `level` 重复度高。当前 E 永远 persistent，A 永远 advisory。除非预期未来有「E 但一次性」或「A 但持久」这类组合，否则先不要暴露两个字段。
- `source.kind` 容易过早固化内部实现。`reduce`、`delete-reduce`、`patch-apply` 是服务内部路径，不一定适合作为稳定 wire 契约。前端真正需要的是「读时持久问题」还是「本次写入提醒」。
- `source.path` 与 `attr` 在多数情况下重复；需要 JSON Pointer 时可以单独给 `path`，但不要包一层 source 只为了放 path。
- `source.op` 有价值，但只在 patch 相关 issue 中非空。可以作为顶层 `op?: WorldPatchOp`，并注释何时为空。
- `patchId` 很有价值，但当前读时 reduce 的 issue 未必都有准确 patchId。可以加可选字段，但必须明确：非空表示可直接定位到 patch 行；为空时只能定位到 slice/subject/attr。
- `explanation.whatHappened` 与 `message` 边界要清楚，否则会出现两套「发生了什么」。建议 `title` 是短标题，`message` 是实例细节，`explanation` 是结构化处理说明。

### Recommended Shape

建议第一轮采用较瘦 DTO，不暴露内部 source enum：

```ts
type WorldIssueSeverity = "error" | "advisory";
type WorldIssueLabel =
    | "E1"
    | "E2"
    | "E3"
    | "E4"
    | "E5"
    | "A1"
    | "A2";

type WorldIssue = {
    code: WorldIssueCode;
    label: WorldIssueLabel;
    severity: WorldIssueSeverity;
    subjectId: string;
    attr: string;
    /** 非空表示可定位到显形或下游触发的切面；读时全局问题可能为空。 */
    sliceId?: string;
    /** 非空表示可定位到具体 patch 行；旧数据、派生 ref 扫描或聚合问题可能为空。 */
    patchId?: string;
    /** JSON Pointer 路径；当问题来自具体 patch/path 时非空。 */
    path?: string;
    /** 触发问题的 patch 操作；读时 ref 扫描等非 patch 问题为空。 */
    op?: WorldPatchOp;
    title: string;
    message: string;
    explanation: {
        whatHappened: string;
        whyItMatters: string;
        suggestedAction: string;
    };
};
```

这个形状的取舍：

- 去掉 `persistence`，用 `severity` 表达 UI 和处理优先级；E/A 的持久性由 catalog 文档定义，不重复进 DTO。
- 不暴露 `source.kind`，避免把内部调用路径变成长期兼容负担。
- 保留 `patchId/path/op` 为可选定位信息，满足 Workbench 未来精确跳 patch 的需要。
- 后端负责 `label/title/message/explanation`，前端只负责布局、triage 状态、筛选、跳转和高亮。
- 不把 review queue 的 `identity/key/status` 放进 DTO。它们依赖前端会话、当前 slice 列表和 triage 状态，不是 World Engine issue 本体。

## Decisions

- **D1：直接 breaking change `WorldIssue.code`。** 当前项目阶段允许破坏性迁移；`embedding-whole-replace`、`invalid-path`、`cross-ref` 进入 catalog，避免继续伪装成通用 `broken-relative`。
- **D2：patch apply validation issue 采用双通道。**
  - 写入被拒绝的非法输入继续走 error response；
  - 成功写入/读时 reduce 显形的问题走 `issues[]`。
  `embedding-whole-replace`、`invalid-path`、`cross-ref` 新写入通常是 error；如果历史坏数据已经落库，reduce 时可用同一 catalog 生成 E issue。
- **D3：label 固定到 catalog。** 当前 label 集合为 `E1`、`E2`、`E3`、`E4`、`E5`、`A1`、`A2`。前端不能按 label 推理业务语义，label 只是展示和 reference 对照入口。
- **D4：`severity` 使用 `error/advisory`。** `E1/A1` 适合 label；`severity` 用可读枚举，减少前端样式和业务编号耦合。
- **D5：双层真相源。** `server/world-engine/world-issue-catalog.ts` 是运行时真相；`reference/world-engine/issues.md` 是人读真相。测试保证两者 code 集合一致。

## Implementation Plan

1. 新增 `reference/world-engine/issues.md`
   - 定义 E/A taxonomy。
   - 维护 issue reference 表：label、code、severity、触发来源、是否持久、出现通道、用户解释、建议处理。
   - 增加 Error Catalog，说明 `invalid-path`、`cross-ref`、`embedding-whole-replace` 这类写入校验错误何时不进入 `issues[]`。
   - 让 `README.md`、`quick-reference.md`、`subject-lifecycle.md`、`schema-system.md`、`recording-principles.md` 链接到该表，减少重复解释。

2. 新增后端 issue catalog / builder
   - `server/world-engine/world-issue-catalog.ts`：唯一代码真相，声明每个 issue code 的 label、severity、title 模板和 explanation 模板。
   - `server/world-engine/world-issue-builder.ts`：接收 subject/path/op/slice/patch 上下文，生成 `WorldIssue`。
   - catalog 同时覆盖 `issues[]` 和 error response 的诊断条目，但 builder 分成 `buildWorldIssue()` 与 `buildWorldEngineErrorDetail()` 之类的通道函数，避免混淆写入失败和写入成功后返回的问题。
   - 测试保证 catalog 覆盖所有 `WorldIssueCode`，文档 reference 表覆盖同一组 issue code。

3. 调整 `WorldIssue` 类型
   - 采用 Recommended Shape。
   - 后端类型作为源，前端 DTO 尽量从 API 类型或同名 shape 同步，避免独立维护两套 code union。
   - 新增更细 code 时同步测试和 reference 表。
   - 保持前端 review queue 自有字段在 `WorldWorkbenchPreviewReviewQueueItem` 中，不回流到后端 DTO。

4. 收口后端 issue 生成点
   - `reduceWithIssues()` / `applyAndDetect()` 不再把所有 patch issue 压成 `broken-relative`。
   - `collectDanglingRefIssues()` 使用 builder 生成 `dangling-ref`。
   - `collectAdvisories()` 使用 builder 生成 `base-shifted` / `masked`。
   - patch validation 的 reject error 与 `issues[]` 共用 catalog 文案来源，但保持通道边界：非法输入不写入；已落库旧数据 reduce 显形才进入 `issues[]`。
   - 评估 `WorldPatchRow.id` 是否可无额外查询传入 builder；如果可以，本轮补 `patchId`，否则保留可选并记录后续 repository 改造。

5. 简化前端
   - 删除或降级 `buildIssueExplanation()` 的语义映射。
   - 面板直接展示 `issue.title`、`issue.message` 和 `issue.explanation.*`。
   - 前端保留 triage 状态、队列排序、issue key、状态标签和定位高亮。
   - `worldWorkbenchIssueLevel()` 改为使用 `issue.severity`，或仅作为兼容临时 helper 后续删除。
   - `ReviewFocusContext` 增加 `title/explanation/severity/label`，手动定位 `manual-focus` 继续走前端本地文案，不伪装成后端 issue。

6. 文档迁移
   - 按 Documentation Reorganization Plan 的顺序修改 reference、Task 56 工具文档、tool description 和 bundled skills。
   - 删除重复 code 解释表，只保留链接和最短流程提示。
   - 新增 anti-drift 测试或静态扫描，防止未来文档重新分叉。

7. 测试
   - 后端 catalog 完整性测试：所有 code 有 label/severity/explanation。
   - reducer/advisory 测试：`broken-relative`、`dangling-ref`、`base-shifted`、`masked` 生成完整 DTO。
   - EmbeddingText 测试：非空整块 replace 不再伪装成通用 `broken-relative`。
   - 前端测试：详情面板使用后端 explanation，不再按 code 生成三栏语义。
   - 静态测试：reference issue 表与 catalog code 集合一致。
   - 文档扫描：当前协议文档不再维护独立 issue code 表；允许 `issues.md` 和历史 walkthrough 保留完整表。

## Implementation Notes

- 后端 issue 契约已扩展为完整 `WorldIssue`：
  - `code` 覆盖 `broken-relative`、`dangling-ref`、`invalid-path`、`cross-ref`、`embedding-whole-replace`、`base-shifted`、`masked`。
  - `label` 固定为 `E1`、`E2`、`E3`、`E4`、`E5`、`A1`、`A2`。
  - `severity` 使用 `error/advisory`；前端不再按 code 判断 E/A。
  - issue 带 `title/message/explanation`，三栏解释由后端生成。
- 运行时真相源拆分为：
  - `server/world-engine/world-issue-catalog.ts`：稳定 catalog 和 error response 复用入口。
  - `server/world-engine/world-issue-builder.ts`：`buildWorldIssue()`，集中把上下文转成完整 DTO。
- 后端生成点已收口：
  - `collectAdvisories()` 用 builder 生成 `base-shifted` / `masked`，并尽量带 `patchId`。
  - `reduceWithIssues()` 保留 patch 层更细 code，不再把 `invalid-path` / `cross-ref` / `embedding-whole-replace` 压成 `broken-relative`。
  - `dangling-ref` 扫描用 builder 生成完整 issue。
  - `EmbeddingText` 非空整块 replace 新写入仍走 error response，但 error `data` 带 `code/label/severity/title/explanation`。
- 前端已收口：
  - `WorldIssueDto` 与后端 shape 对齐。
  - review queue item 透传 `label/severity/title/explanation/path/op/patchId`。
  - `WorldEngineWorkbenchPreviewMutationEditor.vue` 直接展示后端 `title` 和 `explanation.*`，不再保留 `buildIssueExplanation()` / `relativeOperationQuestion()` 这类 code 解释分支。
  - `WorldEngineWorkbenchDialog.vue` / Slice card / preview page 使用 `severity` 或后端 label，而不是按 code 推理。
  - 浏览器 mock preview 增加明确 mock-only catalog fixture；生产 issue 仍以后端 catalog 为唯一真相。
- 文档已收敛：
  - `reference/world-engine/issues.md` 成为唯一人读 issue 表。
  - `reference/world-engine/README.md`、`quick-reference.md`、`subject-lifecycle.md`、`schema-system.md`、`recording-principles.md` 改为摘要 + 链接。
  - `docs/tasks/56-world-engine/sqlite-and-api.md` 的 `WorldIssue` 示例已更新为新 shape。
  - `docs/tasks/56-world-engine/README.md` 主契约摘要改为以 `issues.md` 为准。
  - `novel-workflow-09-chapter-writing` 不再硬编码旧 code 集合。

### Plan Deviations

- 原计划提到可拆 `buildWorldEngineErrorDetail()`；当前没有单独增加这个函数。原因是 error 通道目前只需要 `worldIssueCatalogItem()` 取 catalog 字段写入 `createError.data`，再抽一层会比当前使用点更重。
- `patchId` 继续保持可选。A issue 与 patch apply 显形问题能带时会带；派生 ref 扫描等场景仍允许只定位到 slice / subject / attr，避免为了填满字段引入额外全局查询。

## Verification

- `bun test server/world-engine/world-issue-catalog.test.ts server/world-engine/world-engine.facade.test.ts server/world-engine/patch-operations.test.ts`：通过，81 pass。
- `bun test app/utils/world-engine-workbench-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`：通过，26 pass。
- `bun test server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/world-engine/codeact.test.ts`：通过，46 pass。
- `bun run typecheck`：通过。
- 静态扫描结论：
  - 前端生产组件未发现 `buildIssueExplanation` / `relativeOperationQuestion` / 旧 `A1（提醒）`、`E1（持久）` 文案残留。
  - 当前契约文档的完整 code 表只保留在 `reference/world-engine/issues.md`；task 56 walkthrough 历史记录不作为当前契约阻断。

## Non-goals

- 本任务不重新设计 Workbench triage 状态持久化。
- 本任务不改变 World Engine 事件溯源、slice、patch、reduce 语义。
- 本任务不把所有错误都塞进 `issues[]`；非法请求仍应是 error response。
- 本任务不为了兼容旧客户端保留旧 issue wire shape。

## Open Questions

- `patchId` 的填充率需要在实现中继续验证：当前 DTO 保持可选，非空表示可直接定位到 patch 行；为空时 UI/Agent 退回 slice / subject / attr 定位。不要为了填满它引入额外全局查询。
- `docs/tasks/56-world-engine/README.md` 作为历史大本营是否要批量改旧 round 摘要？当前建议不批量重写，只改主契约摘要并让当前入口指向 `issues.md`。
