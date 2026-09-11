/**
 * 可观测区段的草稿与写回规则。
 *
 * 视图只管 `piTrace` 的两个字段（总开关与每会话保留条数）；写回时必须保留
 * `observability` 段里手写的其它配置（例如 `capturePayload`），所以按字段合并而不是整段替换。
 */
import type {GlobalConfigDto, GlobalConfigUpdateDto} from "nbook/shared/dto/config.dto";

/** 展示默认值，与后端 normalizer 的 DEFAULT_PI_TRACE 保持一致。 */
export const PI_TRACE_DEFAULTS = {enabled: true, maxRecords: 100} as const;

/** 每会话保留条数的上限；0 表示不裁剪。 */
export const OBSERVABILITY_MAX_RECORDS_LIMIT = 10_000;

export type ObservabilityDraft = {
    enabled: boolean;
    maxRecords: number;
};

/**
 * 从 Global 段读 piTrace；global 里没写过的字段落展示默认值。
 */
export function createObservabilityDraft(global: GlobalConfigDto | undefined): ObservabilityDraft {
    const piTrace = global?.observability?.piTrace;
    return {
        enabled: piTrace?.enabled ?? PI_TRACE_DEFAULTS.enabled,
        maxRecords: piTrace?.maxRecords ?? PI_TRACE_DEFAULTS.maxRecords,
    };
}

/**
 * 构造 Global Config 写回体，只覆盖 piTrace 的两个字段。
 */
export function buildObservabilityPayload(baseGlobal: GlobalConfigDto | undefined, draft: ObservabilityDraft): GlobalConfigUpdateDto {
    return {
        observability: {
            ...(baseGlobal?.observability ?? {}),
            piTrace: {
                ...(baseGlobal?.observability?.piTrace ?? {}),
                enabled: draft.enabled,
                maxRecords: draft.maxRecords,
            },
        },
    };
}

/** 输入夹取：0..10000 的整数（视图已拦空串，这里只负责边界）。 */
export function clampObservabilityMaxRecords(value: number): number {
    return Math.min(Math.max(Math.floor(value), 0), OBSERVABILITY_MAX_RECORDS_LIMIT);
}
