/**
 * 客户端身份（runtime.browser-host 术语）：happy-dom 的真实 localStorage；存储不可用用“访问 localStorage 本身就抛错”
 * 表示，与浏览器在禁用站点数据时的行为一致。
 */

import {beforeEach, describe, expect, it} from "vitest";

import {CLIENT_IDENTITY_KEY, readClientIdentity} from "./client-identity";

beforeEach(() => {
    window.localStorage.clear();
});

describe("客户端身份", () => {
    it("第一次生成并存进本地存储，之后的窗口启动读到同一个值", () => {
        const first = readClientIdentity(() => window.localStorage);
        expect(first.problem).toBeNull();
        expect(window.localStorage.getItem(CLIENT_IDENTITY_KEY)).toBe(first.id);
        expect(readClientIdentity(() => window.localStorage)).toEqual(first);
    });

    it("存的值被写坏时重新生成", () => {
        window.localStorage.setItem(CLIENT_IDENTITY_KEY, "坏 值");
        const identity = readClientIdentity(() => window.localStorage);
        expect(identity.id).not.toBe("坏 值");
        expect(window.localStorage.getItem(CLIENT_IDENTITY_KEY)).toBe(identity.id);
    });

    it("本地存储不可用：退回本页随机值并说明原因，每次都不同", () => {
        const denied = (): Storage => {
            throw new DOMException("The operation is insecure.", "SecurityError");
        };
        const first = readClientIdentity(denied);
        const second = readClientIdentity(denied);
        expect(first.problem).toContain("SecurityError");
        expect(first.id).not.toBe(second.id);
    });
});
