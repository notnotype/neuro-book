/**
 * 假端点按会话分派脚本：几个会话同时发请求时，各取各的回复（子代理测试靠它，见 `endpoint.ts` 的模块头）。
 */
import {afterAll, afterEach, describe, expect, test} from "bun:test";

import {fakeEndpoint} from "./endpoint";

const endpoint = fakeEndpoint();

afterEach(() => {
    endpoint.reset();
});

afterAll(() => {
    endpoint.stop();
});

/** 发一次请求，交回流里的文字（只拼 `content` 增量）。 */
async function ask(firstUser: string): Promise<string> {
    const response = await fetch(`${endpoint.baseUrl}/chat/completions`, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({model: "m", messages: [{role: "system", content: "s"}, {role: "user", content: firstUser}]})});
    const text = await response.text();
    return text.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)) as {choices: {delta?: {content?: string}}[]}).map((chunk) => chunk.choices[0]?.delta?.content ?? "").join("");
}

describe("按会话分派", () => {
    test("第一条用户消息含标记的请求取自己的队列，先于全局队列；用完落到全局队列", async () => {
        endpoint.script("全局一", "全局二");
        endpoint.scriptFor("核对设定", "设定一");
        endpoint.scriptFor("检查伏笔", "伏笔一");
        const replies = await Promise.all([ask("请检查伏笔"), ask("先核对设定"), ask("用户自己的话")]);
        expect(replies).toEqual(["伏笔一", "设定一", "全局一"]);
        expect(await ask("先核对设定")).toBe("全局二");
    });

    test("holdFor 只挂这个会话的第 n 个请求，别的请求照常；放行后取它自己的回复", async () => {
        endpoint.scriptFor("起草大纲", "大纲一", "大纲二");
        endpoint.script("全局一");
        const second = endpoint.holdFor("起草大纲", 2);
        expect(await ask("起草大纲")).toBe("大纲一");
        const held = ask("起草大纲");
        await second.arrived;
        expect(await ask("用户自己的话")).toBe("全局一");
        second.release();
        expect(await held).toBe("大纲二");
    });
});
