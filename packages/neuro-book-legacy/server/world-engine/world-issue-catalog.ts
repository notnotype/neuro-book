import type {
    WorldIssueCode,
    WorldIssueExplanation,
    WorldIssueLabel,
    WorldIssueSeverity,
} from "nbook/server/world-engine/types";

type WorldIssueCatalogItem = {
    code: WorldIssueCode;
    label: WorldIssueLabel;
    severity: WorldIssueSeverity;
    /** reference 表中的持久性说明，用于锁定人读文档与机器 catalog 不漂移。 */
    persistence: string;
    /** reference 表中的典型来源说明，用于锁定 issue 生成语义。 */
    source: string;
    title: string;
    explanation: WorldIssueExplanation;
};

/** World Engine issue 的机器真相源；reference 文档必须逐字段镜像这里。 */
export const WORLD_ISSUE_CATALOG: Record<WorldIssueCode, WorldIssueCatalogItem> = {
    "broken-relative": {
        code: "broken-relative",
        label: "E1",
        severity: "error",
        persistence: "持久",
        source: "reduce / apply patch",
        title: "相对变更没有可用基准",
        explanation: {
            whatHappened: "某条 increment、append 或相对 remove 无法在当前时间线中找到可安全应用的已有值。",
            whyItMatters: "这是持久数据错误；查询、列表和后续 reduce 会反复看到它，直到时间线被修正。",
            suggestedAction: "在这条 patch 之前补一个 replace 初始化，或把当前相对 op 改成能直接定义值的 replace。",
        },
    },
    "dangling-ref": {
        code: "dangling-ref",
        label: "E2",
        severity: "error",
        persistence: "持久",
        source: "ref 扫描",
        title: "引用目标无效",
        explanation: {
            whatHappened: "reduce 后的 ref 值没有指向有效 subject，或目标 subject 类型不符合 schema 声明。",
            whyItMatters: "这是持久数据错误；状态里保留了无法解读的关系，后续查询会继续暴露。",
            suggestedAction: "确认目标 subject 是否存在且类型正确；必要时先创建目标 subject，或把当前 ref 改成正确目标。",
        },
    },
    "invalid-path": {
        code: "invalid-path",
        label: "E3",
        severity: "error",
        persistence: "持久或写入拒绝",
        source: "patch apply / validation",
        title: "patch 路径无法应用",
        explanation: {
            whatHappened: "patch 的 JSON Pointer 路径或目标容器形状不符合当前 reduce 状态。",
            whyItMatters: "这是持久数据错误；该 patch 无法可靠改变世界状态，后续状态可能缺失预期变化。",
            suggestedAction: "修正 patch path 或先补齐父路径；如果这是新写入请求，应直接修输入后重试。",
        },
    },
    "cross-ref": {
        code: "cross-ref",
        label: "E4",
        severity: "error",
        persistence: "持久或写入拒绝",
        source: "patch apply / validation",
        title: "patch 试图穿过引用目标",
        explanation: {
            whatHappened: "patch 路径穿过了 subject:// 引用，试图直接改另一个 subject 的内部属性。",
            whyItMatters: "引用只是关系值，不是嵌入对象；跨引用写入会破坏 subject 独立演化边界。",
            suggestedAction: "分别写当前 subject 的 ref 值和目标 subject 自己的属性，不要在一个 path 里穿过引用。",
        },
    },
    "embedding-whole-replace": {
        code: "embedding-whole-replace",
        label: "E5",
        severity: "error",
        persistence: "持久或写入拒绝",
        source: "patch apply / validation",
        title: "EmbeddingText 字段不能整块写入非空内容",
        explanation: {
            whatHappened: "EmbeddingText 容器承载可向量化文本，非空整块 replace 会让一行 patch 承载多条文本。",
            whyItMatters: "向量列和溯源语义要求一条 EmbeddingText 对应一行 WorldPatch；整块写入会让检索和追踪失真。",
            suggestedAction: "空容器可用 replace 初始化；真实文本请用 append 或 key 级 replace 单条写入，vector/model 由系统维护；不要通过内部路径写 `/events/0` 或 `/memory/key/vector`。",
        },
    },
    "base-shifted": {
        code: "base-shifted",
        label: "A1",
        severity: "advisory",
        persistence: "一次性",
        source: "write/edit advisory",
        title: "下游相对变更的基准可能改变",
        explanation: {
            whatHappened: "本次对过去的绝对修改会改变后续 increment、append 等相对 op 读到的基准。",
            whyItMatters: "这不是持久错误；它提醒你确认下游结果改变是否符合新的剧情语义。",
            suggestedAction: "检查被提醒的下游 patch，确认新的累加、追加或删除结果是否仍然正确。",
        },
    },
    "masked": {
        code: "masked",
        label: "A2",
        severity: "advisory",
        persistence: "一次性",
        source: "write/edit advisory",
        title: "本次改动可能被后续绝对变更覆盖",
        explanation: {
            whatHappened: "本次对过去的修改后面还有 replace 或 remove，会重新定义同一路径或相关路径。",
            whyItMatters: "这不是持久错误；它提醒你这次中途设定可能不会完整传播到最新状态。",
            suggestedAction: "检查后续覆盖 patch，确认当前改动被覆盖是有意的，而不是遗漏了需要同步修改的后续切面。",
        },
    },
};

/** 写入校验错误复用 catalog 的解释来源，但仍走 throw/error response 通道。 */
export function worldIssueCatalogItem(code: WorldIssueCode): WorldIssueCatalogItem {
    return WORLD_ISSUE_CATALOG[code];
}
