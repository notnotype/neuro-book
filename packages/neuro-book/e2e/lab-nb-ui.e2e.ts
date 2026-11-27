/**
 * nb-ui 组件在 Lab 场景里的真实浏览器行为：浮层的展开方向、禁用项、页面不锁、Escape 关闭，以及非模态窗口的外部交互与
 * 键盘调整尺寸。原来在 nb-ui playground 的 Lab 用例里（`packages/nb-ui/e2e/lab.spec.ts`），playground 的 Lab 退役时
 * 迁到这里，改为对新应用 Lab 里的真实组件场景断言（w00017 t73）。嵌套分栏的手势验收在 `e2e/lab-nested-grid.e2e.ts`，
 * 多栏分割的在 nb-ui 的 `e2e/splitter.spec.ts`。
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
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-nb-ui");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function openScene(page: Page, query: string): Promise<void> {
    await page.goto(`${dev.pageUrl}lab?${query}`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
}

/** 舞台里的被测元素；Lab 外壳自己的下拉框也是 combobox，所以限定在舞台里。 */
const stage = (page: Page) => page.locator(".lab-main [data-lab-stage]");
const popperSide = (page: Page) => page.locator("[data-reka-popper-content-wrapper] > *").first();

test("下拉选择：Enter 展开、向下展开、页面不锁、禁用项选不中、Escape 关闭", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=Select&s=default");
    // 列表打开时 reka 把列表之外的元素标成 aria-hidden，按角色就找不到触发器了，所以用属性选择器。
    const trigger = stage(page).locator('[role="combobox"]');
    await trigger.focus();
    await page.keyboard.press("Enter");
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(popperSide(page)).toHaveAttribute("data-side", "bottom");

    // 非模态浮层：列表开着时页面仍然可以滚动、可以点。
    expect(await page.evaluate(() => ({overflow: document.body.style.overflow, pointerEvents: document.body.style.pointerEvents}))).toEqual({overflow: "", pointerEvents: ""});

    const disabled = listbox.getByRole("option").filter({hasText: "日本語"});
    await expect(disabled).toHaveAttribute("aria-disabled", "true");
    for (let index = 0; index < 6; index += 1) await page.keyboard.press("ArrowDown");
    await expect(disabled).toHaveAttribute("aria-selected", "false");
    await expect(trigger).toContainText("简体中文");

    await page.keyboard.press("Escape");
    await expect(listbox).toBeHidden();
});

test("下拉选择：只读时触发器可聚焦，Enter、空格与点击都不打开浮层，逐字查找不改值（docs/specs/ui/forms.md 输出 28）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=Select&s=readonly");
    const trigger = stage(page).locator('[role="combobox"]');
    await expect(trigger).toHaveAttribute("aria-readonly", "true");
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press(" ");
    await page.keyboard.type("E");
    await trigger.click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(trigger).toContainText("简体中文");
});

test("可搜索的下拉：打字只筛选，点选才改值；Escape 与失焦恢复已选项；列表是弹出列表共用的行（docs/specs/ui/forms.md 输出 30）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=SearchSelect&s=default");
    const input = stage(page).locator('input[role="combobox"]');
    await expect(input).toHaveValue("Claude Opus");

    // 点进去直接打字：已选项的名字被全选，第一个字替换它，不接在后面。
    await input.click();
    await page.keyboard.type("deep");
    await expect(input).toHaveValue("deep");
    const listbox = page.locator('[data-suggestion-menu] [role="listbox"]');
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option")).toHaveText(["DeepSeek V4DeepSeek"]);
    await expect(listbox.getByRole("option").first()).toHaveClass(/nb-ui-menu-item/u);
    await page.keyboard.press("Escape");
    await expect(input).toHaveValue("Claude Opus");
    await expect(listbox).toHaveCount(0);

    // 点外框右侧的箭头也能打开，输入框不失焦。
    await stage(page).locator("[data-nb-search-select] > span").last().click();
    await expect(input).toBeFocused();
    await expect(listbox).toBeVisible();
    await page.keyboard.type("qw");
    await listbox.getByRole("option", {name: /Qwen/u}).click();
    await expect(input).toHaveValue("Qwen 3 Max");
    await expect(input).toBeFocused();

    await input.fill("gpt");
    await page.locator(".lab-main").click({position: {x: 5, y: 5}});
    await expect(input).toHaveValue("Qwen 3 Max");
});

