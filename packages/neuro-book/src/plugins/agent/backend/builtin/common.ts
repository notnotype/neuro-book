/**
 * 内置工具共用的小件（docs/specs/agent/builtin-tools.md）：失败结果、全局地址与按会话共用的行锚快照。
 */

import {EditStore} from "@oh-my-pi/pi-natives";

import type {ToolResult} from "@notnotype/nb-harness/kernel/contracts";

import type {Expanded, SessionResources} from "../../shared/resources";

/** 码同时放在结果与 `details`：内核的事件读前者，工具的调用方按后者判断，都不看文字。 */
export const failed = (code: string, text: string): ToolResult => ({text, status: "error", code, details: {code}});
export const failure = (result: {readonly code: string; readonly detail: string}): ToolResult => failed(result.code, `${result.code}: ${result.detail}`);

/** 全局地址；改写不了时交回失败结果。 */
export function globalAddress(resources: SessionResources, address: string): Extract<Expanded, {ok: true}> | {readonly ok: false; readonly failure: ToolResult} {
    const expanded = resources.expand(address);
    return expanded.ok ? expanded : {ok: false, failure: failure(expanded)};
}

export const joinAddress = (base: string, relative: string): string => (base.endsWith("://") || base.endsWith("/") ? `${base}${relative}` : `${base}/${relative}`);

/**
 * 同一会话的 `read`、`write`、`edit` 共用一份快照：`read` 给的行锚 `edit` 要认得。每个工具的实现是分开建的（每个会话每个工具一个），
 * 所以按会话引用计数；工具都释放后清掉。
 */
export class SessionEditStores {
    readonly #held = new Map<string, {readonly store: EditStore; holders: number}>();

    acquire(sessionId: string): {readonly store: EditStore; release(): void} {
        let entry = this.#held.get(sessionId);
        if (entry === undefined) this.#held.set(sessionId, (entry = {store: new EditStore(), holders: 0}));
        entry.holders += 1;
        const held = entry;
        let released = false;
        return {
            store: held.store,
            release: () => {
                if (released) return;
                released = true;
                held.holders -= 1;
                if (held.holders === 0 && this.#held.get(sessionId) === held) this.#held.delete(sessionId);
            },
        };
    }
}
