/**
 * 自动压缩的触发点（docs/specs/models/service.md 输出 17）：全局设置与按模型的配置用同一个形状，算成 token 数交给内核；
 * 内核只认 `compactAt`，缺省按窗口留预留量。纯函数，不读设置。
 */

import {Type} from "typebox";
import type {Static} from "typebox";

/** 缺省的预留量与内核（`nb-harness` 的 `triggerPoint`）一致：窗口的 15% 与 16,384 中较大的一个。 */
const RESERVE_SHARE = 0.15;
const RESERVE_FLOOR = 16_384;

/**
 * `reserve`：留预留量（`value` 把窗口当成这个数来算，可不写）；`percent`：窗口的百分比，1 到 100；`tokens`：固定的触发点。
 * 三种模式各一个分支：百分比不能超过 100、固定值必须写，校验在设置的入口就拒绝，不留给算法静默改成别的值。
 */
export const CompactionSettingSchema = Type.Union([
    Type.Object({mode: Type.Literal("reserve"), value: Type.Optional(Type.Integer({minimum: 1}))}, {additionalProperties: false}),
    Type.Object({mode: Type.Literal("percent"), value: Type.Integer({minimum: 1, maximum: 100})}, {additionalProperties: false}),
    Type.Object({mode: Type.Literal("tokens"), value: Type.Integer({minimum: 1})}, {additionalProperties: false}),
]);
export type CompactionSetting = Static<typeof CompactionSettingSchema>;

export const DEFAULT_COMPACTION: CompactionSetting = {mode: "reserve"};

/**
 * 这个模型的触发点。不给就是用内核的缺省：配置没有意义（百分比没有值、窗口未知）、算出来不大于 0 都算不给。
 * 算出来超过窗口时按窗口：窗口之外的触发点永远等不到。
 */
export function compactionTrigger(setting: CompactionSetting, contextWindow: number): number | undefined {
    const window = contextWindow > 0 ? contextWindow : null;
    const clamp = (at: number): number | undefined => (at > 0 ? Math.floor(window === null ? at : Math.min(at, window)) : undefined);
    switch (setting.mode) {
        case "tokens":
            return clamp(setting.value);
        case "percent":
            return window === null ? undefined : clamp(window * setting.value / 100);
        case "reserve": {
            // 没写基数就是内核的缺省，不用替它算。
            if (setting.value === undefined) return undefined;
            return clamp(setting.value - Math.max(Math.floor(setting.value * RESERVE_SHARE), RESERVE_FLOOR));
        }
    }
}

/** 按模型的配置覆盖全局；旧配置的 `compactAt` 读作固定的触发点。 */
export function effectiveCompaction(model: {readonly compaction?: CompactionSetting; readonly compactAt?: number}, global: CompactionSetting): CompactionSetting {
    if (model.compaction !== undefined) return model.compaction;
    if (model.compactAt !== undefined) return {mode: "tokens", value: model.compactAt};
    return global;
}
