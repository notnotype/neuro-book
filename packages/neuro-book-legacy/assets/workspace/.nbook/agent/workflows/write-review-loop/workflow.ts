/**
 * 内置 workflow：写作评审循环。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

const DraftSchema = Type.Object({
    draft: Type.String({description: "可直接交付的完整稿件正文。"}),
    changeSummary: Type.String({description: "本版相对任务或上一版的简短改动说明。"}),
}, {additionalProperties: false});

const ReviewSchema = Type.Object({
    overall: Type.String({description: "整体评价。"}),
    issues: Type.Array(Type.Object({
        problem: Type.String({description: "具体问题。"}),
        revision: Type.String({description: "可执行的修改建议。"}),
    }, {additionalProperties: false})),
}, {additionalProperties: false});

export default {
    key: "write-review-loop",
    title: "写作评审循环",
    description: "由独立临时写手和评审执行固定轮数的初稿、评审与修订，返回结构化过程和最终文本。",
    whenToUse: "用户需要对文案、提纲或短篇文本执行一到三轮明确的写作—评审—修订流程时；需要直接写入 Project Workspace 文件或只需一次回答时不要使用。",
    argsHint: [
        {name: "brief", label: "写作要求", defaultValue: "写一份结构完整、可直接审阅的初稿。"},
        {name: "reviewRounds", label: "评审修订轮数（1-3）", defaultValue: "2"},
    ],
    phases: [
        {key: "draft", title: "生成初稿"},
        {key: "review", title: "评审"},
        {key: "revise", title: "修订"},
        {key: "finalize", title: "定稿"},
    ],
    run: async (wf, args) => {
        const brief = typeof args?.brief === "string" && args.brief.trim()
            ? args.brief.trim()
            : "写一份结构完整、可直接审阅的初稿。";
        const reviewRounds = Math.max(1, Math.min(Math.floor(Number(args?.reviewRounds) || 2), 3));

        const writer = await wf.agents.create("adhoc", {
            initial: {
                name: "临时写手",
                systemPrompt: "你根据调用方的写作要求产出完整稿件，并在后续轮次严格依据评审意见修订。不要写文件。每轮必须用 report_result 返回完整 draft 与 changeSummary。",
                outputSchema: DraftSchema,
            },
            tags: ["workflow:write-review-loop", "role:writer"],
            ephemeral: true,
        });
        const reviewer = await wf.agents.create("adhoc", {
            initial: {
                name: "独立评审",
                systemPrompt: "你独立评审稿件是否满足原始要求，只指出有证据的具体问题，并给出可执行改法。不要代写全文。每轮必须用 report_result 返回整体评价和问题列表。",
                outputSchema: ReviewSchema,
            },
            tags: ["workflow:write-review-loop", "role:reviewer"],
            ephemeral: true,
        });

        wf.progress({phase: "draft"});
        wf.chart.node("draft", "生成初稿");
        wf.chart.enter("draft", {sessionId: writer.id});
        const draftRun = await writer.invoke({message: `请按以下要求生成初稿：\n${brief}`});
        if (draftRun.status !== "completed") throw new Error(`写手未完成初稿：${draftRun.result.message}`);
        const initial = draftRun.result.data;
        if (!initial || typeof initial !== "object" || Array.isArray(initial) || typeof initial.draft !== "string") {
            throw new Error("写手未按 outputSchema 返回初稿 data");
        }
        const initialDraft = initial.draft;
        let currentDraft = initialDraft;
        let currentNode = "draft";
        const reviews = [];

        for (let round = 1; round <= reviewRounds; round++) {
            wf.progress({phase: "review", done: round - 1, total: reviewRounds});
            wf.chart.node("review", "独立评审");
            wf.chart.move(currentNode, "review", {sessionId: reviewer.id, label: `第 ${round} 轮交稿`});
            const reviewRun = await reviewer.invoke({
                mode: round === 1 ? "prompt" : "followup",
                message: [
                    `评审第 ${round} 轮稿件，按已声明 schema 汇报。`,
                    `【原始要求】\n${brief}`,
                    `【当前稿件】\n${currentDraft}`,
                ].join("\n\n"),
            });
            if (reviewRun.status !== "completed") throw new Error(`评审未完成第 ${round} 轮：${reviewRun.result.message}`);
            const review = reviewRun.result.data;
            if (!review || typeof review !== "object" || Array.isArray(review)) {
                throw new Error(`评审未按 outputSchema 返回第 ${round} 轮 data`);
            }
            reviews.push({round, review});

            wf.progress({phase: "revise", done: round - 1, total: reviewRounds});
            wf.chart.node("revise", "按意见修订");
            wf.chart.move("review", "revise", {sessionId: writer.id, label: `第 ${round} 轮修订`});
            const revisionRun = await writer.invoke({
                mode: "followup",
                message: `根据以下第 ${round} 轮评审修订上一版稿件，返回完整新稿：\n${JSON.stringify(review, null, 2)}`,
            });
            if (revisionRun.status !== "completed") throw new Error(`写手未完成第 ${round} 轮修订：${revisionRun.result.message}`);
            const revision = revisionRun.result.data;
            if (!revision || typeof revision !== "object" || Array.isArray(revision) || typeof revision.draft !== "string") {
                throw new Error(`写手未按 outputSchema 返回第 ${round} 轮修订 data`);
            }
            currentDraft = revision.draft;
            currentNode = "revise";
            wf.progress({phase: "revise", done: round, total: reviewRounds});
        }

        wf.progress({phase: "finalize", done: reviewRounds, total: reviewRounds});
        wf.chart.node("final", "定稿完成");
        wf.chart.move(currentNode, "final", {label: "采用修订稿"});
        wf.chart.leave("final");
        wf.log(`写作评审循环完成：共 ${reviewRounds} 轮`);
        return {brief, reviewRounds, initialDraft, reviews, finalDraft: currentDraft};
    },
};
