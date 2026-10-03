/**
 * 内置 workflow：角色问答批量候选。
 *
 * 配合 character-card-workshop skill 的可选批量模式：leader 从 skill 的 references 题库
 * 摘出题目清单（workflow 读不到系统资产里的 skill 目录，题目必须经 args 传入），
 * 按组并发让 adhoc 答题员为每题生成多个候选答案，再由 adhoc 汇总员给出整体观察与候选间矛盾，
 * 最终由代码按题号拼装成候选答案册。候选只供用户逐题挑选，不是定稿、不落库。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

/** 单组答题结果：每题回填题号与题面，candidates 为互相走不同解读方向的候选 */
const GroupAnswerSchema = Type.Object({
    answers: Type.Array(Type.Object({
        questionId: Type.String({description: "题号，原样回填调用方给出的题号。"}),
        question: Type.String({description: "题目原文。"}),
        candidates: Type.Array(Type.Object({
            answer: Type.String({description: "候选答案本体；素材不足时给「素材不足」型候选并说明缺口。"}),
            rationale: Type.String({description: "该候选扎根于哪些素材、走哪个解读方向。"}),
        }, {additionalProperties: false})),
    }, {additionalProperties: false})),
}, {additionalProperties: false});

/** 汇总结果：答案册本体由 workflow 代码拼装，汇总员只产出观察与矛盾 */
const MergeSchema = Type.Object({
    notes: Type.String({description: "整体观察：候选间的张力、共同倾向与素材缺口。"}),
    conflicts: Type.Array(Type.String(), {description: "不同题目候选之间互相矛盾之处；没有就返回空数组。"}),
}, {additionalProperties: false});

