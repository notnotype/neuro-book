/**
 * 批量移动、复制、删除（docs/specs/workspace/files.md 的“文件操作”：批量预处理、逐项结果、停止与取消、大小上限，验收 2、
 * 3、8、9；workbench/files-explorer.md 的“源消失或身份变化时拒绝旧意图”；folder-kinds.md 的清单维护）：真实内核实例、
 * 真实目录，经窗口里的文件客户端或真实远程合同调用。
 *
 * 让第一项停在执行中用真实的锁：测试持有 `content.xml` 的写入锁，第一项在内容树里提交文件之后等这把锁；确认它的文件
 * 已落盘再取消、断线或停止，放锁后看后续项。权限用例要求以普通用户运行，root 时跳过。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {chmod, link, lstat, mkdir, readdir, readFile, rename, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {holdLock} from "nbook/backend/locked-replace";

import {fitBudget} from "./backend/batch";
import {BATCH_DELAY_MS} from "./backend/changes";
import {projectFilesContract, TEXT_BUDGET_BYTES} from "./shared/contracts";
import type {FileChange, ItemResult, ManifestIssue, WatchMessage} from "./shared/contracts";
import {extraWindow, files, filesScene, remote} from "./testing/scene";
import type {Layout, Scene} from "./testing/scene";

const privileged = process.getuid?.() === 0;

let tmp = "";
let counter = 0;
const scenes: Scene[] = [];
/** 测试自己持有的锁：用例失败时也在关场地之前放掉。 */
const heldLocks: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "batch");
});

