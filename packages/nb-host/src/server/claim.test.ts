/**
 * 状态根的实例认领（docs/specs/runtime/server-host.md 的“实例认领”）：真实子进程各自认领同一状态根，观察谁认领到、
 * 后来者看到什么；暂停、崩溃后的行为用真实信号。应用是测试里的 `acme`（`src/testing/acme.ts`），档案带一个应用字段。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import type {Subprocess} from "bun";
import {chmod, mkdir, rm, stat} from "node:fs/promises";
import {connect, createServer} from "node:net";
import type {Socket} from "node:net";
import {join} from "node:path";

import {Type} from "typebox";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {ACME_CLAIM} from "../testing/acme";
import {claimStateRoot, defineClaimProfile, HELLO_TIMEOUT_MS, instanceAddress, queryInstance} from "./claim";
import type {ClaimResult, InstanceKind} from "./claim";

const CHILD = join(import.meta.dir, "..", "testing", "claim-child.ts");
const claim = (stateRoot: string, kind: InstanceKind) => claimStateRoot({stateRoot, kind, profile: ACME_CLAIM, report: () => undefined});
const query = (stateRoot: string) => queryInstance(stateRoot, ACME_CLAIM);
const addressOf = (stateRoot: string) => instanceAddress(stateRoot, ACME_CLAIM.socketPrefix);

let tmpRoot = "";
let sequence = 0;
/** 本用例起的认领子进程：断言失败时也要结束（被 SIGSTOP 的先 SIGCONT 不必，SIGKILL 对暂停的进程同样有效）。 */
const spawned = new Set<Subprocess>();

afterEach(async () => {
    for (const child of spawned) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        await child.exited;
    }
    spawned.clear();
});

beforeAll(async () => {
    tmpRoot = await createTestTmpRoot("nb-host", "claim");
});

afterAll(async () => {
    if (tmpRoot !== "") await rm(tmpRoot, {recursive: true, force: true});
});

function nextRoot(): string {
    sequence += 1;
    return join(tmpRoot, `state-${String(sequence)}`);
}

interface Claimer {
    readonly pid: number;
    /** 子进程写出的认领结果（`{ok: true}` 或失败的那一种）。 */
    readonly result: Promise<{readonly ok: true} | Exclude<ClaimResult<typeof ACME_CLAIM.fields>, {ok: true}>>;
    readonly exited: Promise<number | null>;
    release(): void;
    kill(signal: NodeJS.Signals): void;
}

function claimer(stateRoot: string): Claimer {
    const child = Bun.spawn(["bun", CHILD, stateRoot], {stdin: "pipe", stdout: "pipe", stderr: "inherit"});
    spawned.add(child);
    const result = (async () => {
        let out = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            out += chunk;
            const newline = out.indexOf("\n");
            if (newline >= 0) return JSON.parse(out.slice(0, newline)) as Awaited<Claimer["result"]>;
        }
        throw new Error("认领子进程没有写出结果就结束了");
    })();
    return {
        pid: child.pid,
        result,
        exited: child.exited,
        release: () => {
            child.stdin.write("release\n");
            child.stdin.flush();
        },
        kill: (signal) => child.kill(signal),
    };
}

