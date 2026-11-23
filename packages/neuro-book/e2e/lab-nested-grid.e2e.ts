/**
 * 嵌套 Grid 用户手势与两轴几何在 Component Lab 里的真实浏览器验收（docs/specs/ui/nested-grid.md）。原来在 nb-ui 的
 * playground 验收页（`e2e/nested-grid.spec.ts`），NestedGrid 搬到 nb-layout 后并进应用的 Lab；场景夹具是
 * `fixtures/nb-layout/NestedGridAcceptanceFixture.vue`，断言与旧用例相同。
 * 1. 外层拖动守恒与内层高不变
 * 2. 内层拖动不改外层宽
 * 3. 键盘连发单次提交
 * 4. Escape 零提交
 * 5. 程序布局零提交
 * 6. 三个恢复场景：未知引用过滤保留原件、畸形快照拒绝、高版本快照拒绝
 * 7. 主题（nbook、macos）× 配色（light、dark）× 桌面与 390×844 画布的几何与一次键盘调整
 * 8. 分隔线的对齐只跟挪得动它的滚动，位置没变时不写
 * 9. 视口变化、承载盒显隐零提交；减少动效下的悬停显现；Tab 聚焦全亮；祖先缩放下的位移换算
 *
 * 手势一律以 px 提交（`GridGestureCommit.changes`），断言面是真实 DOM 几何与提交载荷。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-nested-grid");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

/**
 * 打开 NestedGrid 的一个场景。浏览器窗口固定足够大，Lab 外壳本身放不进 390 宽的窗口；窄屏用 `vp=` 把舞台画布设成
 * 390×844，被测网格在画布里受窄。配色只写 `light`、`dark`：Lab 只装 nbook 的两套配色，写别的 id 会悄悄落回默认。
 */
