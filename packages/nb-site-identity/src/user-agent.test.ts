/**
 * 浏览器标识的概要（`user-agent.ts`；`site.accounts` 输出 17）。样本是各家浏览器真实发出的 `User-Agent` 写法；每条看规则表的
 * 先后能不能把带着别家记号的标识认成它自己。经建会话的钩子落库、经会话列表读回的路径在 `auth.test.ts` 与 `my-sessions.test.ts`。
 */

import {describe, expect, it} from "bun:test";

import {readStoredUserAgent, storedUserAgent, summarizeUserAgent, USER_AGENT_SCAN_LENGTH} from "./user-agent";

const SAMPLES: readonly (readonly [raw: string, browser: string | null, os: string | null])[] = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome", "Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0", "Edge", "Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/115.0.0.0", "Opera", "Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0", "Firefox", "Linux"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari", "macOS"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome", "macOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari", "iOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1", "Chrome", "iOS"],
    ["Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15", "Firefox", "iOS"],
    ["Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet", "Android"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36", "Chrome", "Android"],
    ["Mozilla/5.0 (Linux; Android 14; V2309A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 XWEB/1160117 MMWEBSDK/20240404 MicroMessenger/8.0.49.2600 WeChat/arm64", "WeChat", "Android"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", "Chrome", "ChromeOS"],
    // 内嵌网页视图不带 `Version/`：浏览器认不出，系统照样认。
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", null, "iOS"],
    ["curl/8.10.1", null, null],
];

describe("认浏览器与系统（输出 17）", () => {
    it("带着别家记号的标识按规则表的先后认成它自己", () => {
        for (const [raw, browser, os] of SAMPLES) expect({raw, ...summarizeUserAgent(raw)}).toEqual({raw, browser, os});
    });

    it("只看前 512 个字符：记号在里面的照样认出，在后面的认不出；请求头上限那么长的病态标识也回这个结果", () => {
        const safari = SAMPLES[4]![0];
        const pad = (head: string, length: number) => `${head}${" x".repeat(Math.ceil(length / 2))}`.slice(0, length);
        const cases: readonly (readonly [name: string, raw: string, browser: string | null, os: string | null])[] = [
            ["真实标识后面拖着 16 KB", pad(safari, 16_000), "Safari", "macOS"],
            ["第 512 个字符正好是记号的结尾", `${" ".repeat(USER_AGENT_SCAN_LENGTH - "Firefox/".length)}Firefox/133.0 Windows`, "Firefox", null],
            ["记号的结尾在第 513 个字符", `${" ".repeat(USER_AGENT_SCAN_LENGTH - "Firefox/".length + 1)}Firefox/133.0 Windows`, null, null],
            // 原来的 Safari 规则（`Version/…` 后跟 `.*` 再找 `Safari/`）对这种串是平方级的。
            ["16 KB 的 Version/1，没有 Safari/", "Version/1 ".repeat(1600), null, null],
            ["16 KB 的 Version/1，Safari/ 在最后", `${"Version/1 ".repeat(1600)}Safari/1`, null, null],
            ["Version/ 与 Safari/ 都在前 512 个字符里，后面 16 KB 的 Version/1", `Version/1 Safari/1 ${"Version/1 ".repeat(1600)}`, "Safari", null],
        ];
        for (const [name, raw, browser, os] of cases) expect({name, ...summarizeUserAgent(raw)}).toEqual({name, browser, os});
    });
});

describe("存与读回", () => {
    it("存的是两个名字的 JSON；没有标识或两项都认不出时存空", () => {
        expect(storedUserAgent(SAMPLES[3]![0])).toBe(JSON.stringify({browser: "Firefox", os: "Linux"}));
        expect(storedUserAgent(SAMPLES[13]![0])).toBe(JSON.stringify({browser: null, os: "iOS"}));
        for (const raw of [null, undefined, "", "curl/8.10.1"]) expect({raw, stored: storedUserAgent(raw)}).toEqual({raw, stored: null});
    });

    it("存的值读回原来的两个名字；空读回两个 null", () => {
        for (const [raw, browser, os] of SAMPLES) expect({raw, ...readStoredUserAgent(storedUserAgent(raw))}).toEqual({raw, summary: {browser, os}, readable: true});
    });

    it("列里不是概要的写法（原始标识、别的 JSON、规则表以外的名字）时说读不出，只交出规则表里的名字", () => {
        const cases: readonly (readonly [stored: string, browser: string | null, os: string | null])[] = [
            [SAMPLES[0]![0], null, null],
            ["[]", null, null],
            ["42", null, null],
            [JSON.stringify({browser: "Netscape", os: "Linux"}), null, "Linux"],
            [JSON.stringify({browser: SAMPLES[0]![0]}), null, null],
        ];
        for (const [stored, browser, os] of cases) expect({stored, ...readStoredUserAgent(stored)}).toEqual({stored, summary: {browser, os}, readable: false});
    });
});
