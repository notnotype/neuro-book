/**
 * e2e 用的本机模型端点（由 Bun 跑；Playwright 在 Node 里，`Bun.serve` 用不了）：`fakeEndpoint` 加一个控制接口，用例经 HTTP 排脚本、读请求。
 * 启动后打印 `READY <模型地址> <控制地址>`，收到 stdin 结束就退出。
 */

import {fakeEndpoint} from "nbook/plugins/agent/testing/endpoint";

const endpoint = fakeEndpoint();
let hold: ReturnType<typeof endpoint.hold> | null = null;
const control = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/script") {
            endpoint.script(...(await request.json()) as never[]);
            return Response.json({ok: true});
        }
        if (path === "/requests") return Response.json(endpoint.requests);
        if (path === "/hold") {
            hold = endpoint.hold();
            return Response.json({ok: true});
        }
        if (path === "/hold/arrived") {
            await hold?.arrived;
            return Response.json({ok: true});
        }
        if (path === "/hold/release") {
            hold?.release();
            return Response.json({ok: true});
        }
        return new Response(null, {status: 404});
    },
});
console.log(`READY ${endpoint.baseUrl} http://127.0.0.1:${String(control.port)}`);
process.stdin.on("end", () => process.exit(0));
process.stdin.resume();
