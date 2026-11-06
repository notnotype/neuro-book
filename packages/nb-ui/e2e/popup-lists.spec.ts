import type {Locator, Page} from "@playwright/test";
import {test, expect} from "./fixtures";

/**
 * 弹出列表的一行（w00029 t04）：行高、字号、同心圆角与高亮在真实布局与真实指针下量。nbook 主题下外框 8px、内边距 4px，
 * 项的圆角推出 3px（Task README 决定 3、4）。高亮只认 `data-highlighted`：普通按钮项（右键菜单、手工级联）由 MenuNodes
 * 跟着焦点挂，指针移动会把焦点带过去，所以任何时候最多一项亮着（决定 1）。
 */

async function gotoMenus(page: Page): Promise<void> {
    await page.goto("/acceptance/popup-lists?scene=menus&theme=nbook&colorway=nbook-light");
    await expect(page.locator("#nb-lab-target")).toBeVisible();
}

async function expectRowGeometry(item: Locator): Promise<void> {
    const box = (await item.boundingBox())!;
    const label = (await item.textContent())?.trim();
    expect(box.height, `${label} 的行高`).toBeCloseTo(30, 0);
    await expect(item, `${label} 的字号`).toHaveCSS("font-size", "14px");
    await expect(item, `${label} 的圆角`).toHaveCSS("border-radius", "3px");
}

/** 名称的左边缘：同一级的名称应当对齐（勾与图标共用的左侧一列，有一项用到就每项都留）。 */
async function labelLeft(item: Locator): Promise<number> {
    return (await item.locator(".nb-ui-menu-item__label").boundingBox())!.x;
}

async function highlightedLabels(page: Page): Promise<string[]> {
    return page.locator("[data-highlighted]").evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ""));
}

const background = (item: Locator): Promise<string> => item.evaluate((element) => getComputedStyle(element).backgroundColor);

/** 浮层入场时有一段缩放动画（scale 0.96 → 1），量尺寸前等它播完。 */
async function settled(surface: Locator): Promise<void> {
    await expect(surface).toBeVisible();
    await surface.evaluate((element) => Promise.all(element.getAnimations({subtree: true}).map((animation) => animation.finished)));
}

test("下拉菜单：外框 8px、内边距 4px，项高 30px、字 14px、圆角 3px；勾选项的勾与快捷键同时显示", async ({page}) => {
    await gotoMenus(page);
    await page.locator("[data-fixture-dropdown-trigger]").click();
    const menu = page.locator("[data-fixture-dropdown]");
    await settled(menu);
    await expect(menu).toHaveCSS("border-radius", "8px");
    await expect(menu).toHaveCSS("padding-top", "4px");

    const items = menu.locator("[role^='menuitem']");
    await expect(items).toHaveCount(4);
    for (const item of await items.all()) await expectRowGeometry(item);

    const checked = menu.getByRole("menuitemcheckbox", {name: /自动换行/});
    await expect(checked.locator(".i-lucide-check")).toHaveCount(1);
    await expect(checked.locator(".nb-ui-menu-item__hint")).toHaveText("Alt+Z");
    // 勾与图标共用左侧一列（决定 8）：勾画在图标的位置；没勾、没图标的项也留出这一列，名称才对得齐。
    const iconLeft = async (item: Locator, icon: string): Promise<number> => (await item.locator(icon).boundingBox())!.x;
    expect(await iconLeft(checked, ".i-lucide-check"), "勾与图标在同一列").toBeCloseTo(await iconLeft(menu.getByRole("menuitem", {name: /重命名/}), ".i-lucide-pencil"), 0);
    const nameLeft = (name: RegExp): Promise<number> => labelLeft(menu.getByRole("menuitem", {name}).or(menu.getByRole("menuitemcheckbox", {name})));
    expect(await nameLeft(/排序方式/)).toBeCloseTo(await nameLeft(/自动换行/), 0);
    expect(await nameLeft(/自动换行/), "没图标的项与带图标的项名称对齐").toBeCloseTo(await nameLeft(/重命名/), 0);

    // 手工级联面板在 reka 的菜单内容之外：指针移进去把焦点带过去，菜单不能当成焦点移出而关掉。
    await menu.getByRole("menuitem", {name: /排序方式/}).hover();
    const byName = page.getByRole("menuitemradio", {name: /按名称/});
    await settled(page.locator(".nb-menu-level"));
    await byName.hover();
    expect(await highlightedLabels(page)).toEqual(["按名称"]);
    await expect(menu).toBeVisible();
    await expectRowGeometry(byName);
});