test("下拉选择：指定向上展开时浮层在上方", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=Select&s=up");
    await stage(page).getByRole("combobox").click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(popperSide(page)).toHaveAttribute("data-side", "top");
});

test("下拉选择的长列表：收起成截半高度，键盘走到最后一项时它滚进可见区；富选项带图标与说明", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=Select&s=long");
    await stage(page).locator('[role="combobox"]').click();
    const viewport = page.locator("[data-reka-select-viewport]");
    await expect(viewport).toBeVisible();
    const size = await viewport.evaluate((element) => ({client: element.clientHeight, scroll: element.scrollHeight}));
    expect(size.scroll).toBeGreaterThan(size.client);
    // 14 项不全展开：截在第 9 项的中点（w00029 t04 决定 5）。打开时停在选中项上，先回到顶部再量。
    const cut = await viewport.evaluate((element) => {
        element.scrollTop = 0;
        const ninth = element.querySelectorAll('[role="option"]')[8]!.getBoundingClientRect();
        return element.getBoundingClientRect().bottom - (ninth.top + ninth.height / 2);
    });
    expect(Math.abs(cut)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("option").filter({hasText: "EPUB 电子书"}).locator(".i-lucide-book-open")).toBeAttached();
    await expect(page.getByRole("option").filter({hasText: "EPUB 电子书"})).toContainText("按卷生成目录");
    // 带说明与不带说明的项一样高：说明在同一行右侧（决定 9）。
    const heights = await viewport.evaluate((element) => [...new Set([...element.querySelectorAll('[role="option"]')].map((option) => Math.round(option.getBoundingClientRect().height)))]);
    expect(heights).toEqual([await viewport.evaluate((element) => Math.round(Number.parseFloat(getComputedStyle(element).getPropertyValue("--menu-item-h"))))]);
    // 放不下时先截右侧的说明，名称完整（说明还有字时名称一点都不缩）。
    const word = page.getByRole("option").filter({hasText: "Word 文档"});
    const clipped = (selector: string): Promise<boolean> => word.locator(selector).evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(await clipped(".nb-ui-menu-item__hint"), "说明被截").toBe(true);
    expect(await clipped(".nb-ui-menu-item__label"), "名称完整").toBe(false);

    // End 一步走到最后一项。reka 在 keydown 之后才挪焦点（setTimeout），连按方向键不等焦点移动会合并成一步。
    await page.keyboard.press("End");
    const last = page.getByRole("option").filter({hasText: "NeuroBook 备份"});
    await expect(last).toHaveAttribute("data-highlighted");
    const [box, item] = await Promise.all([viewport.boundingBox(), last.boundingBox()]);
    expect(item!.y).toBeGreaterThanOrEqual(box!.y - 1);
    expect(item!.y + item!.height).toBeLessThanOrEqual(box!.y + box!.height + 1);
});

