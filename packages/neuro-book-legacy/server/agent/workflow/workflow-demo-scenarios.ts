import type {AgentWorkflowDefinition, JsonValue, MockAgentPort, Wf} from "@notnotype/nb-workflow";
import {WORKFLOW_DEMO_PROFILE_PREFIX} from "nbook/server/agent/workflow/workflow-session-port";

/** mock profile 键（带 demo 前缀，分流到 mock responder，且不会与真实 profile 撞名） */
const P = {
    summarizer: `${WORKFLOW_DEMO_PROFILE_PREFIX}summarizer`,
    plotAnalyst: `${WORKFLOW_DEMO_PROFILE_PREFIX}plot-analyst`,
    styleExtractor: `${WORKFLOW_DEMO_PROFILE_PREFIX}style-extractor`,
    writer: `${WORKFLOW_DEMO_PROFILE_PREFIX}writer`,
    critic: `${WORKFLOW_DEMO_PROFILE_PREFIX}critic`,
    worldUpdater: `${WORKFLOW_DEMO_PROFILE_PREFIX}world-updater`,
    rpLeader: `${WORKFLOW_DEMO_PROFILE_PREFIX}simulator-leader`,
    rpActor: `${WORKFLOW_DEMO_PROFILE_PREFIX}simulator-actor`,
    retrieval: `${WORKFLOW_DEMO_PROFILE_PREFIX}retrieval`,
} as const;

/** profile → 用户视角中文名（观测层标签用；真实 profile 不在表内则显示原 key） */
export const PROFILE_NAMES: Record<string, string> = {
    [P.summarizer]: "章节摘要员",
    [P.plotAnalyst]: "剧情分析师",
    [P.styleExtractor]: "文风提取员",
    [P.writer]: "写手",
    [P.critic]: "评审",
    [P.worldUpdater]: "世界引擎",
    [P.rpLeader]: "主持人",
    [P.rpActor]: "扮演者",
    [P.retrieval]: "检索员",
};

/** demo 书稿（拆书场景 wf.workspace.read 的数据源） */
export const DEMO_BOOK = [
    "# 第一章\n主角出场，捡到神秘玉佩。",
    "# 第二章\n玉佩引来追杀，主角初显身手。",
    "# 第三章\n拜入宗门，结识挚友。",
    "# 第四章\n宗门大比，一鸣惊人。",
].join("\n---\n");

export const DEMO_BOOK_PATH = "manuscript/demo-book.md";

/**
 * 可变旋钮：模拟"完成后编辑脚本参数再 rerun"。
 * styleMode 变化 → 文风提取 invoke 的参数指纹变化 → 该分支后缀失效重跑，其余全部缓存命中。
 */
export const demoKnobs = {
    styleMode: "白描",
    /** 演示速度倍率：mock responder 的 sleep × 该值。只影响观感节奏，不进参数指纹，对 replay/缓存零影响 */
    speedFactor: 4,
};

/** RP 直聊时 leader 的闲聊分支识别前缀（与 mock responder 约定） */
export const RP_CHAT_PREFIX = "聊：";

/** 注册全部 mock responder（确定性，带少量延迟制造并发乱序完成） */
export function registerDemoResponders(mock: MockAgentPort): void {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms * demoKnobs.speedFactor));

    mock.register(P.summarizer, async ({input}) => {
        const text = (input as {text: string}).text;
        await sleep(300 + (text.length % 4) * 150);
        return {message: "已摘要", data: {brief: text.split("\n")[0] ?? ""}};
    });
    mock.register(P.plotAnalyst, async ({mode, input}) => {
        await sleep(400);
        if (mode === "followup") return {message: "深度伏笔分析完成", data: {foreshadowing: ["玉佩来历", "宗门隐秘"]} as JsonValue};
        const briefs = (input as {briefs: unknown[]}).briefs;
        return {message: "剧情分析完成", data: {arcs: briefs.length, theme: "逆袭"} as JsonValue};
    });
    mock.register(P.styleExtractor, async ({input}) => {
        await sleep(350);
        const q = input as {chapter: string; mode: string};
        return {message: `文风提取完成（${q.mode}）`, data: {from: q.chapter, style: q.mode}};
    });

    let draftVersion = 0;
    let criticRounds = 0;
    mock.register(P.writer, async ({mode}) => {
        await sleep(300);
        draftVersion++;
        return {message: `draft v${draftVersion}`, data: {draft: `正文 v${draftVersion}`, mode: mode ?? "prompt"}};
    });
    mock.register(P.critic, async () => {
        await sleep(300);
        criticRounds++;
        const pass = criticRounds % 3 === 0; // 每三轮通过一次：两轮驳回 + 一轮通过
        return {message: pass ? "通过" : "驳回", data: {pass, issues: pass ? [] : [`节奏问题#${criticRounds}`]}};
    });
    mock.register(P.worldUpdater, async () => {
        await sleep(250);
        return {message: "World Engine 已更新"};
    });

    mock.register(P.rpLeader, ({mode, message, input}) => {
        if (mode === "followup") {
            const reactions = (input as {reactions: {message: string}[]}).reactions;
            return {message: `本回合结算：${reactions.map((r) => r.message).join("；")}`};
        }
        if (message?.startsWith(RP_CHAT_PREFIX)) return {message: `（闲聊）酒保是老约翰，消息灵通`};
        return {
            message: "世界模拟完成，派发角色",
            data: {dispatch: [
                {subjectId: "alice", packet: `艾丽丝对「${message}」的反应`},
                {subjectId: "bob", packet: `鲍勃对「${message}」的反应`},
            ]} as JsonValue,
        };
    });
    mock.register(P.rpActor, async ({input, history}) => {
        await sleep(300);
        return {message: `扮演：${(input as {packet: string}).packet}`, data: {memory: history.length}};
    });
    mock.register(P.retrieval, async ({input}) => {
        await sleep(300);
        return {message: "检索完成", data: {facts: [`关于「${(input as {query: string}).query}」的两条往事`]}};
    });
}

