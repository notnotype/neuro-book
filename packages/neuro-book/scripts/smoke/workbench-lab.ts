import type {Page} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import {assert} from "./agent-profile-nav";

/**
 * 工作台 Lab 验收的共享定位与输入工具（容器 / Grid / sash 三个套件共用）。
 *
 * 定位一律走**新模型的数据属性**，不按文案或结构猜：
 * - 壳 `[data-workbench-shell]`、Part 宿主 `[data-workbench-part]`、叶 `[data-leaf]`（容器内部的叶是
 *   `view:<viewId>`，与外壳七个叶 id 不重名）；
 * - 容器用 `[data-container-id]`（ViewHost 根）、`[data-container-tab]`（选择单元：标签或单容器标题）、
 *   `[data-container-mount]`（Part 里的挂载目标）；容器标签的产品语义 id 是 **containerId**（`[data-tab-id]`）；
 * - View 用 `[data-view-id]`（Section = Grid 叶内容），标题拖动面是 `[data-workbench-drag-kind="view"]`；
 *   容器拖动面是 `[data-workbench-drag-kind="container"]`（**没有**独立的拖动握把了）；
 * - 分隔线用 `[data-sash="<branchId>:<index>"]`（`aria-valuenow` 是 px），分支根 `[data-splitter]`，
 *   面板盒 `[data-panel-id]`，Grid 根 `[data-grid-scope]`。
 *
 * 菜单一律按**作用域**收窄：框架动作在 `[data-title-actions="panel"]`、容器动作在
 * `[data-title-actions="container"]`、View 动作在**对应 viewId 的 Section** 里——
 * 不用全页 `[data-title-actions="view"].first()`，那会落到没有贡献动作的另一个 View 上。
 */

export const NAV_TREE = '.lab-columns > .nb-lab-panel--nav [role="treeitem"]';
/** 检索框：`aria-label` 落在 NbFormInput 的包装上，真正可填的是它内部的 input。 */
export const NAV_SEARCH = '[aria-label="搜组件名或部件名称"] input';
export const FIXTURE_ROOT = "[data-workbench-skeleton-fixture]";
export const SHELL_ROOT = "[data-workbench-shell]";

/** Part 宿主根：容器选择器、落点与 Mount 目标都在它里面。 */
export function partRoot(part: string): string {
    return `${SHELL_ROOT} [data-workbench-part="${part}"]`;
}

/** 容器的选择单元：多容器时是标签条里的一项，只有一个容器时是 Part 头上的可拖标题。 */
export function containerTab(containerId: string): string {
    return `${FIXTURE_ROOT} [data-container-tab="${containerId}"]`;
}

/**
 * 容器条目的**任意形态**：标签带里是 `[data-tab-id]`，左栏单容器标题是 `[data-container-tab]`，
 * 主侧栏的容器条目则在活动栏主入口组（`[data-activity-id]`）——三者都是同一个切换器落点的呈现。
 *
 * 新模型里两者都是同一个切换器落点的呈现，拖动与落点脚本因此不该只认其中一种。
 */
export function containerEntry(containerId: string): string {
    return `${FIXTURE_ROOT} [data-tab-id="${containerId}"], ${FIXTURE_ROOT} [data-container-tab="${containerId}"], ${FIXTURE_ROOT} [data-activity-id="${containerId}"]`;
}

/** 容器实例宿主（`WorkbenchViewHost` 根）：用唯一的 `data-workbench-container` 排除 parking target。 */
export function containerHost(containerId: string): string {
    return `${FIXTURE_ROOT} [data-workbench-container="${containerId}"]`;
}

/** Part 里承载活动容器的挂载点：拖收起后它应当是零尺寸。 */
export function containerMount(containerId: string): string {
    return `${FIXTURE_ROOT} [data-container-mount="${containerId}"]`;
}

/** View 的 Section（Grid 叶内容）。 */
export function viewSection(viewId: string): string {
    return `${FIXTURE_ROOT} [data-view-id="${viewId}"]`;
}

/** View 标题的拖动面（整块标题，动作组与折叠按钮是它自己的子节点）。 */
export function viewHead(viewId: string): string {
    return `${viewSection(viewId)} [data-workbench-drag-kind="view"]`;
}

/** 某个容器内部的 View Section：两段选择器必须**嵌套**，不能各带夹具根前缀拼接。 */
export function viewSectionIn(containerId: string, viewId: string): string {
    return `${containerHost(containerId)} [data-view-id="${viewId}"]`;
}

/** 某个容器内部的 View 标题拖动面。 */
export function viewHeadIn(containerId: string, viewId: string): string {
    return `${viewSectionIn(containerId, viewId)} [data-workbench-drag-kind="view"]`;
}

/** 分隔线：key 形如 `body:0` 或 `container:lab.container.left:0`。 */
export function sashSelector(key: string): string {
    return `${FIXTURE_ROOT} [data-sash="${key}"]`;
}

/** 某个容器内部的 View 叶（按顺序），用于断言同屏与顺序。 */
export function viewLeavesOf(containerId: string, page: Page): Promise<string[]> {
    return page.evaluate(`(() => {
        const host = document.querySelector(${JSON.stringify(containerHost(containerId))});
        if (host === null) return [];
        return [...host.querySelectorAll("[data-panel-id]")].map((el) => el.getAttribute("data-panel-id"));
    })()`) as Promise<string[]>;
}

export type LeafRect = {left: number; top: number; right: number; bottom: number; width: number; height: number};

export type ShellGeometry = {
    mode: string;
    activity: LeafRect | null;
    left: LeafRect | null;
    editor: LeafRect | null;
    right: LeafRect | null;
    panel: LeafRect | null;
    titlebar: LeafRect | null;
    statusbar: LeafRect | null;
    overflow: number;
    diagnostics: string;
};

/** 壳的七个叶矩形：用**精确叶 id** 取，容器内部的 `view:<viewId>` 叶不会串进来。 */
export async function readGeometry(page: Page): Promise<ShellGeometry> {
    return await page.evaluate(`(() => {
        const root = document.querySelector("[data-workbench-skeleton-fixture]") ?? document;
        const rect = (id) => {
            const element = root.querySelector('[data-workbench-shell] [data-leaf="' + id + '"]');
            if (!element) return null;
            const box = element.getBoundingClientRect();
            return {left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height};
        };
        const shell = root.querySelector("[data-workbench-shell]");
        return {
            mode: shell ? (shell.getAttribute("data-shell-layout") ?? "split") : "split",
            activity: rect("activity"),
            left: rect("left"),
            editor: rect("editor"),
            right: rect("right"),
            panel: rect("panel"),
            titlebar: rect("titlebar"),
            statusbar: rect("statusbar"),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            diagnostics: shell ? (shell.getAttribute("data-layout-diagnostics") ?? "") : "",
        };
    })()`) as ShellGeometry;
}

