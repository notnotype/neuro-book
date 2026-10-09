/**
 * 资源管理器在真实 Chrome 中的验收（docs/specs/workbench/files-explorer.md 验收 1–4、10、16 的浏览部分）：生产构建的
 * 后端与前端，项目 `book` 先按 runtime/projects.md 的格式登记好，文件在真实目录里。Storage、项目子进程、文件监视都是
 * 真的；重新加载同一页面是同一个客户端，用来看偏好与展开记录的恢复。
 */

import {randomUUID} from "node:crypto";
import {lstat, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="alice" title="爱丽丝"/>
  <item name="bob" title="鲍勃"/>
</content>
`;

/** 大目录的文件数：远多于一屏，看虚拟滚动与焦点行。 */
const MANY = 400;

let tmp = "";
let projectDir = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "files-explorer");
    projectDir = join(tmp, "Book");
    const stateRoot = join(tmp, "state");
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
        "plain/a.md": "PA",
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
    await page.goto(bound ? new URL("/?project=book", server.url).href : server.url);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(tree(page)).toBeVisible();
}

test("三类文件夹按呈现规则显示；点普通目录展开、点文件提示编辑器尚未接入；用户资产根默认折叠", async ({page}) => {
    await open(page);
    await expect(item(page, "project://lore.content")).toBeVisible();
    await expect(item(page, "user://")).toHaveAttribute("aria-expanded", "false");
    await item(page, "project://lore.content").click();
    await expect(item(page, "project://lore.content/alice")).toContainText("爱丽丝");
    await expect(item(page, "project://lore.content/alice")).toContainText("无正文");
    await expect(item(page, "project://lore.content/bob")).toContainText("鲍勃");
    await expect(item(page, "project://lore.content/content.xml")).toHaveCount(0);
    await item(page, "project://plain").click();
    await expect(item(page, "project://plain/index.md")).toBeVisible();
    await item(page, "project://plain/a.md").click();
    await expect(item(page, "project://plain/a.md")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-explorer-feedback]")).toContainText("编辑器尚未接入，不能打开 project://plain/a.md");
});

test("显示清单文件与展开记录：重新加载后恢复；收起再展开不丢", async ({page}) => {
    await open(page);
    await item(page, "project://lore.content").click();
    await expect(item(page, "project://lore.content/alice")).toBeVisible();
    await page.locator("[data-explorer-tool=\"toggle-manifests\"]").click();
    await expect(item(page, "project://lore.content/content.xml")).toBeVisible();
    await expect(page.locator("[data-explorer-tool=\"toggle-manifests\"]")).toHaveAttribute("aria-pressed", "true");
    await item(page, "user://").click();
    await expect(item(page, "user://notes.md")).toBeVisible();

    await page.reload();
    await expect(tree(page)).toBeVisible();
    await expect(item(page, "project://lore.content/content.xml")).toBeVisible();
    await expect(item(page, "user://notes.md")).toBeVisible();
    await expect(page.locator("[data-explorer-tool=\"toggle-manifests\"]")).toHaveAttribute("aria-pressed", "true");

    // 恢复原状，后面的用例不受影响。
    await page.locator("[data-explorer-tool=\"toggle-manifests\"]").click();
    await page.locator("[data-explorer-tool=\"collapse-all\"]").click();
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
    await item(page, "project://big").click();
    await expect(item(page, "project://big/file-0000.md")).toHaveCount(0);
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
    await expect(page.getByRole("menuitem").first()).toBeFocused();
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
    await expect(item(page, "project://lore.content/alice")).not.toContainText("无正文");

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
    await expect(item(page, "project://lore.content/stray.md")).not.toContainText("未列入");

    await page.keyboard.press("Alt+ArrowUp");
    await expect.poll(async () => [...(await manifest()).matchAll(/name="([^"]+)"/gu)].map((match) => match[1])).toEqual(["alice", "stray.md", "bob"]);
    await expect(tree(page)).toBeFocused();
});

test("只用键盘：F2 改名（Escape 取消不写）、Delete 删除（确认框默认在取消上，删除后焦点回到树）", async ({page}) => {
    await open(page);
    if (await item(page, "project://ops").getAttribute("aria-expanded") !== "true") await item(page, "project://ops").click();
    await expect(item(page, "project://ops/old.md")).toBeVisible();

    await pick(page, "project://ops/old.md");
    await page.keyboard.press("F2");
    const input = page.locator("[data-explorer-edit] input");
    await expect(input).toBeFocused();
    // 输入框里的 Delete 与快捷键属于输入框，不删文件。
    await page.keyboard.press("Delete");
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
    await expect(tree(page)).toBeFocused();
    expect(await readFile(join(projectDir, "ops", "old.md"), "utf8")).toBe("O");

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
});

test("工具栏新建：输入行出现在选中的目录里，Enter 后排他新建空文件并选中它", async ({page}) => {
    await open(page);
    if (await item(page, "project://ops").getAttribute("aria-expanded") !== "true") await item(page, "project://ops").click();
    await pick(page, "project://ops/keep.md");
    await page.locator("[data-explorer-tool=\"new-file\"]").click();
    const input = page.locator("[data-explorer-edit] input");
    await expect(input).toBeFocused();
    await page.keyboard.type("keep.md");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-explorer-input-error]")).toContainText("已存在同名项");
    expect(await readFile(join(projectDir, "ops", "keep.md"), "utf8")).toBe("K");
    await page.keyboard.press("Control+A");
    await page.keyboard.type("fresh.md");
    await page.keyboard.press("Enter");
    await expect.poll(() => exists(join(projectDir, "ops", "fresh.md"))).toBe(true);
    expect(await readFile(join(projectDir, "ops", "fresh.md"), "utf8")).toBe("");
    await expect(item(page, "project://ops/fresh.md")).toHaveAttribute("aria-selected", "true");
    await item(page, "project://ops").click();
});

