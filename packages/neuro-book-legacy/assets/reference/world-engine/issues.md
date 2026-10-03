# World Engine Issues

本文是 World Engine issue 语义的人读 reference。机器真相源是 `server/world-engine/world-issue-catalog.ts`；本文的 Issue Catalog 表由测试逐字段对齐 catalog，修改 issue 时必须同步两者，否则测试失败。

## Issue vs Error

`issues[]` 表示操作已经完成，但世界状态或本次写入需要处理或确认。

- E issues 是持久数据错误。它们来自 reduce 或读时扫描，会在查询、切面列表、删除后重算中反复出现，直到数据被修好。
- A issues 是一次性提醒。它们来自写入或编辑旧时间点，用来提醒作者确认补过去是否改变了下游语义；A issues 不落库。

error response / thrown error 表示输入非法，写入没有成功。写入校验错误和 `issues[]` 可以复用同一个诊断 catalog，但调用方必须按通道区分：error 先修输入，issue 则按返回的 `title/message/explanation` 处理。

## Wire Shape

```ts
type WorldIssue = {
    code: WorldIssueCode;
    label: "E1" | "E2" | "E3" | "E4" | "E5" | "A1" | "A2";
    severity: "error" | "advisory";
    subjectId: string;
    attr: string;
    sliceId?: string;
    patchId?: string;
    path?: string;
    op?: "replace" | "increment" | "remove" | "append";
    title: string;
    message: string;
    explanation: {
        whatHappened: string;
        whyItMatters: string;
        suggestedAction: string;
    };
};
```

字段边界：

- `code` 是机器稳定标识，用于测试、过滤和开发排查。
- `label` 是文档和 UI 锚点，例如 `E1`、`A1`。
- `severity` 决定处理优先级：`error` 必须修，`advisory` 确认语义即可。
- `message` 是本次实例的具体细节。
- `explanation` 是后端生成的结构化人话说明；前端和 Agent 不再根据 `code` 自行生成解释。
- `patchId` 非空时可定位到具体 patch 行；为空时只能定位到 slice / subject / attr。

## Issue Identity / Dedupe

`issues[]` 可能由多次写入、查询或 slice 投影反复收集同一个持久 E issue。运行时会按稳定身份去重：有 `patchId` 时以 `code + patchId + path/attr + op` 作为同一问题；没有 `patchId` 时以 `code + sliceId + subjectId + path/attr + op + message` 作为同一问题。

去重只消除重复警报，不会修复或隐藏历史坏 patch。不同 `sliceId` / `patchId` 的问题必须分别保留，UI 和 Agent 仍可用返回的 `sliceId` / `patchId` 定位到具体切面和 patch。

## Issue Catalog

| Label | Code | Severity | Title | 持久性 | 典型来源 | 发生了什么 | 为什么要看 | 建议处理 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E1 | `broken-relative` | error | 相对变更没有可用基准 | 持久 | reduce / apply patch | 某条 increment、append 或相对 remove 无法在当前时间线中找到可安全应用的已有值。 | 这是持久数据错误；查询、列表和后续 reduce 会反复看到它，直到时间线被修正。 | 在这条 patch 之前补一个 replace 初始化，或把当前相对 op 改成能直接定义值的 replace。 |
| E2 | `dangling-ref` | error | 引用目标无效 | 持久 | ref 扫描 | reduce 后的 ref 值没有指向有效 subject，或目标 subject 类型不符合 schema 声明。 | 这是持久数据错误；状态里保留了无法解读的关系，后续查询会继续暴露。 | 确认目标 subject 是否存在且类型正确；必要时先创建目标 subject，或把当前 ref 改成正确目标。 |
| E3 | `invalid-path` | error | patch 路径无法应用 | 持久或写入拒绝 | patch apply / validation | patch 的 JSON Pointer 路径或目标容器形状不符合当前 reduce 状态。 | 这是持久数据错误；该 patch 无法可靠改变世界状态，后续状态可能缺失预期变化。 | 修正 patch path 或先补齐父路径；如果这是新写入请求，应直接修输入后重试。 |
| E4 | `cross-ref` | error | patch 试图穿过引用目标 | 持久或写入拒绝 | patch apply / validation | patch 路径穿过了 subject:// 引用，试图直接改另一个 subject 的内部属性。 | 引用只是关系值，不是嵌入对象；跨引用写入会破坏 subject 独立演化边界。 | 分别写当前 subject 的 ref 值和目标 subject 自己的属性，不要在一个 path 里穿过引用。 |
| E5 | `embedding-whole-replace` | error | EmbeddingText 字段不能整块写入非空内容 | 持久或写入拒绝 | patch apply / validation | EmbeddingText 容器承载可向量化文本，非空整块 replace 会让一行 patch 承载多条文本。 | 向量列和溯源语义要求一条 EmbeddingText 对应一行 WorldPatch；整块写入会让检索和追踪失真。 | 空容器可用 replace 初始化；真实文本请用 append 或 key 级 replace 单条写入，vector/model 由系统维护；不要通过内部路径写 `/events/0` 或 `/memory/key/vector`。 |
| A1 | `base-shifted` | advisory | 下游相对变更的基准可能改变 | 一次性 | write/edit advisory | 本次对过去的绝对修改会改变后续 increment、append 等相对 op 读到的基准。 | 这不是持久错误；它提醒你确认下游结果改变是否符合新的剧情语义。 | 检查被提醒的下游 patch，确认新的累加、追加或删除结果是否仍然正确。 |
| A2 | `masked` | advisory | 本次改动可能被后续绝对变更覆盖 | 一次性 | write/edit advisory | 本次对过去的修改后面还有 replace 或 remove，会重新定义同一路径或相关路径。 | 这不是持久错误；它提醒你这次中途设定可能不会完整传播到最新状态。 | 检查后续覆盖 patch，确认当前改动被覆盖是有意的，而不是遗漏了需要同步修改的后续切面。 |

## Error Catalog

这些诊断在新写入时通常走 error response / throw，不代表写入成功：

- `invalid-path`：path 格式、父路径、数组索引或目标容器不合法。
- `cross-ref`：path 穿过 `subject://` 引用。
- `embedding-whole-replace`：对 EmbeddingText 容器进行非空整块 replace。

如果旧数据、手工损坏或历史版本让这类 patch 已经落库，reduce 时可以把它们作为 E issue 返回，便于 Workbench 定位和修复。

## Author-facing Rules

- 不要把 `broken-relative` 这类 code 直接抛给用户。
- UI 和 Agent 展示时优先使用 `title`、`message`、`explanation`。
- code 只作为开发、过滤、测试和 reference 对照入口。
- E issue 要修数据；A issue 要确认补过去的语义。
