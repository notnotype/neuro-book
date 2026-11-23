/**
 * 唤起与门（docs/specs/harness/runtime.md 输出 114、116、117）。门是会话级的开关，只在单写者的受理批与收口批里改：
 * 用户的停止被受理、运行不是正常结束时关；用户自己开起或接着跑一次对话运行时开。带唤起的提醒只在门开着时让空闲的会话开运行。
 */

import type {Issuer, PendingNotice} from "../api/index.js";
import type {EventDraft, SessionCore} from "../dispatch/core.js";
import {byField} from "./input.js";
import {ctrl} from "./writes.js";

export const gateOpen = (core: SessionCore): boolean => core.session.kernel.wakeGate.open;

export const gateDraft = (open: boolean, cause: string): EventDraft => ({type: "wakeGate", kind: "ctrl", scope: "session", data: {open, cause}});

/** 最早那条带唤起的待发提醒：唤起开的运行记成它的发出者开的（输出 116）。 */
export const firstWake = (notices: readonly PendingNotice[]): PendingNotice | undefined => notices.find((notice) => notice.wake);

export const hasWake = (notices: readonly PendingNotice[]): boolean => firstWake(notices) !== undefined;

/**
 * 没有进行中的一轮、也没有就绪的话时，开不开一轮没有输入的（输出 114）：有带唤起的提醒，或这次运行是用户开的、又有提醒。
 * 循环顶部与预览（按用户继续算）共用。
 */
export const opensEmptyTurn = (notices: readonly PendingNotice[], runBy: Issuer | null | undefined): boolean => hasWake(notices) || (notices.length > 0 && runBy?.kind === "user");

export const emptyTurnDraft = (core: SessionCore): EventDraft => ctrl("turnStarted", {turnId: core.newId(), inputId: null});

/** 唤起开的运行：受理时只写 `runStarted`，第一个边界再决定开什么样的一轮（输出 114）。 */
export function wakeRunDrafts(core: SessionCore, by: Issuer): {runId: string; drafts: EventDraft[]} {
    const runId = core.newId();
    return {runId, drafts: [ctrl("runStarted", {runId, kind: "chat", ...byField(by), wake: true})]};
}

/**
 * 这一批里用户开起或接着跑了一次对话运行（`runStarted{kind: "chat"}` 或 `runResumed`，用户的不带 `by`）：开门（输出 117）。
 * 只压缩的运行不算。
 */
export function userRunsChat(drafts: readonly EventDraft[]): boolean {
    return drafts.some((draft) => {
        const data = draft.data as {kind?: string; by?: unknown};
        if (draft.type === "runStarted") return data.kind === "chat" && data.by === undefined;
        return draft.type === "runResumed" && data.by === undefined;
    });
}
