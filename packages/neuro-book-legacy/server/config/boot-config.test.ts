import {mkdtemp, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

const originalCwd = process.cwd();
const originalApplicationRoot = process.env.NEURO_BOOK_APPLICATION_ROOT;
const originalStateRoot = process.env.NEURO_BOOK_STATE_ROOT;
let tempDir: string | null = null;

describe("Boot Config auth", () => {
    afterEach(async () => {
        process.chdir(originalCwd);
        restoreEnv("NEURO_BOOK_APPLICATION_ROOT", originalApplicationRoot);
        restoreEnv("NEURO_BOOK_STATE_ROOT", originalStateRoot);
        if (tempDir) {
            await rm(tempDir, {recursive: true, force: true});
            tempDir = null;
        }
    });

    it("显式配置严格控制鉴权", async () => {
        await useConfig("auth:\n  enabled: false\n");
        const {resolveBootAuthEnabled} = await importFreshConfig();
        expect(resolveBootAuthEnabled("production")).toBe(false);

        await writeFile("config.yaml", "auth:\n  enabled: true\n", "utf-8");
        expect(resolveBootAuthEnabled("development")).toBe(true);
    });

    it("缺省时开发关闭、生产开启", async () => {
        await useConfig("server: {}\n");
        const {resolveBootAuthEnabled} = await importFreshConfig();

        expect(resolveBootAuthEnabled("development")).toBe(false);
        expect(resolveBootAuthEnabled("production")).toBe(true);
        expect(resolveBootAuthEnabled(undefined)).toBe(true);
    });

    it("非法 auth.enabled 会明确失败", async () => {
        await useConfig("auth:\n  enabled: disabled\n");
        const {resolveBootAuthEnabled} = await importFreshConfig();

        expect(() => resolveBootAuthEnabled("development")).toThrow("config.yaml auth.enabled 必须是 boolean");
    });

    it("进程内固定首次读取结果，修改文件后必须重启", async () => {
        await useConfig("auth:\n  enabled: false\n");
        const {loadBootAuthEnabledSync} = await importFreshConfig();

        expect(loadBootAuthEnabledSync()).toBe(false);
        await writeFile("config.yaml", "auth:\n  enabled: true\n", "utf-8");
        expect(loadBootAuthEnabledSync()).toBe(false);
    });
});

async function useConfig(text: string): Promise<void> {
    tempDir = await mkdtemp(testHostPath("nbook-boot-config-"));
    process.chdir(tempDir);
    process.env.NEURO_BOOK_APPLICATION_ROOT = tempDir;
    process.env.NEURO_BOOK_STATE_ROOT = tempDir;
    await writeFile("config.yaml", text, "utf-8");
}

function restoreEnv(name: "NEURO_BOOK_APPLICATION_ROOT" | "NEURO_BOOK_STATE_ROOT", value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}

async function importFreshConfig() {
    vi.resetModules();
    return await import("nbook/server/config/boot-config");
}
