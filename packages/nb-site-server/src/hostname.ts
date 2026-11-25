/**
 * 主机名的比较规则（`site.operations` 的输入一节：不分大小写、不看端口、忽略末尾的点）。按主机分派与 `same_host` 的
 * 配置校验用同一个函数，两处不会对“是不是同一个主机”得出不同的结论。
 *
 * 调用方传 `URL.hostname`：它已经不带端口，WHATWG URL 解析时已转成小写（Bun 的 `req.url` 也是由 `Host` 头解析出来的）；
 * 这里再转一次小写，不依赖调用方。
 */
export function hostnameKey(hostname: string): string {
    const lower = hostname.toLowerCase();
    return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}
