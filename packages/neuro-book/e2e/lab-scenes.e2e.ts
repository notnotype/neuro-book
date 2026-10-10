/**
 * Lab 的全部登记场景在真实浏览器里都挂得上（ui.component-lab 验收 2）：覆盖门禁 `fixtures/index.dom.test.ts` 只证明
 * 登记合法，这里逐个打开，等 fixture 就绪，并要求没有加载失败、页面错误与控制台警告。迁移 nb-ui 场景（w00017 t73）时
 * 加入，守住“为了凑覆盖登记了一个其实挂不上的场景”。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugApi} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

// 跟踪要记下几百次开发模式整页加载（每次一千多个模块请求）的网络与快照；失败时看的是用例给出的场景与状态，
// 不需要跟踪。
test.use({trace: "off"});

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-scenes");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

test("每个登记场景都能在手机画布上挂上舞台，没有加载失败、页面错误与控制台警告", async ({context}) => {
    test.setTimeout(20 * 60_000);
    const problems: string[] = [];
    // 每个标签页只整页加载一次，之后像浏览器的前进后退一样经宿主 router 在 Lab 里切场景：开发服务一次整页加载要请求
    // 一千多个模块，同一标签页连续整页加载四到七次就会报 `ERR_INSUFFICIENT_RESOURCES` 或渲染进程崩溃（2026-10-10
    // 实测，首页同样如此；生产构建连续 20 次正常）。在 Lab 里切换也是使用者实际的用法，上一个场景卸载时的问题照样能看到。
    // 只记从打开到就绪之间的问题：关标签页时插件按 runtime/plugins 以 `receiver-closed` 撤回交付并记警告，那是关页面的
    // 正常诊断，不属于场景。
    const openPage = async (label: () => string) => {
        const page = await context.newPage();
        let recording = true;
        page.on("console", (message) => {
            if (recording && (message.type() === "error" || message.type() === "warning")) problems.push(`${label()} ${message.type()}: ${message.text()}`);
        });
        page.on("pageerror", (error) => {
            if (recording) problems.push(`${label()} pageerror: ${error.message}`);
        });
        return {
            page,
            close: async () => {
                recording = false;
                await page.close();
            },
        };
    };

    const first = await openPage(() => "索引");
    await first.page.goto(`${dev.pageUrl}lab`);
    await expect.poll(() => first.page.evaluate(() => typeof (window as {__nbLab?: unknown}).__nbLab)).toBe("object");
    const scenes = await first.page.evaluate(() => {
        const api = (window as unknown as {__nbLab: LabDebugApi}).__nbLab;
        return api.components().flatMap((component) => api.scenes(component).map((scene) => ({component, scene: scene.id})));
    });
    await first.close();
    // nb-ui 进 Lab 之后有几百个场景；少于这个数说明组件索引或 nb-ui 来源断了，遍历就失去意义。
    expect(scenes.length).toBeGreaterThan(200);

    const failed: string[] = [];
    const queue = [...scenes];
    const worker = async (): Promise<void> => {
        let label = "";
        const {page, close} = await openPage(() => label);
        let loaded = false;
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
            const {component, scene} = next;
            label = `${component}/${scene}`;
            const target = `/lab?c=${encodeURIComponent(component)}&s=${encodeURIComponent(scene)}&vp=phone`;
            if (loaded) {
                await page.evaluate((href) => {
                    history.pushState(null, "", href);
                    dispatchEvent(new PopStateEvent("popstate", {state: null}));
                }, target);
            } else {
                await page.goto(new URL(target, dev.pageUrl).href);
                loaded = true;
            }
            // 就绪或加载失败都结束等待，而且宿主 router 的当前路由与 Lab 的状态一致（地址只经 router 改）；超时时报出当时的
            // 状态、地址与路由。
            await expect.poll(() => page.evaluate(({component, scene}) => {
                const state = (window as unknown as {__nbLab?: LabDebugApi}).__nbLab?.state();
                const app = (document.querySelector("#app") as unknown as {__vue_app__?: {config: {globalProperties: {$router: {currentRoute: {value: {query: Record<string, unknown>}}}}}}}).__vue_app__;
                const route = app?.config.globalProperties.$router.currentRoute.value.query;
                if (state !== undefined && state.component === component && state.scene === scene && (state.loadError !== "" || state.ready)
                    && route?.c === component && route.s === scene) return "settled";
                return JSON.stringify({search: location.search, route: route ?? null, state: state ?? null});
            }, {component, scene}), {message: label}).toBe("settled");
            const state = await page.evaluate(() => (window as unknown as {__nbLab: LabDebugApi}).__nbLab.state());
            if (state.loadError !== "") failed.push(`${label}: ${state.loadError}`);
        }
        await close();
    };
    await Promise.all(Array.from({length: 4}, worker));
    expect(failed).toEqual([]);
    expect(problems).toEqual([]);
});
