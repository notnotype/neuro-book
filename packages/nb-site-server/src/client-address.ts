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
 * 规则见 `ModuleContext.clientAddress`。可信的对端给的转发头里每一跳都必须是合法地址，否则整条不可信、返回 null；
 * 每一跳都在可信网段里时，最左的那一跳就是请求方。
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
        const hops = header.split(",").map((hop) => normalize(hop.trim()));
        if (hops.some((hop) => hop === null)) return null;
        for (let index = hops.length - 1; index >= 0; index -= 1) {
            if (!isTrusted(hops[index]!)) return hops[index]!.address;
        }
        return hops[0]?.address ?? null;
    };
}
