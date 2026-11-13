/**
 * 桌面锁与开窗转交（docs/specs/runtime/desktop-shell.md 输出 1 到 3）：锁与服务端认领在同一状态根上互不干扰；后来者问到的
 * 几种情形。几个进程同时取锁只有一个成功、暂停不接管等跨进程的保证由 nb-host 的认领测试覆盖（同一个认领实现）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {claimNeuroBook} from "../server/instance";
import {PRODUCT_VERSION} from "../shared/product";
import {acquireDesktopLock, askRunningShell} from "./lock";
import type {OpenWindowReply} from "./lock";

let tmp = "";
let sequence = 0;
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop", "lock");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});
const nextRoot = () => join(tmp, `state-${String((sequence += 1))}`);

describe("桌面锁", () => {
    it("与服务端认领各占各的；同版本的后来者经 open-window 让持有者开窗，三种应答对应三种下一步", async () => {
        const root = nextRoot();
        const server = await claimNeuroBook({stateRoot: root, kind: "product", report: () => undefined});
        let reply: OpenWindowReply = {ok: true};
        let opened = 0;
        const lock = await acquireDesktopLock({stateRoot: root, report: () => undefined, onOpenWindow: () => {
            if (reply.ok) opened += 1;
            return reply;
        }});
        if (!server.ok || !lock.ok) throw new Error("服务端认领与桌面锁都应成功");

        expect(await askRunningShell(root)).toEqual({kind: "handed-off"});
        expect(opened).toBe(1);
        reply = {ok: false, code: "closing"};
        expect(await askRunningShell(root)).toEqual({kind: "closing"});
        reply = {ok: false, code: "stopping"};
        expect(await askRunningShell(root)).toEqual({kind: "stopping"});
        expect(opened).toBe(1);

        lock.claim.stopping();
        expect(await askRunningShell(root)).toEqual({kind: "stopping"});
        await lock.claim.release();
        expect(await askRunningShell(root)).toEqual({kind: "lock-free"});
        await server.claim.release();
    });

    it("版本不同：不发开窗请求；已经放下的锁：回去取锁", async () => {
        const root = nextRoot();
        let opened = 0;
        const lock = await acquireDesktopLock({stateRoot: root, version: "0.0.1", report: () => undefined, onOpenWindow: () => {
            opened += 1;
            return {ok: true};
        }});
        if (!lock.ok) throw new Error(lock.reason);
        expect(await askRunningShell(root)).toEqual({kind: "version-mismatch", running: "0.0.1"});
        expect(opened).toBe(0);
        expect(PRODUCT_VERSION).not.toBe("0.0.1");
        await lock.claim.release();
        expect(await askRunningShell(root)).toEqual({kind: "lock-free"});
    });

    it("锁已被持有时再取：报 running，带持有者的 pid 与版本", async () => {
        const root = nextRoot();
        const first = await acquireDesktopLock({stateRoot: root, report: () => undefined, onOpenWindow: () => ({ok: true})});
        if (!first.ok) throw new Error(first.reason);
        const second = await acquireDesktopLock({stateRoot: root, report: () => undefined, onOpenWindow: () => ({ok: true})});
        expect(second).toMatchObject({ok: false, reason: "running", instance: {pid: process.pid, version: PRODUCT_VERSION, status: "starting"}});
        await first.claim.release();
    });
});
