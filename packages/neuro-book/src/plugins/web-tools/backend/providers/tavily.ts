/**
 * Tavily 的搜索与读取接口（docs/specs/web/tools.md 输出 1、3、5）：`POST /search`、`/extract`，Bearer 密钥（`tvly-` 开头）。
 * 参数与字段对照 2026-11-25 的官方接口文档与实测（w00052 t02 的“决定”）；omp 的 `web/search/providers/tavily.ts`（MIT）作参照。
 *
 * 站点与日期给原生参数，查询原样发：Tavily 按自然语言理解查询，不认 `site:` 这类操作符。不要它的 `include_answer`：那是它自己
 * 总结的一段话，Agent 只拿原始结果。
 */

import {postJson, safeDetail} from "./http";
import type {HttpOptions, ServiceDialect} from "./http";
import type {Outcome, Page, SearchHit, SearchRequest, WebProvider} from "./types";
import {dateProblem, finite, httpHref, text} from "./values";

/** Tavily 建议的查询上限（官方的搜索最佳实践），按 Unicode 码点数（输出 1）。 */
export const MAX_QUERY_CODE_POINTS = 1500;

/**
 * 错误响应是 `{detail: {error}}`（实测 401）；参数校验失败的 422 可能直接给 `detail` 字符串或数组，只取字符串。432 是套餐或
 * 这把密钥的额度用完，433 是按量付费的上限，都按 `quota`；422 是参数不对。
 */
const DIALECT: ServiceDialect = {
    errorMessage: (body) => {
        const detail = (body as {detail?: unknown} | null)?.detail;
        if (typeof detail === "string") return detail;
        return (detail as {error?: unknown} | null | undefined)?.error;
    },
    statusCodes: {422: "invalid-request", 432: "quota", 433: "quota"},
};

const sitesOf = (request: SearchRequest): readonly string[] => (request.sites ?? []).map((site) => site.trim()).filter((site) => site !== "");

function queryProblem(request: SearchRequest): string | null {
    const dates = dateProblem(request);
    if (dates !== null) return dates;
    const query = request.query.trim();
    if (query === "") return "query is empty";
    if ([...query].length > MAX_QUERY_CODE_POINTS) return `the query is longer than ${String(MAX_QUERY_CODE_POINTS)} characters`;
    return null;
}

/** 结果的整理（输出 3）：网址不是 http 或 https 的丢掉；标题缺失用网址；摘要取 `content`，日期取 `published_date` 原样；不按分数筛。 */
function normalizeHits(json: unknown): readonly SearchHit[] | null {
    const results = (json as {results?: unknown} | null)?.results;
    if (!Array.isArray(results)) return null;
    const hits: SearchHit[] = [];
    for (const item of results as unknown[]) {
        if (typeof item !== "object" || item === null) continue;
        const raw = item as Record<string, unknown>;
        const url = httpHref(raw.url);
        if (url === null) continue;
        const date = text(raw.published_date);
        const score = finite(raw.score);
        hits.push({
            title: text(raw.title) ?? url,
            url,
            summary: text(raw.content) ?? "",
            ...(date === undefined ? {} : {date}),
            ...(score === undefined ? {} : {score}),
        });
    }
    return hits;
}

/** `/extract` 的响应（输出 5）：成功的网址在 `results`，读不了的在 `failed_results`，两种都是 200。 */
function pageOf(json: unknown, url: string, key: string): Outcome<Page> {
    if (typeof json !== "object" || json === null) return {ok: false, code: "bad-response"};
    const {results, failed_results: failedResults} = json as {results?: unknown; failed_results?: unknown};
    if (!Array.isArray(results)) return {ok: false, code: "bad-response"};
    const first = results[0] as {raw_content?: unknown; title?: unknown} | undefined;
    if (first === undefined) {
        const failure = Array.isArray(failedResults) ? (failedResults[0] as {error?: unknown} | undefined)?.error : undefined;
        // 读不了的原因进详情：它来自服务的成功响应，同样先遮盖密钥再截短（输出 12）。
        return {ok: false, code: "not-found", detail: typeof failure === "string" && failure !== "" ? safeDetail(failure, key) : "the page has no readable content"};
    }
    if (typeof first !== "object" || first === null || (first.raw_content !== undefined && first.raw_content !== null && typeof first.raw_content !== "string")) return {ok: false, code: "bad-response"};
    const markdown = typeof first.raw_content === "string" ? first.raw_content : "";
    if (markdown.trim() === "") return {ok: false, code: "not-found", detail: "the page has no readable content"};
    return {ok: true, value: {url, title: text(first.title) ?? url, markdown}};
}

export function createTavilyProvider(baseUrl: () => string, options: HttpOptions): WebProvider {
    const endpoint = (path: string): string => `${baseUrl().replace(/\/+$/u, "")}${path}`;
    return {
        id: "tavily",
        label: "Tavily",
        validateSearch: queryProblem,
        search: async (request, key, scope): Promise<Outcome<readonly SearchHit[]>> => {
            const problem = queryProblem(request);
            if (problem !== null) return {ok: false, code: "invalid-request", detail: problem};
            const sites = sitesOf(request);
            const body = {
                query: request.query.trim(),
                max_results: request.count,
                search_depth: "basic",
                include_published_date: true,
                ...(sites.length === 0 ? {} : {include_domains: sites}),
                ...(request.after === undefined ? {} : {start_date: request.after}),
                ...(request.before === undefined ? {} : {end_date: request.before}),
            };
            const response = await postJson(endpoint("/search"), body, key, scope, options, DIALECT);
            if (!response.ok) return response;
            const hits = normalizeHits(response.json);
            return hits === null ? {ok: false, code: "bad-response"} : {ok: true, value: hits};
        },
        fetch: async (url, key, scope): Promise<Outcome<Page>> => {
            const response = await postJson(endpoint("/extract"), {urls: [url], format: "markdown", extract_depth: "basic"}, key, scope, options, DIALECT);
            return response.ok ? pageOf(response.json, url, key) : response;
        },
    };
}