test("非模态窗口：不画遮罩、六个调整手柄、窗口外照常可点，方向键调整宽度一次 10px", async ({page}) => {
    await page.setViewportSize({width: 1600, height: 1000});
    await openScene(page, "c=FloatingWindow&s=resizable");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("aria-labelledby", /.+/u);
    await expect(page.locator("[data-dialog-overlay]")).toHaveCount(0);
    for (const handle of ["right", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]) {
        await expect(dialog.locator(`[data-dialog-resize='${handle}']`)).toBeVisible();
    }

    // 窗口外的元素：左栏的组件检索框，它整个在窗口左边。非模态窗口不被外部交互关闭。
    const search = page.getByRole("searchbox", {name: "搜组件名或部件名称"});
    const [windowBox, searchBox] = await Promise.all([dialog.boundingBox(), search.boundingBox()]);
    expect((searchBox?.x ?? 0) + (searchBox?.width ?? 0)).toBeLessThan(windowBox?.x ?? 0);
    await search.click();
    await expect(search).toBeFocused();
    await expect(dialog).toBeVisible();

    const before = (await dialog.boundingBox())!.width;
    await dialog.locator("[data-dialog-resize='right']").focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => Math.round((await dialog.boundingBox())!.width - before)).toBe(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("非模态窗口在手机画布里：按画布宽度收窄，落在画布以内", async ({page}) => {
    await page.setViewportSize({width: 1600, height: 1000});
    await openScene(page, "c=FloatingWindow&s=resizable&vp=phone");
    const dialog = page.locator("[data-lab-overlay-root] [role='dialog']");
    await expect(dialog).toBeVisible();
    const [canvas, window] = await Promise.all([page.locator(".lab-main .nb-lab-stage-box").first().boundingBox(), dialog.boundingBox()]);
    expect(window!.x).toBeGreaterThanOrEqual(canvas!.x);
    expect(window!.x + window!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width + 1);
});

test("模态对话框在 Lab 画布里只遮住画布：Lab 自己的控件照常可点可聚焦，对话框不被关掉", async ({page}) => {
    await page.setViewportSize({width: 1600, height: 1000});
    await openScene(page, "c=Dialog&s=default");
    const dialog = page.locator("[data-lab-overlay-root] [role='dialog']");
    await expect(dialog).toBeVisible();
    await expect(page.locator("[data-lab-overlay-root] [data-dialog-overlay]")).toBeVisible();
    const search = page.getByRole("searchbox", {name: "搜组件名或部件名称"});
    await search.click();
    await expect(search).toBeFocused();
    await expect(dialog).toBeVisible();
    expect(await page.locator("body").evaluate((body) => getComputedStyle(body).pointerEvents)).not.toBe("none");
});

/** 事件页签的全文：事件名与负载都在里面。 */
async function recordedEvents(page: Page): Promise<string> {
    return (await page.locator('[data-lab-panel="events"]').textContent()) ?? "";
}

test("菜单栏：方向键在项之间移动并跳过禁用项，禁用项带原因，Enter 选中后关闭并把焦点还给组标题；左右键换组后 Escape 回到最初的组标题", async ({page}) => {
    // 下面有一段测退场动画窗口里的竞态：配置默认减少动态效果，要开回来。
    await page.emulateMedia({reducedMotion: "no-preference"});
    await page.setViewportSize({width: 1440, height: 1000});
    await openScene(page, "c=Menubar&s=flat&tab=events");
    const edit = stage(page).getByRole("menuitem", {name: "编辑"});
    await edit.click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    const redo = menu.getByRole("menuitem", {name: "重做"});
    await expect(redo).toHaveAttribute("aria-disabled", "true");
    await expect(redo).toHaveAttribute("title", "没有可以重做的操作");
    await expect(redo).toHaveAttribute("aria-description", "没有可以重做的操作");

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "撤销"})).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "查找"})).toBeFocused();
    await page.keyboard.press("Home");
    await expect(menu.getByRole("menuitem", {name: "撤销"})).toBeFocused();
    await page.keyboard.press("End");
    await expect(menu.getByRole("menuitem", {name: "查找"})).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect(edit).toBeFocused();
    await expect.poll(() => recordedEvents(page)).toContain("find");

    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menu").getByRole("menuitemcheckbox", {name: "显示侧栏"})).toBeVisible();
    await page.keyboard.press("Escape");
    // 关闭动画期间已关闭的菜单还在 DOM 里（data-state=closed），只核对没有打开着的。
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(0);
    // 用左右键换过组之后，Escape 把焦点还给最初打开菜单的组标题（reka 的行为），也就是打开菜单之前焦点所在的位置。
    await expect(edit).toBeFocused();

    // 一个菜单关闭后还在退场动画里时立刻点另一组：那一组照常打开，不被正在退场的菜单当作“点在外面”关掉。
    await edit.click();
    await expect(page.locator('[role="menu"][data-state="open"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    await stage(page).getByRole("menuitem", {name: "视图"}).click();
    await expect(page.locator('[role="menu"][data-state="open"]').getByRole("menuitemcheckbox", {name: "显示侧栏"})).toBeVisible();
    await page.keyboard.press("Escape");
});

