/**
 * `@notnotype/nb-harness/kit/compaction`：内置的三种压缩方法与压缩后的放回（docs/specs/agent/compaction.md）。摘要的提示词与内置
 * 工具在宿主里的 id 由宿主给；方法 id、缺省顺序与贡献机制是宿主的事。
 */

import type {CompactionMethodImpl} from "../../kernel/contracts.js";
import {inplaceMethod} from "./inplace.js";
import {shakeMethod} from "./shake.js";
import {summaryMethod} from "./summary.js";
import type {BuiltinToolIds, CompactionPrompts} from "./types.js";

export {KEEP_TOKENS, keptMessageIndex, pickCut, summaryResult} from "./cuts.js";
export {modelFailure, outputLimit, responseText, sumUsage} from "./replies.js";
export {CompactionRestore, recentFiles} from "./restore.js";
export type {RestoreOptions} from "./restore.js";
export {segmentsOf} from "./summary.js";
export type {BuiltinToolIds, CompactionPrompts} from "./types.js";

/** 三种方法：shake 不调模型，换占位；就地压缩用会话的模型、前缀与对话请求相同；摘要用“压缩”角色的模型（`MODEL_ROLES.compaction`）。 */
export function compactionMethods(options: {readonly prompts: CompactionPrompts; readonly tools: BuiltinToolIds}): {readonly shake: CompactionMethodImpl; readonly inplace: CompactionMethodImpl; readonly summary: CompactionMethodImpl} {
    return {shake: shakeMethod(options.tools), inplace: inplaceMethod(options.prompts), summary: summaryMethod(options.prompts)};
}
