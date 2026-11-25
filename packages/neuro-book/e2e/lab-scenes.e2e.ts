/**
 * Lab 的全部登记场景在真实浏览器里都挂得上（ui.component-lab 验收 2、19）：覆盖门禁 `fixtures/index.dom.test.ts` 只证明
 * 登记合法，这里逐个打开，等 fixture 就绪，并要求没有加载失败、页面错误与控制台警告。迁移 nb-ui 场景（w00017 t73）时
 * 加入，守住“为了凑覆盖登记了一个其实挂不上的场景”。
 *
 * 同时是版面的门禁（验收 27）：每个场景在手机画布上量一次越界、聚焦光晕与外扩环被裁（含传送到画布与 body 上的浮层），
 * 和已知问题的基线（`lab-layout-baseline.ts`）逐项比个数，多了少了都失败。`lab:shot` 的同一份测量只在手动截图时才跑，
 * 这里让它每次全量 e2e 都跑。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugApi} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import {LAB_LAYOUT_BASELINE} from "./lab-layout-baseline";
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

test("每个登记场景都能在手机画布上挂上舞台，没有加载失败、页面错误与控制台警告，也没有越界与被裁的光晕、外扩环", async ({context}) => {
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
    const {scenes, drafts} = await first.page.evaluate(() => {
        const api = (window as unknown as {__nbLab: LabDebugApi}).__nbLab;
        return {scenes: api.components().flatMap((component) => api.scenes(component).map((scene) => ({component, scene: scene.id}))), drafts: api.drafts()};
    });
    /** 草稿区的静态稿照样要挂得上，但版面不进门禁：它们是给开发者看的稿子，不是要交付的组件（component-lab 的“草稿区”）。 */
    const draftNames = new Set(drafts);
    await first.close();
    // nb-ui 进 Lab 之后有几百个场景；少于这个数说明组件索引或 nb-ui 来源断了，遍历就失去意义。
    expect(scenes.length).toBeGreaterThan(200);

    const failed: string[] = [];
    /** 每个场景量到的问题：明细给人看，“类型 所属组件”的个数和基线比。 */
    const layout = new Map<string, {readonly details: string[]; readonly counts: Record<string, number>}>();
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
            if (state.loadError !== "") {
                failed.push(`${label}: ${state.loadError}`);
                continue;
            }
            // 先等字体与有限时长的动画（对话框入场是缩放，量到一半的盒子不准）；转圈这类无限动画不等。再隔两帧量一次，连续两次
            // 一样才算数：工作台的布局由尺寸观察排定、有些内容异步才到，四个标签页并行时量早了，同一场景两轮结果不一样。
            const measure = await page.evaluate(async () => {
                await document.fonts.ready;
                const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
                await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
                const api = (window as unknown as {__nbLab: LabDebugApi}).__nbLab;
                const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
                let last = api.measure();
                for (let round = 0; round < 10; round += 1) {
                    await frame();
                    const next = api.measure();
                    if (JSON.stringify(next) === JSON.stringify(last)) return next;
                    last = next;
                }
                return last;
            });
            if (measure !== null && !draftNames.has(component)) {
                const found: Array<{readonly key: string; readonly detail: string}> = [
                    ...(measure.overflowX > 0 ? [{key: "舞台横向溢出", detail: `舞台横向溢出 ${String(measure.overflowX)}px`}] : []),
                    ...measure.offenders.map((offender) => ({key: `越界 ${offender.componentName}`, detail: `越界 ${String(offender.overflow)}px ${offender.selector}`})),
                    ...measure.clippedFocus.map((clipped) => ({key: `光晕被裁 ${clipped.componentName}`, detail: `光晕被裁 ${clipped.selector} ← ${clipped.clipper}`})),
                    ...measure.clippedRings.map((clipped) => ({key: `外扩环被裁 ${clipped.componentName}`, detail: `外扩环被裁 ${clipped.selector} ← ${clipped.clipper}`})),
                ];
                if (found.length > 0) {
                    const counts: Record<string, number> = {};
                    for (const {key} of found) counts[key] = (counts[key] ?? 0) + 1;
                    layout.set(label, {details: found.map(({detail}) => detail), counts});
                }
            }
        }
        await close();
    };
    await Promise.all(Array.from({length: 4}, worker));
    expect(failed).toEqual([]);
    expect(problems).toEqual([]);

    const mismatches: string[] = [];
    for (const scene of new Set([...layout.keys(), ...Object.keys(LAB_LAYOUT_BASELINE)])) {
        const seen = layout.get(scene)?.counts ?? {};
        const known = LAB_LAYOUT_BASELINE[scene] ?? {};
        for (const key of new Set([...Object.keys(seen), ...Object.keys(known)])) {
            const difference = (seen[key] ?? 0) - (known[key] ?? 0);
            if (difference > 0) mismatches.push(`${scene}: 新出现 ${key} ${String(difference)} 个\n    ${(layout.get(scene)?.details ?? []).join("\n    ")}`);
            if (difference < 0) mismatches.push(`${scene}: ${key} 比基线少 ${String(-difference)} 个，修好了就把 lab-layout-baseline.ts 里这一项改小或删掉`);
        }
    }
    // 失败时附上这次量到的全部个数，按它改基线。
    const observed = Object.fromEntries([...layout].sort(([left], [right]) => left.localeCompare(right)).map(([scene, {counts}]) => [scene, counts]));
    expect(mismatches, `这次量到的：${JSON.stringify(observed, null, 4)}`).toEqual([]);
});
