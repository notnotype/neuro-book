/**
 * 单项文件操作与清单维护（docs/specs/workspace/files.md 的“文件操作”，验收 2、8；folder-kinds.md 的“经文件服务的操作
 * 同步清单”“清单编辑”“操作锁”“转换”，验收 3、5、7、8、9；resources.md 的变更事件，验收 5）：真实内核实例、真实目录、
 * 真实递归 `fs.watch`，经窗口里的文件客户端调用。一批的合并用场地的手动时钟推进。
 *
 * “没有某个事件”用屏障判定：之后再做一次外部修改，等它的事件到达；inotify 按发生顺序投递，屏障到了，之前的事件也已
 * 处理完。权限用例要求以普通用户运行，root 时跳过。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {holdLock} from "nbook/backend/locked-replace";

import {BATCH_DELAY_MS} from "./backend/changes";
import {OPERATIONS_LOCK} from "./backend/rooted";
import type {FileChange, FilesService, WatchMessage} from "./shared/contracts";
import {extraWindow, files, filesScene} from "./testing/scene";
import type {Layout, Scene} from "./testing/scene";

const privileged = process.getuid?.() === 0;

let tmp = "";
let counter = 0;
const scenes: Scene[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "operations");
});

afterEach(async () => {
    const results = [];
    for (const created of scenes.splice(0)) {
        results.push(...(await created.world.close()));
        await chmod(join(created.project, "lore.content", "content.xml"), 0o644).catch(() => undefined);
        await rm(created.root, {recursive: true, force: true});
    }
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <!-- 人物 -->
  <item name="alice" title="爱丽丝" icon="person"/>
  <item name="bob" title="鲍勃">
    <item name="sword" title="宝剑"/>
  </item>
  <item name="gone" title="已删除"/>
</content>
`;

/** 内容文件夹 `lore.content`：两个节点（`bob` 有正文与嵌套条目）、一个未列入项、一个缺失条目；另有普通文件夹。 */
const LAYOUT: Layout = {
    "lore.content/content.xml": MANIFEST,
    "lore.content/alice/notes.md": "A",
    "lore.content/bob/index.md": "BOB",
    "lore.content/bob/sword/index.md": "SWORD",
    "lore.content/stray.md": "S",
    "plain/a.md": "PA",
};

async function scene(project: Layout = LAYOUT): Promise<Scene> {
    counter += 1;
    const created = await filesScene(join(tmp, `world-${String(counter)}`), {project});
    scenes.push(created);
    return created;
}

const manifest = (created: Scene): Promise<string> => readFile(join(created.project, "lore.content", "content.xml"), "utf8");
const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);

interface Watching {
    readonly messages: WatchMessage[];
}

async function watching(client: FilesService): Promise<Watching> {
    const messages: WatchMessage[] = [];
    client.watch("project", (message) => messages.push(message));
    await waitUntil("订阅就绪", () => messages.some((message) => message.kind === "ready"));
    return {messages};
}

const changes = (watched: Watching): FileChange[] => watched.messages.flatMap((message) => (message.kind === "batch" ? message.events : []));

/** 屏障：外部写一个文件，推进手动时钟直到它的外部事件到达；之后返回屏障之前的全部事件。 */
async function untilBarrier(created: Scene, watched: Watching, name = "barrier.md"): Promise<FileChange[]> {
    await writeFile(join(created.project, name), name);
    await waitUntil(`屏障 ${name} 的事件`, () => {
        created.world.clock.advance(BATCH_DELAY_MS);
        return changes(watched).some((change) => change.path === name && change.source.kind === "external");
    });
    return changes(watched).filter((change) => change.path !== name);
}

const user = {kind: "user", plugin: "x.explorer"} as const;

