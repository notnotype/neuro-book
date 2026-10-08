/**
 * 公开状态与插件状态 store 在真实 Chrome 中的验收（docs/specs/state/public-state.md、state/store.md 验收 1、
 * workbench/commands.md 场景 14）：e2e 测试外壳里的测试插件 `test.remote-probe` 声明公开键 `test.remote-probe/armed`、
 * 贡献一条要求它的命令，store 的持久化字段绑 `probe-pair`（`window.__nbRemoteProbe.state`）；后端是带探针的真实
 * 服务端。同一浏览器上下文的两个标签页是同一个客户端，共用 `probe-pair`。开发模式另核对 store 与 Vue 用的是同一份
 * 响应式运行时。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Browser, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

// 同时带来 `window.__nbRemoteProbe` 的全局类型。
import type {StateProbeDebug} from "nbook/web/testing/remote-probe";

import {startDevSession, startProbeServer} from "./fixtures";
import type {ProbeServer} from "./fixtures";

let tmp = "";
let server: ProbeServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "state");
    server = await startProbeServer(join(tmp, "state"));
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 同一浏览器上下文（同一个客户端）里的两个标签页。 */
async function twoTabs(browser: Browser): Promise<readonly [Page, Page]> {
    const context = await browser.newContext();
    const pages = [await context.newPage(), await context.newPage()] as const;
    for (const page of pages) {
        await page.goto(server.url);
        await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
        await expect.poll(() => page.evaluate(() => window.__nbRemoteProbe?.state.pair().ready ?? false)).toBe(true);
    }
    return pages;
}

const setArmed = (page: Page, value: boolean) => page.evaluate((armed) => window.__nbRemoteProbe!.state.setArmed(armed), value);
const pairOf = (page: Page): Promise<ReturnType<StateProbeDebug["pair"]>> => page.evaluate(() => window.__nbRemoteProbe!.state.pair());

async function openPalette(page: Page): Promise<void> {
    const combobox = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    // 命令宿主随 `/` 页异步加载：按到面板出现为止。
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(combobox).toBeFocused({timeout: 500});
    }).toPass();
}

test("两个标签页的公开状态不同：带 when 的命令只在打开开关的那一边列出，面板开着时随开关即时变化；服务端分别问两个窗口", async ({browser}) => {
    const [armed, other] = await twoTabs(browser);
    await setArmed(armed, true);

    await openPalette(armed);
    const option = (page: Page) => page.getByRole("option", {name: /探针动作/});
    await expect(option(armed)).toBeVisible();
    await openPalette(other);
    await expect(option(other)).toHaveCount(0);

    await setArmed(armed, false);
    await expect(option(armed)).toHaveCount(0);
    await setArmed(armed, true);
    await expect(option(armed)).toBeVisible();

    const commandsAt = async (page: Page) => {
        const instance = await page.locator("[data-workbench-root]").getAttribute("data-window-instance");
        const response = await fetch(new URL(`/api/test.remote-probe/commands/${String(instance)}`, server.url));
        const listed = await response.json() as {ok: boolean; value: Array<{id: string; available: boolean; reason: string | null}>};
        return listed.value.find((command) => command.id === "test.remote-probe.go");
    };
    expect(await commandsAt(armed)).toMatchObject({available: true, reason: null});
    expect(await commandsAt(other)).toMatchObject({available: false, reason: "探针开关没打开"});
    await armed.context().close();
});

test("两个标签页在同一轮里窄改 probe-pair 的不同字段：两个修改都保留，至多冲突一次；先写的一边显示不被强行改，adopt 后才更新", async ({browser}) => {
    const [left, right] = await twoTabs(browser);
    const results = await Promise.all([
        left.evaluate(() => window.__nbRemoteProbe!.state.setLeft("左")),
        right.evaluate(() => window.__nbRemoteProbe!.state.setRight("右")),
    ]);
    expect(results).toEqual(["saved", "saved"]);

    const both = {left: "左", right: "右"};
    for (const page of [left, right]) {
        await expect.poll(async () => {
            const base = (await pairOf(page)).base as {status: string; value?: unknown};
            return base.status === "ok" ? base.value : null;
        }).toEqual(both);
    }
    // 重放时 change 拿到的是最新快照，里面有对方的修改。两边都在对方写入可见之前提交时恰好冲突一次；
    // 提交得晚的一边已经收到对方的写入时不冲突。
    const seenLeft = await left.evaluate(() => window.__nbRemoteProbe!.state.seen);
    const seenRight = await right.evaluate(() => window.__nbRemoteProbe!.state.seen);
    expect(seenLeft.filter((value) => value.right === "右").length + seenRight.filter((value) => value.left === "左").length).toBeLessThanOrEqual(1);

    const displays = [(await pairOf(left)).display, (await pairOf(right)).display];
    expect(displays.some((display) => display.left === "" || display.right === "")).toBe(true);
    for (const page of [left, right]) {
        await page.evaluate(() => window.__nbRemoteProbe!.state.adopt());
        expect((await pairOf(page)).display).toEqual(both);
    }
    await left.context().close();
});

test.describe("开发模式", () => {
    let devTmp = "";

    test.afterAll(async () => {
        if (devTmp !== "") await rm(devTmp, {recursive: true, force: true});
    });

    test("store 与 Vue 共用同一份响应式运行时：预构建的 @vue/reactivity 与 vue 导出同一个 ref", async ({page}) => {
        devTmp = await createTestTmpRoot("neuro-book-e2e", "state-dev");
        const dev = await startDevSession(join(devTmp, "state"));
        try {
            await page.goto(dev.pageUrl);
            await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
            // 用页面实际加载的模块地址（带版本参数）取同一个模块实例；地址不同会得到另一个实例。
            const same = await page.evaluate(async () => {
                const loaded = performance.getEntriesByType("resource").map((entry) => entry.name);
                const vue = loaded.find((name) => name.includes("/.vite/deps/vue.js"));
                // 没进预构建时它按 node_modules 里的路径单独加载，同样要找出来比较。
                const reactivity = loaded.find((name) => name.includes("/.vite/deps/@vue_reactivity.js") || /\/@vue\/reactivity\/.+\.js(?:\?|$)/u.test(name));
                if (vue === undefined || reactivity === undefined) return `没有加载：${vue === undefined ? "vue" : "@vue/reactivity"}`;
                const [vueModule, reactivityModule] = await Promise.all([import(vue), import(reactivity)]) as [{ref: unknown}, {ref: unknown}];
                return vueModule.ref === reactivityModule.ref;
            });
            expect(same).toBe(true);
        } finally {
            dev.child.kill("SIGTERM");
            expect(await dev.exit).toBe(0);
        }
    });
});