/** 场景一：拆书。并发摘要 → 剧情分析（长篇追加 if 分支）→ ask 圈选 → 文风提取。 */
const splitBook: AgentWorkflowDefinition = {
    key: "split-book",
    phases: [
        {key: "brief", title: "逐章摘要（小模型 ×N 并发）"},
        {key: "plot", title: "剧情分析（吃 brief 隔离文风）"},
        {key: "pick", title: "人工圈选章节"},
        {key: "style", title: "文风提取"},
    ],
    run: async (wf: Wf) => {
        const raw = await wf.workspace.read(DEMO_BOOK_PATH);
        const chapters = raw.split("\n---\n").map((text, i) => ({id: `ch${i + 1}`, text}));

        // 状态图零预置：从一个起点开始，随执行长出来
        wf.chart.node("start", "读取书稿");
        wf.chart.enter("start");

        wf.progress({phase: "brief", total: chapters.length});
        wf.log(`读取书稿，共 ${chapters.length} 章，派发并发摘要（这些是真实 JSONL session）`);
        let done = 0;
        const briefs = await wf.map(chapters, async (ch) => {
            const s = await wf.agents.create(P.summarizer, {ephemeral: true});
            // 每章长出自己的节点（扇出），token=章节 id：并发中的多章同时橙色
            const nodeKey = `brief-${ch.id}`;
            wf.chart.node(nodeKey, `${ch.id} 摘要`);
            wf.chart.edge("start", nodeKey);
            wf.chart.enter(nodeKey, {token: ch.id, sessionId: s.id});
            const r = await s.invoke({input: {text: ch.text}});
            wf.chart.leave(nodeKey, {token: ch.id});
            // 完成即汇入分析节点（合并），图上逐条长出汇聚边
            wf.chart.node("plot", "剧情分析");
            wf.chart.edge(nodeKey, "plot", "合并");
            wf.progress({phase: "brief", done: ++done});
            return {chapter: ch.id, brief: (r.result.data as {brief: string}).brief};
        }, {concurrency: 2});

        wf.progress({phase: "plot"});
        wf.chart.leave("start");
        wf.log("摘要完成，分析剧情");
        const analyst = await wf.agents.create(P.plotAnalyst, {ephemeral: true});
        wf.chart.enter("plot", {sessionId: analyst.id});
        const plot = await analyst.invoke({input: {briefs}});
        let at = "plot";
        if ((plot.result.data as {arcs: number}).arcs >= 4) {
            wf.log("检测到 4 条剧情弧线（长篇），追加深度伏笔分析");
            wf.chart.node("deep", "深度伏笔分析");
            wf.chart.move("plot", "deep", {sessionId: analyst.id, label: "长篇"});
            await analyst.invoke({mode: "followup", input: {focus: "伏笔与铺垫"}});
            at = "deep";
        }

        wf.chart.node("pick", "人工圈选");
        wf.chart.move(at, "pick");
        const picks = await wf.ask({
            kind: "select", multi: true, title: "选择要提取文风的章节",
            options: chapters.map((ch) => ({id: ch.id, label: ch.id})),
        });

        wf.progress({phase: "style"});
        wf.log(`圈选 ${(picks as string[]).join("、")}，按「${demoKnobs.styleMode}」提取文风`);
        const styles = await wf.map(picks as string[], async (chapterId) => {
            const s = await wf.agents.create(P.styleExtractor, {ephemeral: true});
            // 圈选了哪些章、就长哪些文风节点（第二次扇出，只有用户选中的才出现）
            const nodeKey = `style-${chapterId}`;
            wf.chart.node(nodeKey, `${chapterId} 文风`);
            wf.chart.edge("pick", nodeKey, "圈选");
            wf.chart.enter(nodeKey, {token: chapterId, sessionId: s.id});
            const r = await s.invoke({input: {chapter: chapterId, mode: demoKnobs.styleMode}});
            wf.chart.leave(nodeKey, {token: chapterId});
            wf.chart.node("finish", "完成");
            wf.chart.edge(nodeKey, "finish");
            return r.result.data;
        }, {concurrency: 2});
        wf.chart.leave("pick");

        return {briefs, plot: plot.result.data, styles} as JsonValue;
    },
};

