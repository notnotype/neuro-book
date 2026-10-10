/**
 * Lab 的偏好记录与 store（docs/specs/ui/component-lab.md 的“状态与转换”，验收 8、9、20、22）：真实内核、真实
 * `nbook.storage` 与 SQLite，窗口经进程内链路连到服务端。持久化字段的通用语义由 `src/shared/store/store.test.ts`
 * 覆盖，这里只测 Lab 的写法：按字段合并、恢复默认写空对象、暂停期间合并成一份、受保护记录与读取失败的呈现。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";
import {fieldProblem} from "nbook/shared/store/problem";

import {LAB_PREFERENCES_RECORD, validLabPreferences} from "./lab-preferences-store";
import type {LabStore} from "./lab-preferences-store";
import {openLab} from "./testing/lab-store";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-lab", "preferences");
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

async function read(storage: StorageService): Promise<unknown> {
    const opened = await storage.open(LAB_PREFERENCES_RECORD);
    if (!opened.ok) throw new Error(`${opened.code} ${opened.detail}`);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

/** 等队列空了；暂停（保存失败）就直接失败，不空等。 */
async function saved(store: LabStore): Promise<void> {
    await waitUntil("保存完成或暂停", () => store.state.preferences.queue === 0 || store.state.preferences.save.state !== "saving");
    expect(fieldProblem(store.state.preferences)).toBeNull();
    await waitUntil("保存完成", () => store.state.preferences.queue === 0);
}

const catalog = {themeIds: ["glass", "paper"], colorwayIds: ["nbook-dark", "nbook-light"], canvasBackdropIds: ["dots"], pageBackdropIds: ["plain", "custom"]};

describe("记录与按字段写", () => {
    it("没有记录时显示空对象、不写盘；两个窗口（不同客户端）同时改不同字段，两项都保存，另一个客户端读到同一份", async () => {
        const w = await world();
        const a = await openLab(w, "a", "client-a");
        const b = await openLab(w, "b", "client-b");
        expect(a.store.state.preferences.display).toEqual({});
        expect(await read(a.storage)).toBe("missing");

        // 两边在同一轮里提交，都以“记录不存在”为前提：后到的一方必然冲突，在新的记录上重放自己的字段。按字段合并写错时
        // （整份覆盖）这里会丢掉先到的那一项。
        a.store.actions.update({themeId: "paper"});
        b.store.actions.update({leftPanelWidth: 320});
        await Promise.all([saved(a.store), saved(b.store)]);
        expect(await read(a.storage)).toEqual({themeId: "paper", leftPanelWidth: 320});

        // shared：换一个客户端身份（换端口的开发服务就是这样）读到的仍是这一份。
        const c = await openLab(w, "c", "client-c");
        expect(c.store.state.preferences.display).toEqual({themeId: "paper", leftPanelWidth: 320});
    });

    it("恢复默认把记录写成空对象", async () => {
        const w = await world();
        const {store, storage} = await openLab(w, "w", "c");
        store.actions.update({themeId: "paper", rightCollapsed: true});
        await saved(store);
        expect(await store.actions.resetDefaults()).toBe("saved");
        expect(await read(storage)).toEqual({});
        expect(store.state.preferences.display).toEqual({});
    });
});

describe("目录核对", () => {
    it("不认识的主题与越界的宽度只丢这两项，其余字段照常生效", () => {
        expect(validLabPreferences({themeId: "gone", colorwayId: "nbook-light", leftPanelWidth: 9000, rightPanelWidth: 400, pageBackdropId: "custom", leftCollapsed: true}, catalog))
            .toEqual({colorwayId: "nbook-light", rightPanelWidth: 400, pageBackdropId: "custom", leftCollapsed: true});
    });
});

