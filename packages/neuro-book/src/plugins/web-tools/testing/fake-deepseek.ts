/**
 * 本机起的假 DeepSeek 接口（`/v1/tools/search`、`/v1/tools/fetch`）：没排的搜索按缺省回三条结果，没排的读取回一页短正文。
 * 缺省回复的形状取自 2026-11-19 实测的真实响应（字段名与类型，值是编的；见 w00052 Work README“已知情况”），真实接口与它的
 * 对照在 `web.llm.test.ts`。只由测试使用。
 */

import {fakeService} from "./fake-service";
import type {FakeService} from "./fake-service";

export type {ScriptedReply, SeenRequest} from "./fake-service";

export type FakeDeepSeek = FakeService<"/v1/tools/search" | "/v1/tools/fetch">;

export const sampleHit = (index: number): Record<string, unknown> => ({
    rerank_score: 1.8 - index / 10,
    title: `网文写作技巧 ${String(index + 1)}`,
    url: `https://example.com/article-${String(index + 1)}`,
    snippet: `片段 ${String(index + 1)}`,
    summary: `摘要 ${String(index + 1)}：黄金三章怎么写。`,
    content: "",
    site_name: "示例站",
    site_icon: null,
    date: "2026-08-02T16:00:00+00:00",
    authority: 3,
});

export function fakeDeepSeek(): FakeDeepSeek {
    return fakeService((path) => {
        if (path === "/v1/tools/search") return Response.json({results: [sampleHit(0), sampleHit(1), sampleHit(2)]});
        if (path === "/v1/tools/fetch") return Response.json({title: "示例页", content: "# 示例\n\n正文第一段。"});
        return Response.json({error: {message: "not found"}}, {status: 404});
    });
}