describe("状态根的实例认领（真实子进程）", () => {
    it("第二个认领者拿到第一个的 pid 与 starting 状态；第一个放下后可以再认领", async () => {
        const root = nextRoot();
        const first = claimer(root);
        expect(await first.result).toEqual({ok: true});
        const second = claimer(root);
        expect(await second.result).toMatchObject({ok: false, reason: "running", instance: {schema: 1, pid: first.pid, status: "starting", kind: "fixture", url: null}});
        first.release();
        expect(await first.exited).toBe(0);
        const third = claimer(root);
        expect(await third.result).toEqual({ok: true});
        third.release();
        expect(await third.exited).toBe(0);
    }, 20_000);

    it("实例被暂停（SIGSTOP）时后来者报没有应答、不接管；恢复后实例照常应答", async () => {
        const root = nextRoot();
        const first = claimer(root);
        expect(await first.result).toEqual({ok: true});
        first.kill("SIGSTOP");
        try {
            const second = claimer(root);
            expect(await second.result).toMatchObject({ok: false, reason: "unresponsive"});
        } finally {
            first.kill("SIGCONT");
        }
        // 被暂停期间那次连接已被对方关闭，恢复后往它写会出错：实例不能因此崩溃。
        expect(await query(root)).toMatchObject({state: "running", instance: {pid: first.pid}});
        first.release();
        expect(await first.exited).toBe(0);
    }, 20_000);

    it("实例被 SIGKILL 后，残留的套接字文件不挡下一次认领", async () => {
        const root = nextRoot();
        const first = claimer(root);
        expect(await first.result).toEqual({ok: true});
        first.kill("SIGKILL");
        await first.exited;
        expect(await stat(await addressOf(root)).then(() => "left", () => "gone")).toBe("left");
        expect(await query(root)).toEqual({state: "none"});
        const second = claimer(root);
        expect(await second.result).toEqual({ok: true});
        second.release();
        expect(await second.exited).toBe(0);
    }, 20_000);

    it("几个进程同时认领同一状态根：恰好一个认领到，其余都看到它", async () => {
        const root = nextRoot();
        const all = Array.from({length: 4}, () => claimer(root));
        const results = await Promise.all(all.map((one) => one.result));
        const winners = all.filter((_, index) => results[index]?.ok === true);
        expect(winners).toHaveLength(1);
        for (const result of results) {
            if (!result.ok) expect(result).toMatchObject({reason: "running", instance: {pid: winners[0]?.pid}});
        }
        winners[0]?.release();
        await Promise.all(all.map((one) => one.exited));
    }, 20_000);
});

