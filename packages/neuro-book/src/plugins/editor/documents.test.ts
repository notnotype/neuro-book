/**
 * 文档模型（docs/specs/workbench/editor.md 输出 11–18、22–25，files 验收 4）：真实内核实例的 Files 场地，窗口的文件
 * 客户端经真实链路读写真实目录；在途与先后用链路闸门扣住回复或推迟发送，变化事件经场地的手动时钟交付，不按时长等待。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {MAX_PATH_BYTES} from "nbook/plugins/files/shared/contracts";
import type {FilesService} from "nbook/plugins/files/shared/contracts";
import {extraWindow, files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Layout, Scene} from "nbook/plugins/files/testing/scene";
import {createLinkTap} from "nbook/plugins/files/testing/tap";
import type {LinkTap} from "nbook/plugins/files/testing/tap";

import {createDocumentStore, EMPTY_HASH} from "./web/documents/store";
import type {DocumentStore, StoreEvent, TextDocument} from "./web/documents/store";

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "documents");
});

afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface World {
    readonly scene: Scene;
    readonly tap: LinkTap;
    readonly store: DocumentStore;
    readonly events: StoreEvent[];
    readonly reports: unknown[];
    /** 文档模型发出、还没有结果的读取（经真实客户端，只多记一笔）。 */
    readonly pendingReads: Set<symbol>;
}

const LAYOUT: Layout = {"a.md": "A", "b.md": "B", "dir/c.md": "C"};

async function world(layout: Layout = LAYOUT): Promise<World> {
    counter += 1;
    const tap = createLinkTap();
    const scene = await filesScene(join(tmp, `case-${String(counter)}`), {project: layout, user: {"u.md": "U"}}, {wrapLink: tap.wrap});
    const reports: unknown[] = [];
    const pendingReads = new Set<symbol>();
    const client = files(scene.window);
    const observed: FilesService = {...client, read: async (address, options) => {
        const marker = Symbol(address);
        pendingReads.add(marker);
        try {
            return await client.read(address, options);
        } finally {
            pendingReads.delete(marker);
        }
    }};
    const store = createDocumentStore({files: observed, workspaceKey: "p1", generation: 1, report: (error) => reports.push(error)});
    const events: StoreEvent[] = [];
    store.subscribe((event) => events.push(event));
    closers.push(async () => {
        store.dispose();
        const closed = await scene.world.close();
        for (const result of closed) expect(result).toMatchObject({status: "closed"});
        await rm(scene.root, {recursive: true, force: true});
    });
    return {scene, tap, store, events, reports, pendingReads};
}