/** 元素矩形（取不到返回 null）：`page` 端只按选择器找，不猜结构。 */
export async function rectOf(page: Page, selector: string): Promise<LeafRect | null> {
    return await page.evaluate(`(() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (element === null) return null;
        const box = element.getBoundingClientRect();
        return {left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height};
    })()`) as LeafRect | null;
}

export function near(left: number, right: number, tolerance = 1.5): boolean {
    return Math.abs(left - right) <= tolerance;
}

/** 选中 Lab 左侧导航树里的一个组件（夹具）。 */
export async function selectFixture(page: Page, name: string): Promise<void> {
    await page.locator('[role="tab"]').filter({hasText: "文档"}).click();
    await page.locator(NAV_SEARCH).fill(name);
    await page.waitForTimeout(150);
    await page.locator(NAV_TREE).filter({hasText: new RegExp(`^${name}`, "u")}).first().click();
    await page.locator(FIXTURE_ROOT).first().waitFor({state: "visible", timeout: 10_000});
    await page.waitForTimeout(350);
}

/** 切场景（夹具用 `data-value=<sceneId>` 的按钮组）。 */
/**
 * 选场景：Lab 的控件随场景数变化——不多于 4 个时是分段控件（`role="radio"`），
 * 更多时是下拉（`role="option"`，同样带 `data-value`）。两种都是真实入口，验收脚本两种都要走得通。
 */
export async function selectScene(page: Page, sceneId: string): Promise<void> {
    const radio = page.locator(`[role="radio"][data-value="${sceneId}"]`);
    if (await radio.count() === 0) {
        await clickCenter(page, page.locator("button[aria-label=\"场景\"]"), "打开场景下拉");
        await page.locator(`[role="option"][data-value="${sceneId}"]`).click();
    } else {
        await radio.click();
    }
    await page.waitForTimeout(350);
}

/**
 * 把 Lab 的舞台滚回原点。
 *
 * `.nb-lab-stage` 是**可横向滚动**的容器：焦点或滚动一旦把它推开，夹具在视口里的坐标就整体左移，
 * 后面所有基于 `boundingBox()` 的真实指针都会压到左侧导航树上，把 Lab 切到别的组件。
 */
export async function resetStageScroll(page: Page): Promise<void> {
    // 纵向也要复位：视口不够高时舞台会纵向滚动，夹具底部的状态栏会滑出可视区，
    // 之后所有基于 boundingBox() 的点击都会落在 Lab 自己的控制面板上。
    await page.evaluate(`(() => {
        const stage = document.querySelector(".nb-lab-stage");
        if (stage !== null) { stage.scrollLeft = 0; stage.scrollTop = 0; }
        window.scrollTo(0, 0);
    })()`).catch(() => undefined);
}

/** 在元素中心发一次真实指针点击（先确认可见并拿到矩形）。 */
export async function clickCenter(page: Page, locator: ReturnType<Page["locator"]>, description: string): Promise<void> {
    await resetStageScroll(page);
    await locator.waitFor({state: "visible", timeout: 5000});
    const box = await locator.boundingBox();
    if (box === null) {
        throw new Error(`${description}：拿不到矩形`);
    }
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(220);
}

/**
 * 关掉 Lab 画布**自己**的缩放柄（`.nb-lab-stage-handle`）。
 *
 * 东侧手柄贴着画布右缘，正好压在骨架右栏的分隔线上（分隔线只有 1px，指针按下会被手柄接走）：
 * 结果是「分隔线没反应」而且画布宽度被改掉（1277px），后续格的几何也跟着变。
 * 量的是骨架自己的手势，所以先停掉 Lab 外框的手柄，量完用 `restoreStageHandles` 还原。
 */
export async function muteStageHandles(page: Page): Promise<void> {
    await page.evaluate(`(() => {
        for (const element of document.querySelectorAll(".nb-lab-stage-handle")) {
            element.setAttribute("data-lab-handle-muted", element.style.pointerEvents);
            element.style.pointerEvents = "none";
        }
    })()`);
}

/** 还原 `muteStageHandles` 停掉的手柄（原值一并还原，不留下与实现不符的内联样式）。 */
export async function restoreStageHandles(page: Page): Promise<void> {
    await page.evaluate(`(() => {
        for (const element of document.querySelectorAll("[data-lab-handle-muted]")) {
            element.style.pointerEvents = element.getAttribute("data-lab-handle-muted") ?? "";
            element.removeAttribute("data-lab-handle-muted");
        }
    })()`);
}

/** 关掉还开着的浮层并等它退场；指针移开，舞台滚回原点。 */
export async function settleMenus(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await page.mouse.move(4, 4);
    await page.waitForFunction(
        () => document.querySelectorAll('[role="menu"][data-state="open"]').length === 0,
        undefined,
        {timeout: 3000},
    ).catch(() => undefined);
    await resetStageScroll(page);
    await page.waitForTimeout(120);
}

/** 当前焦点元素的文本（菜单用 roving focus，焦点就是「当前项」）。 */
export async function focusedText(page: Page): Promise<string> {
    return await page.evaluate(`(() => { const el = document.activeElement; return el ? (el.textContent || "").trim() : ""; })()`) as string;
}

/** 菜单是否真的打开了（打开子菜单 / 选项前的守卫）。 */
export async function menuOpen(page: Page): Promise<boolean> {
    return await page.evaluate(`document.querySelectorAll('[role="menu"][data-state="open"]').length > 0`) as boolean;
}

/**
 * 走标题动作的「更多」菜单（真实键盘路径，`trail` 支持一层子菜单）。
 *
 * 键盘漫游而不是指针：Reka 的浮层在动画 / 重定位期间会让 Playwright 的可操作性等待一直卡住。
 * `locator.focus()` 会把触发器滚进视野，所以聚焦后**立刻**归零一次舞台滚动。
 */
