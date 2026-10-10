/** 运行时登记到 Profile 主机的字段（docs/specs/harness/runtime.md 输入规则“注册字段”）。 */

import Type from "typebox";
import {COMPACTION_FIELD} from "../compaction/compaction";
import {MODEL_FIELD} from "../models/models";
import type {ProfileHost} from "../profile/profile";

export const TOOLS_FIELD = Object.freeze({id: "harness/tools", schema: Type.Array(Type.String({minLength: 1}), {uniqueItems: true})});
export const APPROVAL_FIELD = Object.freeze({id: "harness/approval", schema: Type.Union([Type.Literal("always-ask"), Type.Literal("write"), Type.Literal("auto"), Type.Literal("yolo")])});

/** 使用方可能先注册过同名字段，重复不算错；其它失败说明主机状态不对，直接抛出。 */
export function registerRuntimeFields(host: ProfileHost): void {
    for (const field of [TOOLS_FIELD, APPROVAL_FIELD, MODEL_FIELD, COMPACTION_FIELD]) {
        const result = host.registerField(field);
        if (!result.ok && result.code !== "duplicate-registration") throw new Error(`注册字段 ${field.id} 失败：${result.detail}`);
    }
}