/** 等可观察的条件，期间推进场地的时钟（变化事件按批延迟交付）。 */
async function until(at: World, description: string, check: () => boolean): Promise<void> {
    await waitUntil(description, () => {
        at.scene.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
}

/** 文档模型有读取还没拿到结果。 */
const reading = (at: World): boolean => at.pendingReads.size > 0;

const disk = (at: World, path: string): Promise<string> => readFile(join(at.scene.project, path), "utf8");
const count = (at: World, method: string): number => at.tap.requests.filter((request) => request.method === method).length;

async function opened(at: World, address: string): Promise<TextDocument> {
    const document = at.store.acquire(address).document;
    await until(at, `${address} 读到`, () => document.status.value === "ready");
    return document;
}

/** 在另一个窗口的订阅上等某个路径的事件到达（本窗口的订阅与它同批交付）。 */
async function eventFor(at: World, path: string, write: () => Promise<unknown>): Promise<void> {
    let seen = false;
    let ready = false;
    const release = files(at.scene.window).watch("project", (message) => {
        if (message.kind === "ready") ready = true;
        if (message.kind === "batch" && message.events.some((event) => event.path === path)) seen = true;
    });
    try {
        await until(at, "订阅就绪", () => ready);
        await write();
        await until(at, `${path} 的事件`, () => seen);
    } finally {
        release();
    }
}

describe("Spec workbench.editor 输出 11：打开与读取", () => {
    it("同一地址并发打开只读一次；两个引用都释放后文档丢弃", async () => {
        const at = await world();
        const first = at.store.acquire("project://a.md");
        const second = at.store.acquire("project://a.md");
        expect(second.document).toBe(first.document);
        await until(at, "读到", () => first.document.status.value === "ready");
        expect(first.document.text.value).toBe("A");
        expect(count(at, "read")).toBe(1);
        first.release();
        expect(at.store.get("project://a.md")).toBe(first.document);
        second.release();
        expect(at.store.get("project://a.md")).toBeNull();
    });

    it("读取等订阅就绪才发：订阅建立前的外部修改不会漏掉", async () => {
        const at = await world();
        const subscribe = at.tap.holdSend((frame) => frame.type === "subscribe" && frame.contract === "nbook.files/project");
        const document = at.store.acquire("project://a.md").document;
        await subscribe.arrived;
        expect(count(at, "read")).toBe(0);
        await writeFile(join(at.scene.project, "a.md"), "A（订阅前改）");
        subscribe.release();
        await until(at, "读到", () => document.status.value === "ready");
        expect(document.text.value).toBe("A（订阅前改）");
    });

    it("读取在途时文件有变化：结果回来后再读一次，用新的内容", async () => {
        const at = await world();
        const held = at.tap.hold((request) => request.method === "read");
        const document = at.store.acquire("project://a.md").document;
        await held.arrived;
        await eventFor(at, "a.md", () => writeFile(join(at.scene.project, "a.md"), "A（读取中改）"));
        held.release();
        await until(at, "读到新内容", () => document.text.value === "A（读取中改）");
        expect(count(at, "read")).toBe(2);
        // 过时的结果没有先显示：正文只换过一次。
        expect(document.revision.value).toBe(1);
    });

    it("读不到为 failed 并带原因；重试后读到；正文超过上限为 too-large", async () => {
        const at = await world({"a.md": "A", "big.md": "字".repeat(Math.floor(MAX_PATH_BYTES * 256))});
        const missing = at.store.acquire("project://none.md").document;
        await until(at, "失败", () => missing.status.value === "failed");
        expect(missing.failure.value?.code).toBe("not-found");
        await writeFile(join(at.scene.project, "none.md"), "N");
        at.store.retry(missing);
        await until(at, "重试后读到", () => missing.status.value === "ready");
        expect(missing.text.value).toBe("N");
        const big = at.store.acquire("project://big.md").document;
        await until(at, "过大", () => big.status.value === "failed");
        expect(big.failure.value?.code).toBe("too-large");
    });
});

describe("Spec workbench.editor 输出 12–13：输入回执与未裁决输入", () => {
    it("基于当前修订的输入被接受；基于旧修订的不同内容成为未裁决输入，阻止保存；采用当前正文丢弃它，保留本视图则以最新修订提交", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        const base = document.revision.value;
        expect(at.store.commit(document, "v1", base, "A1")).toEqual({status: "accepted", revision: base + 1});
        expect(document.dirty.value).toBe(true);
        expect(at.store.commit(document, "v2", base, "A2")).toEqual({status: "conflict", revision: base + 1});
        expect(at.store.commit(document, "v3", base, "A1")).toEqual({status: "accepted", revision: base + 1});
        expect(document.unresolved.value).toEqual(["v2"]);
        expect(document.text.value).toBe("A1");
        expect(await at.store.save(document)).toEqual({ok: false, code: "unresolved"});
        expect(count(at, "write")).toBe(0);
        expect(at.store.coordinator.affected(["project://"])).toEqual([{address: "project://a.md", state: "unresolved"}]);

        at.store.resolve(document, "v2", "keep-view");
        expect(document.text.value).toBe("A2");
        expect(document.unresolved.value).toEqual([]);
        expect(at.store.commit(document, "v1", base, "A9")).toMatchObject({status: "conflict"});
        at.store.resolve(document, "v1", "adopt-current");
        expect(document.text.value).toBe("A2");
        expect(await at.store.save(document)).toEqual({ok: true});
        expect(await disk(at, "a.md")).toBe("A2");
    });

    it("保存与资源管理器的租约之前先结算视图里还没交出的输入", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        let pending: string | null = "A（防抖中）";
        const detach = at.store.attachView(document, () => {
            if (pending === null) return;
            at.store.commit(document, "v1", document.revision.value, pending);
            pending = null;
        });
        expect(await at.store.save(document)).toEqual({ok: true});
        expect(await disk(at, "a.md")).toBe("A（防抖中）");
        pending = "A（租约前）";
        const begun = await at.store.coordinator.begin(["project://a.md"]);
        expect(document.text.value).toBe("A（租约前）");
        if (begun.ok) begun.lease.end({kind: "done"});
        detach();
    });
});

