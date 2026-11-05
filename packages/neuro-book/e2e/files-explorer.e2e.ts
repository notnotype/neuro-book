/**
 * 资源管理器在真实 Chrome 中的验收（docs/specs/workbench/files-explorer.md 验收 1–4、10、14–16）：生产构建的
 * 后端与前端，项目 `book` 先按 runtime/projects.md 的格式登记好，文件在真实目录里。Storage、项目子进程、文件监视都是
 * 真的；重新加载同一页面是同一个客户端，用来看偏好与展开记录的恢复。
 */

import {randomUUID} from "node:crypto";
import {lstat, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProbeServer, startProductServer} from "./fixtures";
import type {ProbeServer, ProductServer} from "./fixtures";

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="alice" title="爱丽丝"/>
  <item name="bob" title="鲍勃"/>
</content>
`;

const ORDER = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="x"/>
  <item name="y"/>
  <item name="z"/>
</content>
`;

/** 大目录的文件数：远多于一屏，看虚拟滚动与焦点行。 */
const PLACE = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="p1">
    <item name="k1.md"/>
    <item name="k2.md"/>
  </item>
  <item name="p2.md"/>
  <item name="p3.md"/>
</content>
`;

const MANY = 400;

let tmp = "";
let projectDir = "";
let stateDir = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "files-explorer");
    projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
    stateDir = stateRoot;
    const id = randomUUID();
    const files: Record<string, string> = {
        ".nbook/project.json": JSON.stringify({schema: 1, id}),
        "lore.content/content.xml": MANIFEST,
        "lore.content/alice/notes.md": "A",
        "lore.content/bob/index.md": "BOB",
        "lore.content/stray.md": "S",
        "ops/keep.md": "K",
        "ops/doomed.md": "D",
        "ops/old.md": "O",
        "plain/index.md": "PI",
        "story.binder/binder.xml": "<binder/>",
        "story.binder/ch1.md": "C1",
        "plain/a.md": "PA",
        "moves/m1.md": "M1",
        "moves/m2.md": "M2",
        "moves/into/i.md": "I",
        "moves/keep/k.md": "K2",
        "drags/d1.md": "D1",
        "drags/d2.md": "D2",
        "drags/shut/s.md": "S",
        "drags/folder/f.md": "F",
        "卷/第二卷/a.md": "A2",
        "卷/第一卷/a.md": "A1",
        "卷/第十二章.md": "12",
        "卷/第三章.md": "3",
        "order.content/content.xml": ORDER,
        "order.content/x/index.md": "X",
        "order.content/y/index.md": "Y",
        "order.content/z/index.md": "Z",
        "r4/place.content/content.xml": PLACE,
        "r4/place.content/p1/index.md": "P1",
        "r4/place.content/p1/k1.md": "K1",
        "r4/place.content/p1/k2.md": "K2",
        "r4/place.content/p2.md": "P2",
        "r4/place.content/p3.md": "P3",
        "r4/loose/w.md": "W",
        "r4/anim/open/o.md": "O",
        "r4/anim/box/b.md": "B",
        "r4/anim/a1.md": "A1",
        "r4/anim/a2.md": "A2",
        "r4/anim/a3.md": "A3",
        "r4/anim/a4.md": "A4",
        ...Object.fromEntries(Array.from({length: MANY}, (_, index) => [`big/file-${String(index).padStart(4, "0")}.md`, String(index)])),
    };
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), text);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "user", "notes.md"), "U");
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const tree = (page: Page) => page.getByRole("tree", {name: "文件"});
const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);

async function open(page: Page, bound = true): Promise<void> {
    // 没有项目的 `/` 是书架页；外壳（含资源管理器）在 `/workbench`。
    await page.goto(new URL(bound ? "/?project=book" : "/workbench", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(tree(page)).toBeVisible();
}

test("项目根是作品名、标题行五个动作；展开时新行滑下淡入、动画后撤掉标记；鼠标点行不画焦点线、方向键之后画 1.5px 内嵌线；减少动态时不动画（验收 18、19）", async ({page}) => {
    await open(page);
    // 作品没有书名：项目根显示目录原名。
    await expect(item(page, "project://").locator("[data-explorer-label]")).toHaveText("Book");
    const actions = page.locator('[data-tool-part="sidebar"] [data-title-action]');
    await expect(actions).toHaveCount(5);
    for (const box of await actions.evaluateAll((buttons) => buttons.map((button) => [button.getBoundingClientRect().width, button.getBoundingClientRect().height]))) expect(box).toEqual([24, 24]);
    await expect(page.locator("[data-explorer-view] [role=toolbar]")).toHaveCount(0);

    // 记下树上展开标记的开关与进场的行。
    const record = () => page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as {__expanding: string[]}).__expanding = log;
        const treeElement = document.querySelector("[data-explorer-tree]")!;
        new MutationObserver((records) => {
            for (const changed of records) {
                const target = changed.target as Element;
                if (changed.attributeName === "data-motion") log.push(target.hasAttribute("data-motion") ? "on" : "off");
                else if (target.classList.contains("explorer-row-enter-active") && !log.includes("enter")) log.push("enter");
            }
        }).observe(treeElement, {subtree: true, attributes: true, attributeFilter: ["data-motion", "class"]});
    });
    const log = () => page.evaluate(() => (window as unknown as {__expanding: string[]}).__expanding);
    await record();
    await item(page, "project://ops").click();
    await expect(item(page, "project://ops/keep.md")).toBeVisible();
    // 标记与进场的行在同一次渲染里出现，记录里谁先谁后不定；最后撤掉标记。
    await expect.poll(log).toEqual(expect.arrayContaining(["on", "enter", "off"]));
    expect((await log()).at(-1)).toBe("off");

    const active = () => page.evaluate(() => getComputedStyle(document.querySelector(".explorer-row[data-active=\"true\"]")!).boxShadow);
    await item(page, "project://ops/keep.md").click();
    expect(await active()).toBe("none");
    await page.keyboard.press("ArrowDown");
    await expect.poll(active).toMatch(/0px 0px 0px 1\.5px inset$/u);
    await item(page, "project://ops").click();
    await expect(item(page, "project://ops/keep.md")).toHaveCount(0);

    await page.emulateMedia({reducedMotion: "reduce"});
    await record();
    await item(page, "project://ops").click();
    await expect(item(page, "project://ops/keep.md")).toBeVisible();
    await item(page, "project://ops").click();
    await expect(item(page, "project://ops/keep.md")).toHaveCount(0);
    expect(await log()).not.toContain("on");
});

test("三类文件夹按呈现规则显示；点普通目录展开、点文件在编辑器里以预览打开；用户资产根默认折叠", async ({page}) => {
    await open(page);
    await expect(item(page, "project://lore.content")).toBeVisible();
    await expect(item(page, "user://")).toHaveAttribute("aria-expanded", "false");
    await item(page, "project://lore.content").click();
    await expect(item(page, "project://lore.content/alice")).toContainText("爱丽丝");
    await expect(item(page, "project://lore.content/alice")).toHaveAttribute("aria-description", /无正文/u);
    await expect(item(page, "project://lore.content/bob")).toContainText("鲍勃");
    await expect(item(page, "project://lore.content/content.xml")).toHaveCount(0);
    await expect(item(page, "project://story.binder")).toHaveAttribute("aria-description", /需要剧情插件/u);
    await item(page, "project://plain").click();
    await expect(item(page, "project://plain/index.md")).toBeVisible();
    await item(page, "project://plain/a.md").click();
    await expect(item(page, "project://plain/a.md")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-editor-tab][data-editor-tab-preview] [data-editor-tab-label]")).toHaveText("a.md");
    await expect(page.locator("[data-explorer-feedback]")).toHaveCount(0);
});

test("显示清单文件与展开记录：重新加载后恢复；收起再展开不丢", async ({page}) => {
    await open(page);
    await item(page, "project://lore.content").click();
    await expect(item(page, "project://lore.content/alice")).toBeVisible();
    await page.locator("[data-title-action=\"nbook.files.toggle-manifests\"]").click();
    await expect(item(page, "project://lore.content/content.xml")).toBeVisible();
    await expect(page.locator("[data-title-action=\"nbook.files.toggle-manifests\"]")).toHaveAttribute("aria-pressed", "true");
    await item(page, "user://").click();
    await expect(item(page, "user://notes.md")).toBeVisible();

    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(item(page, "project://lore.content/content.xml")).toBeVisible();
    await expect(item(page, "user://notes.md")).toBeVisible();
    await expect(page.locator("[data-title-action=\"nbook.files.toggle-manifests\"]")).toHaveAttribute("aria-pressed", "true");

    // 恢复原状，后面的用例不受影响。
    await page.locator("[data-title-action=\"nbook.files.toggle-manifests\"]").click();
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
    await expect(item(page, "project://lore.content/alice")).toHaveCount(0);
    await item(page, "user://").click();
    await expect(item(page, "user://notes.md")).toHaveCount(0);
});

test("大目录：只渲染视口附近的行；键盘走到末尾，焦点行滚入视口，aria-activedescendant 指向它", async ({page}) => {
    await open(page);
    await item(page, "project://big").click();
    await expect(item(page, "project://big/file-0000.md")).toBeVisible();
    expect(await page.locator("[data-explorer-row^=\"project://big/\"]").count()).toBeLessThan(120);
    await item(page, "project://big/file-0000.md").click();
    await expect(tree(page)).toBeFocused();
    await page.keyboard.press("End");
    await expect(item(page, "user://")).toBeInViewport();
    // 大目录之后还有几个同层目录：往上走到最后一个文件。
    const lastFile = `project://big/file-${String(MANY - 1).padStart(4, "0")}.md`;
    for (let step = 0; step < 10 && await item(page, lastFile).getAttribute("aria-selected") !== "true"; step += 1) await page.keyboard.press("ArrowUp");
    await expect(item(page, lastFile)).toBeInViewport();
    await expect(item(page, lastFile)).toHaveAttribute("aria-selected", "true");
    const active = await tree(page).getAttribute("aria-activedescendant");
    expect(await page.evaluate((id) => document.getElementById(id ?? "")?.getAttribute("data-explorer-row"), active)).toBe(lastFile);
    expect(await item(page, "project://big/file-0000.md").count()).toBe(0);
    await page.keyboard.press("Home");
    await expect(item(page, "project://")).toBeInViewport();

    // 焦点在顶上，滚到中段；外部在前面插入一项：阅读位置不动，不被拉回焦点行。
    await item(page, "project://big/file-0000.md").click();
    await tree(page).evaluate((element) => {
        element.scrollTop = 5200;
    });
    const middle = item(page, "project://big/file-0200.md");
    await expect(middle).toBeInViewport();
    const before = (await middle.boundingBox())?.y;
    await writeFile(join(projectDir, "big", "000-inserted.md"), "I");
    await expect(item(page, "project://big/file-0200.md")).toHaveAttribute("aria-setsize", String(MANY + 1));
    await expect(middle).toBeInViewport();
    const after = (await middle.boundingBox())?.y;
    expect(Math.abs((after ?? 0) - (before ?? 0))).toBeLessThan(2);
    await rm(join(projectDir, "big", "000-inserted.md"));
    await expect(item(page, "project://big/file-0200.md")).toHaveAttribute("aria-setsize", String(MANY));

    // 主题改了行高（--control-h-sm）：阅读位置停在同一资源上，不按旧的像素位置漂到别的行。
    const anchorTop = async (): Promise<number> => ((await middle.boundingBox())?.y ?? 0) - ((await tree(page).boundingBox())?.y ?? 0);
    const anchored = await anchorTop();
    const height = (await middle.boundingBox())?.height ?? 0;
    await page.evaluate(() => document.documentElement.style.setProperty("--control-h-sm", "40px"));
    await expect.poll(async () => (await middle.boundingBox())?.height).toBe(40);
    await expect.poll(async () => Math.abs(await anchorTop() - anchored * (40 / height))).toBeLessThan(1.5);
    await page.evaluate(() => document.documentElement.style.removeProperty("--control-h-sm"));
    await expect.poll(async () => (await middle.boundingBox())?.height).toBe(height);
    await expect.poll(async () => Math.abs(await anchorTop() - anchored)).toBeLessThan(1.5);

    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
    await expect(item(page, "project://big/file-0000.md")).toHaveCount(0);
});