describe("状态根的实例认领（同进程）", () => {
    it("就绪前应用字段为 null；就绪后应答带地址与应用字段，停止中改报 stopping；放下后删掉套接字文件", async () => {
        const root = nextRoot();
        const claimed = await claim(root, "product");
        if (!claimed.ok) throw new Error(claimed.reason);
        expect(await query(root)).toEqual({state: "running", instance: {schema: 1, pid: process.pid, version: "9.9.9", kind: "product", status: "starting", url: null, rpcUrl: null, modules: null}});
        claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", extra: {modules: {count: 2}}});
        expect(await query(root)).toEqual({
            state: "running",
            instance: {schema: 1, pid: process.pid, version: "9.9.9", kind: "product", status: "ready", url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", modules: {count: 2}},
        });
        claimed.claim.stopping();
        expect(await query(root)).toMatchObject({state: "running", instance: {status: "stopping"}});
        const address = await addressOf(root);
        await claimed.claim.release();
        expect(await stat(address).then(() => "left", () => "gone")).toBe("gone");
        expect(await query(root)).toEqual({state: "none"});
    });

    it("发布不合档案的应用字段时抛错、应答不变：不合的应答会让后来者把本实例判成没有应答", async () => {
        const root = nextRoot();
        const claimed = await claim(root, "product");
        if (!claimed.ok) throw new Error(claimed.reason);
        const wrong = {modules: {count: "two"}} as unknown as {modules: {count: number}};
        expect(() => claimed.claim.publish({url: null, rpcUrl: "ws://127.0.0.1:2/", extra: wrong})).toThrow("do not match the claim profile");
        expect(await query(root)).toMatchObject({state: "running", instance: {status: "starting", rpcUrl: null, modules: null}});
        await claimed.claim.release();
    });

    it("档案的应用字段与基础字段重名：定义时就抛错", () => {
        expect(() => defineClaimProfile({socketPrefix: "acme", version: "1.0.0", fields: {status: Type.String()}})).toThrow("clash with the base answer fields: status");
    });

    it("开发会话的后端不应答页面地址（页面在 Vite 那边）", async () => {
        const root = nextRoot();
        const claimed = await claim(root, "development");
        if (!claimed.ok) throw new Error(claimed.reason);
        claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/", extra: {modules: {count: 0}}});
        expect(await query(root)).toMatchObject({state: "running", instance: {kind: "development", url: null, rpcUrl: "ws://127.0.0.1:2/"}});
        await claimed.claim.release();
    });

    it("状态根路径太长时套接字放进运行时目录，按状态根真实路径命名", async () => {
        const root = join(tmpRoot, "x".repeat(60), "y".repeat(60), "state");
        const claimed = await claim(root, "fixture");
        if (!claimed.ok) throw new Error(claimed.reason);
        const address = await addressOf(root);
        expect(address.startsWith(root)).toBe(false);
        expect(address).toMatch(/acme-[0-9a-f]{16}\.sock$/u);
        expect(await query(root)).toMatchObject({state: "running"});
        await claimed.claim.release();
        expect(await stat(address).then(() => "left", () => "gone")).toBe("gone");
    });

    it("状态根不存在时查询报没有实例、不建目录；认领时建出来", async () => {
        const root = nextRoot();
        expect(await query(root)).toEqual({state: "none"});
        expect(await stat(root).then(() => "exists", () => "missing")).toBe("missing");
        const claimed = await claim(root, "fixture");
        expect(claimed.ok).toBe(true);
        if (claimed.ok) await claimed.claim.release();
    });

    it("应答不合协议（缺字段、缺应用字段、旧版本或别的程序）：当作没有应答，不交给调用方", async () => {
        const root = nextRoot();
        await mkdir(root, {recursive: true});
        const sockets: Socket[] = [];
        const impostor = createServer((socket) => {
            sockets.push(socket);
            // 第一个连接缺基础字段，之后的缺应用字段（别的应用在这个状态根上）。
            const base = {schema: 1, pid: 1, version: "0.0.1", kind: "product", status: "ready", url: null, rpcUrl: null};
            socket.end(`${JSON.stringify(sockets.length === 1 ? {schema: 1, pid: 1, version: "0.0.1"} : base)}\n`);
        });
        await new Promise<void>((resolve) => impostor.listen(join(root, "server.sock"), resolve));
        try {
            expect(await query(root)).toMatchObject({state: "unresponsive"});
            expect(await query(root)).toMatchObject({state: "unresponsive"});
        } finally {
            // 关监听要等连接都断开：Bun 里 end 过的服务端连接不会自己关掉。
            for (const socket of sockets) socket.destroy();
            await new Promise<void>((resolve) => impostor.close(() => resolve()));
        }
    });

    it("连着一个不发请求的客户端：放下认领不被它挡住，客户端被断开", async () => {
        const root = nextRoot();
        const claimed = await claim(root, "fixture");
        if (!claimed.ok) throw new Error(claimed.reason);
        const idle = connect(await addressOf(root));
        await new Promise<void>((resolve) => idle.once("connect", () => resolve()));
        const closed = new Promise<void>((resolve) => idle.once("close", () => resolve()));
        // 放下是主动断开连接，不等连接自己的空闲超时（HELLO_TIMEOUT_MS）。
        const began = performance.now();
        await claimed.claim.release();
        await closed;
        expect(performance.now() - began).toBeLessThan(HELLO_TIMEOUT_MS / 2);
        expect(await query(root)).toEqual({state: "none"});
    });

    it("状态根不可写：报 unwritable", async () => {
        const root = nextRoot();
        await mkdir(root, {recursive: true});
        await chmod(root, 0o555);
        try {
            expect(await claim(root, "fixture")).toMatchObject({ok: false, reason: "unwritable"});
        } finally {
            await chmod(root, 0o755);
        }
    });
});
