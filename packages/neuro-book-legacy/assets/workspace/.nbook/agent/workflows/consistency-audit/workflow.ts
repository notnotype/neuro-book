/**
 * 内置 workflow：一致性审计。
 *
 * 收集章节正文与审计基准（lorebook 摘录 + leader 预查的 World Engine 事实清单）
 * → adhoc 逐章并发审计（位置/伤势/物品/认知/时间线/设定矛盾）
 * → adhoc 汇总跨章比对，产出结构化审计报告。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

/** 矛盾类别：位置 / 伤势 / 物品 / 认知（谁知道什么）/ 时间线 / 与 lorebook 设定冲突 */
const IssueKindSchema = Type.Union([
    Type.Literal("location"),
    Type.Literal("injury"),
    Type.Literal("item"),
    Type.Literal("knowledge"),
    Type.Literal("timeline"),
    Type.Literal("lorebook"),
]);

const ChapterAuditSchema = Type.Object({
    facts: Type.Array(Type.String(), {description: "本章确立的关键事实，供跨章比对：谁在哪、伤势、持有物、谁知道什么、时间标记。"}),
    issues: Type.Array(Type.Object({
        kind: IssueKindSchema,
        severity: Type.Union([Type.Literal("major"), Type.Literal("minor")]),
        quote: Type.String({description: "出问题处的原文引句。"}),
        explanation: Type.String({description: "矛盾在哪里，与哪条基准或事实冲突。"}),
        suggestion: Type.String({description: "具体修改建议。"}),
    }, {additionalProperties: false}), {description: "本章内部或与审计基准冲突的矛盾；没有就返回空数组。"}),
}, {additionalProperties: false});

const CrossAuditSchema = Type.Object({
    summary: Type.String({description: "整体一致性结论，200 字以内。"}),
    crossChapterIssues: Type.Array(Type.Object({
        chapters: Type.Array(Type.String(), {description: "涉及的章节路径。"}),
        kind: IssueKindSchema,
        explanation: Type.String({description: "跨章矛盾说明：哪两处事实互相冲突。"}),
        suggestion: Type.String({description: "具体修改建议。"}),
    }, {additionalProperties: false}), {description: "只放跨章矛盾，单章内部问题已在逐章 issues 里。"}),
    verdict: Type.Union([Type.Literal("clean"), Type.Literal("minor-only"), Type.Literal("has-major")]),
}, {additionalProperties: false});