test("命令面板执行资源管理器的命令：全部收起", async ({page}) => {
    await open(page);
    if (await item(page, "project://ops").getAttribute("aria-expanded") !== "true") await item(page, "project://ops").click();
    await expect(item(page, "project://ops/keep.md")).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    const palette = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(palette).toBeFocused();
    await page.keyboard.type("全部收起");
    await expect(page.getByRole("option").filter({hasText: "全部收起"})).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(item(page, "project://ops/keep.md")).toHaveCount(0);
    await expect(item(page, "project://")).toHaveAttribute("aria-expanded", "true");
});

test("外部新建的文件出现在已展开的目录里", async ({page}) => {
    await open(page);
    await item(page, "project://plain").click();
    await expect(item(page, "project://plain/a.md")).toBeVisible();
    await writeFile(join(projectDir, "plain", "external.md"), "E");
    await expect(item(page, "project://plain/external.md")).toBeVisible();
    await item(page, "project://plain").click();
});

test("没有绑定项目：提示“尚未打开项目”，用户资产照常浏览", async ({page}) => {
    await open(page, false);
    await expect(page.locator("[data-explorer-unbound]")).toContainText("尚未打开项目");
    await expect(item(page, "project://")).toContainText("尚未打开项目");
    await item(page, "user://").click();
    await expect(item(page, "user://notes.md")).toBeVisible();
    await item(page, "user://").click();
});