test("下拉菜单：方向键跳过禁用项，禁用项带原因，Enter 选中", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1000});
    await openScene(page, "c=DropdownMenu&s=default&tab=events");
    await stage(page).getByRole("button", {name: "更多操作"}).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const trash = menu.getByRole("menuitem", {name: "移到回收站"});
    await expect(trash).toHaveAttribute("aria-disabled", "true");
    await expect(trash).toHaveAttribute("aria-description", "根目录不能移到回收站");
    // 没有图标的项留出图标列：应用的样式顺序里图标类排在 nb-ui 之后，图标与占位要同宽，名称才对齐。
    const labelLeft = async (name: string): Promise<number> => (await menu.locator(".nb-ui-menu-item__label", {hasText: name}).boundingBox())!.x;
    expect(await labelLeft("显示隐藏文件")).toBeCloseTo(await labelLeft("重命名"), 0);

    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "重命名"})).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "复制路径"})).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", {name: "排序方式"})).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(menu).toBeHidden();
    await expect.poll(() => recordedEvents(page)).toContain("copy-path");
});

test("内嵌焦点线：键盘聚焦 Tabs 的标签时只画一圈 1.5px 的内阴影，没有外扩的光环（t78）", async ({page}) => {
    // 计算样式里的 box-shadow 按层拆开（颜色函数里的逗号不算）。
    const focusedShadow = () => page.evaluate(() => getComputedStyle(document.activeElement!).boxShadow.split(/,(?![^(]*\))/u).map((layer) => layer.trim()));
    await openScene(page, "c=Tabs&s=default");
    await stage(page).getByRole("tab", {selected: true}).focus();
    // 方向键换标签：焦点随之移动，是键盘带来的焦点（:focus-visible）。
    await page.keyboard.press("ArrowRight");
    await expect(stage(page).getByRole("tab", {selected: true})).toBeFocused();
    await expect.poll(focusedShadow).toEqual([expect.stringMatching(/0px 0px 0px 1\.5px inset$/u)]);
});

test("折叠内容只在高度动画进行中裁切：展开与收起时打上 data-animating、结束后去掉，展开后不裁；快速开合与减少动态时不残留（t78）", async ({page}) => {
    await page.emulateMedia({reducedMotion: "no-preference"});
    // 记下舞台里 data-animating 的每一次变化：内容的开合状态与有没有这个属性。
    const record = () => page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as {__animating: string[]}).__animating = log;
        new MutationObserver((records) => {
            for (const changed of records) {
                const target = changed.target as Element;
                log.push(`${target.getAttribute("data-state") ?? ""}:${target.hasAttribute("data-animating") ? "on" : "off"}`);
            }
        }).observe(document.querySelector("[data-lab-stage]")!, {subtree: true, attributes: true, attributeFilter: ["data-animating"]});
    });
    const log = () => page.evaluate(() => (window as unknown as {__animating: string[]}).__animating);
    const settled = async (): Promise<void> => {
        await expect.poll(() => stage(page).locator("[data-animating]").count()).toBe(0);
    };
    const openOverflow = () => stage(page).locator(".nb-collapsible-content[data-state=\"open\"]").evaluate((content) => getComputedStyle(content).overflow);
    const trigger = () => stage(page).getByRole("button", {name: "修订说明"});

    await openScene(page, "c=Collapsible&s=closed");
    await record();
    // 点击后动画要过一帧才开始：先等展开动画结束（日志里出现 open:off），再判静止，否则会量到动画开始之前。
    await trigger().click();
    await expect.poll(log).toEqual(expect.arrayContaining(["open:on", "open:off"]));
    await settled();
    expect(await openOverflow()).toBe("visible");
    await trigger().click();
    await expect.poll(log).toEqual(expect.arrayContaining(["open:on", "open:off", "closed:on", "closed:off"]));
    await settled();

    // 快速开合：先展开并等它静止，再连点两次——收起的动画被重新展开打断（animationcancel）；之后日志里第一个 open:on
    // 就是重新展开的那次，等它开始再等它结束，同样不留标记。
    await trigger().click();
    await expect.poll(async () => (await log()).at(-1)).toBe("open:off");
    await settled();
    const before = (await log()).length;
    await trigger().click();
    await trigger().click();
    await expect.poll(async () => (await log()).slice(before)).toContain("open:on");
    await settled();
    expect(await openOverflow()).toBe("visible");

    await page.emulateMedia({reducedMotion: "reduce"});
    await openScene(page, "c=Collapsible&s=closed");
    await trigger().click();
    await expect(stage(page).locator(".nb-collapsible-content[data-state=\"open\"]")).toContainText("第三次修订");
    await settled();
    expect(await openOverflow()).toBe("visible");
});

