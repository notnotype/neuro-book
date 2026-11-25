/**
 * 账号子应用唯一的出错出口与请求体的读法（w00037 t07 计划 3.6；`site.accounts` 输出 22 与失败表）。
 *
 * 响应体只有 `{"error":{"code":…,"fields":[…]?}}`：不带给人看的文字、堆栈与内部路径。日志只记事件名、`errorType` 与码，
 * 不记请求体（密码）与来源地址。
 *
 * 错误怎样归类（只看错误的类型与 SQLite 的结果码，不看文字）：
 * - 模块自己抛的 `IdentityFailure`：照它的码，状态取合同包的 `IDENTITY_FAILURE_STATUS`。
 * - 队列用错了（`isQueueMisuse`）：程序错误，500 `internal`。先于下一条判：它不是“库不可用”。
 * - 库不可用（`isDbUnavailable`：SQLite 的忙、只读、I/O 一类，或队列等锁超时、已关闭）：503 `unavailable`。沿 `cause` 链找：库的
 *   `getSession` 把数据库错误包成 `APIError`，原错误在 `cause` 里（设计审查第 2 条）。
 * - 其余（包括漏到这里的库的 `APIError`）：程序错误，500 `internal`。库的错误码由各调用处换成本模块的码，出口不翻译它。
 */

import {Value} from "typebox/value";
import type {Static, TSchema} from "typebox";
import type {Context} from "hono";
import {bodyLimit} from "hono/body-limit";

import {IDENTITY_FAILURE_STATUS, type ErrorBody, type IdentityFailureCode} from "@notnotype/nb-site-identity-contract";

import {isDbUnavailable, isQueueMisuse} from "./db/connection";
import type {IdentityLog} from "./index";

/** 请求体的上限（`site.accounts` 输出 22）。 */
export const MAX_BODY_BYTES = 16 * 1024;

/** 模块内部预料之中的失败；出口按码回状态。`fields` 只用于 `validation_failed`。 */
export class IdentityFailure extends Error {
    override readonly name = "IdentityFailure";
    constructor(
        readonly code: IdentityFailureCode,
        readonly fields: readonly string[] = [],
        /** 只用于 `rate_limited`：`Retry-After` 的秒数。 */
        readonly retryAfterSeconds?: number,
    ) {
        super(`identity failure: ${code}`);
    }
}

/** 一个失败的状态、响应体与额外的响应头。 */
export interface FailureResponse {
    readonly status: number;
    readonly body: ErrorBody;
    readonly headers: Readonly<Record<string, string>>;
}

function errorType(error: unknown): string {
    return error instanceof Error ? error.name : typeof error;
}

export function failureResponse(code: IdentityFailureCode, fields: readonly string[] = [], retryAfterSeconds?: number): FailureResponse {
    const body: ErrorBody = code === "validation_failed" ? {error: {code, fields: [...fields]}} : {error: {code}};
    const headers: Record<string, string> = code === "rate_limited" && retryAfterSeconds !== undefined ? {"Retry-After": String(retryAfterSeconds)} : {};
    return {status: IDENTITY_FAILURE_STATUS[code], body, headers};
}

/** 把任意错误归成一个失败（规则见文件头），并按类别记一行日志。 */
export function failureFor(error: unknown, log: Pick<IdentityLog, "warn" | "error">): FailureResponse {
    if (error instanceof IdentityFailure) return failureResponse(error.code, error.fields, error.retryAfterSeconds);
    if (isQueueMisuse(error)) {
        log.error("identity.queue_misuse", "the identity database connection was used against its rules", {errorType: errorType(error)});
        return failureResponse("internal");
    }
    if (isDbUnavailable(error)) {
        log.warn("identity.db_unavailable", "identity database is not usable; answering 503", {errorType: errorType(error)});
        return failureResponse("unavailable");
    }
    log.error("identity.unhandled_error", "identity request handler threw", {errorType: errorType(error)});
    return failureResponse("internal");
}

/** Hono 里回一个失败；之前在 `c` 上设过的响应头（例如延长会话的 `Set-Cookie`）照样带上。 */
export function respondFailure(c: Context, failure: FailureResponse): Response {
    for (const [name, value] of Object.entries(failure.headers)) c.header(name, value);
    return c.json(failure.body, failure.status as 400);
}

/** 没有 Hono 上下文时（`whoami` 作为函数被别的模块调用）回一个失败。 */
export function failureAsResponse(failure: FailureResponse): Response {
    return Response.json(failure.body, {status: failure.status, headers: failure.headers});
}

/**
 * 请求体的大小上限。定长与分块的请求都按实际读到的字节数判（`hono/body-limit`）；超了回 400 `validation_failed`、`fields: []`，
 * 不是它缺省的 413（`site.accounts` 输出 22，omp 设计审查第 8 条）。
 */
export const bodySizeLimit = bodyLimit({maxSize: MAX_BODY_BYTES, onError: (c) => respondFailure(c, failureResponse("validation_failed"))});

/** 读请求体并按 JSON 解析成对象；不是 JSON 或不是对象（数组、`null`、数）时 `validation_failed`、`fields: []`。 */
async function readJsonObject(c: Context): Promise<Record<string, unknown> | undefined> {
    const text = await c.req.text();
    if (text === "") return undefined;
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        // 不是 JSON 是请求方的错，按合同回码即可，不记日志（日志不记请求体）。
        throw new IdentityFailure("validation_failed");
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new IdentityFailure("validation_failed");
    return value as Record<string, unknown>;
}

/**
 * 不需要参数的写接口（登出；以后的生成邀请码、封禁、解封、结束全部会话、重置密码）的请求体：可以为空，前端 `fetch` 不带体
 * 最自然；给了时必须是没有键的 JSON 对象，不让多余的内容被悄悄忽略。否则 `validation_failed`、`fields: []`（`site.accounts` 输出 22）。
 */
export async function readEmptyBody(c: Context): Promise<void> {
    const body = await readJsonObject(c);
    if (body !== undefined && Object.keys(body).length > 0) throw new IdentityFailure("validation_failed");
}

/** JSON 指针里的一段键名（`~1` 是 `/`，`~0` 是 `~`）。 */
function decodePointerSegment(segment: string): string {
    return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/**
 * 不合 schema 的字段名：出错路径的第一段键名；缺的键与多余的键在对象这一层报出，取它们各自的键名。去重、按出现的先后。
 */
export function invalidFields(schema: TSchema, value: unknown): string[] {
    const fields = new Set<string>();
    for (const error of Value.Errors(schema, value)) {
        const first = error.instancePath.split("/")[1];
        if (first !== undefined && first !== "") {
            fields.add(decodePointerSegment(first));
            continue;
        }
        const params = error.params as {readonly requiredProperties?: readonly string[]; readonly additionalProperties?: readonly string[]};
        for (const key of [...(params.requiredProperties ?? []), ...(params.additionalProperties ?? [])]) fields.add(key);
    }
    return [...fields];
}

/**
 * 有参数的接口的请求体：必须是 JSON 对象（空体也不行），再按合同包的 schema 校验；不合格时 `validation_failed`，`fields` 是不合规则
 * 的键名。长度规则已写在合同的 `pattern` 里（按码点），schema 通过就不另数一遍（合同包 `AGENTS.md`）。
 */
export async function readBody<S extends TSchema>(c: Context, schema: S): Promise<Static<S>> {
    const body = await readJsonObject(c);
    if (body === undefined) throw new IdentityFailure("validation_failed");
    const fields = invalidFields(schema, body);
    if (fields.length > 0) throw new IdentityFailure("validation_failed", fields);
    return body as Static<S>;
}
