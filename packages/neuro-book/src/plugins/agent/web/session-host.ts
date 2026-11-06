/**
 * 一个对话位置（右栏的视图、编辑区的页面）的宿主（docs/specs/agent/conversation.md）：持有这个位置的当前会话，把日志与帧合成视图要的 `ctx`，
 * 把视图的 action 换成远程指令。组件只是它的消费者，所以放在插件级：编辑区页面切标签就卸载，也没有“被关闭”的信号，未提交的答案、收起状态
 * 放在这里，切回来还在。组件借用并计数，归零后 30 秒取消订阅。
 *
 * 打开一个会话（输出 5）的先后：先订阅并缓存帧；取快照，得 `head`、`leaf` 与会话级基线；固定这个 `leaf` 分页取路径；再处理缓存。
 * seq 不大于 `head` 的日志帧由适配器丢掉；快照之前的状态帧过时了，这里丢掉。内联放不下的事件要经 `eventChunk` 拼回，拼的时候后面的帧排队，
 * 按 seq 保序。收到 `leafChanged` 按新叶子重取路径，不把各分支的日志接在一起。
 *
 * 用 `bun test` 跑真实的服务端（`agentWorld`），所以这里不导入 `.vue`。
 */

import {computed, ref, shallowRef, watch} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import {createAgentContext, createKernelTranscript} from "@notnotype/nb-agent-ui";
import type {AgentConversationContext, AgentViewAction, ApprovalPreviewView, ComposerApprovalOption, ComposerModelView, ComposerRoleView, ContextInspectionView, KernelTranscript, PendingInputView, PendingQuestionView, SystemPromptView} from "@notnotype/nb-agent-ui";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";
import type {Text} from "@notnotype/nb-ui/text";

import type {TextResolver} from "nbook/shared/localized-text";
import type {TextRef} from "@notnotype/nb-ui/text";
import type {PreviewResult} from "@notnotype/nb-harness/kernel/contracts";

import {MAIN_PROFILE} from "../shared/contracts";
import type {ProfileEntry} from "../shared/contracts";
import type {agentSessionsContract, ApprovalPreview, ApprovalPreviewItem, LogItem, RemoteFrame} from "../shared/remote";
import {agentText} from "../shared/text";

type SessionsRemote = RemoteClient<typeof agentSessionsContract>;

/** 归零之后等这么久才取消订阅：切标签回来不用重新打开。 */
export const RELEASE_DELAY_MS = 30_000;
const TICK_MS = 1_000;

/** 结果未知的失败码：指令可能已经受理，不能当成被拒。 */
const UNKNOWN_OUTCOME = new Set(["unknown-outcome", "unavailable", "timeout", "disconnected", "server-restarted", "provider-error"]);
const REJECT_KEYS = {
    "empty-input": "conversation.reject.emptyInput",
    "input-too-large": "conversation.reject.inputTooLarge",
    "input-rejected": "conversation.reject.inputRejected",
    "read-only": "conversation.reject.readOnly",
} as const;
/** `compact` 被拒的码（runtime.md 输出 52）。 */
const COMPACT_REJECT_KEYS = {
    "nothing-to-compact": "conversation.compact.nothingToCompact",
    "no-compaction-model": "conversation.compact.noModel",
    "read-only": "conversation.reject.readOnly",
} as const;
/** 宿主做了的输入框命令；别的（`/new`、`/plan` 等）第二批再做，现在不进菜单。 */
const HOST_COMMANDS = ["compact"] as const;
const MODEL_KEYS = {
    "no-model": "conversation.model.none",
    "no-credentials": "conversation.model.noCredentials",
    "unknown-model": "conversation.model.unknown",
    "role-unbound": "conversation.model.roleUnbound",
} as const;
const ROLE_STATUS_KEYS = {
    unbound: MODEL_KEYS["role-unbound"],
    "unknown-model": MODEL_KEYS["unknown-model"],
    "no-credentials": MODEL_KEYS["no-credentials"],
} as const;
/** `preview` 的 `tokens.byArea` 里的几块，按它们在请求里的位置。 */
const AREA_KEYS = ["system", "tools", "opening", "history", "turn"] as const;
const PHASE_KEYS = {
    requesting: "conversation.phase.requesting",
    streaming: "conversation.phase.streaming",
    tools: "conversation.phase.tools",
    compacting: "conversation.phase.compacting",
} as const;

const APPROVAL_OPTIONS: readonly ComposerApprovalOption[] = [
    {key: "ask", label: agentText("conversation.approval.ask.label"), description: agentText("conversation.approval.ask.description"), icon: "i-lucide-shield-question"},
    {key: "allow-writes", label: agentText("conversation.approval.allowWrites.label"), description: agentText("conversation.approval.allowWrites.description"), icon: "i-lucide-pencil-line"},
    {key: "yolo", label: agentText("conversation.approval.yolo.label"), description: agentText("conversation.approval.yolo.description"), icon: "i-lucide-triangle-alert", danger: true},
];

