import type {Api, Model} from "@earendil-works/pi-ai";
import type {ConfiguredModelDto} from "nbook/shared/dto/app-settings.dto";

export type NormalizedPiModelCost = NonNullable<ConfiguredModelDto["cost"]>;

/**
 * 把 Pi registry 价格投影为 NeuroBook 可展示、可计费的价格。
 * Pi 的动态定价模型可能使用负数哨兵；这类值表示价格未知，不能进入配置或 usage。
 */
export function normalizePiRegistryCost(cost: Model<Api>["cost"]): NormalizedPiModelCost | null {
    const tiers = cost.tiers ?? [];
    const prices = [cost.input, cost.output, cost.cacheRead, cost.cacheWrite];
    const thresholds = new Set<number>();

    for (const tier of tiers) {
        prices.push(tier.input, tier.output, tier.cacheRead, tier.cacheWrite);
        if (!Number.isInteger(tier.inputTokensAbove) || tier.inputTokensAbove < 0 || thresholds.has(tier.inputTokensAbove)) {
            return null;
        }
        thresholds.add(tier.inputTokensAbove);
    }

    if (prices.some((price) => !Number.isFinite(price) || price < 0)) {
        return null;
    }

    return {
        input: cost.input,
        output: cost.output,
        cacheRead: cost.cacheRead,
        cacheWrite: cost.cacheWrite,
        tiers: [...tiers].sort((left, right) => left.inputTokensAbove - right.inputTokensAbove),
    };
}

/**
 * Pi runtime 的价格字段不可为空。registry 价格未知时归零，避免负哨兵污染 usage；
 * 用户配置的完整价格覆盖仍由 Config DTO 保证非负。
 */
export function resolvePiRuntimeCost(
    registryCost: Model<Api>["cost"] | undefined,
    configuredCost: ConfiguredModelDto["cost"],
): Model<Api>["cost"] {
    const effectiveCost = configuredCost ?? (registryCost ? normalizePiRegistryCost(registryCost) : null);
    return effectiveCost ?? {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        tiers: [],
    };
}