describe("Spec workbench.editor 输出 14–15：保存", () => {
    it("保存期间的新输入保持 dirty；同时多次保存合并成排队的一次，用前一次完成后的基线", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.store.commit(document, "v", document.revision.value, "A1");
        const held = at.tap.hold((request) => request.method === "write");
        const first = at.store.save(document);
        await held.arrived;
        expect(document.saving.value).toBe(true);
        at.store.commit(document, "v", document.revision.value, "A2");
        const second = at.store.save(document);
        const third = at.store.save(document);
        expect(third).toBe(second);
        held.release();
        expect(await first).toEqual({ok: true});
        expect(await second).toEqual({ok: true});
        expect(count(at, "write")).toBe(2);
        expect(await disk(at, "a.md")).toBe("A2");
        expect(document.dirty.value).toBe(false);

        // 只看第一次保存完成的那一刻：磁盘是快照，文档仍 dirty。
        at.store.commit(document, "v", document.revision.value, "A3");
        const hold = at.tap.hold((request) => request.method === "write");
        const saving = at.store.save(document);
        await hold.arrived;
        at.store.commit(document, "v", document.revision.value, "A4");
        hold.release();
        await saving;
        expect(await disk(at, "a.md")).toBe("A3");
        expect(document.dirty.value).toBe(true);
    });

    it("dirty 时外部改写：标“磁盘已变化”，保存得到冲突且不写；重新载入后为磁盘内容；另一次覆盖后磁盘为编辑内容", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.store.commit(document, "v", document.revision.value, "A（我的）");
        await writeFile(join(at.scene.project, "a.md"), "A（外部）");
        await until(at, "磁盘已变化", () => document.diskChanged.value);
        expect(document.text.value).toBe("A（我的）");
        expect(await at.store.save(document)).toEqual({ok: false, code: "conflict"});
        expect(document.conflict.value).not.toBeNull();
        expect(await at.store.save(document)).toEqual({ok: false, code: "conflict"});
        expect(await disk(at, "a.md")).toBe("A（外部）");
        await at.store.revert(document);
        expect(document.text.value).toBe("A（外部）");
        expect(document.dirty.value).toBe(false);
        expect(document.conflict.value).toBeNull();

        at.store.commit(document, "v", document.revision.value, "A（我的二）");
        await writeFile(join(at.scene.project, "a.md"), "A（外部二）");
        await until(at, "磁盘已变化", () => document.diskChanged.value);
        expect(await at.store.save(document)).toMatchObject({ok: false, code: "conflict"});
        expect(await at.store.overwrite(document)).toEqual({ok: true});
        expect(await disk(at, "a.md")).toBe("A（我的二）");
        expect(document.dirty.value).toBe(false);

        // 冲突之后正文改回了已保存的正文（不 dirty），磁盘却是别人的版本：覆盖照样写入。
        at.store.commit(document, "v", document.revision.value, "A（我的三）");
        await writeFile(join(at.scene.project, "a.md"), "A（外部三）");
        await until(at, "磁盘已变化", () => document.diskChanged.value);
        expect(await at.store.save(document)).toMatchObject({ok: false, code: "conflict"});
        at.store.commit(document, "v", document.revision.value, "A（我的二）");
        expect(document.dirty.value).toBe(false);
        expect(await at.store.overwrite(document)).toEqual({ok: true});
        expect(await disk(at, "a.md")).toBe("A（我的二）");
        expect(document.conflict.value).toBeNull();

        // 覆盖本身写不进去（目录只读）：冲突与正文都保持，之后仍可重新载入或再覆盖。
        at.store.commit(document, "v", document.revision.value, "A（我的四）");
        await writeFile(join(at.scene.project, "a.md"), "A（外部四）");
        await until(at, "磁盘已变化", () => document.diskChanged.value);
        expect(await at.store.save(document)).toMatchObject({ok: false, code: "conflict"});
        await chmod(at.scene.project, 0o555);
        try {
            expect(await at.store.overwrite(document)).toMatchObject({ok: false});
        } finally {
            await chmod(at.scene.project, 0o755);
        }
        expect(document.conflict.value).not.toBeNull();
        expect(document.text.value).toBe("A（我的四）");
        expect(await disk(at, "a.md")).toBe("A（外部四）");
    });

    it("保存的结果未知：先说明，之后的核对（重连后的 resync）读到快照的内容即为已保存", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.store.commit(document, "v", document.revision.value, "A（断线前）");
        const held = at.tap.hold((request) => request.method === "write");
        const saving = at.store.save(document);
        await held.arrived;
        // 写已经执行（回复扣在窗口这一端），此时断线：客户端得到结果未知。之后放掉扣住的回复：它只会送到已关闭的旧
        // 链路；不放的话重连后编号相同的新请求的回复会被它误扣。
        at.scene.windowLink.disconnect();
        expect(await saving).toMatchObject({ok: false, code: "unknown-outcome"});
        expect(document.saveProblem.value?.code).toBe("unknown-outcome");
        held.release();
        await at.scene.windowLink.reconnect();
        await until(at, "重连后核对为已保存", () => !document.dirty.value);
        expect(document.saveProblem.value).toBeNull();
        expect(await disk(at, "a.md")).toBe("A（断线前）");
    });
});

