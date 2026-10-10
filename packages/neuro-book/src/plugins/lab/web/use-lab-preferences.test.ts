/**
 * 偏好 store 接到界面状态（docs/specs/ui/component-lab.md 的“状态与转换”，验收 8、9）：读到之前不放开界面、读到后
 * 一次性放进界面状态、地址栏指定的主题写回、只写改了的字段、拖动松手才写、恢复默认。真实 `nbook.storage` 与 SQLite。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {effectScope, nextTick, ref} from "vue";
import type {EffectScope} from "vue";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {LAB_PREFERENCES_RECORD} from "./lab-preferences-store";
import type {LabStore} from "./lab-preferences-store";
import {openLab} from "./testing/lab-store";
import {useLabPreferences} from "./use-lab-preferences";

const catalog = {themeIds: ["nbook", "macos"], colorwayIds: ["nbook-light", "nbook-dark"], canvasBackdropIds: ["panel", "checker"], pageBackdropIds: ["theme", "custom"]};
const defaults = {themeId: "nbook", colorwayId: "nbook-dark", pageBackdropId: "theme", canvasBackdropId: "panel", leftPanelWidth: 300, rightPanelWidth: 380};

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];
const scopes: EffectScope[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-lab", "use-preferences");
});

afterEach(async () => {
    for (const scope of scopes.splice(0)) scope.stop();
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world(): Promise<StorageWorld> {
    counter += 1;
    const created = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(created);
    return created;
}

async function read(storage: StorageService): Promise<unknown> {
    const opened = await storage.open(LAB_PREFERENCES_RECORD);
    if (!opened.ok) throw new Error(`${opened.code} ${opened.detail}`);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

async function idle(store: LabStore): Promise<void> {
    await nextTick();
    await waitUntil("保存完成", () => store.state.preferences.queue === 0);
}

function createState() {
    return {
        themeId: ref(""),
        colorwayId: ref(""),
        pageBackdropId: ref(""),
        canvasBackdropId: ref(""),
        leftCollapsed: ref(false),
        rightCollapsed: ref(false),
        preferredLeftCollapsed: ref(false),
        preferredRightCollapsed: ref(false),
        leftPanelWidth: ref(0),
        rightPanelWidth: ref(0),
    };
}

function bind(store: LabStore, options: {requested?: {themeId?: string; colorwayId?: string}; dragging?: () => boolean; wallpaper?: boolean; responsive?: () => void} = {}) {
    const state = createState();
    const scope = effectScope();
    scopes.push(scope);
    const preferences = scope.run(() => useLabPreferences({
        store,
        catalog,
        defaults,
        state,
        hasCustomWallpaper: () => options.wallpaper === true,
        requested: options.requested ?? {},
        dragging: options.dragging ?? (() => false),
        applyResponsiveLayout: options.responsive ?? (() => undefined),
    }))!;
    return {state, preferences};
}

async function seeded(value: object): Promise<{w: StorageWorld; storage: StorageService}> {
    const w = await world();
    const seed = await openLab(w, "seed", "c");
    const opened = await seed.storage.open(LAB_PREFERENCES_RECORD);
    if (!opened.ok) throw new Error(opened.code);
    expect(await opened.handle.save(value, {expect: null})).toMatchObject({ok: true});
    return {w, storage: seed.storage};
}

describe("读到之前与读到之后", () => {
    it("记录读到之前界面停在占位；读到后放进认识的字段，其余用默认，放进来的过程不写回", async () => {
        const {w, storage} = await seeded({themeId: "macos", colorwayId: "nbook-light", leftPanelWidth: 9000, pageBackdropId: "custom", rightCollapsed: true});
        const lab = await openLab(w, "w", "c", {lazy: true});
        const store = lab.create();
        const {state, preferences} = bind(store);
        expect(preferences.hydrating.value).toBe(true);
        await waitUntil("放进界面", () => !preferences.hydrating.value);

        expect(state.themeId.value).toBe("macos");
        expect(state.colorwayId.value).toBe("nbook-light");
        // 越界宽度回到默认；自定义桌面没有图片时回到默认桌面。
        expect(state.leftPanelWidth.value).toBe(300);
        expect(state.pageBackdropId.value).toBe("theme");
        expect(state.rightCollapsed.value).toBe(true);
        expect(state.preferredRightCollapsed.value).toBe(true);
        await idle(store);
        expect(await read(storage)).toEqual({themeId: "macos", colorwayId: "nbook-light", leftPanelWidth: 9000, pageBackdropId: "custom", rightCollapsed: true});
    });

    it("地址栏指定的主题与配色优先于记录，但不写进记录；在界面上换配色时把画面上的主题与配色一起写进去", async () => {
        const {w, storage} = await seeded({themeId: "nbook", leftPanelWidth: 320});
        const {store} = await openLab(w, "w", "c");
        let adopted = 0;
        const state = createState();
        const scope = effectScope();
        scopes.push(scope);
        const preferences = scope.run(() => useLabPreferences({
            store, catalog, defaults, state, hasCustomWallpaper: () => false,
            requested: {themeId: "macos", colorwayId: "nbook-light"},
            dragging: () => false,
            applyResponsiveLayout: () => undefined,
            onLookAdopted: () => {
                adopted += 1;
            },
        }))!;
        await waitUntil("放进界面", () => !preferences.hydrating.value);
        expect(state.themeId.value).toBe("macos");
        await idle(store);
        expect(await read(storage)).toEqual({themeId: "nbook", leftPanelWidth: 320});

        state.colorwayId.value = "nbook-dark";
        await idle(store);
        expect(await read(storage)).toEqual({themeId: "macos", colorwayId: "nbook-dark", leftPanelWidth: 320});
        expect(adopted).toBe(1);
        state.colorwayId.value = "nbook-light";
        await idle(store);
        expect(adopted).toBe(1);
        expect(await read(storage)).toEqual({themeId: "macos", colorwayId: "nbook-light", leftPanelWidth: 320});
    });
});

describe("写回", () => {
    it("只写改了的字段：另一个窗口同时改的字段保留", async () => {
        const w = await world();
        const a = await openLab(w, "a", "client-a");
        const b = await openLab(w, "b", "client-b");
        const left = bind(a.store);
        const right = bind(b.store);
        await waitUntil("放进界面", () => !left.preferences.hydrating.value && !right.preferences.hydrating.value);
        left.state.themeId.value = "macos";
        right.state.preferredLeftCollapsed.value = true;
        await Promise.all([idle(a.store), idle(b.store)]);
        expect(await read(a.storage)).toEqual({themeId: "macos", leftCollapsed: true});
    });

    it("拖动侧栏时宽度只改显示，松手才写；窄屏收起只改布局，不写偏好", async () => {
        const w = await world();
        const {store, storage} = await openLab(w, "w", "c");
        let dragging = false;
        const {state, preferences} = bind(store, {dragging: () => dragging});
        await waitUntil("放进界面", () => !preferences.hydrating.value);
        dragging = true;
        state.leftPanelWidth.value = 340;
        state.leftPanelWidth.value = 360;
        await idle(store);
        expect(await read(storage)).toBe("missing");
        dragging = false;
        preferences.commitPanelWidth("left");
        state.leftCollapsed.value = true;
        await idle(store);
        expect(await read(storage)).toEqual({leftPanelWidth: 360});
    });

    it("恢复默认：界面回到默认值，记录写成空对象", async () => {
        const {w, storage} = await seeded({themeId: "macos", rightPanelWidth: 500});
        const {store} = await openLab(w, "w", "c");
        let responsive = 0;
        const {state, preferences} = bind(store, {responsive: () => {
            responsive += 1;
        }});
        await waitUntil("放进界面", () => !preferences.hydrating.value);
        expect(responsive).toBe(1);
        await preferences.reset();
        expect(responsive).toBe(2);
        expect(state.themeId.value).toBe("nbook");
        expect(state.rightPanelWidth.value).toBe(380);
        await idle(store);
        expect(await read(storage)).toEqual({});
    });

    it("读取失败时用默认值运行；重试读到后把记录里的偏好放进界面", async () => {
        const {w} = await seeded({themeId: "macos"});
        const rename = (from: string, to: string): void => {
            const db = new Database(w.userPath);
            db.run(`ALTER TABLE ${from} RENAME TO ${to}`);
            db.close();
        };
        rename("records", "records_away");
        const lab = await openLab(w, "w", "c", {lazy: true});
        const {state, preferences} = bind(lab.create());
        await waitUntil("放进界面", () => !preferences.hydrating.value);
        expect(preferences.problem.value).toEqual({kind: "unread", code: "io-error"});
        expect(state.themeId.value).toBe("nbook");

        rename("records_away", "records");
        await preferences.retry();
        expect(preferences.problem.value).toBeNull();
        expect(state.themeId.value).toBe("macos");
    });
});
