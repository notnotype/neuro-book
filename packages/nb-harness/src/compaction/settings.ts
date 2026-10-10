/**
 * Profile 注册字段 harness/compaction 的 schema 与缺省值（docs/specs/harness/compaction.md 输出 10）。
 * 字段值的校验归 Profile 主机（按这里的 schema）；本模块只填缺省值。
 */

import Type from "typebox";
import type {CompactionSettings} from "./types";

const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const DEFAULT_THRESHOLD_PERCENT = 80;

const CompactionField = Type.Object(
    {
        methods: Type.Optional(Type.Array(Type.String({minLength: 1}), {minItems: 1, uniqueItems: true})),
        keepRecentTokens: Type.Optional(Type.Integer({minimum: 1})),
        reserveTokens: Type.Optional(Type.Integer({minimum: 1})),
        threshold: Type.Optional(Type.Union([
            Type.Object({tokens: Type.Integer({minimum: 1})}, {additionalProperties: false}),
            Type.Object({percent: Type.Integer({minimum: 1, maximum: 99})}, {additionalProperties: false}),
        ])),
        instructions: Type.Optional(Type.String()),
    },
    {additionalProperties: false},
);

export const COMPACTION_FIELD = Object.freeze({id: "harness/compaction", schema: CompactionField});

function deepFreeze<T>(value: T): T {
    if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
    for (const item of Object.values(value as object)) deepFreeze(item);
    return Object.freeze(value);
}

/** 已按 schema 校验过的字段值（或没有字段）→ 填好缺省值、深冻结的设置；给出的键覆盖缺省值。 */
export function resolveCompactionSettings(field: unknown): CompactionSettings {
    const given = typeof field === "object" && field !== null && !Array.isArray(field) ? (field as Partial<CompactionSettings>) : {};
    const settings: CompactionSettings = {
        methods: [...(given.methods ?? ["soft"])],
        keepRecentTokens: given.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS,
        threshold: given.threshold === undefined ? {percent: DEFAULT_THRESHOLD_PERCENT} : {...given.threshold},
        ...(given.reserveTokens === undefined ? {} : {reserveTokens: given.reserveTokens}),
        ...(given.instructions === undefined ? {} : {instructions: given.instructions}),
    };
    return deepFreeze(settings);
}