afterEach(async () => {
    for (const release of heldLocks.splice(0)) await release();
    for (const created of scenes.splice(0)) {
        const results = await created.world.close();
        for (const result of results) expect(result).toMatchObject({status: "closed"});
        await chmodTree(created.root);
        await rm(created.root, {recursive: true, force: true});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function chmodTree(path: string): Promise<void> {
    const info = await lstat(path).catch(() => null);
    if (info === null || info.isSymbolicLink()) return;
    await chmod(path, info.isDirectory() ? 0o755 : 0o644);
    if (info.isDirectory()) for (const name of await readdir(path)) await chmodTree(join(path, name));
}

const LORE = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="alice" title="爱丽丝" icon="person"/>
  <item name="bob" title="鲍勃">
    <item name="sword" title="宝剑"/>
  </item>
</content>
`;

const LAYOUT: Layout = {
    "lore.content/content.xml": LORE,
    "lore.content/alice/notes.md": "A",
    "lore.content/bob/index.md": "BOB",
    "lore.content/bob/sword/index.md": "SWORD",
    "other.content/content.xml": "<content>\n</content>\n",
    "plain/a.md": "PA",
    "plain/dir/x.md": "X",
    "plain/dir/y.md": "Y",
    "solo.md": "SOLO",
};

async function scene(project: Layout = LAYOUT): Promise<Scene> {
    counter += 1;
    const created = await filesScene(join(tmp, `world-${String(counter)}`), {project});
    scenes.push(created);
    return created;
}

const at = (created: Scene, path: string): string => join(created.project, path);
const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);
const text = (path: string): Promise<string> => readFile(path, "utf8");

/** 持有某个内容根清单的写入锁（与文件服务的保存、清单修改同一把）。 */
async function holdManifest(created: Scene, tree: string): Promise<() => Promise<void>> {
    const directory = at(created, ".nbook/locks/files");
    await mkdir(directory, {recursive: true});
    const held = await holdLock(join(directory, `${createHash("sha256").update(`${tree}/content.xml`).digest("hex")}.lock`), () => undefined);
    if (!held.ok) throw new Error(held.detail);
    heldLocks.push(held.lock.release);
    return held.lock.release;
}

const ok = (items: ReadonlyArray<ItemResult>, manifests: ReadonlyArray<ManifestIssue> = []) => ({ok: true as const, value: {items: [...items], manifests: [...manifests]}});
const user = {kind: "user", plugin: "x.explorer"} as const;

async function watching(created: Scene): Promise<WatchMessage[]> {
    const messages: WatchMessage[] = [];
    files(created.window).watch("project", (message) => messages.push(message));
    await waitUntil("订阅就绪", () => messages.some((message) => message.kind === "ready"));
    return messages;
}

/** 屏障：外部写一个文件，推进手动时钟直到它的外部事件到达；返回屏障之前的全部事件。 */
async function untilBarrier(created: Scene, messages: WatchMessage[]): Promise<FileChange[]> {
    const events = (): FileChange[] => messages.flatMap((message) => (message.kind === "batch" ? message.events : []));
    await writeFile(at(created, "barrier.md"), "B");
    await waitUntil("屏障的事件", () => {
        created.world.clock.advance(BATCH_DELAY_MS);
        return events().some((change) => change.path === "barrier.md");
    });
    return events().filter((change) => change.path !== "barrier.md");
}

describe("Spec workspace.files 批量预处理", () => {
    it("父子重叠只做最外层、重复的源（经链接别名的同一目录项）只做一次；同一 inode 的两个硬链接名是两个源", async () => {
        const created = await scene();
        await symlink(".", at(created, "self"));
        await link(at(created, "solo.md"), at(created, "hard.md"));
        const result = await files(created.window).move([
            {source: "project://plain/dir", target: "project://moved"},
            {source: "project://plain/dir/x.md", target: "project://x.md"},
            {source: "project://self/plain/dir", target: "project://again"},
            {source: "project://solo.md", target: "project://solo2.md"},
            {source: "project://hard.md", target: "project://hard2.md"},
        ]).result;
        expect(result).toEqual(ok([{status: "done"}, {status: "skipped", reason: "covered"}, {status: "skipped", reason: "duplicate"}, {status: "done"}, {status: "done"}]));
        expect((await readdir(at(created, "moved"))).sort()).toEqual(["x.md", "y.md"]);
        expect(await exists(at(created, "again"))).toBe(false);
        expect([await text(at(created, "solo2.md")), await text(at(created, "hard2.md"))]).toEqual(["SOLO", "SOLO"]);
    });

    it("移动到原处无操作、无事件；复制到原处为 conflict；移动或复制到自身后代为 into-itself；独立项照常继续", async () => {
        const created = await scene();
        const messages = await watching(created);
        const client = files(created.window);
        expect(await client.move([
            {source: "project://solo.md", target: "project://solo.md"},
            {source: "project://plain/dir", target: "project://plain/dir/inner"},
            {source: "project://plain/a.md", target: "project://plain/b.md"},
        ]).result).toEqual(ok([{status: "done"}, expect.objectContaining({status: "failed", code: "into-itself"}), {status: "done"}]));
        expect(await client.copy([
            {source: "project://plain/b.md", target: "project://plain/b.md"},
            {source: "project://plain/dir", target: "project://plain/dir/copy"},
            {source: "project://solo.md", target: "project://plain/solo.md"},
        ]).result).toEqual(ok([expect.objectContaining({status: "failed", code: "conflict"}), expect.objectContaining({status: "failed", code: "into-itself"}), {status: "done"}]));
        expect(await exists(at(created, "plain/dir/copy"))).toBe(false);
        expect(await untilBarrier(created, messages)).toEqual([
            {type: "renamed", path: "plain/b.md", from: "plain/a.md", source: user},
            {type: "created", path: "plain/solo.md", source: user},
        ]);
    });

    it("冻结的令牌：剪切后同路径换成同字节的文件，该项为 source-changed，换上的文件保留；后续项继续", async () => {
        const created = await scene();
        const client = files(created.window);
        const identified = await client.identify(["project://plain/a.md"]);
        const token = identified.ok ? (identified.value.items[0] as {readonly token: string}).token : "";
        await rename(at(created, "plain/a.md"), at(created, "plain/original.md"));
        await writeFile(at(created, "plain/a.md"), "PA");
        expect(await client.move([
            {source: "project://plain/a.md", target: "project://a.md", expected: token},
            {source: "project://solo.md", target: "project://plain/solo.md"},
        ]).result).toEqual(ok([expect.objectContaining({status: "failed", code: "source-changed"}), {status: "done"}]));
        expect(await text(at(created, "plain/a.md"))).toBe("PA");
        expect(await exists(at(created, "a.md"))).toBe(false);
    });
});

describe("Spec workspace.folder-kinds 批量的清单维护", () => {
    it("移到另一个内容文件夹带走条目子树；复制带一份；两边清单各自更新", async () => {
        const created = await scene();
        const client = files(created.window);
        expect(await client.move([{source: "project://lore.content/bob", target: "project://other.content/bob"}]).result).toEqual(ok([{status: "done"}]));
        expect(await client.copy([{source: "project://lore.content/alice", target: "project://other.content/alice-copy"}]).result).toEqual(ok([{status: "done"}]));
        expect(await text(at(created, "other.content/content.xml"))).toBe(`<content>
  <item name="bob" title="鲍勃">
    <item name="sword" title="宝剑"/>
  </item>
  <item name="alice-copy" title="爱丽丝" icon="person"/>
</content>
`);
        expect(await text(at(created, "lore.content/content.xml"))).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="alice" title="爱丽丝" icon="person"/>
</content>
`);
    });

    it.skipIf(privileged)("跨内容树移动只一侧清单写不进：文件已移，该项 done 并指明那份清单，另一侧照常更新", async () => {
        const created = await scene();
        await chmod(at(created, "other.content/content.xml"), 0o444);
        expect(await files(created.window).move([{source: "project://lore.content/alice", target: "project://other.content/alice"}]).result)
            .toEqual(ok([{status: "done", manifests: [0]}], [expect.objectContaining({path: "other.content/content.xml", status: "failed"})]));
        expect(await exists(at(created, "other.content/alice/notes.md"))).toBe(true);
        expect(await text(at(created, "other.content/content.xml"))).toBe("<content>\n</content>\n");
        expect(await text(at(created, "lore.content/content.xml"))).not.toContain("alice");
    });

    it.skipIf(privileged)("源清单只读：目标仍带走展示名与嵌套条目，只报告源清单没改成", async () => {
        const created = await scene();
        await chmod(at(created, "lore.content/content.xml"), 0o444);
        expect(await files(created.window).move([{source: "project://lore.content/bob", target: "project://other.content/bob"}]).result)
            .toEqual(ok([{status: "done", manifests: [0]}], [expect.objectContaining({path: "lore.content/content.xml", status: "failed"})]));
        expect(await text(at(created, "other.content/content.xml"))).toContain(`<item name="bob" title="鲍勃">\n    <item name="sword" title="宝剑"/>`);
        expect(await text(at(created, "lore.content/content.xml"))).toBe(LORE);
    });
});