async function roamMenu(page: Page, triggerSelector: string, trail: readonly string[], description: string): Promise<void> {
    try {
        await settleMenus(page);
        const trigger = page.locator(`${triggerSelector} [data-title-action="more"]:visible`).first();
        await trigger.focus();
        await resetStageScroll(page);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(250);
        if (!await menuOpen(page)) {
            throw new Error("Enter 没有打开菜单");
        }
        await page.keyboard.press("Home");
        await page.waitForTimeout(80);
        for (let index = 0; index < trail.length; index += 1) {
            const last = index === trail.length - 1;
            let hops = 0;
            while (!(await focusedText(page)).includes(trail[index]!) && hops < 24) {
                if (!await menuOpen(page)) {
                    throw new Error(`漫游到第 ${hops} 步时菜单已关闭（目标「${trail[index]}」，当前焦点：${await focusedText(page) || "无"}）`);
                }
                await page.keyboard.press("ArrowDown");
                hops += 1;
                await page.waitForTimeout(50);
            }
            if (!(await focusedText(page)).includes(trail[index]!)) {
                throw new Error(`漫游找不到「${trail[index]}」（当前焦点：${await focusedText(page) || "无"}）`);
            }
            if (!last) {
                await page.keyboard.press("ArrowRight");
                await page.waitForTimeout(160);
            }
        }
        await page.keyboard.press("Enter");
        await page.waitForTimeout(300);
    } catch (error) {
        const reason = (error instanceof Error ? error.message : String(error))
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== "")
            .slice(0, 3)
            .join(" ⏎ ");
        const snapshot = await page.evaluate(`(() => [...document.querySelectorAll('[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]')].map((el) => (el.textContent || "").trim().slice(0, 12)).join(" ; "))()`).catch(() => "") as string;
        throw new Error(`${description}（未点到菜单路径：${trail.join(" → ")}；原因：${reason}；当时菜单项：${snapshot}）`);
    }
}

/** 框架动作（位置 / 对齐 / 收起 / 最大化 / 隐藏）：按 **Panel Part** 定位。 */
export async function choosePanelMenu(page: Page, labels: string | readonly string[], failures: SmokeFailure[], description: string): Promise<boolean> {
    const trail = typeof labels === "string" ? [labels] : [...labels];
    try {
        await roamMenu(page, `${partRoot("panel")} [data-title-actions="panel"]`, trail, description);
        return true;
    } catch (error) {
        failures.push({kind: "assertion", message: error instanceof Error ? error.message : String(error)});
        await settleMenus(page);
        return false;
    }
}

/** 容器动作（移动到其它落位 / 恢复默认落点）：按**容器的 Part 宿主**定位。 */
export async function chooseContainerMenu(page: Page, part: string, labels: string | readonly string[], failures: SmokeFailure[], description: string): Promise<boolean> {
    const trail = typeof labels === "string" ? [labels] : [...labels];
    try {
        await roamMenu(page, `${partRoot(part)} [data-title-actions="container"]`, trail, description);
        return true;
    } catch (error) {
        failures.push({kind: "assertion", message: error instanceof Error ? error.message : String(error)});
        await settleMenus(page);
        return false;
    }
}

/** View 自己的动作菜单：按 **viewId 的 Section** 定位，不落到别的 View 上。 */
export async function chooseViewMenu(page: Page, viewId: string, labels: string | readonly string[], failures: SmokeFailure[], description: string): Promise<boolean> {
    const trail = typeof labels === "string" ? [labels] : [...labels];
    try {
        await roamMenu(page, `${viewSection(viewId)} [data-title-actions="view"]`, trail, description);
        return true;
    } catch (error) {
        failures.push({kind: "assertion", message: error instanceof Error ? error.message : String(error)});
        await settleMenus(page);
        return false;
    }
}

/** 主操作：按钮在场就直接点，被折进「更多」时从菜单里选（两条都是真实用户路径）。 */
export async function invokeViewAction(page: Page, viewId: string, actionId: string, menuLabel: string, failures: SmokeFailure[], description: string): Promise<boolean> {
    await resetStageScroll(page);
    const button = page.locator(`${viewSection(viewId)} [data-title-actions="view"] [data-title-action="${actionId}"]:visible`).first();
    if (await button.count() > 0) {
        try {
            await clickCenter(page, button, `${description}（直接点按钮）`);
            return true;
        } catch {
            // 直接点失败（被折叠 / 被遮挡）→ 走菜单路径，这也是用户看得见的入口。
        }
    }
    return await chooseViewMenu(page, viewId, menuLabel, failures, description);
}

/**
 * 事件面板里的原始文本（Lab fixture 用 emitLabEvent 记录；只读文本，不解析结构）。
 *
 * 用真实指针切页并给一个有界等待：Lab 检查器的页签在动画 / 浮层下会让 Playwright 的可操作性等待
 * 一路等到默认超时，日志里就只剩「textContent 超时」，看不出是哪一步。
 */
export async function eventLog(page: Page): Promise<string> {
    await settleMenus(page);
    const tab = page.locator('[role="tab"]').filter({hasText: "事件"}).first();
    await tab.click({force: true});
    const panel = page.locator('[data-lab-panel="events"]').first();
    await panel.waitFor({state: "visible", timeout: 2500});
    await page.locator('[role="tab"][aria-selected="true"]').filter({hasText: "事件"}).first().waitFor({state: "visible", timeout: 2500});
    // 面板里没有文本节点时 `textContent` 是 `null`：语义是「这一场还没有事件」，明确归一成空串，
    // 不让 `null` 顺着 `eventCount` / `lastEvent` 的类型往下漏。
    const text = await panel.textContent() ?? "";
    const docTab = page.locator('[role="tab"]').filter({hasText: "文档"}).first();
    await docTab.click({force: true});
    await page.locator('[role="tab"][aria-selected="true"]').filter({hasText: "文档"}).first().waitFor({state: "visible", timeout: 2500});
    return text.replace(/\s+/gu, " ");
}

/** 某一类事件的条数（事件面板文本里按名字计数）。 */
export async function eventCount(page: Page, name: string): Promise<number> {
    const log = await eventLog(page);
    return log.split(name).length - 1;
}

/**
 * 最近一条某类事件的**完整 JSON 载荷**（事件面板文本是 `事件名{...}` 连排，
 * 直接往后切固定长度会把后面的事件也切进来，所以按花括号配平取）。
 */