test("应用只有一套原子 CSS（ADR 0028）：组件取 nb-ui 自己的字号，开关滑块留在轨道里，下拉箭头只转半圈；调用方的原子类压过组件的语义类；根上的细滚动条对后代生效", async ({page}) => {
    // 两套引擎并存时，宿主的 `text-sm`（14px）改掉组件的字号，`translate-x-4`、`rotate-180` 两边各生成一份而叠加。
    // 用 macOS 主题量：它的 --text-sm 是 13px，与 Tailwind 默认的 14px 不同，才分得出取的是谁的值（nbook 的 sm 也是 14px）。
    await openScene(page, "c=IconButton&s=default&theme=macos");
    expect(await stage(page).locator("button").first().evaluate((element) => getComputedStyle(element).fontSize)).toBe("13px");

    await openScene(page, "c=Switch&s=on");
    const track = stage(page).locator('[role="switch"]').first();
    await expect(track).toHaveAttribute("data-state", "checked");
    await expect.poll(() => track.evaluate((element) => {
        const thumb = element.querySelector("[data-state]")!.getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return {inside: thumb.right <= box.right + 0.5, movedRight: thumb.left - box.left > box.width / 3};
    })).toEqual({inside: true, movedRight: true});

    await openScene(page, "c=Select&s=default");
    const trigger = stage(page).locator('[role="combobox"]');
    await trigger.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect.poll(() => trigger.locator(".i-lucide-chevron-down").evaluate((element) => {
        const style = getComputedStyle(element);
        return {rotate: style.rotate, transform: style.transform};
    })).toEqual({rotate: "180deg", transform: "none"});
    await page.keyboard.press("Escape");

    // 语义类在 components 层、原子类在 utilities 层：同一属性上原子类赢，与选择器特异性和书写先后无关。
    const radii = await page.evaluate(() => {
        const measure = (className: string): number => {
            const probe = document.createElement("div");
            probe.className = className;
            document.body.append(probe);
            const radius = Number.parseFloat(getComputedStyle(probe).borderTopLeftRadius);
            probe.remove();
            return radius;
        };
        return {semantic: measure("nb-ui-popover-surface"), withUtility: measure("nb-ui-popover-surface rounded-full")};
    });
    expect(radii.semantic).toBeGreaterThan(0);
    expect(radii.withUtility).toBeGreaterThan(1000);

    expect(await page.evaluate(() => [document.documentElement, document.body.firstElementChild!].map((element) => getComputedStyle(element).scrollbarWidth))).toEqual(["thin", "thin"]);
});

/** NotificationStackFixture 里“文件没有保存”那条通知的原文（w00028 t04）。 */
const SAVE_FAILED_DETAIL = [
    "EditorSaveError: EACCES: permission denied, open '/books/长夜行/第三章.md'",
    "    code: workspace.file-write-denied",
    "    at saveFile (editor/shared/files.ts:88:13)",
    "    trace: 4f2a9c1e",
].join("\n");