/** 场景二：写作流水线。writer↔critic 循环（约束在代码里）→ 轮次耗尽升级给人 → worldUpdater 收尾。 */
const writePipeline: AgentWorkflowDefinition = {
    key: "write-pipeline",
    phases: [
        {key: "draft", title: "writer 初稿"},
        {key: "loop", title: "writer ↔ critic 循环"},
        {key: "settle", title: "World Engine 收尾"},
    ],
    run: async (wf: Wf, args) => {
        const brief = ((args as {brief?: string} | null)?.brief) ?? "第一章：玉佩现世";
        const writer = await wf.agents.create(P.writer, {});
        const critic = await wf.agents.create(P.critic, {});

        wf.progress({phase: "draft"});
        // 状态图零预置：节点走到哪、长到哪
        wf.chart.node("draft", "写手初稿");
        wf.chart.enter("draft", {sessionId: writer.id});
        let draft = (await writer.invoke({input: {brief}})).result;
        let rounds = 0;
        let passed = false;
        wf.progress({phase: "loop", total: 4});
        wf.chart.node("review", "评审");
        wf.chart.move("draft", "review", {sessionId: critic.id, label: "交稿"});
        for (; rounds < 4; rounds++) {
            wf.progress({phase: "loop", done: rounds});
            const review = (await critic.invoke({input: {draft: draft.data}})).result;
            wf.log(`critic 第 ${rounds + 1} 轮：${review.message}`);
            if ((review.data as {pass: boolean}).pass) { passed = true; break; }
            wf.chart.node("revise", "写手修改");
            wf.chart.move("review", "revise", {sessionId: writer.id, label: "驳回"});
            draft = (await writer.invoke({mode: "followup", input: {revisions: (review.data as {issues: string[]}).issues}})).result;
            wf.chart.move("revise", "review", {sessionId: critic.id, label: "再交"});
        }
        if (!passed) {
            // 轮次耗尽升级给人：leader 跳不过 critic，人可以
            wf.chart.node("escalate", "人工裁决");
            wf.chart.move("review", "escalate", {label: "4 轮未过"});
            const force = await wf.ask({kind: "approve", title: `critic ${rounds} 轮未通过，强制采用当前稿？`});
            if (force !== true) throw new Error("用户否决：流水线终止");
        }

        wf.progress({phase: "settle"});
        const updater = await wf.agents.create(P.worldUpdater, {ephemeral: true});
        wf.chart.node("settle", "World Engine 收尾");
        wf.chart.move(passed ? "review" : "escalate", "settle", {sessionId: updater.id, label: passed ? "通过" : "强制采用"});
        await updater.invoke({input: {finalDraft: draft.data}});
        wf.chart.leave("settle");
        return {draft: draft.data, criticRounds: rounds + 1, escalated: !passed} as JsonValue;
    },
};

