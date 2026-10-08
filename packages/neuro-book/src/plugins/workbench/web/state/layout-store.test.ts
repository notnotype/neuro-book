/**
 * 工作台布局 store（docs/specs/ui/workbench-shell.md 外壳一输出 7、13、14，“状态与转换”，验收 4、5、7–10）：真实内核、
 * 真实 `nbook.storage` 与 SQLite，窗口经进程内链路连到服务端。持久化字段的通用语义（冲突重放、结果不确定、受保护
 * 记录）由 `src/shared/store/store.test.ts` 覆盖，这里只测布局特有的写法与组合。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {Value} from "typebox/value";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {RecordDefinition, StorageService} from "nbook/shared/storage";

import type {ShellLayoutFacts} from "../shell/sizes";
import {PANEL_ALIGNMENTS, PANEL_POSITIONS} from "../shell/panel-state";
import {openLayout} from "../testing/layout";
import type {LayoutStore} from "./layout-store";
import {LAYOUT_RECORDS} from "./records";

/** 布局记录所在的命名空间（工作台的插件 id）。 */
const PLUGIN = "nbook.workbench";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "layout-store");
});

afterEach(async () => {
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

async function read<T>(storage: StorageService, record: RecordDefinition<T>): Promise<unknown> {
    const opened = await storage.open(record);
    if (!opened.ok) throw new Error(`${opened.code} ${opened.detail}`);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

/** 等三条记录的队列都空了；有记录暂停（保存失败）就直接失败，不空等。 */
async function saved(store: LayoutStore): Promise<void> {
    const names = ["side", "panelSize", "customizations"] as const;
    await waitUntil("保存完成或暂停", () => names.every((name) => store.state[name].queue === 0 || store.state[name].save.state === "failed" || store.state[name].save.state === "unknown"));
    expect(store.state.problems.filter((problem) => problem.kind === "unsaved")).toEqual([]);
}

function facts(mode: "split" | "compact", maximized: boolean): ShellLayoutFacts {
    return {extent: {width: mode === "split" ? 1440 : 390, height: 900}, mode, effectivePanel: {position: "bottom", alignment: mode === "split" ? "center" : "justify", collapsed: false, maximized}, issues: []};
}

describe("默认、按字段写与同值", () => {
    it("记录不存在时显示默认、不写盘；记录的取值域与外壳的常量表一致", async () => {
        const w = await world();
        const {store, storage} = await openLayout(w, "w", "c");
        expect(store.state.sizes).toEqual({sidebarWidth: 340, auxiliarybarWidth: 400, panelHeight: 200, panelWidth: 320});
        expect(store.state.panel).toEqual({position: "bottom", alignment: "center", hidden: false, collapsed: false, maximized: false});
        expect(store.state.hiddenParts).toEqual([]);
        expect(store.state.problems).toEqual([]);
        expect(await read(storage, LAYOUT_RECORDS.user.side)).toBe("missing");
        expect(await read(storage, LAYOUT_RECORDS.user.panelSize)).toBe("missing");
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toBe("missing");

        const schema = LAYOUT_RECORDS.user.customizations.schema;
        for (const position of PANEL_POSITIONS) expect(Value.Check(schema, {panel: {position}})).toBe(true);
        for (const alignment of PANEL_ALIGNMENTS) expect(Value.Check(schema, {panel: {alignment}})).toBe(true);
        expect(Value.Check(schema, {panel: {position: "middle"}})).toBe(false);
    });

    it("面板 action 只写自己的字段；同值不写；显示面板同时清除收起；左右位置不能收起", async () => {
        const w = await world();
        const {store, storage} = await openLayout(w, "w", "c");
        expect(store.actions.setPanelPosition("top")).toBe(true);
        await saved(store);
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toEqual({panel: {position: "top"}});
        const revision = store.state.customizations.base?.revision;
        expect(store.actions.setPanelPosition("top")).toBe(false);
        expect(store.state.customizations.queue).toBe(0);
        expect(store.state.customizations.base?.revision).toBe(revision);

        store.actions.setPanelCollapsed(true);
        store.actions.setPanelHidden(true);
        expect(store.actions.setPanelHidden(false)).toBe(true);
        await saved(store);
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toEqual({panel: {position: "top", collapsed: false, hidden: false}});

        store.actions.setPanelPosition("left");
        expect(store.actions.setPanelCollapsed(true)).toBe(false);
        expect(store.actions.setPanelPosition("middle" as "left")).toBe(false);
    });

    it("Part 显隐只增删这一个 Part；尺寸补丁只写变了的字段、按记录各提交一次；拖到零只写布尔位", async () => {
        const w = await world();
        const {store, storage} = await openLayout(w, "w", "c");
        store.actions.setPartHidden("sidebar", true);
        store.actions.setPartHidden("titlebar", true);
        expect(store.actions.setPartHidden("sidebar", true)).toBe(false);
        store.actions.setPartHidden("sidebar", false);
        store.actions.commitSizes({sidebarWidth: 300, panelHeight: 200});
        store.actions.commitSizes({panelHeight: 9000, dragCollapsed: {auxiliarybar: true}});
        await saved(store);
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toEqual({hiddenParts: ["titlebar"], dragCollapsed: {auxiliarybar: true}});
        expect(await read(storage, LAYOUT_RECORDS.user.side)).toEqual({sidebarWidth: 300});
        // 200 与默认相同不写；9000 夹到上限 600。
        expect(await read(storage, LAYOUT_RECORDS.user.panelSize)).toEqual({panelHeight: 600});
        expect(store.state.sizes).toMatchObject({sidebarWidth: 300, panelHeight: 600});
    });
});

describe("瞬时最大化与呈现事实", () => {
    it("最大化只在内存；换位置、隐藏时清除；进入紧凑的事实清除且回到宽屏不复活；紧凑时不能最大化；事实不写记录", async () => {
        const w = await world();
        const {store, storage} = await openLayout(w, "w", "c");
        store.actions.acceptLayoutFacts(facts("split", false));
        expect(store.actions.togglePanelMaximized()).toBe(true);
        expect(store.state.panel.maximized).toBe(true);
        store.actions.setPanelPosition("right");
        expect(store.state.panel.maximized).toBe(false);

        store.actions.togglePanelMaximized();
        store.actions.acceptLayoutFacts(facts("split", true));
        store.actions.acceptLayoutFacts(facts("compact", false));
        expect(store.state.panel.maximized).toBe(false);
        store.actions.acceptLayoutFacts(facts("split", false));
        expect(store.state.panel.maximized).toBe(false);
        store.actions.acceptLayoutFacts(facts("compact", false));
        expect(store.actions.togglePanelMaximized()).toBe(false);
        await saved(store);
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toEqual({panel: {position: "right"}});

        // 不合法的组合不能最大化；收起着的水平面板最大化时先展开。
        store.actions.acceptLayoutFacts(facts("split", false));
        store.actions.setPanelPosition("bottom");
        store.actions.setPanelAlignment("justify");
        expect(store.actions.togglePanelMaximized()).toBe(false);
        store.actions.setPanelAlignment("center");
        store.actions.setPanelCollapsed(true);
        expect(store.actions.togglePanelMaximized()).toBe(true);
        expect(store.state.panel).toMatchObject({collapsed: false, maximized: true});
    });
});

describe("最大化的每一种清除与显示面板", () => {
    it("改位置、改对齐、隐藏、收起、进入紧凑都清除最大化；回到可最大化的组合也不复活", async () => {
        const w = await world();
        const {store} = await openLayout(w, "w", "c");
        store.actions.acceptLayoutFacts(facts("split", false));
        const changes: ReadonlyArray<[string, () => void]> = [
            ["位置", () => store.actions.setPanelPosition("left")],
            ["对齐", () => store.actions.setPanelAlignment("justify")],
            ["隐藏", () => store.actions.setPanelHidden(true)],
            ["收起", () => store.actions.setPanelCollapsed(true)],
            ["紧凑", () => store.actions.acceptLayoutFacts(facts("compact", false))],
        ];
        for (const [name, change] of changes) {
            store.actions.setPanelPosition("bottom");
            store.actions.setPanelAlignment("center");
            store.actions.setPanelHidden(false);
            store.actions.acceptLayoutFacts(facts("split", false));
            expect(store.actions.togglePanelMaximized(), name).toBe(true);
            change();
            expect(store.state.panel.maximized, name).toBe(false);
            store.actions.setPanelPosition("bottom");
            store.actions.setPanelAlignment("center");
            store.actions.setPanelHidden(false);
            store.actions.acceptLayoutFacts(facts("split", false));
            expect(store.state.panel.maximized, `${name}之后回到底部居中`).toBe(false);
        }
    });

    it("显示面板同时清除隐藏、收起与拖到零，一次写入；面板只是拖到零时也能显示", async () => {
        const w = await world();
        const {store, storage} = await openLayout(w, "w", "c");
        store.actions.commitSizes({dragCollapsed: {panel: true}});
        await saved(store);
        expect(store.actions.setPanelHidden(false)).toBe(true);
        await saved(store);
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toEqual({panel: {hidden: false, collapsed: false}, dragCollapsed: {panel: false}});
        expect(store.actions.setPanelHidden(false)).toBe(false);
    });
});

describe("多窗口与分区", () => {
    it("同一客户端两个窗口：A 改位置、B 改对齐，两项都保留；各改一个 Part 都保留；同一字段后写胜出；对方的修改不强改本窗口显示", async () => {
        const w = await world();
        const a = await openLayout(w, "a", "c");
        const b = await openLayout(w, "b", "c");
        // 两边在同一轮各改一个字段：后到的冲突一次，在最新值上重放。
        a.store.actions.setPanelPosition("top");
        b.store.actions.setPanelAlignment("justify");
        await Promise.all([saved(a.store), saved(b.store)]);
        a.store.actions.setPartHidden("titlebar", true);
        b.store.actions.setPartHidden("activitybar", true);
        await Promise.all([saved(a.store), saved(b.store)]);
        const value = await read(a.storage, LAYOUT_RECORDS.user.customizations) as {panel: unknown; hiddenParts: string[]};
        expect(value.panel).toEqual({position: "top", alignment: "justify"});
        expect([...value.hiddenParts].sort()).toEqual(["activitybar", "titlebar"]);
        expect(a.store.state.panel.alignment).toBe("center");

        a.store.actions.setPanelPosition("left");
        await saved(a.store);
        b.store.actions.setPanelPosition("right");
        await saved(b.store);
        expect(await read(a.storage, LAYOUT_RECORDS.user.customizations)).toMatchObject({panel: {position: "right", alignment: "justify"}});
    });

    it("绑定项目的窗口尺寸写 project 分区，未绑定的写 user 分区，互不影响；面板与 Part 状态都在 user 分区", async () => {
        const w = await world();
        await w.project(1, []);
        const bound = await openLayout(w, "bound", "c", true);
        const free = await openLayout(w, "free", "c");
        bound.store.actions.commitSizes({sidebarWidth: 200});
        free.store.actions.commitSizes({sidebarWidth: 500});
        bound.store.actions.setPanelPosition("top");
        await Promise.all([saved(bound.store), saved(free.store)]);
        expect(await read(bound.storage, LAYOUT_RECORDS.project.side)).toEqual({sidebarWidth: 200});
        expect(await read(free.storage, LAYOUT_RECORDS.user.side)).toEqual({sidebarWidth: 500});
        expect(await read(free.storage, LAYOUT_RECORDS.user.customizations)).toEqual({panel: {position: "top"}});
    });
});

describe("坏记录与保存失败", () => {
    it("用户定制记录损坏：按默认显示、给出问题、修改不保存也不覆盖原件；尺寸记录照常保存", async () => {
        const w = await world();
        const seed = await openLayout(w, "seed", "c");
        seed.store.actions.setPanelPosition("top");
        await saved(seed.store);
        const db = new Database(w.userPath);
        db.query("UPDATE records SET value = ?1 WHERE owner = ?2 AND key = 'views-customizations'").run("{坏的", PLUGIN);
        db.close();

        const {store, storage} = await openLayout(w, "w", "c");
        expect(store.state.panel.position).toBe("bottom");
        expect(store.state.problems).toEqual([{record: "customizations", kind: "unread", code: "corrupt"}]);
        store.actions.setPanelPosition("left");
        store.actions.commitSizes({sidebarWidth: 250});
        await saved(store);
        expect(store.state.panel.position).toBe("bottom");
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toBe("corrupt");
        expect(await read(storage, LAYOUT_RECORDS.user.side)).toEqual({sidebarWidth: 250});
    });

    it("放弃丢掉这条记录暂停与排队的全部修改：显示回到已确认值，重连后也不保存被放弃的修改", async () => {
        const w = await world();
        const {store, storage, window} = await openLayout(w, "w", "c");
        store.actions.commitSizes({sidebarWidth: 300});
        await saved(store);
        window.disconnect();
        store.actions.commitSizes({sidebarWidth: 250});
        store.actions.commitSizes({sidebarWidth: 200});
        await waitUntil("暂停", () => store.state.problems.some((problem) => problem.record === "side" && problem.kind === "unsaved"));
        expect(store.state.side.queue).toBe(2);
        expect(store.actions.discard("side")).toBe("discarded");
        expect(store.state.side.queue).toBe(0);
        expect(store.state.sizes.sidebarWidth).toBe(300);
        expect(await window.reconnect()).toEqual({ok: true});
        expect(await store.actions.retry("side")).toBe("nothing");
        expect(await read(storage, LAYOUT_RECORDS.user.side)).toEqual({sidebarWidth: 300});
    });

    it("记录版本不支持：按默认显示、给出问题、修改不保存也不覆盖原件", async () => {
        const w = await world();
        const seed = await openLayout(w, "seed", "c");
        seed.store.actions.commitSizes({panelHeight: 300});
        await saved(seed.store);
        const db = new Database(w.userPath);
        db.query("UPDATE records SET version = 2 WHERE owner = ?1 AND key = 'layout-sizes-panel'").run(PLUGIN);
        db.close();
        const {store, storage} = await openLayout(w, "w", "c");
        expect(store.state.sizes.panelHeight).toBe(200);
        expect(store.state.problems).toEqual([{record: "panelSize", kind: "unread", code: "unsupported-version"}]);
        store.actions.commitSizes({panelHeight: 400});
        await saved(store);
        expect(await read(storage, LAYOUT_RECORDS.user.panelSize)).toBe("unsupported-version");
    });

    it("项目分区写不进去而用户分区正常：只有尺寸记录暂停，定制照常保存；库恢复后只重试失败的那条", async () => {
        const w = await world();
        await w.project(1, []);
        const {store, storage} = await openLayout(w, "w", "c", true);
        const rename = (from: string, to: string): void => {
            const db = new Database(w.projectPath);
            db.run(`ALTER TABLE ${from} RENAME TO ${to}`);
            db.close();
        };
        rename("records", "records_away");
        store.actions.commitSizes({sidebarWidth: 250});
        store.actions.setPanelPosition("top");
        await waitUntil("尺寸暂停、定制保存", () => store.state.side.save.state === "failed" && store.state.customizations.queue === 0);
        expect(store.state.problems.map((problem) => [problem.record, problem.kind])).toEqual([["side", "unsaved"]]);
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toEqual({panel: {position: "top"}});
        rename("records_away", "records");
        expect(await store.actions.retry("side")).toBe("saved");
        expect(await read(storage, LAYOUT_RECORDS.project.side)).toEqual({sidebarWidth: 250});
        expect(store.state.problems).toEqual([]);
    });

    it("断线时的修改暂停并显示未保存，显示保留修改；重连后 retry 补上；discard 回到已确认值", async () => {
        const w = await world();
        const {store, storage, window} = await openLayout(w, "w", "c");
        window.disconnect();
        store.actions.setPanelPosition("top");
        store.actions.commitSizes({sidebarWidth: 250});
        await waitUntil("两条都暂停", () => store.state.problems.filter((problem) => problem.kind === "unsaved").length === 2);
        expect(store.state.problems.map((problem) => problem.record).sort()).toEqual(["customizations", "side"]);
        expect(store.state.panel.position).toBe("top");
        expect(store.state.sizes.sidebarWidth).toBe(250);

        expect(await window.reconnect()).toEqual({ok: true});
        expect(await store.actions.retry("customizations")).toBe("saved");
        expect(await read(storage, LAYOUT_RECORDS.user.customizations)).toEqual({panel: {position: "top"}});
        expect(store.actions.discard("side")).toBe("discarded");
        expect(store.state.sizes.sidebarWidth).toBe(340);
        expect(store.state.problems).toEqual([]);
        expect(await read(storage, LAYOUT_RECORDS.user.side)).toBe("missing");
    });

    it("读不到记录：按默认显示并给出问题，修改暂停；库恢复后 retry 先重新打开、拿到基线再补上", async () => {
        const w = await world();
        const seed = await openLayout(w, "seed", "c");
        seed.store.actions.commitSizes({panelHeight: 300});
        await saved(seed.store);
        const rename = (from: string, to: string): void => {
            const db = new Database(w.userPath);
            db.run(`ALTER TABLE ${from} RENAME TO ${to}`);
            db.close();
        };
        rename("records", "records_away");
        const {store, storage} = await openLayout(w, "w", "c");
        expect(store.state.sizes.panelHeight).toBe(200);
        expect(store.state.problems).toContainEqual({record: "panelSize", kind: "unread", code: "io-error"});
        store.actions.commitSizes({panelWidth: 400});
        await waitUntil("修改暂停", () => store.state.panelSize.save.state === "failed");

        rename("records_away", "records");
        expect(await store.actions.retry("panelSize")).toBe("saved");
        expect(await read(storage, LAYOUT_RECORDS.user.panelSize)).toEqual({panelHeight: 300, panelWidth: 400});
    });
});
