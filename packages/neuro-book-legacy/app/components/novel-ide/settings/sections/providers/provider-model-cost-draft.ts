import type {ConfiguredModelDto} from "nbook/shared/dto/app-settings.dto";

export type ModelCostDraft = {
    input: string;
    output: string;
    cacheRead: string;
    cacheWrite: string;
    tiers: ModelCostTierDraft[];
};

export type ModelCostTierDraft = {
    inputTokensAbove: string;
    input: string;
    output: string;
    cacheRead: string;
    cacheWrite: string;
};

/**
 * 创建空价格草稿；空字段表示用户配置未记录价格，价格单位固定为 USD / 1M tokens。
 */
export function createEmptyModelCostDraft(): ModelCostDraft {
    return {
        input: "",
        output: "",
        cacheRead: "",
        cacheWrite: "",
        tiers: [],
    };
}

/**
 * 从已保存的 USD 价格创建编辑草稿。
 */
export function createModelCostDraft(cost: ConfiguredModelDto["cost"]): ModelCostDraft {
    if (!cost) {
        return createEmptyModelCostDraft();
    }
    return {
        input: formatDraftNumber(cost.input),
        output: formatDraftNumber(cost.output),
        cacheRead: formatDraftNumber(cost.cacheRead),
        cacheWrite: formatDraftNumber(cost.cacheWrite),
        tiers: cost.tiers.map((tier) => ({
            inputTokensAbove: formatDraftNumber(tier.inputTokensAbove),
            input: formatDraftNumber(tier.input),
            output: formatDraftNumber(tier.output),
            cacheRead: formatDraftNumber(tier.cacheRead),
            cacheWrite: formatDraftNumber(tier.cacheWrite),
        })),
    };
}

/**
 * 清空用户配置中的价格。
 */
export function clearModelCostDraft(cost: ModelCostDraft): void {
    cost.input = "";
    cost.output = "";
    cost.cacheRead = "";
    cost.cacheWrite = "";
    cost.tiers.splice(0);
}

/**
 * 判断当前草稿是否显式覆盖价格。
 */
export function hasModelCostOverride(cost: ModelCostDraft): boolean {
    return cost.tiers.length > 0 || [cost.input, cost.output, cost.cacheRead, cost.cacheWrite].some((value) => value.trim().length > 0);
}

/**
 * 将价格草稿解析为保存用 USD / 1M tokens；空草稿表示价格未知。
 */
export function parseModelCostDraft(cost: ModelCostDraft): ConfiguredModelDto["cost"] {
    if (!hasModelCostOverride(cost)) {
        return null;
    }

    const tiers = cost.tiers.map((tier, index) => ({
        inputTokensAbove: readThreshold(tier.inputTokensAbove, index),
        input: normalizePrice(readRequiredPrice(tier.input, `tiers[${index}].input`)),
        output: normalizePrice(readRequiredPrice(tier.output, `tiers[${index}].output`)),
        cacheRead: normalizePrice(readRequiredPrice(tier.cacheRead, `tiers[${index}].cacheRead`)),
        cacheWrite: normalizePrice(readRequiredPrice(tier.cacheWrite, `tiers[${index}].cacheWrite`)),
    })).sort((left, right) => left.inputTokensAbove - right.inputTokensAbove);
    const duplicate = tiers.find((tier, index) => index > 0 && tier.inputTokensAbove === tiers[index - 1]?.inputTokensAbove);
    if (duplicate) {
        throw new Error(`价格 tier threshold 重复：${duplicate.inputTokensAbove}`);
    }
    return {
        input: normalizePrice(readRequiredPrice(cost.input, "input")),
        output: normalizePrice(readRequiredPrice(cost.output, "output")),
        cacheRead: normalizePrice(readRequiredPrice(cost.cacheRead, "cacheRead")),
        cacheWrite: normalizePrice(readRequiredPrice(cost.cacheWrite, "cacheWrite")),
        tiers,
    };
}

/**
 * 保持价格输入框里的数字可读，避免 JSON 序列化格式污染 UI。
 */
function formatDraftNumber(value: number): string {
    return Number.isFinite(value) ? String(value) : "";
}

/**
 * 读取必填非负价格；覆盖状态不允许用空字段静默补 0。
 */
function readRequiredPrice(value: string, field: string): number {
    const normalized = value.trim();
    if (!normalized) {
        throw new Error(`自定义价格字段 ${field} 未填写`);
    }
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`自定义价格字段 ${field} 必须是有限非负数`);
    }
    return parsed;
}

/**
 * 读取 tier threshold。
 */
function readThreshold(value: string, index: number): number {
    const parsed = Number(value.trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`价格 tier ${index + 1} 的 threshold 必须是非负整数`);
    }
    return parsed;
}

/**
 * 抹平汇率换算后的二进制浮点尾差，保持配置可读。
 */
function normalizePrice(value: number): number {
    return Number(value.toFixed(12));
}
