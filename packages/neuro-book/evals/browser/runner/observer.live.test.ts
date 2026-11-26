/** 观察者实机：页面没变时不重复存图，变了再存；有没处理的 alert 时截图记为丢帧而不卡住；后台标签页也截得到。 */

import {afterEach, describe, expect, test} from "bun:test";
import {readdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {CdpClient} from "./cdp";
import {launchChrome} from "./chrome";
import {Observer} from "./observer";

const live = process.env.NBOOK_EVAL_LIVE === "1";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(): Promise<{cdp: CdpClient; observer: Observer; shots: string; page: (html: string) => Promise<string>}> {
    const root = await createTestTmpRoot("neuro-book-browser-eval", "观察者");
    cleanups.push(() => rm(root, {recursive: true, force: true}));
    const chrome = await launchChrome({runDir: root});
    cleanups.push(() => chrome.close());
    const cdp = await CdpClient.connect(chrome.cdpUrl);
    cleanups.push(async () => cdp.close());
    const shots = join(root, "shots");
    const page = async (html: string) => {
        const {targetId} = await cdp.send<{targetId: string}>("Target.createTarget", {url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}`});
        return targetId;
    };
    return {cdp, observer: new Observer(cdp, shots), shots, page};
}

describe.skipIf(!live)("观察者实机", () => {
    test("没变的页面不重复存图，变了再存；每轮交回这时的页面目标", async () => {
        const {cdp, observer, shots, page} = await setup();
        const targetId = await page("<h1 id=t>一</h1>");
        const {sessionId} = await cdp.send<{sessionId: string}>("Target.attachToTarget", {targetId, flatten: true});
        await waitUntil("rendered", async () => (await cdp.send<{result: {value: boolean}}>("Runtime.evaluate", {expression: "document.readyState === 'complete'", returnByValue: true}, {sessionId})).result.value);
        const targets = await observer.capture("start");
        expect(targets.map((t) => t.targetId)).toContain(targetId);
        await observer.capture(1);
        await cdp.send("Runtime.evaluate", {expression: "document.querySelector('#t').textContent = '二'"}, {sessionId});
        await observer.capture(2);
        const mine = observer.screenshots().filter((shot) => shot.targetId === targetId);
        expect(mine.map((shot) => [shot.after, shot.dropped])).toEqual([["start", null], [1, "same-as-previous"], [2, null]]);
        expect((await readdir(shots)).filter((name) => name.includes(targetId.slice(0, 8))).length).toBe(2);
    }, 30_000);

    test("页面上有没处理的 alert 时，截图记为超时丢帧，后面的轮次照常进行", async () => {
        const {cdp, observer, page} = await setup();
        let dialogOpen = false;
        cdp.on("Page.javascriptDialogOpening", () => {
            dialogOpen = true;
        });
        const blocked = await page("<body onload=\"alert('hi')\"><p>x</p></body>");
        const {sessionId} = await cdp.send<{sessionId: string}>("Target.attachToTarget", {targetId: blocked, flatten: true});
        await cdp.send("Page.enable", {}, {sessionId});
        await waitUntil("alert open", () => dialogOpen, {timeoutMs: 10_000});
        const normal = await page("<p>正常的页面</p>");
        const started = performance.now();
        await observer.capture("start");
        await observer.capture("end");
        const byTarget = (id: string) => observer.screenshots().filter((shot) => shot.targetId === id).map((shot) => shot.dropped);
        expect(byTarget(blocked)).toEqual(["timeout", "timeout"]);
        expect(byTarget(normal)[0]).toBeNull();
        expect(performance.now() - started).toBeLessThan(25_000);
    }, 40_000);
});