test("右键菜单：悬停与方向键都只亮一项；危险项高亮也是中性叠色；子菜单里移动时展开它的父项保持高亮", async ({page}) => {
    await gotoMenus(page);
    await page.locator("[data-fixture-context-area]").click({button: "right"});
    const panel = page.locator("[data-menu-panel]");
    await settled(panel);
    for (const item of await panel.locator("[role='menu']").first().locator(".nb-menu-level-content > [role^='menuitem']").all()) await expectRowGeometry(item);
    // 圆角外那一小块不归菜单：紧挨着左上角按下去落在下面的页面上（宿主会在那里起拖标签之类的手势）。
    const corner = (await panel.boundingBox())!;
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("[data-menu-panel]") === null, [corner.x + 1, corner.y + 1] as const)).toBe(true);

    const create = panel.getByRole("menuitem", {name: /新建/});
    const remove = panel.getByRole("menuitem", {name: /删除/});
    expect(await labelLeft(panel.getByRole("menuitem", {name: /更多/})), "没图标的项留出图标列").toBeCloseTo(await labelLeft(create), 0);
    await create.hover();
    expect(await highlightedLabels(page)).toEqual(["新建Ctrl+N"]);
    const neutral = await background(create);
    expect(neutral, "高亮有底色").not.toBe("rgba(0, 0, 0, 0)");

    await page.keyboard.press("ArrowDown");
    expect(await highlightedLabels(page)).toEqual(["更多"]);

    await remove.hover();
    expect(await highlightedLabels(page)).toEqual(["删除"]);
    expect(await background(remove), "危险项高亮与其它项同一底色").toBe(neutral);

    // 指针离开菜单：高亮清掉，焦点停在菜单上，方向键从第一项接着走。
    const panelBox = (await panel.boundingBox())!;
    await page.mouse.move(panelBox.x + panelBox.width + 80, panelBox.y + panelBox.height + 80);
    expect(await highlightedLabels(page)).toEqual([]);
    await page.keyboard.press("ArrowDown");
    expect(await highlightedLabels(page)).toEqual(["新建Ctrl+N"]);

    const more = panel.getByRole("menuitem", {name: /更多/});
    await more.hover();
    const sub = page.locator("[data-menu-level='0']");
    await expect(sub).toBeVisible();
    await sub.getByRole("menuitem", {name: "子一"}).hover();
    expect(await highlightedLabels(page)).toEqual(["子一"]);
    await expect(more).toHaveAttribute("aria-expanded", "true");
    expect(await background(more), "展开了子菜单的父项保持高亮").toBe(neutral);
});

test("菜单栏：手工级联里的普通按钮项在悬停时高亮", async ({page}) => {
    await gotoMenus(page);
    await page.locator("[data-fixture-menubar]").getByRole("menuitem", {name: "文件"}).click();
    const exportItem = page.getByRole("menuitem", {name: /导出/});
    await expect(page.locator("[data-menubar-level='file'] .nb-ui-menu-item__icon"), "这一级没有项带图标，不留图标列").toHaveCount(0);
    await exportItem.hover();
    const markdown = page.getByRole("menuitem", {name: "Markdown"});
    await settled(page.locator(".nb-menu-level"));
    await markdown.hover();
    expect(await highlightedLabels(page)).toEqual(["Markdown"]);
    await expectRowGeometry(markdown);
    // 子菜单按窗口定位：第一项与父项同一行，在父级右侧。
    const parentBox = (await exportItem.boundingBox())!;
    const childBox = (await markdown.boundingBox())!;
    expect(Math.abs(childBox.y - parentBox.y), "子菜单第一项与父项同一行").toBeLessThanOrEqual(1);
    expect(childBox.x).toBeGreaterThan(parentBox.x + parentBox.width);

    // 悬停把焦点带进了子菜单：键盘接着在子菜单里走，左方向键回到展开它的那一项。
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", {name: "EPUB"})).toBeFocused();
    expect(await highlightedLabels(page)).toEqual(["EPUB"]);
    await page.keyboard.press("ArrowLeft");
    await expect(exportItem).toBeFocused();
    await expect(page.locator(".nb-menu-level")).toHaveCount(0);
});

test("菜单栏：一级里父项上按右方向键只展开子菜单、焦点进它的第一项，不切到下一组", async ({page}) => {
    await gotoMenus(page);
    const menubar = page.locator("[data-fixture-menubar]");
    await menubar.getByRole("menuitem", {name: "文件"}).click();
    const exportItem = page.getByRole("menuitem", {name: /导出/});
    await exportItem.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("menuitem", {name: "Markdown"})).toBeFocused();
    await expect(menubar.getByRole("menuitem", {name: "文件"}), "“文件”这组仍开着").toHaveAttribute("data-state", "open");
    await expect(menubar.getByRole("menuitem", {name: "编辑"})).toHaveAttribute("data-state", "closed");
});

