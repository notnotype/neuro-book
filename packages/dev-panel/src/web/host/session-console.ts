import {computed, effectScope, onScopeDispose, ref, shallowRef, watch, type EffectScope, type Ref} from "vue";
import {ApiError, getJson, sendJson} from "./api.js";
import {shortSession} from "./format.js";
import {deliveryNotice} from "./notify-actions.js";
import {panelState} from "./panel-data.js";
import {useTerminalSocket, type TerminalSocket} from "./terminal-socket.js";
import type {DeliveryData, HistoryData, ScreenData} from "./types.js";
import {describeFailure, type Notice} from "./writes.js";

/**
 * 会话页（宿主）对选中会话的操作：终端连接、读屏与更早的输出、发文字、发按键、两步确认、接管小窗。合同见 docs/panel.md 的
 * “通知与会话页”“网页终端”。所有动作都绑定发起时的目标 `{paneId, terminalId, sessionKey}`（t15 阶段 1.1）：
 * - 两步确认与接管小窗记下打开时的目标；确认那一刻选中的目标变了就不发，给一条提示。服务端的 `expectedSession` 照旧核对，
 *   挡住“面板还没轮询到会话已换”的窗口；
 * - 读屏、读更早的输出带序号，回来时目标还是发起时的那个才写；按键的确认框用这次读到的屏幕，没读到时注明框里是多久以前的画面；
 * - 输入框的草稿按 pane 记：换 pane 时经 `resetKey` 清空；同一格换会话（`/compact`、`/clear`）时保留，给出 `sessionChange` 提示；
 *   发送成功的回包只在还是同一格（pane 加终端）时清草稿：发的若是 `/clear`，回包到时这格多半已换了会话，输入框里的就是刚发出去的字。
 * 终端连接按 `paneId + terminalId` 建（重新登录后也重建），每建一条连接 `connection` 加一，页面拿它给终端零件当 key
 * （`source` 在零件实例的一生里不变）。
 */

export type ConsoleTarget = {paneId: string; terminalId: string; sessionKey: string};
/** 一次读屏的结果；目标没了或回来时目标已经变了为 null。 */
export type ScreenRead = {ok: true; data: ScreenData} | {ok: false; message: string} | null;
export type SelectedSession = ConsoleTarget & {agent: string | null; status: string};

export function sameTarget(a: ConsoleTarget | null, b: ConsoleTarget | null): boolean {
    return samePane(a, b) && a?.sessionKey === b?.sessionKey;
}

/** 同一格（pane 加终端），不管会话：草稿按格记。 */
export function samePane(a: ConsoleTarget | null, b: ConsoleTarget | null): boolean {
    return a !== null && b !== null && a.paneId === b.paneId && a.terminalId === b.terminalId;
}

const label = (target: ConsoleTarget) => `${shortSession(target.sessionKey)}（窗格 ${target.paneId}）`;

function ago(iso: string): string {
    const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1_000));
    return seconds < 90 ? `${seconds} 秒前` : `${Math.round(seconds / 60)} 分钟前`;
}

/** 要两步确认的键：确认框里写将要发生什么。 */
export const KEY_CONFIRM: Record<string, {label: string; message: string}> = {
    "shift+tab": {label: "Shift+Tab", message: "将按下 Shift+Tab：切换会话的权限模式（例如进出计划模式、自动接受编辑）。"},
    enter: {label: "Enter", message: "将按下 Enter：会提交输入框，或确认确认界面上的缺省项（可能是“允许执行”）。"},
    esc: {label: "Esc", message: "将按下 Esc：打断会话正在做的这一轮。"},
    "ctrl+c": {label: "Ctrl+C", message: "将按下 Ctrl+C：打断会话；Claude 连按两次会退出，同一会话 3 秒内只能按一次。"},
    y: {label: "y", message: "将按下 y：回答确认界面。y 能不能回答 Claude 的确认界面还没有核实，可能批准一次危险的工具调用。"},
    n: {label: "n", message: "将按下 n：回答确认界面（还没有核实是否有效）。"},
};

type ConfirmAction = {kind: "prompt"; text: string; digest: string} | {kind: "key"; key: string};
export type ConsoleConfirm = {target: ConsoleTarget; title: string; message: string; screen: string | null; confirmLabel: string; action: ConfirmAction};
export type TakeoverAsk = {target: ConsoleTarget; cols: number; rows: number; force: boolean};
export type TakeoverConflict = {reason: "controlled_elsewhere" | "other_browser"; text: string | null; since: string | null};

