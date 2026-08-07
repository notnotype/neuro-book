import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {configureDesktopProvider} from "#manager/desktop-provider";

describe("desktop provider first-run configuration", () => {
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
});
