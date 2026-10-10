/** 每个会话一个 OMP EditStore（docs/specs/harness/builtin-tools.md 输出 7）：隔离的是展示过的行与快照记录；标签本身是内容哈希，不是会话私有的令牌。 */

import {EditStore} from "@oh-my-pi/pi-natives";
import type {SnapshotStores} from "./types";

export function createSnapshotStores(): SnapshotStores {
    const stores = new Map<string, EditStore>();
    return {
        forSession(sessionId) {
            let store = stores.get(sessionId);
            if (store === undefined) {
                store = new EditStore();
                stores.set(sessionId, store);
            }
            return store;
        },
        release(sessionId) {
            stores.delete(sessionId);
        },
    };
}
