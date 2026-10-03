import {
    IMAGE_VARIANT_PRESETS,
    ImageVariantError,
    type ImageVariantFit,
    type ImageVariantPreset,
    type ImageVariantSpec,
} from "nbook/server/media/image-variant-contract";

// H3/ufo 的查询值允许递归数组和对象；这里只把外部输入当作未知值，并在 scalar() 中完成唯一收窄。
type QueryValue = unknown;

/** 图片路由允许消费的变体查询；其他领域查询字段由各自路由处理。 */
export type ImageVariantQuery = Readonly<{
    preset?: QueryValue;
    width?: QueryValue;
    height?: QueryValue;
    fit?: QueryValue;
    quality?: QueryValue;
}>;

/**
 * 将 HTTP 查询收窄为规范化变体规格。
 *
 * 返回 null 表示没有任何变体参数，调用方必须继续保持原图响应语义。
 */
export function parseImageVariantQuery(query: ImageVariantQuery): ImageVariantSpec | null {
    const hasPreset = query.preset !== undefined;
    const hasExplicit = [query.width, query.height, query.fit, query.quality]
        .some((value) => value !== undefined);
    if (!hasPreset && !hasExplicit) {
        return null;
    }
    if (hasPreset && hasExplicit) {
        throw invalidVariant("preset 不能与 width、height、fit 或 quality 混用");
    }
    if (hasPreset) {
        const preset = scalar(query.preset, "preset") as ImageVariantPreset;
        const spec = IMAGE_VARIANT_PRESETS[preset];
        if (!spec) {
            throw invalidVariant("未知图片变体 preset");
        }
        return spec;
    }

    const width = optionalInteger(query.width, "width", 1, 2048);
    const height = optionalInteger(query.height, "height", 1, 2048);
    if (width === undefined && height === undefined) {
        throw invalidVariant("width 与 height 至少提供一个");
    }
    const fit = query.fit === undefined ? "contain" : scalar(query.fit, "fit") as ImageVariantFit;
    if (fit !== "cover" && fit !== "contain") {
        throw invalidVariant("fit 只能是 cover 或 contain");
    }
    if (fit === "cover" && (width === undefined || height === undefined)) {
        throw invalidVariant("fit=cover 必须同时提供 width 和 height");
    }
    const quality = optionalInteger(query.quality, "quality", 40, 95) ?? 80;
    return Object.freeze({
        ...(width !== undefined ? {width} : {}),
        ...(height !== undefined ? {height} : {}),
        fit,
        quality,
    });
}

/** 读取单值查询参数，拒绝重复值和空字符串。 */
function scalar(value: QueryValue, name: string): string {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value !== "string" || value.length === 0) {
        throw invalidVariant(`${name} 必须是单个非空值`);
    }
    return value;
}

/** 按十进制整数合同读取可选数字参数。 */
function optionalInteger(
    value: QueryValue,
    name: string,
    minimum: number,
    maximum: number,
): number | undefined {
    if (value === undefined) {
        return undefined;
    }
    const raw = scalar(value, name);
    if (!/^\d+$/u.test(raw)) {
        throw invalidVariant(`${name} 必须是整数`);
    }
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw invalidVariant(`${name} 必须在 ${minimum}..${maximum} 之间`);
    }
    return parsed;
}

/** 建立统一 400 参数错误。 */
function invalidVariant(message: string): ImageVariantError {
    return new ImageVariantError("INVALID_IMAGE_VARIANT", message);
}