async function gotoNestedGrid(
    page: Page,
    options: {
        scene?: string;
        theme?: string;
        colorway?: "light" | "dark";
        canvas?: string;
    } = {},
): Promise<void> {
    await page.setViewportSize({width: 1440, height: 1200});
    const query = new URLSearchParams({
        c: "NestedGrid",
        s: options.scene ?? "default",
        theme: options.theme ?? "nbook",
        cw: options.colorway ?? "light",
    });
    if (options.canvas !== undefined) query.set("vp", options.canvas);
    await page.goto(`${dev.pageUrl}lab?${query.toString()}`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await expect(page.locator("#nb-lab-target")).toBeVisible();
}

async function showEventLog(page: Page): Promise<void> {
    // 事件日志画在舞台里，一直显示，不用切页签。
    await expect(page.locator(".acc-events__header")).toBeVisible();
}

async function eventNames(page: Page): Promise<string[]> {
    return page.locator(".acc-events__row .acc-events__name").allTextContents();
}

function nestedGridLocators(page: Page) {
    return {
        // 分隔线身份就是分支 id 与边界序号：外层 root:0、内层 right:0
        outerSash: page.locator("#nb-lab-target [data-sash='root:0']"),
        innerSash: page.locator("#nb-lab-target [data-sash='right:0']"),
        leftLeaf: page.locator("#nb-lab-target [data-leaf='left']"),
        topLeaf: page.locator("#nb-lab-target [data-leaf='top']"),
        bottomLeaf: page.locator("#nb-lab-target [data-leaf='bottom']"),
        gesture: page.locator("[data-lab-gesture]"),
        recovery: page.locator("[data-lab-recovery]"),
    };
}

test("外层拖动守恒与内层高不变", async ({page}) => {
    await gotoNestedGrid(page);

    const {outerSash, innerSash, leftLeaf, topLeaf, bottomLeaf, gesture} = nestedGridLocators(page);
    await expect(outerSash).toBeVisible();
    await expect(innerSash).toBeVisible();
    await expect(outerSash).toHaveCSS("width", "7px");
    await expect(innerSash).toHaveCSS("height", "7px");

    const beforeLeft = (await leftLeaf.boundingBox())!;
    const beforeRight = (await topLeaf.boundingBox())!;
    const beforeTop = (await topLeaf.boundingBox())!;
    const beforeBottom = (await bottomLeaf.boundingBox())!;
    expect(beforeLeft).not.toBeNull();
    expect(beforeRight).not.toBeNull();
    expect(beforeTop).not.toBeNull();
    expect(beforeBottom).not.toBeNull();

    const sashBox = (await outerSash.boundingBox())!;
    expect(sashBox).not.toBeNull();
    const startX = sashBox.x + sashBox.width / 2;
    const startY = sashBox.y + sashBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY, {steps: 6});
    await page.mouse.up();


    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
    await expect(gesture).toHaveAttribute("data-lab-last-sash", "left~right");

    const activeText = await gesture.getAttribute("data-lab-last-active");
    expect(JSON.parse(activeText!)).toEqual(["left", "right"]);

    const afterLeft = (await leftLeaf.boundingBox())!;
    const afterRight = (await topLeaf.boundingBox())!;
    const afterTop = (await topLeaf.boundingBox())!;
    const afterBottom = (await bottomLeaf.boundingBox())!;

    // 外层主轴：左栏变宽、右分支变窄，且两者之和守恒
    expect(afterLeft.width).toBeGreaterThan(beforeLeft.width);
    expect(afterRight.width).toBeLessThan(beforeRight.width);
    expect(afterLeft.width + afterRight.width).toBeCloseTo(beforeLeft.width + beforeRight.width, 0);

    // 内层纵轴：高完全不变（两轴独立性）
    expect(afterTop.height).toBeCloseTo(beforeTop.height, 1);
    expect(afterBottom.height).toBeCloseTo(beforeBottom.height, 1);

    // 提交载荷是 px：同一分支的目标与基线守恒，且与真实渲染宽度同源
    const payload = JSON.parse((await gesture.getAttribute("data-lab-gesture-payload"))!);
    const change = payload.changes[0];
    expect(change.axis).toBe("width");
    const sum = (values: Record<string, number>) => Object.values(values).reduce((total, value) => total + value, 0);
    expect(sum(change.target)).toBeCloseTo(sum(change.baseline), 5);
    expect(change.target.left).toBeGreaterThan(change.baseline.left);
    expect(change.target.left).toBeCloseTo(afterLeft.width, 0);
    // 量到的宽度是外框取整后的，记下的意图没取整，最多差半个像素。
    expect(Math.abs(change.target.right - afterRight.width)).toBeLessThanOrEqual(0.5);

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "gesture-start")).toHaveLength(1);
    expect(names.filter((n) => n === "gesture-end")).toHaveLength(1);
    expect(names.filter((n) => n === "gesture-cancel")).toHaveLength(0);
});

test("内层拖动不改外层宽", async ({page}) => {
    await gotoNestedGrid(page);

    const {outerSash, innerSash, leftLeaf, topLeaf, bottomLeaf, gesture} = nestedGridLocators(page);
    await expect(outerSash).toBeVisible();
    await expect(innerSash).toBeVisible();

    const beforeLeft = (await leftLeaf.boundingBox())!;
    const beforeRight = (await topLeaf.boundingBox())!;
    const beforeTop = (await topLeaf.boundingBox())!;
    const beforeBottom = (await bottomLeaf.boundingBox())!;

    const sashBox = (await innerSash.boundingBox())!;
    expect(sashBox).not.toBeNull();
    const startX = sashBox.x + sashBox.width / 2;
    const startY = sashBox.y + sashBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY + 40, {steps: 6});
    await page.mouse.up();


    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
    await expect(gesture).toHaveAttribute("data-lab-last-sash", "top~bottom");

    const activeText = await gesture.getAttribute("data-lab-last-active");
    expect(JSON.parse(activeText!)).toEqual(["top", "bottom"]);

    const afterLeft = (await leftLeaf.boundingBox())!;
    const afterRight = (await topLeaf.boundingBox())!;
    const afterTop = (await topLeaf.boundingBox())!;
    const afterBottom = (await bottomLeaf.boundingBox())!;

    // 内层纵轴：上栏变高、下栏变矮，且总高守恒
    expect(afterTop.height).toBeGreaterThan(beforeTop.height);
    expect(afterBottom.height).toBeLessThan(beforeBottom.height);
    expect(afterTop.height + afterBottom.height).toBeCloseTo(beforeTop.height + beforeBottom.height, 0);

    // 外层横轴：列宽完全不变（两轴独立性）
    expect(afterLeft.width).toBeCloseTo(beforeLeft.width, 1);
    expect(afterRight.width).toBeCloseTo(beforeRight.width, 1);

    // 提交载荷只包含内层分支的高度变化
    const payload = JSON.parse((await gesture.getAttribute("data-lab-gesture-payload"))!);
    expect(payload.changes.map((change: {branchId: string; axis: string}) => [change.branchId, change.axis]))
        .toEqual([["right", "height"]]);
    expect(payload.changes[0].target.top).toBeCloseTo(afterTop.height, 0);
    expect(payload.changes[0].target.bottom).toBeCloseTo(afterBottom.height, 0);
});

