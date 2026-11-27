/**
 * 选窗口与通道失败的换算（docs/specs/agent/page-agent.md 输出 1、2、14）。
 *
 * 会话小表（“这个会话上次用的窗口”）只在内存里，服务端重启后重新选（“状态与转换”的时序与寿命）。同一会话的选窗口串行：
 * 两个并发的 `ui` 调用不会各选各的；“用过”在派发时记，耗时长的调用结束得晚，也不会把表改回它用的那个窗口。
 */

import type {RemoteAccess, RemoteFailure} from "@notnotype/nb-runtime/remote";

import {pageAgentWindowContract} from "../shared/contracts";
import type {WindowInfo} from "../shared/contracts";

/** 窗口类的失败码（失败与恢复表）。 */
export type WindowFailureCode = "no-window" | "window-hidden" | "window-gone" | "window-unresponsive";

export interface WindowFailure {
    readonly ok: false;
    readonly code: WindowFailureCode;
    readonly message: string;
    /** 通道的原码（输出 14）。 */
    readonly cause?: string;
}

export interface SelectedWindow {
    readonly ok: true;
    readonly id: string;
    readonly info: WindowInfo;
}

export interface WindowSession {
    readonly id: string;
    /** 会话所属作品的 id；不属于任何作品时没有。 */
    readonly project?: string;
}

/** 上次用的窗口在这么久里用过才优先（输出 1）。 */
export const RECENT_WINDOW_MS = 2 * 60 * 1000;
/** 选窗口时问每个候选的时限（计划的选窗口一节）。 */
export const PROBE_TIMEOUT_MS = 800;
/** 会话小表至多记这么多个会话，最久没用的先丢。 */
const SESSION_LIMIT = 256;

export interface WindowSelector {
    select(session: WindowSession, signal: AbortSignal): Promise<SelectedWindow | WindowFailure>;
}

export function createWindowSelector(remote: () => RemoteAccess, now: () => number): WindowSelector {
    const recent = new Map<string, {readonly instance: string; readonly usedAt: number}>();
    const pending = new Map<string, Promise<unknown>>();

    const remember = (session: string, instance: string): void => {
        recent.delete(session);
        recent.set(session, {instance, usedAt: now()});
        if (recent.size > SESSION_LIMIT) recent.delete(recent.keys().next().value!);
    };

    const pick = async (session: WindowSession, signal: AbortSignal): Promise<SelectedWindow | WindowFailure> => {
        const listed = await remote().instances();
        if (!listed.ok) return {ok: false, code: "window-unresponsive", message: "查不到打开的窗口，稍后重试", cause: listed.code};
        const clients = listed.value.filter((instance) => instance.role === "client");
        const candidates = clients.filter((instance) => (session.project === undefined ? instance.project === null : instance.project?.id === session.project));
        if (candidates.length === 0) {
            const message = clients.length === 0 ? "没有打开的 NeuroBook 窗口：请用户打开一个"
                : session.project === undefined ? "没有书架窗口：这个会话不属于任何作品，只能用不打开作品的窗口"
                : "没有打开这部作品的窗口：请用户在 NeuroBook 里打开这部作品";
            return {ok: false, code: "no-window", message};
        }
        const probes = await Promise.all(candidates.map(async (instance) => ({
            id: instance.id,
            result: await remote().use(pageAgentWindowContract).at({client: instance.id}).info({}, {signal, timeout: PROBE_TIMEOUT_MS}),
        })));
        const answered: SelectedWindow[] = [];
        // 没应答的与要刷新的各记第一个原码，交回时放进 cause（输出 14）。探测途中窗口关了（target-gone）当作这个候选不在。
        let unresponsive: string | null = null;
        let stale: string | null = null;
        for (const {id, result} of probes) {
            if (result.ok) answered.push({ok: true, id, info: result.value});
            else if (result.code === "not-provided" || result.code === "version-changed") stale ??= result.code;
            else if (result.code !== "target-gone" && result.code !== "cancelled") unresponsive ??= result.code;
        }
        if (answered.length === 0) {
            if (signal.aborted) return {ok: false, code: "window-unresponsive", message: "调用已停止", cause: "cancelled"};
            if (unresponsive !== null) return {ok: false, code: "window-unresponsive", message: "打开这部作品的窗口都没有应答，稍后重试", cause: unresponsive};
            if (stale !== null) return {ok: false, code: "no-window", message: "窗口要刷新：请用户刷新 NeuroBook 窗口", cause: stale};
            return {ok: false, code: "no-window", message: "没有可用的窗口：请用户打开或切回 NeuroBook 窗口"};
        }
        const byInput = (a: SelectedWindow, b: SelectedWindow): number => (b.info.lastInputAt ?? -Infinity) - (a.info.lastInputAt ?? -Infinity);
        const last = recent.get(session.id);
        const chosen = answered.find((window) => last !== undefined && window.id === last.instance && window.info.visible && now() - last.usedAt <= RECENT_WINDOW_MS)
            ?? answered.find((window) => window.info.focused && window.info.visible)
            ?? answered.filter((window) => window.info.visible).sort(byInput)[0]
            // 都看不见时取最近有输入的那个：快照与目录照常，截图与高亮由调用方报 window-hidden。
            ?? [...answered].sort(byInput)[0]!;
        remember(session.id, chosen.id);
        return chosen;
    };

    return {
        select: (session, signal) => {
            const previous = pending.get(session.id) ?? Promise.resolve();
            const run = previous.then(() => pick(session, signal), () => pick(session, signal));
            pending.set(session.id, run);
            void run.finally(() => {
                if (pending.get(session.id) === run) pending.delete(session.id);
            });
            return run;
        },
    };
}

/** 调用与等待阶段的通道失败（输出 14 的表）。 */
export function callFailure(failure: RemoteFailure): WindowFailure {
    switch (failure.code) {
        case "target-gone":
            return {ok: false, code: "window-gone", message: "窗口在调用途中断开或刷新了：重新快照，再做这一步", cause: failure.code};
        case "unavailable":
            // 窗口确认收到之前链路就断了：对用户同样是窗口刷新或关了，重试会落到刷新后的新页面上。
            if (failure.cause === "disconnected") return {ok: false, code: "window-gone", message: "窗口在调用途中断开或刷新了：重新快照，再做这一步", cause: failure.code};
            return {ok: false, code: "window-unresponsive", message: "窗口没有在时限内应答，稍后重试", cause: failure.code};
        case "not-provided":
        case "version-changed":
            return {ok: false, code: "no-window", message: "窗口要刷新：请用户刷新 NeuroBook 窗口", cause: failure.code};
        default:
            return {ok: false, code: "window-unresponsive", message: "窗口没有在时限内应答，稍后重试", cause: failure.code};
    }
}