const RELEASE_WHY: Record<string, string> = {user: "你点了释放", hidden: "页面切到了后台", heartbeat: "15 秒没有心跳", idle: "15 分钟没有输入", taken_over: "被别处接管或断开", pane_closed: "终端不在了", panel_exit: "面板退出", disconnect: "连接断开", session_closed: "登录失效"};
const NOT_RESTORED: Record<string, string> = {size_unknown: "读不到接管前的尺寸，没有改回", handed_off: "交给了另一个浏览器", stream_ended: "流已经结束，没有改回"};

export function useSessionConsoleHost(options: {selected: Ref<SelectedSession | null>; terminalAvailable: Ref<boolean>}) {
    const {selected} = options;
    const current = computed<ConsoleTarget | null>(() => (selected.value ? {paneId: selected.value.paneId, terminalId: selected.value.terminalId, sessionKey: selected.value.sessionKey} : null));

    // ---- 终端连接 ----
    const terminal = shallowRef<TerminalSocket | null>(null);
    const connection = ref(0);
    let terminalScope: EffectScope | null = null;
    // 重新登录之后（`authEpoch` 变了）也重建连接：失效期间旧连接停在“登录已失效”或不再重连。
    watch(() => (current.value && options.terminalAvailable.value && !panelState.unauthorized ? `${current.value.paneId}\0${current.value.terminalId}\0${panelState.authEpoch}` : null), (key) => {
        terminalScope?.stop();
        terminalScope = null;
        terminal.value = null;
        if (!key || !current.value) return;
        const target = {paneId: current.value.paneId, terminalId: current.value.terminalId};
        terminalScope = effectScope();
        terminal.value = terminalScope.run(() => useTerminalSocket(target)) ?? null;
        connection.value += 1;
    }, {immediate: true});
    onScopeDispose(() => terminalScope?.stop());

    // ---- 状态 ----
    const screen = ref<ScreenData | null>(null);
    const screenAt = ref<string | null>(null);
    const history = ref<{text: string; lines: number; at: string} | null>(null);
    const historyPending = ref(false);
    const pending = ref(false);
    const notice = ref<Notice | null>(null);
    const resetKey = ref(0);
    /** 同一格 pane 换了会话：草稿保留，输入框上方提示发出去会发给新会话。 */
    const sessionChange = ref<{from: string; to: string} | null>(null);
    const confirm = ref<ConsoleConfirm | null>(null);
    const takeoverAsk = ref<TakeoverAsk | null>(null);
    const lastConflict = ref<TakeoverConflict | null>(null);
    /** 最近一次发起接管的目标与按接管后的框算出的尺寸：“抢过来”沿用它。 */
    let requested: {target: ConsoleTarget; cols: number; rows: number} | null = null;
    let readSequence = 0;

    function targetChanged(from: ConsoleTarget, to: ConsoleTarget | null): Notice {
        return {outcome: "conflict", title: "目标变了，没有发送", message: `确认框打开期间目标从 ${label(from)} 变成了 ${to ? label(to) : "没有选中的会话"}；需要的话对现在的会话重新操作`, items: [], notes: [], retry: false};
    }

    watch(current, (next, previous) => {
        if (sameTarget(next, previous ?? null) || (!next && !previous)) return;
        readSequence += 1;
        if (confirm.value) notice.value = targetChanged(confirm.value.target, next);
        else notice.value = null;
        if (takeoverAsk.value) notice.value = targetChanged(takeoverAsk.value.target, next);
        confirm.value = null;
        takeoverAsk.value = null;
        lastConflict.value = null;
        requested = null;
        screen.value = null;
        screenAt.value = null;
        history.value = null;
        if (previous && next && previous.paneId === next.paneId) {
            sessionChange.value = {from: sessionChange.value?.from ?? previous.sessionKey, to: next.sessionKey};
        } else {
            sessionChange.value = null;
            resetKey.value += 1;
        }
        if (next) void readScreen();
    }, {immediate: true});

    /** 读一次屏幕；只有最后发起的那次写进状态，但每次都把自己的结果交回调用方（确认框要的是这一次读到的）。 */
    async function readScreen(): Promise<ScreenRead> {
        const target = current.value;
        // 会话键为空的是非 Agent 的 pane（只读观看，D2）：读屏接口按会话核对目标，没有会话可核对。
        if (!target || target.sessionKey === "") return null;
        const mine = ++readSequence;
        try {
            const body = await getJson<ScreenData>(`/api/sessions/${encodeURIComponent(target.paneId)}/screen?session=${encodeURIComponent(target.sessionKey)}`);
            if (!sameTarget(target, current.value)) return null;
            if (mine === readSequence) {
                screen.value = body.data;
                screenAt.value = new Date().toISOString();
            }
            return {ok: true, data: body.data};
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (!sameTarget(target, current.value)) return null;
            if (mine === readSequence) notice.value = {outcome: "failure", title: "读不到屏幕", message: error.message, items: [], notes: [], retry: false};
            return {ok: false, message: error.message};
        }
    }

    /** 更早的输出（手机的文字视图，只给 omp）：点一次读一次，不轮询。 */
    async function readHistory(): Promise<void> {
        const target = current.value;
        if (!target) return;
        historyPending.value = true;
        try {
            const body = await getJson<HistoryData>(`/api/sessions/${encodeURIComponent(target.paneId)}/history?session=${encodeURIComponent(target.sessionKey)}`);
            if (!sameTarget(target, current.value)) return;
            history.value = {text: body.data.text, lines: body.data.lines, at: new Date().toISOString()};
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            if (!sameTarget(target, current.value)) return;
            notice.value = {outcome: "failure", title: "读不到更早的输出", message: error.message, items: [], notes: [], retry: false};
        } finally {
            historyPending.value = false;
        }
    }

    async function sendPrompt(text: string, confirmScreen: string | null = null, target: ConsoleTarget | null = current.value): Promise<void> {
        if (!target) return;
        pending.value = true;
        notice.value = null;
        try {
            const body = await sendJson<DeliveryData>("POST", `/api/sessions/${encodeURIComponent(target.paneId)}/prompt`, {text, expectedSession: target.sessionKey, confirmScreen});
            notice.value = deliveryNotice(body.data, target.paneId);
            const written = body.data.result !== "not_deliverable" && body.data.result !== "agent_blocked" && body.data.result !== "session_changed";
            // 回包回来时已经换到别的格：不清那边的草稿。同一格换了会话（发的就是 `/clear`）照样清，并收起“会话换了”的提示。
            if (written && samePane(target, current.value)) {
                resetKey.value += 1;
                sessionChange.value = null;
            }
        } catch (error) {
            if (error instanceof ApiError && error.code === "not_deliverable" && typeof error.details.screenDigest === "string") {
                if (sameTarget(target, current.value)) {
                    confirm.value = {
                        target,
                        title: confirmScreen === null ? "输入框不是认得出的空" : "屏幕变了，再看一次",
                        message: `${target.paneId} 的输入框里可能有字、开着菜单或别的界面（${error.message}）。看过屏幕再决定：仍然发送会把你的文字连同回车打进去。`,
                        screen: typeof error.details.screen === "string" ? error.details.screen : null,
                        confirmLabel: "仍然发送",
                        action: {kind: "prompt", text, digest: error.details.screenDigest},
                    };
                } else {
                    // 目标已经换了：不再问“仍然发送”，但要说清这段没发出去；换了格时输入框也已清空，附上原文。
                    notice.value = {outcome: "failure", title: "没有发出去", message: `给 ${label(target)} 的文字没有发出去（${error.message}）；目标已经换了，没有再问`, items: samePane(target, current.value) ? [] : [`原文：${text}`], notes: [], retry: false};
                }
            } else {
                notice.value = {outcome: "failure", title: "没有发出去", message: describeFailure(error).message, items: [], notes: [], retry: false};
            }
        } finally {
            pending.value = false;
            if (sameTarget(target, current.value)) await readScreen();
        }
    }

    async function sendKey(target: ConsoleTarget, key: string, confirmed: boolean): Promise<void> {
        pending.value = true;
        notice.value = null;
        try {
            await sendJson<{sent: string[]}>("POST", `/api/sessions/${encodeURIComponent(target.paneId)}/keys`, {keys: [key], expectedSession: target.sessionKey, ...(confirmed ? {confirmed: true} : {})});
            notice.value = {outcome: "success", title: "已按下", message: `${KEY_CONFIRM[key]?.label ?? key} → ${target.paneId}`, items: [], notes: [], retry: false};
        } catch (error) {
            notice.value = {outcome: "failure", title: "没有按下", message: describeFailure(error).message, items: [], notes: [], retry: false};
        } finally {
            pending.value = false;
            if (sameTarget(target, current.value)) await readScreen();
        }
    }

    /** 按键：接管期间经终端连接单击即发；要确认的键先重读屏幕、开确认框，确认框记下这时的目标。 */
    async function pressKey(key: string): Promise<void> {
        const target = current.value;
        if (!target) return;
        if (terminal.value?.state.mode === "control") {
            terminal.value.key(key);
            return;
        }
        const confirmKey = KEY_CONFIRM[key];
        if (!confirmKey) {
            await sendKey(target, key, false);
            return;
        }
        const read = await readScreen();
        // 读屏期间目标变了：不开确认框（目标变化的 watch 已经清过状态）。
        if (read === null || !sameTarget(target, current.value)) return;
        // 这次没读到也开框（Esc、Ctrl+C 常在会话失控时用，不能因为读屏偶发失败就按不下去），但写明框里是旧画面。
        const earlier = screen.value && screenAt.value ? {text: screen.value.screen, at: screenAt.value} : null;
        const message = read.ok ? confirmKey.message : `${confirmKey.message}这次没读到屏幕（${read.message}）${earlier ? `，下面是 ${ago(earlier.at)}读到的画面，现在可能已经不一样了` : "，看不到会话现在的样子"}。`;
        confirm.value = {target, title: `将按下 ${confirmKey.label}`, message, screen: read.ok ? read.data.screen : earlier?.text ?? null, confirmLabel: `按下 ${confirmKey.label}`, action: {kind: "key", key}};
    }

    async function confirmRun(): Promise<void> {
        const opened = confirm.value;
        if (!opened) return;
        if (!sameTarget(opened.target, current.value)) {
            confirm.value = null;
            notice.value = targetChanged(opened.target, current.value);
            return;
        }
        if (opened.action.kind === "prompt") await sendPrompt(opened.action.text, opened.action.digest, opened.target);
        else await sendKey(opened.target, opened.action.key, true);
        if (confirm.value === opened) confirm.value = null;
    }

    function cancelConfirm(): void {
        confirm.value = null;
    }

    // ---- 接管 ----
    function askTakeover(cols: number, rows: number): void {
        const target = current.value;
        if (!target) return;
        requested = {target, cols, rows};
        takeoverAsk.value = {target, cols, rows, force: false};
    }

    function confirmTakeover(): void {
        const ask = takeoverAsk.value;
        if (!ask) return;
        takeoverAsk.value = null;
        if (!sameTarget(ask.target, current.value) || !terminal.value) {
            notice.value = targetChanged(ask.target, current.value);
            return;
        }
        terminal.value.takeover(ask.cols, ask.rows, ask.target.sessionKey, ask.force);
    }

    function cancelTakeover(): void {
        takeoverAsk.value = null;
        lastConflict.value = null;
    }

    watch(() => terminal.value?.state.notice ?? null, (terminalNotice) => {
        const socket = terminal.value;
        if (!terminalNotice || !socket) return;
        if (terminalNotice.kind === "need_confirm") {
            // “抢过来”沿用发起接管时的目标与尺寸；目标已经变了就不再问。
            if (requested && sameTarget(requested.target, current.value)) {
                takeoverAsk.value = {target: requested.target, cols: requested.cols, rows: requested.rows, force: true};
                lastConflict.value = {reason: terminalNotice.reason, text: terminalNotice.text, since: terminalNotice.since};
            }
        } else if (terminalNotice.kind === "released") {
            notice.value = {outcome: terminalNotice.reason === "user" ? "info" : "conflict", title: "已释放键盘", message: `${RELEASE_WHY[terminalNotice.reason] ?? terminalNotice.reason}；${terminalNotice.restored ? "终端尺寸已改回" : NOT_RESTORED[terminalNotice.notRestored ?? ""] ?? "尺寸没有改回"}`, items: [], notes: [], retry: false};
        } else {
            notice.value = {outcome: "failure", title: "没有接管", message: terminalNotice.message, items: [], notes: [], retry: false};
        }
        socket.dismissNotice();
    });

    return {
        current, terminal, connection,
        screen, screenAt, history, historyPending, pending, notice, resetKey, sessionChange,
        confirm, takeoverAsk, lastConflict,
        readScreen, readHistory, sendPrompt, pressKey, confirmRun, cancelConfirm,
        askTakeover, confirmTakeover, cancelTakeover,
    };
}

export type SessionConsoleHost = ReturnType<typeof useSessionConsoleHost>;
