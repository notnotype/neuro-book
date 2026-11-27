/**
 * 按 Spec 输出 9、10 逐句写的黑盒用例（docs/specs/agent/page-agent.md）：与 `guide.e2e.ts` 不重复的行为，
 * 即说明框的内容与纯文字、进度的出现条件、各结局的边界（`until: "next"` 时点页面不结束、非主键不算点错、
 * 目标里按键）、提问框的字数与按钮、目标滚出时仍能操作、压暗的像素与“不改页面元素”、撤掉时的淡出。
 * 真实弹层库的用例在应用的 e2e（`packages/neuro-book/e2e/page-agent-guide.e2e.ts`）。
 */

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {ended, installed, openFixture, startHighlight, stillWaiting} from "./page";

const part = (page: Page, name: string) => page.locator(`[data-nb-page-agent="${name}"]`);

/** 视口里一个像素的 RGB：截一像素的图，再在页面里画到画布上读出来。 */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
    const png = await page.screenshot({clip: {x, y, width: 1, height: 1}});
    return page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return [r!, g!, b!] as [number, number, number];
    }, png.toString("base64"));
}

const luminance = ([r, g, b]: readonly [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

test.describe("说明框的内容（输出 10）", () => {
    test("标题与说明只作纯文字；进度只在 step 与 total 都给了时才写", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px">保存</button>`);
        const markup = `<b>粗</b> & <img src=x onerror="window.pwn=1">`;
        await startHighlight(page, {at: {text: "保存"}, title: `<i>题</i>`, message: markup, until: "next"});
        await installed(page);
        await expect(part(page, "callout")).toContainText(markup);
        await expect(part(page, "callout")).toContainText("<i>题</i>");
        await expect(part(page, "callout").locator("b, i, img")).toHaveCount(0);
        expect(await page.evaluate(() => (window as unknown as {pwn?: number}).pwn)).toBeUndefined();
        await expect(part(page, "callout")).not.toContainText(/Step \d/u);

        for (const progress of [{step: 2}, {total: 5}] as const) {
            // 上一次高亮撤掉后才有结局，淡出中的旧说明框不留在页面上干扰“只有一个说明框”。
            await part(page, "skip").click();
            await ended(page);
            await startHighlight(page, {at: {text: "保存"}, message: "只给一半。", until: "next", ...progress});
            await installed(page);
            await expect(part(page, "callout")).toContainText("只给一半。");
            await expect(part(page, "callout")).not.toContainText(/Step \d/u);
        }
        await part(page, "skip").click();
        await ended(page);
        await startHighlight(page, {at: {text: "保存"}, message: "两个都给。", until: "next", step: 2, total: 5});
        await installed(page);
        await expect(part(page, "callout")).toContainText("Step 2 of 5");
        // 不是最后一步：按钮写“下一步”，不写“完成”。
        await expect(part(page, "next")).toHaveText("Next");
    });
});

test.describe("结局的边界（输出 9）", () => {
    test("until 为 next：点目标与点别的控件都不结束，也没有 missed；点“下一步”才结束", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px" onclick="window.hits=(window.hits??0)+1">保存</button><button id="other">取消</button>`);
        await startHighlight(page, {at: {text: "保存"}, message: "看这里。", until: "next"});
        await installed(page);
        await page.locator("#go").click();
        await page.locator("#other").click();
        // 页面自己的处理照常执行，所以点击确实发生过；结局没有被它们带走。
        expect(await page.evaluate(() => (window as unknown as {hits?: number}).hits)).toBe(1);
        expect(await stillWaiting(page)).toBe(true);
        await part(page, "next").click();
        expect(await ended(page)).toEqual({outcome: "next"});
    });

    test("until 为 click：非主键（中键、右键）按在别处不算点错；在别处按 Enter 与空格也不是点了目标", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px">保存</button><button id="other">取消</button>`);
        await startHighlight(page, {at: {text: "保存"}, message: "点保存。", until: "click"});
        await installed(page);
        await page.locator("#other").click({button: "middle"});
        await page.locator("#other").click({button: "right"});
        await page.locator("#other").focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Space");
        expect(await stillWaiting(page)).toBe(true);
        // 对照：主键按在别处会得 missed，说明上面没发生是判定使然，不是点不到。
        await page.locator("#other").click();
        expect(await ended(page)).toMatchObject({outcome: "missed", clicked: {name: "取消"}});
    });

    test("目标是一组控件时，在它里面的控件上按 Enter 算点了目标", async ({page}) => {
        await openFixture(page, `<div role="group" aria-label="工具组" style="margin:200px"><button id="one">甲</button><button id="two">乙</button></div>`);
        await startHighlight(page, {at: {role: "group", name: "工具组"}, message: "点这一组。", until: "click"});
        expect(await installed(page)).toMatchObject({target: {role: "group"}});
        await page.locator("#two").focus();
        await page.keyboard.press("Enter");
        expect(await ended(page)).toEqual({outcome: "clicked"});
    });
});