describe("Spec workspace.files 文件操作：新建与创建内容", () => {
    it("普通文件夹里新建空文件与目录；已有为 conflict 且原字节不变；只有带来源的精确事件", async () => {
        const created = await scene();
        const client = files(created.window);
        const watched = await watching(client);
        expect(await client.create("project://plain/new.md", "file")).toEqual({ok: true, value: {}});
        expect(await client.create("project://plain/folder", "directory")).toEqual({ok: true, value: {}});
        expect(await readFile(join(created.project, "plain", "new.md"), "utf8")).toBe("");
        expect((await lstat(join(created.project, "plain", "folder"))).isDirectory()).toBe(true);
        expect(await client.create("project://plain/a.md", "file")).toMatchObject({ok: false, code: "conflict"});
        expect(await readFile(join(created.project, "plain", "a.md"), "utf8")).toBe("PA");
        expect(await client.create("project://missing/new.md", "file")).toMatchObject({ok: false, code: "not-found"});
        expect(await client.create("project://.nbook/x.md", "file")).toMatchObject({ok: false, code: "protected-path"});
        expect(await untilBarrier(created, watched)).toEqual([
            {type: "created", path: "plain/new.md", source: user},
            {type: "created", path: "plain/folder", source: user},
        ]);
        expect(await manifest(created)).toBe(MANIFEST);
    });

    it("内容文件夹里新建：清单按 before 插入条目，注释与其它条目保留；清单的修改也是带来源的事件", async () => {
        const created = await scene();
        const client = files(created.window);
        const watched = await watching(client);
        expect(await client.create("project://lore.content/carol", "directory", {before: "bob"})).toEqual({ok: true, value: {}});
        expect(await client.create("project://lore.content/bob/shield.md", "file")).toEqual({ok: true, value: {}});
        // 节点的正文不进清单。
        expect(await client.create("project://lore.content/alice/index.md", "file")).toEqual({ok: true, value: {}});
        expect(await manifest(created)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<content>
  <!-- 人物 -->
  <item name="alice" title="爱丽丝" icon="person"/>
  <item name="carol"/>
  <item name="bob" title="鲍勃">
    <item name="sword" title="宝剑"/>
    <item name="shield.md"/>
  </item>
  <item name="gone" title="已删除"/>
</content>
`);
        const listed = await client.list("project://lore.content");
        expect(listed.ok && listed.value.entries.map((entry) => entry.name)).toEqual(["alice", "carol", "bob", "gone", "content.xml", "stray.md"]);
        expect(await untilBarrier(created, watched)).toEqual([
            {type: "created", path: "lore.content/carol", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
            {type: "created", path: "lore.content/bob/shield.md", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
            {type: "created", path: "lore.content/alice/index.md", source: user},
        ]);
    });

    it("两个窗口同时新建同名文件：恰好一个成功，另一个 conflict", async () => {
        const created = await scene();
        const other = await extraWindow(created, "w2");
        const results = await Promise.all([files(created.window).create("project://lore.content/race.md", "file"), files(other).create("project://lore.content/race.md", "file")]);
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok)).toEqual([expect.objectContaining({ok: false, code: "conflict"})]);
        expect((await manifest(created)).match(/name="race\.md"/g)).toHaveLength(1);
    });

    it("创建内容：节点目录里排他新建空白 index.md，已有为 conflict；普通文件夹与内容根本身不支持", async () => {
        const created = await scene();
        const client = files(created.window);
        expect(await client.createContent("project://lore.content/alice")).toEqual({ok: true, value: {}});
        expect(await readFile(join(created.project, "lore.content", "alice", "index.md"), "utf8")).toBe("");
        expect(await client.createContent("project://lore.content/bob")).toMatchObject({ok: false, code: "conflict"});
        expect(await readFile(join(created.project, "lore.content", "bob", "index.md"), "utf8")).toBe("BOB");
        expect(await client.createContent("project://plain")).toMatchObject({ok: false, code: "unsupported"});
        expect(await client.createContent("project://lore.content")).toMatchObject({ok: false, code: "unsupported"});
        expect(await exists(join(created.project, "plain", "index.md"))).toBe(false);
        expect(await exists(join(created.project, "lore.content", "index.md"))).toBe(false);
        expect(await manifest(created)).toBe(MANIFEST);
    });
});

describe("Spec workspace.files 文件操作：改名与源身份", () => {
    it("内容树里改名：清单条目改名、展示名与子条目保留；事件是带新旧地址的 renamed，目录后代没有外部回声", async () => {
        const created = await scene();
        const client = files(created.window);
        const watched = await watching(client);
        expect(await client.rename("project://lore.content/bob", "robert")).toEqual({ok: true, value: {}});
        expect(await readFile(join(created.project, "lore.content", "robert", "sword", "index.md"), "utf8")).toBe("SWORD");
        expect(await manifest(created)).toContain(`<item name="robert" title="鲍勃">\n    <item name="sword" title="宝剑"/>`);
        expect(await untilBarrier(created, watched)).toEqual([
            {type: "renamed", path: "lore.content/robert", from: "lore.content/bob", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
        ]);
    });

    it("目标已存在为 conflict，两边不变；名字不是单段为 invalid-address", async () => {
        const created = await scene();
        const client = files(created.window);
        expect(await client.rename("project://lore.content/alice", "bob")).toMatchObject({ok: false, code: "conflict"});
        expect(await client.rename("project://plain/a.md", "x/y.md")).toMatchObject({ok: false, code: "invalid-address"});
        expect(await client.rename("project://plain/a.md", "..")).toMatchObject({ok: false, code: "invalid-address"});
        expect(await readdir(join(created.project, "lore.content", "alice"))).toEqual(["notes.md"]);
        expect(await manifest(created)).toBe(MANIFEST);
    });

    it("冻结的令牌：同路径被换成同字节的文件后改名为 source-changed，换上的文件不动", async () => {
        const created = await scene();
        const client = files(created.window);
        const identified = await client.identify(["project://plain/a.md", "project://plain/none.md"]);
        expect(identified).toMatchObject({ok: true, value: {items: [{kind: "file"}, {code: "not-found"}]}});
        const token = identified.ok ? (identified.value.items[0] as {readonly token: string}).token : "";
        await rename(join(created.project, "plain", "a.md"), join(created.project, "plain", "kept.md"));
        await writeFile(join(created.project, "plain", "a.md"), "PA");
        expect(await client.rename("project://plain/a.md", "b.md", {expected: token})).toMatchObject({ok: false, code: "source-changed"});
        expect((await readdir(join(created.project, "plain"))).sort()).toEqual(["a.md", "kept.md"]);
        const fresh = await client.identify(["project://plain/a.md"]);
        const current = fresh.ok ? (fresh.value.items[0] as {readonly token: string}).token : "";
        expect(current).not.toBe(token);
        expect(await client.rename("project://plain/a.md", "b.md", {expected: current})).toEqual({ok: true, value: {}});
    });

    it("身份查询的地址必须同一方案", async () => {
        const created = await scene();
        expect(await files(created.window).identify(["project://plain/a.md", "user://x.md"])).toMatchObject({ok: false, code: "invalid-address"});
    });
});

describe("Spec workspace.folder-kinds 转换", () => {
    it("普通→内容按子项生成清单（目录在前）；→普通清单留作普通文件；再转回内容原样保留清单；父清单里的条目随之改名", async () => {
        const created = await scene({...LAYOUT, "lore.content/places/town.md": "T", "lore.content/places/inn/index.md": "I"});
        const client = files(created.window);
        expect(await client.include("project://lore.content/places")).toEqual({ok: true, value: {}});
        expect(await client.convert("project://lore.content/places", "content")).toEqual({ok: true, value: {}});
        const generated = await readFile(join(created.project, "lore.content", "places.content", "content.xml"), "utf8");
        expect(generated).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<content>\n  <item name="inn"/>\n  <item name="town.md"/>\n</content>\n`);
        expect(await manifest(created)).toContain(`<item name="places.content"/>`);

        await writeFile(join(created.project, "lore.content", "places.content", "content.xml"), "<content><!-- 手写 --></content>");
        expect(await client.convert("project://lore.content/places.content", "plain")).toEqual({ok: true, value: {}});
        expect(await readFile(join(created.project, "lore.content", "places", "content.xml"), "utf8")).toBe("<content><!-- 手写 --></content>");
        expect(await client.convert("project://lore.content/places", "content")).toEqual({ok: true, value: {}});
        expect(await readFile(join(created.project, "lore.content", "places.content", "content.xml"), "utf8")).toBe("<content><!-- 手写 --></content>");
        expect(await manifest(created)).toContain(`<item name="places.content"/>`);
    });

    it("已有不合法的 content.xml：转换照常完成，清单不被覆盖；已经是这一类为 unsupported", async () => {
        const created = await scene({"draft/content.xml": "<broken", "draft/a.md": "A"});
        const client = files(created.window);
        expect(await client.convert("project://draft", "content")).toEqual({ok: true, value: {}});
        expect(await readFile(join(created.project, "draft.content", "content.xml"), "utf8")).toBe("<broken");
        expect(await client.convert("project://draft.content", "content")).toMatchObject({ok: false, code: "unsupported"});
    });
});

