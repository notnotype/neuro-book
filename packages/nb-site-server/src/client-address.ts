/**
 * 请求方的地址（`ModuleContext.clientAddress`）。两个模块都要它（账号的限流、统计的去重），所以由入口实现一份，
 * 对 `X-Forwarded-For` 的读法只有这一种：模块各写一份时，一边取最左一跳、一边取最右的非可信一跳，就有一个能被伪造来源绕过。
 */

import {BlockList, isIP} from "node:net";

import type {Context} from "hono";

import type {SiteBindings} from "./site";

/** `::ffff:1.2.3.4` 这种 IPv4 映射地址按 IPv4 看待：监听 `::` 时 IPv4 的对端就是这样报上来的。 */
function normalize(address: string): {readonly address: string; readonly family: "ipv4" | "ipv6"} | null {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address);
    const plain = mapped === null ? address : mapped[1]!;
    const family = isIP(plain);
    return family === 0 ? null : {address: plain, family: family === 4 ? "ipv4" : "ipv6"};
}

function bindingsOf(c: Context): SiteBindings {
    const env = c.env as Partial<SiteBindings> | undefined;
    if (env?.server === undefined) throw new Error("clientAddress() called outside a request served by the site entry");
    return env as SiteBindings;
}

/**
 * 规则见 `site.operations` 的输入一节与 `ModuleContext.clientAddress`。从最右一跳往左逐跳判断，走到第一个不可信的就停：
 * 反向代理是在请求方给的值后面追加对端地址，第一个不可信的地址左边全是请求方自己写的，不解析，所以请求方在那里写什么
 * 都不影响结果。走到的那一跳不合法时，它右边全是可信的代理，无从判断请求方是谁，取不到。
 * 每一跳只认 IP 字面量：`1.2.3.4:5678`、`[::1]:80` 这种带端口的写法（有的网关这样写）不认，按不合法处理。
 */
export function createClientAddress(trusted: BlockList): (c: Context) => string | null {
    const isTrusted = (entry: {readonly address: string; readonly family: "ipv4" | "ipv6"}): boolean => trusted.check(entry.address, entry.family);
    return (c) => {
        const {server} = bindingsOf(c);
        const peerAddress = server.requestIP(c.req.raw)?.address;
        const peer = peerAddress === undefined ? null : normalize(peerAddress);
        if (peer === null) return null;
        if (!isTrusted(peer)) return peer.address;
        const header = c.req.header("x-forwarded-for");
        if (header === undefined) return null;
        const hops = header.split(",");
        let leftmost: string | null = null;
        for (let index = hops.length - 1; index >= 0; index -= 1) {
            const hop = normalize(hops[index]!.trim());
            if (hop === null) return null;
            if (!isTrusted(hop)) return hop.address;
            leftmost = hop.address;
        }
        // 每一跳都可信：最左的那一跳就是请求方。
        return leftmost;
    };
}