test.describe("提问框（输出 9、10）", () => {
    test("提问至多 2000 字；空白问题不交；点“发送”提交；点“收起”不交、说明框继续等", async ({page}) => {
        await openFixture(page, `<input id="field" value="abc"><button id="go" style="margin:200px">保存</button>`);
        await page.locator("#field").focus();
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "click"});
        await installed(page);

        await part(page, "ask-open").click();
        await page.keyboard.insertText("   ");
        await page.keyboard.press("Enter");
        await part(page, "ask-submit").click();
        expect(await stillWaiting(page)).toBe(true);

        await part(page, "ask-close").click();
        await expect(part(page, "callout")).not.toHaveAttribute("data-asking", "");
        expect(await page.evaluate(() => document.activeElement?.id)).toBe("field");
        expect(await stillWaiting(page)).toBe(true);

        await part(page, "ask-open").click();
        await page.keyboard.insertText("问".repeat(2100));
        expect((await part(page, "ask").inputValue()).length).toBe(2000);
        await part(page, "ask-submit").click();
        const result = await ended(page);
        expect(result).toMatchObject({outcome: "asked"});
        if ("outcome" in result && result.outcome === "asked") expect(result.question.length).toBe(2000);
        expect(await page.evaluate(() => document.activeElement?.id)).toBe("field");
    });

    test("点说明框的标题、说明、进度与空白处都不移走焦点与选区", async ({page}) => {
        await openFixture(page, `<input id="field" value="abcdef"><button id="go" style="margin:200px">保存</button>`);
        await page.evaluate(() => {
            const field = document.getElementById("field") as HTMLInputElement;
            field.focus();
            field.setSelectionRange(2, 5);
        });
        await startHighlight(page, {at: {text: "保存"}, title: "标题行", message: "说明行。", until: "next", step: 1, total: 2});
        await installed(page);
        const callout = part(page, "callout");
        const box = (await callout.boundingBox())!;
        const state = () => page.evaluate(() => {
            const field = document.getElementById("field") as HTMLInputElement;
            return {active: document.activeElement?.id, start: field.selectionStart, end: field.selectionEnd};
        });
        for (const target of [callout.getByText("标题行"), callout.getByText("说明行。"), callout.getByText("Step 1 of 2")]) {
            await target.click();
            expect(await state()).toEqual({active: "field", start: 2, end: 5});
        }
        // 框的一角：没有文字也没有按钮的地方。
        await page.mouse.click(box.x + 2, box.y + 2);
        expect(await state()).toEqual({active: "field", start: 2, end: 5});
        expect(await stillWaiting(page)).toBe(true);
    });
});

test.describe("目标滚出视野时（输出 9）", () => {
    test("目标在滚动区域下方：说明框停在区域的下边，仍能提问与跳过", async ({page}) => {
        await page.emulateMedia({reducedMotion: "reduce"});
        await openFixture(page, `<div id="box" style="position:absolute;left:600px;top:200px;width:400px;height:300px;overflow:auto">
  <div style="height:1500px"><button style="margin-top:1000px">深处</button></div></div>`);
        await page.evaluate(() => {
            document.getElementById("box")!.scrollTop = 0;
        });
        await startHighlight(page, {at: {text: "深处"}, message: "在下面。", until: "click", dim: true});
        await installed(page);
        // 起点：装上时滚进了视野；再滚回去让它在区域下方。
        await page.evaluate(() => {
            document.getElementById("box")!.scrollTop = 0;
        });
        await expect(part(page, "outline")).toHaveAttribute("data-hidden", "");
        await expect(part(page, "dim")).toHaveAttribute("data-hidden", "");
        await expect.poll(async () => {
            const box = (await part(page, "callout").boundingBox())!;
            return box.y + box.height <= 500 + 8 && box.y + box.height >= 500 - 40 && box.x >= 600 - 8 && box.x + box.width <= 1000 + 8;
        }).toBe(true);

        await part(page, "ask-open").click();
        await expect(part(page, "callout")).toHaveAttribute("data-asking", "");
        await page.keyboard.type("它在哪");
        await page.keyboard.press("Enter");
        expect(await ended(page)).toEqual({outcome: "asked", question: "它在哪"});

        await startHighlight(page, {at: {text: "深处"}, message: "在下面。", until: "click"});
        await installed(page);
        await page.evaluate(() => {
            document.getElementById("box")!.scrollTop = 0;
        });
        await expect(part(page, "outline")).toHaveAttribute("data-hidden", "");
        await part(page, "skip").click();
        expect(await ended(page)).toEqual({outcome: "dismissed"});
    });

    test("目标在整页滚动之外：说明框停在窗口的边上；描边框跟着页面滚动，滚回来再出现", async ({page}) => {
        await page.emulateMedia({reducedMotion: "reduce"});
        await openFixture(page, `<div style="height:3000px"><button id="far" style="margin-top:2000px">很远</button></div>`);
        await startHighlight(page, {at: {text: "很远"}, message: "在这里。", until: "next"});
        await installed(page);
        await expect(part(page, "outline")).not.toHaveAttribute("data-hidden", "");
        const y0 = (await part(page, "outline").boundingBox())!.y;
        await page.evaluate(() => window.scrollBy(0, 50));
        await expect.poll(async () => (await part(page, "outline").boundingBox())!.y).toBe(y0 - 50);

        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(part(page, "outline")).toHaveAttribute("data-hidden", "");
        await expect.poll(async () => {
            const box = (await part(page, "callout").boundingBox())!;
            return box.y >= 0 && box.y + box.height <= 800 && box.y + box.height >= 800 - 40;
        }).toBe(true);
        await part(page, "skip").click();
        expect(await ended(page)).toEqual({outcome: "dismissed"});
    });
});

