/**
 * 内置 workflow：并行脑暴。
 * `Type` 由 WorkflowCatalog 求值作用域注入，源码禁止 import。
 */

const PerspectiveSchema = Type.Object({
    ideas: Type.Array(Type.Object({
        idea: Type.String({description: "具体想法。"}),
        value: Type.String({description: "这个想法的价值。"}),
        risk: Type.String({description: "潜在问题或代价。"}),
    }, {additionalProperties: false}), {minItems: 3, maxItems: 5}),
}, {additionalProperties: false});

const SynthesisSchema = Type.Object({
    candidates: Type.Array(Type.String(), {description: "去重后的候选清单。"}),
    recommendation: Type.Array(Type.String(), {description: "建议组合采用的候选。"}),
    tradeoffs: Type.Array(Type.String(), {description: "关键取舍与冲突。"}),
    nextSteps: Type.Array(Type.String(), {description: "可立即执行的下一步。"}),
}, {additionalProperties: false});

export default {
    key: "parallel-brainstorm",
    title: "并行脑暴",
    description: "由多个结构化临时参与者从明确角度并发发散，再汇总去重为一份可执行方案。",
    whenToUse: "用户面对开放议题，需要同时探索多个互补角度并在最后收敛时；单一事实问答、已有明确方案的直接执行或需要联网证据的研究不要使用。",
    argsHint: [
        {name: "topic", label: "脑暴议题", defaultValue: "为下一章设计一个有张力的核心冲突"},
        {name: "angles", label: "角度（逗号或换行分隔，最多 6 个）", defaultValue: "创意突破,角色动机,风险反例,落地步骤"},
        {name: "concurrency", label: "最大并发数（1-6）", defaultValue: "4"},
    ],
    phases: [
        {key: "fanout", title: "多角度并发发散"},
        {key: "merge", title: "汇总去重"},
    ],
    run: async (wf, args) => {
        const topic = typeof args?.topic === "string" && args.topic.trim()
            ? args.topic.trim()
            : "为下一章设计一个有张力的核心冲突";
        const rawAngles = Array.isArray(args?.angles)
            ? args.angles
            : typeof args?.angles === "string"
                ? args.angles.split(/[,，\n]/u)
                : [];
        const parsedAngles = rawAngles
            .filter((angle) => typeof angle === "string")
            .map((angle) => angle.trim())
            .filter((angle, index, all) => angle.length > 0 && all.indexOf(angle) === index)
            .slice(0, 6);
        const angles = parsedAngles.length > 0 ? parsedAngles : ["创意突破", "角色动机", "风险反例", "落地步骤"];
        const concurrency = Math.max(1, Math.min(Math.floor(Number(args?.concurrency) || 4), angles.length));

        wf.progress({phase: "fanout", done: 0, total: angles.length});
        wf.chart.node("topic", "明确议题");
        wf.chart.enter("topic");
        let completed = 0;
        const perspectives = await wf.map(angles, async (angle, index) => {
            const token = `angle-${index + 1}`;
            const nodeKey = `angle-${index + 1}`;
            const agent = await wf.agents.create("adhoc", {
                initial: {
                    name: `${angle}视角脑暴员`,
                    systemPrompt: `你只从「${angle}」视角独立发散，不替其他视角汇总。想法必须具体、互不重复，并说明价值与风险。完成后必须用 report_result 返回结构化 data。`,
                    outputSchema: PerspectiveSchema,
                },
                tags: ["workflow:parallel-brainstorm", token],
                ephemeral: true,
            });
            wf.chart.node(nodeKey, `角度：${angle}`);
            wf.chart.edge("topic", nodeKey, "派发");
            wf.chart.enter(nodeKey, {token, sessionId: agent.id});
            const response = await agent.invoke({message: `围绕议题「${topic}」提出 3-5 条想法，按已声明 schema 汇报。`});
            if (response.status !== "completed") throw new Error(`角度「${angle}」未完成：${response.result.message}`);
            const data = response.result.data;
            if (!data || typeof data !== "object" || Array.isArray(data)) {
                throw new Error(`角度「${angle}」未按 outputSchema 返回 report_result.data`);
            }
            wf.chart.leave(nodeKey, {token});
            wf.chart.node("merge", "汇总去重");
            wf.chart.edge(nodeKey, "merge", "并入");
            wf.progress({phase: "fanout", done: ++completed, total: angles.length});
            return {angle, ideas: data.ideas};
        }, {concurrency});

        wf.progress({phase: "merge", done: angles.length, total: angles.length});
        const reducer = await wf.agents.create("adhoc", {
            initial: {
                name: "脑暴汇总员",
                systemPrompt: "你把多角度脑暴去重、比较并收敛，保留真实冲突，输出候选、推荐组合、取舍和下一步。完成后必须用 report_result 返回结构化 data。",
                outputSchema: SynthesisSchema,
            },
            tags: ["workflow:parallel-brainstorm", "role:reducer"],
            ephemeral: true,
        });
        wf.chart.move("topic", "merge", {sessionId: reducer.id, label: "汇合"});
        const synthesisRun = await reducer.invoke({
            message: `汇总议题「${topic}」的以下结果，按已声明 schema 汇报：\n${JSON.stringify(perspectives, null, 2)}`,
        });
        if (synthesisRun.status !== "completed") throw new Error(`汇总未完成：${synthesisRun.result.message}`);
        const synthesis = synthesisRun.result.data;
        if (!synthesis || typeof synthesis !== "object" || Array.isArray(synthesis)) {
            throw new Error("汇总员未按 outputSchema 返回 report_result.data");
        }

        wf.chart.node("final", "方案完成");
        wf.chart.move("merge", "final", {label: "产出"});
        wf.chart.leave("final");
        wf.log(`并行脑暴完成：${angles.length} 个角度`);
        return {topic, angles, perspectives, synthesis};
    },
};
