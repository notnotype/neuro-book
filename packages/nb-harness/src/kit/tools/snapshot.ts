/**
 * 行锚快照的共用（docs/specs/agent/builtin-tools.md）：同一会话的 `read`、`write`、`edit` 与压缩后的放回认同一份快照。
 */

import {EditStore} from "@oh-my-pi/pi-natives";

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
