/**
 * 请求方的地址（`ModuleContext.clientAddress`）。两个模块都要它（账号的限流、统计的去重），所以由入口实现一份，
 * 对 `X-Forwarded-For` 的读法只有这一种：模块各写一份时，一边取最左一跳、一边取最右的非可信一跳，就有一个能被伪造来源绕过。
 */

import {BlockList, isIP} from "node:net";

import type {Context} from "hono";

import type {SiteBindings} from "./site";

/** IPv4 映射的 IPv6 地址经 `URL` 规范化之后的样子：`::ffff:` 加两组十六进制。 */
const MAPPED_V4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u;

/**
 * 把一个 IP 字面量写成唯一的一种写法（`site.operations` 的输入一节“来源地址”）；不是 IP 字面量时为 null。模块拿它做限流与
 * 去重的键，同一个地址的两种写法若是两个键，换个写法就绕过了限流。对端地址与转发头里取到的那一跳都经这里，可信代理也按
 * 规范化之后的值比。
 *
 * - IPv4 映射的 IPv6 地址（`::ffff:1.2.3.4` 与 `::ffff:102:304` 两种写法）当作 IPv4：监听 `::` 时 IPv4 的对端就是这样报上来的。
 *   `node:net` 的 `BlockList` 本来就拿映射地址去比 IPv4 的网段，按 IPv4 比不会让可信代理的范围变宽。
 * - 其余 IPv6 用 WHATWG `URL` 的序列化：小写、最长的一串零组压成 `::`、不带前导零（RFC 5952 的写法）。
 * - 带区域标识的链路本地地址（`fe80::1%eth0`）`URL` 不收，按不是地址处理，取不到。
 */
function canonical(address: string): {readonly address: string; readonly family: "ipv4" | "ipv6"} | null {
    const family = isIP(address);
    if (family === 4) return {address, family: "ipv4"};
    if (family !== 6) return null;
    const hostname = URL.parse(`http://[${address}]/`)?.hostname;
    if (hostname === undefined) return null;
    const v6 = hostname.slice(1, -1);
    const mapped = MAPPED_V4.exec(v6);
    if (mapped === null) return {address: v6, family: "ipv6"};
    const high = Number.parseInt(mapped[1]!, 16);
    const low = Number.parseInt(mapped[2]!, 16);
    return {address: [high >> 8, high & 0xff, low >> 8, low & 0xff].join("."), family: "ipv4"};
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
        const peer = peerAddress === undefined ? null : canonical(peerAddress);
        if (peer === null) return null;
        if (!isTrusted(peer)) return peer.address;
        const header = c.req.header("x-forwarded-for");
        if (header === undefined) return null;
        const hops = header.split(",");
        let leftmost: string | null = null;
        for (let index = hops.length - 1; index >= 0; index -= 1) {
            const hop = canonical(hops[index]!.trim());
            if (hop === null) return null;
            if (!isTrusted(hop)) return hop.address;
            leftmost = hop.address;
        }
        // 每一跳都可信：最左的那一跳就是请求方。
        return leftmost;
    };
}