describe("坏记录与失败", () => {
    for (const [status, corrupt] of [
        ["corrupt", (db: Database) => db.query("UPDATE records SET value = ?1 WHERE owner = 'nbook.lab' AND key = 'lab.preferences'").run("{坏的")],
        ["unsupported-version", (db: Database) => db.query("UPDATE records SET version = 2 WHERE owner = 'nbook.lab' AND key = 'lab.preferences'").run()],
    ] as const) {
        it(`${status}：呈现为受保护，修改不覆盖原件；恢复默认覆盖后可以照常写`, async () => {
            const w = await world();
            const seed = await openLab(w, "seed", "c");
            seed.store.actions.update({themeId: "paper"});
            await saved(seed.store);
            const db = new Database(w.userPath);
            corrupt(db);
            db.close();

            const {store, storage} = await openLab(w, "w", "c");
            expect(fieldProblem(store.state.preferences)).toEqual({kind: "protected", code: status});
            store.actions.update({themeId: "glass"});
            await waitUntil("修改结算", () => store.state.preferences.queue === 0);
            expect(await read(storage)).toBe(status);

            expect(await store.actions.resetDefaults()).toBe("saved");
            expect(await read(storage)).toEqual({});
            expect(fieldProblem(store.state.preferences)).toBeNull();
            store.actions.update({themeId: "glass"});
            await saved(store);
            expect(await read(storage)).toEqual({themeId: "glass"});
        });
    }

    it("读取失败：呈现为没读到；库恢复后重试读到记录，读取失败期间的修改补写上去", async () => {
        const w = await world();
        const seed = await openLab(w, "seed", "c");
        seed.store.actions.update({leftPanelWidth: 300});
        await saved(seed.store);
        const rename = (from: string, to: string): void => {
            const db = new Database(w.userPath);
            db.run(`ALTER TABLE ${from} RENAME TO ${to}`);
            db.close();
        };
        rename("records", "records_away");
        const lab = await openLab(w, "w", "c", {lazy: true});
        const store = lab.create();
        await waitUntil("就绪", () => store.state.preferences.ready);
        expect(fieldProblem(store.state.preferences)).toEqual({kind: "unread", code: "io-error"});
        store.actions.update({themeId: "paper"});
        await waitUntil("暂停", () => store.state.preferences.save.state === "failed");

        rename("records_away", "records");
        await store.actions.retry();
        await saved(store);
        expect(fieldProblem(store.state.preferences)).toBeNull();
        expect(await read(lab.storage)).toEqual({leftPanelWidth: 300, themeId: "paper"});
    });

    it("断线期间的多次修改合并成一份显示；重连后重试只提交合并后的这一份", async () => {
        const w = await world();
        const {store, storage, window} = await openLab(w, "w", "c");
        window.disconnect();
        store.actions.update({themeId: "paper"});
        await waitUntil("暂停", () => fieldProblem(store.state.preferences)?.kind === "unsaved");
        store.actions.update({themeId: "glass"});
        store.actions.update({leftPanelWidth: 260});
        expect(store.state.preferences.display).toEqual({themeId: "glass", leftPanelWidth: 260});
        expect(store.state.preferences.queue).toBe(1);

        expect(await window.reconnect()).toEqual({ok: true});
        await store.actions.retry();
        await saved(store);
        expect(await read(storage)).toEqual({themeId: "glass", leftPanelWidth: 260});
    });

    it("保存暂停时恢复默认：暂停的旧修改作废，重连后重试写下空对象", async () => {
        const w = await world();
        const {store, storage, window} = await openLab(w, "w", "c");
        store.actions.update({themeId: "paper"});
        await saved(store);
        window.disconnect();
        store.actions.update({themeId: "glass"});
        await waitUntil("暂停", () => fieldProblem(store.state.preferences)?.kind === "unsaved");
        const reset = store.actions.resetDefaults();
        await waitUntil("重置也暂停", () => store.state.preferences.save.state === "failed" || store.state.preferences.save.state === "unknown");
        expect(store.state.preferences.queue).toBe(1);

        expect(await window.reconnect()).toEqual({ok: true});
        await store.actions.retry();
        await saved(store);
        expect(await read(storage)).toEqual({});
        expect(["failed", "unknown"]).toContain(await reset);
    });

    it("放弃：显示回到已保存的值，重连后不再写被放弃的修改", async () => {
        const w = await world();
        const {store, storage, window} = await openLab(w, "w", "c");
        store.actions.update({themeId: "paper"});
        await saved(store);
        window.disconnect();
        store.actions.update({themeId: "glass"});
        await waitUntil("暂停", () => fieldProblem(store.state.preferences)?.kind === "unsaved");
        store.actions.update({rightCollapsed: true});
        store.actions.discard();
        expect(store.state.preferences.display).toEqual({themeId: "paper"});
        expect(fieldProblem(store.state.preferences)).toBeNull();

        expect(await window.reconnect()).toEqual({ok: true});
        await store.actions.retry();
        expect(await read(storage)).toEqual({themeId: "paper"});
    });
});