test("键盘连发单次提交", async ({page}) => {
    await gotoNestedGrid(page);

    const {outerSash, gesture} = nestedGridLocators(page);
    await outerSash.focus();
    await expect(outerSash).toBeFocused();

    // 连续触发 keydown，最后释放
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");


    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
    await expect(gesture).toHaveAttribute("data-lab-gesture-source", "keyboard");

    // 三次 10px 的位移一次提交：目标比基线多 30px
    const payload = JSON.parse((await gesture.getAttribute("data-lab-gesture-payload"))!);
    const change = payload.changes[0];
    expect(change.target.left - change.baseline.left).toBeCloseTo(30, 5);

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "gesture-start")).toHaveLength(1);
    expect(names.filter((n) => n === "gesture-end")).toHaveLength(1);
});

test("Escape 零提交", async ({page}) => {
    await gotoNestedGrid(page);

    const {outerSash, gesture} = nestedGridLocators(page);
    const box = (await outerSash.boundingBox())!;
    expect(box).not.toBeNull();

    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY, {steps: 4});
    await page.keyboard.press("Escape");
    await page.mouse.up();


    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "cancel");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "0");
    await expect(gesture).toHaveAttribute("data-lab-last-sash", "left~right");

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "gesture-end")).toHaveLength(0);
    expect(names.filter((n) => n === "gesture-cancel")).toHaveLength(1);
});

test("程序布局零提交", async ({page}) => {
    await gotoNestedGrid(page);

    const {leftLeaf, gesture} = nestedGridLocators(page);
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "0");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "none");

    const beforeLeft = (await leftLeaf.boundingBox())!;
    await page.locator("[data-lab-action=programmatic-layout]").click();

    // 呈现几何已更新
    const afterLeft = (await leftLeaf.boundingBox())!;
    expect(afterLeft.width).not.toBeCloseTo(beforeLeft.width, 1);

    // 提交次数保持为 0，手势状态保持为 none
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "0");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "none");

    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "gesture-end")).toHaveLength(0);
});

const twoFrames = (page: Page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test("视口变化、承载盒隐藏再显示都不报告为用户提交（输出 10）", async ({page}) => {
    await gotoNestedGrid(page);
    const {leftLeaf, gesture} = nestedGridLocators(page);
    const target = page.locator("#nb-lab-target");
    const width0 = (await target.boundingBox())!.width;

    // 组件的视口（Lab 的画布）变窄再变回来：网格确实重新量过、重新排过。浏览器窗口的尺寸不改画布，用画布的宽度手柄，方向键每次 10px。
    const handle = page.locator('.lab-main [aria-label="调整宽度"]');
    await handle.focus();
    for (let step = 0; step < 10; step += 1) await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => (await target.boundingBox())!.width).toBeLessThan(width0 - 20);
    for (let step = 0; step < 10; step += 1) await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await target.boundingBox())!.width).toBeCloseTo(width0, 0);

    // 承载盒临时隐藏再显示：网格量到零、再量回来。
    await target.evaluate((element: HTMLElement) => {
        element.style.display = "none";
    });
    await expect(leftLeaf).toBeHidden();
    await twoFrames(page);
    await target.evaluate((element: HTMLElement) => {
        element.style.display = "";
    });
    await expect(leftLeaf).toBeVisible();
    await twoFrames(page);

    await expect(gesture).toHaveAttribute("data-lab-commit-count", "0");
    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "none");
    await showEventLog(page);
    const names = await eventNames(page);
    expect(names.filter((n) => n === "layout").length).toBeGreaterThan(1);
    expect(names.filter((n) => n === "gesture-start" || n === "gesture-end")).toHaveLength(0);
});