/** 场景三：RP 持久参与者。acquire leader/actor 跨 run 复用；轮间用户可与 leader 直聊。 */
const rpTurn: AgentWorkflowDefinition = {
    key: "rp-turn",
    phases: [
        {key: "simulate", title: "leader 世界模拟"},
        {key: "actors", title: "actor 并发扮演"},
        {key: "settle", title: "leader 汇总结算"},
    ],
    run: async (wf: Wf, args) => {
        const userInput = ((args as {userInput?: string} | null)?.userInput) ?? "我推开酒馆的门";
        wf.progress({phase: "simulate"});
        const leader = await wf.agents.acquire({profileKey: P.rpLeader, tag: "workflow.demo:rp-main"});
        wf.log(`acquire leader → session ${leader.id}（跨 run 稳定复用）`);
        // 本场景不预声明 machine：状态图完全随代码运行构建（演示动态构图这一头）
        wf.chart.node("simulate", "世界模拟");
        wf.chart.enter("simulate", {sessionId: leader.id});
        const plan = await leader.invoke({message: userInput});

        wf.progress({phase: "actors"});
        const dispatch = (plan.result.data as {dispatch: {subjectId: string; packet: string}[]}).dispatch;
        const reactions = await wf.map(dispatch, async (d) => {
            const actor = await wf.agents.acquire({
                profileKey: P.rpActor, tag: `workflow.demo:rp-actor:${d.subjectId}`, parent: leader,
            });
            // 派发时才知道有哪些角色：节点/边都是运行时长出来的
            const nodeKey = `act-${d.subjectId}`;
            wf.chart.node(nodeKey, `扮演·${d.subjectId}`);
            wf.chart.edge("simulate", nodeKey, "派发");
            wf.chart.enter(nodeKey, {token: d.subjectId, sessionId: actor.id});
            const r = await actor.invoke({input: {packet: d.packet}});
            wf.chart.leave(nodeKey, {token: d.subjectId});
            wf.chart.edge(nodeKey, "settle", "反应");
            return {subjectId: d.subjectId, message: r.result.message, actorSession: actor.id};
        }, {concurrency: 2});

        wf.progress({phase: "settle"});
        wf.chart.node("settle", "汇总结算");
        wf.chart.move("simulate", "settle", {sessionId: leader.id});
        const final = await leader.invoke({mode: "followup", input: {reactions} as JsonValue});
        wf.chart.leave("settle");
        return {narration: final.result.message, reactions, leaderSession: leader.id} as JsonValue;
    },
};

/** 场景四：sidecar 旁路。对 caller 做 excursion 探针检索，结论 append 回主线（替代 SidecarProfilePass）。 */
const sidecarContext: AgentWorkflowDefinition = {
    key: "sidecar-context",
    phases: [
        {key: "probe", title: "excursion 旁支探针"},
        {key: "inject", title: "结论写回主线"},
    ],
    run: async (wf: Wf, args) => {
        const packet = ((args as {packet?: string} | null)?.packet) ?? "酒馆的旧识";
        const target = await wf.caller();
        wf.progress({phase: "probe"});
        // 状态图：主线和旁支是**同一个 session** 的两个分支，不是两个 agent
        wf.chart.node("main", `主线（session#${target.id} 正篇）`);
        wf.chart.enter("main", {sessionId: target.id});
        wf.log(`在 caller session ${target.id} 的树上开旁支做检索探针（不污染主线）`);
        wf.chart.node("branch", `旁支（同一 session#${target.id} 开叉）`);
        wf.chart.move("main", "branch", {label: "excursion 开叉"});
        const facts = await target.excursion("leaf", async (branch) => {
            await branch.append({role: "user", message: "（旁路探针：请回忆相关往事）"});
            const retriever = await wf.agents.create(P.retrieval, {ephemeral: true});
            // 检索员是旁支上请来的帮工：名字持久留在旁支节点上
            wf.chart.enter("branch", {token: "probe", sessionId: retriever.id});
            const r = await retriever.invoke({input: {query: packet}});
            wf.chart.leave("branch", {token: "probe"});
            return (r.result.data as {facts: string[]}).facts;
        });
        wf.progress({phase: "inject"});
        wf.chart.move("branch", "main", {label: "结论写回主线"});
        await target.append({role: "user", input: {actorContext: facts} as JsonValue});
        wf.chart.leave("main");
        wf.log("探针留在旁支可追溯，主线只多一条 context 注入");
        return {injected: facts.length, callerSession: target.id} as JsonValue;
    },
};

