/**
 * `@notnotype/nb-harness/kit/sessions`：会话的句柄表（docs/specs/agent/sessions.md）与自动生成的标题和说明
 * （docs/specs/agent/builtin-profiles.md）。标题 Profile、扩展 id 与给标题模型的材料由宿主给。
 */

export {HISTORY_COMMANDS, IDLE_CLOSE_MS, SessionTable, SessionTableStopping, SessionUnavailable} from "./table.js";
export type {HistoryCommand, SessionHold, SessionTableClock, SessionTableOptions} from "./table.js";
export {isTitleSessionId, SessionMeta, sessionMetaExtension, titleSessionId} from "./meta.js";
export type {MetaTrigger, SessionMetaOptions} from "./meta.js";