const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);

/**
 * 页面经窗口的 RPC 套接字发给 Files 的写请求（方法名），在打开页面之前挂上。“没有写入”看它而不只看字节：同字节的
 * 写回也换了文件身份、发了事件。断言前先等屏障（`barrier`），让之前发出的请求都已记下。
 */
function recordWrites(page: Page): string[] {
    const writes: string[] = [];
    page.on("websocket", (socket) => socket.on("framesent", (frame) => {
        if (typeof frame.payload !== "string" || !frame.payload.includes("\"type\":\"request\"")) return;
        const parsed = JSON.parse(frame.payload) as {type?: string; effect?: string; contract?: string; method?: string};
        if (parsed.type === "request" && parsed.effect === "write" && parsed.contract?.startsWith("nbook.files/") === true) writes.push(parsed.method ?? "");
    }));
    return writes;
}
const manifest = (): Promise<string> => readFile(join(projectDir, "lore.content", "content.xml"), "utf8");
const focused = (page: Page) => page.locator(":focus");

/** 点一下选中一行（文件与内容节点不展开），焦点随之到树上；之后只用键盘。 */
async function pick(page: Page, address: string): Promise<void> {
    await item(page, address).click();
    await expect(item(page, address)).toHaveAttribute("aria-selected", "true");
    await expect(tree(page)).toBeFocused();
}

/** 用键盘打开焦点行的右键菜单，用方向键走到 `label` 那一项再按 Enter。 */
async function menuByKeyboard(page: Page, label: string): Promise<void> {
    await page.keyboard.press("Shift+F10");
    // 只看右键菜单里的项：标题栏的应用菜单组标题也是 menuitem。
    await expect(page.getByRole("menu").getByRole("menuitem").first()).toBeFocused();
    for (let step = 0; step < 12; step += 1) {
        if ((await focused(page).textContent())?.includes(label) === true) break;
        await page.keyboard.press("ArrowDown");
    }
    await expect(focused(page)).toContainText(label);
    await page.keyboard.press("Enter");
}

