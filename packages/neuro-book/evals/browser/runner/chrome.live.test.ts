/**
 * Chrome 实机：沙箱里起得来，语言与时区对，打不开家目录下的文件，跨站 iframe 是独立目标，关掉后进程与临时目录都不在，
 * 执行者（这里用另一条 CDP 连接扮演）把浏览器关掉时记成 Chrome 自己退出、退出码 0；Chrome 崩掉时记成被信号结束。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {existsSync} from "node:fs";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {forumSite} from "../sites/forum";
import {startSite} from "../sites/server";
import {CdpClient} from "./cdp";
import {launchChrome} from "./chrome";
import type {ChromeHandle} from "./chrome";

const live = process.env.NBOOK_EVAL_LIVE === "1";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function chrome(): Promise<{chrome: ChromeHandle; cdp: CdpClient; root: string}> {
    const root = await createTestTmpRoot("neuro-book-browser-eval", "Chrome");
    cleanups.push(() => rm(root, {recursive: true, force: true}));
    const handle = await launchChrome({runDir: root});
    cleanups.push(() => handle.close());
    const cdp = await CdpClient.connect(handle.cdpUrl);
    cleanups.push(async () => cdp.close());
    return {chrome: handle, cdp, root};
}

/** 开一个页面、等它加载完，在里面求一个表达式的值。 */
async function evaluateIn(cdp: CdpClient, url: string, expression: string): Promise<unknown> {
    const {targetId} = await cdp.send<{targetId: string}>("Target.createTarget", {url});
    const {sessionId} = await cdp.send<{sessionId: string}>("Target.attachToTarget", {targetId, flatten: true});
    await waitUntil("page loaded", async () => (await cdp.send<{result: {value: string}}>("Runtime.evaluate", {expression: "document.readyState", returnByValue: true}, {sessionId})).result.value === "complete");
    return (await cdp.send<{result: {value: unknown}}>("Runtime.evaluate", {expression, returnByValue: true}, {sessionId})).result.value;
}

describe.skipIf(!live)("Chrome 实机", () => {
    test("沙箱里起得来；页面语言是 zh-CN、时区是上海", async () => {
        const {chrome: handle, cdp} = await chrome();
        expect(handle.version).toMatch(/^(HeadlessChrome|Chrome)\//u);
        expect(await evaluateIn(cdp, "about:blank", "[navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone]")).toEqual(["zh-CN", "Asia/Shanghai"]);
    }, 30_000);

    test("经 CDP 打不开家目录下的文件（仓库的 AGENTS.md 在宿主上是在的）", async () => {
        const {cdp} = await chrome();
        const agents = join(import.meta.dir, "../../../../../AGENTS.md");
        expect(existsSync(agents)).toBe(true);
        const text = await evaluateIn(cdp, `file://${agents}`, "document.body ? document.body.innerText : ''");
        expect(String(text)).not.toContain("NeuroBook Agent 入口");
    }, 30_000);

    test("编辑器源（localhost）的 iframe 是独立的目标", async () => {
        const {cdp} = await chrome();
        const site = await startSite(forumSite, 1);
        cleanups.push(() => site.stop());
        await evaluateIn(cdp, `${site.urls.main}/new?board=b-writing`, "1");
        const iframe = await waitUntil("iframe target", async () => {
            const {targetInfos} = await cdp.send<{targetInfos: Array<{type: string; url: string}>}>("Target.getTargets");
            return targetInfos.find((target) => target.type === "iframe" && target.url.startsWith(site.urls.editor));
        }, {timeoutMs: 10_000});
        expect(iframe.url).toBe(`${site.urls.editor}/editor`);
    }, 30_000);

    test("执行者关掉浏览器记成自己退出、退出码 0；调度器关掉的不记；关掉后临时目录不在", async () => {
        const {chrome: handle, cdp, root} = await chrome();
        expect(handle.selfExit()).toBeNull();
        await cdp.send("Browser.close").catch(() => undefined);
        const exit = await waitUntil("chrome exited", () => handle.selfExit(), {timeoutMs: 10_000});
        expect(exit).toEqual({exitCode: 0, signal: null});
        await handle.close();
        expect([existsSync(join(root, "chrome-profile")), existsSync(join(root, "chrome-home"))]).toEqual([false, false]);
        const other = await chrome();
        await other.chrome.close();
        expect(other.chrome.selfExit()).toBeNull();
    }, 40_000);

    test("Chrome 崩掉时记成被信号结束（bwrap 交回的 128+n 还原成信号名），退出码为 null", async () => {
        const {chrome: handle, cdp} = await chrome();
        await cdp.send("Browser.crash").catch(() => undefined);
        const exit = await waitUntil("chrome exited", () => handle.selfExit(), {timeoutMs: 15_000});
        expect(exit.exitCode).toBeNull();
        expect(exit.signal).toMatch(/^SIG[A-Z]+$/u);
    }, 40_000);
});
