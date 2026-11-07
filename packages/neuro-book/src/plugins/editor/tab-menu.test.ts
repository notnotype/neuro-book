/**
 * 标签的右键菜单（docs/specs/workbench/editor.md 输出 57）：真实的编辑器区（Files 场地）与命令注册表。菜单作用于被右击的
 * 标签、不先激活它；编辑器自己的项不受活动标签的影响；贡献的项按后缀出现并收到这个标签的地址；标签关闭、换组、换编辑器时
 * 菜单身份随之变化。剪贴板是收文字的接收端（Bun 里没有浏览器剪贴板）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {Type} from "typebox";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {contextTable} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";

import type {EditorTabContextItemDeclaration} from "./shared/contracts";
import {createEditorArea} from "./web/area";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";
import type {EditorArea} from "./web/area";
import {copyTabPath} from "./web/commands";
import {createEditorTabMenu} from "./web/tab-menu";
import type {TabMenuEntry} from "./web/tab-menu";
import {diagnosticText} from "nbook/shared/localized-text";
import {testTextPort} from "nbook/shared/testing/text-port";
import {editorText} from "./shared/text";
import type {EditorTextKey} from "./shared/text";
import {editorCatalogs} from "./web/text";

/** 窗口同款的翻译端口，登记了编辑器的目录（严格模式：缺键直接抛错）；断言里的界面文字经它从目录取。 */
const zh = testTextPort("zh-CN", {"nbook.editor": editorCatalogs});
const shown = (key: EditorTextKey): string => zh.t(editorText(key));

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "tab-menu");
});
afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const REVEAL = "nbook.files.reveal";
const ACME = "nbook.editor.count-test";

