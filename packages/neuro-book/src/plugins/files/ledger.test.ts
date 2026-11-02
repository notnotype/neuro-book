/**
 * 记账槽（docs/specs/workspace/resources.md 的“记账槽”、验收 14）：服务端实例是真实的（配置的多实例场地，注入时钟），
 * 测试插件 `nbook.test-ledger` 贡献记账者，`x.writer` 经写入接口写 `user://`，窗口经浏览器合同保存。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm, writeFile, mkdir} from "node:fs/promises";
import {join} from "node:path";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import {filesBackendPlugin} from "./backend/plugin";
import {LEDGER_TIMEOUT_MS} from "./backend/ledger-slot";
import {descriptor} from "./plugin";
import {LEDGER_POINT} from "./shared/ledger";
import type {Ledger, LedgerEntry} from "./shared/ledger";
import {workspaceFilesKey} from "./shared/workspace-files";
import type {WorkspaceFiles} from "./shared/workspace-files";
import {files, hash, probe, probePlugin} from "./testing/scene";
import {filesBrowserPlugin} from "./web/plugin";

let tmp = "";
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "ledger");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 记账者的行为由用例改：正常收下、抛错、或永不完成（忽略 `signal`）。 */
interface Recorder {
    readonly entries: LedgerEntry[];
    mode: "ok" | "throw" | "hang";
}

function ledgerPlugin(recorder: Recorder): PluginDefinition {
    const ledger: Ledger = {
        record: async (entry) => {
            if (recorder.mode === "throw") throw new Error("账本坏了");
            if (recorder.mode === "hang") return new Promise<void>(() => undefined);
            recorder.entries.push(entry);
        },
    };
    return {id: "nbook.test-ledger", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        contributions: [{capability: LEDGER_POINT, id: "nbook.test-ledger", declaration: {}}],
        activate: () => ({contributions: {[LEDGER_POINT]: {"nbook.test-ledger": ledger}}}),
    })]};
}

function writerPlugin(holder: {files: WorkspaceFiles | null}): PluginDefinition {
    return {id: "x.writer", entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        dependencies: [{key: workspaceFilesKey}],
        activate: (context) => {
            holder.files = context.services.require(workspaceFilesKey);
            return {};
        },
    })]};
}

async function scene(recorder: Recorder | null) {
    const root = join(tmp, String(worlds.length));
    await mkdir(join(root, "state", "user"), {recursive: true});
    const writer: {files: WorkspaceFiles | null} = {files: null};
    const world = await settingsWorld(root, [definitionAt("server", descriptor, filesBackendPlugin), writerPlugin(writer), ...(recorder === null ? [] : [ledgerPlugin(recorder)])]);
    worlds.push(world);
    const window = probe();
    await world.window("w1", [definitionAt("browser", descriptor, filesBrowserPlugin), probePlugin("x.explorer", "browser", window)], {bound: false});
    const user = join(root, "state", "user");
    return {world, user, workspace: writer.files as WorkspaceFiles, browser: files(window)};
}

const events = (world: SettingsWorld, name: string) => world.diagnostics("hub").query({}).records.filter((record) => record.event === name);

describe("记账槽", () => {
    it("验收 14：提交与浏览器保存都把改前改后、来源、组与递增的序号交给记账者", async () => {
        const recorder: Recorder = {entries: [], mode: "ok"};
        const {workspace, browser, user} = await scene(recorder);
        await workspace.group({title: "建笔记"}, (g) => g.write("user://a.md", "一", {expect: "absent"}));
        expect(await workspace.write("user://a.md", "二", {expect: {hash: hash("一")}})).toMatchObject({ok: true});
        const read = await browser.read("user://a.md");
        if (!read.ok) throw new Error(read.code);
        expect(await browser.write("user://a.md", "三", read.value.baseline)).toMatchObject({ok: true});
        expect(await readFile(join(user, "a.md"), "utf8")).toBe("三");

        const decode = (bytes: Uint8Array | null | undefined): string | null => (bytes == null ? null : new TextDecoder().decode(bytes));
        expect(recorder.entries.map((entry) => ({op: entry.op, path: entry.path, root: entry.root, before: decode(entry.before?.bytes), after: decode(entry.after.bytes), hash: entry.after.hash, source: entry.source.kind, group: entry.group?.title}))).toEqual([
            {op: "created", path: "a.md", root: "user", before: null, after: "一", hash: hash("一"), source: "system", group: "建笔记"},
            {op: "write", path: "a.md", root: "user", before: "一", after: "二", hash: hash("二"), source: "system", group: undefined},
            {op: "write", path: "a.md", root: "user", before: "二", after: "三", hash: hash("三"), source: "user", group: undefined},
        ]);
        const seqs = recorder.entries.map((entry) => entry.seq);
        expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
        expect(new Set(seqs).size).toBe(3);
    });

    it("记账者抛错：写入照常成功，有诊断", async () => {
        const recorder: Recorder = {entries: [], mode: "throw"};
        const {world, workspace, user} = await scene(recorder);
        expect(await workspace.write("user://b.md", "内容", {expect: "absent"})).toMatchObject({ok: true});
        expect(await readFile(join(user, "b.md"), "utf8")).toBe("内容");
        expect(events(world, "files.ledger.failed")).toHaveLength(1);
    });

    it("记账者一直不完成：超过 2 秒不再等，写入成功、有诊断", async () => {
        const recorder: Recorder = {entries: [], mode: "hang"};
        const {world, workspace, user} = await scene(recorder);
        const pending = workspace.write("user://c.md", "内容", {expect: "absent"});
        // 提交走到锁内成功阶段时文件已经在了；这时推进注入的时钟让超时到点。
        await waitUntil("已经放到位", async () => (await readFile(join(user, "c.md"), "utf8").catch(() => null)) === "内容");
        world.clock.advance(LEDGER_TIMEOUT_MS);
        expect(await pending).toMatchObject({ok: true});
        expect(events(world, "files.ledger.timeout")).toHaveLength(1);
    });

    it("没有记账者：写入照常", async () => {
        const {workspace, user} = await scene(null);
        await writeFile(join(user, "d.md"), "旧");
        expect(await workspace.write("user://d.md", "新", {expect: {hash: hash("旧")}})).toMatchObject({ok: true});
    });
});