describe("Spec workspace.files 批量删除与复制的部分完成", () => {
    it.skipIf(privileged)("删除：只读文件让目录删除停下，报告已删范围与真实事件；目录条目留在清单；独立项照常删除", async () => {
        const created = await scene({...LAYOUT, "lore.content/content.xml": LORE.replace("</content>", "  <item name=\"carol\"/>\n</content>"), "lore.content/carol/a.md": "A", "lore.content/carol/z.md": "Z"});
        await chmod(at(created, "lore.content/carol/z.md"), 0o444);
        const messages = await watching(created);
        const result = await files(created.window).delete([{address: "project://lore.content/carol"}, {address: "project://lore.content/alice"}, {address: "project://nothing.md"}]).result;
        expect(result).toEqual(ok([
            {status: "failed", code: "permission-denied", detail: expect.any(String), partial: {removed: {paths: ["lore.content/carol/a.md"], truncated: false}}},
            {status: "done"},
            expect.objectContaining({status: "failed", code: "not-found"}),
        ]));
        expect(await readdir(at(created, "lore.content/carol"))).toEqual(["z.md"]);
        expect(await text(at(created, "lore.content/content.xml"))).toContain(`<item name="carol"/>`);
        expect(await untilBarrier(created, messages)).toEqual([
            {type: "deleted", path: "lore.content/carol/a.md", source: user},
            {type: "deleted", path: "lore.content/alice", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
        ]);
    });

    it.skipIf(privileged)("目录复制中途失败：残留留在目标处，结果给出范围，事件里有目标的新建", async () => {
        const created = await scene({...LAYOUT, "src/a.md": "A", "src/b.md": "B"});
        await chmod(at(created, "src/b.md"), 0o000);
        const messages = await watching(created);
        expect(await files(created.window).copy([{source: "project://src", target: "project://copy"}]).result)
            .toEqual(ok([{status: "failed", code: "permission-denied", detail: expect.any(String), partial: {residual: {paths: ["copy"], truncated: false}}}]));
        expect(await readdir(at(created, "copy"))).toEqual(["a.md"]);
        expect(await untilBarrier(created, messages)).toEqual([{type: "created", path: "copy", source: user}]);
    });

    it("结果的大小：清单说明按清单去重成表；超过预算时依次省略范围、截短说明、省略清单表，结果总在预算内", () => {
        const issue = {path: "lore.content/content.xml", status: "failed", detail: "只读"} as const;
        expect(fitBudget([{status: "done", manifests: [issue]}, {status: "done", manifests: [issue, {...issue, path: "b.content/content.xml"}]}, {status: "cancelled"}]))
            .toEqual({items: [{status: "done", manifests: [0]}, {status: "done", manifests: [0, 1]}, {status: "cancelled"}], manifests: [issue, {...issue, path: "b.content/content.xml"}]});

        const size = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;
        const ranges = fitBudget(Array.from({length: 1000}, () => ({status: "failed" as const, code: "io-failed", detail: "d", partial: {residual: {paths: ["x".repeat(2000)], truncated: false}}, manifests: []})));
        expect(size(ranges)).toBeLessThanOrEqual(TEXT_BUDGET_BYTES);
        expect(ranges.items[0]).toEqual({status: "failed", code: "io-failed", detail: "d", partial: {residual: {paths: [], truncated: true}}});

        // 控制字符编码成六个字节：按字数截短装不下，要按编码字节截。
        const details = fitBudget(Array.from({length: 1000}, () => ({status: "failed" as const, code: "io-failed", detail: "\u0001".repeat(400), manifests: []})));
        expect(size(details)).toBeLessThanOrEqual(TEXT_BUDGET_BYTES);

        const paths = fitBudget(Array.from({length: 1000}, (_unused, index) => ({status: "done" as const, manifests: [{path: `${String(index)}${"m".repeat(2000)}/content.xml`, status: "invalid" as const, detail: "坏"}]})));
        expect(size(paths)).toBeLessThanOrEqual(TEXT_BUDGET_BYTES);
        expect(paths).toMatchObject({manifests: [], truncated: true});
        expect(paths.items[0]).toEqual({status: "done"});
    });

    it.skipIf(privileged)("真实的大范围部分删除：结果省略路径并标 truncated，仍经窗口取回，之后的调用照常", async () => {
        const created = await scene();
        const big = at(created, "big");
        await mkdir(big);
        for (let index = 0; index < 5000; index += 1) await writeFile(join(big, `${String(index).padStart(4, "0")}${"n".repeat(200)}.md`), "");
        await writeFile(join(big, "zz.md"), "RO");
        await chmod(join(big, "zz.md"), 0o444);
        const result = await files(created.window).delete([{address: "project://big"}]).result;
        expect(result).toEqual(ok([{status: "failed", code: "permission-denied", detail: expect.any(String), partial: {removed: {paths: [], truncated: true}}}]));
        expect(await readdir(big)).toEqual(["zz.md"]);
        expect(await files(created.window).list("project://")).toMatchObject({ok: true});
    }, 30_000);

    it("输入超过预算：客户端不发出，提供者也拒绝；没有副作用", async () => {
        const created = await scene();
        const long = Array.from({length: 12}, () => "d".repeat(250)).join("/");
        const items = Array.from({length: 400}, (_unused, index) => ({source: `project://${long}/${String(index)}`, target: `project://t/${String(index)}`}));
        expect(await files(created.window).move(items).result).toMatchObject({ok: false, code: "too-large"});
        const direct = await remote(created.window).use(projectFilesContract).move({operation: "big", items: items.map((item) => ({source: item.source.slice(10), target: item.target.slice(10)}))});
        expect(direct).toMatchObject({ok: false, code: "too-large"});
    });
});

describe("Spec workspace.files 停止与取消", () => {
    const twoItems = [
        {source: "project://lore.content/alice", target: "project://lore.content/alice2"},
        {source: "project://plain/a.md", target: "project://plain/b.md"},
    ];

    it("第一项执行中取消：它按实际完成，第二项 cancelled 且没有副作用", async () => {
        const created = await scene();
        const release = await holdManifest(created, "lore.content");
        const handle = files(created.window).move(twoItems);
        await waitUntil("第一项的文件已移动", () => exists(at(created, "lore.content/alice2")));
        expect(await handle.cancel()).toEqual({ok: true, value: {found: true}});
        await release();
        expect(await handle.result).toEqual(ok([{status: "done"}, {status: "cancelled"}]));
        expect(await exists(at(created, "plain/a.md"))).toBe(true);
        expect(await text(at(created, "lore.content/content.xml"))).toContain(`name="alice2"`);
        expect(await handle.cancel()).toEqual({ok: true, value: {found: false}});
    });

    it("操作 id 只属于发起的调用方：同一调用方重复的在途 id 为 busy，别的窗口取消不到", async () => {
        const created = await scene();
        const other = await extraWindow(created, "w2");
        const api = remote(created.window).use(projectFilesContract);
        const release = await holdManifest(created, "lore.content");
        const pending = api.move({operation: "op-1", items: twoItems.map((item) => ({source: item.source.slice(10), target: item.target.slice(10)}))});
        await waitUntil("第一项的文件已移动", () => exists(at(created, "lore.content/alice2")));
        expect(await api.move({operation: "op-1", items: []})).toMatchObject({ok: false, code: "busy"});
        expect(await remote(other).use(projectFilesContract).cancel({operation: "op-1"})).toEqual({ok: true, value: {found: false}});
        await release();
        expect(await pending).toEqual(ok([{status: "done"}, {status: "done"}]));
    });

    it("调用方断线：提供方在下一项之前停下（诊断为屏障），第二项没有执行", async () => {
        const created = await scene();
        const release = await holdManifest(created, "lore.content");
        const handle = files(created.window).move(twoItems);
        await waitUntil("第一项的文件已移动", () => exists(at(created, "lore.content/alice2")));
        created.windowLink.disconnect();
        expect(await handle.result).toMatchObject({ok: false, code: "unknown-outcome"});
        await release();
        await waitUntil("批量停下的诊断", () => created.world.diagnostics("project:P#1").query({}).records.some((record) => record.event === "files.batch.stopped"));
        expect(await exists(at(created, "plain/a.md"))).toBe(true);
        expect(await exists(at(created, "plain/b.md"))).toBe(false);
    });

    it("提供入口停止：等在途批量结算后才关闭，第二项没有执行", async () => {
        const created = await scene();
        const release = await holdManifest(created, "lore.content");
        const handle = files(created.window).move(twoItems);
        await waitUntil("第一项的文件已移动", () => exists(at(created, "lore.content/alice2")));
        const stopping = created.projectApp.stop();
        await release();
        expect(await stopping).toMatchObject({status: "closed"});
        // 关闭等在途批量结算：第一项的清单修改在关闭之前已经完成。
        expect(await text(at(created, "lore.content/content.xml"))).toContain(`name="alice2"`);
        expect(await exists(at(created, "plain/a.md"))).toBe(true);
        expect(await exists(at(created, "plain/b.md"))).toBe(false);
        expect(await handle.result).toEqual(ok([{status: "done"}, {status: "not-run", reason: "stopped"}]));
    });

    it("根在批量中途被移走：当前项按实际结算，之后的项为 not-run: root-gone", async () => {
        const created = await scene();
        const release = await holdManifest(created, "lore.content");
        const handle = files(created.window).move(twoItems);
        await waitUntil("第一项的文件已移动", () => exists(at(created, "lore.content/alice2")));
        await rename(created.project, `${created.project}-moved`);
        await release();
        const result = await handle.result;
        expect(result).toMatchObject({ok: true, value: {items: [{status: "done"}, {status: "not-run", reason: "root-gone"}]}});
        expect(await exists(`${created.project}-moved/plain/a.md`)).toBe(true);
    });
});

describe("Spec workspace.folder-kinds 操作锁：并发的操作", () => {
    it("内容树里的改名在等清单时，另一窗口改名内容根本身：等前者完成，最后的清单与磁盘一致", async () => {
        const created = await scene();
        const other = await extraWindow(created, "w2");
        const release = await holdManifest(created, "lore.content");
        const inner = files(created.window).rename("project://lore.content/alice", "alicia");
        await waitUntil("前者的文件已改名", () => exists(at(created, "lore.content/alicia")));
        const outer = files(other).rename("project://lore.content", "moved.content");
        await release();
        expect(await inner).toEqual({ok: true, value: {}});
        expect(await outer).toEqual({ok: true, value: {}});
        expect(await exists(at(created, "moved.content/alicia/notes.md"))).toBe(true);
        expect(await text(at(created, "moved.content/content.xml"))).toContain(`<item name="alicia" title="爱丽丝"`);
    });

    it("复制在锁内读源条目：源正在改名、清单还没改时，复制等它完成，带上改名后的条目", async () => {
        const created = await scene();
        const other = await extraWindow(created, "w2");
        const release = await holdManifest(created, "lore.content");
        const renaming = files(created.window).rename("project://lore.content/alice", "alicia");
        await waitUntil("改名的文件已落盘", () => exists(at(created, "lore.content/alicia")));
        const copying = files(other).copy([{source: "project://lore.content/alicia", target: "project://other.content/alicia-copy"}]).result;
        await release();
        expect(await renaming).toEqual({ok: true, value: {}});
        expect(await copying).toEqual(ok([{status: "done"}]));
        expect(await text(at(created, "other.content/content.xml"))).toContain(`<item name="alicia-copy" title="爱丽丝" icon="person"/>`);
    });

    it("两个窗口同时复制到同一目标：恰好一个成功，另一个 conflict，清单里只有一条", async () => {
        const created = await scene();
        const other = await extraWindow(created, "w2");
        const results = await Promise.all([
            files(created.window).copy([{source: "project://lore.content/alice", target: "project://other.content/twin"}]).result,
            files(other).copy([{source: "project://lore.content/bob", target: "project://other.content/twin"}]).result,
        ]);
        const statuses = results.map((result) => (result.ok ? result.value.items[0]?.status : "rejected"));
        expect(statuses.sort()).toEqual(["done", "failed"]);
        expect(results.flatMap((result) => (result.ok ? result.value.items : [])).find((item) => item.status === "failed")).toMatchObject({code: "conflict"});
        expect((await text(at(created, "other.content/content.xml"))).match(/name="twin"/g)).toHaveLength(1);
    });

    it("冻结的令牌：同目标移动也先核对身份；冻结的源被移走为 source-changed", async () => {
        const created = await scene();
        const client = files(created.window);
        const identified = await client.identify(["project://plain/a.md", "project://solo.md"]);
        const tokens = identified.ok ? identified.value.items.map((item) => (item as {readonly token: string}).token) : [];
        await rename(at(created, "plain/a.md"), at(created, "plain/kept.md"));
        await writeFile(at(created, "plain/a.md"), "NEW");
        await rename(at(created, "solo.md"), at(created, "solo-moved.md"));
        expect(await client.move([
            {source: "project://plain/a.md", target: "project://plain/a.md", expected: tokens[0] as string},
            {source: "project://solo.md", target: "project://solo2.md", expected: tokens[1] as string},
        ]).result).toEqual(ok([expect.objectContaining({status: "failed", code: "source-changed"}), expect.objectContaining({status: "failed", code: "source-changed"})]));
        expect(await client.rename("project://solo.md", "x.md", {expected: tokens[1] as string})).toMatchObject({ok: false, code: "source-changed"});
        expect(await client.delete([{address: "project://solo.md", expected: tokens[1] as string}]).result).toEqual(ok([expect.objectContaining({status: "failed", code: "source-changed"})]));
    });

    // 交换可能发生在移动第一次解析目标之前，也可能在它等锁期间：没有不加产品钩子就能看到“正在等锁”的屏障，这里只验
    // 两种先后下都不会提交到根外；等锁期间的那一种由锁内重新解析目标保证（变异检查未能确定性地覆盖）。
    it("目标的父目录被换成指向根外的链接（在等操作锁前后）：不提交，根外不出现文件", async () => {
        const created = await scene();
        const outside = join(created.root, "outside");
        await mkdir(outside);
        const release = await holdManifest(created, "lore.content");
        // 前一项占着操作锁、停在清单更新；后一个窗口的移动解析完目标后等锁。
        const blocking = files(created.window).rename("project://lore.content/alice", "alicia");
        await waitUntil("前一项的文件已改名", () => exists(at(created, "lore.content/alicia")));
        const other = await extraWindow(created, "w2");
        const moving = files(other).move([{source: "project://plain/a.md", target: "project://other.content/a.md"}]).result;
        await rename(at(created, "other.content"), at(created, "kept.content"));
        await symlink(outside, at(created, "other.content"));
        await release();
        expect(await blocking).toEqual({ok: true, value: {}});
        const moved = await moving;
        expect(moved.ok && moved.value.items[0]?.status).toBe("failed");
        expect(await readdir(outside)).toEqual([]);
        expect(await text(at(created, "plain/a.md"))).toBe("PA");
    });

    it("清单更新等锁期间监视处理了一批：之后只有带来源的精确事件，没有外部回声", async () => {
        const created = await scene();
        const messages = await watching(created);
        const release = await holdManifest(created, "lore.content");
        const renaming = files(created.window).rename("project://lore.content/alice", "alicia");
        await waitUntil("改名的文件已落盘", () => exists(at(created, "lore.content/alicia")));
        // 让监视在操作完成之前处理一批：屏障文件的事件到了，改名的原始事件也已处理过。
        await writeFile(at(created, "early.md"), "E");
        await waitUntil("先到的屏障", () => {
            created.world.clock.advance(BATCH_DELAY_MS);
            return messages.some((message) => message.kind === "batch" && message.events.some((event) => event.path === "early.md"));
        });
        await release();
        expect(await renaming).toEqual({ok: true, value: {}});
        expect((await untilBarrier(created, messages)).filter((change) => change.path !== "early.md")).toEqual([
            {type: "renamed", path: "lore.content/alicia", from: "lore.content/alice", source: user},
            {type: "changed", path: "lore.content/content.xml", source: user},
        ]);
    });
});
