/**
 * 壳的桌面设置缓存（desktop-settings.ts）：写了读得回；没有、不是 JSON 对象时不当真；是对象时逐项取，缺的项取缺省，
 * 不合法的项取缺省并交回原因。真实文件系统。
 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createDesktopSettingsCacheWriter, DEFAULT_DESKTOP_SETTINGS, loginItemPlan, readDesktopSettingsCache, sameDesktopSettings, writeDesktopSettingsCache} from "./desktop-settings";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop", "settings-cache");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("桌面设置缓存", () => {
    it("写了读得回（目录不存在时建出来）；没有缓存时为 null、没有原因", async () => {
        const file = join(tmp, "a", "logs", "desktop", "settings-cache.json");
        expect(await readDesktopSettingsCache(file)).toEqual({values: null, problem: null});
        await writeDesktopSettingsCache(file, {zoom: 1.25, openAtLogin: true, closeLastWindow: "tray", windowBackdrop: "mica"});
        expect(await readDesktopSettingsCache(file)).toEqual({values: {zoom: 1.25, openAtLogin: true, closeLastWindow: "tray", windowBackdrop: "mica"}, problem: null});
    });

    it("不是 JSON、不是对象：为 null，交回原因", async () => {
        await mkdir(join(tmp, "b"), {recursive: true});
        const broken = join(tmp, "b", "broken.json");
        await writeFile(broken, "{zoom");
        const list = join(tmp, "b", "list.json");
        await writeFile(list, JSON.stringify([1.25]));
        for (const file of [broken, list]) {
            const read = await readDesktopSettingsCache(file);
            expect(read.values).toBeNull();
            expect(read.problem).toContain(file);
        }
    });

    it("上一版写的缓存（没有关窗去向与窗口背景）：缩放与开机自启照用，去向取 quit、背景取 off，不算问题", async () => {
        const file = join(tmp, "b", "previous.json");
        await writeFile(file, JSON.stringify({zoom: 1.25, openAtLogin: true}));
        expect(await readDesktopSettingsCache(file)).toEqual({values: {zoom: 1.25, openAtLogin: true, closeLastWindow: "quit", windowBackdrop: "off"}, problem: null});
    });

    it("某一项不合法：那一项取缺省，其余照用，原因里写出文件与项名；多出来的键不理", async () => {
        const file = join(tmp, "b", "wrong.json");
        await writeFile(file, JSON.stringify({zoom: "big", openAtLogin: true, closeLastWindow: "hide", later: 1}));
        const read = await readDesktopSettingsCache(file);
        expect(read.values).toEqual({zoom: DEFAULT_DESKTOP_SETTINGS.zoom, openAtLogin: true, closeLastWindow: "quit", windowBackdrop: "off"});
        expect(read.problem).toContain(file);
        expect(read.problem).toContain("zoom, closeLastWindow");
    });

    it("两份值逐项比较：只差关窗去向的也不同", () => {
        const base = {zoom: 1, openAtLogin: false, closeLastWindow: "quit", windowBackdrop: "off"} as const;
        expect(sameDesktopSettings(base, {...base})).toBe(true);
        expect(sameDesktopSettings(base, {...base, zoom: 1.1})).toBe(false);
        expect(sameDesktopSettings(base, {...base, openAtLogin: true})).toBe(false);
        expect(sameDesktopSettings(base, {...base, closeLastWindow: "tray"})).toBe(false);
        expect(sameDesktopSettings(base, {...base, windowBackdrop: "acrylic"})).toBe(false);
    });
});

describe("开机自启的登记", () => {
    const base = {openAtLogin: true, managed: true, defaultStateRoot: true, existing: null, command: "\"C:\\\\app\\\\bin\\\\launcher.exe\""} as const;

    it("安装版、缺省状态根：开着而没有登记或登记不同就写，相同不动；关着而有登记就删，没有不动", () => {
        expect(loginItemPlan(base)).toEqual({action: "add"});
        expect(loginItemPlan({...base, existing: "\"D:\\\\old\\\\launcher.exe\""})).toEqual({action: "add"});
        expect(loginItemPlan({...base, existing: base.command})).toEqual({action: "none", reason: null});
        expect(loginItemPlan({...base, openAtLogin: false, existing: base.command})).toEqual({action: "remove"});
        expect(loginItemPlan({...base, openAtLogin: false})).toEqual({action: "none", reason: null});
    });

    it("便携、开发构建、别的状态根：不写也不删已有的登记；开着时说明原因", () => {
        expect(loginItemPlan({...base, managed: false})).toEqual({action: "none", reason: "not an installed app"});
        expect(loginItemPlan({...base, defaultStateRoot: false, existing: base.command})).toEqual({action: "none", reason: "the state root is not the default one"});
        expect(loginItemPlan({...base, openAtLogin: false, defaultStateRoot: false, existing: base.command})).toEqual({action: "none", reason: null});
    });
});

describe("缓存的串行写入", () => {
    it("几个窗口接连交来值：按到达顺序写，最后一次落盘，没有失败", async () => {
        const file = join(tmp, "c", "settings-cache.json");
        const failures: unknown[] = [];
        const writer = createDesktopSettingsCacheWriter(file, (error) => failures.push(error));
        const values = Array.from({length: 40}, (_, index) => ({zoom: index % 2 === 0 ? 1.1 : 1.25, openAtLogin: index % 3 === 0, closeLastWindow: index % 5 === 0 ? "tray" : "quit", windowBackdrop: index % 7 === 0 ? "acrylic" : "off"} as const));
        await Promise.all(values.map((value) => writer.write(value)));
        expect(failures).toEqual([]);
        expect((await readDesktopSettingsCache(file)).values).toEqual(values.at(-1)!);
    });

    it("缓存里的缩放不是档位之一（数值在范围内也不行）：缩放取缺省，交回原因", async () => {
        const file = join(tmp, "c", "off-level.json");
        await writeFile(file, JSON.stringify({zoom: 1.3, openAtLogin: false, closeLastWindow: "tray", windowBackdrop: "acrylic"}));
        const read = await readDesktopSettingsCache(file);
        expect(read.values).toEqual({zoom: DEFAULT_DESKTOP_SETTINGS.zoom, openAtLogin: false, closeLastWindow: "tray", windowBackdrop: "acrylic"});
        expect(read.problem).toContain(file);
    });
});
