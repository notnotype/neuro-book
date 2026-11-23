/**
 * eval 内核重置的提醒（docs/specs/agent/eval.md）：空闲回收、被登记表回收、两次调用之间意外退出，这三种是当场知道的，以宿主身份给会话发一条
 * 不带唤起的提醒，下一次请求带上；下一次 eval 的结果第一行照旧写“内核已重置”（说两遍）。新一代内核起来、能用之后，撤回还没取走的那条。
 *
 * 每个会话一条串行队列：发送与撤回不会颠倒（旧一代的提醒不会晚于新内核起来才受理）。发送方不管会话开没开：会话表的视图按需打开。
 */

import type {Issuer} from "@notnotype/nb-harness/kernel/contracts";
import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

const EVAL_ISSUER: Issuer = {kind: "host", source: {plugin: "nbook.agent", label: "eval"}};

export interface EvalNotices {
    /** 这一代内核重置了：发一条提醒。 */
    reset(sessionId: string, text: string): void;
    /** 新一代内核能用了：撤回还没取走的提醒。 */
    ready(sessionId: string): void;
}

export function evalNotices(table: SessionTable, newId: () => string, report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void): EvalNotices & {settled(): Promise<void>} {
    const queues = new Map<string, Promise<void>>();
    /** 每个会话还在待发的那条提醒。 */
    const pending = new Map<string, string>();
    const enqueue = (sessionId: string, step: () => Promise<void>) => {
        const next = (queues.get(sessionId) ?? Promise.resolve()).then(step).catch((error: unknown) => report("eval-notice-failed", `an eval kernel notice for session ${sessionId} threw`, {session: sessionId, message: error instanceof Error ? error.message : String(error)}));
        queues.set(sessionId, next);
        void next.then(() => {
            if (queues.get(sessionId) === next) queues.delete(sessionId);
        });
    };
    return {
        reset: (sessionId, text) => enqueue(sessionId, async () => {
            const sent = await table.view(sessionId, EVAL_ISSUER).notice({commandId: newId(), text, key: "eval-kernel", wake: false});
            if (sent.ok) pending.set(sessionId, sent.value.noticeId);
            // 会话表打不开时交回打开的码（不在指令的码表里）：会话不在了就不必说。
            else if ((sent.code as string) !== "session-not-found") report("eval-notice-failed", `could not tell session ${sessionId} its eval kernel was reset: ${sent.code}`, {session: sessionId, code: sent.code});
        }),
        ready: (sessionId) => {
            if (!pending.has(sessionId) && !queues.has(sessionId)) return;
            enqueue(sessionId, async () => {
                const noticeId = pending.get(sessionId);
                pending.delete(sessionId);
                if (noticeId === undefined) return;
                const removed = await table.view(sessionId, EVAL_ISSUER).removeNotice({commandId: newId(), noticeId});
                if (!removed.ok && removed.code !== "notice-taken" && removed.code !== "notice-not-found") report("eval-notice-failed", `could not withdraw the eval kernel notice in session ${sessionId}: ${removed.code}`, {session: sessionId, code: removed.code});
            });
        },
        settled: async () => {
            await Promise.all([...queues.values()]);
        },
    };
}
