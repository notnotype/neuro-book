/**
 * 高亮与说明框（docs/specs/agent/page-agent.md 输出 9、10）：结局怎样判定、哪些按下不算点错、说明框不动页面的焦点与按键、
 * 挂进目标所在的层、跟着目标动。真实弹层库（命令面板、下拉）的用例在应用的 e2e。
 */

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

import {ended, installed, openFixture, startHighlight, stillWaiting} from "./page";

// Playwright 的无头 Chrome 默认带 --hide-scrollbars，页面上没有滚动条；“按在滚动条上不算点错”要真的有滚动条。
test.use({launchOptions: {ignoreDefaultArgs: ["--hide-scrollbars"]}});

const part = (page: Page, name: string) => page.locator(`[data-nb-page-agent="${name}"]`);

/** 页面上一个引擎节点都没有：高亮撤干净了。 */
async function expectRemoved(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.querySelectorAll("[data-nb-page-agent]").length)).toBe(0);
}

test.describe("说明框（输出 10）", () => {
    test("写标题、说明与进度；要按下一步的步骤有“下一步”，最后一步写“完成”，给了 back 才有“上一步”；等点目标的两个都没有", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px">保存</button>`);
        await startHighlight(page, {at: {text: "保存"}, title: "存一下", message: "点这里保存。", until: "next", step: 1, total: 3});
        expect(await installed(page)).toMatchObject({target: {role: "button", name: "保存"}});
        await expect(part(page, "callout")).toContainText("存一下");
        await expect(part(page, "callout")).toContainText("点这里保存。");
        await expect(part(page, "callout")).toContainText("Step 1 of 3");
        await expect(part(page, "next")).toHaveText("Next");
        await expect(part(page, "back")).toHaveCount(0);
        await expect(part(page, "callout")).toHaveAttribute("data-step", "1");

        await startHighlight(page, {at: {text: "保存"}, message: "最后一步。", until: "next", step: 3, total: 3, back: true});
        await installed(page);
        await expect(part(page, "callout")).toHaveCount(1);
        await expect(part(page, "next")).toHaveText("Done");
        await expect(part(page, "back")).toHaveText("Back");

        await startHighlight(page, {at: {text: "保存"}, message: "点它。", until: "click", back: true});
        await installed(page);
        await expect(part(page, "callout")).toHaveCount(1);
        await expect(part(page, "next")).toHaveCount(0);
        await expect(part(page, "back")).toHaveCount(0);
        await expect(part(page, "skip")).toHaveCount(1);
        await expect(part(page, "ask-open")).toHaveCount(1);
    });

    test("宿主给的文字表与悬停显示钩子：按钮用宿主的文字；高亮期间钩子让目标显示，撤掉时还原", async ({page}) => {
        await openFixture(page, `<div data-zone style="margin:200px"><button id="go">删除</button></div>`);
        await page.evaluate(() => {
            window.agent = window.nbPageAgent.createPageAgent({refPrefix: "t2", guide: {
                text: () => ({progress: (step, total) => `第 ${String(step)} 步，共 ${String(total)} 步`, next: "下一步", done: "完成", back: "上一步", skip: "跳过引导", ask: "提问", askPlaceholder: "问 Agent…", askSubmit: "发送", askClose: "不问了"}),
                reveal: (target) => {
                    const zone = target.closest("[data-zone]");
                    zone?.setAttribute("data-shown", "");
                    return () => zone?.removeAttribute("data-shown");
                },
            }});
        });
        await startHighlight(page, {at: {text: "删除"}, message: "在这里。", until: "next", step: 2, total: 3});
        await installed(page);
        await expect(part(page, "callout")).toContainText("第 2 步，共 3 步");
        await expect(part(page, "skip")).toHaveText("跳过引导");
        await expect(page.locator("[data-zone]")).toHaveAttribute("data-shown", "");
        await part(page, "skip").click();
        expect(await ended(page)).toEqual({outcome: "dismissed"});
        await expect(page.locator("[data-zone]")).not.toHaveAttribute("data-shown", "");
    });

    test("描边框在目标外侧 3px；小于 28 的目标按 28 画；贴着视口边的目标画在里面", async ({page}) => {
        // 描边框出现时有一下缩放，量框之前关掉动效。
        await page.emulateMedia({reducedMotion: "reduce"});
        await openFixture(page, `
<button id="tiny" aria-label="小" style="position:absolute;left:300px;top:300px;width:10px;height:10px;padding:0"></button>
<button id="wide" style="position:absolute;left:300px;top:400px;width:120px;height:32px">宽</button>
<div role="region" aria-label="整页" style="position:fixed;inset:0;pointer-events:none"><button>一</button><button>二</button></div>`);
        await startHighlight(page, {at: {role: "button", name: "宽"}, message: "宽的。", until: "next"});
        await installed(page);
        const wide = (await page.locator("#wide").boundingBox())!;
        expect(await part(page, "outline").boundingBox()).toEqual({x: wide.x - 3, y: wide.y - 3, width: wide.width + 6, height: wide.height + 6});
        await expect(part(page, "outline")).not.toHaveAttribute("data-inside", "");

        await startHighlight(page, {at: {role: "button", name: "小"}, message: "小的。", until: "next"});
        await installed(page);
        await expect(part(page, "outline")).toHaveCount(1);
        // 按以目标中心为中心的 28×28 画，再外扩 3px。
        const tiny = (await page.locator("#tiny").boundingBox())!;
        expect(tiny.width).toBeLessThan(28);
        const center = {x: tiny.x + tiny.width / 2, y: tiny.y + tiny.height / 2};
        expect(await part(page, "outline").boundingBox()).toEqual({x: center.x - 17, y: center.y - 17, width: 34, height: 34});

        await startHighlight(page, {at: {role: "region", name: "整页"}, message: "整页。", until: "next"});
        await installed(page);
        await expect(part(page, "outline")).toHaveCount(1);
        await expect(part(page, "outline")).toHaveAttribute("data-inside", "");
        expect(await part(page, "outline").boundingBox()).toEqual({x: 2, y: 2, width: 1276, height: 796});
    });

    test("dim 为真时才有压暗层；压暗不挡点击，点在目标以外的按钮照常响应并得 missed", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px">保存</button><button id="other" onclick="window.hits=(window.hits??0)+1">取消</button>`);
        await startHighlight(page, {at: {text: "保存"}, message: "点这里。", until: "click"});
        await installed(page);
        await expect(part(page, "dim")).toHaveCount(0);
        await startHighlight(page, {at: {text: "保存"}, message: "点这里。", until: "click", dim: true});
        await installed(page);
        await expect(part(page, "dim")).toHaveCount(1);
        await page.locator("#other").click();
        expect(await ended(page)).toMatchObject({outcome: "missed", clicked: {role: "button", name: "取消"}});
        expect(await page.evaluate(() => (window as unknown as {hits?: number}).hits)).toBe(1);
        await expectRemoved(page);
    });

    test("减弱动效时没有动画与过渡；不减弱时描边框出现有动画", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px">保存</button>`);
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next"});
        await installed(page);
        expect(await page.evaluate(() => document.querySelector("[data-nb-page-agent=guide]")!.shadowRoot!.getAnimations().length)).toBeGreaterThan(0);
        await page.emulateMedia({reducedMotion: "reduce"});
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next"});
        await installed(page);
        await expect(part(page, "callout")).toHaveCount(1);
        expect(await page.evaluate(() => [...document.querySelectorAll("[data-nb-page-agent=guide]")].map((host) => host.shadowRoot!.getAnimations().length))).toEqual([0]);
    });
});