test("只用键盘：创建内容、修改展示名、加入清单、上移，都只做该做的写入", async ({page}) => {
    await open(page);
    if (await item(page, "project://lore.content").getAttribute("aria-expanded") !== "true") await item(page, "project://lore.content").click();
    await expect(item(page, "project://lore.content/alice")).toBeVisible();

    await pick(page, "project://lore.content/alice");
    await menuByKeyboard(page, "创建内容");
    await expect.poll(() => exists(join(projectDir, "lore.content", "alice", "index.md"))).toBe(true);
    await expect(item(page, "project://lore.content/alice")).not.toHaveAttribute("aria-description", /无正文/u);

    await menuByKeyboard(page, "修改展示名与图标");
    const title = page.getByRole("dialog").locator("[data-explorer-display-title] input, input[data-explorer-display-title]").first();
    await expect(title).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("艾丽斯");
    for (let step = 0; step < 6 && !((await focused(page).textContent())?.includes("保存") ?? false); step += 1) await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect.poll(manifest).toContain('title="艾丽斯"');
    await expect(item(page, "project://lore.content/alice")).toContainText("艾丽斯");

    await pick(page, "project://lore.content/stray.md");
    await menuByKeyboard(page, "加入清单");
    await expect.poll(manifest).toContain('name="stray.md"');
    await expect(item(page, "project://lore.content/stray.md")).not.toHaveAttribute("aria-description", /未列入/u);

    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(async () => [...(await manifest()).matchAll(/name="([^"]+)"/gu)].map((match) => match[1])).toEqual(["alice", "stray.md", "bob"]);
    await expect(tree(page)).toBeFocused();
});

test("只用键盘：F2 改名（Escape 取消不写）、Delete 删除（确认框默认在取消上，删除后焦点回到树）", async ({page}) => {
    const sent = recordWrites(page);
    await open(page);
    if (await item(page, "project://ops").getAttribute("aria-expanded") !== "true") await item(page, "project://ops").click();
    await expect(item(page, "project://ops/old.md")).toBeVisible();

    await pick(page, "project://ops/old.md");
    await page.keyboard.press("F2");
    const input = page.locator("[data-explorer-edit] input");
    await expect(input).toBeFocused();
    // 输入框里的 Delete 与剪切快捷键属于输入框：不删文件，也不改文件剪贴板。
    await page.keyboard.press("Delete");
    await page.keyboard.press("Control+X");
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(tree(page)).toBeFocused();
    await barrier(page, "ops");
    expect(sent).toEqual([]);
    expect(await readFile(join(projectDir, "ops", "old.md"), "utf8")).toBe("O");
    await item(page, "project://ops").click({button: "right"});
    await expect(page.getByRole("menuitem", {name: /粘贴/u})).toBeDisabled();
    await page.keyboard.press("Escape");
    await pick(page, "project://ops/old.md");

    await page.keyboard.press("F2");
    await expect(input).toBeFocused();
    await page.keyboard.press("Control+A");
    await page.keyboard.type("new.md");
    await page.keyboard.press("Enter");
    await expect.poll(() => exists(join(projectDir, "ops", "new.md"))).toBe(true);
    await expect(item(page, "project://ops/new.md")).toHaveAttribute("aria-selected", "true");
    await expect(tree(page)).toBeFocused();

    await pick(page, "project://ops/doomed.md");
    await page.keyboard.press("Delete");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("project://ops/doomed.md");
    await expect(dialog.getByRole("button", {name: "取消"})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", {name: "删除"})).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => exists(join(projectDir, "ops", "doomed.md"))).toBe(false);
    await expect(tree(page)).toBeFocused();
    expect(await readFile(join(projectDir, "ops", "keep.md"), "utf8")).toBe("K");
    // 记录器确实看得到写请求：前面的“没有写入”不是空断言。
    expect(sent).toEqual(["rename", "delete"]);
});

test("工具栏新建（验收 29）：输入行出现在选中的目录里、输入框收在行里，Enter 后排他新建空文件并选中它", async ({page}) => {
    await open(page);
    if (await item(page, "project://ops").getAttribute("aria-expanded") !== "true") await item(page, "project://ops").click();
    await pick(page, "project://ops/keep.md");
    await page.locator("[data-title-action=\"nbook.files.new-file\"]").click();
    const input = page.locator("[data-explorer-edit] input");
    await expect(input).toBeFocused();
    await page.keyboard.type("keep.md");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-explorer-input-error]")).toContainText("已存在同名项");
    expect(await readFile(join(projectDir, "ops", "keep.md"), "utf8")).toBe("K");
    // 输入框收在行里（比行矮、没有外扩光环），原因贴在输入框正下方、左右与它对齐（验收 29）。
    const looks = await page.locator("[data-explorer-edit]").evaluate((edit) => {
        const field = edit.querySelector("input")!;
        const error = edit.querySelector("[data-explorer-input-error]")!;
        const row = edit.getBoundingClientRect();
        const box = field.getBoundingClientRect();
        const note = error.getBoundingClientRect();
        return {rowHeight: row.height, boxHeight: box.height, shadow: getComputedStyle(field).boxShadow, gapTop: note.top - box.bottom, left: note.left - box.left, right: note.right - box.right};
    });
    expect(looks.boxHeight).toBeLessThan(looks.rowHeight);
    expect(looks.shadow).toBe("none");
    expect(Math.abs(looks.gapTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(looks.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(looks.right)).toBeLessThanOrEqual(1);
    await page.keyboard.press("Control+A");
    await page.keyboard.type("fresh.md");
    await page.keyboard.press("Enter");
    await expect.poll(() => exists(join(projectDir, "ops", "fresh.md"))).toBe(true);
    expect(await readFile(join(projectDir, "ops", "fresh.md"), "utf8")).toBe("");
    await expect(item(page, "project://ops/fresh.md")).toHaveAttribute("aria-selected", "true");
    await item(page, "project://ops").click();
});

const center = async (page: Page, address: string): Promise<{x: number; y: number}> => {
    const box = await item(page, address).boundingBox();
    if (box === null) throw new Error(`${address} 不在页面上`);
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
};

/** 在一行上按下并越过拖动门槛，停在另一行的 `offset`（相对行高的比例）处，不松手。 */
async function dragOver(page: Page, from: string, to: string, offset = 0.5): Promise<void> {
    // 刚展开的目录里行还在滑动：先等动画走完再量位置，否则按下时指针下面已经换成别的行。
    await expect(page.locator("[data-explorer-tree]")).not.toHaveAttribute("data-motion");
    const start = await center(page, from);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 8, {steps: 2});
    const box = await item(page, to).boundingBox();
    if (box === null) throw new Error(`${to} 不在页面上`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * offset, {steps: 6});
}

const order = async (): Promise<string[]> => [...(await readFile(join(projectDir, "order.content", "content.xml"), "utf8")).matchAll(/name="([^"]+)"/gu)].map((match) => match[1] as string);

/** 写一个屏障文件并等它出现在树上：在它之前发出的写入都已经反映到磁盘与树上。 */
async function barrier(page: Page, directory: string): Promise<void> {
    const name = `barrier-${randomUUID()}.md`;
    await writeFile(join(projectDir, directory, name), "B");
    await expect(item(page, `project://${directory}/${name}`)).toBeVisible();
}

test("拖动：移入目录显示“移入”反馈并移动；内容文件夹里两行之间调整顺序，只改清单", async ({page}) => {
    await open(page);
    await item(page, "project://moves").click();
    await expect(item(page, "project://moves/m1.md")).toBeVisible();
    await dragOver(page, "project://moves/m1.md", "project://moves/into");
    const feedback = page.locator("[data-explorer-drop=\"move\"] [data-explorer-drop-band]");
    await expect(feedback).toBeVisible();
    await expect(page.locator("[data-explorer-drop-live]")).toHaveText("移入 into");
    await page.mouse.up();
    await expect(feedback).toHaveCount(0);
    await expect.poll(() => exists(join(projectDir, "moves", "into", "m1.md"))).toBe(true);
    expect(await exists(join(projectDir, "moves", "m1.md"))).toBe(false);
    // 拖动结束吞掉末尾的 click：没有因此打开或选中落点行。
    await expect(item(page, "project://moves/into")).toHaveAttribute("aria-selected", "false");

    await item(page, "project://order.content").click();
    await expect(item(page, "project://order.content/z")).toBeVisible();
    await dragOver(page, "project://order.content/z", "project://order.content/x", 0.1);
    await expect(page.locator("[data-explorer-drop=\"reorder\"] [data-explorer-drop-line]")).toBeVisible();
    await page.mouse.up();
    await expect.poll(order).toEqual(["z", "x", "y"]);
    expect(await readFile(join(projectDir, "order.content", "z", "index.md"), "utf8")).toBe("Z");
    await item(page, "project://order.content").click();
    await item(page, "project://moves").click();
});

test("拖动（验收 25、26）：拖到别的文件夹里的文件上移入它的文件夹，拖影写着名字、源行淡化；停在收起的目录上展开；拖到空白移入根；拖到编辑组在那一组打开；靠下边缘自动滚动", async ({page}) => {
    // 后面要拖到最后一行之下的空白：窗口要高到展开的几层放下之后还有空白，不随字号刻度变动就失效。
    await page.setViewportSize({width: 1280, height: 900});
    await open(page);
    await item(page, "project://drags").click();
    await item(page, "project://plain").click();
    await expect(item(page, "project://plain/a.md")).toBeVisible();

    // 拖到 plain 里的文件 a.md 上：移入 plain，整个 plain 的范围画浅底，拖影跟着指针。
    await dragOver(page, "project://drags/d1.md", "project://plain/a.md", 0.7);
    await expect(page.locator("[data-explorer-drop=\"move\"] [data-explorer-drop-band]")).toBeVisible();
    await expect(page.locator("[data-explorer-drop-live]")).toHaveText("移入 plain");
    await expect(page.locator("[data-explorer-drag-ghost]")).toContainText("d1.md");
    await expect(page.locator("[data-explorer-drag-ghost]")).toContainText("移入 plain");
    await expect(item(page, "project://drags/d1.md")).toHaveAttribute("data-explorer-drag-source", "");
    await page.mouse.up();
    await expect(page.locator("[data-explorer-drag-ghost]")).toHaveCount(0);
    await expect.poll(() => exists(join(projectDir, "plain", "d1.md"))).toBe(true);

    // 停在收起的 shut 中段：600 毫秒后展开，再落到它里面的文件上。
    await expect(item(page, "project://drags/shut")).toHaveAttribute("aria-expanded", "false");
    await dragOver(page, "project://drags/d2.md", "project://drags/shut");
    await expect(item(page, "project://drags/shut")).toHaveAttribute("aria-expanded", "true");
    await expect(item(page, "project://drags/shut/s.md")).toBeVisible();
    const inner = await center(page, "project://drags/shut/s.md");
    await page.mouse.move(inner.x, inner.y + 4, {steps: 3});
    await expect(page.locator("[data-explorer-drop-live]")).toHaveText("移入 shut");
    await page.mouse.up();
    await expect.poll(() => exists(join(projectDir, "drags", "shut", "d2.md"))).toBe(true);

    // 树里最后一行之下的空白：移入项目根。
    await item(page, "project://drags/folder").click();
    await expect(item(page, "project://drags/folder/f.md")).toBeVisible();
    // 先让之前的移动引起的刷新都落地：拖动中树变了会撤下落点、放下不写（这是规则，不是这里要测的）。
    await barrier(page, "drags");
    const treeBox = await tree(page).boundingBox();
    if (treeBox === null) throw new Error("树不在页面上");
    const start = await center(page, "project://drags/folder/f.md");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 8, {steps: 2});
    // 最后一行之下一点：行数随场地变，按行容器的底边算，不按树的高度。
    const rowsBox = await page.locator("[data-explorer-rows]").boundingBox();
    if (rowsBox === null || rowsBox.y + rowsBox.height + 30 > treeBox.y + treeBox.height) throw new Error("树里没有留出空白");
    await page.mouse.move(start.x, rowsBox.y + rowsBox.height + 20, {steps: 6});
    await expect(page.locator("[data-explorer-drop-live]")).toHaveText("移入 Book");
    await page.mouse.up();
    await expect.poll(() => exists(join(projectDir, "f.md"))).toBe(true);

    // 拖到编辑组：在那一组以正式标签打开，不移动文件。
    await expect(item(page, "project://plain/d1.md")).toBeVisible();
    await barrier(page, "plain");
    const group = page.locator("[data-editor-group]").first();
    const groupBox = await group.boundingBox();
    if (groupBox === null) throw new Error("编辑组不在页面上");
    const from = await center(page, "project://plain/d1.md");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 8, {steps: 2});
    await page.mouse.move(groupBox.x + groupBox.width / 2, groupBox.y + groupBox.height / 2, {steps: 8});
    await expect(page.locator("[data-explorer-drop=\"open\"]")).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]")).toHaveText("d1.md");
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-preview", "");
    expect(await readFile(join(projectDir, "plain", "d1.md"), "utf8")).toBe("D1");

    // 靠树的下边缘：自己往下滚。
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
    await item(page, "project://big").click();
    await expect(item(page, "project://big/file-0003.md")).toBeVisible();
    await barrier(page, "big");
    await item(page, "project://big/file-0003.md").scrollIntoViewIfNeeded();
    const before = await tree(page).evaluate((element) => element.scrollTop);
    const first = await center(page, "project://big/file-0003.md");
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await page.mouse.move(first.x, first.y + 8, {steps: 2});
    await page.mouse.move(first.x, treeBox.y + treeBox.height - 6, {steps: 6});
    await expect.poll(() => tree(page).evaluate((element) => element.scrollTop)).toBeGreaterThan(before + 100);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
});