test("通知的“详情”：开对话框，“复制原文”写进剪贴板；没有剪贴板 API 时退到 execCommand 仍能复制；打开期间通知视口 inert，Escape 关闭后焦点回到“详情”（docs/specs/workbench/notifications.md）", async ({page, context}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({width: 1600, height: 1000});
    await openScene(page, "c=NotificationStack&s=detail");
    const notifications = stage(page).locator("[data-notification-stack]");
    const detailButton = notifications.getByRole("button", {name: "详情"});
    await detailButton.click();
    const dialog = page.locator("[data-lab-overlay-root] [role='dialog']");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("文件没有保存：详情");
    await expect(notifications).toHaveAttribute("inert", "");

    await dialog.getByRole("button", {name: "复制原文"}).click();
    await expect(dialog.getByRole("button", {name: "已复制"})).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SAVE_FAILED_DETAIL);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(notifications).not.toHaveAttribute("inert", "");
    await expect(detailButton).toBeFocused();
    // 先把剪贴板换成别的内容，下面读回原文才说明是退路写进去的。
    await page.evaluate(() => navigator.clipboard.writeText("清空"));

    // 非安全上下文没有 navigator.clipboard：另开一页把它去掉，复制走 execCommand；剪贴板从原来那页读回来。
    const insecure = await context.newPage();
    await insecure.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "clipboard", {get: () => undefined, configurable: true});
    });
    await insecure.setViewportSize({width: 1600, height: 1000});
    await openScene(insecure, "c=NotificationStack&s=detail");
    expect(await insecure.evaluate(() => navigator.clipboard === undefined)).toBe(true);
    await stage(insecure).locator("[data-notification-stack]").getByRole("button", {name: "详情"}).click();
    const insecureDialog = insecure.locator("[data-lab-overlay-root] [role='dialog']");
    await insecureDialog.getByRole("button", {name: "复制原文"}).click();
    await expect(insecureDialog.getByRole("button", {name: "已复制"})).toBeVisible();
    await page.bringToFront();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(SAVE_FAILED_DETAIL);
    await insecure.close();
});

test("数据表格：表格区滚动后表头留在原处，最后一页不满时表格区照样占满、页脚贴在组件底边（nb-ui 的 DataTable.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=DataTable&s=page");
    const table = stage(page).locator(".nb-data-table");
    // Table 的根就是表格区的滚动容器（stickyHeader），表格区的第一个子元素。
    const scroller = table.locator(".nb-data-table-body > :first-child");
    const head = table.locator("thead th").first();
    // 先确认这一页在表格区里放不下：不能滚动时“表头不动”会空过。
    const overflow = await scroller.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(overflow).toBeGreaterThan(120);

    const headBefore = (await head.boundingBox())!;
    const firstRowBefore = (await table.locator("tbody tr").first().boundingBox())!;
    await scroller.evaluate((element) => {
        element.scrollTop = 120;
    });
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(120);
    const headAfter = (await head.boundingBox())!;
    const firstRowAfter = (await table.locator("tbody tr").first().boundingBox())!;
    expect(firstRowAfter.y).toBeCloseTo(firstRowBefore.y - 120, 0);
    expect(headAfter.y).toBeCloseTo(headBefore.y, 1);

    // 缺省的手机画布只有 352px 高，6 行正好放满；换成高一些的画布，最后一页才留得出空白。
    await openScene(page, "c=DataTable&s=last-page&vp=1100x800");
    await expect(table.locator("tbody tr")).toHaveCount(6);
    const box = (await table.boundingBox())!;
    const body = (await table.locator(".nb-data-table-body").boundingBox())!;
    const foot = (await table.locator(".nb-data-table-foot").boundingBox())!;
    const lastRow = (await table.locator("tbody tr").last().boundingBox())!;
    // 行没有占满：最后一行下面留着空白，页脚仍在底部、紧接着表格区。
    expect(lastRow.y + lastRow.height).toBeLessThan(body.y + body.height - 100);
    expect(foot.y + foot.height).toBeCloseTo(box.y + box.height, 1);
    expect(foot.y).toBeCloseTo(body.y + body.height, 1);
});

