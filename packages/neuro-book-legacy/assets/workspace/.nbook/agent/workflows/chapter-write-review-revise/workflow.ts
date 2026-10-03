/**
 * 内置 workflow：章级写作评审循环（写 → 多维评审 → 修订）。
 *
 * 由真实 `writer` profile 按 Leader-Writer 契约把章节写进目标 index.md，
 * 三个临时评审维度（一致性 / 节奏 / 文风）每轮并发挑问题，
 * writer 使用新的 prompt 按 major 问题清单修订，直到无 major 问题或到达轮数上限。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

/** 单维度评审结构化输出：整体评价 + 分级问题清单。 */
const ReviewSchema = Type.Object({
    overall: Type.String({description: "该维度的整体评价，一到三句话。"}),
    issues: Type.Array(Type.Object({
        severity: Type.Union([
            Type.Literal("major"),
            Type.Literal("minor"),
        ], {description: "major=必须修订才能交付的问题；minor=可选优化建议。"}),
        problem: Type.String({description: "具体问题，引用正文证据，不泛泛而谈。"}),
        revision: Type.String({description: "可直接执行的修改建议。"}),
    }, {additionalProperties: false})),
}, {additionalProperties: false});

/**
 * 三个评审维度。key 同时用作 chart node/token 后缀；
 * messagePrefix 是每轮 message 的固定可判别开头（测试 mock 按它分流）。
 */
const REVIEW_DIMENSIONS = [
    {
        key: "consistency",
        title: "剧情一致性与信息边界",
        messagePrefix: "你是章节评审（一致性）。",
        systemPrompt: "你只评审章节正文的剧情一致性与信息边界：关键剧情点是否全部覆盖、角色是否知道了他不该知道的信息、是否与写作任务（brief）冲突或有超出任务的自由发挥。只指出有正文证据的问题，不代写全文。完成后必须用 report_result 返回结构化 data。",
    },
    {
        key: "pacing",
        title: "节奏与钩子",
        messagePrefix: "你是章节评审（节奏）。",
        systemPrompt: "你只评审章节正文的节奏与钩子：开头是否有抓力、中段推进是否拖沓或跳脱、章末是否留下有效钩子。只指出有正文证据的问题，不代写全文。完成后必须用 report_result 返回结构化 data。",
    },
    {
        key: "style",
        title: "文风与 AI 味",
        messagePrefix: "你是章节评审（文风）。",
        systemPrompt: "你只评审章节正文的文风与 AI 痕迹：重复句式、标签化情绪描写、翻译腔、总结式收尾等明显 AI 味。只指出有正文证据的问题，不代写全文。完成后必须用 report_result 返回结构化 data。",
    },
];

/** 每次贴给评审的正文截断长度（章节正文比拆书摘要长，放宽到 12000）。 */
const BODY_SLICE = 12000;

