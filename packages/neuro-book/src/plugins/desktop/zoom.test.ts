/**
 * 桌面窗口的界面缩放（desktop-shell 的“桌面专属设置”，`web/zoom.ts`）：档位换算、快捷键与滚轮的判定、改档与写回。写回用真实的
 * 配置拥有者（服务端位置的 `nbook.settings`，写状态根下的 settings.json）；防抖的计时由测试手动推进。
 */

import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createApplication} from "nbook/application";
import {definitionAt} from "nbook/manifest";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import type {DesktopSettingValues} from "nbook/shared/desktop-bridge";
import type {SettingsService} from "nbook/shared/settings";

import {descriptor} from "./plugin";
import {createWheelAccumulator, createZoomController, steppedZoom, WHEEL_STEP, zoomKeyAction} from "./web/zoom";

const silent = {error: () => undefined};
let tmp = "";
let counter = 0;
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop", "zoom");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 服务端位置的配置服务：本插件的配置项随描述的顶层贡献登记，用户层写进 `<root>/state/settings.json`。 */
async function serverSettings(): Promise<{readonly settings: SettingsService; readonly file: string}> {
    const root = join(tmp, `case-${String((counter += 1))}`);
    // 状态根要先在：拥有者写用户层时不替你建状态根（同产品里服务端的认领先建好它）。
    await mkdir(join(root, "state"), {recursive: true});
    const standalone = standaloneSettings("server", root);
    const identity = {location: "server" as const, instanceId: "zoom"};
    const diagnostics = createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    let found: SettingsService | null = null;
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: standalone.capabilities,
            // 配置服务只让声明者写自己的项：取服务的入口挂在 nbook.desktop 名下，同产品里它的浏览器入口。
            plugins: [diagnostics, ...standalone.plugins, {
                ...definitionAt("server", descriptor, undefined),
                entries: [{id: "server", location: "server", activationEvents: ["onStartup"], dependencies: [{key: settingsKey}], activate: (context) => {
                    found = context.services.require(settingsKey);
                    return {};
                }}],
            }],
            gates: [],
        },
    );
    started.push(application);
    const startup = await application.startup;
    if (found === null) throw new Error(`没有拿到配置服务：${JSON.stringify(startup).slice(0, 600)}`);
    return {settings: found, file: join(root, "state", "settings.json")};
}

/** 手动推进的防抖：记下排的回调，`flush` 时执行最后一个还没取消的。 */
function manualSchedule(): {schedule: (callback: () => void, ms: number) => () => void; flush(): void; readonly pending: number} {
    let next: {callback: () => void} | null = null;
    return {
        schedule(callback) {
            const entry = {callback};
            next = entry;
            return () => {
                if (next === entry) next = null;
            };
        },
        flush() {
            const entry = next;
            next = null;
            entry?.callback();
        },
        get pending() {
            return next === null ? 0 : 1;
        },
    };
}

describe("档位与输入", () => {
    it("从最近的档位走一档，到头不动", () => {
        expect(steppedZoom(1, 1)).toBe(1.1);
        expect(steppedZoom(1, -1)).toBe(0.9);
        expect(steppedZoom(1.2, 1)).toBe(1.5);
        expect(steppedZoom(2, 1)).toBe(2);
        expect(steppedZoom(0.5, -1)).toBe(0.5);
    });

    it("先按 code 认数字行与小键盘的加、减、0，认不到再按字符；要 Ctrl，不要 Alt、Meta，Shift 不限；组字时不算", () => {
        type Extra = Partial<{key: string; isComposing: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean}>;
        const key = (code: string, extra: Extra = {}) => zoomKeyAction({code, key: "", isComposing: false, ctrlKey: true, altKey: false, metaKey: false, ...extra});
        expect(["Equal", "NumpadAdd", "Minus", "NumpadSubtract", "Digit0"].map((code) => key(code))).toEqual(["in", "in", "out", "out", "reset"]);
        expect(key("Numpad0", {key: "0"})).toBe("reset");
        // NumLock 关着时小键盘的 0 是 Insert：Ctrl+Insert 是复制，不是复位。
        expect(key("Numpad0", {key: "Insert"})).toBeNull();
        // 别的键盘布局：物理键位不是美式的位置，字符对得上就认。
        expect(key("BracketRight", {key: "+"})).toBe("in");
        expect(key("Digit6", {key: "-"})).toBe("out");
        expect(key("Equal", {isComposing: true})).toBeNull();
        expect(key("Equal", {ctrlKey: false})).toBeNull();
        expect(key("Equal", {altKey: true})).toBeNull();
        expect(key("Equal", {metaKey: true})).toBeNull();
        expect(key("KeyS")).toBeNull();
    });

    it("Ctrl+滚轮累积满一档才换，换了方向先清零", () => {
        const wheel = createWheelAccumulator();
        expect(wheel(-40)).toBeNull();
        expect(wheel(-40)).toBeNull();
        expect(wheel(-40)).toBe("in");
        expect(wheel(-40)).toBeNull();
        expect(wheel(60)).toBeNull();
        expect(wheel(WHEEL_STEP)).toBe("out");
    });
});

describe("改档与写回", () => {
    it("连按两下：壳先后收到两个目标档位，防抖后用户层写的是最后一档；复位删掉这个键", async () => {
        const {settings, file} = await serverSettings();
        const reported: DesktopSettingValues[] = [];
        const timer = manualSchedule();
        const zoom = createZoomController({settings, report: (values) => reported.push(values), failed: () => undefined, schedule: timer.schedule});
        zoom.apply("in");
        zoom.apply("in");
        expect(reported.map((values) => values.zoom)).toEqual([1.1, 1.25]);
        expect(timer.pending).toBe(1);
        timer.flush();
        const userLayer = async (): Promise<string> => JSON.stringify(JSON.parse(await readFile(file, "utf8").catch(() => "null")));
        await waitUntil("用户层写进 1.25", async () => (await userLayer()) === JSON.stringify({"nbook.desktop/zoom": 1.25}));
        await waitUntil("配置服务读到 1.25", () => zoom.values().zoom === 1.25);
        zoom.apply("reset");
        expect(reported.at(-1)?.zoom).toBe(1);
        timer.flush();
        await waitUntil("复位删掉这个键", async () => (await userLayer()) === "{}");
    });

    it("页面离开前：还没写回的档位立刻写，不等防抖", async () => {
        const {settings, file} = await serverSettings();
        const timer = manualSchedule();
        const zoom = createZoomController({settings, report: () => undefined, failed: () => undefined, schedule: timer.schedule});
        zoom.apply("out");
        zoom.flush();
        expect(timer.pending).toBe(0);
        await waitUntil("用户层写进 0.9", async () => JSON.stringify(JSON.parse(await readFile(file, "utf8").catch(() => "null"))) === JSON.stringify({"nbook.desktop/zoom": 0.9}));
    });

    it("写回失败：说明原因，把壳拉回配置服务里的值", async () => {
        const {settings, file} = await serverSettings();
        await writeFile(file, "{}\n");
        await chmod(file, 0o444);
        try {
            const reported: number[] = [];
            const failures: string[] = [];
            const timer = manualSchedule();
            const zoom = createZoomController({settings, report: (values) => reported.push(values.zoom), failed: (detail) => failures.push(detail), schedule: timer.schedule});
            zoom.apply("out");
            timer.flush();
            await waitUntil("写回失败的说明", () => failures.length === 1);
            expect(reported).toEqual([0.9, 1]);
        } finally {
            await chmod(file, 0o644);
        }
    });
});