test.describe("结局（输出 9）", () => {
    test("下一步、上一步、跳过引导各得 next、back、dismissed；结局交出时页面上已经没有引擎的节点", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px">保存</button>`);
        for (const [button, outcome] of [["next", "next"], ["back", "back"], ["skip", "dismissed"]] as const) {
            await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next", back: true});
            await installed(page);
            await part(page, button).click();
            expect(await ended(page)).toEqual({outcome});
            await expectRemoved(page);
        }
    });

    test("等点目标：鼠标点到目标得 clicked，页面自己的点击处理照常执行；焦点在目标上按 Enter 也算", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px" onclick="window.hits=(window.hits??0)+1"><span>保存</span></button>`);
        await startHighlight(page, {at: {text: "保存"}, message: "点这里。", until: "click"});
        await installed(page);
        await page.locator("#go span").click();
        expect(await ended(page)).toEqual({outcome: "clicked"});
        expect(await page.evaluate(() => (window as unknown as {hits?: number}).hits)).toBe(1);
        await expectRemoved(page);

        await page.locator("#go").focus();
        await startHighlight(page, {at: {text: "保存"}, message: "按回车。", until: "click"});
        await installed(page);
        await page.keyboard.press("Enter");
        expect(await ended(page)).toEqual({outcome: "clicked"});
    });

    test("目标在抬起指针时就被页面拿走（没有 click）：仍算 clicked", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px" onpointerup="this.remove()">选我</button>`);
        await startHighlight(page, {at: {text: "选我"}, message: "点它。", until: "click"});
        await installed(page);
        await page.locator("#go").click();
        expect(await ended(page)).toEqual({outcome: "clicked"});
    });

    test("目标从页面上拿走得 gone；开始新的高亮时旧的得 replaced，页面上只剩新的；宿主取消得 cancelled", async ({page}) => {
        await openFixture(page, `<button id="a" style="margin:200px">甲</button><button id="b">乙</button>`);
        await startHighlight(page, {at: {text: "甲"}, message: "甲。", until: "next"});
        await installed(page);
        await page.evaluate(() => document.getElementById("a")!.remove());
        expect(await ended(page)).toEqual({outcome: "gone"});
        await expectRemoved(page);

        await startHighlight(page, {at: {text: "乙"}, message: "乙。", until: "next"});
        await installed(page);
        await page.evaluate(() => {
            (window as unknown as {first: Window["guide"]}).first = window.guide;
        });
        await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<button id="c">丙</button>`));
        await startHighlight(page, {at: {text: "丙"}, message: "丙。", until: "next"});
        await installed(page);
        await page.waitForFunction(() => (window as unknown as {first: Window["guide"]}).first?.ended !== undefined);
        expect(await page.evaluate(() => (window as unknown as {first: Window["guide"]}).first!.ended)).toEqual({outcome: "replaced"});
        await expect(part(page, "callout")).toHaveCount(1);
        await expect(part(page, "callout")).toContainText("丙。");

        await page.evaluate(() => window.guide!.handle.cancel());
        expect(await ended(page)).toEqual({outcome: "cancelled"});
        await expectRemoved(page);
    });
});

test.describe("等目标（输出 9）", () => {
    test("目标稍后才出现：出现后装上；一直不出现到上限得 not-found，说明写明等了多久", async ({page}) => {
        await openFixture(page, `<main></main>`, {targetWaitMs: 1500});
        await startHighlight(page, {at: {text: "稍后"}, message: "这里。", until: "next"});
        await page.evaluate(() => setTimeout(() => document.querySelector("main")!.insertAdjacentHTML("beforeend", `<button>稍后</button>`), 300));
        expect(await installed(page)).toMatchObject({target: {name: "稍后"}});
        await part(page, "next").click();
        expect(await ended(page)).toEqual({outcome: "next"});

        await startHighlight(page, {at: {text: "永远不来"}, message: "这里。", until: "next"});
        expect(await installed(page)).toBeNull();
        const result = await ended(page);
        expect(result).toMatchObject({ok: false, code: "not-found"});
        if ("code" in result) expect(result.message).toContain("等了 1.5 秒");
    });

    test("命中多个不等，直接得 ambiguous 带候选；写错的定位当场抛错", async ({page}) => {
        await openFixture(page, `<button>保存</button><button>保存</button>`);
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next"});
        expect(await installed(page)).toBeNull();
        const result = await ended(page);
        expect(result).toMatchObject({ok: false, code: "ambiguous"});
        if ("code" in result) expect(result.details?.candidates).toHaveLength(2);
        await expect(startHighlight(page, {at: {}, message: "这里。", until: "next"})).rejects.toThrow(/定位要给/u);
    });
});

test.describe("焦点、按键与弹层（输出 10）", () => {
    test("点说明框不移走焦点与选区；提问框展开不改说明框的高度；Esc 清空收起、焦点与选区回到原处", async ({page}) => {
        await openFixture(page, `<input id="field" value="abcdef"><button id="go" style="margin:200px">保存</button>`);
        await page.evaluate(() => {
            const field = document.getElementById("field") as HTMLInputElement;
            field.focus();
            field.setSelectionRange(1, 3);
        });
        const focusState = () => page.evaluate(() => {
            const field = document.getElementById("field") as HTMLInputElement;
            return {active: document.activeElement?.id, start: field.selectionStart, end: field.selectionEnd};
        });
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next"});
        await installed(page);
        expect(await focusState()).toEqual({active: "field", start: 1, end: 3});
        await part(page, "callout").locator(".message").click();
        expect(await focusState()).toEqual({active: "field", start: 1, end: 3});

        const before = (await part(page, "callout").boundingBox())!.height;
        await part(page, "ask-open").click();
        await expect(part(page, "callout")).toHaveAttribute("data-asking", "");
        expect(await page.evaluate(() => document.querySelector("[data-nb-page-agent=guide]")!.shadowRoot!.activeElement?.getAttribute("data-nb-page-agent"))).toBe("ask");
        expect((await part(page, "callout").boundingBox())!.height).toBeCloseTo(before, 0);
        await page.keyboard.type("随便");
        await page.keyboard.press("Escape");
        await expect(part(page, "callout")).not.toHaveAttribute("data-asking", "");
        await expect(part(page, "ask")).toHaveValue("");
        expect(await focusState()).toEqual({active: "field", start: 1, end: 3});
        expect(await stillWaiting(page)).toBe(true);
    });

    test("提问：回车交出 asked 与问题，焦点回到原处；组字时的回车与空白问题不交", async ({page}) => {
        await openFixture(page, `<input id="field" value="abc"><button id="go" style="margin:200px">保存</button>`);
        await page.locator("#field").focus();
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "click"});
        await installed(page);
        await part(page, "ask-open").click();
        await page.keyboard.press("Enter");
        await page.keyboard.type("主题和外观有什么区别？");
        await part(page, "ask").evaluate((input) => input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", isComposing: true, bubbles: true, composed: true})));
        expect(await stillWaiting(page)).toBe(true);
        await page.keyboard.press("Enter");
        expect(await ended(page)).toEqual({outcome: "asked", question: "主题和外观有什么区别？"});
        expect(await page.evaluate(() => document.activeElement?.id)).toBe("field");
        await expectRemoved(page);
    });

    test("说明框里的按键与输入不交给页面：文档上冒泡阶段的监听收不到", async ({page}) => {
        await openFixture(page, `<button id="go" style="margin:200px">保存</button>`);
        await page.evaluate(() => {
            const seen: string[] = [];
            (window as unknown as {seen: string[]}).seen = seen;
            for (const type of ["keydown", "keyup", "keypress", "beforeinput", "input", "click", "pointerdown"]) document.addEventListener(type, () => seen.push(type));
        });
        await startHighlight(page, {at: {text: "保存"}, message: "这里。", until: "next"});
        await installed(page);
        await part(page, "ask-open").click();
        await page.keyboard.type("ab");
        await page.keyboard.press("ArrowDown");
        expect(await page.evaluate(() => (window as unknown as {seen: string[]}).seen)).toEqual([]);
    });

    test("挂进目标所在的层：点外面就关的弹出菜单里，点说明框不关菜单；原生模态对话框里的说明框点得到", async ({page}) => {
        await openFixture(page, `
<div id="menu" role="menu" style="position:absolute;left:100px;top:100px;padding:8px;border:1px solid #888">
  <div role="menuitem" tabindex="-1">甲</div><div role="menuitem" tabindex="-1">乙</div>
</div>
<dialog id="dialog"><button>里面</button><button>别的</button></dialog>`);
        await page.evaluate(() => {
            const menu = document.getElementById("menu")!;
            document.addEventListener("pointerdown", (event) => {
                if (!menu.contains(event.target as Node)) menu.remove();
            }, true);
        });
        await startHighlight(page, {at: {role: "menuitem", name: "甲"}, message: "选甲。", until: "next"});
        await installed(page);
        expect(await page.evaluate(() => document.querySelector("[data-nb-page-agent=guide]")!.parentElement?.id)).toBe("menu");
        await part(page, "callout").locator(".message").click();
        await expect(page.locator("#menu")).toHaveCount(1);
        await part(page, "next").click();
        expect(await ended(page)).toEqual({outcome: "next"});

        await page.evaluate(() => (document.getElementById("dialog") as HTMLDialogElement).showModal());
        await startHighlight(page, {at: {text: "里面"}, message: "点下一步。", until: "next"});
        await installed(page);
        expect(await page.evaluate(() => document.querySelector("[data-nb-page-agent=guide]")!.parentElement?.id)).toBe("dialog");
        await part(page, "next").click();
        expect(await ended(page)).toEqual({outcome: "next"});
    });
});

test.describe("换层（输出 10）", () => {
    test("目标所在的层被关掉而目标还在：说明框换到目标现在所在的层继续显示；高亮整个层时点说明框不算点了目标", async ({page}) => {
        await openFixture(page, `<div id="menu" role="menu" style="position:absolute;left:100px;top:100px;padding:8px"><div id="item" role="menuitem" tabindex="-1">甲</div></div>`);
        await startHighlight(page, {at: {role: "menuitem", name: "甲"}, message: "选甲。", until: "next"});
        await installed(page);
        expect(await page.evaluate(() => document.querySelector("[data-nb-page-agent=guide]")!.parentElement?.id)).toBe("menu");
        await page.evaluate(() => {
            document.body.append(document.getElementById("item")!);
            document.getElementById("menu")!.remove();
        });
        await expect.poll(() => page.evaluate(() => document.querySelector("[data-nb-page-agent=guide]")?.parentElement?.localName)).toBe("body");
        await expect(part(page, "callout")).toBeVisible();
        expect(await stillWaiting(page)).toBe(true);

        await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<div id="menu2" role="menu" aria-label="菜单" style="position:absolute;left:400px;top:100px;padding:8px"><div role="menuitem">一</div><div role="menuitem">二</div></div>`));
        await startHighlight(page, {at: {role: "menu", name: "菜单"}, message: "整个菜单。", until: "click"});
        await installed(page);
        // 上一次高亮被替换后还在淡出，只看这一次的宿主。
        expect(await page.evaluate(() => document.querySelector("[data-nb-page-agent=guide]:not([data-closing])")!.parentElement?.id)).toBe("menu2");
        await expect(part(page, "callout")).toHaveCount(1);
        await part(page, "callout").locator(".message").click();
        expect(await stillWaiting(page)).toBe(true);
    });
});

