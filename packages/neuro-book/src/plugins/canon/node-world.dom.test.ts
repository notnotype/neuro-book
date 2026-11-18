/**
 * 进程内的世界场地（testing/node-world.ts）在 Vitest 里走得通，并且与项目子进程的场地观察到同样的合同
 * （testing/venue-scenario.ts；子进程那边在 canon.test.ts）。界面的组件测试建在它上面。
 */

import {rm} from "node:fs/promises";

import {afterEach, beforeEach, describe, expect, it} from "vitest";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {CanonEvent} from "./shared/contracts";
import {canonNodeWorld} from "./testing/node-world";
import type {CanonNodeWorld} from "./testing/node-world";
import {venueScenario} from "./testing/venue-scenario";

let tmp: string;
let world: CanonNodeWorld | null = null;

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "node-world");
});

afterEach(async () => {
    await world?.close();
    world = null;
    await rm(tmp, {recursive: true, force: true});
});

describe("进程内的世界场地", () => {
    it("订阅、独占与断开后的失败码同项目子进程的场地", async () => {
        world = await canonNodeWorld(tmp);
        expect(await venueScenario(world)).toEqual({changedMatchesPublish: true, writeWhileHeld: "busy", writeAfterHolderGone: true, callAfterDisconnect: "unavailable"});
    });

    it("项目实例停止时，窗口的订阅收到 ended", async () => {
        world = await canonNodeWorld(tmp);
        const window = await world.window("w1");
        const seen: CanonEvent[] = [];
        expect((await window.canon.subscribe((event) => seen.push(event))).ok).toBe(true);
        await world.endProject();
        await waitUntil("订阅收到 ended", () => seen.some((event) => event.kind === "ended"), {timeoutMs: 10_000});
        expect((await window.canon.call("status", {})).ok).toBe(false);
        await window.close();
    });
});
