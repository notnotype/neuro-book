/**
 * Lab 的内存文件适配器与真实 Files 实现对契约（docs/testing/README.md：替身要与真实实现对过契约）：同一组目录与清单，
 * 同一串资源管理器会做的操作，真实内核（`filesScene`，真实磁盘）与内存适配器给出相同的列出结果、单项结果与逐项结果，
 * 变化里都有对应路径的事件。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import type {FileChange, FilesResult, FilesService} from "nbook/plugins/files/shared/contracts";
import {files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Scene} from "nbook/plugins/files/testing/scene";

import {createMemoryFiles} from "./web/fixtures/explorer-scene/memory-files";
import type {MemoryFiles} from "./web/fixtures/explorer-scene/memory-files";

let tmp = "";
const scenes: Scene[] = [];
const memories: MemoryFiles[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-lab", "memory-files");
});

afterEach(async () => {
    for (const memory of memories.splice(0)) memory.dispose();
    for (const scene of scenes.splice(0)) {
        await scene.world.close();
        await rm(scene.root, {recursive: true, force: true});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="alice" title="爱丽丝"/>
  <item name="bob"/>
  <item name="gone" title="已删除"/>
</content>
`;

interface Side {
    readonly files: FilesService;
    /** 等到某条变化到达（真实一端要推进变化的合并时钟）。 */
    readonly settle: (check: () => boolean) => Promise<unknown>;
}

async function sides(): Promise<{readonly real: Side; readonly memory: Side}> {
    const scene = await filesScene(join(tmp, `scene-${String(scenes.length + 1)}`), {project: {
        "lore.content/content.xml": MANIFEST,
        "lore.content/alice/notes.md": "A",
        "lore.content/bob/index.md": "B",
        "lore.content/stray.md": "S",
        "plain/a.md": "PA",
        "plain/sub/x.md": "X",
    }});
    scenes.push(scene);
    const memory = createMemoryFiles({
        project: [["lore.content/content.xml", MANIFEST], ["lore.content/alice/notes.md", "A"], ["lore.content/bob/index.md", "B"], ["lore.content/stray.md", "S"], ["plain/a.md", "PA"], ["plain/sub/x.md", "X"]],
        user: [],
        manifests: {"project://lore.content": [{name: "alice", title: "爱丽丝"}, {name: "bob"}, {name: "gone", title: "已删除"}]},
    });
    memories.push(memory);
    return {
        real: {files: files(scene.window), settle: (check) => waitUntil("真实一端的变化", () => {
            scene.world.clock.advance(BATCH_DELAY_MS);
            return check();
        })},
        memory: {files: memory.files, settle: (check) => waitUntil("内存一端的变化", check)},
    };
}

/** 两端做同一件事，结果去掉令牌与失败说明后应相同。 */
async function both<T>(pair: {readonly real: Side; readonly memory: Side}, run: (files: FilesService) => Promise<T>): Promise<T> {
    const real = await run(pair.real.files);
    const memory = await run(pair.memory.files);
    expect(normalize(memory)).toEqual(normalize(real));
    return real;
}

function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value !== "object" || value === null) return value;
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        // 失败说明与令牌各端各写各的；码与形状要一样。`cause` 只在路由层失败时出现。
        if (key === "detail" || key === "token" || key === "cause") continue;
        result[key] = normalize(entry);
    }
    return result;
}

const LISTED = ["project://", "project://plain", "project://lore.content", "project://lore.content/bob", "project://lore.content/alice"];

async function sameListings(pair: {readonly real: Side; readonly memory: Side}): Promise<void> {
    for (const address of LISTED) await both(pair, (files) => files.list(address));
}

async function tokenOf(files: FilesService, address: string): Promise<string> {
    const identified = await files.identify([address]);
    if (!identified.ok) throw new Error(identified.detail);
    const item = identified.value.items[0];
    if (item === undefined || "code" in item) throw new Error(`${address} 拿不到令牌`);
    return item.token;
}

const ok = <T>(result: FilesResult<T>): T => {
    if (!result.ok) throw new Error(`${result.code}：${result.detail}`);
    return result.value;
};