test("行的样子与设置（验收 21、23、29）：中文数字排序、内容文件夹去后缀、叶子节点没有展开控件、有类型图标；改设置后参考线与隐藏 .md 即时生效", async ({page}) => {
    await open(page);
    await item(page, "project://卷").click();
    await expect(item(page, "project://卷/第三章.md")).toBeVisible();
    const names = await page.locator("[data-explorer-row^=\"project://卷/\"]").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-explorer-row")));
    expect(names).toEqual(["project://卷/第一卷", "project://卷/第二卷", "project://卷/第三章.md", "project://卷/第十二章.md"]);
    await expect(item(page, "project://卷/第三章.md").locator("[data-file-icon]")).toHaveAttribute("data-icon", "markdown");
    // 选中块左右离树的内容区一样远，右端不压进滚动条的槽位被裁掉。
    const insets = await item(page, "project://卷").evaluate((row) => {
        const scroller = row.closest("[data-explorer-tree]")!;
        const box = row.getBoundingClientRect();
        const left = scroller.getBoundingClientRect().left;
        return {left: box.left - left, right: left + scroller.clientWidth - box.right};
    });
    expect(insets.left).toBeGreaterThan(0);
    expect(Math.abs(insets.right - insets.left)).toBeLessThanOrEqual(1);
    // 选中按树有没有焦点分两种：焦点到编辑区后换成灰底与普通字色，回到树里换回强调色（验收 29）。
    const paint = () => item(page, "project://卷").evaluate((row) => ({background: getComputedStyle(row).backgroundColor, color: getComputedStyle(row).color}));
    await expect(tree(page)).toBeFocused();
    const focused = await paint();
    await page.locator("[data-workbench-editor-area]").click();
    await expect(tree(page)).not.toBeFocused();
    // 底色与字色有过渡：等到字色与没选中的行相同，再比底色。
    const plain = await item(page, "project://卷/第三章.md").evaluate((row) => getComputedStyle(row).color);
    await expect.poll(async () => (await paint()).color).toBe(plain);
    expect(plain).not.toBe(focused.color);
    expect((await paint()).background).not.toBe(focused.background);
    await tree(page).focus();
    await expect.poll(paint).toEqual(focused);
    // 视图标题的“移动到”菜单盖在选中的行上：树里给行与落点反馈分的层不越出树，菜单项上最上面的元素属于菜单。
    await page.locator('[data-tool-part="sidebar"]').getByRole("button", {name: "移动到", exact: true}).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const covered = await menu.getByRole("menuitem").evaluateAll((items) => items.filter((entry) => {
        const box = entry.getBoundingClientRect();
        const top = document.elementFromPoint(box.left + 12, box.top + box.height / 2);
        return top === null || !entry.contains(top);
    }).length);
    expect(covered).toBe(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await item(page, "project://lore.content").click();
    await expect(item(page, "project://lore.content").locator("[data-explorer-label]")).toHaveText("lore");
    await expect(item(page, "project://lore.content").locator("[data-explorer-subtitle]")).toHaveText(".content");
    // bob 里只有正文：叶子，没有展开控件；alice 另有文件，可展开。
    await expect(item(page, "project://lore.content/bob")).not.toHaveAttribute("aria-expanded");
    await expect(item(page, "project://lore.content/alice")).toHaveAttribute("aria-expanded", "false");

    // 设置写进用户层的 settings.json：一直显示参考线、隐藏 .md；改回缺省后复原。
    await expect(tree(page)).toHaveAttribute("data-guides", "hover");
    await writeFile(join(stateDir, "settings.json"), JSON.stringify({"nbook.explorer/indentGuides": "always", "nbook.explorer/hideMarkdownExtension": true}));
    await expect(tree(page)).toHaveAttribute("data-guides", "always");
    await expect(item(page, "project://卷/第三章.md").locator("[data-explorer-label]")).toHaveText("第三章");
    await expect(item(page, "project://卷/第一卷/a.md")).toHaveCount(0);
    await writeFile(join(stateDir, "settings.json"), "{}");
    await expect(tree(page)).toHaveAttribute("data-guides", "hover");
    await expect(item(page, "project://卷/第三章.md").locator("[data-explorer-label]")).toHaveText("第三章.md");
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
});

test("右键菜单（验收 24、26）：在侧边打开拆出右边的组；复制相对路径写进系统剪贴板；把文件拖到右边的组在那一组打开", async ({page, context}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    await item(page, "project://plain").click();
    await expect(item(page, "project://plain/index.md")).toBeVisible();

    await item(page, "project://plain/index.md").click({button: "right"});
    await page.getByRole("menuitem", {name: "复制相对路径"}).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("plain/index.md");

    const groups = page.locator("[data-editor-group]");
    const before = await groups.count();
    await item(page, "project://plain/index.md").click({button: "right"});
    await page.getByRole("menuitem", {name: /在侧边打开/u}).click();
    await expect(groups).toHaveCount(before + 1);
    await expect(page.locator("[data-editor-group-active] [data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]")).toHaveText("index.md");

    // 把另一个文件拖到右边的组（不是活动组的那一个也行）：在那一组打开、它成为活动组。
    const right = groups.last();
    const box = await right.boundingBox();
    if (box === null) throw new Error("右边的组不在页面上");
    const from = await center(page, "project://plain/a.md");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 8, {steps: 2});
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 8});
    await expect(page.locator("[data-explorer-drop=\"open\"]")).toBeVisible();
    await page.mouse.up();
    await expect(right).toHaveAttribute("data-editor-group-active", "");
    await expect(right.locator("[data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]")).toHaveText("a.md");
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
});

