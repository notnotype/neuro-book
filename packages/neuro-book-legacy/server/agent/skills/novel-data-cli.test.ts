import {createServer, type Server} from "node:http";
import {execFile} from "node:child_process";
import {cp, mkdtemp, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {promisify} from "node:util";
import {join, relative, resolve, sep} from "node:path";
import {afterAll, afterEach, beforeAll, describe, expect, it} from "vitest";
import {resolveBaseUrl} from "nbook/assets/workspace/.nbook/agent/skills/novel-data/scripts/novel-data";

const execFileAsync = promisify(execFile);
const SKILL_ROOT = resolve("assets/workspace/.nbook/agent/skills/novel-data");
const openServers: Server[] = [];
let isolatedRoot = "";
let scriptPath = "";

beforeAll(async () => {
    const tempRoot = await mkdtemp(testHostPath("nbook-novel-data-skill-"));
    isolatedRoot = join(tempRoot, "novel-data");
    await cp(SKILL_ROOT, isolatedRoot, {
        recursive: true,
        filter: (source) => relative(SKILL_ROOT, source).split(sep)[0] !== "node_modules",
    });
    await execFileAsync("bun", ["install", "--cwd", isolatedRoot, "--frozen-lockfile"], {
        encoding: "utf8",
    });
    scriptPath = join(isolatedRoot, "scripts", "novel-data.ts");
}, 120_000);

afterEach(async () => {
    await Promise.all(openServers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

afterAll(async () => {
    if (isolatedRoot) {
        await rm(resolve(isolatedRoot, ".."), {recursive: true, force: true});
    }
});

describe("novel-data skill CLI", () => {
    it("按参数、环境变量、默认值解析服务地址", () => {
        expect(resolveBaseUrl("http://127.0.0.1:4100/", "http://127.0.0.1:4200")).toBe("http://127.0.0.1:4100");
        expect(resolveBaseUrl(undefined, "http://127.0.0.1:4200/")).toBe("http://127.0.0.1:4200");
        expect(resolveBaseUrl(undefined, "")).toBe("http://localhost:3000");
        expect(() => resolveBaseUrl("file:///tmp/data", "")).toThrow("只支持 http/https");
    });

    it("rankings 编码路径并原样输出快照时间", async () => {
        let requestPath = "";
        const baseUrl = await startJsonServer((path) => {
            requestPath = path;
            return {platform: "fanqie", rankTypeKey: "0/1", fetchedAt: "2026-07-27T00:00:00.000Z", items: []};
        });

        const result = await runCli(["rankings", "--platform", "fanqie", "--board", "0/1", "--base-url", baseUrl]);

        expect(requestPath).toBe("/v1/rankings/fanqie/0%2F1");
        expect(JSON.parse(result.stdout)).toMatchObject({
            platform: "fanqie",
            fetchedAt: "2026-07-27T00:00:00.000Z",
            items: [],
        });
    });

    it("book-detail 保留 stale 与缓存时间字段", async () => {
        const baseUrl = await startJsonServer(() => ({
            platform: "qidian",
            externalBookId: "123",
            fetchedAt: "2026-07-27T00:00:00.000Z",
            expiresAt: "2026-07-27T03:00:00.000Z",
            stale: true,
        }));

        const result = await runCli(["book-detail", "--platform", "qidian", "--book-id", "123", "--base-url", baseUrl]);

        expect(JSON.parse(result.stdout)).toMatchObject({
            externalBookId: "123",
            stale: true,
            expiresAt: "2026-07-27T03:00:00.000Z",
        });
    });

    it("上游错误写 stderr 并返回非零退出码", async () => {
        const baseUrl = await startJsonServer(() => ({message: "榜单不存在"}), 404);

        await expect(runCli(["rankings", "--platform", "qidian", "--board", "missing", "--base-url", baseUrl]))
            .rejects.toMatchObject({stderr: expect.stringContaining("HTTP 404")});
    });

    it("502 错误保留状态码与上游消息", async () => {
        const baseUrl = await startJsonServer(() => ({message: "采集上游暂时不可用"}), 502);

        await expect(runCli(["book-detail", "--platform", "qidian", "--book-id", "123", "--base-url", baseUrl]))
            .rejects.toMatchObject({stderr: expect.stringContaining("HTTP 502")});
    });

    it("连接失败写 stderr 并返回非零退出码", async () => {
        await expect(runCli(["rankings", "--platform", "qidian", "--board", "yuepiao", "--base-url", "http://127.0.0.1:1"]))
            .rejects.toMatchObject({stderr: expect.stringContaining("无法连接 NovelScope")});
    });
});

/** 启动单路 mock JSON 服务并返回地址。 */
async function startJsonServer(body: (path: string) => object, statusCode = 200): Promise<string> {
    const server = createServer((request, response) => {
        response.statusCode = statusCode;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(body(request.url ?? "")));
    });
    openServers.push(server);
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("mock server 未获得 TCP 地址");
    }
    return `http://127.0.0.1:${address.port}`;
}

/** 以真实 Bun 子进程运行 Skill CLI。 */
async function runCli(args: string[]): Promise<{stdout: string; stderr: string}> {
    return await execFileAsync("bun", [scriptPath, ...args], {
        encoding: "utf8",
        env: {...process.env, NOVEL_DATA_BASE_URL: "http://127.0.0.1:1"},
    });
}
