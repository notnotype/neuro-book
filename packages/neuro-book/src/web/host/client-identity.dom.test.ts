/**
 * 客户端身份落在真实的 `localStorage`（happy-dom）里：键是 `nbook.client-identity`，跨启动读到同一个值，被写坏的值重新生成。
 * 读写规则本身由 nb-host 的 `client-identity.test.ts` 用存储替身测；这里核对替身之外的那一半：真实存储与 NeuroBook 的键。
 */

import {readClientIdentity} from "@notnotype/nb-host/web";
import {beforeEach, describe, expect, it} from "vitest";

import {CLIENT_IDENTITY_KEY} from "./client-identity";

beforeEach(() => {
    window.localStorage.clear();
});

describe("客户端身份（真实本地存储）", () => {
    it("第一次生成并存进 nbook.client-identity，之后的窗口启动读到同一个值", () => {
        const first = readClientIdentity(CLIENT_IDENTITY_KEY, () => window.localStorage);
        expect(first.problem).toBeNull();
        expect(window.localStorage.getItem("nbook.client-identity")).toBe(first.id);
        expect(readClientIdentity(CLIENT_IDENTITY_KEY, () => window.localStorage)).toEqual(first);
    });

    it("存的值被写坏时重新生成并写回", () => {
        window.localStorage.setItem(CLIENT_IDENTITY_KEY, "坏 值");
        const identity = readClientIdentity(CLIENT_IDENTITY_KEY, () => window.localStorage);
        expect(identity.id).not.toBe("坏 值");
        expect(window.localStorage.getItem(CLIENT_IDENTITY_KEY)).toBe(identity.id);
    });
});