/** 内容文件夹一层的清单条目名（`level` 为空是根这一层）。 */
async function placeOrder(level: ReadonlyArray<string> = []): Promise<string[]> {
    const text = await readFile(join(projectDir, "r4", "place.content", "content.xml"), "utf8");
    let scope = text;
    for (const name of level) {
        const opening = `<item name="${name}">`;
        const start = scope.indexOf(opening);
        if (start < 0) return [];
        scope = scope.slice(start + opening.length, scope.indexOf("</item>", start));
    }
    // 只取这一层：去掉更深的嵌套。
    const flat = scope.replace(/<item name="[^"]+">[\s\S]*?<\/item>/gu, (match) => match.slice(0, match.indexOf(">") + 1));
    return [...flat.matchAll(/<item name="([^"]+)"/gu)].map((match) => match[1] as string);
}

test("拖动（验收 27）：内容文件夹里跨层放到两行之间、子树末尾按横向位置选层、从普通文件夹拖进来放到指定位置", async ({page}) => {
    await open(page);
    await item(page, "project://r4").click();
    await item(page, "project://r4/place.content").click();
    await item(page, "project://r4/place.content/p1").locator("[data-explorer-twisty]").click();
    await expect(item(page, "project://r4/place.content/p1/k2.md")).toBeVisible();

    // 节点 p1 里的 k1.md 拖到 p2.md 与 p3.md 之间：插入线缩进到那一层，place 整段铺底。
    await dragOver(page, "project://r4/place.content/p1/k1.md", "project://r4/place.content/p3.md", 0.1);
    await expect(page.locator("[data-explorer-drop=\"place\"] [data-explorer-drop-line]")).toBeVisible();
    await expect(page.locator("[data-explorer-drop=\"place\"] [data-explorer-drop-band]")).toBeVisible();
    await expect(page.locator("[data-explorer-drop-live]")).toHaveText("放到 p2.md 之后（移入 place）");
    await page.mouse.up();
    await expect.poll(() => exists(join(projectDir, "r4", "place.content", "k1.md"))).toBe(true);
    await expect.poll(() => placeOrder()).toEqual(["p1", "p2.md", "k1.md", "p3.md"]);
    await barrier(page, "r4/place.content");

    // 子树末尾（k2.md 的下沿）指针在名字上：放进 p1、排在最后。
    await dragOver(page, "project://r4/place.content/p3.md", "project://r4/place.content/p1/k2.md", 0.9);
    await expect(page.locator("[data-explorer-drop-live]")).toHaveText("放到 k2.md 之后（移入 p1）");
    await page.mouse.up();
    await expect.poll(() => exists(join(projectDir, "r4", "place.content", "p1", "p3.md"))).toBe(true);
    await expect.poll(() => placeOrder(["p1"])).toEqual(["k2.md", "p3.md"]);
    await barrier(page, "r4/place.content");

    // 同一条缝（p3.md 的下沿）指针移到 p1 的箭头左边：放到 p1 之后，和 p1 同层；源来自普通文件夹。
    await item(page, "project://r4/loose").click();
    await expect(item(page, "project://r4/loose/w.md")).toBeVisible();
    await dragOver(page, "project://r4/loose/w.md", "project://r4/place.content/p1/p3.md", 0.9);
    const p1 = await item(page, "project://r4/place.content/p1").boundingBox();
    const last = await item(page, "project://r4/place.content/p1/p3.md").boundingBox();
    if (p1 === null || last === null) throw new Error("行不在页面上");
    await page.mouse.move(p1.x + 12, last.y + last.height * 0.9, {steps: 4});
    await expect(page.locator("[data-explorer-drop-live]")).toHaveText("放到 p1 之后（移入 place）");
    await page.mouse.up();
    await expect.poll(() => exists(join(projectDir, "r4", "place.content", "w.md"))).toBe(true);
    await expect.poll(() => placeOrder()).toEqual(["p1", "w.md", "p2.md", "k1.md"]);
    await item(page, "project://r4").click();
});