export async function lastEvent(page: Page, name: string): Promise<string> {
    const log = await eventLog(page);
    // 事件面板按时间**倒序**渲染（最新在最上面），所以第一条匹配就是最近一次。
    const index = log.indexOf(name);
    if (index < 0) {
        return "";
    }
    const start = log.indexOf("{", index);
    if (start < 0) {
        return log.slice(index, index + 120);
    }
    let depth = 0;
    for (let cursor = start; cursor < log.length; cursor += 1) {
        const character = log[cursor];
        if (character === "{" || character === "[") depth += 1;
        if (character === "}" || character === "]") {
            depth -= 1;
            if (depth === 0) {
                return log.slice(index, cursor + 1);
            }
        }
    }
    return log.slice(index, start + 200);
}

/**
 * 等容器宿主真的落进某个 Part（`Teleport` 在下一帧才搬 DOM，落点先出现、宿主后到）。
 * 返回是否在超时前落到目标 Part，不落到就是真的没搬过去。
 */
export async function waitForContainerPart(page: Page, containerId: string, part: string, timeout = 4000): Promise<boolean> {
    try {
        await page.waitForFunction(`(() => {
            const host = document.querySelector('[data-workbench-container="' + ${JSON.stringify(containerId)} + '"]');
            if (host === null || host.closest("[data-container-parking]") !== null) return false;
            const owner = host.closest("[data-workbench-part]");
            return owner !== null && owner.getAttribute("data-workbench-part") === ${JSON.stringify(part)};
        })()`, undefined, {timeout});
        return true;
    } catch {
        return false;
    }
}

/** 某个容器此刻挂在哪：Part 宿主 / 挂载点 / parking，用于断言失败时直接给出证据。 */
export async function containerLocation(page: Page, containerId: string): Promise<string> {
    return await page.evaluate(`(() => {
        const hosts = [...document.querySelectorAll('[data-workbench-container="' + ${JSON.stringify(containerId)} + '"]')];
        if (hosts.length === 0) return "宿主不在 DOM 里";
        return hosts.map((host) => {
            const part = host.closest("[data-workbench-part]");
            const mount = host.closest("[data-container-mount]");
            const parking = host.closest("[data-container-parking]");
            const rect = host.getBoundingClientRect();
            return "part=" + (part === null ? "无" : part.getAttribute("data-workbench-part"))
                + " mount=" + (mount === null ? "无" : mount.getAttribute("data-container-mount"))
                + (parking === null ? " parking" : "")
                + " connected=" + String(host.isConnected)
                + " size=" + Math.round(rect.width) + "x" + Math.round(rect.height);
        }).join(" | ");
    })()`) as string;
}

/** 路径采样留下的一帧：`progress` 是这一帧在路径上的完成比例，`value` 是当帧的读数。 */
export type SampledFrame<T> = Readonly<{progress: number; value: T}>;

/**
 * 帧收集器：把 `dragPointer` / `dragSash` / `dragOnto` 的 `sample` 直接接到它上面，
 * 路径上每一帧的读数按顺序留下。「连续两帧都有正确形状」这类断言看 `frames` 就行，
 * 不必在套件里自己攒数组。
 */
export function frameSampler<T>(read: () => Promise<T>): {frames: SampledFrame<T>[]; sample: (progress: number) => Promise<void>} {
    const frames: SampledFrame<T>[] = [];
    return {
        frames,
        sample: async (progress: number) => {
            frames.push({progress, value: await read()});
        },
    };
}

/** 一次真实指针拖拽：从起点按下、按 steps 分步移动，可选中途采样与 Escape 取消。 */
export async function dragPointer(
    page: Page,
    from: {x: number; y: number},
    to: {x: number; y: number},
    options: {steps?: number; escape?: boolean; sample?: (progress: number) => Promise<void>} = {},
): Promise<void> {
    const steps = options.steps ?? 8;
    await resetStageScroll(page);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= steps; step += 1) {
        await page.mouse.move(from.x + (to.x - from.x) * step / steps, from.y + (to.y - from.y) * step / steps);
        if (options.sample !== undefined && step <= steps - 1) {
            await page.waitForTimeout(60);
            await options.sample(step / steps);
        }
    }
    await page.waitForTimeout(120);
    if (options.escape === true) {
        // Escape 取消之后**仍然要松手**：真实用户会松开按键，而不松开的话后面所有「点击」
        // 都会变成按住拖动，把检查器页签之类的操作全带偏。
        await page.keyboard.press("Escape");
        await page.waitForTimeout(100);
    }
    await page.mouse.up();
    await page.waitForTimeout(320);
}

/** 从分隔线中心按下并移动一段位移（正 dx 向右、正 dy 向下）。 */
export async function dragSash(page: Page, sashKey: string, dx: number, dy: number, options: {escape?: boolean; sample?: (progress: number) => Promise<void>} = {}): Promise<boolean> {
    const rect = await rectOf(page, sashSelector(sashKey));
    if (rect === null || rect.width + rect.height <= 0) {
        return false;
    }
    await dragPointer(page, {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}, {
        x: rect.left + rect.width / 2 + dx,
        y: rect.top + rect.height / 2 + dy,
    }, options);
    return true;
}

/** 落点瞄准比例：`0` = 上/左缘，`1` = 下/右缘，缺省 = `0.5`（中心）。 */
export type DropAim = Readonly<{x?: number; y?: number}>;

/**
 * 页面内的瞄准函数（串进 `page.evaluate`）：把目标矩形夹进舞台可见区，取 `aim` 比例处；
 * 那里命中不了（被别的元素盖住）就在内缩的环上找；全都不命中返回 `null`。
 * `dragOnto` 与 `aimAt` 共用这一份——落点命中全仓只有一套实现。
 */
