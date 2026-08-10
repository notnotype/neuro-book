/**
 * 内置 workflow：整书结构提取（导入管线第四步）。
 *
 * 输入是逐章摘要（leader 用 `workspace node parse --json` 批量读出，不含正文），
 * 按卷分批做结构粗提取（主线/角色/世界观/未解钩子），再由汇总员合并去重成全书提议。
 * 落库由 leader 逐项与用户确认后执行（lorebook 内容节点 / Plot 因果树 / 角色模块）。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

const ThreadProposalSchema = Type.Object({
    name: Type.String({description: "machine-friendly 主线/支线名（小写字母、数字、连字符，如 main-revenge）。"}),
    title: Type.String({description: "人类可读的线名，如「复仇主线」。"}),
    description: Type.String({description: "这条线讲什么、大致起止章节位置。"}),
}, {additionalProperties: false});

const CharacterProposalSchema = Type.Object({
    name: Type.String({description: "角色名。"}),
    summary: Type.String({description: "一句话角色定位。"}),
    arc: Type.String({description: "角色弧线：开局状态 → 结局状态。"}),
}, {additionalProperties: false});

const WorldFactProposalSchema = Type.Object({
    title: Type.String({description: "世界观条目名。"}),
    summary: Type.String({description: "条目内容摘要。"}),
    category: Type.Union([
        Type.Literal("character"),
        Type.Literal("location"),
        Type.Literal("faction"),
        Type.Literal("item"),
        Type.Literal("event"),
        Type.Literal("system"),
        Type.Literal("note"),
    ], {description: "lorebook 内容节点类型。"}),
}, {additionalProperties: false});

const HookProposalSchema = Type.Object({
    description: Type.String({description: "未解伏笔/钩子描述。"}),
    seededChapter: Type.String({description: "埋下的大致章节位置（如「第 5 章」或「卷一」）。"}),
}, {additionalProperties: false});

const VolumeExtractionSchema = Type.Object({
    threads: Type.Array(ThreadProposalSchema, {description: "本卷出现的主线/支线。没有就返回空数组。"}),
    characters: Type.Array(CharacterProposalSchema, {description: "本卷主要出场角色。没有就返回空数组。"}),
    worldFacts: Type.Array(WorldFactProposalSchema, {description: "本卷揭示的世界观事实。没有就返回空数组。"}),
    openHooks: Type.Array(HookProposalSchema, {description: "本卷埋下且尚未回收的钩子。没有就返回空数组。"}),
}, {additionalProperties: false});

const BookStructureSchema = Type.Object({
    threads: Type.Array(ThreadProposalSchema, {description: "全书主线/支线（合并去重后）。"}),
    characters: Type.Array(CharacterProposalSchema, {description: "全书主要角色（合并去重后，次要角色留给用户后续细化）。"}),
    worldFacts: Type.Array(WorldFactProposalSchema, {description: "全书世界观事实（合并去重后）。"}),
    openHooks: Type.Array(HookProposalSchema, {description: "全书尚未回收的钩子（合并去重后）。"}),
}, {additionalProperties: false});

/** 单批输入的摘要字符数上限：超限自动再切批，避免单次 invoke 上下文过大。 */
const BATCH_CHAR_LIMIT = 12000;