test("拖动（验收 28）：放下后滑到新位置、落进收起的目录时目录行亮一下、取消时拖影飞回；减少动态效果时没有这些标记", async ({page}) => {
    await open(page);
    await item(page, "project://r4").click();
    await item(page, "project://r4/anim").click();
    await item(page, "project://r4/anim/open").click();
    await expect(item(page, "project://r4/anim/open/o.md")).toBeVisible();
    // 记下出现过的动画标记：标记只留几百毫秒，轮询可能错过。
    await page.evaluate(() => {
        const seen = new Set<string>();
        (window as unknown as {__motion: Set<string>}).__motion = seen;
        const names = ["data-motion-moved", "data-motion-glow", "data-explorer-drag-return"];
        const note = (element: Element): void => {
            for (const name of names) if (element.hasAttribute(name)) seen.add(`${name}:${element.getAttribute("data-explorer-row") ?? ""}`);
        };
        new MutationObserver((records) => {
            for (const record of records) {
                if (record.type === "attributes") note(record.target as Element);
                for (const added of record.addedNodes) if (added instanceof Element) [added, ...added.querySelectorAll("*")].forEach(note);
            }
        }).observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: names});
    });
    const seen = () => page.evaluate(() => [...(window as unknown as {__motion: Set<string>}).__motion]);
    const forget = () => page.evaluate(() => (window as unknown as {__motion: Set<string>}).__motion.clear());

    await barrier(page, "r4/anim");
    await dragOver(page, "project://r4/anim/a1.md", "project://r4/anim/open", 0.5);
    await page.mouse.up();
    await expect(item(page, "project://r4/anim/open/a1.md")).toBeVisible();
    await expect.poll(seen).toEqual(expect.arrayContaining(["data-motion-moved:project://r4/anim/open/a1.md", "data-motion-glow:project://r4/anim/open/a1.md"]));

    await barrier(page, "r4/anim");
    await dragOver(page, "project://r4/anim/a2.md", "project://r4/anim/box", 0.5);
    await page.mouse.up();
    await expect.poll(() => exists(join(projectDir, "r4", "anim", "box", "a2.md"))).toBe(true);
    await expect.poll(seen).toContain("data-motion-glow:project://r4/anim/box");

    await barrier(page, "r4/anim");
    await dragOver(page, "project://r4/anim/a3.md", "project://r4/anim/open", 0.5);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(seen).toContain("data-explorer-drag-return:");
    await expect(page.locator("[data-explorer-drag-return]")).toHaveCount(0);
    expect(await exists(join(projectDir, "r4", "anim", "a3.md"))).toBe(true);

    await page.emulateMedia({reducedMotion: "reduce"});
    await forget();
    await barrier(page, "r4/anim");
    await dragOver(page, "project://r4/anim/a4.md", "project://r4/anim/open", 0.5);
    await page.mouse.up();
    await expect(item(page, "project://r4/anim/open/a4.md")).toBeVisible();
    await dragOver(page, "project://r4/anim/a3.md", "project://r4/anim/open", 0.5);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await barrier(page, "r4/anim");
    expect(await seen()).toEqual([]);
    await page.emulateMedia({reducedMotion: "no-preference"});
    await item(page, "project://r4").click();
});

test("拖到编辑组经落点登记查到，不读 data-editor-group（docs/specs/ui/layout-drag.md 验收 2）", async ({page}) => {
    await open(page);
    await item(page, "project://plain").click();
    await expect(item(page, "project://plain/a.md")).toBeVisible();
    await barrier(page, "plain");
    await page.locator("[data-editor-group]").first().evaluate((group: HTMLElement) => {
        group.dataset.testGroup = "";
        group.removeAttribute("data-editor-group");
    });
    const group = page.locator("[data-test-group]");
    const box = await group.boundingBox();
    if (box === null) throw new Error("编辑组不在页面上");
    const from = await center(page, "project://plain/a.md");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y + 8, {steps: 2});
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 8});
    await expect(page.locator("[data-explorer-drop=\"open\"]")).toBeVisible();
    await page.mouse.up();
    await expect(group.locator("[data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]")).toHaveText("a.md");
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
});

test("拖动中按键归拖动；失去捕获、焦点移到树外都取消且不写，松手不算点击（docs/specs/ui/layout-drag.md 验收 1、4）", async ({page}) => {
    await open(page);
    await item(page, "project://plain").click();
    await expect(item(page, "project://plain/a.md")).toBeVisible();
    await barrier(page, "plain");
    const ghost = page.locator("[data-explorer-drag-ghost]");
    const row = item(page, "project://plain/a.md");
    const from = await center(page, "project://plain/a.md");
    const grab = async (): Promise<void> => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x, from.y + 8, {steps: 2});
        await expect(ghost).toBeVisible();
    };
    const settled = (): Promise<unknown> => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    await grab();
    const active = await tree(page).getAttribute("aria-activedescendant");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await settled();
    expect(await tree(page).getAttribute("aria-activedescendant")).toBe(active);

    // 浏览器在下一个指针事件时才派发 `lostpointercapture`，所以释放之后要动一下。
    await tree(page).evaluate((element) => element.releasePointerCapture(1));
    await page.mouse.move(from.x, from.y + 9);
    await expect(ghost).toHaveCount(0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.up();
    await settled();
    await expect(row).not.toHaveAttribute("aria-selected", "true");

    await grab();
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").evaluate((button: HTMLElement) => button.focus());
    await expect(ghost).toHaveCount(0);
    await page.mouse.move(from.x, from.y);
    await page.mouse.up();
    await settled();
    await expect(row).not.toHaveAttribute("aria-selected", "true");
    expect(await exists(join(projectDir, "plain", "a.md"))).toBe(true);
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
});

test("边缘滚动中松手：文件落到松手时指针下的位置（docs/specs/ui/layout-drag.md 验收 6）", async ({page}) => {
    await open(page);
    await writeFile(join(projectDir, "plain", "edge-drop.md"), "E");
    await item(page, "project://plain").click();
    await expect(item(page, "project://plain/edge-drop.md")).toBeVisible();
    await barrier(page, "plain");
    await item(page, "project://big").click();
    await expect(item(page, "project://big/file-0003.md")).toBeVisible();
    await tree(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expect(item(page, "project://plain/edge-drop.md")).toBeVisible();
    const box = await tree(page).boundingBox();
    if (box === null) throw new Error("树不在页面上");
    const from = await center(page, "project://plain/edge-drop.md");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x, from.y - 8, {steps: 2});
    const edge = {x: from.x, y: box.y + 4};
    await page.mouse.move(edge.x, edge.y, {steps: 6});
    // 往上滚，直到指针下是 big 里的文件：落在那里就是移入 big。
    await expect.poll(() => page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-explorer-row]")?.dataset.explorerRow ?? "", edge)).toMatch(/^project:\/\/big\/file-/u);
    await page.mouse.up();
    await expect.poll(() => exists(join(projectDir, "big", "edge-drop.md"))).toBe(true);
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
});

