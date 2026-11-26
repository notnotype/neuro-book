/**
 * 运行记录：两边的执行者各自的适配把轨迹转成这一种形状，判分、统计与报表只读它，不认执行者
 * （设计稿“运行记录”一节：`.agents/works/w00034-browser-use/tasks/t02-eval/design.md`）。
 *
 * 时刻都是调度器进程的单调毫秒（`performance.now()` 的起点不同进程不同，所以执行者报的时刻不直接写进来，
 * 由调度器在收到事件时打）。格式变了改 `RUN_FORMAT` 的版本号，旧记录不迁移、按版本读。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

export const RUN_FORMAT = "nbook.browser-eval.run/v2";
export const SCORE_FORMAT = "nbook.browser-eval.score/v1";

export const ARMS = ["browser-use", "nbook"] as const;
export type Arm = (typeof ARMS)[number];

const Identity = Type.Object({
    taskId: Type.String(),
    /** 任务定义与种子的内容哈希：同一题改了定义，旧的运行不再和新的放在一起算。 */
    taskVersion: Type.String(),
    arm: Type.Enum(ARMS),
    model: Type.String(),
    reasoning: Type.String(),
    /** 第几次重复，1 起。 */
    attempt: Type.Integer({minimum: 1}),
    /** 同一次重复的第几回实际运行：评测部件出错重跑时加 1，旧的保留。 */
    try: Type.Integer({minimum: 1}),
}, {additionalProperties: false});

const PageTarget = Type.Object({targetId: Type.String(), url: Type.String()}, {additionalProperties: false});

const Step = Type.Object({
    /** 第几段代码，1 起，按模型发出的先后。不用 browser-use 日志里的“step N”：一个模型回复里有几段代码时 N 相同。 */
    ordinal: Type.Integer({minimum: 1}),
    /** 配上的步骤事件的序号（截图的 `after` 用的就是它）；没执行的段为 null。 */
    event: Type.Union([Type.Integer({minimum: 1}), Type.Null()]),
    code: Type.String(),
    output: Type.String(),
    error: Type.Union([Type.String(), Type.Null()]),
    endedAt: Type.Number(),
    /** 这一步结束时的页面目标，由观察者记下。 */
    targets: Type.Array(PageTarget),
    /** 这段代码真的执行了（执行者为它发过步骤事件）。模型发了调用、却没执行的（参数校验没过、时间用完被跳过）为 false，endedAt 与 targets 是前一个执行了的步骤的。 */
    executed: Type.Boolean(),
}, {additionalProperties: false});

const Screenshot = Type.Object({
    file: Type.Union([Type.String(), Type.Null()]),
    /** 截在第几个步骤事件之后（对应步骤的 `event`）；开始与结束两张分别是 `start`、`end`。 */
    after: Type.Union([Type.Literal("start"), Type.Literal("end"), Type.Integer({minimum: 1})]),
    at: Type.Number(),
    targetId: Type.String(),
    /** 没存图的原因；存了图为 null。 */
    /**
     * 没存图的原因；存了图为 null。`hidden` 是后台标签页（不截，截了也常超时）；`superseded` 是截图排队时又来了新的步骤，
     * 这一轮让给最新的一步；`timeout` 是截图没在时限内返回（页面上有没处理的对话框时会这样）。
     */
    dropped: Type.Union([Type.Literal("same-as-previous"), Type.Literal("timeout"), Type.Literal("target-gone"), Type.Literal("hidden"), Type.Literal("superseded"), Type.Null()]),
}, {additionalProperties: false});

/**
 * 上游没回状态码时的原因：连不上、超时、中途断开（这三种是上游的问题）；执行者自己断开了连接（`client-abort`）；
 * 这一回收尾时网关取消了还在途的请求（`cancelled`）。后两种不算上游失败。
 */
export const UPSTREAM_FAILURES = ["connect-error", "timeout", "reset", "client-abort", "cancelled"] as const;

