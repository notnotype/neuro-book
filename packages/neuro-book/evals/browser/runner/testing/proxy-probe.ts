/**
 * 子进程里核对网关的路由经不经代理（`gateway.live.test.ts` 用）：假上游绑在本机的非回环地址上
 * （Bun 对回环地址自动绕过代理，绑在回环上测不出），假代理绑在回环上。父进程决定这个进程的环境。
 * 标准输出一行 JSON：`{direct: [...], proxied: [...]}` 是上游直接收到、代理收到的请求的模型名；没有非回环地址时 `{skipped}`。
 */

import {networkInterfaces} from "node:os";

import {startGateway} from "../gateway";

const ip = Object.values(networkInterfaces()).flat().find((address) => address !== undefined && address.family === "IPv4" && !address.internal)?.address;
if (ip === undefined) {
    process.stdout.write(`${JSON.stringify({skipped: "no non-loopback IPv4 address"})}\n`);
    process.exit(0);
}
const direct: string[] = [];
const proxied: string[] = [];
const reply = () => Response.json({choices: [], usage: {prompt_tokens: 1, completion_tokens: 1}});
const upstream = Bun.serve({hostname: ip, port: 0, fetch: async (request) => {
    direct.push(((await request.json()) as {model: string}).model);
    return reply();
}});
const proxy = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: async (request) => {
    proxied.push(((await request.json()) as {model: string}).model);
    return reply();
}});
const baseUrl = `http://${ip}:${upstream.port}/v1`;
const gateway = startGateway({routes: [{model: "direct", baseUrl, apiKey: "k", proxy: null}, {model: "proxied", baseUrl, apiKey: "k", proxy: `http://127.0.0.1:${proxy.port}`}]});
const {key} = gateway.register();
for (const model of ["direct", "proxied"]) {
    await fetch(`${gateway.url}/chat/completions`, {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${key}`}, body: JSON.stringify({model, messages: []})});
}
process.stdout.write(`${JSON.stringify({direct, proxied})}\n`);
await Promise.all([gateway.stop(), upstream.stop(true), proxy.stop(true)]);