export default {
    key: "character-qa-fanout",
    title: "角色问答批量候选",
    description: "把角色理解题按组并发生成候选答案，再汇总整体观察与候选间矛盾，拼装成按题号排序的候选答案册供用户逐题挑选；候选不是定稿、不落库。",
    whenToUse: "用户明确要求「批量出候选再挑」「一次生成一轮我来挑」，或题目较多想先看一轮候选答案时使用；默认逐题交互问答、角色素材还几乎为零、或用户想被逐题引导思考时不要使用——批量产出只是候选，最终取舍仍由用户逐题决定。",
    argsHint: [
        {name: "material", label: "角色已有素材（标签、印象、已确认设定、故事背景摘录；必填）", defaultValue: ""},
        {name: "questions", label: "题目清单（换行分隔的编号列表，如 `Q24_01 这个角色的核心是什么？`；也支持逗号分隔；必填）", defaultValue: ""},
        {name: "groupSize", label: "每组题数（3-8）", defaultValue: "5"},
        {name: "candidatesPerQuestion", label: "每题候选数（1-3）", defaultValue: "2"},
    ],
    phases: [
        {key: "fanout", title: "分组并发答题"},
        {key: "merge", title: "汇总候选答案册"},
    ],
    run: async (wf, args) => {
        const material = typeof args?.material === "string" ? args.material.trim() : "";
        if (!material) {
            throw new Error("material 为空：请 leader 先整理角色已有素材（标签、印象、已确认设定、故事背景摘录），再通过 material 参数传入。");
        }

        /**
         * 解析题目清单为 [{id, text}]（数组/字符串双形态）：
         * 默认按换行拆分；只拆出一行时兼容逗号分隔形态。
         * 行首匹配 `Q24_01` 式题号或 `1.`/`2、` 式序号则拆出 id，否则整行为题面、id 用序号补。
         */
        const parseQuestions = (value) => {
            const rawLines = Array.isArray(value)
                ? value
                : typeof value === "string"
                    ? value.split(/\n/u)
                    : [];
            let entries = rawLines
                .filter((item) => typeof item === "string")
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
            if (entries.length === 1) {
                entries = entries[0].split(/[,，]/u).map((item) => item.trim()).filter((item) => item.length > 0);
            }
            const questions = [];
            for (const entry of entries) {
                // 形态一：Q 开头题号（Q24_01 / Q80-3 / Q200_015），题号与题面以空白或标点分隔
                const qMatch = entry.match(/^(Q[\w-]*\d[\w-]*)[\s.、．:：]*(.*)$/iu);
                // 形态二：`1.` / `2、` / `3：` 式序号（要求数字后带标点，避免把年份等普通数字误认成题号）
                const numMatch = qMatch ? null : entry.match(/^(\d+)[.、．)）:：]\s*(.*)$/u);
                const match = qMatch ?? numMatch;
                const id = match ? match[1] : String(questions.length + 1);
                const text = (match ? match[2] : entry).trim();
                if (!text) continue; // 只有编号没有题面的行不是题目，跳过
                questions.push({id, text});
            }
            return questions;
        };
        const questions = parseQuestions(args?.questions);
        if (questions.length === 0) {
            throw new Error("questions 为空或无法解析出任何题目：请 leader 先从 character-card-workshop skill 的 references 题库摘出题目清单（一行一题，保留题号），再通过 questions 参数传入。");
        }

        const groupSize = Math.max(3, Math.min(Math.floor(Number(args?.groupSize) || 5), 8));
        const candidatesPerQuestion = Math.max(1, Math.min(Math.floor(Number(args?.candidatesPerQuestion) || 2), 3));
        // 题目按清单顺序切组；题号顺序即清单顺序，排序时以此为准
        const questionOrder = new Map(questions.map((question, index) => [question.id, index]));
        const groups = [];
        for (let start = 0; start < questions.length; start += groupSize) {
            groups.push(questions.slice(start, start + groupSize));
        }
        wf.log(`题目解析完成：${questions.length} 题，分 ${groups.length} 组，每题 ${candidatesPerQuestion} 个候选`);

        // ── Phase 1: fanout ──
        wf.progress({phase: "fanout", done: 0, total: groups.length});
        wf.chart.node("fanout", "题目分组");
        wf.chart.enter("fanout");
        let completed = 0;
        const groupResults = await wf.map(groups, async (group, index) => {
            const token = `group-${index + 1}`;
            const nodeKey = `group-${index + 1}`;
            const answerer = await wf.agents.create("adhoc", {
                initial: {
                    name: `角色问答候选员（第 ${index + 1} 组）`,
                    systemPrompt: "你是角色设计助理，基于调用方给出的素材为每道角色理解题生成候选答案。候选必须扎根素材、互相有差异（走不同的解读方向）；素材不足以回答的题给出「素材不足」型候选并说明缺口；不要发明与素材矛盾的设定。完成后必须用 report_result 返回结构化 data。",
                    outputSchema: GroupAnswerSchema,
                },
                ephemeral: true,
                tags: ["workflow:character-qa-fanout", token],
            });
            wf.chart.node(nodeKey, `答题：第 ${index + 1} 组（${group.length} 题）`);
            wf.chart.edge("fanout", nodeKey, "派发");
            wf.chart.enter(nodeKey, {token, sessionId: answerer.id});
            const response = await answerer.invoke({
                message: [
                    `批量回答角色理解题（第 ${index + 1} 组）。为下面每道题各给出 ${candidatesPerQuestion} 个候选答案，按已声明 schema 汇报：questionId 与 question 原样回填，candidates 每条含 answer 与 rationale，候选之间必须走不同解读方向；素材不足以回答的题给「素材不足」型候选并说明缺口。`,
                    "",
                    "# 角色已有素材",
                    material.slice(0, 6000),
                    "",
                    "# 本组题目",
                    group.map((question) => `${question.id} ${question.text}`).join("\n"),
                ].join("\n"),
            });
            if (response.status !== "completed") throw new Error(`第 ${index + 1} 组答题未完成：${response.result.message}`);
            const data = response.result.data;
            if (!data || typeof data !== "object" || Array.isArray(data)) {
                throw new Error(`第 ${index + 1} 组答题员未按 outputSchema 返回 report_result.data`);
            }
            if (!Array.isArray(data.answers)) {
                throw new Error(`第 ${index + 1} 组答题结果缺少 answers 数组`);
            }
            for (const answer of data.answers) {
                if (!answer || typeof answer !== "object" || typeof answer.questionId !== "string" || !Array.isArray(answer.candidates)) {
                    throw new Error(`第 ${index + 1} 组答题结果存在缺少 questionId/candidates 的条目`);
                }
            }
            wf.chart.leave(nodeKey, {token});
            wf.chart.node("merge", "汇总候选答案册");
            wf.chart.edge(nodeKey, "merge", "并入");
            wf.progress({phase: "fanout", done: ++completed, total: groups.length});
            return {group: index + 1, answers: data.answers};
        }, {concurrency: 3});

        // ── Phase 2: merge ──
        wf.progress({phase: "merge", done: groups.length, total: groups.length});
        const merger = await wf.agents.create("adhoc", {
            initial: {
                name: "候选答案汇总员",
                systemPrompt: "你审阅多组角色理解题的候选答案，产出整体观察（候选间的张力、共同倾向、素材缺口）并指出不同题目候选之间互相矛盾之处。不重写候选本体，不虚构输入中不存在的内容。完成后必须用 report_result 返回结构化 data。",
                outputSchema: MergeSchema,
            },
            ephemeral: true,
            tags: ["workflow:character-qa-fanout", "role:merger"],
        });
        wf.chart.move("fanout", "merge", {sessionId: merger.id, label: "汇合"});
        const mergeRun = await merger.invoke({
            message: `汇总角色问答候选。审阅以下各组候选答案，按已声明 schema 汇报（notes 给整体观察，conflicts 只放不同题目候选之间互相矛盾之处，没有就返回空数组）：\n${JSON.stringify(groupResults, null, 2)}`,
        });
        if (mergeRun.status !== "completed") throw new Error(`候选汇总未完成：${mergeRun.result.message}`);
        const merged = mergeRun.result.data;
        if (!merged || typeof merged !== "object" || Array.isArray(merged)) {
            throw new Error("汇总员未按 outputSchema 返回 report_result.data");
        }
        if (typeof merged.notes !== "string" || !Array.isArray(merged.conflicts)) {
            throw new Error("汇总结果缺少 notes/conflicts 关键字段");
        }

        // 答案册本体由代码拼装：按题目清单中的题号顺序排序，模型偏航返回的未知题号排在末尾
        const answers = groupResults.flatMap((result) => result.answers);
        const orderOf = (questionId) => {
            const index = questionOrder.get(questionId);
            return index === undefined ? Number.MAX_SAFE_INTEGER : index;
        };
        answers.sort((a, b) => orderOf(a.questionId) - orderOf(b.questionId));

        wf.chart.node("final", "答案册完成");
        wf.chart.move("merge", "final", {label: "产出"});
        wf.chart.leave("final");
        wf.log(`角色问答批量候选完成：${questions.length} 题 / ${groups.length} 组`);
        return {
            questionCount: questions.length,
            groupCount: groups.length,
            answers,
            notes: merged.notes,
            conflicts: merged.conflicts,
        };
    },
};