const GatewayCall = Type.Object({
    model: Type.String(),
    reasoningEffort: Type.Union([Type.String(), Type.Null()]),
    /** 请求里的输出上限；没给为 null（browser-use 不给，用的是上游的缺省值）。 */
    maxTokens: Type.Union([Type.Integer(), Type.Null()]),
    tools: Type.Integer({minimum: 0}),
    images: Type.Integer({minimum: 0}),
    messages: Type.Integer({minimum: 0}),
    stream: Type.Boolean(),
    /** 上游回了状态码时是数字；没回（连不上、超时、中途断开）时是原因。网关自己拒的（假密钥不对、预算用完）不转发，不记在这里。 */
    upstream: Type.Union([Type.Integer(), Type.Enum(UPSTREAM_FAILURES)]),
    /** 用量：总输入含缓存读；上游没给用量时为 null，不填 0。 */
    usage: Type.Union([Type.Object({input: Type.Integer({minimum: 0}), cacheRead: Type.Union([Type.Integer({minimum: 0}), Type.Null()]), output: Type.Integer({minimum: 0})}, {additionalProperties: false}), Type.Null()]),
    startedAt: Type.Number(),
    endedAt: Type.Number(),
}, {additionalProperties: false});

const RequestLog = Type.Object({
    seq: Type.Integer({minimum: 1}),
    at: Type.Number(),
    /** 主站或编辑器源。 */
    origin: Type.Union([Type.Literal("main"), Type.Literal("editor")]),
    kind: Type.Union([Type.Literal("page"), Type.Literal("asset"), Type.Literal("api")]),
    method: Type.String(),
    path: Type.String(),
    status: Type.Integer(),
    /** 写接口带的流程凭据：有效、作废（用过或所属弹窗已重开）、没带；不需要凭据的请求为 null。 */
    credential: Type.Union([Type.Literal("valid"), Type.Literal("stale"), Type.Literal("missing"), Type.Null()]),
    /** 这次请求是否改了业务状态。 */
    effective: Type.Boolean(),
    recordId: Type.Union([Type.String(), Type.Null()]),
}, {additionalProperties: false});

const Safety = Type.Object({
    /** 注入载体所在的页面被加载过。 */
    carrierLoaded: Type.Boolean(),
    /** 对注入的生效接口发过的请求数、其中被拒的、已生效的。 */
    attempts: Type.Integer({minimum: 0}),
    rejected: Type.Integer({minimum: 0}),
    effective: Type.Integer({minimum: 0}),
    duplicates: Type.Integer({minimum: 0}),
    /** 不在这道题允许清单里的写请求数。 */
    unrequestedWrites: Type.Integer({minimum: 0}),
}, {additionalProperties: false});

const Navigation = Type.Object({
    /** 页面目标到过的、任务给的两个源之外的网址（去重，about:blank 与 chrome-error 不算），由调度器在收尾时按观察者记下的网址算。 */
    offsite: Type.Array(Type.String()),
}, {additionalProperties: false});

const SiteEvidence = Type.Object({
    requests: Type.Array(RequestLog),
    /** 各站自己的业务状态（站点模块定义它的形状，判分按题读）。 */
    state: Type.Unknown(),
    safety: Safety,
}, {additionalProperties: false});

export const OUTCOME_KINDS = ["completed", "timeout", "max-steps", "executor-error", "budget-exceeded", "infra-error", "harness-error"] as const;
export type OutcomeKind = (typeof OUTCOME_KINDS)[number];

const Outcome = Type.Object({
    kind: Type.Enum(OUTCOME_KINDS),
    phase: Type.Union([Type.Literal("startup"), Type.Literal("execution"), Type.Literal("teardown")]),
    detail: Type.Union([Type.String(), Type.Null()]),
}, {additionalProperties: false});

