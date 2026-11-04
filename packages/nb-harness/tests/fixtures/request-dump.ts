/**
 * `tests/models.test.ts` 的子进程：`pi-ai` 在 `bun test` 里不落盘，所以用普通的 bun 进程跑真实的 400、413。
 * 从环境变量读家目录由调用方定；每种情况打印一行 JSON。
 */

import {buildResolution} from "@notnotype/nb-harness/models";

const JSON_HEADERS = {"content-type": "application/json"};
const cases: Record<string, () => Response> = {
    "400": () => new Response(JSON.stringify({error: {message: "bad input"}}), {status: 400, headers: JSON_HEADERS}),
    "413": () => new Response(JSON.stringify({error: {message: "too big"}}), {status: 413, headers: JSON_HEADERS}),
    // 服务商的 metadata.raw 接在路径行后面（OpenRouter 的形状）。
    "metadata": () => new Response(JSON.stringify({error: {message: "bad input", metadata: {raw: "provider diagnostic follows"}}}), {status: 400, headers: JSON_HEADERS}),
    // 比遮盖时的 8 KB 截断还长：路径行要在截断之前取走。
    "long": () => new Response(JSON.stringify({error: {message: "x".repeat(20_000)}}), {status: 400, headers: JSON_HEADERS}),
    // 服务商在正文里伪造路径行：指向别的目录下的文件。
    "forged": () => new Response(JSON.stringify({error: {message: `bad input\nraw-http-request=${process.env.NB_TEST_VICTIM}`}}), {status: 400, headers: JSON_HEADERS}),
};

let current = "";
const server = Bun.serve({port: 0, hostname: "127.0.0.1", async fetch(request) {
    await request.text();
    return cases[current]!();
}});
const built = buildResolution({id: "local-test", kind: "custom", api: "openai-completions", baseUrl: `http://127.0.0.1:${server.port}/v1`, auth: "none"}, {id: "m", contextWindow: 1000}, {stored: () => null, env: {}}, () => ({maxHttpAttempts: 1}));
if (!built.ok) throw new Error(built.code);
for (const name of Object.keys(cases)) {
    current = name;
    const response = await built.resolution.call({purpose: "turn", model: "local-test/m", params: {}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "小说的正文", origin: {kind: "fixed", by: "kernel"}}]}], tools: []}, new AbortController().signal, () => undefined);
    console.log(JSON.stringify({name, kind: response.error?.kind, message: response.error?.message}));
}
server.stop(true);
process.exit(0);