/** 元素在页面里的外接框；量的是 getBoundingClientRect，不经 Playwright 的 boundingBox（它会等元素出现）。 */
const rectOf = (locator: ReturnType<Page["locator"]>) => locator.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom};
});

test("分页条：100 页从第 1 页连点“下一页”到第 100 页，整条的宽度与两个箭头的位置不变（nb-ui 的 Pagination.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=Pagination&s=many-first&vp=free");
    const nav = stage(page).locator("nav.nb-pagination");
    const prev = nav.getByRole("button", {name: "上一页"});
    const next = nav.getByRole("button", {name: "下一页"});
    const current = nav.locator("[aria-current='page']");
    const first = {nav: await rectOf(nav), prev: await rectOf(prev), next: await rectOf(next)};
    for (let target = 2; target <= 100; target += 1) {
        await next.click();
        await expect(current).toHaveText(String(target));
        const [navBox, prevBox, nextBox] = await Promise.all([rectOf(nav), rectOf(prev), rectOf(next)]);
        expect({page: target, width: navBox.width, prevX: prevBox.x, nextX: nextBox.x}).toEqual({page: target, width: first.nav.width, prevX: first.prev.x, nextX: first.next.x});
    }
});

test("分页条：焦点在“下一页”上连按 Enter 到末页，箭头变成不可用时焦点落到末页的格子上（nb-ui 的 Pagination.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=Pagination&s=few");
    const nav = stage(page).locator("nav.nb-pagination");
    const next = nav.getByRole("button", {name: "下一页"});
    await next.focus();
    for (const target of ["3", "4"]) {
        await page.keyboard.press("Enter");
        await expect(nav.locator("[aria-current='page']")).toHaveText(target);
        await expect(next).toBeFocused();
    }
    await page.keyboard.press("Enter");
    await expect(nav.locator("[aria-current='page']")).toHaveText("5");
    await expect(next).toBeDisabled();
    await expect(nav.getByRole("button", {name: "第 5 页"})).toBeFocused();
});

test("数据表格：六个场景里工具条与页脚相对组件的位置、高度都相同（nb-ui 的 DataTable.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    const frames: Record<string, unknown> = {};
    for (const scene of ["page", "last-page", "empty", "initial-loading", "page-loading", "error"]) {
        await openScene(page, `c=DataTable&s=${scene}&vp=1100x800`);
        const table = stage(page).locator(".nb-data-table");
        // 两个加载场景等延时过后转圈或遮罩出现，量的是状态画出来以后的样子。
        if (scene.endsWith("loading")) await expect(table.locator(".nb-data-table-body [role=status]")).toBeAttached();
        const [root, bar, foot] = await Promise.all([rectOf(table), rectOf(table.locator(".nb-data-table-bar")), rectOf(table.locator(".nb-data-table-foot"))]);
        frames[scene] = {barTop: bar.y - root.y, barHeight: bar.height, footTop: foot.y - root.y, footHeight: foot.height};
    }
    const expected = frames["page"];
    expect(expected).toEqual(expect.objectContaining({barHeight: 48, footHeight: 48}));
    for (const [scene, frame] of Object.entries(frames)) expect({scene, ...(frame as object)}).toEqual({scene, ...(expected as object)});
});

test("数据表格：焦点在“重试”上按 Enter，出错层离场后焦点接到表格区，不掉回 body（nb-ui 的 DataTable.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=DataTable&s=error&vp=1100x800");
    const table = stage(page).locator(".nb-data-table");
    const retry = table.getByRole("alert").getByRole("button");
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(table.getByRole("alert")).toHaveCount(0);
    await expect(table.locator(".nb-data-table-body")).toBeFocused();
});