export default {
    key: "chapter-write-review-revise",
    title: "章级写作评审循环",
    description: "调用真实 writer profile 写章节正文到目标文件，三个评审维度并发挑问题，writer 按 major 问题修订，循环至收敛或到达轮数上限。",
    whenToUse: "本章剧情事实已确认、World Engine 已推进，需要把某个章节 index.md 写成正文并做多维评审修订时使用；剧情事实未确认、目标章节节点还不存在、或只是打磨简介/文案等不落文件的短文（应使用 write-review-loop）时不要使用。",
    argsHint: [
        {name: "chapterPath", label: "章节 index.md 路径（Project Workspace 相对路径，必填）", defaultValue: ""},
        {name: "brief", label: "本章写作任务（目标/关键剧情点/信息控制/World Engine 查询提示）", defaultValue: ""},
        {name: "chapterId", label: "StoryChapter id（可选，writer 会自取本章 brief）", defaultValue: ""},
        {name: "lorebookEntries", label: "建议读取的内容节点路径（逗号或换行分隔，可选）", defaultValue: ""},
        {name: "reviewRounds", label: "评审轮数（1-3）", defaultValue: "2"},
        {name: "revise", label: "是否按评审修订（false 时只写+评审一轮）", defaultValue: "true"},
    ],
    phases: [
        {key: "write", title: "写作正文"},
        {key: "review", title: "多维评审"},
        {key: "revise", title: "按评审修订"},
        {key: "finalize", title: "定稿"},
    ],
    run: async (wf, args) => {
        // —— args 归一化：全部按字符串防御性解析，容忍数组形态 ——
        const chapterPath = typeof args?.chapterPath === "string" ? args.chapterPath.trim() : "";
        if (!chapterPath) {
            throw new Error("缺少 chapterPath：请传章节 index.md 的 Project Workspace 相对路径，例如 manuscript/001-volume/001-chapter/index.md");
        }
        const brief = typeof args?.brief === "string" ? args.brief.trim() : "";
        const chapterId = typeof args?.chapterId === "string" ? args.chapterId.trim() : "";
        if (!brief && !chapterId) {
            throw new Error("缺少写作任务：brief 与 chapterId 至少传一个（brief 传本章写作任务正文，或传 chapterId 让 writer 用 get_chapter_writer_brief 自取）");
        }
        const rawEntries = Array.isArray(args?.lorebookEntries)
            ? args.lorebookEntries
            : typeof args?.lorebookEntries === "string"
                ? args.lorebookEntries.split(/[,，\n]/u)
                : [];
        const lorebookEntries = rawEntries
            .filter((entry) => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
        const reviewRounds = Math.max(1, Math.min(Math.floor(Number(args?.reviewRounds) || 2), 3));
        // revise 默认开启；显式 false / "false" 时只写+评审一轮，不做修订。
        const reviseEnabled = !(args?.revise === false || (typeof args?.revise === "string" && args.revise.trim() === "false"));

        // —— write：真实 writer profile 写正文（非 ephemeral，让会话可追溯） ——
        wf.progress({phase: "write"});
        const writer = await wf.agents.create("writer", {
            initial: {},
            tags: ["workflow:chapter-write-review-revise", "role:writer"],
            ephemeral: false,
        });
        wf.chart.node("write", "写作正文");
        wf.chart.enter("write", {sessionId: writer.id});

        // writer 的 invoke 合同：message 承载 brief，input 承载 {path, chapterId?, context?}。
        const writerInput = {path: chapterPath};
        if (chapterId) writerInput.chapterId = chapterId;
        if (lorebookEntries.length > 0) writerInput.context = {lorebookEntries};
        const writeRun = await writer.invoke({
            message: brief
                ? `请完成章节写作任务，正文写入 input.path 指定的章节文件。\n\n${brief}`
                : "请完成章节写作任务，正文写入 input.path 指定的章节文件。本章 brief 请用 get_chapter_writer_brief 按 input.chapterId 自取。",
            input: writerInput,
        });
        if (writeRun.status !== "completed") throw new Error(`writer 未完成章节写作：${writeRun.result.message}`);
        const writeData = writeRun.result.data;
        if (!writeData || typeof writeData !== "object" || Array.isArray(writeData) || typeof writeData.summary !== "string") {
            throw new Error("writer 未按 output contract 返回 summary");
        }
        let finalSummary = writeData.summary;
        wf.log(`章节写作完成：${chapterPath}`);

        // —— review / revise 循环 ——
        let currentNode = "write";
        const rounds = [];
        let converged = false;
        for (let round = 1; round <= reviewRounds; round++) {
            wf.progress({phase: "review", done: round - 1, total: reviewRounds});
            // 每轮重读当前正文：修订轮后文件内容已变化，评审必须拿最新全文。
            let body;
            try {
                body = await wf.workspace.read(chapterPath);
            } catch (error) {
                throw new Error(`读取章节正文失败：${chapterPath}（${error instanceof Error ? error.message : String(error)}）`);
            }
            if (!body.trim()) {
                throw new Error(`章节正文为空：${chapterPath}，writer 可能没有写入目标文件`);
            }

            // 三个维度并发评审：每轮新建 ephemeral adhoc，避免跨轮 followup 复杂度。
            const reviews = await wf.map(REVIEW_DIMENSIONS, async (dimension) => {
                const reviewer = await wf.agents.create("adhoc", {
                    initial: {
                        name: `章节评审（${dimension.title}）`,
                        systemPrompt: dimension.systemPrompt,
                        outputSchema: ReviewSchema,
                    },
                    tags: ["workflow:chapter-write-review-revise", `review:${dimension.key}`],
                    ephemeral: true,
                });
                const nodeKey = `review-${dimension.key}`;
                wf.chart.node(nodeKey, `评审：${dimension.title}`);
                wf.chart.edge(currentNode, nodeKey, "交稿");
                wf.chart.enter(nodeKey, {token: dimension.key, sessionId: reviewer.id});
                const reviewRun = await reviewer.invoke({
                    message: [
                        `${dimension.messagePrefix}评审第 ${round} 轮章节正文，按已声明 schema 汇报。`,
                        brief ? `【写作任务】\n${brief}` : `【写作任务】\n本章按 StoryChapter ${chapterId} 的 brief 写作。`,
                        `【章节正文】\n${body.slice(0, BODY_SLICE)}`,
                    ].join("\n\n"),
                });
                if (reviewRun.status !== "completed") {
                    throw new Error(`评审（${dimension.title}）未完成第 ${round} 轮：${reviewRun.result.message}`);
                }
                const review = reviewRun.result.data;
                if (!review || typeof review !== "object" || Array.isArray(review)
                    || typeof review.overall !== "string" || !Array.isArray(review.issues)) {
                    throw new Error(`评审（${dimension.title}）未按 outputSchema 返回第 ${round} 轮 data`);
                }
                for (const issue of review.issues) {
                    if (!issue || typeof issue !== "object" || Array.isArray(issue)
                        || (issue.severity !== "major" && issue.severity !== "minor")
                        || typeof issue.problem !== "string" || typeof issue.revision !== "string") {
                        throw new Error(`评审（${dimension.title}）第 ${round} 轮 issues 结构不符合 outputSchema`);
                    }
                }
                wf.chart.leave(nodeKey, {token: dimension.key});
                wf.chart.node("gate", "收敛判断");
                wf.chart.edge(nodeKey, "gate", "并入");
                return {dimension: dimension.key, overall: review.overall, issues: review.issues};
            }, {concurrency: 3});
            wf.chart.move(currentNode, "gate", {label: `第 ${round} 轮收敛判断`});
            currentNode = "gate";

            // roundRecord.revisionSummary：仅当本轮触发修订时非空，记录 writer 的修订摘要。
            const roundRecord = {round, reviews};
            rounds.push(roundRecord);
            const allIssues = reviews.flatMap((review) => review.issues.map((issue) => ({dimension: review.dimension, ...issue})));
            const majorIssues = allIssues.filter((issue) => issue.severity === "major");
            wf.log(`第 ${round} 轮评审完成：${allIssues.length} 个问题（major ${majorIssues.length} 个）`);

            // 收敛判断：无 major 即收敛；关闭修订或到达轮数上限则直接结束循环。
            if (majorIssues.length === 0) {
                converged = true;
                break;
            }
            if (!reviseEnabled || round === reviewRounds) break;

            // —— revise：writer 使用新的 prompt 按编号问题清单修订目标文件 ——
            wf.progress({phase: "revise", done: round - 1, total: reviewRounds});
            wf.chart.node("revise", "按评审修订");
            wf.chart.move("gate", "revise", {sessionId: writer.id, label: `第 ${round} 轮修订`});
            const issueLines = allIssues.map((issue, index) =>
                `${index + 1}. [${issue.severity}][${issue.dimension}] 问题：${issue.problem}\n   改法：${issue.revision}`);
            const reviseRun = await writer.invoke({
                // 修订轮必须用 prompt：harness 要求 followup 仅在 session 有 active invocation 时合法，
                // 此时 writer 上一轮已结束、session 空闲，用 followup 会抛 active_invocation_required。
                mode: "prompt",
                message: [
                    `第 ${round} 轮评审发现以下问题，请修订章节文件 ${chapterPath}，修订完成后用 report_result 返回修订摘要：`,
                    issueLines.join("\n"),
                ].join("\n\n"),
            });
            if (reviseRun.status !== "completed") throw new Error(`writer 未完成第 ${round} 轮修订：${reviseRun.result.message}`);
            const reviseData = reviseRun.result.data;
            if (!reviseData || typeof reviseData !== "object" || Array.isArray(reviseData) || typeof reviseData.summary !== "string") {
                throw new Error(`writer 未按 output contract 返回第 ${round} 轮修订 summary`);
            }
            roundRecord.revisionSummary = reviseData.summary;
            finalSummary = reviseData.summary;
            currentNode = "revise";
            wf.log(`第 ${round} 轮修订完成`);
        }

        // —— finalize：重读最终正文取元信息（不把全文放进返回值） ——
        wf.progress({phase: "finalize", done: reviewRounds, total: reviewRounds});
        let finalBody;
        try {
            finalBody = await wf.workspace.read(chapterPath);
        } catch (error) {
            throw new Error(`定稿读取章节正文失败：${chapterPath}（${error instanceof Error ? error.message : String(error)}）`);
        }
        wf.chart.node("final", "定稿完成");
        wf.chart.move(currentNode, "final", {label: converged ? "已收敛" : "达到轮数上限"});
        wf.chart.leave("final");
        wf.log(`章级写作评审循环完成：共 ${rounds.length} 轮，${converged ? "已收敛" : "未收敛（仍有 major 问题）"}`);
        return {chapterPath, rounds, converged, finalSummary, finalLength: finalBody.length};
    },
};