describe("Spec workbench.editor 输出 16：变化事件的核对", () => {
    it("自己的保存产生的事件只核对、不换正文；不 dirty 时外部修改换成磁盘内容，修订前进", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.store.commit(document, "v", document.revision.value, "A1");
        const reads = count(at, "read");
        const revision = document.revision.value;
        await at.store.save(document);
        await until(at, "自己保存的事件被核对", () => count(at, "read") > reads);
        await until(at, "核对完成", () => !document.saving.value);
        expect(document.revision.value).toBe(revision);
        expect(document.text.value).toBe("A1");

        await writeFile(join(at.scene.project, "a.md"), "A（外部）");
        await until(at, "换成磁盘内容", () => document.text.value === "A（外部）");
        expect(document.revision.value).toBe(revision + 1);
        expect(document.dirty.value).toBe(false);

        // 保存的回复还没到时事件先到：核对读到的就是正在提交的正文，不算外部修改。
        at.store.commit(document, "v", document.revision.value, "A2");
        const held = at.tap.hold((request) => request.method === "write");
        const before = count(at, "read");
        const saving = at.store.save(document);
        await held.arrived;
        await until(at, "在途保存的事件被核对", () => count(at, "read") > before && !reading(at));
        // 保存还在途时也不提示“磁盘已变化”。
        expect(document.diskChanged.value).toBe(false);
        held.release();
        expect(await saving).toEqual({ok: true});
        expect(document.diskChanged.value).toBe(false);
        expect(document.dirty.value).toBe(false);
    });

    it("断线期间的外部修改：重连后 resync 核对，不 dirty 的文档换成磁盘内容", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.scene.windowLink.disconnect();
        await writeFile(join(at.scene.project, "a.md"), "A（断线中改）");
        await at.scene.windowLink.reconnect();
        await until(at, "resync 后换成磁盘内容", () => document.text.value === "A（断线中改）");
    });
});

