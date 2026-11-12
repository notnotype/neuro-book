/**
 * 客户端身份（runtime.browser-host 术语）：存储替身是 `Map` 上的 `getItem`、`setItem`；存储不可用用“取存储本身就抛
 * `SecurityError`”表示，与浏览器在禁用站点数据时访问 `localStorage` 的行为一致。替身只依赖“没有的键 `getItem` 交回 null、
 * `setItem` 存字符串”；在真实 `localStorage` 上的读写由应用的 `src/web/host/client-identity.dom.test.ts`（happy-dom）核对。
 */

import {describe, expect, it} from "bun:test";

import {readClientIdentity} from "./client-identity";
import type {IdentityStorage} from "./client-identity";

const KEY = "acme.client-identity";

function mapStorage(): IdentityStorage & {readonly values: Map<string, string>} {
    const values = new Map<string, string>();
    return {
        values,
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
            values.set(key, value);
        },
    };
}

describe("客户端身份", () => {
    it("第一次生成并存进本地存储，之后的窗口启动读到同一个值", () => {
        const storage = mapStorage();
        const first = readClientIdentity(KEY, () => storage);
        expect(first.problem).toBeNull();
        expect(storage.values.get(KEY)).toBe(first.id);
        expect(readClientIdentity(KEY, () => storage)).toEqual(first);
    });

    it("键由应用给：不同的键各有各的身份", () => {
        const storage = mapStorage();
        const a = readClientIdentity("a.client-identity", () => storage);
        const b = readClientIdentity("b.client-identity", () => storage);
        expect(a.id).not.toBe(b.id);
        expect([...storage.values.keys()].sort()).toEqual(["a.client-identity", "b.client-identity"]);
    });

    it("存的值被写坏时重新生成", () => {
        const storage = mapStorage();
        storage.values.set(KEY, "坏 值");
        const identity = readClientIdentity(KEY, () => storage);
        expect(identity.id).not.toBe("坏 值");
        expect(storage.values.get(KEY)).toBe(identity.id);
    });

    it("本地存储不可用：退回本页随机值并说明原因，每次都不同", () => {
        const denied = (): IdentityStorage => {
            throw new DOMException("The operation is insecure.", "SecurityError");
        };
        const first = readClientIdentity(KEY, denied);
        const second = readClientIdentity(KEY, denied);
        expect(first.problem).toContain("SecurityError");
        expect(first.id).not.toBe(second.id);
    });

    it("写不进本地存储（例如配额已满）：本页照常用新值，并说明原因", () => {
        const full: IdentityStorage = {
            getItem: () => null,
            setItem: () => {
                throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
            },
        };
        const identity = readClientIdentity(KEY, () => full);
        expect(identity.id).not.toBe("");
        expect(identity.problem).toContain("QuotaExceededError");
    });
});
