/**
 * 编辑器的状态栏条目与两个公开键（docs/specs/workbench/editor.md 输出 26–28，场景 12–14）：真实 Files 场地上的编辑器区。
 * 光标位置由控件句柄给出；这里登记一个只带位置的句柄（产品里是源码编辑器，真实浏览器的行列由
 * `e2e/editor-area.e2e.ts` 验收）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, rm} from "node:fs/promises";
import {join} from "node:path";

import {computed, shallowRef} from "@vue/reactivity";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {BATCH_DELAY_MS} from "nbook/plugins/files/backend/changes";
import {files, filesScene} from "nbook/plugins/files/testing/scene";
import type {Scene} from "nbook/plugins/files/testing/scene";

import {createEditorArea} from "./web/area";
import type {EditorArea, EditorControlHandle} from "./web/area";
import {editorStateValues} from "./web/state";
import {CURSOR_ITEM, editorStatusItems, UNSAVED_ITEM, WORD_COUNT_ITEM} from "./web/status-items";

let tmp = "";
let counter = 0;
const closers: Array<() => Promise<void>> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "status-items");
});

afterEach(async () => {
    for (const close of closers.splice(0).reverse()) await close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world(): Promise<{scene: Scene; area: EditorArea}> {
    counter += 1;
    const scene = await filesScene(join(tmp, `case-${String(counter)}`), {project: {"a.md": "---\ntitle: 甲\n---\n第一章", "b.md": "B", "c.json": "{}"}});
    const area = createEditorArea({files: files(scene.window), clock: new ManualClock(), workspaceKey: "p1", generation: 1, initial: null, report: (error) => {
        throw error;
    }});
    closers.push(async () => {
        area.dispose();
        await scene.world.close();
        await rm(scene.root, {recursive: true, force: true});
    });
    return {scene, area};
}

async function opened(scene: Scene, area: EditorArea, address: string): Promise<void> {
    area.open(address, {mode: "permanent"});
    await waitUntil(`${address} 就绪`, () => {
        scene.world.clock.advance(BATCH_DELAY_MS);
        return area.binding(area.groups.activeGroup.value)?.document.target.value.path.endsWith(address.slice("project://".length)) === true;
    });
}

/** 在活动视图里输入：经绑定交出一份正文，与控件的输入同一条路径。 */
function type(area: EditorArea, text: string): void {
    const binding = area.binding(area.groups.activeGroup.value)!;
    expect(binding.commit(binding.document.revision.value, text).status).toBe("accepted");
}

describe("状态栏条目", () => {
    it("未保存数按文档去重并含非活动的文档；没有需要保存的文档时公开键为假", async () => {
        const {scene, area} = await world();
        const ref = shallowRef<EditorArea | null>(area);
        const keys = editorStateValues(ref);
        const items = editorStatusItems(ref, computed(() => "zh-CN" as const));
        await opened(scene, area, "project://a.md");
        expect(keys.hasUnsavedDocuments.value).toBe(false);
        type(area, "改过的第一章");
        // 同一文件拆到第二个组：仍是一份文档。
        expect(area.split("right")).toEqual({ok: true});
        await opened(scene, area, "project://b.md");
        type(area, "改过的 B");
        expect(keys.hasUnsavedDocuments.value).toBe(true);
        expect(items[UNSAVED_ITEM]!.text()).toBe("未保存 2 个");
        expect(items[UNSAVED_ITEM]!.tooltip?.().split("\n")).toEqual(["a.md", "b.md"]);
        expect(items[UNSAVED_ITEM]!.state?.()).toBe("normal");

        expect((await area.saveAll()).ok).toBe(true);
        expect(keys.hasUnsavedDocuments.value).toBe(false);
    });

    it("保存失败的文档让条目进入错误状态，提示写明是哪个文件与原因", async () => {
        const {scene, area} = await world();
        const ref = shallowRef<EditorArea | null>(area);
        const items = editorStatusItems(ref, computed(() => "zh-CN" as const));
        await opened(scene, area, "project://b.md");
        type(area, "改过的 B");
        // 目录只读：保存写不进去（原子替换要在目录里建临时文件）。
        await chmod(scene.project, 0o555);
        try {
            expect((await area.save()).ok).toBe(false);
        } finally {
            await chmod(scene.project, 0o755);
        }
        expect(items[UNSAVED_ITEM]!.state?.()).toBe("error");
        expect(items[UNSAVED_ITEM]!.tooltip?.().split("\n")[0]).toStartWith("保存失败：b.md（");
    });

    it("字数取活动文档当前的正文，frontmatter 不计，输入后随之变化；英文界面写 words", async () => {
        const {scene, area} = await world();
        const ref = shallowRef<EditorArea | null>(area);
        const locale = shallowRef<"zh-CN" | "en-US">("zh-CN");
        const items = editorStatusItems(ref, computed(() => locale.value));
        await opened(scene, area, "project://a.md");
        expect(items[WORD_COUNT_ITEM]!.text()).toBe("3 字");
        type(area, "---\ntitle: 甲\n---\n第一章 rain falls");
        expect(items[WORD_COUNT_ITEM]!.text()).toBe("5 字");
        locale.value = "en-US";
        expect(items[WORD_COUNT_ITEM]!.text()).toBe("5 words");
    });

    it("光标位置只在活动控件给出位置时有；换成不给位置的控件后公开键为假", async () => {
        const {scene, area} = await world();
        const ref = shallowRef<EditorArea | null>(area);
        const keys = editorStateValues(ref);
        const items = editorStatusItems(ref, computed(() => "zh-CN" as const));
        await opened(scene, area, "project://c.json");
        const position = shallowRef<{line: number; column: number} | null>({line: 18, column: 4});
        const withPosition: EditorControlHandle = {focus: () => undefined, flushPendingChange: () => undefined, position};
        area.registerHandle(area.groups.activeGroup.value, "code", withPosition);
        expect(keys.hasCursorPosition.value).toBe(true);
        expect(items[CURSOR_ITEM]!.text()).toBe("第 18 行，第 4 列");
        position.value = {line: 2, column: 1};
        expect(items[CURSOR_ITEM]!.text()).toBe("第 2 行，第 1 列");
        area.registerHandle(area.groups.activeGroup.value, "code", {focus: () => undefined, flushPendingChange: () => undefined});
        expect(keys.hasCursorPosition.value).toBe(false);
    });
});