export default {
    key: "consistency-audit",
    title: "一致性审计",
    description: "对一批章节正文做一致性审计：对照 lorebook 摘录与世界状态事实清单逐章找矛盾，再跨章比对，产出结构化审计报告。",
    whenToUse: "用户想检查多章正文之间、正文与设定之间是否存在位置/伤势/物品/认知/时间线矛盾时使用；只写新内容、只问单条设定、或想做风格与文笔评审时不要使用。",
    argsHint: [
        {name: "chapterPaths", label: "章节路径（逗号或换行分隔，Project Workspace 相对路径；留空则尝试从 manuscript/index.md 提取）", defaultValue: ""},
        {name: "lorebookPaths", label: "lorebook 设定文件路径（逗号或换行分隔，可留空）", defaultValue: ""},
        {name: "worldFacts", label: "世界状态事实清单（leader 预先用 execute_world 查好的文本，可留空）", defaultValue: ""},
        {name: "maxChapters", label: "最多审计章数（1-20）", defaultValue: "12"},
    ],
    phases: [
        {key: "collect", title: "收集章节与审计基准"},
        {key: "audit", title: "逐章并发审计"},
        {key: "merge", title: "跨章汇总"},
    ],
    run: async (wf, args) => {
        /** 解析逗号/换行分隔字符串或数组为去重后的路径清单（数组/字符串双形态） */
        const parsePaths = (value) => {
            const raw = Array.isArray(value)
                ? value
                : typeof value === "string"
                    ? value.split(/[,，\n]/u)
                    : [];
            return raw
                .filter((item) => typeof item === "string")
                .map((item) => item.trim())
                .filter((item, index, all) => item.length > 0 && all.indexOf(item) === index);
        };
        const maxChapters = Math.max(1, Math.min(Math.floor(Number(args?.maxChapters) || 12), 20));

        // ── Phase 1: collect ──
        wf.progress({phase: "collect"});
        wf.chart.node("collect", "收集章节与审计基准");
        wf.chart.enter("collect");

        let chapterPaths = parsePaths(args?.chapterPaths);
        if (chapterPaths.length === 0) {
            // 兜底：从 manuscript/index.md 提取章节路径；提取不出任何路径就在创建任何 agent 前失败
            let indexText = "";
            try {
                indexText = await wf.workspace.read("manuscript/index.md");
            } catch {
                indexText = "";
            }
            const found = [];
            // 形态一：完整的 manuscript/.../index.md 路径
            for (const match of indexText.matchAll(/manuscript\/[^\s()"'`\]]+\/index\.md/gu)) {
                found.push(match[0]);
            }
            // 形态二：NNN-volume/NNN-chapter 形式，规范化为 manuscript 下的 index.md
            for (const match of indexText.matchAll(/(\d{3}-[^\s/()"'`\]]+)\/(\d{3}-[^\s/()"'`\]]+)/gu)) {
                found.push(`manuscript/${match[1]}/${match[2]}/index.md`);
            }
            chapterPaths = found.filter((path, index, all) => all.indexOf(path) === index);
            if (chapterPaths.length === 0) {
                throw new Error("未提供 chapterPaths，且无法从 manuscript/index.md 提取任何章节路径；请先用 bash 列出章节文件路径，再通过 chapterPaths 参数传入。");
            }
            wf.log(`chapterPaths 为空，从 manuscript/index.md 提取到 ${chapterPaths.length} 个章节路径`);
        }
        if (chapterPaths.length > maxChapters) {
            wf.log(`章节数 ${chapterPaths.length} 超过上限 ${maxChapters}，丢弃后 ${chapterPaths.length - maxChapters} 章`);
            chapterPaths = chapterPaths.slice(0, maxChapters);
        }

        // 逐章读正文：章节路径是显式输入，读不到直接失败，不做容错
        const chapters = [];
        for (const path of chapterPaths) {
            let text = "";
            try {
                text = await wf.workspace.read(path);
            } catch (error) {
                throw new Error(`章节读取失败：${path}（${error instanceof Error ? error.message : String(error)}）`);
            }
            if (!text.trim()) throw new Error(`章节正文为空：${path}`);
            chapters.push({path, text: text.slice(0, 8000)});
        }

        // lorebook 摘录：可选输入，逐个 try/catch 容错；读不到或内容为空的记入 skippedLorebook，不使 run 失败
        const lorebookPaths = parsePaths(args?.lorebookPaths);
        const lorebookExcerpts = [];
        const skippedLorebook = [];
        for (const path of lorebookPaths) {
            try {
                const text = await wf.workspace.read(path);
                if (!text.trim()) {
                    skippedLorebook.push(path);
                    continue;
                }
                lorebookExcerpts.push(`【${path}】\n${text.slice(0, 3000)}`);
            } catch {
                skippedLorebook.push(path);
            }
        }

        // 审计基准：lorebook 摘录 + leader 预查的世界状态事实清单，总长再 clamp
        const worldFacts = typeof args?.worldFacts === "string" ? args.worldFacts.trim() : "";
        const baselineParts = [];
        if (lorebookExcerpts.length > 0) baselineParts.push(`## lorebook 设定摘录\n\n${lorebookExcerpts.join("\n\n---\n\n")}`);
        if (worldFacts) baselineParts.push(`## 世界状态事实清单\n\n${worldFacts}`);
        const baseline = (baselineParts.join("\n\n") || "（本次审计没有额外设定基准，只做章节内部与跨章一致性检查。）").slice(0, 12000);
        wf.log(`收集完成：${chapters.length} 章待审，lorebook 摘录 ${lorebookExcerpts.length} 条${skippedLorebook.length > 0 ? `，跳过 ${skippedLorebook.length} 条` : ""}${worldFacts ? "，含世界状态事实清单" : ""}`);

        // ── Phase 2: audit ──
        wf.progress({phase: "audit", done: 0, total: chapters.length});
        let completed = 0;
        const audits = await wf.map(chapters, async (chapter, index) => {
            const token = `chapter-${index + 1}`;
            const nodeKey = `audit-${index + 1}`;
            const auditor = await wf.agents.create("adhoc", {
                initial: {
                    name: "章节一致性审计员",
                    systemPrompt: "你是小说一致性审计员，只对照调用方给出的审计基准与本章正文，找位置、伤势、物品、认知、时间线和设定矛盾。只报有把握的矛盾并引用原文，没有矛盾就返回空 issues；不要报风格、文笔或主观喜好问题，不要虚构正文中不存在的内容。完成后必须用 report_result 返回结构化 data。",
                    outputSchema: ChapterAuditSchema,
                },
                ephemeral: true,
                tags: ["workflow:consistency-audit", token],
            });
            wf.chart.node(nodeKey, `审计：${chapter.path}`);
            wf.chart.edge("collect", nodeKey, "派发");
            wf.chart.enter(nodeKey, {token, sessionId: auditor.id});
            const response = await auditor.invoke({
                message: [
                    `审计章节「${chapter.path}」的一致性，按已声明 schema 汇报：facts 提取本章确立的关键事实（谁在哪/伤势/持有物/谁知道什么/时间标记），issues 只报本章与审计基准或本章内部有把握的矛盾，没有就返回空数组，不要为了凑数报风格问题。`,
                    "",
                    "# 审计基准",
                    baseline,
                    "",
                    "# 本章正文",
                    chapter.text,
                ].join("\n"),
            });
            if (response.status !== "completed") throw new Error(`章节「${chapter.path}」审计未完成：${response.result.message}`);
            const audit = response.result.data;
            if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
                throw new Error(`章节「${chapter.path}」审计员未按 outputSchema 返回 report_result.data`);
            }
            if (!Array.isArray(audit.facts) || !Array.isArray(audit.issues)) {
                throw new Error(`章节「${chapter.path}」审计结果缺少 facts/issues 数组`);
            }
            wf.chart.leave(nodeKey, {token});
            wf.chart.node("merge", "跨章汇总");
            wf.chart.edge(nodeKey, "merge", "并入");
            wf.progress({phase: "audit", done: ++completed, total: chapters.length});
            return {chapter: chapter.path, facts: audit.facts, issues: audit.issues};
        }, {concurrency: 3});

        // ── Phase 3: merge ──
        wf.progress({phase: "merge", done: chapters.length, total: chapters.length});
        const merger = await wf.agents.create("adhoc", {
            initial: {
                name: "跨章一致性汇总员",
                systemPrompt: "你根据各章审计员提取的事实与矛盾做跨章比对，只报不同章节事实之间有把握的矛盾，不复述单章内部问题，不虚构输入中不存在的事实，并给出整体结论。完成后必须用 report_result 返回结构化 data。",
                outputSchema: CrossAuditSchema,
            },
            ephemeral: true,
            tags: ["workflow:consistency-audit", "role:merger"],
        });
        wf.chart.move("collect", "merge", {sessionId: merger.id, label: "汇合"});
        const mergeRun = await merger.invoke({
            message: `汇总一致性审计结果，跨章比对以下各章事实与矛盾，按已声明 schema 汇报（verdict：无矛盾=clean，只有 minor=minor-only，存在 major 或跨章矛盾=has-major）：\n${JSON.stringify(audits, null, 2)}`,
        });
        if (mergeRun.status !== "completed") throw new Error(`跨章汇总未完成：${mergeRun.result.message}`);
        const merged = mergeRun.result.data;
        if (!merged || typeof merged !== "object" || Array.isArray(merged)) {
            throw new Error("跨章汇总员未按 outputSchema 返回 report_result.data");
        }
        if (typeof merged.summary !== "string" || !Array.isArray(merged.crossChapterIssues)
            || !["clean", "minor-only", "has-major"].includes(merged.verdict)) {
            throw new Error("跨章汇总结果缺少 summary/crossChapterIssues/verdict 关键字段");
        }

        wf.chart.node("final", "审计完成");
        wf.chart.move("merge", "final", {label: "产出"});
        wf.chart.leave("final");
        wf.log(`一致性审计完成：${chapters.length} 章，结论 ${merged.verdict}`);
        return {
            chapterCount: chapters.length,
            auditedChapters: audits.map((audit) => ({path: audit.chapter, factCount: audit.facts.length, issues: audit.issues})),
            skippedLorebook,
            crossChapterIssues: merged.crossChapterIssues,
            verdict: merged.verdict,
            summary: merged.summary,
        };
    },
};