/** 这条日志事件会不会让解析到的模型变：只有核心设置里的模型与推理档。 */
function changesResolvedModel(event: unknown): boolean {
    const {type, data} = event as {readonly type?: unknown; readonly data?: {readonly extension?: unknown; readonly patch?: Readonly<Record<string, unknown>>}};
    return type === "settingsChanged" && data?.extension === "core" && data.patch !== undefined && ("model" in data.patch || "effort" in data.patch);
}

/** 给视图看的工具名：`nbook.agent.edit-replace` 和 `edit` 给模型的名字相同，画法也相同。 */
export function displayToolName(id: string): string {
    const name = id.slice(id.lastIndexOf(".") + 1);
    if (name === "edit-replace") return "edit";
    if (name === "ask-form") return "ask";
    return name;
}

export interface SessionHostDeps {
    readonly remote: SessionsRemote;
    /** 窗口绑定的作品；新建的会话归它。 */
    readonly project: string | null;
    readonly now: () => number;
    readonly schedule: (run: () => void, delayMs: number) => () => void;
    readonly text: TextResolver;
    readonly newId: () => string;
    /** 这个位置最近用过的会话（`nbook.storage` 的本地记录）。 */
    readonly recent: {read(): Promise<string | null>; write(id: string | null): void};
    readonly warnCost: () => number;
    /** 模型下拉；模型服务不在时为 null。 */
    readonly models: () => readonly ComposerModelView[] | null;
    /** 模型角色；模型服务不在时为 null。`status` 是模型服务按解析规则算的有效性。 */
    readonly roles: () => readonly RoleOption[] | null;
    readonly profiles: () => readonly ProfileEntry[];
    readonly copy: (text: string) => void;
    readonly openSettings: () => void;
    readonly openAddress: (address: string) => void;
    readonly openLink: (href: string) => void;
    /** 视图要换新的会话面板（点标题）；打开列表的动作归面板。 */
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

/** 宿主从模型服务的快照映射来，界面文字在这里按 `status` 取。 */
export interface RoleOption {
    readonly key: string;
    /** 内置角色的名字是文字引用，按界面语言显示。 */
    readonly name: string | TextRef;
    readonly axis: "gradient" | "specialist";
    readonly modelLabel: string | null;
    readonly status: "ok" | "unbound" | "unknown-model" | "no-credentials";
}

export interface SessionHost {
    readonly ctx: ComputedRef<AgentConversationContext>;
    readonly sessionId: ShallowRef<string | null>;
    /** 回到这个位置最近用过的会话；不在了就显示未选择。 */
    restore(): Promise<void>;
    open(id: string): Promise<void>;
    /** 新建并打开；`profile` 缺省用主创。 */
    create(profile?: string): Promise<string | null>;
    act(action: AgentViewAction): void;
    /** 组件借用，交回归还函数。 */
    borrow(): () => void;
    dispose(): void;
}

type Current = {
    readonly id: string;
    readonly transcript: KernelTranscript;
    release: (() => void) | null;
    /** 正在拼大事件或重取路径时，后面的帧排在这里。 */
    chain: Promise<void>;
    /** 这个会话打开失败的说明。 */
    failed: {readonly code: string} | null;
    /** 快照和路径还没到：视图显示加载中，不说“还没有消息”。 */
    loading: boolean;
};

export function createSessionHost(deps: SessionHostDeps): SessionHost {
    const {remote} = deps;
    const sessionId = shallowRef<string | null>(null);
    const revision = ref(0);
    const nowValue = ref(deps.now());
    const bump = (): void => {
        revision.value += 1;
    };

    let current: Current | null = null;
    /** 打开的代数：切走之后，还在路上的结果不再算数。 */
    let generation = 0;
    let disposed = false;

    // 输入框
    let draft = {text: "", version: 0};
    let draftText = "";
    let notice: Text | null = null;
    /** 运行中受理压缩时给的那句话：运行结束就收掉。 */
    let queuedCompactNotice: Text | null = null;
    /** 说明挂上时路径上已有的压缩分隔线条数：多出一条就是排着的压缩做完了。 */
    let queuedCompactDividers = 0;
    /** 结果未知的乐观消息，可以重发（同一个指令 id）或移除。 */
    const unknownSends = new Map<string, {readonly commandId: string; readonly text: string}>();

    // 向导
    let wizardState: AgentConversationContext["wizardState"];
    let previews = new Map<string, ApprovalPreviewView>();
    let stopRequestedAt: number | null = null;

    const setDraft = (text: string): void => {
        draft = {text, version: draft.version + 1};
        draftText = text;
    };

    async function readChunks(fetch: (index: number) => Promise<{ok: true; value: {text: string; last: boolean}} | {ok: false; code: string}>): Promise<string | null> {
        let text = "";
        for (let index = 0; ; index += 1) {
            const page = await fetch(index);
            if (!page.ok) return null;
            text += page.value.text;
            if (page.value.last) return text;
        }
    }

    /** 把一条日志条目还原成事件；放不下的经 `eventChunk` 拼回。拼不回的跳过并写诊断，别的事件照常。 */
    async function eventOf(id: string, item: LogItem): Promise<unknown | null> {
        if (item.kind === "event") return item.event;
        const text = await readChunks((index) => remote.eventChunk({sessionId: id, seq: item.seq, index}) as never);
        if (text !== null) return JSON.parse(text) as unknown;
        deps.report("conversation-event-unreadable", `event ${String(item.seq)} of session ${id} could not be read`);
        return null;
    }

    /** 固定叶子分页取路径（打开、切分支时；回退后不能把各分支的日志接在一起）。 */
    async function loadPath(target: Current, leaf: string | null): Promise<boolean> {
        const events: unknown[] = [];
        let from = 0;
        for (;;) {
            const page = await remote.path({sessionId: target.id, leaf, from});
            if (!page.ok) return false;
            for (const item of page.value.items) {
                const event = await eventOf(target.id, item);
                if (event !== null) events.push(event);
            }
            if (!page.value.more) break;
            from = page.value.next;
        }
        if (current === target) target.transcript.applyPath(events);
        return true;
    }

    async function refresh(target: Current): Promise<void> {
        const epoch = modelEpoch;
        const snapshot = await remote.snapshot({sessionId: target.id});
        if (!snapshot.ok || current !== target) return;
        target.transcript.applySnapshot(snapshot.value);
        if (epoch !== modelEpoch) void refreshModel(target);
        await loadPath(target, snapshot.value.leaf);
        bump();
    }

    /**
     * 解析到的模型只在快照里，日志与帧都不带：模型库变了（绑定角色、设密钥）或会话的模型设置变了，就重读一次，只取这一个字段
     * （不走 `refresh`：它重建路径，会清掉正在生成的那条）。`modelEpoch` 记变化的次数：只有最新一次的结果算数，
     * 打开或重连的整份快照若取得比变化早，读完再补一次。
     */
    let modelEpoch = 0;
    async function refreshModel(target: Current): Promise<void> {
        modelEpoch += 1;
        const epoch = modelEpoch;
        const snapshot = await remote.snapshot({sessionId: target.id});
        if (!snapshot.ok || current !== target || epoch !== modelEpoch) return;
        target.transcript.setModel(snapshot.value.model);
        bump();
    }

    /** 处理一帧。只有要拼大事件、要重取路径时才真的异步；这之前的先后由 `take` 排好。 */
    async function processFrame(target: Current, frame: RemoteFrame): Promise<void> {
        if (frame.type !== "log") {
            target.transcript.applyFrame(frame);
        } else {
            const event = frame.item.kind === "event" ? frame.item.event : await eventOf(target.id, frame.item);
            if (current !== target) return;
            if (event !== null && target.transcript.applyEvent(event) === "leaf-changed") await refresh(target);
            if (event !== null && changesResolvedModel(event)) void refreshModel(target);
        }
        afterChange(target);
    }

    /**
     * 一个接一个处理帧：大事件拼回来之前，后面的帧不能先走。没有活在排队、这一帧又不用等的时候同步处理，流式增量不多绕一个微任务。
     */
    let working = 0;
    function queueWork(target: Current, run: () => Promise<void>): void {
        working += 1;
        target.chain = target.chain.then(run).catch((error: unknown) => {
            deps.report("conversation-frame-failed", error instanceof Error ? error.message : String(error));
        }).finally(() => {
            working -= 1;
        });
    }

    function take(target: Current, frame: RemoteFrame): void {
        const immediate = working === 0 && (frame.type !== "log" || frame.item.kind === "event" && frame.item.event.type !== "leafChanged");
        if (immediate) void processFrame(target, frame);
        else queueWork(target, () => processFrame(target, frame));
    }

    /** 等用户的事项变了：给新的审批取预览；运行状态变了：开关计时。 */
    function afterChange(target: Current): void {
        if (current !== target || disposed) return;
        const pending = target.transcript.pending();
        for (const item of pending) if (item.kind === "approval" && !previews.has(item.id)) loadPreview(target, item.id);
        // 这一批答完了：下一批从头来，不沿用“收起”和第几步。
        if (pending.length === 0) wizardState = undefined;
        syncTicker(target);
        bump();
    }

    function loadPreview(target: Current, id: string): void {
        previews.set(id, {state: "loading"});
        void (async () => {
            const view = await fetchPreview(target.id, id);
            if (current !== target) return;
            previews.set(id, view);
            bump();
        })();
    }

    // ─── 上下文详情 ─────────────────────────────────────────────────────

    /** 弹窗开着时的数据。系统提示词随同一次 `preview` 回来，展开时才交给视图，不常驻 `ctx`。 */
    let inspection: ContextInspectionView | null = null;
    let inspectionPrompt: SystemPromptView | null = null;
    let inspectionSystem: string | null = null;
    let inspectionToken = 0;

    function closeInspection(): void {
        inspectionToken += 1;
        inspection = null;
        inspectionPrompt = null;
        inspectionSystem = null;
    }

    async function refreshInspection(): Promise<void> {
        const target = current;
        const token = ++inspectionToken;
        const hadPrompt = inspectionPrompt !== null;
        if (target === null) return;
        inspection = {state: "loading"};
        bump();
        const preview = await fetchRequestPreview(target.id);
        if (token !== inspectionToken || current !== target) return;
        if (preview === null) {
            inspection = {state: "unavailable", reason: deps.text.t(agentText("conversation.context.unavailable"))};
            inspectionSystem = null;
            inspectionPrompt = null;
        } else {
            const {tokens} = preview;
            inspection = {
                state: "ready",
                estimated: tokens.estimated,
                window: tokens.window,
                threshold: tokens.threshold,
                areas: AREA_KEYS.map((key) => ({key, tokens: tokens.byArea[key]})),
                slots: preview.slots.map(({name, extension, tokens: slotTokens, placed}) => ({name, extension, tokens: slotTokens, placed})),
                diagnostics: preview.diagnostics.map(({id, level, message}) => ({id, level, message})),
            };
            inspectionSystem = preview.request.system.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n\n");
            inspectionPrompt = hadPrompt ? {text: inspectionSystem} : null;
        }
        bump();
    }

    async function fetchRequestPreview(session: string): Promise<PreviewResult | null> {
        const result = await remote.preview({sessionId: session});
        if (!result.ok) return null;
        if (result.value.kind === "inline") return result.value.preview;
        const {token} = result.value;
        const text = await readChunks((index) => remote.previewChunk({token, index}) as never);
        return text === null ? null : JSON.parse(text) as PreviewResult;
    }

    async function fetchPreview(session: string, interactionId: string): Promise<ApprovalPreviewView> {
        const result = await remote.approvalPreview({sessionId: session, interactionId});
        if (!result.ok) return {state: "failed"};
        const item: ApprovalPreviewItem = result.value;
        if (item.kind === "inline") return {state: "ready", files: [...item.preview.files]};
        const text = await readChunks((index) => remote.previewChunk({token: item.token, index}) as never);
        if (text === null) return {state: "failed"};
        return {state: "ready", files: [...(JSON.parse(text) as ApprovalPreview).files]};
    }

    let cancelTick: (() => void) | null = null;
    function syncTicker(target: Current): void {
        const running = target.transcript.run().status !== "idle";
        if (!running) stopRequestedAt = null;
        // 排着的压缩已经做过或运行已结束：“将在这一步结束后压缩”不再成立。
        if (queuedCompactNotice !== null && (!running || countCompactions(target) > queuedCompactDividers)) {
            if (notice === queuedCompactNotice) notice = null;
            queuedCompactNotice = null;
        }
        if (running && cancelTick === null) {
            const tick = (): void => {
                nowValue.value = deps.now();
                cancelTick = deps.schedule(tick, TICK_MS);
            };
            nowValue.value = deps.now();
            cancelTick = deps.schedule(tick, TICK_MS);
        } else if (!running && cancelTick !== null) {
            cancelTick();
            cancelTick = null;
            nowValue.value = deps.now();
        }
    }

    function closeCurrent(): void {
        current?.release?.();
        current = null;
        cancelTick?.();
        cancelTick = null;
        previews = new Map();
        wizardState = undefined;
        stopRequestedAt = null;
        unknownSends.clear();
        notice = null;
        closeInspection();
    }

    async function open(id: string): Promise<void> {
        generation += 1;
        const token = generation;
        // 同一个会话重新打开（归还 30 秒后借回）：未提交的答案还要；换了会话才清。事项答完了的话，`afterChange` 会清。
        const keptWizard = sessionId.value === id ? wizardState : undefined;
        closeCurrent();
        wizardState = keptWizard;
        const target: Current = {id, transcript: createKernelTranscript({toolName: displayToolName}), release: null, chain: Promise.resolve(), failed: null, loading: true};
        current = target;
        sessionId.value = id;
        deps.recent.write(id);
        bump();

        const early: RemoteFrame[] = [];
        /** 快照返回时 `early` 有多长：这之前的状态帧过时了，这之后的是快照之后的变化，不能丢（输出 5）。 */
        let staleUntil = 0;
        let live = false;
        const subscription = await remote.events.frames.subscribe({sessionId: id}, (frame) => {
            if (current !== target) return;
            if (live) take(target, frame);
            else early.push(frame);
        }, {
            // 重连期间丢的帧不补增量：按现在的快照与路径重建，正在生成的那条从下一个增量接着显示。
            onResync: () => queueWork(target, () => refresh(target)),
            onEnd: (reason) => {
                if (current !== target) return;
                // 服务端换了进程走应用的重新加载页，这里不用再说一遍。
                if (reason !== "server-restarted") target.failed = {code: String(reason)};
                bump();
            },
        });
        if (token !== generation) {
            if (subscription.ok) subscription.value.release();
            return;
        }
        if (!subscription.ok) {
            target.failed = {code: subscription.code};
            bump();
            return;
        }
        target.release = () => subscription.value.release();

        const epoch = modelEpoch;
        const snapshot = await remote.snapshot({sessionId: id});
        if (token !== generation) return;
        if (!snapshot.ok) {
            target.failed = {code: snapshot.code};
            bump();
            return;
        }
        staleUntil = early.length;
        target.transcript.applySnapshot(snapshot.value);
        if (epoch !== modelEpoch) void refreshModel(target);
        const loaded = await loadPath(target, snapshot.value.leaf);
        if (token !== generation) return;
        if (!loaded) {
            target.failed = {code: "path-unavailable"};
            bump();
            return;
        }
        target.loading = false;
        live = true;
        // 日志帧不大于 `head` 的由适配器丢掉。
        early.forEach((frame, index) => {
            if (frame.type !== "status" || index >= staleUntil) take(target, frame);
        });
        await target.chain;
        afterChange(target);
    }

    async function create(profile = MAIN_PROFILE): Promise<string | null> {
        const created = await remote.create({profile, ...(deps.project === null ? {} : {project: deps.project})});
        if (!created.ok) {
            notice = agentText("conversation.createFailed", {code: created.code});
            bump();
            return null;
        }
        await open(created.value.sessionId);
        return created.value.sessionId;
    }

    const failedToOpen = (id: string): boolean => current?.id === id && current.failed !== null;

    async function restore(): Promise<void> {
        const id = await deps.recent.read();
        if (id === null || current !== null) return;
        await open(id);
        // 记录里的会话不在了：显示未选择，不留一个打不开的。
        if (failedToOpen(id)) {
            closeCurrent();
            sessionId.value = null;
            deps.recent.write(null);
            bump();
        }
    }

    const commandId = (): string => deps.newId();

    /** 发送结果未知：消息标出来，可以重发或移除。明确被拒：撤掉，文字放回输入框，说明原因。 */
    function settleSend(target: Current, optimisticId: string, id: string, text: string, result: {ok: boolean; code?: string}): void {
        if (current !== target) return;
        if (result.ok) {
            // 受理了：`input` 帧先于响应到达，通常已经换掉；重连重建时帧被跳过，这里兜住，不留一条永远“发送中”的。
            target.transcript.removeOptimistic(optimisticId);
            bump();
            return;
        }
        if (UNKNOWN_OUTCOME.has(result.code ?? "")) {
            target.transcript.markOptimisticUnknown(optimisticId);
            unknownSends.set(optimisticId, {commandId: id, text});
        } else {
            target.transcript.removeOptimistic(optimisticId);
            setDraft(text);
            const key = REJECT_KEYS[result.code as keyof typeof REJECT_KEYS];
            notice = key === undefined ? agentText("conversation.reject.other", {code: result.code ?? ""}) : agentText(key);
        }
        bump();
    }

    async function submit(text: string, delivery: "prompt" | "steer" | "followup"): Promise<void> {
        notice = null;
        setDraft("");
        bump();
        if (current === null && (await create()) === null) {
            setDraft(text);
            bump();
            return;
        }
        const target = current!;
        if (delivery === "prompt") {
            const id = commandId();
            const optimisticId = `optimistic-${id}`;
            target.transcript.addOptimistic({id: optimisticId, commandId: id, text, timestamp: deps.now()});
            bump();
            settleSend(target, optimisticId, id, text, await remote.send({sessionId: target.id, commandId: id, input: {text}}));
            return;
        }
        const queued = await remote.enqueue({sessionId: target.id, commandId: commandId(), input: {text}, mode: delivery});
        if (!queued.ok && !UNKNOWN_OUTCOME.has(queued.code) && current === target) {
            setDraft(text);
            notice = agentText("conversation.reject.other", {code: queued.code});
            bump();
        }
    }

    const countCompactions = (target: Current): number => target.transcript.messages().filter((message) => message.kind === "system" && message.source === "compaction").length;

    /** 手动压缩（docs/specs/agent/conversation.md 输出 20）：不新建会话，不发送文字，被拒时文字放回输入框。 */
    async function compactCommand(argsText: string): Promise<void> {
        const typed = argsText === "" ? "/compact" : `/compact ${argsText}`;
        const target = current;
        notice = null;
        if (target === null) {
            notice = agentText("conversation.compact.noSession");
            bump();
            return;
        }
        setDraft("");
        bump();
        const result = await remote.compact({sessionId: target.id, commandId: commandId(), ...(argsText === "" ? {} : {requirement: argsText})});
        if (current !== target) return;
        if (result.ok) {
            // 运行中受理的在下一个边界做：给一句话，运行结束时收掉。
            // 回复到的时候运行可能已经结束：那就没有“下一步”可等，不挂说明。
            if (result.value.value.scheduled === "next-boundary" && target.transcript.run().status !== "idle") {
                notice = agentText("conversation.compact.queued");
                queuedCompactNotice = notice;
                queuedCompactDividers = countCompactions(target);
            }
        } else if (UNKNOWN_OUTCOME.has(result.code)) {
            notice = agentText("conversation.compact.unknown");
        } else {
            setDraft(typed);
            const key = COMPACT_REJECT_KEYS[result.code as keyof typeof COMPACT_REJECT_KEYS];
            notice = key === undefined ? agentText("conversation.reject.other", {code: result.code}) : agentText(key);
        }
        bump();
    }

    async function resolveInput(id: string, resolutions: {kind: "approval"; decision: "allow" | "allow-session" | "deny"; note?: string} | {kind: "question"; answer: {text: string; data: {answers: unknown}}}): Promise<void> {
        const target = current;
        if (target === null) return;
        const result = resolutions.kind === "approval"
            ? await remote.resolve({sessionId: target.id, commandId: commandId(), id, decision: resolutions.decision, ...(resolutions.note === undefined ? {} : {note: resolutions.note})})
            : await remote.resolve({sessionId: target.id, commandId: commandId(), id, decision: "answer", answer: resolutions.answer as never});
        // 别的窗口先答了：向导跟着服务端的状态走，不报错（输出 14）。
        if (!result.ok && result.code !== "already-answered" && result.code !== "unknown-interaction" && current === target) {
            notice = agentText("conversation.reject.other", {code: result.code});
            bump();
        }
    }

    async function changeSettings(patch: Readonly<Record<string, unknown>>): Promise<void> {
        const target = current;
        if (target === null) return;
        const result = await remote.changeSettings({sessionId: target.id, commandId: commandId(), patch: {core: patch as never}});
        if (!result.ok && current === target) {
            notice = agentText("conversation.reject.other", {code: result.code});
            bump();
        }
    }

    function messageText(id: string): string {
        const message = current?.transcript.messages().find((item) => item.id === id);
        if (message?.kind === "assistant") return message.text;
        if (message?.kind === "user") return message.blocks.flatMap((block) => (block.kind === "text" ? [block.text] : [])).join("\n");
        return "";
    }

    function toolText(id: string): string {
        for (const message of current?.transcript.messages() ?? []) {
            if (message.kind !== "assistant") continue;
            const call = message.toolCalls.find((item) => item.id === id);
            if (call !== undefined) return JSON.stringify({args: call.args, result: call.result?.text}, null, 2);
        }
        return "";
    }

    function act(action: AgentViewAction): void {
        void run(action).catch((error: unknown) => {
            deps.report("conversation-action-failed", `${action.type}: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    async function run(action: AgentViewAction): Promise<void> {
        const target = current;
        switch (action.type) {
            case "composer.draftChanged":
                draftText = action.text;
                return;
            case "composer.submit":
                await submit(action.text, action.delivery);
                return;
            case "command.run":
                if (action.name === "compact") await compactCommand(action.argsText);
                return;
            case "composer.stop":
            case "input.cancelRun":
                if (target === null) return;
                stopRequestedAt = deps.now();
                bump();
                // 排队的消息留着（开发者 2026-11-05 定）。
                await remote.abort({sessionId: target.id, commandId: commandId(), keepQueue: true});
                return;
            case "run.continue":
                if (target !== null) await remote.start({sessionId: target.id, commandId: commandId()});
                return;
            case "input.submit":
                await resolveInput(action.batchKey, action.resolutions as never);
                return;
            case "wizard.state":
                wizardState = action.state;
                return;
            case "queued.remove":
                if (target !== null) await remote.remove({sessionId: target.id, commandId: commandId(), inputId: action.id});
                return;
            case "queued.edit": {
                // 取出来就是取出来：从队列删掉、放进输入框，改了再发是一条新消息。输入框里已有的不丢，接在后面。
                const queued = target?.transcript.queue().find((item) => item.id === action.id);
                if (queued === undefined || target === null) return;
                const removed = await remote.remove({sessionId: target.id, commandId: commandId(), inputId: queued.id});
                if (!removed.ok) return;
                setDraft(draftText === "" ? queued.text : `${draftText}\n${queued.text}`);
                bump();
                return;
            }
            case "message.resend": {
                const sent = unknownSends.get(action.messageId);
                if (sent === undefined || target === null) return;
                unknownSends.delete(action.messageId);
                settleSend(target, action.messageId, sent.commandId, sent.text, await remote.send({sessionId: target.id, commandId: sent.commandId, input: {text: sent.text}}));
                return;
            }
            case "message.dismiss":
                unknownSends.delete(action.messageId);
                target?.transcript.removeOptimistic(action.messageId);
                bump();
                return;
            case "approval.set":
                await changeSettings({approvalMode: action.mode});
                return;
            case "model.set":
                await changeSettings({model: action.modelKey === "" ? null : action.modelKey});
                return;
            case "thinking.set":
                await changeSettings({effort: action.level});
                return;
            case "context.refresh":
                await refreshInspection();
                return;
            case "context.closed":
                closeInspection();
                bump();
                return;
            case "systemPrompt.load":
                if (inspectionSystem !== null) inspectionPrompt = {text: inspectionSystem};
                bump();
                return;
            case "model.manage":
                deps.openSettings();
                return;
            case "session.create":
                await create(action.profileKey);
                return;
            case "session.select":
                await open(action.sessionId);
                return;
            case "session.rename":
                await remote.setTitle({sessionId: action.sessionId, commandId: commandId(), title: action.title});
                return;
            case "session.archive":
                await remote.archive({sessionId: action.sessionId, commandId: commandId(), archived: true});
                return;
            case "session.restore":
                await remote.archive({sessionId: action.sessionId, commandId: commandId(), archived: false});
                return;
            case "message.copy":
                deps.copy(messageText(action.messageId));
                return;
            case "tool.copy":
                deps.copy(toolText(action.toolCallId));
                return;
            case "reference.open":
                deps.openAddress(action.target);
                return;
            case "file.openDiff":
                deps.openAddress(action.path);
                return;
            case "link.open":
                deps.openLink(action.href);
                return;
            case "availability.act":
                if (action.action === "open-settings") deps.openSettings();
                else if (action.action === "restore" && target !== null) await remote.archive({sessionId: target.id, commandId: commandId(), archived: false});
                else if (action.action === "retry" && target !== null) await open(target.id);
                return;
            default:
                // 第二批的动作（编辑重发、分支、附件、命令）：视图的 `interaction` 已经关掉入口，这里不用处理。
                return;
        }
    }

    function pendingViews(target: Current): PendingInputView[] {
        return target.transcript.pending().map((item): PendingInputView => {
            const request = (item.request ?? {}) as {tool?: string; args?: unknown; reason?: string; data?: {questions?: PendingQuestionView[]}};
            if (item.kind === "approval") {
                return {kind: "approval", id: item.id, toolCallId: item.callId, tool: displayToolName(request.tool ?? ""), args: (request.args ?? {}) as never, ...(request.reason === undefined ? {} : {reason: request.reason}), preview: previews.get(item.id) ?? {state: "loading"}};
            }
            return {kind: "question", id: item.id, toolCallId: item.callId, questions: request.data?.questions ?? []};
        });
    }

    const ctx = computed<AgentConversationContext>(() => {
        void revision.value;
        const now = nowValue.value;
        const target = current;
        const meta = target?.transcript.meta();
        const profile = deps.profiles().find((item) => item.key === meta?.profile);
        const model = (meta?.model ?? null) as {ok: true; id: string; contextWindow: number; efforts: readonly string[]} | {ok: false; code: string} | null;
        const usage = target?.transcript.usage();
        const run = target?.transcript.run();
        const warnCost = deps.warnCost();
        const models = deps.models();
        const roles = (deps.roles() ?? []).map((role): ComposerRoleView => ({
            key: role.key,
            name: deps.text.t(role.name),
            axis: role.axis,
            modelLabel: role.modelLabel,
            ...(role.status === "ok" ? {} : {unavailable: deps.text.t(agentText(ROLE_STATUS_KEYS[role.status]))}),
        }));
        const settings = (meta?.settings ?? {}) as {model?: string | null; effort?: string | null; approvalMode?: string};
        const availability = target?.loading === true && target.failed === null
            ? {status: "loading" as const, message: "", actions: []}
            : target?.failed !== null && target?.failed !== undefined
            ? {status: "load-error" as const, message: deps.text.t(agentText("conversation.openFailed", {code: target.failed.code})), actions: [{id: "retry", label: deps.text.t(agentText("conversation.retry"))}]}
            : meta?.archived === true
                ? {status: "archived" as const, message: deps.text.t(agentText("conversation.archived")), actions: [{id: "restore", label: deps.text.t(agentText("conversation.restore"))}]}
                : model !== null && !model.ok
                    ? {status: "profile-unavailable" as const, message: deps.text.t(agentText(MODEL_KEYS[model.code as keyof typeof MODEL_KEYS] ?? "conversation.model.none")), actions: [{id: "open-settings", label: deps.text.t(agentText("conversation.openSettings"))}]}
                    : {status: "ready" as const, message: "", actions: []};
        return createAgentContext({
            session: target === null || meta === undefined ? null : {
                id: target.id,
                title: target.loading ? deps.text.t(agentText("conversation.loading")) : meta.title ?? "",
                summary: meta.description ?? "",
                profileName: profile?.name ?? meta.profile ?? "",
                profileIcon: profile?.icon ?? "i-lucide-bot",
                archived: meta.archived,
                summaryState: "idle",
            },
            availability,
            interaction: {canSend: true, canSteer: true, canQueue: true, canAnswer: true, canStop: true, canChangeRuntime: target !== null, canArchive: true, canRestore: true, canManageModels: true, canInspectContext: target !== null, commands: HOST_COMMANDS},
            run: run === undefined ? {} : {
                status: run.status,
                phase: run.phase === null ? "" : deps.text.t(agentText(PHASE_KEYS[run.phase])),
                startedAt: run.startedAt,
                retry: run.retry as never,
                ...(run.kind === null ? {} : {kind: run.kind}),
            },
            messages: target?.transcript.messages() ?? [],
            panels: inspection === null ? {} : {contextInspection: inspection, ...(inspectionPrompt === null ? {} : {systemPrompt: inspectionPrompt})},
            pendingInputs: target === null || target === undefined ? [] : pendingViews(target),
            wizardState,
            ...(stopRequestedAt === null ? {} : {stopRequestedAt}),
            composer: {
                models: models === null ? [] : [{key: "", label: deps.text.t(agentText("conversation.followDefault")), supportsImages: false}, ...models, ...(settings.model !== null && settings.model !== undefined && !models.some((item) => item.key === settings.model) && !roles.some((item) => item.key === settings.model) ? [{key: settings.model, label: settings.model, supportsImages: false, unavailable: deps.text.t(agentText("conversation.model.unavailable"))}] : [])],
                roles,
                effectiveModel: model?.ok === true ? models?.find((item) => item.key === model.id)?.label ?? model.id : null,
                modelKey: settings.model ?? "",
                thinkingLevels: model?.ok === true ? [...model.efforts] : [],
                thinking: settings.effort ?? null,
                approval: {options: [...APPROVAL_OPTIONS], value: settings.approvalMode ?? "ask"},
                resume: target?.transcript.interrupted() === true,
                queued: (target?.transcript.queue() ?? []).map((item) => ({id: item.id, text: item.text, delivery: item.mode})),
                draft,
                ...(notice === null ? {} : {notice}),
            },
            usage: usage === undefined ? {} : {
                contextTokens: usage.context ?? 0,
                contextLimit: model?.ok === true && model.contextWindow > 0 ? model.contextWindow : null,
                totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
                input: usage.input,
                output: usage.output,
                cacheRead: usage.cacheRead,
                cacheWrite: usage.cacheWrite,
                // 没有读写缓存的数据时不算：有的服务商不报缓存，写成 0% 会误导。
                cacheHitRate: usage.cacheRead + usage.cacheWrite === 0 ? null : usage.cacheRead / (usage.input + usage.cacheRead + usage.cacheWrite),
                lastCacheHitRate: usage.lastCacheHitRate,
                cost: usage.cost === 0 && usage.unpriced > 0 ? null : usage.cost,
                costState: warnCost > 0 && usage.cost >= warnCost ? "warned" : usage.unpriced > 0 ? "unpriced" : "ok",
            },
            now,
        });
    });

    // 模型库的快照换了（绑定角色、设密钥、改模型）：当前会话解析到的模型可能跟着变。
    const stopWatchingModels = watch(() => deps.models(), () => {
        if (current !== null && !current.loading) void refreshModel(current);
        else modelEpoch += 1;
    }, {flush: "sync"});

    let borrowers = 0;
    let cancelRelease: (() => void) | null = null;

    return {
        ctx,
        sessionId,
        restore,
        open,
        create,
        act,
        borrow() {
            borrowers += 1;
            cancelRelease?.();
            cancelRelease = null;
            // 归零期间取消了订阅：回来时重新打开同一个会话。
            if (current === null && sessionId.value !== null) void open(sessionId.value);
            let returned = false;
            return () => {
                if (returned) return;
                returned = true;
                borrowers -= 1;
                if (borrowers > 0 || disposed) return;
                cancelRelease = deps.schedule(() => {
                    cancelRelease = null;
                    if (borrowers === 0) {
                        // 只放开订阅，当前会话的记号留着。未提交的答案跟着事项走：还在等的话，回来时事项还在、答案也在。
                        const keptState = wizardState;
                        const keptDraft = draftText;
                        closeCurrent();
                        wizardState = keptState;
                        draftText = keptDraft;
                    }
                }, RELEASE_DELAY_MS);
            };
        },
        dispose() {
            disposed = true;
            stopWatchingModels();
            generation += 1;
            cancelRelease?.();
            closeCurrent();
        },
    };
}
