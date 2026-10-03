import {spawn} from "node:child_process";
import {mkdir, mkdtemp, rm, symlink} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {resolveAppSqliteLocation} from "nbook/server/runtime/app-sqlite-location";

let tempRoot: string | null = null;

afterEach(async () => {
    if (tempRoot) {
        await removeTestRoot(tempRoot);
        tempRoot = null;
    }
});

describe("SQLite Location", () => {
    it("相对URL只基于State Root解析", async () => {
        tempRoot = await mkdtemp(testHostPath("nbook-sqlite-location-"));
        const stateRoot = path.join(tempRoot, "data");

        const location = resolveAppSqliteLocation("file:./workspace/.nbook/neuro-book.sqlite", stateRoot);

        expect(location.hostPath).toBe(path.join(stateRoot, "workspace", ".nbook", "neuro-book.sqlite"));
        expect(location.connectionUrl).toBe(fileUrl(location.hostPath));
        expect(location.scope).toBe("state-root");
        expect(location.containerUrl).toBe("file:/app/workspace/.nbook/neuro-book.sqlite");
    });

    it("拒绝越过State Root的相对URL", async () => {
        tempRoot = await mkdtemp(testHostPath("nbook-sqlite-location-"));
        const stateRoot = path.join(tempRoot, "data");

        expect(() => resolveAppSqliteLocation("file:../../outside/neuro-book.sqlite", stateRoot))
            .toThrow("越过State Root");
    });

    it("拒绝相对URL通过junction或symlink逃出State Root", async () => {
        tempRoot = await mkdtemp(testHostPath("nbook-sqlite-location-"));
        const stateRoot = path.join(tempRoot, "data");
        const externalRoot = path.join(tempRoot, "external");
        await mkdir(stateRoot, {recursive: true});
        await mkdir(externalRoot, {recursive: true});
        await symlink(externalRoot, path.join(stateRoot, "linked"), process.platform === "win32" ? "junction" : "dir");

        expect(() => resolveAppSqliteLocation("file:./linked/app.sqlite", stateRoot))
            .toThrow("越过State Root");
    });

    it("绝对URL不受cwd和Application Root影响", async () => {
        tempRoot = await mkdtemp(testHostPath("nbook-sqlite-location-"));
        const databasePath = path.join(tempRoot, "external", "app.sqlite");

        const location = resolveAppSqliteLocation(fileUrl(databasePath), path.join(tempRoot, "data"));

        expect(location).toEqual({
            configuredUrl: fileUrl(databasePath),
            connectionUrl: fileUrl(databasePath),
            hostPath: databasePath,
            scope: "external",
        });
    });

    it.runIf(process.platform !== "win32")("支持POSIX标准三斜杠绝对file URL", () => {
        const location = resolveAppSqliteLocation("file:///var/lib/neuro-book/app.sqlite", "/srv/neuro-book");
        expect(location.hostPath).toBe("/var/lib/neuro-book/app.sqlite");
        expect(location.scope).toBe("external");
    });

    it("规范化URL可以由PrismaLibSql真实连接", async () => {
        tempRoot = await mkdtemp(testHostPath("nbook-sqlite-location-"));
        const location = resolveAppSqliteLocation("file:./workspace/.nbook/app.sqlite", path.join(tempRoot, "data"));
        await mkdir(path.dirname(location.hostPath), {recursive: true});
        const result = await runBun(["-e", [
                'import {PrismaLibSql} from "@prisma/adapter-libsql";',
                'import {PrismaClient} from "./server/generated/prisma/client.ts";',
                'const prisma = new PrismaClient({adapter: new PrismaLibSql({url: process.env.TEST_DATABASE_URL!})});',
                'const rows = await prisma.$queryRawUnsafe("SELECT 1 AS value");',
                'console.log(JSON.stringify(rows));',
                'await prisma.$disconnect();',
            ].join("")], {TEST_DATABASE_URL: location.connectionUrl});

        expect(result.exitCode, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout.trim())).toEqual([{value: 1}]);
    });

    it.each(["sqlite:app.sqlite", "file:", "file::memory:"])("拒绝非法SQLite URL：%s", (url) => {
        expect(() => resolveAppSqliteLocation(url, process.cwd())).toThrow();
    });

    it.each(["file://server/share/app.sqlite", "file:\\\\server\\share\\app.sqlite"])("拒绝UNC：%s", (url) => {
        expect(() => resolveAppSqliteLocation(url, process.cwd())).toThrow("UNC");
    });

    it.runIf(process.platform === "win32").each([
        "file:C:/NeuroBook/data/app.sqlite",
        "file:/C:/NeuroBook/data/app.sqlite",
        "file:///C:/NeuroBook/data/app.sqlite",
    ])("规范化Windows绝对URL：%s", (url) => {
        const location = resolveAppSqliteLocation(url, "C:/NeuroBook/data");
        expect(location.hostPath).toBe("C:\\NeuroBook\\data\\app.sqlite");
        expect(location.connectionUrl).toBe("file:C:/NeuroBook/data/app.sqlite");
    });
});

/** 将绝对路径编码为当前libsql已验证的本机file URL格式。 */
function fileUrl(databasePath: string): string {
    return `file:${databasePath.replaceAll("\\", "/")}`;
}

/** Windows libsql句柄释放可能略晚于Prisma disconnect，测试清理做有限重试。 */
async function removeTestRoot(root: string): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt++) {
        try {
            await rm(root, {recursive: true, force: true});
            return;
        } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "EBUSY") || attempt === 19) {
                throw error;
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
    }
}

/** 在独立Bun进程中验证Product使用的Prisma adapter连接边界。 */
function runBun(args: string[], env: NodeJS.ProcessEnv): Promise<{exitCode: number | null; stdout: string; stderr: string}> {
    return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn("bun", args, {
            cwd: process.cwd(),
            env: {...process.env, ...env},
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });
        child.once("error", rejectPromise);
        child.once("close", (exitCode) => resolvePromise({exitCode, stdout, stderr}));
    });
}
