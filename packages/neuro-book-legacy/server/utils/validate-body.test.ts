import {createServer, request} from "node:http";
import {afterEach, describe, expect, it} from "vitest";
import {createApp, eventHandler, toNodeListener} from "h3";
import {z} from "zod";
import {validateBody} from "nbook/server/utils/novel-chapter";

describe("validateBody", () => {
    const servers: ReturnType<typeof createServer>[] = [];

    afterEach(async () => {
        await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
    });

    it("chunked JSON 超过 maxBytes 时在完整读取前返回 413", async () => {
        const app = createApp();
        app.use(eventHandler((event) => validateBody(event, z.object({value: z.string()}), {maxBytes: 16})));
        const server = createServer(toNodeListener(app));
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("测试 server 未监听 TCP 端口");
        }

        const status = await new Promise<number>((resolve, reject) => {
            const outgoing = request({
                host: "127.0.0.1",
                port: address.port,
                method: "POST",
                headers: {"content-type": "application/json", "transfer-encoding": "chunked"},
            }, (response) => {
                response.resume();
                response.on("end", () => resolve(response.statusCode ?? 0));
            });
            outgoing.on("error", reject);
            outgoing.write('{"value":"');
            outgoing.end(`${"x".repeat(64)}"}`);
        });

        expect(status).toBe(413);
    });

    it("Content-Length 已超过 maxBytes 时在读取 body 前返回 413", async () => {
        const app = createApp();
        app.use(eventHandler((event) => validateBody(event, z.object({value: z.string()}), {maxBytes: 16})));
        const server = createServer(toNodeListener(app));
        servers.push(server);
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("测试 server 未监听 TCP 端口");
        }

        const status = await new Promise<number>((resolve, reject) => {
            const outgoing = request({
                host: "127.0.0.1",
                port: address.port,
                method: "POST",
                headers: {"content-type": "application/json", "content-length": "64"},
            }, (response) => {
                response.resume();
                response.on("end", () => resolve(response.statusCode ?? 0));
            });
            outgoing.on("error", reject);
            outgoing.end();
        });

        expect(status).toBe(413);
    });
});
