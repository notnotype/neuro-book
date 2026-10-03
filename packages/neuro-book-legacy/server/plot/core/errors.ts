import {createError} from "h3";

/**
 * 抛出剧情模块 404。
 */
export function throwPlotNotFound(message: string): never {
    throw createError({
        statusCode: 404,
        message,
    });
}

/**
 * 抛出剧情模块 400。
 */
export function throwPlotBadRequest(message: string): never {
    throw createError({
        statusCode: 400,
        message,
    });
}
