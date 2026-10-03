import {createError, getQuery, setResponseHeader, type H3Event} from "h3";
import {ImageVariantError, type ImageVariantSpec} from "nbook/server/media/image-variant-contract";
import {parseImageVariantQuery} from "nbook/server/media/image-variant-query";

/** 从领域路由的完整 query 中只读取图片变体参数。 */
export function imageVariantSpecFromEvent(event: H3Event): ImageVariantSpec | null {
    const query = getQuery(event);
    return parseImageVariantQuery({
        preset: query.preset,
        width: query.width,
        height: query.height,
        fit: query.fit,
        quality: query.quality,
    });
}

/** 把稳定变体错误映射为 HTTP；响应不携带缓存路径、source identity 或原图路径。 */
export function imageVariantHttpError(event: H3Event, error: ImageVariantError): never {
    const statusCode = error.code === "INVALID_IMAGE_VARIANT"
        ? 400
        : error.code === "UNSUPPORTED_IMAGE_TYPE"
            ? 415
            : error.code === "IMAGE_VARIANT_QUEUE_SATURATED"
                ? 503
                : 422;
    if (statusCode === 503) {
        setResponseHeader(event, "Retry-After", 1);
    }
    throw createError({
        statusCode,
        message: error.message,
        data: {code: error.code},
    });
}
