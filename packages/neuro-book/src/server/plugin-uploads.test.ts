/**
 * 插件文件夹上传的暂存区在服务端停止时的收口（plugin-install 输出 11“服务端停止时取消正在接收的上传”）：同进程、真实认领的服务端用产品的
 * 插件装配，经真实 HTTP 发一个只发了帧头的前两个字节、之后不再发也不断开的上传。停止开始时暂存区就取消它，所以排空不用等到截止，
 * 服务端以 0 退出；上传的请求得到失败应答，暂存目录不留下它。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {readdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {PROJECT_LIMIT_DEFAULTS} from "./config";
import {manifestServerPlugins} from "./plugins";
import {startClaimedServer} from "./testing/claimed-server";

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-plugin-uploads-stop", "plugin-uploads-stop");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("上传暂存区与服务端停止", () => {
    it("半个帧头的上传在停止开始时被取消：排空不等截止、以 0 退出，上传得到失败应答，暂存目录里没有它", async () => {
        const stateRoot = join(tmp, "state");
        const server = await startClaimedServer({
            config: {host: "127.0.0.1", port: 0, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
            plugins: (context) => manifestServerPlugins(context),
            process: new EventEmitter(),
            writeFatal: () => undefined,
        });
        await server.ready;
        const stalled = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([0, 0]));
            },
        });
        const uploading = fetch(`${server.url}api/nbook.plugins/uploads`, {method: "POST", body: stalled, duplex: "half"} as RequestInit).then(async (response) => ({status: response.status, body: await response.text()}), (error: unknown) => ({status: 0, body: String(error)}));
        await waitUntil("上传请求被服务端接纳", () => server.activeRequests === 1, {timeoutMs: 10_000, intervalMs: 20});

        const began = Date.now();
        server.requestStop("test:stop-with-half-upload");
        const outcome = await server.stopped;
        expect(outcome.exitCode).toBe(0);
        // 排空的截止是 20 秒：没有被半帧拖住就远用不到。
        expect(Date.now() - began).toBeLessThan(10_000);
        const response = await uploading;
        // 取消时请求要么得到失败应答，要么连接被关掉；总之不是成功。
        expect([500, 503, 0]).toContain(response.status);
        expect(await readdir(join(stateRoot, "plugin-uploads")).catch(() => [])).toEqual([]);
    }, 40_000);
});