describe("Spec workbench.editor 输出 17–18：改名、删除与订阅结束", () => {
    it("改名事件把文档与其后代改到新地址：正文与 dirty 保留，身份的 path 随之改变，通知标签", async () => {
        const at = await world();
        const document = await opened(at, "project://dir/c.md");
        const id = document.target.value.documentId;
        at.store.commit(document, "v", document.revision.value, "C（未保存）");
        expect(await files(at.scene.window).rename("project://dir", "moved")).toMatchObject({ok: true});
        await until(at, "改到新地址", () => document.target.value.path === "project://moved/c.md");
        expect(document.target.value.documentId).toBe(id);
        expect(document.text.value).toBe("C（未保存）");
        expect(document.dirty.value).toBe(true);
        expect(at.store.get("project://moved/c.md")).toBe(document);
        expect(at.events).toContainEqual({kind: "rebound", from: "project://dir", to: "project://moved", kept: []});
        expect(await at.store.save(document)).toEqual({ok: true});
        expect(await disk(at, "moved/c.md")).toBe("C（未保存）");
    });

    it("其它来源删除：标已删除、正文保留；保存在原路径排他新建后写入；原路径已被占用时为 exists、保持 dirty", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.store.commit(document, "v", document.revision.value, "A（留着）");
        await rm(join(at.scene.project, "a.md"));
        await until(at, "已删除", () => document.status.value === "deleted");
        expect(document.text.value).toBe("A（留着）");
        // 已删除的文档只读：视图不再接受输入，dirty 的正文仍可保存重建。
        expect(document.writable.value).toBe(false);
        expect(await at.store.save(document)).toEqual({ok: true});
        expect(await disk(at, "a.md")).toBe("A（留着）");
        expect(document.status.value).toBe("ready");

        const other = await opened(at, "project://b.md");
        at.store.commit(other, "v", other.revision.value, "B（留着）");
        await rm(join(at.scene.project, "b.md"));
        await until(at, "已删除", () => other.status.value === "deleted");
        // 删除事件之后、保存之前，别处又建了同名文件：按事件核对前先挡住，保存的排他新建得到冲突。
        const recreate = at.tap.hold((request) => request.method === "read");
        let arrived = false;
        void recreate.arrived.then(() => {
            arrived = true;
        });
        await writeFile(join(at.scene.project, "b.md"), "B（别人建的）");
        await until(at, "核对的读取被扣住", () => arrived);
        expect(await at.store.save(other)).toMatchObject({ok: false, code: "exists"});
        recreate.release();
        expect(await disk(at, "b.md")).toBe("B（别人建的）");
        expect(other.dirty.value).toBe(true);
    });

    it("改名到一个外部删除后仍打开着的地址：那份要结算时两份正文都留着（移过来的留在旧地址、标已删除），不用结算时关掉它", async () => {
        const at = await world();
        const client = files(at.scene.window);
        const a = await opened(at, "project://a.md");
        const b = await opened(at, "project://b.md");
        at.store.commit(a, "v", a.revision.value, "A（未保存）");
        at.store.commit(b, "v", b.revision.value, "B（未保存）");
        await rm(join(at.scene.project, "b.md"));
        await until(at, "b 已删除", () => b.status.value === "deleted");
        expect(await client.rename("project://a.md", "b.md")).toMatchObject({ok: true});
        await until(at, "a 标为已删除", () => a.status.value === "deleted");
        await until(at, "b 看到文件又出现了", () => b.diskChanged.value);
        expect(at.store.get("project://a.md")).toBe(a);
        expect(at.store.get("project://b.md")).toBe(b);
        expect(at.store.rescue()).toEqual([{path: "project://a.md", text: "A（未保存）"}, {path: "project://b.md", text: "B（未保存）"}]);

        // 目标那份不用结算：关掉它，移过来的这份照常改地址。
        const c = await opened(at, "project://dir/c.md");
        at.store.commit(c, "v", c.revision.value, "C（未保存）");
        const d = at.store.acquire("project://dir/d.md").document;
        await until(at, "d 读不到", () => d.status.value === "failed");
        expect(await client.rename("project://dir/c.md", "d.md")).toMatchObject({ok: true});
        await until(at, "c 改到 d", () => c.target.value.path === "project://dir/d.md");
        expect(at.store.get("project://dir/d.md")).toBe(c);
        expect(at.events).toContainEqual({kind: "closed", addresses: ["project://dir/d.md"]});
    });

    it("删除后重建用空正文的基线", () => {
        expect(EMPTY_HASH).toBe(new Bun.CryptoHasher("sha256").update("").digest("hex"));
    });

    it("项目的订阅结束：文档不可保存并说明原因", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.store.commit(document, "v", document.revision.value, "A1");
        await at.scene.projectApp.stop();
        await until(at, "订阅结束", () => document.ended.value !== null);
        expect(document.writable.value).toBe(false);
        expect(await at.store.save(document)).toMatchObject({ok: false, code: "ended"});
    });
});