test.describe("压暗与不改页面（输出 10）", () => {
    const FIXTURE = `<style>body{background:#fff}#go{position:absolute;left:300px;top:300px;width:120px;height:40px;background:#fff;border:0;padding:0}</style>
<button id="go">保存</button>`;

    test("dim 为真时目标以外变暗，目标与说明框不暗；不给 dim 时哪里都不暗", async ({page}) => {
        await page.emulateMedia({reducedMotion: "reduce"});
        await openFixture(page, FIXTURE);
        const far = [40, 700] as const;
        const targetPoint = [360, 320] as const;

        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next"});
        await installed(page);
        const callout = (await part(page, "callout").boundingBox())!;
        const calloutPoint = [Math.round(callout.x + callout.width - 6), Math.round(callout.y + callout.height / 2)] as const;
        const plain = {far: await pixel(page, ...far), target: await pixel(page, ...targetPoint), callout: await pixel(page, ...calloutPoint)};
        expect(luminance(plain.far)).toBeGreaterThan(250);
        await part(page, "skip").click();
        await ended(page);

        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next", dim: true});
        await installed(page);
        const dimCallout = (await part(page, "callout").boundingBox())!;
        expect([dimCallout.x, dimCallout.y]).toEqual([callout.x, callout.y]);
        const dimmed = {far: await pixel(page, ...far), target: await pixel(page, ...targetPoint), callout: await pixel(page, ...calloutPoint)};
        expect(luminance(dimmed.far)).toBeLessThan(luminance(plain.far) - 40);
        expect(dimmed.target).toEqual(plain.target);
        // 说明框的底色有 3% 透明，透出一点底下的压暗；要求的是看上去不暗（差几个灰度级内），不是逐像素相等。
        expect(Math.abs(luminance(dimmed.callout) - luminance(plain.callout))).toBeLessThan(8);
    });

    test("高亮不改页面元素的样式与属性：除引擎自己的节点外，页面前后一字不差", async ({page}) => {
        await openFixture(page, FIXTURE);
        const dump = () => page.evaluate(() => {
            const pageNodes = [...document.body.children].filter((node) => node.getAttribute("data-nb-page-agent") === null);
            const target = document.getElementById("go")!;
            const computed = getComputedStyle(target);
            return {
                html: pageNodes.map((node) => node.outerHTML),
                root: document.documentElement.outerHTML.replace(/<body[\s\S]*<\/body>/u, ""),
                style: Object.fromEntries([...computed].map((name) => [name, computed.getPropertyValue(name)])),
            };
        });
        const before = await dump();
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next", dim: true});
        await installed(page);
        await expect(part(page, "dim")).toHaveCount(1);
        const during = await dump();
        expect(during.html).toEqual(before.html);
        expect(during.root).toEqual(before.root);
        expect(during.style).toEqual(before.style);
        await part(page, "skip").click();
        await ended(page);
        expect(await dump()).toEqual(before);
    });
});

test.describe("过渡（输出 10）", () => {
    test("撤掉时先淡出：不减弱动效时宿主带过 data-closing 才移除；结局交出时已经移除", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px">保存</button>`);
        await page.evaluate(() => {
            const log = {closing: false};
            (window as unknown as {log: typeof log}).log = log;
            new MutationObserver((records) => {
                for (const record of records) if (record.target instanceof Element && record.target.hasAttribute("data-closing")) log.closing = true;
            }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ["data-closing"]});
        });
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next"});
        await installed(page);
        await part(page, "skip").click();
        expect(await ended(page)).toEqual({outcome: "dismissed"});
        expect(await page.evaluate(() => document.querySelectorAll("[data-nb-page-agent]").length)).toBe(0);
        expect(await page.evaluate(() => (window as unknown as {log: {closing: boolean}}).log.closing)).toBe(true);
    });
});