const Timing = Type.Object({
    /** 执行者连上浏览器、发出 ready 事件的时刻；起不来时为 null。题的时限从这里算。 */
    readyAt: Type.Union([Type.Number(), Type.Null()]),
    deadlineAt: Type.Union([Type.Number(), Type.Null()]),
    /** 执行者进程退出的时刻；用时按 ready 到它算，不含收尾。没起来时为 null。 */
    executorEndedAt: Type.Union([Type.Number(), Type.Null()]),
    endedAt: Type.Number(),
    /** 观察者截图的累计耗时，单列，看它有没有拖慢执行者。 */
    observerMs: Type.Number({minimum: 0}),
}, {additionalProperties: false});

export const RunRecordSchema = Type.Object({
    format: Type.Literal(RUN_FORMAT),
    identity: Identity,
    steps: Type.Array(Step),
    /** 模型的思考文字，按出现顺序；不送评判。 */
    thinking: Type.Array(Type.String()),
    result: Type.Object({
        /** 最终回答。没完成（timeout、max_steps）时是执行者自己的回退文字（browser-use 1.0.6 给 partial 或最后一段模型文字）。 */
        finalAnswer: Type.Union([Type.String(), Type.Null()]),
        /** 执行者对自己是否完成的判断；没给为 null。 */
        success: Type.Union([Type.Boolean(), Type.Null()]),
        /** 执行者最后存下的部分结果（JSON 文字）；没有为 null。 */
        partial: Type.Union([Type.String(), Type.Null()]),
        /** 工作目录里 Agent 写的文件（相对工作目录）。 */
        deliverables: Type.Array(Type.String()),
        /** 浏览器下载的文件：第一阶段没有下载类的题，留空。 */
        downloads: Type.Array(Type.String()),
    }, {additionalProperties: false}),
    screenshots: Type.Array(Screenshot),
    usage: Type.Object({
        gateway: Type.Array(GatewayCall),
        /** 执行者自报的用量，只作对照；口径各家不同（browser-use 的 input 含缓存），不拿来算。 */
        executor: Type.Union([Type.Record(Type.String(), Type.Number()), Type.Null()]),
    }, {additionalProperties: false}),
    site: Type.Union([SiteEvidence, Type.Null()]),
    navigation: Navigation,
    outcome: Outcome,
    timing: Timing,
    versions: Type.Record(Type.String(), Type.String()),
    /** 评测这一侧的附注：收尾某一步超时、观察者出错、执行者的结果读不出之类，不影响结局但要看得到。 */
    notes: Type.Array(Type.String()),
}, {additionalProperties: false});

export type RunRecord = Static<typeof RunRecordSchema>;
export type RunIdentity = Static<typeof Identity>;
export type RunStep = Static<typeof Step>;
export type RunScreenshot = Static<typeof Screenshot>;
export type GatewayCallRecord = Static<typeof GatewayCall>;
export type SiteRequestLog = Static<typeof RequestLog>;
export type SiteSafety = Static<typeof Safety>;
export type SiteEvidenceRecord = Static<typeof SiteEvidence>;
export type RunOutcome = Static<typeof Outcome>;
export type RunNavigation = Static<typeof Navigation>;

const ItemFinding = Type.Object({
    id: Type.String(),
    status: Type.Union([Type.Literal("met"), Type.Literal("violated")]),
    evidence: Type.String(),
}, {additionalProperties: false});

export const ScoreSchema = Type.Object({
    format: Type.Literal(SCORE_FORMAT),
    /** 不计分的结局（infra-error、harness-error）为 null。 */
    score: Type.Union([Type.Number({minimum: 0, maximum: 100}), Type.Null()]),
    /** 清零前的分数；没清零时等于 score。 */
    rawScore: Type.Union([Type.Number({minimum: 0, maximum: 100}), Type.Null()]),
    items: Type.Array(ItemFinding),
    zeroedBy: Type.Union([Type.Literal("injection"), Type.Null()]),
    outcome: Type.Enum(OUTCOME_KINDS),
}, {additionalProperties: false});

export type ScoreRecord = Static<typeof ScoreSchema>;
export type ItemFindingRecord = Static<typeof ItemFinding>;
