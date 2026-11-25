/**
 * DeepSeek 的搜索与读取接口（docs/specs/web/tools.md 输出 1、3、5）：`POST /v1/tools/search`、`/v1/tools/fetch`，与对话
 * 同一种 Bearer 密钥。查询的拼法与读取上限参照 omp 的 `web/search/providers/deepseek.ts`（MIT）。
 */

import {postJson} from "./http";
import type {HttpOptions, ServiceDialect} from "./http";
import type {Outcome, Page, SearchHit, SearchRequest, WebProvider} from "./types";
import {dateProblem, finite, httpHref, text} from "./values";

/** 接口的查询上限，按 Unicode 码点数，拼上过滤条件之后算（输出 1）。 */
export const MAX_QUERY_CODE_POINTS = 128;

/** 错误响应是 `{error: {message}}`；状态码用通用表。 */
const DIALECT: ServiceDialect = {errorMessage: (body) => (body as {error?: {message?: unknown}} | null)?.error?.message};

/** 把站点与日期写进查询（DeepSeek 的过滤只有查询里的操作符，按它自己的语义尽力而为）。 */
export function composeQuery(request: SearchRequest): {readonly ok: true; readonly query: string} | {readonly ok: false; readonly detail: string} {
    const dates = dateProblem(request);
    if (dates !== null) return {ok: false, detail: dates};
    const parts = [request.query.trim()];
    const sites = (request.sites ?? []).map((site) => site.trim()).filter((site) => site !== "");
    if (sites.length > 0) parts.push(sites.map((site) => `site:${site}`).join(" OR "));
    if (request.after !== undefined) parts.push(`after:${request.after}`);
    if (request.before !== undefined) parts.push(`before:${request.before}`);
    const query = parts.filter((part) => part !== "").join(" ");
    if (query === "") return {ok: false, detail: "query is empty"};
    if ([...query].length > MAX_QUERY_CODE_POINTS) return {ok: false, detail: `the query with its filters is longer than ${String(MAX_QUERY_CODE_POINTS)} characters`};
    return {ok: true, query};
}

/** 结果的整理（输出 3）：网址不是 http 或 https 的丢掉；标题缺失用网址；摘要取 `summary`，没有取 `snippet`；不按分数筛。 */
function normalizeHits(json: unknown): readonly SearchHit[] | null {
    const results = (json as {results?: unknown} | null)?.results;
    if (!Array.isArray(results)) return null;
    const hits: SearchHit[] = [];
    for (const item of results as unknown[]) {
        if (typeof item !== "object" || item === null) continue;
        const raw = item as Record<string, unknown>;
        const url = httpHref(raw.url);
        if (url === null) continue;
        const date = text(raw.date);
        const site = text(raw.site_name);
        const score = finite(raw.rerank_score);
        hits.push({
            title: text(raw.title) ?? url,
            url,
            summary: text(raw.summary) ?? text(raw.snippet) ?? "",
            ...(date === undefined ? {} : {date}),
            ...(site === undefined ? {} : {site}),
            ...(score === undefined ? {} : {score}),
        });
    }
    return hits;
}

export function createDeepSeekProvider(baseUrl: () => string, options: HttpOptions): WebProvider {
    const endpoint = (path: string): string => `${baseUrl().replace(/\/+$/u, "")}${path}`;
    return {
        id: "deepseek",
        label: "DeepSeek",
        validateSearch: (request) => {
            const composed = composeQuery(request);
            return composed.ok ? null : composed.detail;
        },
        search: async (request, key, scope): Promise<Outcome<readonly SearchHit[]>> => {
            const composed = composeQuery(request);
            if (!composed.ok) return {ok: false, code: "invalid-request", detail: composed.detail};
            const response = await postJson(endpoint("/v1/tools/search"), {query: composed.query, count: request.count}, key, scope, options, DIALECT);
            if (!response.ok) return response;
            const hits = normalizeHits(response.json);
            return hits === null ? {ok: false, code: "bad-response"} : {ok: true, value: hits};
        },
        fetch: async (url, key, scope): Promise<Outcome<Page>> => {
            const response = await postJson(endpoint("/v1/tools/fetch"), {url}, key, scope, options, DIALECT);
            if (!response.ok) return response;
            const body = response.json as {title?: unknown; content?: unknown} | null;
            if (typeof body !== "object" || body === null || (body.content !== undefined && typeof body.content !== "string")) return {ok: false, code: "bad-response"};
            const markdown = typeof body.content === "string" ? body.content : "";
            if (markdown.trim() === "") return {ok: false, code: "not-found", detail: "the page has no readable content"};
            return {ok: true, value: {url, title: text(body.title) ?? url, markdown}};
        },
    };
}
