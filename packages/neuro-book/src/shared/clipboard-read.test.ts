import {describe, expect, it} from "bun:test";

import {readClipboardText} from "./clipboard-read";

describe("从菜单粘贴时读剪贴板的文字", () => {
    it("读到文字", async () => {
        expect(await readClipboardText({readText: () => Promise.resolve("甲")})).toEqual({ok: true, text: "甲"});
    });

    it("读不到的三种原因：浏览器没有这个接口、权限被拒、剪贴板里没有文字", async () => {
        expect(await readClipboardText(undefined)).toEqual({ok: false, failure: "pasteUnsupported"});
        expect(await readClipboardText({})).toEqual({ok: false, failure: "pasteUnsupported"});
        expect(await readClipboardText({readText: () => Promise.reject(new DOMException("denied", "NotAllowedError"))})).toEqual({ok: false, failure: "pasteDenied"});
        expect(await readClipboardText({readText: () => Promise.resolve("")})).toEqual({ok: false, failure: "pasteEmpty"});
    });

    it("别的错误照常抛出，不当成读不到", async () => {
        const failure = new Error("boom");
        expect(readClipboardText({readText: () => Promise.reject(failure)})).rejects.toBe(failure);
    });
});