test("减少动态效果：悬停照旧要停满时长才显现，线不渐显（输出 13）", async ({page}) => {
    // 配置里默认减少动态效果（playwright.config.ts 的 reducedMotion）。
    await gotoNestedGrid(page);
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const {outerSash} = nestedGridLocators(page);
    const box = (await outerSash.boundingBox())!;
    // 在页面里记下指针到线上的时刻与线显现的时刻：一步移过去，只有一次落在线上的 pointermove。
    await outerSash.evaluate((sash) => {
        const probe = {entered: 0, revealed: 0};
        (window as unknown as {__reveal: typeof probe}).__reveal = probe;
        window.addEventListener("pointermove", () => {
            if (probe.entered === 0) probe.entered = performance.now();
        }, {capture: true});
        new MutationObserver(() => {
            if (probe.revealed === 0 && sash.getAttribute("data-sash-revealed") === "true") probe.revealed = performance.now();
        }).observe(sash, {attributes: true, attributeFilter: ["data-sash-revealed"]});
    });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(outerSash).toHaveAttribute("data-sash-revealed", "true");
    const probe = await page.evaluate(() => (window as unknown as {__reveal: {entered: number; revealed: number}}).__reveal);
    expect(probe.entered).toBeGreaterThan(0);
    expect(probe.revealed - probe.entered).toBeGreaterThanOrEqual(245);
    const line = outerSash.locator(".sash-line");
    expect(await line.evaluate((element) => getComputedStyle(element).transitionDuration)).toBe("0s");
    expect(await line.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
});

test("Tab 走到分隔线：线立即全亮（输出 14）", async ({page}) => {
    await gotoNestedGrid(page);
    const {outerSash} = nestedGridLocators(page);
    // 从网格前面的按钮按 Tab 进来：键盘聚焦，`:focus-visible` 成立；指针不在线上。
    await page.locator("[data-lab-action=reset]").focus();
    await page.keyboard.press("Tab");
    await expect(outerSash).toBeFocused();
    await expect(outerSash).not.toHaveAttribute("data-sash-revealed", "true");
    expect(await outerSash.locator(".sash-line").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
});

test("祖先缩放：命中按屏幕上的位置，指针位移按根的缩放比换成布局 px（副作用与数据）", async ({page}) => {
    await gotoNestedGrid(page);
    const {outerSash, gesture} = nestedGridLocators(page);
    await page.locator("#nb-lab-target").evaluate((element: HTMLElement) => {
        element.style.transformOrigin = "0 0";
        element.style.transform = "scale(0.5)";
    });
    // 分隔线 7px 宽，屏幕上是一半。
    await expect.poll(async () => (await outerSash.boundingBox())!.width).toBeCloseTo(3.5, 1);
    const box = (await outerSash.boundingBox())!;
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY, {steps: 6});
    await page.mouse.up();

    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
    const change = JSON.parse((await gesture.getAttribute("data-lab-gesture-payload"))!).changes[0];
    // 屏幕上 60px 是布局里的 120px。
    expect(Math.abs(change.target.left - change.baseline.left - 120)).toBeLessThanOrEqual(2);
});

test("分隔线的对齐只跟挪得动它的滚动：叶里的滚动不排帧、不写分隔线；重新对齐时位置没变也不写", async ({page}) => {
    await gotoNestedGrid(page);
    // 叶里放一块能滚的内容：网格里面的滚动（资源管理器的树、编辑器正文）挪不动分隔线。
    await nestedGridLocators(page).topLeaf.evaluate((leaf) => {
        const scroller = document.createElement("div");
        scroller.dataset.testScroller = "";
        scroller.style.cssText = "position: absolute; inset: 0; overflow: auto;";
        scroller.innerHTML = "<div style=\"height: 4000px\"></div>";
        leaf.append(scroller);
    });
    const counts = await page.evaluate(async () => {
        const root = document.querySelector("#nb-lab-target [data-grid-scope]")!;
        const raw = window.requestAnimationFrame.bind(window);
        const twoFrames = (): Promise<void> => new Promise((done) => raw(() => raw(() => done())));
        await twoFrames();
        // 页面自己排的动画帧回调：等帧用上面的原函数，不算进去。
        let frames = 0;
        window.requestAnimationFrame = (callback) => raw((time) => {
            frames += 1;
            callback(time);
        });
        let writes = 0;
        const sashWrites = (records: MutationRecord[]): number => records.filter((record) => record.target instanceof Element && record.target.closest(".nb-grid-sash") !== null).length;
        const observer = new MutationObserver((records) => {
            writes += sashWrites(records);
        });
        observer.observe(root, {subtree: true, attributes: true, attributeFilter: ["style"]});
        const take = (): {frames: number; writes: number} => {
            writes += sashWrites(observer.takeRecords());
            const result = {frames, writes};
            frames = 0;
            writes = 0;
            return result;
        };
        const scroller = document.querySelector<HTMLElement>("[data-test-scroller]")!;
        for (let step = 0; step < 10; step += 1) {
            scroller.scrollTop += 100;
            await twoFrames();
        }
        const inside = {...take(), scrolled: scroller.scrollTop};
        // 文档的滚动算挪得动分隔线：重新对齐一次，但位置没变，一条都不写。
        document.dispatchEvent(new Event("scroll"));
        await twoFrames();
        const outside = take();
        observer.disconnect();
        return {inside, outside};
    });
    expect(counts.inside.scrolled).toBeGreaterThan(0);
    expect(counts.inside).toMatchObject({frames: 0, writes: 0});
    expect(counts.outside.frames).toBeGreaterThan(0);
    expect(counts.outside.writes).toBe(0);
});

/** 页面里没捕获的异常（验收 5）：在打开场景之前挂上。 */
function collectPageErrors(page: Page): Error[] {
    const errors: Error[] = [];
    page.on("pageerror", (error) => errors.push(error));
    return errors;
}

test("恢复场景：未知引用过滤但原件保留且调整后不丢；恢复不算用户提交，没有未捕获异常", async ({page}) => {
    const errors = collectPageErrors(page);
    await gotoNestedGrid(page, {scene: "unknown-ref"});

    const {outerSash, leftLeaf, topLeaf, bottomLeaf, gesture, recovery} = nestedGridLocators(page);
    await expect(recovery).toHaveAttribute("data-lab-restore-status", "dropped-unknown");
    await expect(recovery).toHaveAttribute("data-lab-dropped-count", "1");
    // 快照恢复不被报告为用户提交（输出 10）。
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "0");
    await showEventLog(page);
    expect((await eventNames(page)).filter((n) => n === "gesture-end")).toHaveLength(0);

    // 呈现层仅渲染已识别的节点，未识别的节点被过滤
    await expect(leftLeaf).toBeVisible();
    await expect(topLeaf).toBeVisible();
    await expect(bottomLeaf).toBeVisible();
    await expect(page.locator("#nb-lab-target [data-leaf=ghost-plugin]")).toHaveCount(0);

    // 内存原件完整保留 ghost-plugin
    const rawBefore = JSON.parse((await recovery.getAttribute("data-lab-raw-record"))!);
    expect(JSON.stringify(rawBefore)).toContain("ghost-plugin");
    expect(JSON.stringify(rawBefore)).toContain("unknown-plugin-view");

    // 用户调整已知节点
    await outerSash.focus();
    await page.keyboard.press("ArrowRight");

    await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
    await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");

    // 调整后原件依然保留未知部分（未抹除）
    const rawAfter = JSON.parse((await recovery.getAttribute("data-lab-raw-record"))!);
    expect(JSON.stringify(rawAfter)).toContain("ghost-plugin");
    expect(JSON.stringify(rawAfter)).toContain("unknown-plugin-view");
    expect(errors).toEqual([]);
});

