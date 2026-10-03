#!/usr/bin/env bun
import {fetchWeb} from "nbook/server/agent/tools/web-tools";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";

const html = [
    "<!doctype html><html><head><title>Product Web Fetch</title></head><body>",
    "<nav>navigation must be removed</nav>",
    "<article><h1>Product Web Fetch</h1>",
    "<p>This deterministic article verifies <strong>readable markdown</strong> extraction inside the Product Runtime Image.</p>",
    "<table><thead><tr><th>Capability</th><th>Status</th></tr></thead>",
    "<tbody><tr><td>jsdom</td><td>loaded</td></tr></tbody></table>",
    "</article></body></html>",
].join("");

const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(html, {headers: {"content-type": "text/html; charset=utf-8"}}),
});

try {
    const config = createDefaultEffectiveConfig();
    config.web.fetch.local.minCharactersForLocal = 1;
    config.web.fetch.tavilyFallback.enabled = false;
    const result = await fetchWeb(config, {url: `http://127.0.0.1:${server.port}/article`});
    if (result.provider !== "local" || result.contentFormat !== "markdown" || result.truncated) {
        throw new Error(`Product web-fetch 返回了错误格式：${JSON.stringify(result)}`);
    }
    if (!result.content.includes("**readable markdown**")
        || !result.content.includes("| Capability | Status |")
        || !result.content.includes("| jsdom | loaded |")
        || result.content.includes("navigation must be removed")) {
        throw new Error(`Product web-fetch Markdown 不符合预期：\n${result.content}`);
    }
    console.log(JSON.stringify({ok: true, provider: result.provider, characters: result.content.length}, null, 2));
} finally {
    server.stop(true);
}
