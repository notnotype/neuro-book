import {PUBLIC_EVENT_MAX_BYTES} from "nbook/shared/agent/public-event-limits";

/** 单个工具在 live runtime 中最多公开的正文预览字节数。 */
export const LIVE_TOOL_PREVIEW_BYTES = 16 * 1024;

/** 单个 assistant message 最多保留的 live tool-call accumulator 数量。 */
export const PUBLIC_RUNTIME_TOOL_CALLS = 32;

/** 同一 assistant message 内 live tool-call preview 的 aggregate 字节预算。 */
export const PUBLIC_RUNTIME_TOOL_PREVIEW_BYTES = 64 * 1024;

/** 单个工具结果 content blocks 共享的正文预览预算。 */
export const PUBLIC_TOOL_RESULT_CONTENT_BYTES = 16 * 1024;

/** 单个工具结果 details 共享的文本预览预算。 */
export const PUBLIC_TOOL_RESULT_DETAILS_BYTES = 16 * 1024;

/** preview 达限后，工具参数累计字节进度的发布步长。 */
export const LIVE_TOOL_PROGRESS_BYTES = 16 * 1024;

export {PUBLIC_EVENT_MAX_BYTES};

/** 正常公开 payload 的目标上限；为 SSE envelope 和 JSON 转义保留余量。 */
export const PUBLIC_EVENT_TARGET_BYTES = 96 * 1024;

/** 必须精确送达并等待 ack 的 client variable patch 请求上限。 */
export const PUBLIC_CLIENT_VARIABLE_PATCH_BYTES = 64 * 1024;

/** Abort 等控制事件的用户可读原因预览上限。 */
export const PUBLIC_CONTROL_REASON_BYTES = 2 * 1024;

/** 单个或一组公开工具参数共享的文本预算。 */
export const PUBLIC_TOOL_ARGS_TEXT_BYTES = 24 * 1024;

/** apply_patch touched files 共享的路径预算。 */
export const PUBLIC_PATCH_PATHS_BYTES = 8 * 1024;

/** assistant 正文、thinking、error 共享的文本预算。 */
export const PUBLIC_ASSISTANT_TEXT_BYTES = 64 * 1024;

/** 单条 assistant 最多公开的 toolCall 数量。 */
export const PUBLIC_ASSISTANT_TOOL_CALLS = 32;

/** Agent waiting 轻量表单的最大 UTF-8 JSON 字节数。 */
export const PUBLIC_AGENT_FORM_BYTES = 32 * 1024;

/** Session 标题在公开列表、recovery 与 live state 中的最大 UTF-8 字节数。 */
export const PUBLIC_SESSION_TITLE_BYTES = 2 * 1024;

/** Session 摘要在公开列表、recovery 与 live state 中的最大 UTF-8 字节数。 */
export const PUBLIC_SESSION_SUMMARY_BYTES = 8 * 1024;

/** Profile 加载问题在公开 session 摘要中的最大 UTF-8 字节数。 */
export const PUBLIC_SESSION_ISSUE_BYTES = 2 * 1024;

/** Summarizer 最近错误在公开 session shell 中的最大 UTF-8 字节数。 */
export const PUBLIC_SUMMARIZER_ERROR_BYTES = 2 * 1024;

/** 阻塞 Invocation HTTP 结果中的最终 assistant 正文预览上限。 */
export const PUBLIC_INVOCATION_FINAL_MESSAGE_BYTES = 64 * 1024;

/** 阻塞 Invocation HTTP 结果中 finalMessage 与 report_result.result 共享的 JSON 字符串预算。 */
export const PUBLIC_INVOCATION_TEXT_SERIALIZED_BYTES = 64 * 1024;

/** 阻塞 Invocation HTTP 结果中的错误正文预览上限。 */
export const PUBLIC_INVOCATION_ERROR_BYTES = 8 * 1024;

/** 未知结构预览的最大递归深度。 */
export const PUBLIC_VALUE_MAX_DEPTH = 5;

/** 未知对象每层最多公开的字段数。 */
export const PUBLIC_VALUE_MAX_ENTRIES = 32;

/** 未知数组每层最多公开的元素数。 */
export const PUBLIC_VALUE_MAX_ITEMS = 32;

/** 单个 unknown 公开预览最多遍历的结构节点数。 */
export const PUBLIC_VALUE_MAX_NODES = 256;

/** edit 公开参数最多保留的 replacement 数量。 */
export const PUBLIC_EDIT_MAX_ITEMS = 32;

/** patch 公开 touched files 的最大数量。 */
export const PUBLIC_PATCH_MAX_FILES = 64;

/** 单个公开路径的最大 UTF-8 字节数。 */
export const PUBLIC_PATH_MAX_BYTES = 2 * 1024;

/** Provider tool-call identity 的公开与执行前硬上限。非法 identity 直接 fail closed。 */

/** 工具名称在 runtime、waiting、durable history 和 Session Tree 中共享的公开上限。 */
export const PUBLIC_TOOL_NAME_BYTES = 512;

/** Session Tree 节点摘要和标签的公开上限；节点身份字段保持原值。 */
export const PUBLIC_TREE_TEXT_BYTES = 512;

/** 工具结果最多公开的 content block 数量。 */
export const PUBLIC_TOOL_RESULT_MAX_BLOCKS = 32;

/** durable Chat Flow 文本的最大公开预览字节数。 */
export const CHAT_ENTRY_PREVIEW_BYTES = 64 * 1024;

/** user text blocks 在 JSON 字符串转义后的共享预算。 */
export const CHAT_ENTRY_SERIALIZED_TEXT_BYTES = 64 * 1024;

/** 单条 durable user Chat Flow entry 最多公开的有序内容块数量。 */
export const CHAT_ENTRY_MAX_BLOCKS = 32;
