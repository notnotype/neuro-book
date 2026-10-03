import {EventEmitter} from "node:events";
import {createServer} from "node:http";
import type {Server} from "node:http";
import {afterEach, describe, expect, it} from "vitest";
import {createApp, defineEventHandler, toNodeListener, createEventStream} from "h3";
import type {H3Event} from "h3";
import {ProductHttpAdmission, registerHttpEventStream} from "./admission";

function request() {
    const response = new EventEmitter();
    return {response, event: {node: {res: response}} as H3Event};
}

describe("HTTP 准入合同", () => {
    it("就绪前到达的请求等待就绪后才处理", async () => {
        const http = new ProductHttpAdmission();
        const {event, response} = request();
        let processed = false;
        const handling = http.admit(event).then(() => {processed = true;});
        await Promise.resolve();
        expect(processed).toBe(false);
        http.ready();
        await handling;
        expect(processed).toBe(true);
        response.emit("finish");
        await http.drain();
    });

    it("启动失败时等待中的请求明确返回 503 与失败码，不挂起", async () => {
        const http = new ProductHttpAdmission();
        const first = request();
        const failure = new Error("migration pending");
        const observed = expect(http.admit(first.event)).rejects.toMatchObject({statusCode: 503, data: {code: "PRODUCT_STARTUP_FAILED"}, cause: failure});
        http.failed(failure);
        await observed;
        first.response.emit("finish");
        await expect(http.admit(request().event)).rejects.toMatchObject({statusCode: 503, data: {code: "PRODUCT_STARTUP_FAILED"}});
    });

    it("排空期间新请求返回 503，finish 与 close 重复到达只释放一次，所有在途完成才结算", async () => {
        const http = new ProductHttpAdmission();
        http.ready();
        const first = request();
        const second = request();
        await http.admit(first.event);
        await http.admit(second.event);
        let stopped = false;
        const stopping = http.drain().then(() => {stopped = true;});
        await expect(http.admit(request().event)).rejects.toMatchObject({statusCode: 503, message: "NeuroBook 正在关闭。"});
        first.response.emit("finish");
        first.response.emit("close");
        await Promise.resolve();
        expect(stopped).toBe(false);
        second.response.emit("close");
        await stopping;
        expect(stopped).toBe(true);
    });

    it("在途请求在排空开始后才建立 SSE 时也立即关闭且不占普通等待", async () => {
        const http = new ProductHttpAdmission();
        http.ready();
        const stream = request();
        await http.admit(stream.event);
        const stopping = http.drain();
        let closed = false;
        registerHttpEventStream(stream.event, () => {closed = true;});
        await stopping;
        expect(closed).toBe(true);
        stream.response.emit("close");
    });

    it("SSE 关闭挂起也受排空截止约束，超时明确报告未完成", async () => {
        let expire: (() => void) | undefined;
        const closing = Promise.withResolvers<void>();
        const http = new ProductHttpAdmission({clock: {schedule(task) {expire = task; return () => undefined;}}});
        http.ready();
        const stream = request();
        await http.admit(stream.event);
        registerHttpEventStream(stream.event, () => closing.promise);
        const rejected = expect(http.drain()).rejects.toMatchObject({errors: [expect.objectContaining({message: "HTTP drain 超过 20000ms"})]});
        expire!();
        await rejected;
        closing.resolve();
        stream.response.emit("close");
    });

    it("SSE 关闭失败保留原原因且排空结算为失败", async () => {
        const http = new ProductHttpAdmission();
        http.ready();
        const stream = request();
        await http.admit(stream.event);
        const failure = new Error("stream close failed");
        registerHttpEventStream(stream.event, async () => {throw failure;});
        await expect(http.drain()).rejects.toMatchObject({errors: [failure]});
        stream.response.emit("close");
    });
});

describe("真实 HTTP 排空", () => {
    const servers: Server[] = [];
    afterEach(async () => {
        for (const server of servers.splice(0)) {
            const {promise, resolve, reject} = Promise.withResolvers<void>();
            server.close((error) => error ? reject(error) : resolve());
            server.closeAllConnections();
            await promise;
        }
    });

    it("SSE 在排空开始由服务端主动关闭，不计入普通请求等待，监听仍响应 503", async () => {
        const http = new ProductHttpAdmission();
        http.ready();
        const app = createApp({onError(error, event) {
            event.node.res.statusCode = error.statusCode;
            event.node.res.end(JSON.stringify({message: error.message}));
        }});
        app.use(defineEventHandler((event) => http.admit(event)));
        app.use("/events", defineEventHandler(async (event) => {
            const stream = createEventStream(event);
            registerHttpEventStream(event, () => stream.close());
            const sending = stream.send();
            await stream.push({event: "ready", data: "connected"});
            return sending;
        }));
        app.use("/health", defineEventHandler(() => ({ready: true})));
        const server = createServer(toNodeListener(app));
        servers.push(server);
        const listening = Promise.withResolvers<void>();
        server.listen(0, "127.0.0.1", listening.resolve);
        await listening.promise;
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("HTTP 测试未取得端口");
        const url = `http://127.0.0.1:${String(address.port)}`;
        const response = await fetch(`${url}/events`);
        expect(response.status).toBe(200);
        const ending = response.text();
        await http.drain();
        expect(await ending).toBe("event: ready\ndata: connected\n\n");
        const during = await fetch(`${url}/health`);
        expect(during.status).toBe(503);
        expect(await during.json()).toMatchObject({message: "NeuroBook 正在关闭。"});
    });
});