const AIM_PICKER = `((stage, element, aim, exact = false) => {
    const view = stage.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    const left = Math.max(box.left + 2, view.left + 3, 2);
    const right = Math.min(box.right - 2, view.right - 3, innerWidth - 2);
    const top = Math.max(box.top + 2, view.top + 3, 2);
    const bottom = Math.min(box.bottom - 2, view.bottom - 3, innerHeight - 2);
    if (right <= left || bottom <= top) return null;
    const hits = (x, y) => { const hit = document.elementFromPoint(x, y); return hit !== null && (hit === element || element.contains(hit)); };
    const ratio = (value) => (typeof value === "number" && Number.isFinite(value)) ? Math.min(1, Math.max(0, value)) : 0.5;
    const cx = left + (right - left) * ratio(aim ? aim.x : undefined);
    const cy = top + (bottom - top) * ratio(aim ? aim.y : undefined);
    if (hits(cx, cy)) return {x: cx, y: cy};
    if (exact) return null;
    for (let ring = 1; ring <= 5; ring += 1) {
        for (const [fx, fy] of [[0, 0], [0, 1], [1, 0], [1, 1], [-1, 0], [0, -1], [1, -1], [-1, 1], [-1, -1]]) {
            const x = cx + (right - left) / 2 * fx * (ring / 5);
            const y = cy + (bottom - top) / 2 * fy * (ring / 5);
            if (x > left && x < right && y > top && y < bottom && hits(x, y)) return {x, y};
        }
    }
    return null;
})`;

/**
 * 把一个选择器换算成**可命中**的指针坐标（viewport 坐标）：目标与舞台可见区交集内的 `aim`
 * 比例点（默认中心），被盖住时在内缩环上找；目标整体不在可见区里就返回 `null`（先
 * `resetStageScroll` 或自己滚舞台）。
 *
 * 给「一条手势穿过多个落点」这类路径用：`dragPointer` 只吃坐标，用它把选择器换成坐标，
 * 套件里就不必再写第二套命中判定。
 */
export async function aimAt(page: Page, selector: string, aim: DropAim = {}): Promise<{x: number; y: number} | null> {
    return await page.evaluate(`(() => {
        const stage = document.querySelector(".nb-lab-stage");
        const element = document.querySelector(${JSON.stringify(selector)});
        if (stage === null || element === null) return null;
        return ${AIM_PICKER}(stage, element, ${JSON.stringify(aim)});
    })()`) as {x: number; y: number} | null;
}

/**
 * 把拖动源拖到落点（dnd-kit 的真实指针路径）。
 *
 * 先按**舞台可见区**瞄准：`.nb-lab-stage` 既可横向滚动、又比画布窄，直接拿 `boundingBox()` 的坐标
 * 按下可能压在舞台外面（Lab 的导航树或检查器面板），拖动根本没开始。落点取交集中心而不是第一格：
 * 左上角常贴着活动栏 / 分隔条，拖动中的自动滚动挪十几像素就出界。
 *
 * 指针按 `steps` 步走完：给了 `sample` 时**每步之间停一帧**再采样，一条手势因此能留下多帧
 * （「连续两帧都有正确形状」这类断言靠它）。回调会被调用多次，最后一次是到达落点后的稳定帧
 * （`progress = 1`，此时指针停在落点上，与松手位置同源）；旧的无参回调照旧可用。
 */
export async function dragOnto(
    page: Page,
    fromSelector: string,
    toSelector: string,
    options: {
        escape?: boolean;
        /** 指针分几步走到落点（默认 14）：给了 `sample` 时每步之间等 60ms 再采样。 */
        steps?: number;
        /** 落点在目标可命中区里的比例（0=上/左缘，1=下/右缘，默认中心）。 */
        aim?: DropAim;
        /** 拒绝场景保留指定比例点；被盖住时失败，不能改投别处。 */
        exactAim?: boolean;
        /**
         * 松手前采样：路径每步一次，到达落点后连续两帧；同时提供实际指针坐标。
         * 采样点在**松手之前**——这时预览层还挂着，才读得到判定给出的形状。
         */
        sample?: (progress: number, point: {x: number; y: number}) => Promise<void>;
    } = {},
): Promise<{ok: boolean; note: string}> {
    const aim = await page.evaluate(`(() => {
        const stage = document.querySelector(".nb-lab-stage");
        const handle = document.querySelector(${JSON.stringify(fromSelector)});
        const target = document.querySelector(${JSON.stringify(toSelector)});
        if (!stage || !handle || !target) {
            return {ok: false, note: "stage=" + Boolean(stage) + " from=" + Boolean(handle) + " to=" + Boolean(target)};
        }
        const stage0 = stage.getBoundingClientRect();
        const from0 = handle.getBoundingClientRect();
        const to0 = target.getBoundingClientRect();
        const pick = ${AIM_PICKER};
        // 两端已经在可见舞台内时不要横向居中整个宽元素；那会把小切换器条目滚出窄视口。
        if (!pick(stage, handle, null) || !pick(stage, target, ${JSON.stringify(options.aim ?? {})}, ${options.exactAim === true})) {
            const centre = (Math.min(from0.left, to0.left) + Math.max(from0.right, to0.right)) / 2;
            stage.scrollLeft += centre - (stage0.left + stage0.width / 2);
        }
        const view = stage.getBoundingClientRect();
        const describe = (element, point) => {
            const box = element.getBoundingClientRect();
            return "[" + Math.round(box.x) + "," + Math.round(box.y) + " " + Math.round(box.width) + "x" + Math.round(box.height)
                + (point ? " 命中" + Math.round(point.x) + "," + Math.round(point.y) : " 不可命中") + "]";
        };
        const from = pick(stage, handle, null);
        const to = pick(stage, target, ${JSON.stringify(options.aim ?? {})}, ${options.exactAim === true});
        return {
            ok: Boolean(from && to),
            from,
            to,
            note: "from=" + describe(handle, from) + " to=" + describe(target, to)
                + " 舞台可见区=" + Math.round(view.left) + ".." + Math.round(view.right) + " scrollLeft=" + Math.round(stage.scrollLeft),
        };
    })()`) as {ok: boolean; from?: {x: number; y: number}; to?: {x: number; y: number}; note: string};
    if (!aim.ok || !aim.from || !aim.to) {
        return {ok: false, note: aim.note};
    }
    const distance = Math.hypot(aim.to.x - aim.from.x, aim.to.y - aim.from.y);
    if (distance <= 6) {
        return {ok: false, note: `${aim.note}；路径 ${distance}px 未越过激活阈值`};
    }
    const source = await page.locator(fromSelector).first().evaluateHandle((element) =>
        element.closest<HTMLElement>("[data-workbench-drag-kind]")
        ?? element.querySelector<HTMLElement>("[data-workbench-drag-kind]"));
    const hitChain = async (point: {x: number; y: number}): Promise<string[]> => page.evaluate(({x, y}) =>
        document.elementsFromPoint(x, y).map((element) => `${element.tagName}.${element.className}`), point);
    const startHits = await hitChain(aim.from);
    const steps = Math.max(1, Math.trunc(options.steps ?? 14));
    let activated = false;
    let completed = false;
    try {
        await page.mouse.move(aim.from.x, aim.from.y);
        await page.mouse.down();
        for (let step = 1; step <= steps; step += 1) {
            await page.mouse.move(
                aim.from.x + (aim.to.x - aim.from.x) * step / steps,
                aim.from.y + (aim.to.y - aim.from.y) * step / steps,
            );
            if (!activated && distance * step / steps > 6) {
                for (let attempt = 0; attempt < 10 && !activated; attempt += 1) {
                    activated = await source.evaluate((element) => element?.getAttribute("aria-grabbed") === "true");
                    if (!activated) await page.waitForTimeout(30);
                }
                if (!activated) {
                    return {ok: false, note: `${aim.note}；对应源未激活；按下命中=${JSON.stringify(startHits)}`};
                }
            }
            if (options.sample !== undefined && step < steps) {
                await page.waitForTimeout(60);
                await options.sample(step / steps, {
                    x: aim.from.x + (aim.to.x - aim.from.x) * step / steps,
                    y: aim.from.y + (aim.to.y - aim.from.y) * step / steps,
                });
            }
        }
        await page.waitForTimeout(140);
        await options.sample?.(1, aim.to);
        await page.waitForTimeout(60);
        await options.sample?.(1, aim.to);
        const endHits = await hitChain(aim.to);
        const note = `${aim.note}；源已激活=${activated}；按下命中=${JSON.stringify(startHits)}；落点命中=${JSON.stringify(endHits)}`;
        console.log(`[workbench-drag] ${note}`);
        if (options.escape === true) {
            await page.keyboard.press("Escape");
        }
        completed = true;
        return {ok: true, note};
    } finally {
        try {
            if (!completed) await page.keyboard.press("Escape");
        } finally {
            await page.mouse.up();
            await source.dispose();
            await page.waitForTimeout(380);
        }
    }
}

