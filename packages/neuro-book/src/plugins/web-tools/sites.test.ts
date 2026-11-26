/**
 * 屏蔽网站的写法与匹配（docs/specs/web/tools.md 输出 3、settings-page.md 输出 12）：设置页写入前与工具读设置时共用的纯函数。
 */

import {describe, expect, it} from "bun:test";

import {normalizeSite, normalizeSites, siteBlocked} from "./shared/sites";

describe("normalizeSite", () => {
    it("网址只留主机，转小写与 punycode，去掉末尾的点；不像域名（单段、IPv6、含空白）的为 null", () => {
        expect(normalizeSite("  https://Blog.CSDN.net/article/1?x=1  ")).toBe("blog.csdn.net");
        expect(normalizeSite("CSDN.net.")).toBe("csdn.net");
        expect(normalizeSite("例子.中国")).toBe("xn--fsqu00a.xn--fiqs8s");
        expect(normalizeSite("example.com:8080")).toBe("example.com");
        // IPv4 地址照样能按主机匹配，收；单段的主机名与 IPv6 字面量不收（已知限制）。
        expect(normalizeSite("127.0.0.1")).toBe("127.0.0.1");
        for (const bad of ["", "localhost", "不是域名", "a b.com", "[::1]", "-a.com", "a..com"]) expect(normalizeSite(bad)).toBeNull();
    });

    it("名单里写错的项跳过、去重，保持先后", () => {
        expect(normalizeSites(["Bad Item", "blocked.example", "BLOCKED.example", "news.example."])).toEqual(["blocked.example", "news.example"]);
    });
});

describe("siteBlocked", () => {
    it("主机等于或是子域名时挡；末尾的点不算；别的域名不挡", () => {
        const sites = ["csdn.net"];
        expect(siteBlocked("https://csdn.net/a", sites)).toBe(true);
        expect(siteBlocked("https://blog.CSDN.net/a", sites)).toBe(true);
        expect(siteBlocked("https://csdn.net./a", sites)).toBe(true);
        expect(siteBlocked("https://blog.csdn.net%2e/a", sites)).toBe(true);
        expect(siteBlocked("https://notcsdn.net/a", sites)).toBe(false);
        expect(siteBlocked("https://csdn.net.evil.example/a", sites)).toBe(false);
        expect(siteBlocked("https://csdn.net/a", [])).toBe(false);
        // IPv4 地址按整个主机比，不当成域名的后缀。
        expect(siteBlocked("http://127.0.0.1/a", ["127.0.0.1"])).toBe(true);
        expect(siteBlocked("http://127.0.0.10/a", ["127.0.0.1"])).toBe(false);
    });
});