test.describe("触摸（docs/specs/ui/layout-drag.md 验收 5）", () => {
    test.use({hasTouch: true});

    test("行上按下带 1 px 抖动，按住后拖到别的目录：不被隐式捕获的换手取消，也不让给树的滚动", async ({page}) => {
        await open(page);
        await writeFile(join(projectDir, "plain", "touch-drop.md"), "T");
        await item(page, "project://plain").click();
        await expect(item(page, "project://plain/touch-drop.md")).toBeVisible();
        await barrier(page, "plain");
        await expect(page.locator("[data-explorer-tree]")).not.toHaveAttribute("data-motion");
        const from = await center(page, "project://plain/touch-drop.md");
        const to = await center(page, "project://drags");
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [from]});
        await cdp.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x: from.x + 1, y: from.y}]});
        await expect(page.locator("[data-explorer-drag-ghost]")).toBeVisible();
        for (const ratio of [0.25, 0.5, 0.75, 1]) {
            await cdp.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio}]});
        }
        await expect(page.locator("[data-explorer-drop-live]")).toHaveText("移入 drags");
        await cdp.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
        await expect.poll(() => exists(join(projectDir, "drags", "touch-drop.md"))).toBe(true);
        await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
    });
});

test("拖动中按 Escape、切换显示清单文件、滚动后原地放下：都不写", async ({page}) => {
    const sent = recordWrites(page);
    await open(page);
    await item(page, "project://moves").click();
    await expect(item(page, "project://moves/m2.md")).toBeVisible();

    await dragOver(page, "project://moves/m2.md", "project://moves/keep");
    await expect(page.locator("[data-explorer-drop=\"move\"] [data-explorer-drop-band]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-explorer-drop]")).toHaveCount(0);
    await page.mouse.up();

    await dragOver(page, "project://moves/m2.md", "project://moves/keep");
    await expect(page.locator("[data-explorer-drop=\"move\"] [data-explorer-drop-band]")).toBeVisible();
    // 指针还按着：用 DOM 事件按下工具栏的切换按钮，不动指针。
    await page.locator("[data-title-action=\"nbook.files.toggle-manifests\"]").dispatchEvent("click");
    await expect(page.locator("[data-title-action=\"nbook.files.toggle-manifests\"]")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-explorer-drop]")).toHaveCount(0);
    await page.mouse.up();
    await page.locator("[data-title-action=\"nbook.files.toggle-manifests\"]").click();

    // 树要能滚动：展开大目录（moves 在它之后），滚到底让 moves 出现，从它开始拖，滚轮让指针下换了一行。
    await item(page, "project://big").click();
    await expect(item(page, "project://big/file-0000.md")).toBeVisible();
    await tree(page).evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });
    await expect(item(page, "project://moves/keep")).toBeInViewport();
    await dragOver(page, "project://moves/m2.md", "project://moves/keep");
    await expect(page.locator("[data-explorer-drop=\"move\"] [data-explorer-drop-band]")).toBeVisible();
    await page.mouse.wheel(0, -120);
    await expect(page.locator("[data-explorer-drop]")).toHaveCount(0);
    await page.mouse.up();

    await barrier(page, "moves");
    expect(sent).toEqual([]);
    expect(await readFile(join(projectDir, "moves", "m2.md"), "utf8")).toBe("M2");
    expect(await exists(join(projectDir, "moves", "keep", "m2.md"))).toBe(false);
    await page.locator("[data-title-action=\"nbook.files.collapse-all\"]").click();
});

test.describe("右键菜单的贡献项（docs/specs/workbench/files-explorer.md 的“右键菜单”，验收 20）", () => {
    let menusTmp = "";
    let probe: ProbeServer;

    test.beforeAll(async () => {
        menusTmp = await createTestTmpRoot("neuro-book-e2e", "explorer-context");
        const stateRoot = join(menusTmp, "state");
        const book = join(menusTmp, "Book");
        const id = randomUUID();
        await mkdir(join(book, ".nbook"), {recursive: true});
        await mkdir(stateRoot, {recursive: true});
        await writeFile(join(book, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
        await writeFile(join(book, "a.md"), "甲\n");
        await writeFile(join(book, "b.txt"), "乙\n");
        await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: book}]}));
        // `test.menus` 往 `explorer.context` 贡献两项：只对 .md、带选择的“测试右键项”，与带固定参数的“测试固定参数”。
        probe = await startProbeServer(stateRoot, {env: {NBOOK_TEST_PLUGINS: "test.menus"}});
    });

    test.afterAll(async () => {
        expect(await probe.stop()).toBe(0);
        if (menusTmp !== "") await rm(menusTmp, {recursive: true, force: true});
    });

    const entries = (page: Page) => page.getByRole("menu").locator('[role^="menuitem"], [role="separator"]').evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("role") === "separator" ? "---" : (node.textContent ?? "").trim())));

    test("贡献项排在固定动作之后、每节前一条分隔线；只对 .md 的项只在右键 .md 时出现，执行时收到选择的地址；多选里有别的后缀时不出现；根行没有贡献项", async ({page}) => {
        await page.goto(new URL("/?project=book", probe.url).href);
        await expect(item(page, "project://a.md")).toBeVisible();

        await item(page, "project://a.md").click({button: "right"});
        await expect(page.getByRole("menu")).toBeVisible();
        expect((await entries(page)).slice(-5)).toEqual(["删除Delete", "---", "测试右键项", "---", "测试固定参数"]);
        await page.getByRole("menuitem", {name: "测试右键项"}).click();
        await expect(page.getByText(`收到 ${JSON.stringify({addresses: ["project://a.md"]})}`)).toBeVisible();

        await item(page, "project://b.txt").click({button: "right"});
        await expect(page.getByRole("menu")).toBeVisible();
        expect((await entries(page)).slice(-3)).toEqual(["删除Delete", "---", "测试固定参数"]);
        await page.getByRole("menuitem", {name: "测试固定参数"}).click();
        await expect(page.getByText(`收到 ${JSON.stringify({from: "explorer"})}`)).toBeVisible();

        // a.md 与 b.txt 一起选中后右键：后缀不全匹配，只对 .md 的项不出现。
        await item(page, "project://a.md").click({modifiers: ["Control"]});
        await item(page, "project://b.txt").click({button: "right"});
        await expect(page.getByRole("menu")).toBeVisible();
        expect(await entries(page)).not.toContain("测试右键项");
        await page.keyboard.press("Escape");

        await item(page, "project://").click({button: "right"});
        await expect(page.getByRole("menu")).toBeVisible();
        expect(await entries(page)).not.toContain("测试固定参数");
        await page.keyboard.press("Escape");
    });
});
