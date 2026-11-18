/**
 * Ctrl+滚轮的累积与整数设置的防抖写回（`wheel-steps.ts`）。写回用真实的配置拥有者（服务端位置的 `nbook.settings`，写状态根下的
 * settings.json），设置用编辑器的 `markdown.fontSize`；防抖的计时由测试手动推进。
 */

import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {computed} from "vue";
import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createApplication} from "nbook/application";
import {definitionAt} from "nbook/manifest";
import {descriptor} from "nbook/plugins/editor/plugin";
import {MARKDOWN_FONT_SIZE_DEFAULT, MARKDOWN_FONT_SIZE_MAX, MARKDOWN_FONT_SIZE_MIN, markdownSettings} from "nbook/plugins/editor/shared/settings";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import type {SettingsService} from "nbook/shared/settings";

import {createSteppedSetting, createWheelAccumulator, WHEEL_STEP} from "./wheel-steps";

const silent = {error: () => undefined};
const setting = markdownSettings["markdown.fontSize"];
const KEY = "nbook.editor/markdown.fontSize";
let tmp = "";
let counter = 0;
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-shared", "wheel-steps");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 服务端位置的配置服务：编辑器的配置项随描述的顶层贡献登记，用户层写进 `<root>/state/settings.json`。 */
async function serverSettings(): Promise<{readonly settings: SettingsService; readonly file: string}> {
    const root = join(tmp, `case-${String((counter += 1))}`);
    // 状态根要先在：拥有者写用户层时不替你建状态根。
    await mkdir(join(root, "state"), {recursive: true});
    const standalone = standaloneSettings("server", root);
    const identity = {location: "server" as const, instanceId: "wheel-steps"};
    const diagnostics = createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    let found: SettingsService | null = null;
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: standalone.capabilities,
            // 配置服务只让声明者写自己的项：取服务的入口挂在 nbook.editor 名下。
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

const userLayer = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, "utf8").catch(() => "null"));

describe("Ctrl+滚轮累积", () => {
    it("累积满一档才换，换了方向先清零", () => {
        const wheel = createWheelAccumulator();
        expect(wheel(-20)).toBeNull();
        expect(wheel(-20)).toBeNull();
        expect(wheel(-20)).toBe("in");
        expect(wheel(-20)).toBeNull();
        expect(wheel(30)).toBeNull();
        expect(wheel(WHEEL_STEP)).toBe("out");
    });

    it("一格普通滚轮在任何页面缩放下都换一档：100% 时 100、200% 时 50；一次事件最多一档，换档后清零", () => {
        for (const delta of [100, 80, 50]) {
            const wheel = createWheelAccumulator();
            expect(wheel(-delta)).toBe("in");
            expect(wheel(-delta)).toBe("in");
        }
        const wheel = createWheelAccumulator();
        expect(wheel(-100)).toBe("in");
        expect(wheel(-20)).toBeNull();
    });
});