describe("Lab 内存文件适配器：与真实 Files 同形", () => {
    it("列出：普通目录、内容根（清单顺序、展示名、缺失、未列入、清单文件）、节点层（正文）", async () => {
        const pair = await sides();
        await sameListings(pair);
        await both(pair, (files) => files.list("project://plain/nope"));
        await both(pair, (files) => files.list("project://plain/a.md"));
    });

    it("单项操作：新建（插在某项之前）、创建内容、改名、展示名、加入与移出清单、调整顺序、转换来回", async () => {
        const pair = await sides();
        await both(pair, (files) => files.create("project://lore.content/carol", "directory", {before: "bob"}));
        await both(pair, (files) => files.create("project://lore.content/carol", "directory"));
        await both(pair, (files) => files.createContent("project://lore.content/carol"));
        await both(pair, (files) => files.createContent("project://lore.content/bob"));
        await both(pair, async (files) => files.rename("project://lore.content/alice", "alicia", {expected: await tokenOf(files, "project://lore.content/alice")}));
        await both(pair, (files) => files.display("project://lore.content/alicia", {title: "艾丽西亚", icon: "person"}));
        await both(pair, (files) => files.include("project://lore.content/stray.md"));
        await both(pair, (files) => files.drop("project://lore.content/gone"));
        await both(pair, (files) => files.reorder("project://lore.content", ["stray.md", "bob", "carol", "alicia"]));
        await both(pair, (files) => files.reorder("project://lore.content", ["bob"]));
        await sameListings(pair);
        await both(pair, async (files) => files.convert("project://plain/sub", "content", {expected: await tokenOf(files, "project://plain/sub")}));
        await both(pair, (files) => files.list("project://plain/sub.content"));
        await both(pair, async (files) => files.convert("project://plain/sub.content", "plain", {expected: await tokenOf(files, "project://plain/sub.content")}));
        await sameListings(pair);
    });

    it("批量：移动进内容文件夹、复制、删除的逐项结果（完成、冲突、源已换、自身后代），之后的列出相同", async () => {
        const pair = await sides();
        await both(pair, async (files) => ok(await files.move([{source: "project://plain/a.md", target: "project://lore.content/a.md", expected: await tokenOf(files, "project://plain/a.md")}]).result));
        await both(pair, async (files) => {
            const stale = await tokenOf(files, "project://lore.content/stray.md");
            // 同一路径换成新的资源（改名再改回不换身份）。
            ok(await files.delete([{address: "project://lore.content/stray.md"}]).result);
            ok(await files.create("project://lore.content/stray.md", "file"));
            return ok(await files.copy([
                {source: "project://plain/sub", target: "project://plain/sub/inner"},
                {source: "project://lore.content/bob", target: "project://plain/bob"},
                {source: "project://lore.content/a.md", target: "project://plain/sub/x.md"},
                {source: "project://lore.content/stray.md", target: "project://plain/stray.md", expected: stale},
            ]).result);
        });
        await both(pair, (files) => files.list("project://plain/bob"));
        await both(pair, async (files) => ok(await files.delete([{address: "project://plain/bob", expected: await tokenOf(files, "project://plain/bob")}, {address: "project://plain/nope"}]).result));
        await sameListings(pair);
    });

    it("正文：读到正文与基线；按基线保存，旧基线为冲突并带当前基线；保存换掉目录项身份并回报前后令牌；读目录与不存在的文件失败", async () => {
        const pair = await sides();
        await both(pair, (files) => files.read("project://plain/a.md"));
        await both(pair, (files) => files.read("project://plain"));
        await both(pair, (files) => files.read("project://plain/nope.md"));
        for (const side of [pair.real, pair.memory]) {
            const read = ok(await side.files.read("project://plain/a.md"));
            const before = await tokenOf(side.files, "project://plain/a.md");
            const saved = ok(await side.files.write("project://plain/a.md", "PA2", read.baseline));
            expect(saved.identity).toEqual({before, after: await tokenOf(side.files, "project://plain/a.md")});
            expect(saved.identity?.after).not.toBe(before);
            expect(ok(await side.files.read("project://plain/a.md"))).toEqual({text: "PA2", baseline: saved.baseline});
        }
        await both(pair, (files) => files.write("project://plain/a.md", "旧基线", {hash: "0".repeat(64)}));
        await both(pair, (files) => files.write("project://plain/nope.md", "N", {hash: "0".repeat(64)}));
    });

    it("变化：订阅先 ready，经文件服务的新建与改名推出对应路径的事件", async () => {
        const pair = await sides();
        for (const side of [pair.real, pair.memory]) {
            const seen: Array<FileChange | "ready"> = [];
            const release = side.files.watch("project", (message) => {
                if (message.kind === "ready") seen.push("ready");
                if (message.kind === "batch") seen.push(...message.events);
            });
            await side.settle(() => seen.includes("ready"));
            ok(await side.files.create("project://plain/new.md", "file"));
            ok(await side.files.rename("project://plain/a.md", "b.md"));
            await side.settle(() => seen.some((event) => event !== "ready" && event.type === "renamed"));
            expect(seen.filter((event) => event !== "ready").map((event) => (event as FileChange).type === "renamed" ? ["renamed", (event as FileChange).path, (event as Extract<FileChange, {type: "renamed"}>).from] : [(event as FileChange).type, (event as FileChange).path])).toEqual(expect.arrayContaining([
                [expect.stringMatching(/^(created|changed)$/u), "plain/new.md"],
                ["renamed", "plain/b.md", "plain/a.md"],
            ]));
            release();
        }
    });
});
