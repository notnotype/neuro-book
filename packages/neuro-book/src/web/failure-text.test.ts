/** 失败码到文字的共用件（docs/specs/ui/i18n.md 输出 13）：经真实的宿主翻译引擎核对取到的文字。 */

import {describe, expect, it} from "bun:test";

import {REMOTE_FAILURE_CODES} from "@notnotype/nb-runtime/remote";
import {flattenCatalog, textRef} from "@notnotype/nb-ui/text";
import type {TextParams} from "@notnotype/nb-ui/text";

import {codeText, remoteFailureText} from "./failure-text";
import {createHostTextEngine} from "./host/text-engine";
import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

const ALPHA = "example.alpha";
const BETA = "example.beta";

function engine(locale: "zh-CN" | "en-US") {
    const host = createHostTextEngine({locale, strict: true});
    host.register(ALPHA, {"zh-CN": {errors: {unavailable: "甲暂时用不了"}}, "en-US": {errors: {unavailable: "Alpha is unavailable"}}}, "zh-CN");
    host.register(BETA, {"zh-CN": {errors: {unavailable: "乙暂时用不了"}}, "en-US": {errors: {unavailable: "Beta is unavailable"}}}, "zh-CN");
    return host.port;
}

const alphaText = (key: "errors.unavailable", params?: TextParams) => textRef(key, params, ALPHA);
const betaText = (key: "errors.unavailable", params?: TextParams) => textRef(key, params, BETA);
const TABLE = {unavailable: "errors.unavailable"} as const;

describe("按拥有者的表取失败码的文字", () => {
    it("表里有的码取拥有者自己的目录：两个拥有者的同名码不串", () => {
        const port = engine("zh-CN");
        expect(port.t(codeText(alphaText, TABLE, "unavailable"))).toBe("甲暂时用不了");
        expect(port.t(codeText(betaText, TABLE, "unavailable"))).toBe("乙暂时用不了");
    });

    it("表里没有的码显示宿主的中性文案并附上码，随界面语言变", () => {
        expect(engine("zh-CN").t(codeText(alphaText, TABLE, "quota-reached"))).toBe("收到了无法识别的结果（quota-reached）");
        expect(engine("en-US").t(codeText(alphaText, TABLE, "quota-reached"))).toBe("Received an unrecognized result (quota-reached)");
    });

    it("对象原型上的名字不算表里的码", () => {
        expect(engine("zh-CN").t(codeText(alphaText, TABLE, "toString"))).toBe("收到了无法识别的结果（toString）");
    });
});

describe("远程路由的失败码归宿主", () => {
    it("宿主目录的 errors 恰好是路由失败码，两种语言都齐", () => {
        for (const catalog of [zhCN, enUS]) {
            const codes = Object.keys(flattenCatalog(catalog)).filter((key) => key.startsWith("errors.")).map((key) => key.slice("errors.".length));
            expect(codes.sort()).toEqual([...REMOTE_FAILURE_CODES].sort());
        }
    });

    it("每个路由码都取到宿主自己的一句；结果未知要用户先核对，取消不说失败", () => {
        const port = engine("zh-CN");
        for (const code of REMOTE_FAILURE_CODES) expect(port.t(remoteFailureText(code))).toBe(zhCN.errors[code]);
        expect(port.t(remoteFailureText("unknown-outcome"))).toContain("先核对");
        expect(port.t(remoteFailureText("cancelled"))).not.toContain("失败");
    });

    it("不是路由码的按未知码", () => {
        expect(engine("zh-CN").t(remoteFailureText("read-only"))).toBe("收到了无法识别的结果（read-only）");
    });
});
