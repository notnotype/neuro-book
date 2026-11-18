/**
 * 首次启动向导的宿主（web/first-run.ts，docs/specs/runtime/desktop-shell.md 输出 34）。记录走真实的存储场地：服务端实例装
 * Storage 与一个 `nbook.desktop` 的写者，浏览器窗口里激活向导的宿主，帧经 JSON 编解码。配置服务、命令与壳的端口是照合同写的
 * 替身：配置服务的 `get`、`inspect` 是响应式的（与真实实例一样在 computed 里重新求值），命令与写入的结果由用例给。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {reactive, ref} from "vue";
import {Type} from "typebox";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {InstallFacts} from "nbook/shared/desktop-bridge";
import type {WindowDesktop} from "nbook/shared/host";
import type {SettingDefinition, SettingsService, SettingWriteResult} from "nbook/shared/settings";
import {defineRecord} from "nbook/shared/storage";
import type {StorageService} from "nbook/shared/storage";

import {DESKTOP_PLUGIN} from "./shared/contracts";
import {createFirstRun, FIRST_RUN_RECORD, firstRunStore} from "./web/first-run";
import type {FirstRun, FirstRunOptions, RevealOutcome} from "./web/first-run";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop", "first-run");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 配置服务的替身：值与用户层状态都在响应式对象里；`update` 的结果由 `nextWrite` 给，成功时改值。 */
function fakeSettings() {
    const values = reactive<Record<string, unknown>>({});
    const layer = ref<"ok" | "unavailable" | "invalid">("ok");
    let nextWrite: SettingWriteResult = {ok: true} as SettingWriteResult;
    const writes: Array<[string, unknown]> = [];
    const service = {
        get: (setting: SettingDefinition<unknown>) => (setting.key in values ? values[setting.key] : setting.declaration.default),
        inspect: () => ({user: {status: layer.value}}),
        update: async (setting: SettingDefinition<unknown>, value: unknown) => {
            writes.push([setting.key, value]);
            if (nextWrite.ok) values[setting.key] = value;
            return nextWrite;
        },
    } as unknown as SettingsService;
    return {service, values, layer, writes, failNext(result: SettingWriteResult) {
        nextWrite = result;
    }};
}

function fakeDesktop(facts: InstallFacts | null) {
    const listeners = new Set<(facts: InstallFacts) => void>();
    let current = facts;
    let opened = 0;
    const desktop: WindowDesktop = {
        available: true,
        reportSettings: () => undefined,
        facts: () => current,
        onFacts: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        openStateRoot: () => {
            opened += 1;
        },
    };
    return {desktop, opened: () => opened, deliver(next: InstallFacts) {
        current = next;
        for (const listener of listeners) listener(next);
    }};
}

interface Harness {
    readonly firstRun: FirstRun;
    readonly settings: ReturnType<typeof fakeSettings>;
    readonly desktop: ReturnType<typeof fakeDesktop>;
    readonly commands: Array<{readonly id: string; readonly args: unknown; settle(result: {ok: true; value: undefined} | {ok: false; code: string; reason: string}): void}>;
    readonly reports: string[];
    readonly server: () => StorageService;
    /** 记录读到了（不论有没有）：用来证明“没打开”不是因为还没读完。 */
    readonly ready: () => boolean;
    readonly failure: () => string | null;
}

/** 起场地：服务端有 `nbook.desktop` 的写者（另一个窗口或进程写记录用），浏览器窗口里激活向导的宿主。 */
async function harness(options: {readonly before?: (server: StorageService) => Promise<void>; readonly layer?: "ok" | "unavailable"; readonly reveal?: RevealOutcome; readonly facts?: InstallFacts | null} = {}): Promise<Harness> {
    counter += 1;
    let serverStorage: StorageService | null = null;
    const writer: PluginDefinition = {id: DESKTOP_PLUGIN, entries: [{id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: storageKey}], activate: (context) => {
        serverStorage = context.services.require(storageKey);
        return {};
    }}]};
    const world = await storageWorld(join(tmp, `case-${String(counter)}`), [writer]);
    worlds.push(world);
    if (options.before !== undefined) await options.before(serverStorage!);
    const settings = fakeSettings();
    settings.layer.value = options.layer ?? "ok";
    const desktop = fakeDesktop(options.facts === undefined ? {installed: true, defaultStateRoot: true, stateRoot: "/state"} : options.facts);
    const commands: Harness["commands"] = [];
    const reports: string[] = [];
    let firstRun: FirstRun | null = null;
    let ready = (): boolean => false;
    let failure = (): string | null => null;
    const plugin: PluginDefinition = {id: DESKTOP_PLUGIN, entries: [{id: "first-run", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: diagnosticsKey}, {key: storageKey}], activate: (context) => {
        const store = firstRunStore.create(context, {storage: context.services.require(storageKey), diagnostics: context.services.require(diagnosticsKey)});
        ready = () => store.state.seen.ready;
        failure = () => store.state.seen.failure;
        const host: FirstRunOptions = {
            settings: settings.service,
            commands: {execute: (id, args) => new Promise((resolve) => commands.push({id, args, settle: resolve as never}))},
            desktop: desktop.desktop,
            store,
            themes: {value: []} as never,
            locales: [{value: "zh-CN", label: "简体中文"}],
            systemDark: ref(false),
            library: async () => "/home/writer/NeuroBook",
            revealLibrary: async () => options.reveal ?? "ok",
            now: () => Date.UTC(2026, 10, 18, 12, 0, 0),
            report: (event) => void reports.push(event),
        };
        firstRun = createFirstRun(host);
        return {};
    }}]};
    await world.window("browser-a", "profile-1", [plugin]);
    await waitUntil("宿主激活", () => firstRun !== null);
    return {firstRun: firstRun!, settings, desktop, commands, reports, server: () => serverStorage!, ready: () => ready(), failure: () => failure()};
}