async function world(items: ReadonlyArray<{readonly id: string; readonly declaration: EditorTabContextItemDeclaration}> = [], revealReady = true) {
    counter += 1;
    const scene = await filesScene(join(tmp, `case-${String(counter)}`), {project: {"notes/a.md": "A", "b.md": "B", "c.md": "C"}});
    const area: EditorArea = createEditorArea({files: files(scene.window), clock: new ManualClock(), panels: createMemoryEditorPanels(), workspaceKey: "p1", generation: 1, initial: null, report: (error) => {
        throw error;
    }});
    closers.push(async () => {
        area.dispose();
        await scene.world.close();
        await rm(scene.root, {recursive: true, force: true});
    });
    const calls: Array<[string, unknown]> = [];
    const commands = createCommandRegistry({contextKeys: contextTable({"test.explorer/ready": "资源管理器还没就绪"}, () => ({"test.explorer/ready": revealReady})), report: () => undefined});
    for (const [id, when] of [[REVEAL, {requires: ["test.explorer/ready"]}], [ACME, undefined]] as const) {
        const registered = commands.register({
            id,
            source: "nbook.test",
            declaration: {title: {"zh-CN": id, "en-US": id}, description: "test", args: Type.Object({address: Type.Optional(Type.String())}, {additionalProperties: false}), effect: "read", ...(when === undefined ? {} : {when})},
            run: (args) => {
                calls.push([id, args]);
                return {ok: true, value: null};
            },
        });
        if (!registered.ok) throw new Error(registered.reason);
    }
    const clipboard: string[] = [];
    const reports: string[] = [];
    const menu = createEditorTabMenu({
        area: () => area,
        commands,
        state: {read: () => ({status: "undeclared"})},
        items: () => items,
        platform: "other",
        copy: (tab, relative) => copyTabPath({files: files(scene.window), clipboard: {writeText: async (text) => {
            clipboard.push(text);
        }}}, tab, relative),
        report: (action, reason) => reports.push(`${action}：${reason}`),
    });
    const until = (description: string, check: () => boolean) => waitUntil(description, () => {
        scene.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
    return {scene, area, menu, calls, clipboard, reports, until};
}

const labels = (entries: ReadonlyArray<TabMenuEntry> | null): string[] => (entries ?? []).map((entry) => (entry.kind === "separator" ? "---" : `${entry.label}${entry.disabled ? "（禁用）" : ""}`));
const tabOf = (area: EditorArea, address: string): string => area.groups.groups.value.flatMap((group) => group.tabs).find((tab) => tab.address === address)?.id ?? "";

describe("Spec workbench.editor 输出 57：标签的右键菜单", () => {
    it("文件标签与页面标签的项；固定的换成取消固定；贡献的项按后缀出现在后面；资源管理器没就绪时“在资源管理器中显示”禁用", async () => {
        const {area, menu} = await world([{id: "acme.count", declaration: {section: "1", command: ACME, extensions: [".md"], context: "resource"}}], false);
        area.open("project://b.md", {mode: "permanent"});
        const b = tabOf(area, "project://b.md");
        expect(labels(menu.entries(b, zh))).toEqual([shown("tabMenu.close"), shown("tabMenu.closeOthers"), shown("tabMenu.closeToRight"), shown("tabMenu.closeSaved"), "---", shown("tabMenu.pin"), "---", shown("tabMenu.splitRight"), shown("tabMenu.splitDown"), "---", shown("tabMenu.float"), "---", shown("tabMenu.copyPath"), shown("tabMenu.copyRelativePath"), `${shown("tabMenu.reveal")}（禁用）`, "---", ACME]);
        area.setPinned(b, true);
        expect(labels(menu.entries(b, zh))).toContain(shown("tabMenu.unpin"));
        const page = area.openPage("nbook.projects.welcome");
        if (!page.ok) throw new Error(diagnosticText(page.reason));
        expect(labels(menu.entries(page.tabId, zh))).toEqual([shown("tabMenu.close"), shown("tabMenu.closeOthers"), shown("tabMenu.closeToRight"), shown("tabMenu.closeSaved"), "---", shown("tabMenu.float")]);
    });

    it("作用于被右击的标签、不先激活它：活动的是另一组里的页面时，右击 B 拆分、复制路径、贡献的项都作用于 B", async () => {
        const {scene, area, menu, calls, clipboard, until} = await world([{id: "acme.count", declaration: {section: "1", command: ACME, context: "resource"}}]);
        area.open("project://notes/a.md", {mode: "permanent"});
        area.open("project://b.md", {mode: "permanent"});
        const a = tabOf(area, "project://notes/a.md");
        expect(area.split("right")).toEqual({ok: true});
        const page = area.openPage("nbook.projects.welcome");
        if (!page.ok) throw new Error(diagnosticText(page.reason));
        menu.run(a, "own:copy-relative-path");
        menu.run(a, "own:copy-path");
        menu.run(a, "acme.count");
        await until("复制完", () => clipboard.length === 2);
        expect(clipboard).toEqual(["notes/a.md", join(scene.project, "notes/a.md")]);
        expect(calls).toEqual([[ACME, {address: "project://notes/a.md"}]]);
        expect(area.groups.activeTab()?.id).toBe(page.tabId);
        menu.run(a, "own:split-down");
        await until("拆出新组", () => area.groups.groups.value.length === 3);
    });

    it("关闭其他作用于被右击的标签所在的组；菜单身份在标签移到别的组、换编辑器、关闭后变化", async () => {
        const {area, menu, until} = await world();
        for (const name of ["b", "c"]) area.open(`project://${name}.md`, {mode: "permanent"});
        area.open("project://notes/a.md", {mode: "permanent", group: "side"});
        const b = tabOf(area, "project://b.md");
        menu.run(b, "own:close-others");
        await until("c 关掉", () => tabOf(area, "project://c.md") === "");
        expect(area.groups.groups.value.map((group) => group.tabs.map((tab) => tab.address))).toEqual([["project://b.md"], ["project://notes/a.md"]]);
        const before = menu.identity(b);
        expect(await area.moveTab(b, {group: area.groups.groups.value[1]?.id ?? "", partition: "normal", before: null})).toEqual({ok: true});
        expect(menu.identity(b)).not.toBe(before);
        const moved = menu.identity(b);
        expect(area.reopenWith("nbook.editor.code")).toEqual({ok: true});
        expect(menu.identity(b)).not.toBe(moved);
        expect(await area.close(b)).toBe("closed");
        expect(menu.identity(b)).toBeNull();
        expect(menu.entries(b, zh)).toBeNull();
    });
});
