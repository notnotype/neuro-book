/**
 * 重连时重取 RPC 端点：真实的连接对象与 fetch，对面是只回引导接口的 `Bun.serve`，按用例给出真实后端不会给的响应。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {BROWSER_BOOTSTRAP_PATH, BROWSER_PROTOCOL_VERSION} from "nbook/shared/browser-bootstrap";

import {createConnection} from "./connection";
import {refreshEndpoint} from "./endpoint-refresh";

const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
    await Promise.all(stops.splice(0).map((stop) => stop()));
});

/** 引导接口按 `respond` 回答；返回服务地址。 */
function serveBootstrap(respond: () => Response | Promise<Response>): string {
    const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: (request) => (new URL(request.url).pathname === BROWSER_BOOTSTRAP_PATH ? respond() : new Response(null, {status: 404}))});
    stops.push(() => server.stop(true));
    return server.url.href;
}

const valid = {protocolVersion: BROWSER_PROTOCOL_VERSION, rpc: {port: 4100, path: "/"}, revision: "r", catalogs: [], plugins: []};
const live = (): AbortSignal => new AbortController().signal;

describe("重取 RPC 端点", () => {
    it("引导合法：交回其中的 rpc 端点", async () => {
        const url = serveBootstrap(() => Response.json(valid));
        expect(await refreshEndpoint(createConnection(url), live())).toEqual({port: 4100, path: "/"});
    });

    it("协议版本不是本页面的：交回 incompatible，原因写明本页面的版本；先于结构校验", async () => {
        const url = serveBootstrap(() => Response.json({protocolVersion: BROWSER_PROTOCOL_VERSION + 1}));
        expect(await refreshEndpoint(createConnection(url), live())).toEqual({incompatible: `服务端的引导协议版本已不是 ${String(BROWSER_PROTOCOL_VERSION)}`});
    });

    it("版本相同但结构不符，或没有声明版本：交回 retry", async () => {
        const broken = serveBootstrap(() => Response.json({...valid, rpc: {port: 0, path: "/"}}));
        expect(await refreshEndpoint(createConnection(broken), live())).toEqual({retry: "引导响应的结构不符合协议"});
        const unversioned = serveBootstrap(() => Response.json({rpc: valid.rpc}));
        expect(await refreshEndpoint(createConnection(unversioned), live())).toEqual({retry: "引导响应的结构不符合协议"});
    });

    it("取引导失败（服务端正在重启回 503、服务端不在）：交回 retry，原因是连接对象给的", async () => {
        const restarting = serveBootstrap(() => Response.json({error: {code: "server-starting"}}, {status: 503}));
        expect(await refreshEndpoint(createConnection(restarting), live())).toEqual({retry: "服务端暂不可用（HTTP 503，server-starting）"});

        const gone = serveBootstrap(() => Response.json(valid));
        await stops.pop()!();
        expect(await refreshEndpoint(createConnection(gone), live())).toEqual({retry: "无法连接服务端"});
    });

    it("signal 中止：在途的引导请求被取消，交回 retry 而不抛错", async () => {
        const held = Promise.withResolvers<Response>();
        const requested = Promise.withResolvers<void>();
        const url = serveBootstrap(() => {
            requested.resolve();
            return held.promise;
        });
        const controller = new AbortController();
        const refreshing = refreshEndpoint(createConnection(url), controller.signal);
        await requested.promise;
        controller.abort();
        expect(await refreshing).toEqual({retry: "无法连接服务端"});
        held.resolve(Response.json(valid));
    });
});
