/** 壳的桌面设置缓存（desktop-settings.ts）：写了读得回；没有、坏了、形状不对都不当真，后两种交回原因。真实文件系统。 */

import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterAll, beforeAll, describe, expect, it} from "bun:test";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {loginItemPlan, readDesktopSettingsCache, sameDesktopSettings, writeDesktopSettingsCache} from "./desktop-settings";

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
        await writeDesktopSettingsCache(file, {zoom: 1.25, openAtLogin: true});
        expect(await readDesktopSettingsCache(file)).toEqual({values: {zoom: 1.25, openAtLogin: true}, problem: null});
    });

    it("不是 JSON、形状不对：为 null，交回原因", async () => {
        await mkdir(join(tmp, "b"), {recursive: true});
        const broken = join(tmp, "b", "broken.json");
        await writeFile(broken, "{zoom");
        const wrong = join(tmp, "b", "wrong.json");
        await writeFile(wrong, JSON.stringify({zoom: "big", openAtLogin: false}));
        for (const file of [broken, wrong]) {
            const read = await readDesktopSettingsCache(file);
            expect(read.values).toBeNull();
            expect(read.problem).toContain(file);
        }
    });

    it("两份值逐项比较", () => {
        expect(sameDesktopSettings({zoom: 1, openAtLogin: false}, {zoom: 1, openAtLogin: false})).toBe(true);
        expect(sameDesktopSettings({zoom: 1, openAtLogin: false}, {zoom: 1.1, openAtLogin: false})).toBe(false);
        expect(sameDesktopSettings({zoom: 1, openAtLogin: false}, {zoom: 1, openAtLogin: true})).toBe(false);
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
