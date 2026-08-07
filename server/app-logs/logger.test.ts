import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    AppFileLogger,
    listAppLogFiles,
    readAppLogStatus,
    redactSensitiveText,
    resolveAppLogDirectory,
    sanitizeAppLogValue,
    serializeAppLogError,
} from "nbook/server/app-logs/logger";
import {testHostPath} from "nbook/server/runtime/paths/test-path";

const cleanupRoots: string[] = [];

afterEach(async () => {
    for (const root of cleanupRoots.splice(0)) {
        await fs.rm(root, {recursive: true, force: true});
    }
});

/**
 * 创建临时日志根目录。
 */
async function tempLogRoot(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nbook-app-logs-"));
    cleanupRoots.push(root);
    return root;
}

describe("app logs logger", () => {
    it("resolves explicit log directory before environment fallbacks", () => {
        const productRoot = testHostPath("app-logs", "product");
        const repoRoot = testHostPath("app-logs", "repo");
        expect(resolveAppLogDirectory({
            cwd: productRoot,
            env: {NEURO_BOOK_LOG_DIR: "data/logs"} as NodeJS.ProcessEnv,
        })).toBe(path.join(productRoot, "data", "logs"));
        expect(resolveAppLogDirectory({
            cwd: productRoot,
            env: {NODE_ENV: "production"} as NodeJS.ProcessEnv,
        })).toBe(path.join(productRoot, "logs"));
        expect(resolveAppLogDirectory({
            cwd: repoRoot,
            env: {} as NodeJS.ProcessEnv,
        })).toBe(path.join(repoRoot, "workspace", ".nbook", "logs"));
    });

    it("redacts common secret fields recursively", () => {
        const sanitized = sanitizeAppLogValue({
            apiKey: "sk-123",
            authorization: "Bearer token",
            cookie: "sid=1",
            password: "pw",
            recoveryCode: "NBK1-secret",
            deviceCode: "device-secret",
            grant: {refreshToken: "refresh-secret"},
            backupKey: "backup-secret",
            nested: {
                token: "token",
                secret: "secret",
                safe: "visible",
            },
        });

        expect(sanitized).toEqual({
            apiKey: "[REDACTED]",
            authorization: "[REDACTED]",
            cookie: "[REDACTED]",
            password: "[REDACTED]",
            recoveryCode: "[REDACTED]",
            deviceCode: "[REDACTED]",
            grant: "[REDACTED]",
            backupKey: "[REDACTED]",
            nested: {
                token: "[REDACTED]",
                secret: "[REDACTED]",
                safe: "visible",
            },
        });
    });

    it("redacts sensitive tokens from free text and error stacks", () => {
        expect(redactSensitiveText("Authorization: Bearer abc123 token=secret apiKey=sk-testvalue123456"))
            .toBe("Authorization: Bearer [REDACTED] token=[REDACTED] apiKey=[REDACTED]");
        expect(redactSensitiveText("NBK1-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA-00000000"))
            .toBe("[REDACTED]");

        const error = new Error("request failed password=hunter2");
        error.stack = "Error: request failed\napiKey=sk-realkey123456789";
        expect(serializeAppLogError(error)).toMatchObject({
            message: "request failed password=[REDACTED]",
            stack: "Error: request failed\napiKey=[REDACTED]",
        });
    });

    it("writes jsonl entries with sanitized data and serialized errors", async () => {
        const root = await tempLogRoot();
        const logger = new AppFileLogger({
            env: {NEURO_BOOK_LOG_DIR: root} as NodeJS.ProcessEnv,
            now: () => new Date("2026-06-28T10:00:00.000Z"),
        });

        await logger.error("test.error", {path: "/api/test", apiKey: "hidden"}, new Error("boom"), "请求失败 token=hidden");
        await logger.flush();

        const text = await fs.readFile(path.join(root, "server-current.jsonl"), "utf8");
        const entry = JSON.parse(text.trim()) as Record<string, unknown>;
        expect(entry).toMatchObject({
            timestamp: "2026-06-28T10:00:00.000Z",
            level: "error",
            event: "test.error",
            message: "请求失败 token=[REDACTED]",
        });
        expect(entry.data).toMatchObject({path: "/api/test", apiKey: "[REDACTED]"});
        expect(entry.error).toMatchObject({name: "Error", message: "boom"});
    });

    it("writes fatal logs synchronously for crash paths", async () => {
        const root = await tempLogRoot();
        const logger = new AppFileLogger({
            env: {NEURO_BOOK_LOG_DIR: root} as NodeJS.ProcessEnv,
            now: () => new Date("2026-06-28T10:01:00.000Z"),
        });

        logger.fatalSync("process.uncaughtException", undefined, new Error("fatal token=secret"), "Uncaught exception");

        const text = await fs.readFile(path.join(root, "server-current.jsonl"), "utf8");
        const entry = JSON.parse(text.trim()) as Record<string, unknown>;
        expect(entry).toMatchObject({
            timestamp: "2026-06-28T10:01:00.000Z",
            level: "fatal",
            event: "process.uncaughtException",
        });
        expect(entry.error).toMatchObject({message: "fatal token=[REDACTED]"});
    });

    it("rotates server-current and prunes old server logs", async () => {
        const root = await tempLogRoot();
        let second = 0;
        const logger = new AppFileLogger({
            env: {NEURO_BOOK_LOG_DIR: root} as NodeJS.ProcessEnv,
            maxFileBytes: 180,
            retention: 3,
            maxAgeMs: 30 * 24 * 60 * 60 * 1000,
            now: () => new Date(`2026-06-28T10:00:${String(second++).padStart(2, "0")}.000Z`),
        });
        const expired = path.join(root, "server-20250101-000000-1-deadbeef.jsonl");
        await fs.writeFile(expired, "{}\n", "utf8");
        await fs.utimes(expired, new Date("2025-01-01T00:00:00.000Z"), new Date("2025-01-01T00:00:00.000Z"));

        for (let index = 0; index < 8; index += 1) {
            await logger.info("test.large", {index, text: "x".repeat(80)});
        }
        await logger.flush();

        const files = await listAppLogFiles(root);
        const serverFiles = files.filter((file) => file.name === "server-current.jsonl" || file.name.startsWith("server-"));
        expect(serverFiles.length).toBeLessThanOrEqual(3);
        expect(serverFiles.some((file) => file.name === "server-current.jsonl")).toBe(true);
        expect(serverFiles.some((file) => file.name === path.basename(expired))).toBe(false);
    });

    it("first write prunes expired launcher logs and enforces the total byte budget", async () => {
        const root = await tempLogRoot();
        const oldLauncher = path.join(root, "launcher-2026-05-01.log");
        const recentLauncher = path.join(root, "launcher-2026-06-27.log");
        const recentServer = path.join(root, "server-20260627-120000-1-deadbeef.jsonl");
        await Promise.all([
            fs.writeFile(oldLauncher, "o".repeat(80), "utf8"),
            fs.writeFile(recentLauncher, "l".repeat(80), "utf8"),
            fs.writeFile(recentServer, "s".repeat(80), "utf8"),
        ]);
        await fs.utimes(oldLauncher, new Date("2026-05-01T00:00:00.000Z"), new Date("2026-05-01T00:00:00.000Z"));
        await fs.utimes(recentLauncher, new Date("2026-06-27T12:00:00.000Z"), new Date("2026-06-27T12:00:00.000Z"));
        await fs.utimes(recentServer, new Date("2026-06-27T11:00:00.000Z"), new Date("2026-06-27T11:00:00.000Z"));

        const logger = new AppFileLogger({
            env: {NEURO_BOOK_LOG_DIR: root} as NodeJS.ProcessEnv,
            maxFileBytes: 1024,
            maxTotalBytes: 190,
            retention: 4,
            maxAgeMs: 30 * 24 * 60 * 60 * 1000,
            now: () => new Date("2026-06-28T12:00:00.000Z"),
        });
        await logger.info("startup", {ready: true});
        await logger.flush();

        const files = await listAppLogFiles(root);
        expect(files.map((file) => file.name)).toContain("server-current.jsonl");
        expect(files.map((file) => file.name)).toContain(path.basename(recentLauncher));
        expect(files.map((file) => file.name)).not.toContain(path.basename(oldLauncher));
        expect(files.map((file) => file.name)).not.toContain(path.basename(recentServer));
        expect(files.reduce((sum, file) => sum + file.size, 0)).toBeLessThanOrEqual(190);
    });

    it("summarizes status for empty and populated directories", async () => {
        const root = await tempLogRoot();
        await expect(readAppLogStatus(root)).resolves.toMatchObject({
            directory: root,
            fileCount: 0,
            totalBytes: 0,
            latestMtimeMs: null,
        });

        await fs.writeFile(path.join(root, "launcher-2026-06-28.log"), "hello\n", "utf8");
        const status = await readAppLogStatus(root);
        expect(status.fileCount).toBe(1);
        expect(status.totalBytes).toBe(6);
        expect(status.latestMtimeMs).toEqual(expect.any(Number));
    });
});