describe("Spec workspace.folder-kinds 清单编辑", () => {
    it("调整顺序与展示名只改清单；名字不对为 invalid-order；普通文件夹不支持", async () => {
        const created = await scene();
        const client = files(created.window);
        expect(await client.reorder("project://lore.content", ["gone", "bob", "alice"])).toEqual({ok: true, value: {}});
        expect(await client.display("project://lore.content/alice", {title: "艾丽斯", icon: null})).toEqual({ok: true, value: {}});
        expect(await client.display("project://lore.content/bob/sword", {icon: "blade"})).toEqual({ok: true, value: {}});
        expect(await manifest(created)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<content>
  <!-- 人物 -->
  <item name="gone" title="已删除"/>
  <item name="bob" title="鲍勃">
    <item name="sword" title="宝剑" icon="blade"/>
  </item>
  <item name="alice" title="艾丽斯"/>
</content>
`);
        expect(await client.reorder("project://lore.content", ["bob", "alice"])).toMatchObject({ok: false, code: "invalid-order"});
        expect(await client.reorder("project://lore.content", ["bob", "alice", "stray.md"])).toMatchObject({ok: false, code: "invalid-order"});
        expect(await client.display("project://lore.content/stray.md", {title: "x"})).toMatchObject({ok: false, code: "invalid-order"});
        expect(await client.reorder("project://plain", ["a.md"])).toMatchObject({ok: false, code: "unsupported"});
        expect(await readFile(join(created.project, "lore.content", "bob", "index.md"), "utf8")).toBe("BOB");
    });

    it("把未列入项加入清单、移除缺失条目，磁盘不变；已在清单里的再加入为 invalid-order", async () => {
        const created = await scene();
        const client = files(created.window);
        expect(await client.include("project://lore.content/stray.md", {before: "alice"})).toEqual({ok: true, value: {}});
        expect(await client.include("project://lore.content/stray.md")).toMatchObject({ok: false, code: "invalid-order"});
        expect(await client.drop("project://lore.content/gone")).toEqual({ok: true, value: {}});
        expect(await client.drop("project://lore.content/gone")).toMatchObject({ok: false, code: "invalid-order"});
        expect(await client.include("project://lore.content/content.xml")).toMatchObject({ok: false, code: "invalid-order"});
        const listed = await client.list("project://lore.content");
        expect(listed.ok && listed.value.entries.map((entry) => [entry.name, entry.listed])).toEqual([["stray.md", true], ["alice", true], ["bob", true], ["content.xml", false]]);
        expect((await readdir(join(created.project, "lore.content"))).sort()).toEqual(["alice", "bob", "content.xml", "stray.md"]);
    });
});

describe("Spec workspace.folder-kinds 清单失败与操作锁", () => {
    it.skipIf(privileged)("清单只读：文件照常新建，清单字节不变，结果指明这份清单；不发出清单的变更事件", async () => {
        const created = await scene();
        // 先改权限再订阅：改权限本身是一次外部变化。
        await chmod(join(created.project, "lore.content", "content.xml"), 0o444);
        const client = files(created.window);
        const watched = await watching(client);
        const result = await client.create("project://lore.content/new.md", "file");
        expect(result).toMatchObject({ok: true, value: {manifests: [{path: "lore.content/content.xml", status: "failed"}]}});
        expect(await exists(join(created.project, "lore.content", "new.md"))).toBe(true);
        expect(await manifest(created)).toBe(MANIFEST);
        expect(await untilBarrier(created, watched)).toEqual([{type: "created", path: "lore.content/new.md", source: user}]);
    });

    it("清单不合法：改名照常完成，清单不改，结果为 invalid；只改清单的操作直接失败", async () => {
        const created = await scene({...LAYOUT, "lore.content/content.xml": "<content><item/></content>"});
        const client = files(created.window);
        expect(await client.rename("project://lore.content/alice", "alicia")).toMatchObject({ok: true, value: {manifests: [{path: "lore.content/content.xml", status: "invalid"}]}});
        expect(await exists(join(created.project, "lore.content", "alicia"))).toBe(true);
        expect(await manifest(created)).toBe("<content><item/></content>");
        expect(await client.reorder("project://lore.content", ["alice"])).toMatchObject({ok: false, code: "unsupported"});
    });

    it("内容树的操作锁被别的进程占着：操作等不到返回 busy，磁盘与清单都不变", async () => {
        const created = await scene();
        await mkdir(join(created.project, ".nbook", "locks", "files"), {recursive: true});
        const held = await holdLock(join(created.project, ".nbook", "locks", "files", OPERATIONS_LOCK), () => undefined);
        if (!held.ok) throw new Error(held.detail);
        try {
            expect(await files(created.window).rename("project://lore.content/alice", "alicia")).toMatchObject({ok: false, code: "busy"});
            expect(await exists(join(created.project, "lore.content", "alice"))).toBe(true);
            expect(await manifest(created)).toBe(MANIFEST);
            // 普通文件夹里的操作不取锁。
            expect(await files(created.window).rename("project://plain/a.md", "b.md")).toEqual({ok: true, value: {}});
        } finally {
            await held.lock.release();
        }
    });
});

describe("Spec workspace.folder-kinds 清单失败的失败码与交错改名", () => {
    it("只改清单的操作等不到清单的写入锁：报 io-failed（不是权限），原因进诊断", async () => {
        const created = await scene();
        const locks = join(created.project, ".nbook", "locks", "files");
        await mkdir(locks, {recursive: true});
        const held = await holdLock(join(locks, `${createHash("sha256").update("lore.content/content.xml").digest("hex")}.lock`), () => undefined);
        if (!held.ok) throw new Error(held.detail);
        try {
            expect(await files(created.window).display("project://lore.content/alice", {title: "x"})).toMatchObject({ok: false, code: "io-failed"});
        } finally {
            await held.lock.release();
        }
        expect(created.world.diagnostics("project:P#1").query({}).records.some((record) => record.event === "files.manifest.write-failed")).toBe(true);
        expect(await manifest(created)).toBe(MANIFEST);
    }, 15_000);

    it("窗口 A 改名 alice→ally 等清单时，窗口 B 改名 ally→alina：B 等 A 完成，最后清单与磁盘一致", async () => {
        const created = await scene();
        const other = await extraWindow(created, "w2");
        const locks = join(created.project, ".nbook", "locks", "files");
        await mkdir(locks, {recursive: true});
        const held = await holdLock(join(locks, `${createHash("sha256").update("lore.content/content.xml").digest("hex")}.lock`), () => undefined);
        if (!held.ok) throw new Error(held.detail);
        let first: Promise<unknown>;
        let second: Promise<unknown>;
        try {
            first = files(created.window).rename("project://lore.content/alice", "ally");
            await waitUntil("A 的文件已改名", () => exists(join(created.project, "lore.content", "ally")));
            second = files(other).rename("project://lore.content/ally", "alina");
        } finally {
            await held.lock.release();
        }
        expect(await first).toEqual({ok: true, value: {}});
        expect(await second).toEqual({ok: true, value: {}});
        expect(await exists(join(created.project, "lore.content", "alina", "notes.md"))).toBe(true);
        expect(await manifest(created)).toContain(`<item name="alina" title="爱丽丝" icon="person"/>`);
    });
});

describe("Spec workspace.resources 变更事件：操作之后的外部变化", () => {
    it("改名之后外部把同名目录换掉、或修改移过去的文件：仍以外部来源发出", async () => {
        const created = await scene();
        const client = files(created.window);
        const watched = await watching(client);
        expect(await client.rename("project://plain", "moved")).toEqual({ok: true, value: {}});
        await untilBarrier(created, watched, "first.md");
        await writeFile(join(created.project, "moved", "a.md"), "EDITED");
        await waitUntil("移过去的文件被外部修改的事件", () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return changes(watched).some((change) => change.path === "moved/a.md" && change.source.kind === "external");
        });
        await rename(join(created.project, "moved"), join(created.project, "aside"));
        await mkdir(join(created.project, "moved"));
        await waitUntil("同名目录被换掉的事件", () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return changes(watched).some((change) => change.path === "moved" && change.type === "changed" && change.source.kind === "external");
        });
    });

    it("新建之后外部删掉再建同名目录：仍以外部来源发出", async () => {
        const created = await scene();
        const client = files(created.window);
        const watched = await watching(client);
        expect(await client.create("project://plain/dir", "directory")).toEqual({ok: true, value: {}});
        await untilBarrier(created, watched, "first.md");
        await rm(join(created.project, "plain", "dir"), {recursive: true});
        await mkdir(join(created.project, "plain", "dir"));
        await waitUntil("外部重建目录的事件", () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return changes(watched).some((change) => change.path === "plain/dir" && change.source.kind === "external");
        });
    });
});
