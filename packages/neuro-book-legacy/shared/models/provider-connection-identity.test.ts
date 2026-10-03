import {describe, expect, it} from "vitest";
import {normalizeProviderConnectionIdentity, providerConnectionFingerprint, sameProviderConnection} from "nbook/shared/models/provider-connection-identity";

describe("Provider connection identity", () => {
    it("规范化端点尾斜杠但不把 secret 放入 fingerprint", () => {
        const identity = normalizeProviderConnectionIdentity({
            id: " local ",
            baseURL: "https://example.com/v1///",
            proxy: "",
        });

        expect(identity).toEqual({
            id: "local",
            baseURL: "https://example.com/v1",
            proxy: "",
        });
        expect(providerConnectionFingerprint({...identity, apiKey: "secret"} as never)).not.toContain("secret");
    });

    it("端点或代理变化不是同一个连接", () => {
        const base = {id: "local", baseURL: "https://example.com/v1", proxy: ""};
        expect(sameProviderConnection(base, {...base, baseURL: "https://other.example/v1"})).toBe(false);
        expect(sameProviderConnection(base, {...base, proxy: "http://127.0.0.1:7890"})).toBe(false);
        expect(sameProviderConnection(base, {...base, baseURL: "https://example.com/v1/"})).toBe(true);
    });
});