async function recordOf(storage: StorageService): Promise<unknown> {
    const opened = await storage.open(FIRST_RUN_RECORD);
    if (!opened.ok) throw new Error(opened.code);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

describe("什么时候打开", () => {
    it("没有记录、用户层可用：打开在第一步；关掉写记录（看过的时刻取时钟）", async () => {
        const h = await harness();
        await waitUntil("打开", () => h.firstRun.view.value.open);
        expect(h.firstRun.view.value.step).toBe(1);
        h.firstRun.close();
        expect(h.firstRun.view.value.open).toBe(false);
        await waitUntil("记录落盘", async () => (await recordOf(h.server())) !== "missing");
        expect(await recordOf(h.server())).toEqual({at: "2026-11-18T12:00:00.000Z"});
    });

    it("用户层还不可用时等，变可用后才打开", async () => {
        const h = await harness({layer: "unavailable"});
        await waitUntil("记录读到了", () => h.ready());
        expect(h.firstRun.view.value.open).toBe(false);
        h.settings.layer.value = "ok";
        await waitUntil("打开", () => h.firstRun.view.value.open);
    });

    it("已有记录：不打开；另一个窗口写了记录：这一页开着的向导关掉", async () => {
        const seen = await harness({before: async (server) => {
            const opened = await server.open(FIRST_RUN_RECORD);
            if (opened.ok) await opened.handle.save({at: "2026-01-01T00:00:00.000Z"}, {expect: null});
        }});
        await waitUntil("记录读到了", () => seen.ready());
        expect(seen.firstRun.view.value.open).toBe(false);

        const h = await harness();
        await waitUntil("打开", () => h.firstRun.view.value.open);
        const opened = await h.server().open(FIRST_RUN_RECORD);
        if (!opened.ok) throw new Error(opened.code);
        await opened.handle.save({at: "2026-11-18T13:00:00.000Z"}, {expect: null});
        await waitUntil("随之关掉", () => !h.firstRun.view.value.open);
    });

    it("记录打不开或读不出：等，不打开（同一键在服务端以另一版定义登记过，存储拒绝成 definition-conflict）", async () => {
        const h = await harness({before: async (server) => {
            const newer = defineRecord({key: "first-run", scope: "user", locality: "shared", version: 2, schema: Type.Object({at: Type.String()}, {additionalProperties: false})});
            const opened = await server.open(newer);
            if (opened.ok) await opened.handle.save({at: "2027-01-01T00:00:00.000Z"}, {expect: null});
        }});
        await waitUntil("读过了", () => h.ready() || h.failure() !== null);
        expect(h.failure()).toBe("definition-conflict");
        expect(h.firstRun.view.value.open).toBe(false);
    });

    it("命令打开不看记录；已开着时什么也不做（不回到第一步）", async () => {
        const h = await harness({before: async (server) => {
            const opened = await server.open(FIRST_RUN_RECORD);
            if (opened.ok) await opened.handle.save({at: "2026-01-01T00:00:00.000Z"}, {expect: null});
        }});
        h.firstRun.show();
        expect(h.firstRun.view.value.open).toBe(true);
        h.firstRun.next();
        h.firstRun.show();
        expect(h.firstRun.view.value.step).toBe(2);
    });
});

describe("值的写入", () => {
    it("主题经切换命令写；快速点了两张卡片时显示后点的那张，先完成的那次不抹掉后一次的在途值", async () => {
        const h = await harness();
        h.firstRun.change({key: "theme", value: "macos"});
        h.firstRun.change({key: "theme", value: "eye-green"});
        expect(h.commands.map((command) => [command.id, command.args])).toEqual([["nbook.settings.switch-theme", {theme: "macos"}], ["nbook.settings.switch-theme", {theme: "eye-green"}]]);
        expect(h.firstRun.view.value.theme).toBe("eye-green");
        h.settings.values["nbook.workbench/theme"] = "macos";
        h.commands[0]!.settle({ok: true, value: undefined});
        // 让第一次的结算跑完（几个微任务），再看在途值还在。
        for (let i = 0; i < 5; i += 1) await Promise.resolve();
        expect(h.firstRun.view.value.theme).toBe("eye-green");
        h.settings.values["nbook.workbench/theme"] = "eye-green";
        h.commands[1]!.settle({ok: true, value: undefined});
        await waitUntil("在途值清掉、显示配置服务的值", () => h.firstRun.view.value.theme === "eye-green" && h.firstRun.view.value.message === null);
    });

    it("命令失败：回到配置服务的值，状态行说没改成", async () => {
        const h = await harness();
        h.firstRun.change({key: "appearance", value: "dark"});
        expect(h.firstRun.view.value.appearance).toBe("dark");
        h.commands[0]!.settle({ok: false, code: "execution-error", reason: "配置写入失败"});
        await waitUntil("失败结算", () => h.firstRun.view.value.message !== null);
        expect(h.firstRun.view.value.appearance).toBe("light");
        expect(h.firstRun.view.value.message).toEqual({kind: "not-saved", item: "appearance", cause: null});
    });

    it("桌面三项直接写用户层；结果未知时状态行另有说法；关窗后留在托盘写 closeLastWindow", async () => {
        const h = await harness();
        h.firstRun.change({key: "tray", value: true});
        await waitUntil("写了", () => h.settings.writes.length === 1);
        expect(h.settings.writes[0]).toEqual(["nbook.desktop/closeLastWindow", "tray"]);
        expect(h.firstRun.view.value.options.tray).toBe(true);
        h.settings.failNext({ok: false, code: "unknown-outcome", detail: "connection lost"} as SettingWriteResult);
        h.firstRun.change({key: "openAtLogin", value: true});
        await waitUntil("失败结算", () => h.firstRun.view.value.message !== null);
        expect(h.firstRun.view.value.message).toEqual({kind: "unknown-outcome", item: "openAtLogin"});
        expect(h.firstRun.view.value.options.openAtLogin).toBe(false);
        h.settings.failNext({ok: false, code: "write-failed", detail: "EACCES"} as SettingWriteResult);
        h.firstRun.change({key: "desktopShortcut", value: false});
        await waitUntil("失败结算", () => h.firstRun.view.value.message?.kind === "not-saved");
        expect(h.firstRun.view.value.message).toEqual({kind: "not-saved", item: "desktopShortcut", cause: "write-failed"});
    });

    it("语言经切换命令写", async () => {
        const h = await harness();
        h.firstRun.change({key: "locale", value: "en-US"});
        expect(h.commands.map((command) => [command.id, command.args])).toEqual([["nbook.settings.switch-locale", {locale: "en-US"}]]);
        expect(h.firstRun.view.value.locale).toBe("en-US");
    });

    it("命令重开的向导再关：已有记录不重写", async () => {
        const h = await harness();
        await waitUntil("打开", () => h.firstRun.view.value.open);
        h.firstRun.close();
        await waitUntil("记录落盘", async () => (await recordOf(h.server())) !== "missing");
        const opened = await h.server().open(FIRST_RUN_RECORD);
        if (!opened.ok) throw new Error(opened.code);
        const before = await opened.handle.read();
        h.firstRun.show();
        h.firstRun.close();
        for (let i = 0; i < 20; i += 1) await Promise.resolve();
        expect(await opened.handle.read()).toEqual(before);
    });
});

describe("安装事实与位置", () => {
    it("安装版、缺省状态根才给前两行；安装事实晚到时跟着变；状态根的路径来自它", async () => {
        const h = await harness({facts: null});
        expect(h.firstRun.view.value.shownOptions).toEqual(["tray"]);
        h.desktop.deliver({installed: true, defaultStateRoot: true, stateRoot: "C:\\state"});
        expect(h.firstRun.view.value.shownOptions).toEqual(["desktopShortcut", "openAtLogin", "tray"]);
        expect(h.firstRun.view.value.places.stateRoot).toBe("C:\\state");
        h.desktop.deliver({installed: true, defaultStateRoot: false, stateRoot: "C:\\other"});
        expect(h.firstRun.view.value.shownOptions).toEqual(["tray"]);
    });

    it("到第四步才取作品目录；打开状态根交给壳；作品目录不存在是中性提示，别的结果进状态行", async () => {
        const missing = await harness({reveal: "missing"});
        for (let i = 0; i < 3; i += 1) missing.firstRun.next();
        await waitUntil("取到作品目录", () => missing.firstRun.view.value.places.library !== null);
        missing.firstRun.openPlace("state-root");
        expect(missing.desktop.opened()).toBe(1);
        missing.firstRun.openPlace("library");
        await waitUntil("提示", () => missing.firstRun.view.value.libraryMissing);
        expect(missing.firstRun.view.value.message).toBeNull();

        const denied = await harness({reveal: "not-accessible"});
        denied.firstRun.openPlace("library");
        await waitUntil("状态行", () => denied.firstRun.view.value.message !== null);
        expect(denied.firstRun.view.value.message).toEqual({kind: "reveal", code: "not-accessible"});
    });
});
