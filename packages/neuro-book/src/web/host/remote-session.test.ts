/**
 * 远程服务链路的退避重连（runtime.browser-host 的“断线与重连”）：同进程的真实后端、真实 fetch 与 WebSocket、
 * 真实内核节点；退避用手动时钟，每一步等到这次重连的结果出来再推进时钟。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createRemoteNode} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {PROJECT_LIMIT_DEFAULTS} from "nbook/server/config";
import {startServer} from "nbook/server/start";
import type {RunningServer} from "nbook/server/start";

import {createConnection} from "./connection";
import {createRemoteSession} from "./remote-session";
import type {RemoteSessionState} from "./remote-session";

let tmp = "";
let sequence = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-remote-session", "remote-session");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

function serverAt(port: number): RunningServer {
    sequence += 1;
    const stateRoot = join(tmp, `state-${String(sequence)}`);
    return startServer({
        config: {host: "127.0.0.1", port, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, shiftPorts: false, allowedOrigins: [], projects: PROJECT_LIMIT_DEFAULTS},
        process: new EventEmitter(),
        writeFatal: () => undefined,
    });
}

describe("远程服务链路的退避重连", () => {
    it("断线后按 0.5、1、2 秒退避重试，每次先重新取引导；服务端换进程后转为 server-restarted 并停止", async () => {
        const first = serverAt(0);
        await first.ready;
        const httpUrl = first.url!;
        const clock = new ManualClock();
        const states: RemoteSessionState[] = [];
        const failures: string[] = [];
        const node = createRemoteNode({instance: {id: "browser-1", kind: "browser", role: "client", project: null, client: "profile-1"}, clock});
        const session = createRemoteSession({
            connection: createConnection(httpUrl),
            node,
            clock,
            onState: (state) => states.push(state),
            onRetryFailed: (reason) => failures.push(reason),
        });
        expect(await session.start({port: Number(new URL(first.rpcUrl).port), path: "/"})).toEqual({ok: true});

        first.requestStop("test:restart");
        await first.stopped;
        await waitUntil("链路断开后转为离线", () => states.at(-1) === "offline");

        // 服务端不在：每次重连都在取引导时失败，下一次的等待翻倍。
        for (const [index, delay] of [500, 1000, 2000].entries()) {
            clock.advance(delay);
            await waitUntil(`第 ${String(index + 1)} 次重连失败`, () => failures.length === index + 1);
        }

        const second = serverAt(Number(new URL(httpUrl).port));
        await second.ready;
        clock.advance(4000);
        await waitUntil("连回新的服务端进程，识别为服务端已重启", () => states.at(-1) === "server-restarted");
        expect(states).toEqual(["offline", "server-restarted"]);

        session.close();
        second.requestStop("test:done");
        await second.stopped;
    }, 20_000);
});
