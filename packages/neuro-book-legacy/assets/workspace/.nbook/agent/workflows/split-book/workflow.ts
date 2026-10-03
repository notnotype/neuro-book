/**
 * 内置 workflow：拆书。
 *
 * 读取书稿 → adhoc 逐章并发摘要 → adhoc 剧情合并分析 → 返回结构化结果。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

const ChapterBriefSchema = Type.Object({
    summary: Type.String({description: "本章一句话概括。"}),
    events: Type.Array(Type.String(), {description: "按发生顺序排列的关键事件。"}),
    characters: Type.Array(Type.String(), {description: "本章实际出场人物。"}),
}, {additionalProperties: false});

const BookAnalysisSchema = Type.Object({
    theme: Type.String({description: "整体主题。"}),
    genre: Type.String({description: "作品类型判断。"}),
    plotStages: Type.Array(Type.String(), {description: "剧情主线与阶段划分。"}),
    characterArcs: Type.Array(Type.String(), {description: "主要人物弧线。"}),
    openHooks: Type.Array(Type.String(), {description: "伏笔、悬念或尚未回收的钩子。"}),
}, {additionalProperties: false});

export default {
    key: "split-book",
    title: "拆书",
    description: "读取书稿文件，逐章并发提取结构化摘要，再合并分析剧情结构。",
    whenToUse: "用户想拆解或分析一本 Project Workspace 书稿的章节结构与剧情脉络时；没有明确书稿路径或只问单章细节时不要使用。",
    argsHint: [
        {name: "path", label: "书稿路径（Project Workspace 相对路径）", defaultValue: "manuscript/book.md"},
        {name: "maxChapters", label: "最多处理章数", defaultValue: "8"},
    ],
    phases: [
        {key: "read", title: "读取并切章"},
        {key: "brief", title: "逐章并发摘要"},
        {key: "analyze", title: "剧情合并分析"},
    ],
    run: async (wf, args) => {
        const path = typeof args?.path === "string" && args.path.trim()
            ? args.path.trim()
            : "manuscript/book.md";
        const maxChapters = Math.max(1, Math.min(Math.floor(Number(args?.maxChapters) || 8), 30));

        wf.progress({phase: "read"});
        wf.chart.node("read", "读取书稿");
        wf.chart.enter("read");
        const raw = await wf.workspace.read(path);
        if (!raw.trim()) {
            throw new Error(`书稿为空：${path}`);
        }
        let parts = raw.split(/\n(?=#{1,3}\s)/u).filter((part) => part.trim().length > 0);
        if (parts.length <= 1) parts = raw.split(/\n-{3,}\n/u).filter((part) => part.trim().length > 0);
        const dropped = Math.max(0, parts.length - maxChapters);
        const chapters = parts.slice(0, maxChapters).map((text, index) => ({
            id: `ch${index + 1}`,
            heading: (text.split("\n")[0] || `第 ${index + 1} 段`).replace(/^#+\s*/u, "").slice(0, 40),
            text,
        }));
        if (chapters.length === 0) {
            throw new Error(`书稿没有可分析的章节：${path}`);
        }
        wf.log(`读取 ${path}：切出 ${parts.length} 章，处理 ${chapters.length} 章${dropped > 0 ? `，跳过 ${dropped} 章` : ""}`);

        wf.progress({phase: "brief", done: 0, total: chapters.length});
        let completed = 0;
        const briefs = await wf.map(chapters, async (chapter) => {
            const agent = await wf.agents.create("adhoc", {
                initial: {
                    name: "章节摘要员",
                    systemPrompt: "你只分析调用方提供的小说章节正文，准确提取摘要、关键事件和出场人物，不补写正文中不存在的信息。完成后必须用 report_result 返回结构化 data。",
                    outputSchema: ChapterBriefSchema,
                },
                ephemeral: true,
                tags: ["workflow:split-book", `chapter:${chapter.id}`],
            });
            const nodeKey = `brief-${chapter.id}`;
            wf.chart.node(nodeKey, `${chapter.id} ${chapter.heading}`);
            wf.chart.edge("read", nodeKey, "派发");
            wf.chart.enter(nodeKey, {token: chapter.id, sessionId: agent.id});
            const response = await agent.invoke({
                message: [
                    `分析章节「${chapter.heading}」，直接按已声明 schema 汇报。`,
                    "",
                    chapter.text.slice(0, 6000),
                ].join("\n"),
            });
            if (response.status !== "completed") throw new Error(`章节 ${chapter.id} 摘要未完成：${response.result.message}`);
            const brief = response.result.data;
            if (!brief || typeof brief !== "object" || Array.isArray(brief)) {
                throw new Error(`章节 ${chapter.id} 未按 outputSchema 返回 report_result.data`);
            }
            wf.chart.leave(nodeKey, {token: chapter.id});
            wf.chart.node("analyze", "剧情合并分析");
            wf.chart.edge(nodeKey, "analyze", "并入");
            wf.progress({phase: "brief", done: ++completed, total: chapters.length});
            return {chapter: chapter.id, heading: chapter.heading, brief};
        }, {concurrency: 3});

        wf.progress({phase: "analyze", done: chapters.length, total: chapters.length});
        const analyst = await wf.agents.create("adhoc", {
            initial: {
                name: "全书结构分析员",
                systemPrompt: "你根据逐章结构化摘要分析整本书的主题、类型、剧情阶段、人物弧线和未回收钩子。不得虚构摘要中没有的情节。完成后必须用 report_result 返回结构化 data。",
                outputSchema: BookAnalysisSchema,
            },
            ephemeral: true,
            tags: ["workflow:split-book", "role:analyst"],
        });
        wf.chart.move("read", "analyze", {sessionId: analyst.id, label: "汇合"});
        const analysisRun = await analyst.invoke({
            message: `请分析以下逐章摘要，按已声明 schema 汇报：\n${JSON.stringify(briefs, null, 2)}`,
        });
        if (analysisRun.status !== "completed") throw new Error(`全书结构分析未完成：${analysisRun.result.message}`);
        const analysis = analysisRun.result.data;
        if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
            throw new Error("全书分析员未按 outputSchema 返回 report_result.data");
        }

        wf.chart.node("finish", "完成");
        wf.chart.move("analyze", "finish", {label: "产出"});
        wf.chart.leave("finish");
        wf.log("拆书完成");
        return {path, chapterCount: chapters.length, briefs, analysis};
    },
};
