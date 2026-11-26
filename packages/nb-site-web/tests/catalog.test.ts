/**
 * 失败码的文案覆盖（t10 计划 3.3）：合同包里每个码在站点目录的 `errors.<拥有者>` 下都有一条，服务端新加码时这里先失败，
 * 提醒补文案。目录里没有的码在页面上仍有字可显示（`errors.web.unknown` 附上码），这条断言也在这里。
 *
 * 现在只核账号模块：统计的合同包还没有导出失败码的清单，那份导出后在 `OWNERS` 里加一行（B5）。
 * 目录各语言之间的键对齐由仓库的 `message-catalogs` 检查负责，不在这里重复。
 */

import {describe, expect, it} from "bun:test";

import {IDENTITY_FAILURE_CODES, SOCIAL_ERROR_CODES} from "@notnotype/nb-site-identity-contract";
import {defaultTextPort} from "@notnotype/nb-ui/text-port";

import {codeText, failureText} from "../src/api/failure-text";
import type {FailureOwner} from "../src/api/failure-text";
import {SITE_SOURCE_CATALOG, siteRef} from "../src/text";

/** 每个拥有者要覆盖的码。社交登录落点的码（`?social_error=`）与接口的失败码同在 `errors.identity` 下，有几个两边共用。 */
const OWNERS: readonly {readonly owner: FailureOwner; readonly codes: readonly string[]}[] = [
    {owner: "identity", codes: [...new Set([...IDENTITY_FAILURE_CODES, ...SOCIAL_ERROR_CODES])]},
];

const translate = (text: Parameters<ReturnType<typeof defaultTextPort>["t"]>[0]): string => defaultTextPort().t(text);

describe("失败码的文案", () => {
    it("合同包里的每个码在源语言目录里都有文案", () => {
        for (const {owner, codes} of OWNERS) {
            const group = (SITE_SOURCE_CATALOG.errors as Readonly<Record<string, Readonly<Record<string, string>> | undefined>>)[owner] ?? {};
            const missing = codes.filter((code) => typeof group[code] !== "string" || group[code] === "");
            expect({owner, missing}).toEqual({owner, missing: []});
        }
    });

    it("每个码翻出的都是目录里的文字：不是退回的“没认出的问题”，也没有没填上的参数", () => {
        for (const {owner, codes} of OWNERS) {
            for (const code of codes) {
                const text = translate(codeText(owner, code, {seconds: 5}));
                const problems = [text === translate(siteRef("errors.web.unknown", {code})) ? "退回" : "", text.includes("{{") ? "参数没填" : ""].filter(Boolean);
                expect({code, text, problems}).toEqual({code, text, problems: []});
            }
        }
    });

    it("rate_limited 的文案带上等待的秒数", () => {
        expect(translate(failureText("identity", {kind: "code", status: 429, code: "rate_limited", retryAfterSeconds: 42}))).toContain("42");
    });

    it("目录里没有的码显示“没认出的问题”并附上码；原型上的键名也算没有", () => {
        for (const code of ["brand_new_code", "constructor", "toString"]) {
            const text = translate(codeText("identity", code));
            expect({code, text}).toEqual({code, text: translate(siteRef("errors.web.unknown", {code}))});
            expect(text).toContain(code);
        }
        expect(translate(codeText("telemetry", "rate_limited"))).toContain("rate_limited");
    });

    it("连不上与回答看不懂各有自己的文案", () => {
        expect(translate(failureText("identity", {kind: "network"}))).toBe(SITE_SOURCE_CATALOG.errors.web.network);
        expect(translate(failureText("identity", {kind: "malformed", status: 502}))).toBe(SITE_SOURCE_CATALOG.errors.web.malformed);
    });
});
