import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {describe, expect, it, vi} from "vitest";

import {
    configureDesktopProvider,
    parseDesktopProviderInput,
    testDesktopProvider,
} from "#manager/desktop-provider";

describe("desktop provider first-run configuration", () => {
    it("strictly parses the stdin contract", () => {
        const value = {
            name: "Provider",
            baseURL: "https://provider.example/v1",
            api: "openai-responses",
            apiKey: "",
            model: "writer",
            discoverModels: true,
        };
        expect(parseDesktopProviderInput(value)).toEqual(value);
        expect(() => parseDesktopProviderInput({...value, unknown: true})).toThrow("未知字段");
        expect(() => parseDesktopProviderInput({...value, discoverModels: "yes"})).toThrow("字段类型");
        expect(() => parseDesktopProviderInput(null)).toThrow("顶层必须是对象");
    });

    it("writes a runnable custom provider without exposing a secret in the result", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-provider-"));
        try {
            const result = await configureDesktopProvider(root, {
                name: "My Provider",
                baseURL: "https://provider.example/v1",
                api: "openai-completions",
                apiKey: "secret-value",
                model: "writer",
            });
            expect(result).toEqual({providerId: "my-provider", modelKey: "my-provider/writer"});
            const value = JSON.parse(await readFile(join(root, "workspace", ".nbook", "config.json"), "utf8")) as {
                models: {default: string; providers: Array<{options: {apiKey: string}}>}
            };
            expect(value.models.default).toBe("my-provider/writer");
            expect(value.models.providers[0]?.options.apiKey).toBe("secret-value");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("rejects oversized or empty values", async () => {
        const root = await mkdtemp(join(tmpdir(), "nbook-desktop-provider-"));
        try {
            await expect(configureDesktopProvider(root, {
                name: "",
                baseURL: "https://provider.example",
                api: "openai-completions",
                apiKey: "x",
                model: "writer",
            })).rejects.toThrow("不能为空");
            await expect(configureDesktopProvider(root, {
                name: "Provider",
                baseURL: "https://provider.example",
                api: "openai-completions",
                apiKey: "x".repeat(16_385),
                model: "writer",
            })).rejects.toThrow("超过");
        } finally {
            await rm(root, {recursive: true, force: true});
        }
    });

    it("does not fail installation when the provider is offline", async () => {
        const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
        vi.stubGlobal("fetch", fetchMock);
        try {
            const result = await testDesktopProvider({
                name: "Provider",
                baseURL: "https://provider.example/v1",
                api: "openai-completions",
                apiKey: "secret",
                model: "writer",
            });
            expect(result).toEqual({
                ok: false,
                status: null,
                warning: expect.stringContaining("离线"),
                discoverySupported: true,
                models: null,
            });
            expect(fetchMock).toHaveBeenCalledWith(
                new URL("https://provider.example/v1/models"),
                expect.objectContaining({headers: {Authorization: "Bearer secret"}}),
            );
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("accepts a successful HTTP check without echoing the API key", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {status: 200}));
        vi.stubGlobal("fetch", fetchMock);
        try {
            const result = await testDesktopProvider({
                name: "Provider",
                baseURL: "https://provider.example/v1/",
                api: "openai-responses",
                apiKey: "secret",
                model: "writer",
            });
            expect(result).toEqual({
                ok: true,
                status: 200,
                warning: null,
                discoverySupported: true,
                models: null,
            });
            expect(fetchMock.mock.calls[0]?.[0]).toEqual(new URL("https://provider.example/v1/models"));
            expect(JSON.stringify(result)).not.toContain("secret");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("discovers a bounded deduplicated OpenAI-compatible model list", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            data: [
                {id: "writer"},
                {id: "writer"},
                {id: "reasoner"},
                {id: ""},
                {id: "bad\nmodel"},
                {id: "x".repeat(257)},
                {notId: "ignored"},
            ],
        }), {status: 200}));
        vi.stubGlobal("fetch", fetchMock);
        try {
            const result = await testDesktopProvider({
                name: "Provider",
                baseURL: "https://provider.example/v1",
                api: "openai-responses",
                apiKey: "secret",
                model: "",
                discoverModels: true,
            });
            expect(result).toEqual({
                ok: true,
                status: 200,
                warning: null,
                discoverySupported: true,
                models: ["writer", "reasoner"],
            });
            expect(JSON.stringify(result)).not.toContain("secret");
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("does not pretend that non-OpenAI APIs support model discovery", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        try {
            await expect(testDesktopProvider({
                name: "Provider",
                baseURL: "https://provider.example/v1",
                api: "anthropic-messages",
                apiKey: "secret",
                model: "claude",
                discoverModels: true,
            })).resolves.toEqual({
                ok: false,
                status: null,
                warning: expect.stringContaining("不支持自动模型发现"),
                discoverySupported: false,
                models: null,
            });
            expect(fetchMock).not.toHaveBeenCalled();
            await expect(testDesktopProvider({
                name: "Provider",
                baseURL: "https://provider.example/v1",
                api: "anthropic-messages",
                apiKey: "secret",
                model: "claude",
                discoverModels: false,
            })).resolves.toEqual({
                ok: false,
                status: null,
                warning: expect.stringContaining("不支持通用 /models 连接检查"),
                discoverySupported: false,
                models: null,
            });
            expect(fetchMock).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("stops reading model discovery responses after the 1 MiB budget", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            new Uint8Array(1024 * 1024 + 1),
            {status: 200},
        ));
        vi.stubGlobal("fetch", fetchMock);
        try {
            await expect(testDesktopProvider({
                name: "Provider",
                baseURL: "https://provider.example/v1",
                api: "openai-responses",
                apiKey: "secret",
                model: "",
                discoverModels: true,
            })).resolves.toEqual({
                ok: true,
                status: 200,
                warning: expect.stringContaining("超过 1 MiB"),
                discoverySupported: true,
                models: [],
            });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("rejects unsupported API types and credentials embedded in the URL", async () => {
        await expect(testDesktopProvider({
            name: "Provider",
            baseURL: "https://provider.example/v1",
            api: "custom-api",
            apiKey: "",
            model: "writer",
        })).rejects.toThrow("不支持的 Provider API 类型");
        await expect(testDesktopProvider({
            name: "Provider",
            baseURL: "https://user:secret@provider.example/v1",
            api: "openai-completions",
            apiKey: "",
            model: "writer",
        })).rejects.toThrow("不能携带用户名或密码");
        await expect(testDesktopProvider({
            name: "Provider",
            baseURL: "https://provider.example/v1",
            api: "openai-completions",
            apiKey: "密".repeat(8_193),
            model: "writer",
        })).rejects.toThrow("超过 16 KiB");
    });
});