/** 场景五：真实 agent 并发问答。真 profile、真模型、真 harness——create N 个 session 并发 invoke 再汇总。 */
const realFanout: AgentWorkflowDefinition = {
    key: "real-fanout",
    phases: [
        {key: "fanout", title: "并发提问（真实 agent ×N）"},
        {key: "reduce", title: "汇总（真实 agent）"},
    ],
    run: async (wf: Wf, args) => {
        const input = (args ?? {}) as {profileKey?: string; topic?: string; angles?: string[]};
        const profileKey = input.profileKey ?? "writer";
        const topic = input.topic ?? "一个修仙小说的酒馆开场";
        const angles = input.angles?.length ? input.angles : ["气氛与画面", "人物动机", "悬念钩子"];

        wf.progress({phase: "fanout", total: angles.length});
        wf.log(`用真实 profile「${profileKey}」并发 ${angles.length} 路提问（每路一个真实 session，跑真模型）`);
        // 状态图：议题 → 各角度扇出（真实 agent 并发）→ 汇总
        wf.chart.node("topic", `议题「${topic}」`);
        wf.chart.enter("topic");
        let done = 0;
        const answers = await wf.map(angles, async (angle, i) => {
            const agent = await wf.agents.create(profileKey, {tags: ["workflow.demo:real"]});
            const nodeKey = `angle-${i}`;
            wf.chart.node(nodeKey, `角度：${angle}`);
            wf.chart.edge("topic", nodeKey);
            wf.chart.enter(nodeKey, {token: angle, sessionId: agent.id});
            const r = await agent.invoke({message: `围绕「${topic}」，只从「${angle}」这一个角度给出 3 条具体建议，每条不超过 40 字。`});
            wf.chart.leave(nodeKey, {token: angle});
            wf.chart.node("reduce", "汇总去重");
            wf.chart.edge(nodeKey, "reduce", "并入");
            wf.progress({phase: "fanout", done: ++done});
            return {angle, sessionId: agent.id, answer: r.result.message};
        }, {concurrency: 2});

        wf.progress({phase: "reduce"});
        const reducer = await wf.agents.create(profileKey, {tags: ["workflow.demo:real"]});
        wf.chart.leave("topic");
        wf.chart.enter("reduce", {sessionId: reducer.id});
        const final = await reducer.invoke({
            message: `以下是三路并行建议，请合并去重成一份最终清单（不超过 6 条）：\n${answers.map((a) => `【${a.angle}】\n${a.answer}`).join("\n\n")}`,
        });
        wf.chart.leave("reduce");
        return {answers, final: final.result.message, reducerSession: reducer.id} as JsonValue;
    },
};

export type DemoScenario = {
    def: AgentWorkflowDefinition;
    title: string;
    description: string;
    /** 真实 agent 场景：跑真模型，可能产生费用与耗时 */
    real: boolean;
    /** 需要 caller session（sidecar 形态） */
    needsCaller: boolean;
    /** args 表单提示（前端渲染输入框用） */
    argsHint: {name: string; label: string; defaultValue: string}[];
};

/** 全部 demo 场景（key → 描述符） */
export const DEMO_SCENARIOS: Record<string, DemoScenario> = {
    "split-book": {
        def: splitBook,
        title: "拆书",
        description: "并发逐章摘要 → 剧情分析（含 if 追加分支）→ ask 圈选挂起 → 文风提取。resume 后前缀全部缓存命中；完成后可改文风参数 rerun 看局部失效。",
        real: false, needsCaller: false, argsHint: [],
    },
    "write-pipeline": {
        def: writePipeline,
        title: "写作流水线",
        description: "writer↔critic 循环上限 4 轮（约束是代码，leader 跳不过 critic），耗尽升级 ask，worldUpdater 收尾恰好一次。",
        real: false, needsCaller: false,
        argsHint: [{name: "brief", label: "章节 brief", defaultValue: "第一章：玉佩现世"}],
    },
    "rp-turn": {
        def: rpTurn,
        title: "RP 持久参与者",
        description: "acquire leader/actor（按 tag 跨 run 复用同一批真实 session）→ 并发扮演 → 汇总。轮间可与 leader 直聊，再跑一轮历史连续。",
        real: false, needsCaller: false,
        argsHint: [{name: "userInput", label: "本回合输入", defaultValue: "我推开酒馆的门"}],
    },
    "sidecar-context": {
        def: sidecarContext,
        title: "Sidecar 旁路",
        description: "对 caller session 做 excursion 旁支检索（探针留树上），结论 append 回主线——SidecarProfilePass 的 workflow 化形态。",
        real: false, needsCaller: true,
        argsHint: [{name: "packet", label: "检索主题", defaultValue: "酒馆的旧识"}],
    },
    "real-fanout": {
        def: realFanout,
        title: "真实 Agent 并发问答",
        description: "真 profile + 真模型 + 真 harness：并发 3 路提问（每路一个真实 session）再汇总。需要已配置模型；会产生真实调用耗时与费用。",
        real: true, needsCaller: false,
        argsHint: [
            {name: "profileKey", label: "真实 profile", defaultValue: "writer"},
            {name: "topic", label: "议题", defaultValue: "一个修仙小说的酒馆开场"},
        ],
    },
};