/** 拖放预览里一处形状的几何（viewport CSS px）。 */
export type DropPreviewRect = Readonly<{left: number; top: number; width: number; height: number}>;

/**
 * 覆盖层里一处形状（`data-drop-feedback-area` / `data-drop-feedback-line` / `data-drop-feedback-entry`）的完整读数。
 *
 * 三份几何都在：`nominal` 是适配器写进 inline style 的绘制几何（已内缩，不是语义命中矩形），`rendered`
 * 是浏览器真正画出来的，`clipped` 是它与视口 / `overflow` 祖先相交后剩下的可见范围。非法值一律
 * `null` 或写进 `problems`，**不兜成 0**：零尺寸与「没写」是两件事，兜 0 会把「没画出来」伪装成
 * 「画在 (0,0)」。
 */
export type DropPreviewShape = Readonly<{
    /** inline style 的原文（空串 = 这一项没写）；失败时用来给出可读证据。 */
    styleText: Readonly<{left: string; top: string; width: string; height: string}>;
    /** `styleText` 解析出的标称几何（CSS px）；缺项、非 px 或非有限值时为 `null`。 */
    nominal: DropPreviewRect | null;
    /** `getBoundingClientRect()`：浏览器真正画出来的矩形。 */
    rendered: DropPreviewRect;
    /** 渲染矩形两轴是否都为正（判定给出的几何必须正面积）。 */
    positiveArea: boolean;
    /** `nominal` 与 `rendered` 的逐边最大误差（px）；`nominal` 为 `null` 时同样是 `null`。 */
    delta: number | null;
    /** computed 的 `display` / `visibility` / `opacity` 原值（过渡中读到的是当帧插值）。 */
    computed: Readonly<{display: string; visibility: string; opacity: number}>;
    /** 与视口、`overflow` 裁剪祖先相交后的可见范围；完全被裁掉时为 `null`。 */
    clipped: DropPreviewRect | null;
    /** 屏幕上是否真的可见：computed 三项合格、渲染正面积、裁剪后仍是正面积。 */
    visible: boolean;
    /** 明确的问题清单（空数组 = 这处形状合法）。 */
    problems: readonly string[];
}>;

/** 拖动预览快照：语义标记 + 三处形状（area / line / entry）各自的标称与渲染读数。 */
export type DropPreviewSnapshot = Readonly<{
    kind: string | null;
    orientation: string | null;
    count: string | null;
    /** 语义标签文本（`data-drop-feedback-label`）；没有标签元素时为 `null`。 */
    label: string | null;
    /** 语义标签的渲染矩形：标签是自然尺寸的独立元素，不得撑大它所在的形状。 */
    labelRect: DropPreviewRect | null;
    labelVisible: boolean;
    labelInsideViewport: boolean;
    iconVisible: boolean;
    /** `aria-live` 播报文本（`data-drop-feedback-live`）：语义落点变化才更新，不逐像素播报。 */
    announced: string | null;
    /** 覆盖层根的计算 `pointer-events`：必须是 `none`，覆盖层不拦截拖动。 */
    pointerEvents: string;
    /** 覆盖层根自己的渲染矩形（fixed viewport 宿主）。 */
    overlay: DropPreviewRect;
    /** 内容落点的边缘插入带、中央保持叶或空容器整个内容盒。 */
    area: DropPreviewShape | null;
    /** 插入线。 */
    line: DropPreviewShape | null;
    /** 切换器条目高亮（接收条目或锚点条目）。 */
    entry: DropPreviewShape | null;
}>;

/**
 * 读取拖放预览层（`WorkbenchDropOverlay`）：必须在**松手之前**采样（`dragOnto` 的 `sample`），
 * 松手后这一层就没了。
 *
 * 三处形状各读三份：`nominal`（适配器写的绘制 inline style）、`rendered`（浏览器画的）、`clipped`
 * （在视口 / `overflow` 祖先里真正剩下的）。祖先给覆盖层换掉包含块（`backdrop-filter` /
 * `transform`）时前两份会差一个固定偏移，只读其中一份会让「线画在别处」整场溜过去；被裁掉的
 * 形状只有第三份看得出来。
 */
