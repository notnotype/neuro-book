/**
 * `useWorldReads`（use-reads.ts）接在进程内的真实世界上：按键各一个读取，世界变了只重读还在的键；键没了它的读取就释放，
 * 之后的发布不再为它读。读取次数用计数包装的真实客户端数。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {defineComponent, h, shallowRef} from "vue";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {countedClient} from "../testing/counted-client";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWorld} from "../testing/node-world";
import {person, publish} from "../testing/world-fixtures";
import {useWorldReads} from "./use-reads";
import {createCanonWorld} from "./world";

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "use-reads");
    await mkdir(join(tmp, "Book", "manuscripts.binder"), {recursive: true});
    await writeFile(join(tmp, "Book", "manuscripts.binder", "binder.xml"), '<binder nextId="2"><chapter id="1"/></binder>');
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
});

describe("useWorldReads", () => {
    it("按键读；世界变了只重读还在的键，键没了不再读", async () => {
        venue = await canonNodeWorld(tmp);
        const mine = await venue.window("mine");
        const other = await venue.window("other");
        const a = person("甲");
        const b = person("乙");
        const ids = await publish(other.canon, [a, b]);
        const counted = countedClient(mine.canon);
        const world = createCanonWorld(counted.client);
        cleanups.push(() => world.dispose());

        const keys = shallowRef<string[]>([ids[a.id]!, ids[b.id]!]);
        let names: string[] = [];
        const wrapper = mount(defineComponent({
            setup() {
                const reads = useWorldReads(world, "entry", () => new Map(keys.value.map((id) => [id, {id, position: {kind: "initial" as const}, mode: "actual" as const}])));
                return () => {
                    names = keys.value.map((id) => reads.value.get(id)?.data?.view?.name ?? "");
                    return h("p", names.join(","));
                };
            },
        }));
        cleanups.push(() => wrapper.unmount());
        await waitUntil("两个都读到", () => wrapper.text() === "甲,乙");

        const entryReads = (from: number): number => counted.calls.slice(from).filter((call) => call.method === "entry").length;
        let before = counted.calls.length;
        await publish(other.canon, [person("丙")]);
        await waitUntil("两个都重读了", () => entryReads(before) === 2);

        keys.value = [ids[a.id]!];
        await waitUntil("只剩甲", () => wrapper.text() === "甲");
        before = counted.calls.length;
        await publish(other.canon, [person("丁")]);
        // 读取层一轮重读以后才知道没有别的要读：等状态读完，再看这一轮里 entry 只读了一次。
        await waitUntil("重读了甲", () => entryReads(before) >= 1 && counted.calls.slice(before).some((call) => call.method === "status"));
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(entryReads(before)).toBe(1);

        keys.value = [];
        await waitUntil("都没了", () => wrapper.text() === "");
        before = counted.calls.length;
        await publish(other.canon, [person("戊")]);
        await waitUntil("状态重读了", () => counted.calls.slice(before).some((call) => call.method === "status"));
        expect(entryReads(before)).toBe(0);
    });
});