test("Select：所有项 30px，说明在同一行右侧；选中项在左侧一列画勾、替代它的图标，底色不变", async ({page}) => {
    await page.goto("/acceptance/popup-lists?scene=select&theme=nbook&colorway=nbook-light");
    await page.locator("[data-fixture-select]").click();
    const listbox = page.getByRole("listbox");
    await settled(listbox);

    const markdown = page.getByRole("option", {name: /Markdown/});
    const text = page.getByRole("option", {name: /纯文本/});
    await expectRowGeometry(markdown);
    await expectRowGeometry(text);
    await expect(text.locator(".nb-ui-menu-item__hint"), "说明在同一行右侧").toHaveText("不带格式，换行照原样保留");

    await expect(text.locator(".i-lucide-check")).toHaveCount(1);
    await expect(text.locator(".i-lucide-file"), "选中项的勾替代它的图标").toHaveCount(0);
    await expect(markdown.locator(".i-lucide-check")).toHaveCount(0);
    expect(await labelLeft(page.getByRole("option", {name: /PDF/})), "没图标的项留出图标列").toBeCloseTo(await labelLeft(markdown), 0);
    // reka 打开时把焦点与高亮放在选中项上；把指针移到别的项，选中项就只剩勾。
    await markdown.hover();
    expect(await highlightedLabels(page)).toEqual(["Markdown"]);
    expect(await background(text), "选中项不另画底色").toBe("rgba(0, 0, 0, 0)");
    await expect(text, "选中项不加粗").toHaveCSS("font-weight", "400");
});

test("Select 与 ColorSwatches 的浮层材质与 DropdownMenu 相同：底色、模糊、投影、描边都来自外框类", async ({page}) => {
    await page.goto("/acceptance/popup-lists?scene=material&theme=nbook&colorway=nbook-dark");
    const material = (surface: Locator): Promise<Record<string, string>> => surface.evaluate((element) => {
        const style = getComputedStyle(element);
        return Object.fromEntries(["background-color", "backdrop-filter", "-webkit-backdrop-filter", "box-shadow", "border-top-width", "border-top-style", "border-top-color"]
            .map((name) => [name, style.getPropertyValue(name)]));
    });

    await page.locator("[data-fixture-dropdown-trigger]").click();
    const dropdown = page.locator("[data-fixture-dropdown]");
    await settled(dropdown);
    const expected = await material(dropdown);
    await page.keyboard.press("Escape");
    await expect(dropdown).toHaveCount(0);

    await page.locator("[data-fixture-select]").click();
    const select = page.locator(".nb-ui-popover-surface:has([role='option'])");
    await settled(select);
    expect(await material(select), "Select").toEqual(expected);
    await page.keyboard.press("Escape");
    await expect(select).toHaveCount(0);

    await page.locator("[data-color-swatch='custom']").click();
    const swatches = page.locator("[data-color-swatches-panel]");
    await settled(swatches);
    expect(await material(swatches), "ColorSwatches").toEqual(expected);
});

test("QuickPick：所有项 30px，分类与说明在同一行右侧；高亮跟着指针移动，只亮一项", async ({page}) => {
    await page.goto("/acceptance/popup-lists?scene=quick-pick&theme=nbook&colorway=nbook-light");
    const panel = page.locator("[data-fixture-quick-pick]");
    await settled(panel);
    await expect(panel).toHaveCSS("border-radius", "8px");

    const open = page.getByRole("option", {name: /打开项目/});
    const chapter = page.getByRole("option", {name: /新建章节/});
    const settings = page.getByRole("option", {name: /设置/});
    await expectRowGeometry(open);
    await expectRowGeometry(settings);
    await expectRowGeometry(chapter);
    await expect(chapter.locator(".nb-ui-menu-item__hint"), "说明在同一行右侧").toHaveText("在当前卷末尾");
    expect(await highlightedLabels(page)).toEqual(["打开项目Ctrl+O"]);
    expect(await labelLeft(page.getByRole("option", {name: /导出/})), "没图标的项留出图标列").toBeCloseTo(await labelLeft(open), 0);

    await settings.hover();
    expect(await highlightedLabels(page)).toEqual(["设置"]);
    await expect(page.getByRole("combobox"), "指针移动不夺走输入框的焦点").toBeFocused();
});
