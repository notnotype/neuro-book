import {randomUUID} from "node:crypto";
import {once} from "node:events";
import {mkdir, rm} from "node:fs/promises";
import {createServer, type Server} from "node:http";
import {join} from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {createApp, defineEventHandler, toNodeListener} from "h3";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    closeAllProjects,
    closeProject,
    isProjectOpen,
    resetProjectSessionsForTest,
} from "nbook/server/workspace-files/project-session";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

/**
 * 真实 H3 路由合同：open 发布的 ready 标识与 presence 请求/回报必须是同一个精确代次。
 *
 * 本文件刻意不使用与前端相同的手写字符串桩，而是跑真实 route handler、真实 SSE 与真实 Facade，
 * 覆盖「open 到 presence 之间被 close/reopen」这一路径无法用字符串比较替代的场景。
 */
describe("Project ready publication HTTP 合同", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;
    let server: Server;
    let baseUrl: string;
    let openHandler: (event: never) => unknown;
    let presenceHandler: (event: never) => unknown;

    beforeAll(async () => {
        // 真实 route 依赖 Nuxt 自动导入的 defineEventHandler；在载入 handler 前绑定真实实现。
        vi.stubGlobal("defineEventHandler", defineEventHandler);
        openHandler = (await import("nbook/server/api/projects/open.post")).default;
        presenceHandler = (await import("nbook/server/api/projects/presence.get")).default;
    });

    afterAll(() => {
        vi.unstubAllGlobals();
    });

    beforeEach(async () => {
        resetProjectSessionsForTest();
        tempRoot = testHostPath(`neuro-book-project-ready-http-${randomUUID()}`);
        workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
        await writeProjectManifest(workspaceRoot, projectWorkspaceRef("h3-book"), {
            kind: "novel",
            title: "H3 Book",
            summary: "",
        });

        const app = createApp();
        app.use("/api/projects/open", openHandler as never);
        app.use("/api/projects/presence", presenceHandler as never);
        server = createServer(toNodeListener(app));
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const address = server.address();
        if (address === null || typeof address === "string") {
            throw new Error("Project ready HTTP 合同测试未取得 TCP 地址");
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await closeAllProjects().catch(() => undefined);
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        await rm(tempRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }, 60_000);

    it("open 发布的标识与 presence 回报的标识必须一致", async () => {
        const opened = await openProjectOverHttp();
        expect(opened.publicId).toBeTruthy();

        const ready = await readPresenceReadyEvent(opened.publicId);
        expect(ready).toEqual({
            type: "presence_ready",
            projectRoot: "h3-book",
            publicId: opened.publicId,
        });
    });

    it("缺少标识返回 400，未命中的标识返回 409", async () => {
        const opened = await openProjectOverHttp();

        expect((await fetch(`${baseUrl}/api/projects/presence?projectRoot=h3-book`)).status).toBe(400);
        expect((await fetch(
            `${baseUrl}/api/projects/presence?projectRoot=h3-book&publicId=${encodeURIComponent(`${opened.publicId}-stale`)}`,
        )).status).toBe(409);
    });

    it("真实 presence 流在其 Project 关闭时结束，无需等待下次心跳", async () => {
        const opened = await openProjectOverHttp();
        const abort = new AbortController();
        try {
            const response = await fetch(
                `${baseUrl}/api/projects/presence?projectRoot=h3-book&publicId=${encodeURIComponent(opened.publicId)}`,
                {signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)])},
            );
            expect(response.status).toBe(200);
            if (!response.body) throw new Error("presence 未返回流式响应");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let frame = "";
            while (!frame.includes("\n\n")) {
                const part = await reader.read();
                if (part.done) throw new Error("presence 在首帧前结束");
                frame += decoder.decode(part.value, {stream: true});
            }
            expect(frame).toContain(opened.publicId);

            await closeProject(projectWorkspaceRef("h3-book"), "shutdown");

            await expect(reader.read()).resolves.toEqual({value: undefined, done: true});
            expect(isProjectOpen(projectWorkspaceRef("h3-book"))).toBe(false);
        } finally {
            abort.abort();
        }
    }, 15_000);

    it("close/reopen 之间的旧标识不能接到新 generation，新标识可以", async () => {
        const first = await openProjectOverHttp();
        await closeProject(projectWorkspaceRef("h3-book"), "shutdown");

        // 旧 open 之后、旧 presence 之前发生的 close/reopen 必须被拒绝。
        expect((await fetch(
            `${baseUrl}/api/projects/presence?projectRoot=h3-book&publicId=${encodeURIComponent(first.publicId)}`,
        )).status).toBe(409);

        const second = await openProjectOverHttp();
        expect(second.publicId).not.toBe(first.publicId);

        // 旧标识在新代次仍然拒绝，新标识才拿到本代次 presence。
        expect((await fetch(
            `${baseUrl}/api/projects/presence?projectRoot=h3-book&publicId=${encodeURIComponent(first.publicId)}`,
        )).status).toBe(409);
        await expect(readPresenceReadyEvent(second.publicId)).resolves.toMatchObject({
            publicId: second.publicId,
        });
    });

    it("同路径目录被替换后也不接受旧标识", async () => {
        const first = await openProjectOverHttp();
        await closeProject(projectWorkspaceRef("h3-book"), "shutdown");
        expect(isProjectOpen(projectWorkspaceRef("h3-book"))).toBe(false);

        // 路径与目录名不变，但物理目录是新的 Project：旧 ready 对象不能认领新实例。
        await rm(join(workspaceRoot, "h3-book"), {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
        await writeProjectManifest(workspaceRoot, projectWorkspaceRef("h3-book"), {
            kind: "novel",
            title: "H3 Book",
            summary: "",
        });

        const second = await openProjectOverHttp();
        expect(second.publicId).not.toBe(first.publicId);
        expect((await fetch(
            `${baseUrl}/api/projects/presence?projectRoot=h3-book&publicId=${encodeURIComponent(first.publicId)}`,
        )).status).toBe(409);
        await expect(readPresenceReadyEvent(second.publicId)).resolves.toMatchObject({
            projectRoot: "h3-book",
            publicId: second.publicId,
        });
    });

    /** 通过真实 H3 route 打开 Project，并返回其 publication 与 ready 标识。 */
    async function openProjectOverHttp(): Promise<{
        readonly revision: number;
        readonly publicId: string;
        readonly project: {readonly projectRoot: string};
    }> {
        const response = await fetch(`${baseUrl}/api/projects/open`, {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({projectRoot: "h3-book"}),
        });
        expect(response.status).toBe(200);
        return await response.json() as {
            readonly revision: number;
            readonly publicId: string;
            readonly project: {readonly projectRoot: string};
        };
    }

    /** 读取真实 presence SSE 的首帧，并释放流。 */
    async function readPresenceReadyEvent(publicId: string): Promise<unknown> {
        const response = await fetch(
            `${baseUrl}/api/projects/presence?projectRoot=h3-book&publicId=${encodeURIComponent(publicId)}`,
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        if (!response.body) {
            throw new Error("presence 未返回流式响应");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
            while (!buffer.includes("\n\n")) {
                const {done, value} = await reader.read();
                if (done) {
                    throw new Error(`presence 在首帧前结束：${buffer}`);
                }
                buffer += decoder.decode(value, {stream: true});
            }
        } finally {
            await reader.cancel().catch(() => undefined);
        }
        const dataLine = buffer.slice(0, buffer.indexOf("\n\n"))
            .split(/\r?\n/u)
            .find((line) => line.startsWith("data:"));
        if (!dataLine) {
            throw new Error(`presence 首帧缺少 data 行：${buffer}`);
        }
        return JSON.parse(dataLine.slice("data:".length));
    }
});