export async function readDropPreview(page: Page): Promise<DropPreviewSnapshot | null> {
    return await page.evaluate(`(() => {
        const overlay = document.querySelector("[data-drop-feedback]");
        if (overlay === null) {
            return null;
        }
        const box = (element) => {
            const rect = element.getBoundingClientRect();
            return {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
        };
        // 裁剪范围 = 视口 ∩ 每个 overflow 祖先的 client 盒：clientLeft/clientTop 已经排掉边框与滚动条。
        const clipOf = (element) => {
            const clips = (value) => value === "hidden" || value === "clip" || value === "auto" || value === "scroll";
            const clip = {left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight};
            for (let node = element.parentElement; node !== null; node = node.parentElement) {
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                const left = rect.left + node.clientLeft;
                const top = rect.top + node.clientTop;
                const right = left + node.clientWidth;
                const bottom = top + node.clientHeight;
                if (clips(style.overflowX)) { clip.left = Math.max(clip.left, left); clip.right = Math.min(clip.right, right); }
                if (clips(style.overflowY)) { clip.top = Math.max(clip.top, top); clip.bottom = Math.min(clip.bottom, bottom); }
            }
            return clip;
        };
        const length = (raw) => {
            const text = String(raw).trim();
            if (text === "") return {value: null, problem: "没写"};
            if (!text.endsWith("px")) return {value: null, problem: "不是 px：" + JSON.stringify(text)};
            const value = Number.parseFloat(text);
            return Number.isFinite(value) ? {value, problem: null} : {value: null, problem: "不是有限数：" + JSON.stringify(text)};
        };
        const shape = (element) => {
            if (element === null) return null;
            const problems = [];
            const styleText = {left: element.style.left, top: element.style.top, width: element.style.width, height: element.style.height};
            const parsed = {};
            for (const side of ["left", "top", "width", "height"]) {
                const read = length(styleText[side]);
                parsed[side] = read.value;
                if (read.problem !== null) problems.push("inline " + side + " " + read.problem);
            }
            const nominal = problems.length === 0 ? {left: parsed.left, top: parsed.top, width: parsed.width, height: parsed.height} : null;
            const rendered = box(element);
            const computedStyle = window.getComputedStyle(element);
            const opacityText = computedStyle.opacity;
            const opacity = Number.parseFloat(opacityText);
            if (!Number.isFinite(opacity)) problems.push("computed opacity 不是有限数：" + JSON.stringify(opacityText));
            const computed = {display: computedStyle.display, visibility: computedStyle.visibility, opacity: Number.isFinite(opacity) ? opacity : 0};
            const positiveArea = rendered.width > 0 && rendered.height > 0;
            if (!(rendered.width > 0)) problems.push("渲染宽度不是正数：" + rendered.width);
            if (!(rendered.height > 0)) problems.push("渲染高度不是正数：" + rendered.height);
            if (computed.display === "none") problems.push("display=none");
            if (computed.visibility === "hidden" || computed.visibility === "collapse") problems.push("visibility=" + computed.visibility);
            if (computed.opacity <= 0) problems.push("opacity=" + opacityText);
            const clip = clipOf(element);
            const overlap = {
                left: Math.max(rendered.left, clip.left),
                top: Math.max(rendered.top, clip.top),
                right: Math.min(rendered.left + rendered.width, clip.right),
                bottom: Math.min(rendered.top + rendered.height, clip.bottom),
            };
            const clipped = overlap.right > overlap.left && overlap.bottom > overlap.top
                ? {left: overlap.left, top: overlap.top, width: overlap.right - overlap.left, height: overlap.bottom - overlap.top}
                : null;
            if (clipped === null && positiveArea) {
                problems.push("被裁剪掉：渲染 " + Math.round(rendered.left) + "," + Math.round(rendered.top) + " " + Math.round(rendered.width) + "x" + Math.round(rendered.height)
                    + "；裁剪范围 " + Math.round(clip.left) + "," + Math.round(clip.top) + " " + Math.round(clip.right - clip.left) + "x" + Math.round(clip.bottom - clip.top));
            }
            const delta = nominal === null ? null : Math.max(
                Math.abs(nominal.left - rendered.left),
                Math.abs(nominal.top - rendered.top),
                Math.abs(nominal.left + nominal.width - (rendered.left + rendered.width)),
                Math.abs(nominal.top + nominal.height - (rendered.top + rendered.height)),
            );
            return {
                styleText,
                nominal,
                rendered,
                positiveArea,
                delta,
                computed,
                clipped,
                visible: computed.display !== "none" && computed.visibility !== "hidden" && computed.visibility !== "collapse"
                    && computed.opacity > 0 && positiveArea && clipped !== null,
                problems,
            };
        };
        const label = overlay.querySelector("[data-drop-feedback-label]");
        const live = overlay.querySelector("[data-drop-feedback-live]");
        const visible = (element) => {
            if (element === null) return false;
            const rect = box(element);
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== "none"
                && style.visibility === "visible" && Number(style.opacity) > 0;
        };
        const labelRect = label === null ? null : box(label);
        const icon = label?.querySelector('[data-drop-indicator-label] > span[aria-hidden="true"]');
        return {
            kind: overlay.getAttribute("data-drop-kind"),
            orientation: overlay.getAttribute("data-drop-orientation"),
            count: overlay.getAttribute("data-drop-count"),
            label: label === null ? null : (label.textContent || "").trim(),
            labelRect,
            labelVisible: visible(label),
            labelInsideViewport: labelRect !== null && labelRect.left >= 7 && labelRect.top >= 7
                && labelRect.left + labelRect.width <= innerWidth - 7 && labelRect.top + labelRect.height <= innerHeight - 7,
            iconVisible: visible(icon ?? null) && getComputedStyle(icon).maskImage !== "none",
            announced: live === null ? null : (live.textContent || "").trim(),
            pointerEvents: window.getComputedStyle(overlay).pointerEvents,
            overlay: box(overlay),
            area: shape(overlay.querySelector("[data-drop-feedback-area]")),
            line: shape(overlay.querySelector("[data-drop-feedback-line]")),
            entry: shape(overlay.querySelector("[data-drop-feedback-entry]")),
        };
    })()`) as DropPreviewSnapshot | null;
}

/**
 * 断言一处预览形状在屏幕上真的可见（area / line / entry 都用它）：标称几何合法、渲染与裁剪后
 * 都是正面积、computed 三项合格，且标称与渲染的坐标误差 ≤ `tolerance`（默认 1 CSS px，与合同一致）。
 */
