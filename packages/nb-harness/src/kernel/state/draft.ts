/** 要写的一条事件：id、seq、时刻、父节点与位置章由会话的 `write` 补上。扩展的输出与内核自己的写入都是这个形状。 */

import type {EventKind, JsonValue, Scope} from "../api/index.js";

export interface EventDraft {
    readonly type: string;
    readonly kind: EventKind;
    readonly scope: Scope;
    readonly data: JsonValue;
    readonly version?: number;
    readonly source?: string;
    readonly cause?: string;
    readonly depth?: number;
    readonly key?: string;
}