export default {
    key: "book-structure-extract",
    title: "整书结构提取",
    description: "导入管线第四步：根据逐章摘要提取全书主线/角色/世界观/未解钩子提议（按卷分批粗提取后汇总去重），供用户确认后落库。",
    whenToUse: "整本书已导入 manuscript 且已完成逐章摘要（chapter-digest）后，要把书的结构/角色/世界观整理进 Plot 与 lorebook 时使用；用户自己正在写的项目不要使用。",
    argsHint: [
        {name: "summaries", label: "逐章摘要 JSON 数组（每项 {path, title, summary}，从 `workspace node parse --json` 结果生成；必填）", defaultValue: ""},
        {name: "model", label: "提取模型 key（结构提取值得用好模型；留空用默认）", defaultValue: ""},
    ],
    phases: [
        {key: "collect", title: "读取摘要"},
        {key: "analyze", title: "按卷粗提取"},
        {key: "synthesize", title: "汇总去重"},
    ],
    run: async (wf, args) => {
        const rawSummaries = typeof args?.summaries === "string" ? args.summaries.trim() : "";
        if (!rawSummaries) {
            throw new Error("必须提供 summaries：逐章摘要 JSON 数组（{path, title, summary}）。");
        }
        let summaries: {path: string; title: string; summary: string}[];
        try {
            const parsed = JSON.parse(rawSummaries) as unknown;
            if (!Array.isArray(parsed)) {
                throw new Error("不是数组");
            }
            summaries = parsed.map((item, index) => {
                const record = item as Partial<{path: string; title: string; summary: string}>;
                if (!record || typeof record !== "object" || typeof record.path !== "string" || !record.path.trim()) {
                    throw new Error(`第 ${index + 1} 项缺少 path`);
                }
                return {
                    path: record.path.trim(),
                    title: typeof record.title === "string" ? record.title : "",
                    summary: typeof record.summary === "string" ? record.summary : "",
                };
            });
        } catch (error) {
            throw new Error(`summaries 不是合法 JSON 数组：${error instanceof Error ? error.message : String(error)}`);
        }
        if (summaries.length === 0) {
            throw new Error("summaries 为空数组，没有可提取的内容");
        }
        const model = typeof args?.model === "string" && args.model.trim() ? args.model.trim() : undefined;

        wf.progress({phase: "collect"});
        wf.chart.node("collect", "读取摘要");
        wf.chart.enter("collect");
        wf.log(`读取 ${summaries.length} 条章节摘要`);

        // ── Phase 2: analyze（按卷分批，超限再切）──
        wf.progress({phase: "analyze", done: 0, total: 1});
        const batches = groupIntoBatches(summaries, BATCH_CHAR_LIMIT);
        wf.chart.node("analyze", "按卷粗提取");
        wf.chart.edge("collect", "analyze", "派发");
        let completed = 0;
        const extractions = await wf.map(batches, async (batch, batchIndex) => {
            const volumeLabel = batch.volumeLabel || `批 ${batchIndex + 1}`;
            const nodeKey = `analyze-${batchIndex + 1}`;
            const agent = await wf.agents.create("adhoc", {
                initial: {
                    name: "结构提取员",
                    systemPrompt: [
                        "你是整书结构提取员。根据输入的逐章摘要，提取该卷出现的主线/支线、主要角色、世界观事实和尚未回收的钩子。",
                        "只提取摘要中有依据的内容，不虚构。角色只列有戏份的主要角色；世界观事实只列明确的设定。",
                        "完成后必须用 report_result 返回结构化 data。",
                    ].join(""),
                    outputSchema: VolumeExtractionSchema,
                },
                ...(model ? {model} : {}),
                ephemeral: true,
                tags: ["workflow:book-structure-extract", `batch:${batchIndex + 1}`],
            });
            wf.chart.node(nodeKey, volumeLabel);
            wf.chart.enter(nodeKey, {token: `batch-${batchIndex + 1}`, sessionId: agent.id});
            const response = await agent.invoke({
                message: [
                    `提取「${volumeLabel}」的结构提议。以下是对应章节的逐章摘要（{chapter, summary}）：`,
                    "",
                    batch.entries.map((entry) => `${entry.title}：${entry.summary}`).join("\n"),
                ].join("\n"),
            });
            if (response.status !== "completed") throw new Error(`「${volumeLabel}」结构提取未完成：${response.result.message}`);
            const extraction = response.result.data;
            if (!extraction || typeof extraction !== "object" || Array.isArray(extraction)) {
                throw new Error(`「${volumeLabel}」未按 outputSchema 返回 report_result.data`);
            }
            wf.chart.leave(nodeKey, {token: `batch-${batchIndex + 1}`});
            wf.chart.node("synthesize", "汇总去重");
            wf.chart.edge(nodeKey, "synthesize", "并入");
            wf.progress({phase: "analyze", done: ++completed, total: batches.length});
            return {volumeLabel, extraction};
        }, {concurrency: 2});

        // ── Phase 3: synthesize ──
        wf.progress({phase: "synthesize", done: batches.length, total: batches.length});
        const synthesizer = await wf.agents.create("adhoc", {
            initial: {
                name: "全书结构汇总员",
                systemPrompt: [
                    "你根据各卷的结构提取结果，合并去重成全书结构提议：主线/支线、主要角色、世界观事实、未回收钩子。",
                    "同名/同义条目只保留一条（角色名以正文中的主要用名为准）；次要信息并入相近条目而不是单列。",
                    "只基于输入提取结果推断，不虚构输入中不存在的情节。完成后必须用 report_result 返回结构化 data。",
                ].join(""),
                outputSchema: BookStructureSchema,
            },
            ...(model ? {model} : {}),
            ephemeral: true,
            tags: ["workflow:book-structure-extract", "role:synthesizer"],
        });
        wf.chart.move("analyze", "synthesize", {sessionId: synthesizer.id, label: "汇合"});
        const synthesizeRun = await synthesizer.invoke({
            message: `以下是全书 ${summaries.length} 章的分卷提取结果，请合并去重成全书提议：\n${JSON.stringify(extractions, null, 2)}`,
        });
        if (synthesizeRun.status !== "completed") throw new Error(`全书结构汇总未完成：${synthesizeRun.result.message}`);
        const structure = synthesizeRun.result.data;
        if (!structure || typeof structure !== "object" || Array.isArray(structure)) {
            throw new Error("汇总员未按 outputSchema 返回 report_result.data");
        }

        wf.chart.node("finish", "完成");
        wf.chart.move("synthesize", "finish", {label: "产出"});
        wf.chart.leave("finish");
        wf.log(`结构提取完成：${structure.threads.length} 条线、${structure.characters.length} 个角色、${structure.worldFacts.length} 条世界观、${structure.openHooks.length} 个钩子`);
        return {
            chapterCount: summaries.length,
            volumeBatches: extractions.length,
            structure,
        };
    },
};