test("恢复场景：畸形重复身份整体拒绝且无异常", async ({page}) => {
    const errors = collectPageErrors(page);
    await gotoNestedGrid(page, {scene: "malformed"});

    const {leftLeaf, topLeaf, bottomLeaf, recovery} = nestedGridLocators(page);
    await expect(recovery).toHaveAttribute("data-lab-restore-status", "rejected");
    await expect(recovery).toHaveAttribute("data-lab-restore-code", "duplicate-id");

    // 安全回退默认布局，页面不抛未捕获异常
    await expect(leftLeaf).toBeVisible();
    await expect(topLeaf).toBeVisible();
    await expect(bottomLeaf).toBeVisible();
    expect(errors).toEqual([]);
});

test("恢复场景：高版本快照整体拒绝且保留原件", async ({page}) => {
    const errors = collectPageErrors(page);
    await gotoNestedGrid(page, {scene: "high-version"});

    const {leftLeaf, topLeaf, bottomLeaf, recovery} = nestedGridLocators(page);
    await expect(recovery).toHaveAttribute("data-lab-restore-status", "rejected");
    await expect(recovery).toHaveAttribute("data-lab-restore-code", "unsupported-version");
    await expect(recovery).toHaveAttribute("data-lab-restore-version", "99");

    // 保留原件
    const raw = JSON.parse((await recovery.getAttribute("data-lab-raw-record"))!);
    expect(raw.version).toBe(99);

    // 呈现安全默认布局
    await expect(leftLeaf).toBeVisible();
    await expect(topLeaf).toBeVisible();
    await expect(bottomLeaf).toBeVisible();
    expect(errors).toEqual([]);
});

