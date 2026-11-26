/**
 * 本机起的假 Tavily 接口（`/search`、`/extract`）：没排的搜索按缺省回三条结果，没排的读取把请求里的网址读成一页短正文。缺省
 * 回复的形状取自 2026-11-25 实测的真实响应（字段名与类型，值是编的；w00052 t02 的“决定”），真实接口与它的对照在
 * `web.llm.test.ts`。只由测试使用。
 */

import {fakeService} from "./fake-service";
import type {FakeService} from "./fake-service";

export type FakeTavily = FakeService<"/search" | "/extract">;

export const sampleTavilyHit = (index: number): Record<string, unknown> => ({
    url: `https://example.org/post-${String(index + 1)}`,
    title: `Writing tips ${String(index + 1)}`,
    score: 0.8 - index / 10,
    content: `Content ${String(index + 1)}: how to open a novel.`,
    raw_content: null,
    published_date: "Sun, 02 Aug 2026 16:00:00 GMT",
    favicon: null,
});

/** 401 的真实响应体（实测）。 */
export const TAVILY_UNAUTHORIZED = {detail: {error: "Unauthorized: missing or invalid API key."}};

export function fakeTavily(): FakeTavily {
    return fakeService((path, body) => {
        if (path === "/search") {
            const query = (body as {query?: unknown} | null)?.query;
            return Response.json({query, follow_up_questions: null, answer: null, images: [], results: [sampleTavilyHit(0), sampleTavilyHit(1), sampleTavilyHit(2)], response_time: 0.5, request_id: "fake-request"});
        }
        if (path === "/extract") {
            const urls = (body as {urls?: unknown} | null)?.urls;
            const url = Array.isArray(urls) && typeof urls[0] === "string" ? urls[0] : "";
            return Response.json({results: [{url, title: "Sample page", raw_content: "# Sample\n\nFirst paragraph.", images: []}], failed_results: [], response_time: 0.5, request_id: "fake-request"});
        }
        return Response.json({detail: {error: "not found"}}, {status: 404});
    });
}
