/** 模型网关实机：要等真实时长的长请求，与要另起进程、控制环境的经不经代理。 */

import {afterEach, describe, expect, test} from "bun:test";
import {join} from "node:path";

import {startGateway} from "./gateway";

const live = process.env.NBOOK_EVAL_LIVE === "1";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe.skipIf(!live)("模型网关实机", () => {
    test("上游 11 秒才回（超过 Bun 缺省的 10 秒空闲期限）：执行者照样拿到回复", async () => {
        const upstream = Bun.serve({hostname: "127.0.0.1", port: 0, idleTimeout: 30, fetch: async () => {
            // test-lint-allow fixed-wait: 被测的就是网关不掐断 10 秒以上没有一个字节的请求，必须真等过 Bun 缺省的空闲期限
            await Bun.sleep(11_000);
            return Response.json({id: "slow", usage: {prompt_tokens: 1, completion_tokens: 1}});
        }});
        cleanups.push(() => upstream.stop(true));
        const gateway = startGateway({routes: [{model: "m", baseUrl: `http://127.0.0.1:${upstream.port}/v1`, apiKey: "k", proxy: null}]});
        cleanups.push(() => gateway.stop());
        const {key} = gateway.register();
        const response = await fetch(`${gateway.url}/chat/completions`, {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${key}`}, body: JSON.stringify({model: "m", messages: []})});
        expect([response.status, ((await response.json()) as {id: string}).id]).toEqual([200, "slow"]);
    }, 30_000);

    test("没有代理变量的进程里：proxy 为 null 的路由直连，给了代理的路由经代理", async () => {
        const child = Bun.spawn(["bun", join(import.meta.dir, "testing", "proxy-probe.ts")], {env: {PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "/tmp", NO_PROXY: ""}, stdout: "pipe", stderr: "pipe"});
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect([code, err.trim()]).toEqual([0, ""]);
        const result = JSON.parse(out) as {direct?: string[]; proxied?: string[]; skipped?: string};
        if (result.skipped !== undefined) {
            console.warn(`skipped: ${result.skipped}`);
            return;
        }
        expect(result).toEqual({direct: ["direct"], proxied: ["proxied"]});
    }, 30_000);
});