for (const combination of [
    {theme: "nbook", colorway: "light", colorwayId: "nbook-light"},
    {theme: "nbook", colorway: "dark", colorwayId: "nbook-dark"},
    {theme: "macos", colorway: "light", colorwayId: "nbook-light"},
    {theme: "macos", colorway: "dark", colorwayId: "nbook-dark"},
] as const) {
    for (const viewport of [
        {name: "desktop", canvas: undefined},
        {name: "390×844", canvas: "390x844"},
    ]) {
        test(`主题配色 ${combination.theme}/${combination.colorwayId} 在 ${viewport.name} 保持真实几何与键盘调整`, async ({page}) => {
            await gotoNestedGrid(page, {
                theme: combination.theme,
                colorway: combination.colorway,
                canvas: viewport.canvas,
            });
            // 地址里的主题与配色确实生效：不装的 id 会悄悄落回默认，用例就成了重复跑同一组合。
            expect(await labState(page)).toMatchObject({themeId: combination.theme, colorwayId: combination.colorwayId});

            const target = page.locator("#nb-lab-target");
            const {outerSash, innerSash, gesture} = nestedGridLocators(page);

            await expect(target).toBeVisible();
            await expect(outerSash).toBeVisible();
            await expect(innerSash).toBeVisible();

            const targetBox = (await target.boundingBox())!;
            expect(targetBox, "容器必须具有真实可见尺寸").not.toBeNull();
            expect(targetBox.width).toBeGreaterThan(0);
            expect(targetBox.height).toBeGreaterThan(0);

            if (viewport.name === "390×844") {
                expect(targetBox.width).toBeLessThan(390);
                const overflow = await page.evaluate(
                    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
                );
                expect(overflow).toBeLessThanOrEqual(0);
            }

            // 一次键盘调整验证手势可用
            await outerSash.focus();
            await page.keyboard.press("ArrowRight");


            await expect(gesture).toHaveAttribute("data-lab-gesture-state", "commit");
            await expect(gesture).toHaveAttribute("data-lab-commit-count", "1");
        });
    }
}