export function expectDropShape(
    shape: DropPreviewShape | null,
    failures: SmokeFailure[],
    description: string,
    options: {tolerance?: number; minimum?: number} = {},
): void {
    if (shape === null) {
        failures.push({kind: "assertion", message: `${description}（这处形状不在 DOM 里）`});
        return;
    }
    const nominal = shape.nominal === null
        ? `非法（inline ${JSON.stringify(shape.styleText)}）`
        : `${shape.nominal.left.toFixed(1)},${shape.nominal.top.toFixed(1)} ${shape.nominal.width.toFixed(1)}x${shape.nominal.height.toFixed(1)}`;
    const rendered = `${shape.rendered.left.toFixed(1)},${shape.rendered.top.toFixed(1)} ${shape.rendered.width.toFixed(1)}x${shape.rendered.height.toFixed(1)}`;
    if (shape.problems.length > 0) {
        failures.push({kind: "assertion", message: `${description}：${shape.problems.join("；")}（标称 ${nominal}；渲染 ${rendered}）`});
        return;
    }
    const minimum = options.minimum ?? 1;
    if (shape.clipped === null || shape.clipped.width < minimum || shape.clipped.height < minimum) {
        failures.push({kind: "assertion", message: `${description}：屏幕可见形状应至少 ${minimum}px（${shape.clipped === null ? "被完全裁掉" : `${shape.clipped.width.toFixed(1)}x${shape.clipped.height.toFixed(1)}`}）`});
        return;
    }
    const tolerance = options.tolerance ?? 1;
    if (shape.delta === null || shape.delta > tolerance) {
        failures.push({kind: "assertion", message: `${description}：标称与渲染的坐标误差应 ≤ ${tolerance}px（标称 ${nominal}；渲染 ${rendered}；误差 ${shape.delta === null ? "无法比较" : `${shape.delta.toFixed(2)}px`}）`});
    }
}

/**
 * 壳当前挂着的诊断条目：它是**最近 3 条的环**，旧条目（例如前面故意按的 Escape）会一直挂着，
 * 所以断言要用「本次有没有新增」而不是「等于空」。
 */
export async function diagnosticsOf(page: Page): Promise<string[]> {
    const text = await page.evaluate(`document.querySelector("[data-workbench-shell]")?.getAttribute("data-layout-diagnostics") ?? ""`) as string;
    return text === "" ? [] : text.split(" | ");
}

/** 本次段内新增的诊断条目（相对基线）。 */
export function freshDiagnostics(baseline: readonly string[], current: readonly string[]): string[] {
    return current.filter((entry) => !baseline.includes(entry));
}

/**
 * 只挑「手势级」的失败诊断：容量不足导致的余量叶取 0 是**合法降级**（空间本来就不够），
 * 出现在挤压场景里不算异常；取消 / 未落账才是手势本身的问题。
 */
export function gestureDiagnostics(entries: readonly string[]): string[] {
    return entries.filter((entry) => entry.includes("手势被取消") || entry.includes("手势未落账") || entry.includes("没有落账"));
}

/**
 * 把辅助侧栏设成期望的显隐。
 *
 * 活动栏那两项是**切换**语义（点一下取反），验收里因此不能盲点：先读叶在不在（环境隐藏会把叶移出树，
 * 拖收起保留叶但是零内容），不一致才点，脚本就不受上一步留下的状态影响。
 */
/**
 * 等一件几何事实成立（最多 `timeout` 毫秒）：壳的恢复是「命令 → 记录 → 重排」的异步链，
 * 点完立刻读会读到上一帧。断言不该依赖一次点击后的固定等待，而该等事实出现。
 */
export async function waitForGeometry(
    page: Page,
    predicate: (geometry: ShellGeometry) => boolean,
    timeout = 2000,
): Promise<ShellGeometry | null> {
    const deadline = Date.now() + timeout;
    for (;;) {
        const geometry = await readGeometry(page);
        if (predicate(geometry)) {
            return geometry;
        }
        if (Date.now() >= deadline) {
            return null;
        }
        await page.waitForTimeout(120);
    }
}

export async function setRightSidebar(page: Page, visible: boolean): Promise<void> {
    const shown = await page.locator(`${SHELL_ROOT} [data-leaf="right"]`).count() > 0;
    if (shown === visible) {
        return;
    }
    await clickCenter(page, page.locator('[data-activity-id="toggle-right"]'), visible ? "显示辅助侧栏" : "隐藏辅助侧栏");
    await page.waitForTimeout(220);
}

/** 分步日志：真实浏览器验收卡住时能立刻看出停在哪一步（stage 最终写进失败原因）。 */
export function mark(next: string): void {
    console.log(`[workbench] ${next}`);
}

/** 每次交互后确认 Lab 还停在骨架夹具上：方向键若落到左侧导航树，Lab 会切到别的组件。 */
export async function checkpoint(page: Page, stage: string): Promise<void> {
    const present = await page.evaluate(`(() => {
        const root = document.querySelector("[data-workbench-skeleton-fixture]");
        if (root === null) return "夹具不在";
        return "夹具在 叶=" + [...root.querySelectorAll("[data-leaf]")].map((el) => el.getAttribute("data-leaf")).join(",");
    })()`).catch(() => "读取失败") as string;
    console.log(`[workbench]   · ${stage} → ${present}`);
}

/** 断言某个元素的矩形是「可见且非零」：收起态的零占用断言与它互补。 */
export function expectVisible(rect: LeafRect | null, failures: SmokeFailure[], description: string, minimum = 1): void {
    if (rect === null) {
        failures.push({kind: "assertion", message: `${description}（元素不在 DOM 里）`});
        return;
    }
    assert(rect.width >= minimum && rect.height >= minimum, failures, `${description}：实际 ${Math.round(rect.width)}x${Math.round(rect.height)}`);
}

/** 断言某个元素零占用（收起态：内容完全不占尺寸）。 */
export function expectCollapsed(rect: LeafRect | null, failures: SmokeFailure[], description: string): void {
    if (rect === null) {
        return;
    }
    assert(rect.width <= 0.5 && rect.height <= 0.5, failures, `${description}：实际 ${Math.round(rect.width)}x${Math.round(rect.height)}`);
}