test.describe("跟随与滚出视野（输出 9）", () => {
    test("目标挪了描边框跟过去；滚出滚动区域时描边框藏起、说明框停在区域里离目标最近的边上，滚回来再出现", async ({page}) => {
        await page.emulateMedia({reducedMotion: "reduce"});
        await openFixture(page, `
<button id="go" style="position:absolute;left:300px;top:100px">挪我</button>
<div id="box" style="position:absolute;left:600px;top:200px;width:400px;height:300px;overflow:auto">
  <div style="height:1500px"><button style="margin-top:100px">深处</button></div>
</div>`);
        await startHighlight(page, {at: {text: "挪我"}, message: "跟着。", until: "next", dim: true});
        await installed(page);
        const x0 = (await part(page, "outline").boundingBox())!.x;
        await page.evaluate(() => {
            document.getElementById("go")!.style.left = "400px";
        });
        await expect.poll(async () => (await part(page, "outline").boundingBox())!.x).toBe(x0 + 100);

        await startHighlight(page, {at: {text: "深处"}, message: "在下面。", until: "next", dim: true});
        await installed(page);
        await page.evaluate(() => {
            document.getElementById("box")!.scrollTop = 800;
        });
        await expect(part(page, "outline")).toHaveAttribute("data-hidden", "");
        await expect(part(page, "dim")).toHaveAttribute("data-hidden", "");
        // 目标在上面：说明框贴着区域的上边，放在区域里。
        await expect.poll(async () => {
            const box = (await part(page, "callout").boundingBox())!;
            return box.y >= 200 && box.y < 230 && box.x >= 600 - 8 && box.x + box.width <= 1000 + 8;
        }).toBe(true);
        await page.evaluate(() => {
            document.getElementById("box")!.scrollTop = 0;
        });
        await expect(part(page, "outline")).not.toHaveAttribute("data-hidden", "");
        await expect(part(page, "dim")).not.toHaveAttribute("data-hidden", "");
    });

    test("目标在滚动区域外面：先滚进视野再画", async ({page}) => {
        await openFixture(page, `
<div id="box" style="position:absolute;left:100px;top:100px;width:300px;height:200px;overflow:auto">
  <div style="height:2000px"><button style="margin-top:1500px">很远</button></div>
</div>`);
        await startHighlight(page, {at: {text: "很远"}, message: "在这里。", until: "next"});
        await installed(page);
        expect(await page.evaluate(() => document.getElementById("box")!.scrollTop)).toBeGreaterThan(1200);
        await expect(part(page, "outline")).not.toHaveAttribute("data-hidden", "");
    });
});