test("数据表格：容器矮时出错的内容在表格区里滚动，“重试”不越过表格区、不压在页脚上（nb-ui 的 DataTable.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=DataTable&s=error-short&vp=1100x800");
    const table = stage(page).locator(".nb-data-table");
    const state = table.getByRole("alert");
    // 先确认出错的内容确实比表格区高：放得下时“不越过”会空过。
    const overflow = await state.evaluate((element) => element.scrollHeight - element.clientHeight);
    expect(overflow).toBeGreaterThan(20);
    const retry = state.getByRole("button");
    await retry.scrollIntoViewIfNeeded();
    const [body, foot, button, alert] = await Promise.all([rectOf(table.locator(".nb-data-table-body")), rectOf(table.locator(".nb-data-table-foot")), rectOf(retry), rectOf(state)]);
    expect(alert.y).toBeGreaterThanOrEqual(body.y - 0.5);
    expect(alert.bottom).toBeLessThanOrEqual(body.bottom + 0.5);
    expect(button.y).toBeGreaterThanOrEqual(body.y - 0.5);
    expect(button.bottom).toBeLessThanOrEqual(foot.y + 0.5);
});

test("数据表格：页脚桌面宽一行、390 宽的英文界面折成两行且条数不截断（nb-ui 的 DataTable.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=DataTable&s=page-english&vp=1100x800");
    const table = stage(page).locator(".nb-data-table");
    const foot = table.locator(".nb-data-table-foot");
    const count = foot.locator(".nb-data-table-count");
    const pager = foot.locator("nav");
    let [footBox, countBox, pagerBox] = await Promise.all([rectOf(foot), rectOf(count), rectOf(pager)]);
    expect(footBox.height).toBe(48);
    expect(countBox.y + countBox.height / 2).toBeCloseTo(pagerBox.y + pagerBox.height / 2, 0);

    await openScene(page, "c=DataTable&s=page-english&vp=phone");
    [footBox, countBox, pagerBox] = await Promise.all([rectOf(foot), rectOf(count), rectOf(pager)]);
    expect(await count.innerText()).toBe("Total: 1,286");
    expect(await count.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0);
    expect(pagerBox.y).toBeGreaterThanOrEqual(countBox.bottom);
    expect(pagerBox.right).toBeCloseTo(countBox.right, 0);
    expect(footBox.bottom).toBeGreaterThanOrEqual(pagerBox.bottom);
});

test("数据表格：放进 flex 行、不给宽度时按内容撑开，不塌成 0 宽（nb-ui 的 DataTable.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    await openScene(page, "c=DataTable&s=page-in-row&vp=1100x800");
    const table = stage(page).locator(".nb-data-table");
    const inner = await table.locator("table").evaluate((element) => element.getBoundingClientRect().width);
    expect(inner).toBeGreaterThan(300);
    expect((await rectOf(table)).width).toBeGreaterThanOrEqual(inner);
});

test("字段出错时排版不变：没有说明时，出错与否控件的位置与字段的高度都相同（nb-ui 的 Field.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 1200});
    // 量控件相对字段根的位置与字段根的高度：舞台在两个场景里可能摆在不同的地方，比相对值。
    const measure = async () => {
        const field = stage(page).locator("label").first();
        const input = field.locator("input");
        const [fieldBox, inputBox] = await Promise.all([rectOf(field), rectOf(input)]);
        return {inputTop: inputBox.y - fieldBox.y, inputBottom: inputBox.bottom - fieldBox.y, fieldHeight: fieldBox.height};
    };

    await openScene(page, "c=Field&s=plain");
    await expect(stage(page).locator("input")).not.toHaveAttribute("aria-invalid", "true");
    const plain = await measure();

    await openScene(page, "c=Field&s=plain-error");
    // 前提：这个场景里的控件真的标红了，否则比出来相同证明不了什么。
    await expect(stage(page).locator("input")).toHaveAttribute("aria-invalid", "true");
    expect(await measure()).toEqual(plain);
});