describe("整数设置的按档改与写回", () => {
    const options = (settings: SettingsService, timer: ReturnType<typeof manualSchedule>, failed: (detail: string) => void = () => undefined) => ({
        settings, setting, defaultValue: MARKDOWN_FONT_SIZE_DEFAULT, min: MARKDOWN_FONT_SIZE_MIN, max: MARKDOWN_FONT_SIZE_MAX, schedule: timer.schedule, failed,
    });

    it("在 computed 里读：每走一档立即重算，不等写回；连走几档从目标值接着算，防抖后用户层写的是最后一档", async () => {
        const {settings, file} = await serverSettings();
        const timer = manualSchedule();
        const stepped = createSteppedSetting(options(settings, timer));
        const seen = computed(() => stepped.current());
        expect(seen.value).toBe(17);
        stepped.step(1);
        expect(seen.value).toBe(18);
        stepped.step(1);
        stepped.step(1);
        expect(seen.value).toBe(20);
        expect(timer.pending).toBe(1);
        timer.flush();
        await waitUntil("用户层写进 20", async () => JSON.stringify(await userLayer(file)) === JSON.stringify({[KEY]: 20}));
        await waitUntil("配置服务读到 20", () => settings.get(setting) === 20);
        // 写成功后清掉目标，有效值是配置服务里的 20，没有回跳。
        expect(seen.value).toBe(20);
    });

    it("回到缺省值时删掉用户层的键，不把缺省值写进文件；到范围两端不动", async () => {
        const {settings, file} = await serverSettings();
        const timer = manualSchedule();
        const stepped = createSteppedSetting(options(settings, timer));
        stepped.step(2);
        timer.flush();
        await waitUntil("写进 19", async () => JSON.stringify(await userLayer(file)) === JSON.stringify({[KEY]: 19}));
        await waitUntil("读到 19", () => settings.get(setting) === 19);
        stepped.step(-2);
        timer.flush();
        await waitUntil("键被删掉", async () => JSON.stringify(await userLayer(file)) === JSON.stringify({}));
        await waitUntil("读到缺省", () => settings.get(setting) === MARKDOWN_FONT_SIZE_DEFAULT);
        stepped.step(MARKDOWN_FONT_SIZE_MAX * 2);
        expect(stepped.current()).toBe(MARKDOWN_FONT_SIZE_MAX);
        const before = timer.pending;
        stepped.step(1);
        expect(timer.pending).toBe(before);
        expect(stepped.current()).toBe(MARKDOWN_FONT_SIZE_MAX);
    });

    it("写回失败：说明原因，有效值回到配置服务里的值", async () => {
        const {settings, file} = await serverSettings();
        await writeFile(file, "{}\n");
        await chmod(file, 0o444);
        try {
            const failures: string[] = [];
            const timer = manualSchedule();
            const stepped = createSteppedSetting(options(settings, timer, (detail) => failures.push(detail)));
            stepped.step(1);
            expect(stepped.current()).toBe(18);
            timer.flush();
            await waitUntil("写回失败的说明", () => failures.length === 1);
            expect(stepped.current()).toBe(MARKDOWN_FONT_SIZE_DEFAULT);
        } finally {
            await chmod(file, 0o644);
        }
    });

    it("写在途时又走一档：目标不被在途的写清掉，第二次防抖写的是最后一档；写失败后还能继续走", async () => {
        const {settings, file} = await serverSettings();
        const timer = manualSchedule();
        const stepped = createSteppedSetting(options(settings, timer));
        stepped.step(1);
        timer.flush();
        stepped.step(1);
        expect(stepped.current()).toBe(19);
        await waitUntil("在途的写落盘", async () => JSON.stringify(await userLayer(file)) === JSON.stringify({[KEY]: 18}));
        // 在途的写完成时目标已经是 19：不清它，有效值仍是 19，不闪回 18。
        expect(stepped.current()).toBe(19);
        timer.flush();
        await waitUntil("最后一档写进", async () => JSON.stringify(await userLayer(file)) === JSON.stringify({[KEY]: 19}));
        await waitUntil("读到 19", () => settings.get(setting) === 19);
        expect(stepped.current()).toBe(19);
    });

    it("页面要离开：flush 立即写；dispose 也先写回再取消计时", async () => {
        const {settings, file} = await serverSettings();
        const timer = manualSchedule();
        const stepped = createSteppedSetting(options(settings, timer));
        stepped.step(1);
        stepped.flush();
        await waitUntil("flush 写进 18", async () => JSON.stringify(await userLayer(file)) === JSON.stringify({[KEY]: 18}));
        await waitUntil("读到 18", () => settings.get(setting) === 18);
        stepped.step(1);
        stepped.dispose();
        await waitUntil("dispose 写进 19", async () => JSON.stringify(await userLayer(file)) === JSON.stringify({[KEY]: 19}));
    });
});
