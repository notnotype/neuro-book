/**
 * Lab 内存层与真实层拥有者的对照（docs/specs/settings/configuration.md 输出 5、10、24）：组件测试与 Lab 用内存层代替
 * 服务端里的拥有者，这里把同样的输入同时交给两者（拥有者读写真实的临时文件），比对调用方看得到的结果——层的值、被丢弃
 * 的键、文件在不在、只改注释时发不发布层快照。修订号两边算法不同（内存层是不透明的记号），只比“变没变”。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {Type} from "typebox";

import {createLayerOwner} from "nbook/plugins/settings/backend/layer-owner";
import type {LayerOwner} from "nbook/plugins/settings/backend/layer-owner";
import type {DeclaredSetting, LayerSnapshot} from "nbook/plugins/settings/shared/layers";
import {defineSetting} from "nbook/shared/settings";

import {memoryConnection, memoryLayer} from "./memory-layers";
import type {MemoryLayer} from "./memory-layers";

const title = {"zh-CN": "项", "en-US": "Item"};
const theme = defineSetting({plugin: "x.ui", name: "theme", schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]), default: "nbook", title});
const size = defineSetting({plugin: "x.ui", name: "size", schema: Type.Number(), default: 12, title});
const declarations = new Map<string, DeclaredSetting>([theme, size].map((setting) => [setting.key, {plugin: "x.ui", declaration: setting.declaration}]));
const self: ConsumerIdentity = {instanceId: "test", location: "browser", client: "c", plugin: "nbook.settings", entry: "browser", generation: 1, via: null};

let tmp = "";
let sequence = 0;
const owners: LayerOwner[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-settings", "memory-contract");
});

afterEach(async () => {
    await Promise.all(owners.splice(0).map((owner) => owner.close()));
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Pair {
    readonly owner: LayerOwner;
    readonly memory: MemoryLayer;
    /** 内存层发布过的快照。 */
    readonly memorySnapshots: LayerSnapshot[];
}

/** 一份文件文本同时交给两边：拥有者读真实文件，内存层拿初始文本。 */
async function pair(text: string): Promise<Pair> {
    sequence += 1;
    const path = join(tmp, `case-${String(sequence)}.json`);
    await writeFile(path, text);
    const owner = createLayerOwner({path, layer: "user", declarations: () => declarations, clock: new ManualClock(), diagnostics: createDiagnosticsStore({identity: {location: "server", instanceId: `memory-${String(sequence)}`}}), source: "nbook.settings"});
    owners.push(owner);
    await owner.ready;
    const memory = memoryLayer({layer: "user", declarations, connection: memoryConnection(), text});
    const memorySnapshots: LayerSnapshot[] = [];
    await memory.link.subscribe((snapshot) => memorySnapshots.push(snapshot), () => undefined);
    return {owner, memory, memorySnapshots};
}

const visible = (snapshot: LayerSnapshot) => ({status: snapshot.status, values: snapshot.values, problems: snapshot.problems});

describe("Lab 内存层与真实拥有者", () => {
    it("初始文本：值与被丢弃的键都从文本解析，与拥有者读文件一致", async () => {
        const {owner, memorySnapshots} = await pair("// 注释\n{\"x.ui/theme\": \"macos\", \"x.ui/size\": \"大\", \"other/kept\": 1}");
        expect(visible(memorySnapshots.at(-1)!)).toEqual(visible(owner.snapshot()));
        expect(owner.snapshot().problems).toEqual([{key: "x.ui/size", reason: "invalid-value"}]);
    });

    it("存在的空文件：两边都是 exists", async () => {
        const {owner, memory} = await pair("");
        expect(await owner.readText(self)).toMatchObject({ok: true, exists: true, text: ""});
        expect(await memory.file.read()).toMatchObject({ok: true, exists: true, text: ""});
    });

    it("整份写：被丢弃的键一样报出；只改注释时两边都不发布新的层快照，修订号都变", async () => {
        const {owner, memory, memorySnapshots} = await pair("{\"x.ui/theme\": \"nbook\"}");
        const ownerRead = await owner.readText(self);
        const memoryRead = await memory.file.read();
        if (!ownerRead.ok || !memoryRead.ok) throw new Error("应能读出");
        const next = "{\"x.ui/theme\": \"macos\", \"x.ui/size\": \"大\"}";
        const ownerWritten = await owner.writeText(self, next, ownerRead.revision);
        const memoryWritten = await memory.file.write(next, memoryRead.revision);
        if (!ownerWritten.ok || !memoryWritten.ok) throw new Error("应能写入");
        expect(visible(memoryWritten.snapshot)).toEqual(visible(ownerWritten.snapshot));

        const ownerSeq = owner.snapshot().revision.seq;
        const memoryCount = memorySnapshots.length;
        const commented = `// 只加注释\n${next}`;
        const ownerAgain = await owner.writeText(self, commented, ownerWritten.revision);
        const memoryAgain = await memory.file.write(commented, memoryWritten.revision);
        if (!ownerAgain.ok || !memoryAgain.ok) throw new Error("应能写入");
        expect(ownerAgain.revision).not.toBe(ownerWritten.revision);
        expect(memoryAgain.revision).not.toBe(memoryWritten.revision);
        expect(owner.snapshot().revision.seq).toBe(ownerSeq);
        expect(memorySnapshots.length).toBe(memoryCount);
    });
});