describe("Spec workbench.editor 输出 22–25：文档协调与抢救", () => {
    it("租约：等在途保存、挡住新保存直到结束；移动成功的项改地址；结果未知时租约保持", async () => {
        const at = await world();
        const document = await opened(at, "project://dir/c.md");
        at.store.commit(document, "v", document.revision.value, "C1");
        const held = at.tap.hold((request) => request.method === "write");
        const saving = at.store.save(document);
        await held.arrived;
        let begun = false;
        const leasing = at.store.coordinator.begin(["project://dir"]).then((result) => {
            begun = true;
            return result;
        });
        await until(at, "等在途保存", () => count(at, "write") === 1);
        expect(begun).toBe(false);
        held.release();
        await saving;
        const result = await leasing;
        if (!result.ok) throw new Error("没有取得租约");
        at.store.commit(document, "v", document.revision.value, "C2");
        let saved = false;
        const later = at.store.save(document).then((outcome) => {
            saved = true;
            return outcome;
        });
        expect(await files(at.scene.window).rename("project://dir", "moved")).toMatchObject({ok: true});
        result.lease.end({kind: "unknown"});
        await until(at, "改名事件改了地址", () => document.target.value.path === "project://moved/c.md");
        expect(saved).toBe(false);
        expect(count(at, "write")).toBe(1);
        result.lease.end({kind: "done", moved: [{from: "project://dir", to: "project://moved"}]});
        expect(await later).toEqual({ok: true});
        expect(await disk(at, "moved/c.md")).toBe("C2");
    });

    it("未裁决输入或磁盘冲突的文档：租约被拒并列出", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.store.commit(document, "v1", document.revision.value, "A1");
        at.store.commit(document, "v2", document.revision.value - 1, "A2");
        expect(await at.store.coordinator.begin(["project://a.md"])).toEqual({ok: false, reason: "blocked", documents: [{address: "project://a.md", state: "unresolved"}]});

        const other = await opened(at, "project://b.md");
        at.store.commit(other, "v", other.revision.value, "B（我的）");
        await writeFile(join(at.scene.project, "b.md"), "B（外部）");
        await until(at, "磁盘已变化", () => other.diskChanged.value);
        expect(await at.store.save(other)).toMatchObject({ok: false, code: "conflict"});
        expect(await at.store.coordinator.begin(["project://b.md"])).toEqual({ok: false, reason: "blocked", documents: [{address: "project://b.md", state: "conflict"}]});
    });

    it("多份文档的租约：等其中一份的保存时另一份开始保存，租约等到全部保存结束才给", async () => {
        const at = await world();
        const a = await opened(at, "project://a.md");
        const b = await opened(at, "project://b.md");
        at.store.commit(a, "v", a.revision.value, "A1");
        at.store.commit(b, "v", b.revision.value, "B1");
        const writing = (name: string) => (request: {method: string; input: unknown}): boolean => request.method === "write" && JSON.stringify(request.input).includes(name);
        const heldB = at.tap.hold(writing("b.md"));
        const savingB = at.store.save(b);
        await heldB.arrived;
        const granted: {value: {readonly ok: boolean; readonly aSaving: boolean} | null} = {value: null};
        const leasing = at.store.coordinator.begin(["project://"]).then((result) => {
            granted.value = {ok: result.ok, aSaving: a.saving.value};
            return result;
        });
        const heldA = at.tap.hold(writing("a.md"));
        const savingA = at.store.save(a);
        await heldA.arrived;
        heldB.release();
        expect(await savingB).toEqual({ok: true});
        await until(at, "b 的保存已经结算", () => !b.saving.value);
        expect(granted.value).toBeNull();
        heldA.release();
        expect(await savingA).toEqual({ok: true});
        const result = await leasing;
        expect(granted.value).toEqual({ok: true, aSaving: false});
        if (result.ok) result.lease.end({kind: "done"});
    });

    it("保存全部先结算视图里还没交出的输入，再决定要不要保存", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        const detach = at.store.attachView(document, () => {
            at.store.commit(document, "v", document.revision.value, "A（延迟中）");
        });
        expect(await at.store.coordinator.save(["project://"])).toEqual([{address: "project://a.md", ok: true}]);
        expect(await disk(at, "a.md")).toBe("A（延迟中）");
        detach();
    });

    it("身份链：保存前冻结的令牌经 translate 换成保存后的，移动成功；外部替换后的令牌不在链上", async () => {
        const at = await world();
        const client = files(at.scene.window);
        const token = async (address: string): Promise<string> => {
            const identified = await client.identify([address]);
            if (!identified.ok) throw new Error(identified.detail);
            return (identified.value.items[0] as {token: string}).token;
        };
        const document = await opened(at, "project://a.md");
        const frozen = await token("project://a.md");
        at.store.commit(document, "v", document.revision.value, "A1");
        await at.store.save(document);
        at.store.commit(document, "v", document.revision.value, "A2");
        await at.store.save(document);
        const translated = at.store.coordinator.translate("project://a.md", frozen);
        expect(translated).toBe(await token("project://a.md"));
        expect(await client.move([{source: "project://a.md", target: "project://dir/a.md", expected: translated}]).result).toMatchObject({ok: true, value: {items: [{status: "done"}]}});

        const other = await opened(at, "project://b.md");
        const before = await token("project://b.md");
        await rm(join(at.scene.project, "b.md"));
        await writeFile(join(at.scene.project, "b.md"), "B（外部替换）");
        expect(at.store.coordinator.translate("project://b.md", before)).toBe(before);
        void other;
    });

    it("close 关闭地址下的文档并通知；抢救列出 dirty 正文与未裁决输入", async () => {
        const at = await world();
        const a = await opened(at, "project://a.md");
        const c = await opened(at, "project://dir/c.md");
        at.store.commit(a, "v1", a.revision.value, "A1");
        at.store.commit(a, "v2", a.revision.value - 1, "A（另一视图）");
        at.store.commit(c, "v", c.revision.value, "C1");
        expect(at.store.rescue()).toEqual([{path: "project://a.md", text: "A1"}, {path: "project://a.md", text: "A（另一视图）"}, {path: "project://dir/c.md", text: "C1"}]);
        at.store.coordinator.close(["project://dir"]);
        expect(at.store.get("project://dir/c.md")).toBeNull();
        expect(at.events).toContainEqual({kind: "closed", addresses: ["project://dir/c.md"]});
        expect(at.store.coordinator.affected(["project://"])).toEqual([{address: "project://a.md", state: "unresolved"}]);
    });

    it("另一个窗口看到保存后的正文（files 验收 1 的第二个消费者）", async () => {
        const at = await world();
        const document = await opened(at, "project://a.md");
        at.store.commit(document, "v", document.revision.value, "A（保存）");
        await at.store.save(document);
        const other = await extraWindow(at.scene, "w2");
        expect(await files(other).read("project://a.md")).toMatchObject({ok: true, value: {text: "A（保存）"}});
    });
});
