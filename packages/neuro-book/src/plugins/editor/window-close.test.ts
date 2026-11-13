/**
 * 桌面窗口关闭时的结算（docs/specs/workbench/editor.md 输出 66，场景 45、46 的编辑器一侧）：真实 Files 场地上的编辑器区，
 * 直接调 `closeWindow(signal)`（宿主的询问怎么调它见 web/host/close-query.test.ts）。断言回答、对话框与磁盘内容。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {shallowRef} from "@vue/reactivity";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Scene} from "nbook/plugins/files/testing/scene";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";

import {createEditorArea} from "./web/area";
import type {EditorArea} from "./web/area";
import type {AutoSaveMode, AutoSaveSettings} from "./web/auto-save";
import type {TextDocument} from "./web/documents/store";

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "window-close");
});

afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface World {
    readonly scene: Scene;
    readonly area: EditorArea;
}

async function world(mode: AutoSaveMode, project: Record<string, string> = {"a.md": "A", "b.md": "B"}): Promise<World> {
    counter += 1;
    const scene = await filesScene(join(tmp, `case-${String(counter)}`), {project});
    const settings = shallowRef<AutoSaveSettings>({mode, delay: 1000});
    const area = createEditorArea({files: files(scene.window), clock: new ManualClock(), workspaceKey: "p1", generation: 1, panels: createMemoryEditorPanels(), initial: null, autoSave: () => settings.value, report: (error) => {
        throw error;
    }});
    closers.push(async () => {
        area.dispose();
        await scene.world.close();
        await chmod(scene.project, 0o755);
        await rm(scene.root, {recursive: true, force: true});
    });
    return {scene, area};
}

async function until(at: World, description: string, check: () => boolean | Promise<boolean>): Promise<void> {
    await waitUntil(description, () => {
        at.scene.world.clock.advance(BATCH_DELAY_MS);
        return check();
    });
}

async function open(at: World, name: string): Promise<TextDocument> {
    const address = `project://${name}`;
    expect(at.area.open(address, {mode: "permanent"})).toMatchObject({ok: true});
    const group = at.area.groups.activeGroup.value;
    await until(at, `${name} 就绪`, () => at.area.binding(group)?.address.value === address);
    const document = at.area.documents.get(address);
    if (document === null) throw new Error(`${address} 没有打开`);
    return document;
}

const type = (at: World, text: string): void => {
    const binding = at.area.binding(at.area.groups.activeGroup.value);
    if (binding?.kind !== "text") throw new Error("没有文本绑定");
    expect(binding.commit(binding.revision.value, text).status).toBe("accepted");
};
const disk = (at: World, name: string): Promise<string> => readFile(join(at.scene.project, name), "utf8");

describe("Spec workbench.editor 输出 66：桌面窗口关闭时的结算", () => {
    it("没有要结算的文档：直接同意，不询问", async () => {
        const at = await world("off");
        await open(at, "a.md");
        expect(await at.area.closeWindow(new AbortController().signal)).toBe("allow");
        expect(at.area.windowDialog.value).toBeNull();
    });

    it("自动保存关着：询问；取消不同意、文档照旧；不保存只同意，不还原、不写盘", async () => {
        const at = await world("off");
        const document = await open(at, "a.md");
        type(at, "A1");
        let answer = at.area.closeWindow(new AbortController().signal);
        await until(at, "询问", () => at.area.windowDialog.value !== null);
        expect(at.area.windowDialog.value).toEqual({kind: "ask", documents: [{path: "project://a.md", problem: null, conflict: false}], more: 0, saveable: true});
        at.area.answerWindow("cancel");
        expect(await answer).toBe("deny");
        expect(at.area.windowDialog.value).toBeNull();
        expect(document.dirty.value).toBe(true);

        answer = at.area.closeWindow(new AbortController().signal);
        await until(at, "再问", () => at.area.windowDialog.value !== null);
        at.area.answerWindow("discard");
        expect(await answer).toBe("allow");
        expect(document.dirty.value).toBe(true);
        expect(await disk(at, "a.md")).toBe("A");
    });

    it("全部保存：存好才同意；存不了时换成失败说明，知道了之后不同意（场景 46）", async () => {
        const at = await world("off");
        const document = await open(at, "a.md");
        type(at, "A1");
        await chmod(at.scene.project, 0o555);
        let answer = at.area.closeWindow(new AbortController().signal);
        await until(at, "询问", () => at.area.windowDialog.value?.kind === "ask");
        at.area.answerWindow("save");
        await until(at, "失败说明", () => at.area.windowDialog.value?.kind === "failed");
        expect(at.area.windowDialog.value?.documents[0]).toMatchObject({path: "project://a.md"});
        expect(at.area.windowDialog.value?.documents[0]?.problem).not.toBeNull();
        at.area.answerWindow("cancel");
        expect(await answer).toBe("deny");
        expect(document.dirty.value).toBe(true);

        await chmod(at.scene.project, 0o755);
        answer = at.area.closeWindow(new AbortController().signal);
        await until(at, "再问", () => at.area.windowDialog.value?.kind === "ask");
        at.area.answerWindow("save");
        expect(await answer).toBe("allow");
        expect(await disk(at, "a.md")).toBe("A1");
    });

    it("开着自动保存：能存的先存好、不问；剩下有冲突的才问，且没有“全部保存”（场景 45 的编辑器一侧）", async () => {
        const at = await world("afterDelay");
        const b = await open(at, "b.md");
        type(at, "B1");
        await writeFile(join(at.scene.project, "b.md"), "外部");
        await until(at, "b 磁盘已变化", () => b.diskChanged.value);
        expect(await at.area.save()).toMatchObject({ok: false});
        expect(b.conflict.value).not.toBeNull();
        await open(at, "a.md");
        type(at, "A1");
        const answer = at.area.closeWindow(new AbortController().signal);
        await until(at, "询问", () => at.area.windowDialog.value !== null);
        expect(await disk(at, "a.md")).toBe("A1");
        expect(at.area.windowDialog.value).toEqual({kind: "ask", documents: [{path: "project://b.md", problem: null, conflict: true}], more: 0, saveable: false});
        at.area.answerWindow("cancel");
        expect(await answer).toBe("deny");
    });

    it("开着自动保存且都能存：存完同意，不询问", async () => {
        const at = await world("onWindowChange");
        await open(at, "a.md");
        type(at, "A1");
        expect(await at.area.closeWindow(new AbortController().signal)).toBe("allow");
        expect(at.area.windowDialog.value).toBeNull();
        expect(await disk(at, "a.md")).toBe("A1");
    });

    it("列出至多 5 个文件，其余写“另有 N 个”", async () => {
        const project = Object.fromEntries(Array.from({length: 7}, (_, index) => [`f${String(index)}.md`, "x"]));
        const at = await world("off", project);
        for (const name of Object.keys(project)) {
            await open(at, name);
            type(at, `${name} 改过`);
        }
        const answer = at.area.closeWindow(new AbortController().signal);
        await until(at, "询问", () => at.area.windowDialog.value !== null);
        expect(at.area.windowDialog.value?.documents).toHaveLength(5);
        expect(at.area.windowDialog.value?.more).toBe(2);
        at.area.answerWindow("cancel");
        expect(await answer).toBe("deny");
    });

    it("关标签的询问开着时来关窗询问：旧的按取消收掉、文档不被还原", async () => {
        const at = await world("off");
        const document = await open(at, "a.md");
        type(at, "A1");
        const tab = at.area.groups.activeTab()!.id;
        const closing = at.area.close(tab);
        await until(at, "关标签的询问", () => at.area.dialog.value !== null);
        const answer = at.area.closeWindow(new AbortController().signal);
        expect(await closing).toBe("cancelled");
        expect(at.area.dialog.value).toBeNull();
        await until(at, "关窗询问", () => at.area.windowDialog.value !== null);
        at.area.answerWindow("cancel");
        expect(await answer).toBe("deny");
        expect(document.dirty.value).toBe(true);
        expect(at.area.groups.activeTab()?.id).toBe(tab);
    });

    it("询问被结束（signal abort）或编辑器区释放：收起询问、不同意", async () => {
        const at = await world("off");
        await open(at, "a.md");
        type(at, "A1");
        const controller = new AbortController();
        const answer = at.area.closeWindow(controller.signal);
        await until(at, "询问", () => at.area.windowDialog.value !== null);
        controller.abort();
        expect(await answer).toBe("deny");
        expect(at.area.windowDialog.value).toBeNull();

        const again = at.area.closeWindow(new AbortController().signal);
        await until(at, "再问", () => at.area.windowDialog.value !== null);
        at.area.dispose();
        expect(await again).toBe("deny");
    });
});