/**
 * 按卷分组，卷内摘要超过 BATCH_CHAR_LIMIT 再切批。
 * 卷标签从 chapter path 的 `manuscript/{volume}/...` 形态提取；无卷结构时用「全书」。
 */
function groupIntoBatches(summaries: {path: string; title: string; summary: string}[], charLimit: number): {
    volumeLabel: string;
    entries: {title: string; summary: string}[];
}[] {
    const byVolume = new Map<string, {path: string; title: string; summary: string}[]>();
    for (const summary of summaries) {
        const volume = readVolumeLabel(summary.path);
        const list = byVolume.get(volume) ?? [];
        list.push(summary);
        byVolume.set(volume, list);
    }

    const batches: {volumeLabel: string; entries: {title: string; summary: string}[]}[] = [];
    for (const [volumeLabel, entries] of byVolume) {
        let current: {title: string; summary: string}[] = [];
        let currentChars = 0;
        for (const entry of entries) {
            const entryChars = entry.title.length + entry.summary.length;
            if (current.length > 0 && currentChars + entryChars > charLimit) {
                batches.push({volumeLabel, entries: current});
                current = [];
                currentChars = 0;
            }
            current.push({title: entry.title, summary: entry.summary});
            currentChars += entryChars;
        }
        if (current.length > 0) {
            batches.push({volumeLabel, entries: current});
        }
    }
    return batches;
}

/**
 * 从 chapter path 提取卷标签：`manuscript/001-volume/001-chapter/` → `001-volume`；
 * 无卷结构时回退「全书」。
 */
function readVolumeLabel(path: string): string {
    const normalized = path.replace(/^\/+|\/+$/g, "").split("/");
    if (normalized.length >= 3 && normalized[0] === "manuscript" && normalized[1]?.endsWith("-volume")) {
        return normalized[1];
    }
    return "全书";
}
