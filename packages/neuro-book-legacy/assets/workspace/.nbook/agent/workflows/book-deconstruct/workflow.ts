/**
 * 内置 workflow：拆书分析（商业拆书）。
 *
 * 读取导入的整本外部书稿（番茄导入目录或单个 .md 文件）→ 按一级标题切章并剔除书名页
 * → 章节采样（开头连续 + 中段均匀 + 结尾）→ adhoc 逐章并发拆解（钩子/承诺/爽点/节奏/信息披露/章末推力）
 * → adhoc 汇总产出拆书报告，供竞品分析与选题参考。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

const ChapterDeconstructSchema = Type.Object({
    hook: Type.String({description: "本章钩子与抓力：开头靠什么抓住读者继续读。"}),
    promises: Type.Array(Type.Object({
        action: Type.Union([Type.Literal("setup"), Type.Literal("advance"), Type.Literal("payoff")]),
        text: Type.String({description: "该承诺的内容描述。"}),
    }, {additionalProperties: false}), {description: "本章对读者承诺的建立(setup)/推进(advance)/兑现(payoff)；没有就返回空数组。"}),
    highlights: Type.Array(Type.String(), {description: "爽点/情绪释放点；没有就返回空数组。"}),
    pacing: Type.String({description: "节奏判断：快慢张弛、场景切换密度。"}),
    infoReveal: Type.String({description: "信息披露策略：藏了什么、露了什么、什么时机露。"}),
    endingPush: Type.String({description: "章末推力：结尾如何推动读者点开下一章。"}),
}, {additionalProperties: false});

const BookReportSchema = Type.Object({
    structure: Type.String({description: "整体结构脉络：开局-发展-高潮的骨架与阶段划分。"}),
    promiseRhythm: Type.String({description: "承诺-兑现节奏线：承诺何时建立、多久兑现、密度如何。"}),
    openingTechniques: Type.Array(Type.String(), {description: "开篇手法拆解。"}),
    borrowable: Type.Array(Type.String(), {description: "可借鉴的写法。"}),
    risks: Type.Array(Type.String(), {description: "风险/慎学之处。"}),
    summary: Type.String({description: "拆书总评，300 字以内。"}),
}, {additionalProperties: false});

export default {
    key: "book-deconstruct",
    title: "拆书分析",
    description: "对导入的整本外部小说做商业拆书：章节采样后逐章拆解钩子/承诺/爽点/节奏，再汇总成结构与手法报告，供竞品分析与选题参考。",
    whenToUse: "已有导入的外部书稿（番茄导入目录如 reference/tomato/{book_id}，或单个 .md 书稿文件）要做竞品拆书、结构与商业手法分析时使用；只问单章细节、书稿尚未导入、或要分析用户自己正在写的 manuscript 时不要使用（后者用 consistency-audit 或直接讨论）。",
    argsHint: [
        {name: "book", label: "书稿输入（番茄导入目录如 reference/tomato/{book_id}，或单个 .md 书稿文件路径；必填）", defaultValue: ""},
        {name: "focus", label: "分析侧重（可选，会拼进每章拆解指令，如：只关注开篇钩子与付费卡点）", defaultValue: ""},
        {name: "maxChapters", label: "最多拆解章数（1-24；超出时按开头5+结尾2+中段均匀采样）", defaultValue: "18"},
    ],
    phases: [
        {key: "collect", title: "读取与采样"},
        {key: "analyze", title: "逐章并发拆解"},
        {key: "synthesize", title: "汇总拆书报告"},
    ],
    run: async (wf, args) => {
        // book 是必填语义：空值在创建任何 agent 前直接失败
        const book = typeof args?.book === "string" ? args.book.trim() : "";
        if (!book) {
            throw new Error("必须提供 book 参数：番茄导入目录（如 reference/tomato/{book_id}）或单个 .md 书稿文件路径。");
        }
        const focus = typeof args?.focus === "string" ? args.focus.trim() : "";
        const maxChapters = Math.max(1, Math.min(Math.floor(Number(args?.maxChapters) || 18), 24));

        // ── Phase 1: collect ──
        wf.progress({phase: "collect"});
        wf.chart.node("collect", "读取与采样");
        wf.chart.enter("collect");

        // 输入判定：以 .md 结尾视为单文件书稿，否则视为番茄导入目录（读 metadata.json + full.md）
        const isFile = book.endsWith(".md");
        /** 番茄导入 metadata；null = 无 metadata（单文件输入，或目录下 metadata.json 缺失/解析失败） */
        let metadata = null;
        let raw = "";
        if (isFile) {
            try {
                raw = await wf.workspace.read(book);
            } catch (error) {
                throw new Error(`书稿读取失败：${book}（${error instanceof Error ? error.message : String(error)}）`);
            }
        } else {
            // metadata.json 是可选辅助信息：读不到或不是 JSON 对象都容错为无 metadata，不使 run 失败
            try {
                const parsed = JSON.parse(await wf.workspace.read(`${book}/metadata.json`));
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
            } catch {
                metadata = null;
            }
            // full.md 是正文唯一来源：读不到直接失败
            try {
                raw = await wf.workspace.read(`${book}/full.md`);
            } catch (error) {
                throw new Error(`书稿读取失败：${book}/full.md（${error instanceof Error ? error.message : String(error)}）`);
            }
        }
        if (!raw.trim()) throw new Error(`书稿为空：${book}`);

        // 切章：只按一级标题切。`\n(?=# )` 的 lookahead 要求 "#" 后紧跟一个空格，
        // 因此 "## "/"### " 等章内小标题（第二个字符还是 "#"）不会命中，不会把章切碎。
        const parts = raw.replace(/\r\n/gu, "\n").split(/\n(?=# )/u).filter((part) => part.trim().length > 0);
        const metaBookName = metadata && typeof metadata.book_name === "string" ? metadata.book_name.trim() : "";
        /** 书名页标题（首段被判为书名页并跳过时非空）：无 metadata 时作为 bookName 兜底 */
        let titlePageHeading = "";
        if (parts.length > 0) {
            const first = parts[0];
            const lineBreak = first.indexOf("\n");
            const heading = (lineBreak >= 0 ? first.slice(0, lineBreak) : first).replace(/^#+\s*/u, "").trim();
            const body = lineBreak >= 0 ? first.slice(lineBreak + 1) : "";
            // 书名页判定（只看首段）：标题与 metadata.book_name 相同，或去标题后正文太短（<50 字符）不构成一章
            if ((metaBookName !== "" && heading === metaBookName) || body.trim().length < 50) {
                titlePageHeading = heading;
                parts.shift();
            }
        }
        const chapters = parts.map((text, index) => ({
            // 1-based 章节序号（书名页已剔除），采样后仍指回原书章节位置
            index: index + 1,
            title: (text.split("\n")[0] || `第 ${index + 1} 章`).replace(/^#+\s*/u, "").trim().slice(0, 60),
            text,
        }));
        if (chapters.length === 0) throw new Error(`书稿切不出任何章节（只按一级标题 "# " 切分）：${book}`);
        const bookName = metaBookName || titlePageHeading || "";

        // 采样：章节数超预算时取「开头连续 5 章 + 结尾 2 章 + 中段均匀抽取」，输出保持原文顺序
        const total = chapters.length;
        let sampled = chapters;
        if (total > maxChapters) {
            const headCount = Math.min(5, maxChapters);
            const tailCount = Math.min(2, maxChapters - headCount);
            const middleQuota = maxChapters - headCount - tailCount;
            const middleCandidates = chapters.slice(headCount, total - tailCount);
            const middle = [];
            for (let i = 0; i < middleQuota; i++) {
                // 居中均匀取样：取候选区间 (2i+1)/(2*quota) 比例位置。total > maxChapters 保证
                // candidates.length >= quota，相邻取样点间隔 >= 1，下标严格递增不重复；纯整数运算保持确定性
                middle.push(middleCandidates[Math.floor(((2 * i + 1) * middleCandidates.length) / (2 * middleQuota))]);
            }
            sampled = [...chapters.slice(0, headCount), ...middle, ...(tailCount > 0 ? chapters.slice(total - tailCount) : [])];
        }
        wf.log(`读取 ${book}：共 ${total} 章，采样 ${sampled.length} 章，丢弃 ${total - sampled.length} 章；采样清单：${sampled.map((chapter) => chapter.title).join("、")}`);

        // ── Phase 2: analyze ──
        wf.progress({phase: "analyze", done: 0, total: sampled.length});
        let completed = 0;
        const perChapter = await wf.map(sampled, async (chapter) => {
            const token = `chapter-${chapter.index}`;
            const nodeKey = `analyze-${chapter.index}`;
            const analyst = await wf.agents.create("adhoc", {
                initial: {
                    name: "章节拆书员",
                    systemPrompt: "你是商业网文拆书员，只分析调用方提供的章节正文，从读者体验出发拆解钩子、承诺、爽点、节奏、信息披露与章末推力。结论必须能在正文中找到依据，不虚构正文中不存在的情节。完成后必须用 report_result 返回结构化 data。",
                    outputSchema: ChapterDeconstructSchema,
                },
                ephemeral: true,
                tags: ["workflow:book-deconstruct", token],
            });
            wf.chart.node(nodeKey, `拆解：${chapter.title}`);
            wf.chart.edge("collect", nodeKey, "派发");
            wf.chart.enter(nodeKey, {token, sessionId: analyst.id});
            const response = await analyst.invoke({
                message: [
                    `拆解章节「${chapter.title}」。按已声明 schema 汇报钩子、承诺（setup/advance/payoff）、爽点、节奏、信息披露策略与章末推力。`,
                    ...(focus ? ["", `分析侧重：${focus}`] : []),
                    "",
                    chapter.text.slice(0, 8000),
                ].join("\n"),
            });
            if (response.status !== "completed") throw new Error(`章节「${chapter.title}」拆解未完成：${response.result.message}`);
            const analysis = response.result.data;
            if (!analysis || typeof analysis !== "object" || Array.isArray(analysis)) {
                throw new Error(`章节「${chapter.title}」拆书员未按 outputSchema 返回 report_result.data`);
            }
            if (typeof analysis.hook !== "string" || !Array.isArray(analysis.promises) || !Array.isArray(analysis.highlights)
                || typeof analysis.pacing !== "string" || typeof analysis.infoReveal !== "string" || typeof analysis.endingPush !== "string") {
                throw new Error(`章节「${chapter.title}」拆解结果缺少 hook/promises/highlights/pacing/infoReveal/endingPush 关键字段`);
            }
            wf.chart.leave(nodeKey, {token});
            wf.chart.node("synthesize", "汇总拆书报告");
            wf.chart.edge(nodeKey, "synthesize", "并入");
            wf.progress({phase: "analyze", done: ++completed, total: sampled.length});
            return {index: chapter.index, title: chapter.title, analysis};
        }, {concurrency: 3});

        // ── Phase 3: synthesize ──
        wf.progress({phase: "synthesize", done: sampled.length, total: sampled.length});
        const synthesizer = await wf.agents.create("adhoc", {
            initial: {
                name: "拆书报告汇总员",
                systemPrompt: "你根据逐章拆书结果汇总整本书的结构脉络、承诺-兑现节奏、开篇手法、可借鉴写法与风险，供竞品分析与选题参考。只基于输入的逐章结果推断，不虚构输入中不存在的情节。完成后必须用 report_result 返回结构化 data。",
                outputSchema: BookReportSchema,
            },
            ephemeral: true,
            tags: ["workflow:book-deconstruct", "role:synthesizer"],
        });
        wf.chart.move("collect", "synthesize", {sessionId: synthesizer.id, label: "汇合"});
        // 汇总输入用字段级摘要而不是完整 JSON.stringify：最多 24 章的完整 JSON 容易超长且带语法噪音，
        // 摘要逐字段拼接保留全部分析内容，总长再兜底 clamp
        const digest = perChapter.map((entry) => [
            `## 第 ${entry.index} 章 ${entry.title}`,
            `钩子：${entry.analysis.hook}`,
            `承诺：${entry.analysis.promises.map((promise) => `[${promise.action}] ${promise.text}`).join("；") || "（无）"}`,
            `爽点：${entry.analysis.highlights.join("；") || "（无）"}`,
            `节奏：${entry.analysis.pacing}`,
            `信息披露：${entry.analysis.infoReveal}`,
            `章末推力：${entry.analysis.endingPush}`,
        ].join("\n")).join("\n\n").slice(0, 20000);
        const reportRun = await synthesizer.invoke({
            message: [
                `汇总拆书报告：书名「${bookName || "（未知）"}」，全书 ${total} 章，本次采样拆解 ${sampled.length} 章。请根据以下逐章拆解结果按已声明 schema 汇报。`,
                ...(focus ? [`分析侧重：${focus}`] : []),
                "",
                digest,
            ].join("\n"),
        });
        if (reportRun.status !== "completed") throw new Error(`拆书报告汇总未完成：${reportRun.result.message}`);
        const report = reportRun.result.data;
        if (!report || typeof report !== "object" || Array.isArray(report)) {
            throw new Error("拆书汇总员未按 outputSchema 返回 report_result.data");
        }
        if (typeof report.structure !== "string" || typeof report.summary !== "string"
            || !Array.isArray(report.openingTechniques) || !Array.isArray(report.borrowable) || !Array.isArray(report.risks)) {
            throw new Error("拆书报告缺少 structure/summary/openingTechniques/borrowable/risks 关键字段");
        }

        wf.chart.node("final", "拆书完成");
        wf.chart.move("synthesize", "final", {label: "产出"});
        wf.chart.leave("final");
        wf.log(`拆书完成：「${bookName || book}」共 ${total} 章，拆解 ${sampled.length} 章`);
        return {
            book,
            bookName,
            totalChapters: total,
            sampledChapters: sampled.map((chapter) => ({index: chapter.index, title: chapter.title})),
            perChapter,
            report,
        };
    },
};
