import {consola} from "consola";
import {createError, getHeader, readBody, type H3Event} from "h3";
import getRawBody from "raw-body";
import {z} from "zod";

type EntityIdLabel =
    | "storyId"
    | "phaseId"
    | "threadId"
    | "sceneId"
    | "plotId"
    | "actId"
    | "chapterId"
    | "promiseId"
    | "decisionId"
    | "entryId"
    | "parentId";

/** 将数据库整数 ID 转成对外字符串。 */
export function stringifyEntityId(id: number): string {
    return String(id);
}

/** 将外部传入的 ID 解析为数据库整数。 */
export function parseEntityId(label: EntityIdLabel, value: string): number {
    const normalized = value.trim();
    if (!normalized) {
        throwBadRequest(`${label} 不能为空`);
    }
    if (!/^\d+$/.test(normalized)) {
        throwBadRequest(`${label} 必须是正整数`);
    }
    const parsedId = Number.parseInt(normalized, 10);
    if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
        throwBadRequest(`${label} 必须是正整数`);
    }
    return parsedId;
}

/** 将可空 ID 解析为数据库整数；空值表示客户端未提供该字段。 */
export function parseNullableEntityId(
    label: EntityIdLabel,
    value: string | null | undefined,
): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    return parseEntityId(label, value);
}

/** 统一校验请求体。 */
export async function validateBody<T>(
    event: H3Event,
    schema: z.ZodSchema<T>,
    options: {maxBytes?: number} = {},
): Promise<T> {
    let body: unknown;
    if (options.maxBytes === undefined) {
        body = await readBody(event);
    } else {
        const contentLength = getHeader(event, "content-length");
        if (contentLength && Number(contentLength) > options.maxBytes) {
            throw createError({
                statusCode: 413,
                message: "请求体超过允许大小",
                data: {code: "REQUEST_BODY_TOO_LARGE"},
            });
        }
        let raw: string;
        try {
            raw = await getRawBody(event.node.req, {
                length: contentLength,
                limit: options.maxBytes,
                encoding: "utf8",
            });
        } catch (error) {
            const rawError = error as {statusCode?: number; type?: string};
            if (rawError.statusCode === 413 || rawError.type === "entity.too.large") {
                throw createError({
                    statusCode: 413,
                    message: "请求体超过允许大小",
                    data: {code: "REQUEST_BODY_TOO_LARGE"},
                });
            }
            throw error;
        }
        try {
            body = JSON.parse(raw) as unknown;
        } catch {
            throw createError({statusCode: 400, message: "请求体必须是有效 JSON"});
        }
    }

    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
        const firstIssue = parseResult.error.issues[0];
        consola.warn({
            method: event.method,
            path: event.path,
            issues: parseResult.error.issues.map((issue) => ({
                code: issue.code,
                path: issue.path,
                message: issue.message,
            })),
        }, "请求体验证失败");
        throw createError({
            statusCode: 400,
            message: firstIssue?.message ?? "请求参数不合法",
        });
    }
    return parseResult.data;
}

/** 抛出 400。 */
function throwBadRequest(message: string): never {
    throw createError({statusCode: 400, message});
}
