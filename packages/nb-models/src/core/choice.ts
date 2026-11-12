/**
 * 一次模型请求用哪个模型（docs/specs/models/service.md 输出 8）：只定选择的顺序，解析（角色绑定、凭据、目录）在服务核心。
 */

import type {ModelQuery} from "@notnotype/nb-harness/kernel/contracts";

import {MODEL_ROLE_IDS} from "../config/shapes";
import type {ProfileModelDefaults} from "../contract/service";

/** 选中的是一个角色、会话里选的东西（模型引用或 `role:<id>`），或一个模型引用。 */
export type ModelChoice = {readonly role: string} | {readonly selection: string} | {readonly reference: string};

/**
 * 依次：请求点名的角色；用途是压缩时取压缩角色，是审批时取快速档；会话里选的；Profile 缺省的模型；Profile 缺省的角色，
 * 都没有时取主力档。`profileDefaults` 只在走到 Profile 那两步时才调。
 */
export function chooseModel(query: ModelQuery, profileDefaults?: (profile: string) => ProfileModelDefaults): ModelChoice {
    if (query.role !== undefined) return {role: query.role};
    if (query.purpose === "compaction") return {role: MODEL_ROLE_IDS.compaction};
    if (query.purpose === "approval") return {role: MODEL_ROLE_IDS.fast};
    if (query.settings.model !== null) return {selection: query.settings.model};
    const defaults = profileDefaults?.(query.profile) ?? {};
    if (defaults.model !== undefined) return {reference: defaults.model};
    return {role: defaults.role ?? MODEL_ROLE_IDS.main};
}