test.describe("点错（输出 9）", () => {
    test("点错：主键按在别的控件上得 missed，带那个控件；右键、说明框、滚动条与铺满视口的遮罩都不算", async ({page}) => {
        await openFixture(page, `
<button id="go" style="position:absolute;left:400px;top:300px">保存</button>
<button id="other" style="position:absolute;left:600px;top:300px"><span id="icon">✕</span> 取消</button>
<div id="scroller" style="position:absolute;left:40px;top:40px;width:200px;height:120px;overflow:scroll"><div style="height:600px;width:600px"></div></div>`);
        await startHighlight(page, {at: {text: "保存"}, message: "点保存。", until: "click"});
        await installed(page);

        await page.locator("#other").click({button: "right"});
        expect(await stillWaiting(page)).toBe(true);
        await part(page, "callout").locator(".message").click();
        expect(await stillWaiting(page)).toBe(true);
        const scroller = (await page.locator("#scroller").boundingBox())!;
        await page.mouse.click(scroller.x + scroller.width - 4, scroller.y + 30);
        expect(await stillWaiting(page)).toBe(true);
        await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<div id="backdrop" style="position:fixed;inset:0"></div>`));
        await page.mouse.click(20, 780);
        expect(await stillWaiting(page)).toBe(true);

        await page.evaluate(() => document.getElementById("backdrop")!.remove());
        await page.locator("#icon").click();
        const result = await ended(page);
        expect(result).toMatchObject({outcome: "missed", clicked: {role: "button", name: "✕ 取消"}});
        await expectRemoved(page);
    });
});
