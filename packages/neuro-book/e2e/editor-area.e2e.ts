/**
 * 编辑器区在真实 Chrome 中的验收（docs/specs/workbench/editor.md 场景 1、3、6、8、10、11）：生产构建的后端与前端，项目
 * `book` 先登记好，文件在真实目录里，Storage、项目子进程与文件监视都是真的。等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {DatabaseSync} from "node:sqlite";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProbeServer, startProductServer} from "./fixtures";
import type {ProbeServer, ProductServer} from "./fixtures";

/** 含方言、CRLF、`*` 列表、标准 ruby 与 frontmatter 的章节：编辑器的写法与它不同，用来看字节保持。 */
const DIALECT = [
    "---",
    "title: 第三章",
    "---",
    "",
    "# 第三章",
    "",
    "* 线索一",
    "* 线索二",
    "",
    "她念出<ruby>临川<rt>línchuān</rt></ruby>这个名字。",
    "",
    "她抬头<comment body=\"节奏\">看了他一眼</comment>。",
    "",
    "雨下了一整夜。",
    "",
].join("\r\n");

/**
 * 方言 Spec 场景 1 的文件：frontmatter、CRLF、`*` 列表、`_斜体_`、下划线式标题、`~~~` 代码块、引用式链接、脚注、表格（含
 * `\|`）、数学与各种方言。
 */
const DIALECT_ALL = [
    "---",
    "title: 方言",
    "---",
    "",
    "下划线式标题",
    "===",
    "",
    "* 第一项",
    "* 第二项",
    "* 第三项",
    "",
    "_斜体_ 与 [引用][r] 与脚注[^1]，公式 $x^2$。",
    "",
    "~~~",
    "代码",
    "~~~",
    "",
    "| 名 | 值 |",
    "|---|---|",
    "| a \\| b | 1 |",
    "",
    "她抬头<comment body=\"节奏\">看了他一眼</comment>，<ruby>临川<rt>línchuān</rt></ruby>，<mark>高亮</mark>，<span style=\"color: red\">红字</span>。",
    "",
    "<bilingual text=\"译文\">",
    "原文",
    "</bilingual>",
    "",
    "<align value=\"center\">",
    "居中",
    "</align>",
    "",
    "> [!NOTE] 提示",
    "> 内容",
    "",
    "[r]: https://example.com",
    "[^1]: 脚注。",
    "",
].join("\r\n");

let tmp = "";
let projectDir = "";
let stateRoot = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "editor-area");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string> = {
        ".nbook/project.json": JSON.stringify({schema: 1, id}),
        "notes/a.md": "第一章\n",
        "notes/b.md": "第二章\n",
        "notes/c.md": "第三章\n",
        "notes/d.md": "第四章\n",
        "notes/e.md": "第五章\n",
        "data/f.json": "{\"f\": 1}\n",
        "notes/h.md": "甲\n",
        "moving/m.md": "迁\n",
        "moving/k.md": "复\n",
        "target/.keep": "",
        "notes/i.md": "乙\n",
        "notes/dialect.md": DIALECT,
        "notes/dialect-all.md": DIALECT_ALL,
        "notes/bold.md": "他说：“走吧。”然后离开。\n",
        "notes/tasks.md": "- [ ] 甲\n- [x] 乙\n",
        "data/g.json": "{\"g\": 2}\n",
        "notes/u.md": "基线\n",
        "notes/v.md": "收\n",
        "notes/w.md": "尾\n",
        "data/mixed.txt": "甲\r\n乙\n丙\r\n",
        "data/late.json": "{\"late\": 1}\n",
        "notes/cursor.md": "一二三四五\n",
        "notes/clamp.md": "一二三四五六七八九十\n",
        "data/cursor.txt": "甲行\n乙行之二\n丙\n",
    };
    for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), text);
    }
    await writeFile(join(projectDir, "data/bom.txt"), new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("甲\r\n乙\r\n")]));
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const tabs = (page: Page) => page.locator("[data-editor-tab]");
const labels = (page: Page) => page.locator("[data-editor-tab-label]");
/** 活动组里 Markdown 富文本的编辑区。 */
const prose = (page: Page) => page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.markdown\"]:visible [data-editor-prose]");
/** 点进编辑区并把光标放到正文末尾。 */
async function atEnd(page: Page, editable = prose(page)): Promise<void> {
    await editable.click();
    await page.keyboard.press("Control+End");
}
const disk = (path: string): Promise<string> => readFile(join(projectDir, path), "utf8");

/** 本页客户端在项目分区里的一条记录（`local`，按客户端分行）；还没写过为 null。 */
async function projectRecord(page: Page, key: "editor.session" | "editor.recent" | "explorer.expanded", owner = key.startsWith("explorer.") ? "nbook.explorer" : "nbook.editor"): Promise<Record<string, unknown> | null> {
    const client = await page.evaluate((identity) => localStorage.getItem(identity), CLIENT_IDENTITY_KEY);
    const db = new DatabaseSync(join(projectDir, ".nbook", "storage.sqlite"));
    try {
        const row = db.prepare("SELECT value FROM records WHERE owner = ?3 AND key = ?1 AND client = ?2").get(key, client, owner) as {value: string} | undefined;
        return row === undefined ? null : JSON.parse(row.value) as Record<string, unknown>;
    } finally {
        db.close();
    }
}

/** 会话记录里这个地址的标签记下的光标。 */
async function savedCursor(page: Page, address: string): Promise<unknown> {
    const session = await projectRecord(page, "editor.session") as {groups?: Array<{tabs: Array<{address: string; cursor?: unknown}>}>} | null;
    return session?.groups?.flatMap((group) => group.tabs).find((tab) => tab.address === address)?.cursor ?? null;
}

async function open(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-area]")).toBeVisible();
    if (await item(page, "project://notes").getAttribute("aria-expanded") !== "true") await item(page, "project://notes").click();
    await expect(item(page, "project://notes/a.md")).toBeVisible();
}

/** 关掉页面上全部标签（用例之间不留会话）；dirty 的选“不保存”。 */
async function closeAll(page: Page): Promise<void> {
    for (let guard = 0; guard < 20 && await tabs(page).count() > 0; guard += 1) {
        await page.locator("[data-editor-tab-close]").first().click();
        const discard = page.locator("[data-editor-close-discard]");
        if (await discard.isVisible()) await discard.click();
    }
}

test("单击以预览打开、再单击替换预览、双击转正；编辑后 Ctrl+S 写盘，标签的未保存标记随之消失", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/a.md").click();
    await expect(labels(page)).toHaveText(["a.md"]);
    await expect(tabs(page).first()).toHaveAttribute("data-editor-tab-preview", "");
    await expect(prose(page)).toHaveText("第一章");
    await item(page, "project://notes/b.md").click();
    await expect(labels(page)).toHaveText(["b.md"]);
    await item(page, "project://notes/b.md").dblclick();
    await expect(tabs(page).first()).not.toHaveAttribute("data-editor-tab-preview", "");
    await item(page, "project://notes/a.md").click();
    await expect(labels(page)).toHaveText(["b.md", "a.md"]);
    // 标签条与标签之间不画边框线；活动标签不加粗，是与正文同色的一块；切换活动标签时各标签宽度不变（editor.md 输出 53）。
    const looks = () => page.locator("[data-editor-tabs]").evaluate((list) => {
        const wrappers = [...list.querySelectorAll("[data-editor-tab]")].map((tab) => tab.parentElement!);
        return {
            lines: [list, ...wrappers].flatMap((element) => ["top", "right", "bottom", "left"].map((side) => getComputedStyle(element).getPropertyValue(`border-${side}-width`))).filter((width) => width !== "0px"),
            weights: wrappers.map((wrapper) => getComputedStyle(wrapper).fontWeight),
            active: wrappers.map((wrapper) => wrapper.classList.contains("is-active")),
            widths: wrappers.map((wrapper) => wrapper.getBoundingClientRect().width),
        };
    });
    const settled = await looks();
    expect(settled).toMatchObject({lines: [], weights: ["400", "400"], active: [false, true]});
    await expect(page.getByRole("tab", {name: "b.md", exact: true})).toHaveCount(1);
    await tabs(page).first().click();
    await expect.poll(async () => (await looks()).active).toEqual([true, false]);
    expect((await looks()).widths).toEqual(settled.widths);
    await tabs(page).nth(1).click();
    await expect.poll(async () => (await looks()).active).toEqual([false, true]);

    await atEnd(page);
    await page.keyboard.type("（续）");
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).toHaveAttribute("data-editor-tab-dirty", "");
    // 编辑把预览标签转正。
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-preview", "");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/a.md")).toBe("第一章（续）\n");
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-dirty", "");

    // 另一个窗口打开同一文件，看到保存后的正文（files 验收 1 的第二个消费者）。
    const other = await page.context().newPage();
    await open(other);
    await item(other, "project://notes/a.md").click();
    await expect(prose(other)).toHaveText("第一章（续）");
    await other.close();
});

test("外部修改：不 dirty 时换成磁盘内容；dirty 时提示，保存得到冲突，重新载入后为磁盘内容", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/c.md").dblclick();
    await expect(prose(page)).toHaveText("第三章");
    await writeFile(join(projectDir, "notes/c.md"), "第三章（外部一）\n");
    await expect(prose(page)).toHaveText("第三章（外部一）");

    await atEnd(page);
    await page.keyboard.type("我的");
    await writeFile(join(projectDir, "notes/c.md"), "第三章（外部二）\n");
    await expect(page.locator("[data-editor-banner]")).toContainText("磁盘上的文件已被修改");
    await page.keyboard.press("Control+s");
    await expect(page.locator("[data-editor-banner]")).toContainText("保存没有写入");
    expect(await disk("notes/c.md")).toBe("第三章（外部二）\n");
    await page.locator("[data-editor-banner-action=\"reload\"]").click();
    await expect(prose(page)).toHaveText("第三章（外部二）");
    await expect(page.locator("[data-editor-banner]")).toHaveCount(0);
});

test("关闭 dirty 标签先问：取消不关，不保存则丢弃；向右拆分后两组共用正文；拖动两组间的分隔线调整宽度；刷新后组、标签与宽度恢复", async ({page}) => {
    // 右栏默认开着对话：要拖 120 像素，两组都得比最小宽度宽出这么多。
    await page.setViewportSize({width: 1600, height: 900});
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/d.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("草稿");
    await page.keyboard.press("Control+w");
    await expect(page.locator("[data-editor-close-dialog]")).toBeVisible();
    await page.locator("[data-editor-close-cancel]").click();
    await expect(labels(page)).toHaveText(["d.md"]);

    await prose(page).click();
    await page.keyboard.press("Control+\\");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await expect(prose(page)).toHaveText("第四章草稿");
    await atEnd(page);
    await page.keyboard.type("！");
    await expect(page.locator("[data-editor-group]").first().locator("[data-editor-prose]")).toHaveText("第四章草稿！");

    // 两组之间的分隔线：拖动它，左组变窄、右组变宽；刷新后宽度照旧。
    const widths = () => page.locator("[data-editor-group]").evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().width)));
    const [left = 0, right = 0] = await widths();
    const sash = page.locator("[data-editor-area] [role=separator]");
    await expect(sash).toHaveCount(1);
    const box = await sash.boundingBox();
    if (box === null) throw new Error("分隔线没有盒");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, {steps: 6});
    await page.mouse.up();
    await expect.poll(widths).toEqual([left - 120, right + 120]);

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await expect.poll(widths).toEqual([left - 120, right + 120]);
    await expect(page.locator("[data-editor-group]").first().locator("[data-editor-tab-label]")).toHaveText(["d.md"]);
    // 刷新丢掉了未保存的修改（不跨刷新保留草稿）：正文是磁盘上的。
    await expect(prose(page)).toHaveText("第四章");
    await closeAll(page);
    await expect(page.locator("[data-editor-group]")).toHaveCount(1);
});

test("标签栏的样子：条底比正文低一档、活动标签与正文同色；开放式分隔线；关闭按钮按标签显示；标题动作悬停时显示；固定标签单独一行并随刷新保留", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await closeAll(page);
    for (const name of ["a", "b", "c", "d"]) await item(page, `project://notes/${name}.md`).dblclick();
    await expect(labels(page)).toHaveText(["a.md", "b.md", "c.md", "d.md"]);
    const style = () => page.locator("[data-editor-group-active]").evaluate((group) => {
        // 用同一套变量算出的参照色：组件读主题角色，这里按 editor.md 输出 53 的配方另算一遍。
        const probe = document.createElement("div");
        group.append(probe);
        probe.style.background = "color-mix(in srgb, var(--panel-surface) 93%, var(--text-main))";
        const mixed = getComputedStyle(probe).backgroundColor;
        probe.style.background = "var(--panel-surface)";
        const panel = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const strip = group.querySelector("[data-editor-tabs]")!;
        const frames = [...strip.querySelectorAll("[data-editor-tab]")].map((tab) => tab.parentElement!);
        const separator = (frame: Element) => {
            const before = getComputedStyle(frame, "::before");
            return {width: before.width, opacity: before.opacity, top: Math.round(Number.parseFloat(before.top) / frame.getBoundingClientRect().height * 100)};
        };
        const reveal = (frame: Element) => getComputedStyle(frame.querySelector(".editor-tab__reveal")!).visibility;
        return {
            strip: getComputedStyle(strip).backgroundColor === mixed,
            activeBlock: getComputedStyle(frames[3]!).backgroundColor === panel,
            inactive: getComputedStyle(frames[1]!).backgroundColor,
            separators: frames.slice(1).map(separator),
            closes: frames.map(reveal),
            actions: getComputedStyle(group.querySelector("[data-editor-title-actions]")!).opacity,
        };
    });
    await page.locator("[data-editor-group-active] [data-editor-content]").hover();
    const shown = await style();
    expect(shown).toMatchObject({strip: true, activeBlock: true, inactive: "rgba(0, 0, 0, 0)"});
    // b、c 前的线画着（上下各空 25%），活动的 d 前面不画。
    expect(shown.separators).toEqual([{width: "1px", opacity: "1", top: 25}, {width: "1px", opacity: "1", top: 25}, {width: "1px", opacity: "0", top: 25}]);
    expect(shown.closes).toEqual(["hidden", "hidden", "hidden", "visible"]);
    await expect.poll(async () => (await style()).actions).toBe("1");
    await page.locator("[data-editor-tab]").filter({hasText: "b.md"}).hover();
    await expect.poll(async () => (await style()).closes).toEqual(["hidden", "visible", "hidden", "visible"]);
    // 鼠标离开编辑组、焦点也不在组里：标题动作透明（仍占位）。
    await item(page, "project://notes").hover();
    await page.locator("[data-explorer-row=\"project://notes\"]").focus();
    await expect.poll(async () => (await style()).actions).toBe("0");

    // 固定：右键 c 选“固定”，c 排到单独的第一行；刷新后仍在那一行。
    await page.locator("[data-editor-tab]").filter({hasText: "c.md"}).click({button: "right"});
    await page.getByRole("menu").getByRole("menuitem", {name: "固定", exact: true}).click();
    const rows = () => page.locator("[data-editor-group-active] [data-row]").evaluateAll((nodes) => nodes.map((row) => [row.getAttribute("data-row"), [...row.querySelectorAll("[data-editor-tab-label]")].map((label) => label.textContent)]));
    await expect.poll(rows).toEqual([["pinned", ["c.md"]], ["normal", ["a.md", "b.md", "d.md"]]]);
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect.poll(rows).toEqual([["pinned", ["c.md"]], ["normal", ["a.md", "b.md", "d.md"]]]);
    await page.locator("[data-editor-tab-unpin]").click();
    await expect.poll(rows).toEqual([["normal", ["c.md", "a.md", "b.md", "d.md"]]]);
    await closeAll(page);
});

test("多行标签：↑/↓ 换到上下一行最近的标签；组只有 120px 高时标签区让出高度，正文仍有一行、标题动作可点", async ({page}) => {
    await page.setViewportSize({width: 1000, height: 560});
    await open(page);
    await closeAll(page);
    for (const name of ["a", "b", "c", "d", "e", "h", "i", "u", "v", "w"]) await item(page, `project://notes/${name}.md`).dblclick();
    const strip = page.locator("[data-editor-group-active] [data-editor-tabs]");
    const geometry = () => strip.evaluate((element) => [...element.querySelectorAll("[data-editor-tab]")].map((tab) => ({name: tab.textContent?.trim() ?? "", top: Math.round(tab.getBoundingClientRect().top), active: tab.getAttribute("aria-selected") === "true"})));
    await expect.poll(async () => new Set((await geometry()).map((tab) => tab.top)).size).toBeGreaterThan(1);
    const activeTop = async () => (await geometry()).find((tab) => tab.active)?.top ?? -1;
    const last = await activeTop();
    await page.locator("[data-editor-group-active] [data-editor-tab][aria-selected=\"true\"]").focus();
    await page.keyboard.press("ArrowUp");
    await expect.poll(activeTop).toBeLessThan(last);
    await page.keyboard.press("ArrowDown");
    await expect.poll(activeTop).toBe(last);

    // 一直向下拆分到组的最小高度（120px）：标签区让出高度，正文至少留一行，标题动作仍在组里。
    for (let index = 0; index < 3; index += 1) {
        const count = await page.locator("[data-editor-group]").count();
        await page.locator("[data-editor-group-active] [data-editor-tab][aria-selected=\"true\"]").click({button: "right"});
        await page.getByRole("menu").getByRole("menuitem", {name: "向下拆分", exact: true}).click();
        await expect(page.locator("[data-editor-group]")).toHaveCount(count + 1);
    }
    const group = page.locator("[data-editor-group-active]");
    await expect.poll(() => group.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBeLessThanOrEqual(121);
    for (const name of ["a", "b", "c", "d", "e", "h", "i", "u"]) await item(page, `project://notes/${name}.md`).dblclick();
    const room = await group.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const content = element.querySelector("[data-editor-content]")!.getBoundingClientRect();
        const actions = element.querySelector("[data-editor-title-actions]")?.getBoundingClientRect();
        return {content: content.height, inside: actions === undefined || (actions.top >= box.top - 0.5 && actions.bottom <= box.bottom + 0.5)};
    });
    expect(room.content).toBeGreaterThanOrEqual(28);
    expect(room.inside).toBe(true);
    await closeAll(page);
});

test("拖动标签：组内换位置、拖到另一组的标签条、拖到正文右边拆出新组；Escape 取消；按在关闭按钮上不起拖", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await closeAll(page);
    for (const name of ["a", "b", "c"]) await item(page, `project://notes/${name}.md`).dblclick();
    const groups = page.locator("[data-editor-group]");
    const names = (index: number) => groups.nth(index).locator("[data-editor-tab-label]").allTextContents();
    const tab = (index: number, name: string) => groups.nth(index).locator("[data-editor-tab]").filter({hasText: name});
    /** 按住 from 拖到 to 的某一点再松手；`before` 在松手前做（例如按 Escape）。 */
    const drag = async (from: {x: number; y: number}, to: {x: number; y: number}, before?: () => Promise<void>) => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 10, from.y, {steps: 2});
        await page.mouse.move(to.x, to.y, {steps: 8});
        await expect(page.locator("[data-editor-drop]")).toHaveCount(1);
        await before?.();
        await page.mouse.up();
    };
    const center = async (locator: ReturnType<typeof tab>) => {
        const box = await locator.boundingBox();
        if (box === null) throw new Error("没有盒");
        return {x: box.x + box.width / 2, y: box.y + box.height / 2, box};
    };

    // 组内：把 c 拖到 a 的左半边，排到最前。拖动中指针右下跟着写着 c.md 的拖影，松手后撤下。
    const a = await center(tab(0, "a.md"));
    const ghost = page.locator("[data-editor-drag-ghost]");
    await drag(await center(tab(0, "c.md")), {x: a.box.x + 4, y: a.y}, async () => {
        await expect(ghost).toHaveText("c.md");
        const box = await ghost.boundingBox();
        expect(box).not.toBeNull();
        expect(Math.round(box!.x - (a.box.x + 4))).toBe(12);
        expect(Math.round(box!.y - a.y)).toBe(12);
    });
    await expect(ghost).toHaveCount(0);
    await expect.poll(() => names(0)).toEqual(["c.md", "a.md", "b.md"]);

    // Escape：拖到别处后按 Escape，什么都不变。
    await drag(await center(tab(0, "c.md")), {x: (await center(tab(0, "b.md"))).box.x + (await center(tab(0, "b.md"))).box.width - 4, y: a.y}, async () => {
        await page.keyboard.press("Escape");
        await expect(page.locator("[data-editor-drop]")).toHaveCount(0);
        await expect(ghost).toHaveCount(0);
    });
    await expect.poll(() => names(0)).toEqual(["c.md", "a.md", "b.md"]);

    // 拖动中结构变了（按 Ctrl+W 关掉了活动的 c.md）：整场取消，松手不写。
    await tab(0, "c.md").click();
    await drag(await center(tab(0, "c.md")), {x: (await center(tab(0, "b.md"))).box.x + (await center(tab(0, "b.md"))).box.width - 4, y: a.y}, async () => {
        await page.keyboard.press("Control+w");
        await expect(tab(0, "c.md")).toHaveCount(0);
        await page.mouse.move(a.box.x + a.box.width - 4, a.y, {steps: 2});
        await expect(page.locator("[data-editor-drop]")).toHaveCount(0);
    });
    await expect.poll(() => names(0)).toEqual(["a.md", "b.md"]);
    await item(page, "project://notes/c.md").dblclick();
    await tab(0, "c.md").waitFor();
    await drag(await center(tab(0, "c.md")), {x: a.box.x + 4, y: a.y});
    await expect.poll(() => names(0)).toEqual(["c.md", "a.md", "b.md"]);

    // 按在关闭按钮上拖：不起拖，松手只是点了关闭。
    const close = page.locator(`[data-editor-tab-close="${await tab(0, "b.md").getAttribute("data-editor-tab") ?? ""}"]`);
    const closeBox = await close.boundingBox();
    if (closeBox === null) throw new Error("没有关闭按钮");
    await page.mouse.move(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(closeBox.x - 120, closeBox.y + 4, {steps: 6});
    await expect(page.locator("[data-editor-drop]")).toHaveCount(0);
    await page.mouse.up();

    // 拖到正文的右边：拆出新组，c 移过去。
    const content = await groups.nth(0).locator("[data-editor-content]").boundingBox();
    if (content === null) throw new Error("没有正文区");
    await drag(await center(tab(0, "c.md")), {x: content.x + content.width - 10, y: content.y + content.height / 2});
    await expect(groups).toHaveCount(2);
    await expect.poll(() => names(1)).toEqual(["c.md"]);
    await expect(groups.nth(1)).toHaveAttribute("data-editor-group-active", "");

    // 拖到另一组的标签条末尾：a 移到右组，左组剩 b。
    const strip = await groups.nth(1).locator("[data-editor-tabs]").boundingBox();
    if (strip === null) throw new Error("没有标签条");
    await drag(await center(tab(0, "a.md")), {x: strip.x + strip.width - 60, y: strip.y + 17});
    await expect.poll(() => names(1)).toEqual(["c.md", "a.md"]);
    await expect.poll(() => names(0)).toEqual(["b.md"]);
    await closeAll(page);
});

test("拖动标签时按键归拖动；失去捕获、焦点移到编辑器区外都取消且不写，松手不选中标签（docs/specs/ui/layout-drag.md 验收 1、4）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await closeAll(page);
    for (const name of ["a", "b", "c"]) await item(page, `project://notes/${name}.md`).dblclick();
    const selected = () => page.locator("[data-editor-tab][aria-selected=\"true\"] [data-editor-tab-label]").textContent();
    const ghost = page.locator("[data-editor-drag-ghost]");
    const order = () => labels(page).allTextContents();
    const before = await order();
    const box = await tabs(page).filter({hasText: "a.md"}).boundingBox();
    if (box === null) throw new Error("标签不在页面上");
    const from = {x: box.x + box.width / 2, y: box.y + box.height / 2};
    const grab = async (): Promise<void> => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 10, from.y, {steps: 2});
        await expect(ghost).toBeVisible();
    };
    /** 回到按下的标签上松手：click 要被吞掉，选中的标签不变。 */
    const releaseOnSource = async (active: string | null): Promise<void> => {
        await expect(ghost).toHaveCount(0);
        await page.mouse.move(from.x, from.y);
        await page.mouse.up();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(await selected()).toBe(active);
        expect(await order()).toEqual(before);
    };

    await grab();
    const active = await selected();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("End");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await selected()).toBe(active);

    // 捕获的取得与释放都在下一个指针事件时才生效：先动一下让捕获真的到根上，释放之后再动一下让 `lostpointercapture` 派发出来。
    await page.mouse.move(from.x + 11, from.y);
    await page.locator("[data-editor-area]").evaluate((area) => area.releasePointerCapture(1));
    await page.mouse.move(from.x + 12, from.y);
    await releaseOnSource(active);

    await tabs(page).filter({hasText: "b.md"}).click();
    await grab();
    const next = await selected();
    await page.getByRole("tree", {name: "文件"}).evaluate((tree: HTMLElement) => tree.focus());
    await releaseOnSource(next);
    await closeAll(page);
});

test("提示条占着编辑区顶部时，grid 不超出编辑区：底部不被裁掉", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/a.md").dblclick();
    await expect(page.locator("[data-editor-group]")).toHaveCount(1);
    const bottoms = () => page.evaluate(() => ({
        area: Math.round(document.querySelector("[data-editor-area]")!.getBoundingClientRect().bottom),
        group: Math.round(document.querySelector("[data-editor-group]")!.getBoundingClientRect().bottom),
    }));
    // 真实的提示条要靠特定的失败才出现，这里在根的顶部放一条同样的块级元素，量的是布局关系。
    await page.evaluate(() => {
        const notice = document.createElement("p");
        notice.dataset.fakeNotice = "";
        notice.className = "flex items-center gap-2 border-b px-3 py-1.5 text-xs";
        notice.textContent = "提示条";
        document.querySelector("[data-editor-area]")!.prepend(notice);
    });
    await expect.poll(async () => {
        const {area, group} = await bottoms();
        return group <= area + 1;
    }).toBe(true);
    await page.evaluate(() => document.querySelector("[data-fake-notice]")?.remove());
    await closeAll(page);
});

test("扁平渲染：拆分时原来的组不重建；F6 先在组之间走，走到头交给外壳（docs/specs/ui/nested-grid.md）", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/a.md").dblclick();
    const groups = page.locator("[data-editor-group]");
    const first = groups.first();
    await expect(first.locator("[data-editor-tab]")).toHaveCount(1);
    await first.evaluate((element) => {
        (element as HTMLElement & {__testSame?: boolean}).__testSame = true;
    });
    await first.locator("[data-editor-tab]").first().focus();
    await page.keyboard.press("Control+\\");
    await expect(groups).toHaveCount(2);
    expect(await page.locator("[data-editor-group]").evaluateAll((elements) => elements.some((element) => (element as HTMLElement & {__testSame?: boolean}).__testSame === true))).toBe(true);

    const groupOfFocus = () => page.evaluate(() => document.activeElement?.closest<HTMLElement>("[data-editor-group]")?.dataset.editorGroup ?? null);
    await groups.first().locator("[data-editor-tab]").first().focus();
    const left = await groupOfFocus();
    await page.keyboard.press("F6");
    const right = await groupOfFocus();
    expect(right).not.toBeNull();
    expect(right).not.toBe(left);
    await page.keyboard.press("F6");
    expect(await groupOfFocus()).toBeNull();
    await page.keyboard.press("Shift+F6");
    expect(await groupOfFocus()).toBe(right);
    await closeAll(page);
});

test.describe("触摸（docs/specs/ui/layout-drag.md 验收 5）", () => {
    test.use({hasTouch: true});

    test("标签上按下带 1 px 抖动，按住后拖到别的标签前：不被隐式捕获的换手取消，顺序变了", async ({page}) => {
        await page.setViewportSize({width: 1440, height: 900});
        await open(page);
        await closeAll(page);
        for (const name of ["a", "b", "c"]) await item(page, `project://notes/${name}.md`).dblclick();
        const boxOf = async (name: string) => {
            const box = await tabs(page).filter({hasText: name}).boundingBox();
            if (box === null) throw new Error("标签不在页面上");
            return box;
        };
        const c = await boxOf("c.md");
        const a = await boxOf("a.md");
        const from = {x: c.x + c.width / 2, y: c.y + c.height / 2};
        const to = {x: a.x + 4, y: a.y + a.height / 2};
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {type: "touchStart", touchPoints: [from]});
        await cdp.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x: from.x + 1, y: from.y}]});
        await expect(page.locator("[data-editor-drag-ghost]")).toBeVisible();
        for (const ratio of [0.25, 0.5, 0.75, 1]) {
            await cdp.send("Input.dispatchTouchEvent", {type: "touchMove", touchPoints: [{x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio}]});
        }
        await expect(page.locator("[data-editor-drop]")).toHaveCount(1);
        await cdp.send("Input.dispatchTouchEvent", {type: "touchEnd", touchPoints: []});
        await expect.poll(() => labels(page).allTextContents()).toEqual(["c.md", "a.md", "b.md"]);
        await closeAll(page);
    });
});

test("拖动的边界：关掉多行、标签横向滚出视口时，拖到看得见的最后一个后面落在它的后继之前；只有一个固定标签的组，拖到正文中央取消固定", async ({page}) => {
    await page.setViewportSize({width: 1000, height: 800});
    await open(page);
    await closeAll(page);
    const settings = join(projectDir, ".nbook", "settings.json");
    await writeFile(settings, JSON.stringify({"nbook.editor/wrapTabs": false}));
    try {
        for (const name of ["a", "b", "c", "d", "e", "h", "i", "u", "v", "w"]) await item(page, `project://notes/${name}.md`).dblclick();
        const strip = page.locator("[data-editor-group-active] [data-editor-tabs]");
        await expect(strip).not.toHaveAttribute("data-wrap", "");
        await page.locator("[data-editor-group-active] [data-editor-tab]").first().click();
        const names = () => page.locator("[data-editor-group-active] [data-editor-tab-label]").allTextContents();
        // 把行滚到某个标签的右缘正好贴着标签条的右缘：它后面的那个完全在视口外。
        const edge = await strip.evaluate((element) => {
            const row = element.querySelector<HTMLElement>("[data-row]")!;
            const right = row.getBoundingClientRect().right;
            const frames = [...row.querySelectorAll("[data-editor-tab]")].map((tab) => tab.parentElement!);
            const index = frames.findIndex((frame) => frame.getBoundingClientRect().right > right);
            row.scrollLeft += frames[index]!.getBoundingClientRect().right - right;
            const box = frames[index]!.getBoundingClientRect();
            return {index, right: box.right, y: box.top + box.height / 2, name: frames[index]!.querySelector("[data-editor-tab-label]")!.textContent, next: frames[index + 1]!.querySelector("[data-editor-tab-label]")!.textContent, nextLeft: frames[index + 1]!.getBoundingClientRect().left, rowRight: right};
        });
        expect(edge.nextLeft).toBeGreaterThanOrEqual(edge.rowRight - 1);
        // 拖第二个标签（第一个可能被滚出去一部分）到这个标签的右缘：落在它后继之前，不是整行末尾。
        const source = page.locator("[data-editor-group-active] [data-editor-tab]").nth(1);
        const dragged = (await source.textContent())?.trim() ?? "";
        const from = await source.boundingBox();
        if (from === null) throw new Error("没有标签");
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, {steps: 2});
        await page.mouse.move(edge.right - 3, edge.y, {steps: 8});
        await page.mouse.up();
        await expect.poll(async () => {
            const after = await names();
            return after.indexOf(dragged) === after.indexOf(edge.next ?? "") - 1 && after.indexOf(dragged) === after.indexOf(edge.name ?? "") + 1;
        }).toBe(true);
    } finally {
        await writeFile(settings, "{}");
    }
    await expect(page.locator("[data-editor-group-active] [data-editor-tabs]")).toHaveAttribute("data-wrap", "");
    await closeAll(page);

    // 只有一个固定标签：拖到本组正文中央，取消固定。
    await item(page, "project://notes/a.md").dblclick();
    await page.locator("[data-editor-tab]").filter({hasText: "a.md"}).click({button: "right"});
    await page.getByRole("menu").getByRole("menuitem", {name: "固定", exact: true}).click();
    await expect(page.locator("[data-editor-tab-pinned]")).toHaveCount(1);
    const tab = await page.locator("[data-editor-tab]").filter({hasText: "a.md"}).boundingBox();
    const content = await page.locator("[data-editor-group-active] [data-editor-content]").boundingBox();
    if (tab === null || content === null) throw new Error("没有盒");
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await page.mouse.down();
    await page.mouse.move(tab.x + tab.width / 2 + 10, tab.y + tab.height / 2, {steps: 2});
    await page.mouse.move(content.x + content.width / 2, content.y + content.height / 2, {steps: 8});
    await page.mouse.up();
    await expect(page.locator("[data-editor-tab-pinned]")).toHaveCount(0);
    await closeAll(page);
});

test("真实控件的缓冲：Markdown 刚输入就把标签拖到另一组，保存后字在磁盘上；刚输入就“关闭已保存”，这个标签留下", async ({page}) => {
    await page.setViewportSize({width: 1440, height: 900});
    // 用这一例自己的两个文件：保存会改磁盘，别的用例按 fixture 的原文断言。
    await writeFile(join(projectDir, "notes/buffer-a.md"), "甲\n");
    await writeFile(join(projectDir, "notes/buffer-b.md"), "乙\n");
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/buffer-a.md").dblclick();
    await item(page, "project://notes/buffer-b.md").dblclick();
    await page.locator("[data-editor-group-active] [data-title-action-key=\"own:split-right\"]").click();
    const groups = page.locator("[data-editor-group]");
    await expect(groups).toHaveCount(2);
    // 左组的 buffer-a.md：输入后立刻拖走（控件的输入还在 150ms 的缓冲里）。
    await groups.nth(0).locator("[data-editor-tab]").filter({hasText: "buffer-a.md"}).click();
    await atEnd(page, groups.nth(0).locator("[data-editor-prose]"));
    await page.keyboard.type("改");
    const from = await groups.nth(0).locator("[data-editor-tab]").filter({hasText: "buffer-a.md"}).boundingBox();
    const to = await groups.nth(1).locator("[data-editor-tabs]").boundingBox();
    if (from === null || to === null) throw new Error("没有盒");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, {steps: 2});
    await page.mouse.move(to.x + to.width - 40, to.y + 17, {steps: 6});
    await page.mouse.up();
    await expect(groups.nth(1).locator("[data-editor-tab]").filter({hasText: "buffer-a.md"})).toHaveCount(1);
    await groups.nth(1).locator("[data-editor-prose]").click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/buffer-a.md")).toBe("甲改\n");

    // 右组的 buffer-b.md：输入后立刻右键“关闭已保存”，它有修改，留下。
    await groups.nth(1).locator("[data-editor-tab]").filter({hasText: "buffer-b.md"}).click();
    await atEnd(page, groups.nth(1).locator("[data-editor-prose]"));
    await page.keyboard.type("改");
    await groups.nth(1).locator("[data-editor-tab]").filter({hasText: "buffer-b.md"}).click({button: "right"});
    await page.getByRole("menu").getByRole("menuitem", {name: "关闭已保存"}).click();
    await expect(groups.nth(1).locator("[data-editor-tab]").filter({hasText: "buffer-b.md"})).toHaveCount(1);
    await expect(groups.nth(1).locator("[data-editor-tab]").filter({hasText: "buffer-a.md"})).toHaveCount(0);
    await closeAll(page);
});

test("面包屑：作品名 › 目录 › 文件 › 标题；点目录列出子项、选文件在本组打开；点标题列出大纲、选中跳过去；聚焦面包屑后 Escape 回到正文", async ({page}) => {
    await writeFile(join(projectDir, "notes/outline.md"), "# 起\n\n正文一。\n\n## 承\n\n正文二。\n");
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/outline.md").dblclick();
    const crumbs = page.locator("[data-editor-group-active] [data-editor-breadcrumbs]");
    const segments = crumbs.locator("[data-breadcrumb-segment]");
    await expect(segments).toHaveCount(4);
    expect(await segments.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-breadcrumb-segment")))).toEqual(["root", "dir", "file", "heading"]);
    await expect(segments.nth(1)).toHaveText("notes");
    await expect(segments.nth(2)).toHaveText("outline.md");
    await expect(segments.nth(3)).toHaveText("起");

    // 标题段：列出大纲，选“承”，光标跳过去，标题段随之变成“承”。
    await segments.nth(3).click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitemradio")).toHaveCount(2);
    await menu.getByRole("menuitemradio", {name: "承"}).click();
    await expect(segments.nth(3)).toHaveText("承");

    // 目录段：列出 notes 的子项，选 a.md 在本组打开。
    await segments.nth(1).click();
    await menu.getByRole("menuitemradio", {name: "a.md", exact: true}).click();
    await expect(page.locator("[data-editor-group-active] [data-editor-tab][aria-selected=\"true\"]")).toContainText("a.md");
    await expect(segments.nth(2)).toHaveText("a.md");

    // 命令面板“聚焦面包屑”：焦点到最后一段；Escape 回到正文。
    await page.keyboard.press("Control+Shift+P");
    await page.getByRole("combobox").fill("聚焦面包屑");
    await page.getByRole("option", {name: /聚焦面包屑/u}).first().click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-breadcrumb-segment"))).toBe("file");
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-editor-prose]") !== null)).toBe(true);
    await closeAll(page);
});

test("有未保存的修改时离开页面先请求确认；保存之后不再请求", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/b.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("x");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
        dialogs.push(dialog.type());
        void dialog.dismiss();
    });
    await page.close({runBeforeUnload: true});
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    expect(page.isClosed()).toBe(false);
    await prose(page).click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/b.md")).toBe("第二章x\n");
    // 磁盘写好了不等于回复到了：保存在途时离开同样要确认。等标签的未保存标记消失（保存完成）再离开。
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).not.toHaveAttribute("data-editor-tab-dirty", "");
    await page.close({runBeforeUnload: true});
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs).toEqual(["beforeunload"]);
});

test("Markdown：打开、切走、关闭都不改磁盘字节；编辑最后一段后保存，只有那一行变化（含 CRLF、列表标记、ruby 与 frontmatter）", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/dialect.md").dblclick();
    await expect(prose(page)).toContainText("雨下了一整夜。");
    await item(page, "project://notes/h.md").click();
    await page.locator("[data-editor-tab-label]", {hasText: "dialect.md"}).click();
    await expect(prose(page)).toContainText("雨下了一整夜。");
    await closeAll(page);
    expect(await disk("notes/dialect.md")).toBe(DIALECT);

    await item(page, "project://notes/dialect.md").dblclick();
    // 最后一段是正文末尾：Ctrl+End 把光标放到它的末尾再接着写。
    await atEnd(page);
    await page.keyboard.type("天亮了。");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("notes/dialect.md")).toBe(DIALECT.replace("雨下了一整夜。", "雨下了一整夜。天亮了。"));
    await closeAll(page);
});

test.describe("Markdown 方言（docs/specs/workspace/markdown-dialect.md 场景 1、2、4）", () => {
    test("场景 1：含全部方言的文件打开不编辑、保存字节不变；只改列表第二项，只有那一个列表重新写出，仍是一个 `*` 列表", async ({page}) => {
        await open(page);
        await closeAll(page);
        await item(page, "project://notes/dialect-all.md").dblclick();
        await expect(prose(page)).toContainText("看了他一眼");
        await page.keyboard.press("Control+s");
        await closeAll(page);
        expect(await disk("notes/dialect-all.md")).toBe(DIALECT_ALL);

        await item(page, "project://notes/dialect-all.md").dblclick();
        await prose(page).locator("li", {hasText: "第二项"}).click();
        await page.keyboard.press("End");
        await page.keyboard.type("改");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/dialect-all.md")).toBe(DIALECT_ALL.replace("* 第二项", "* 第二项改"));
        // 不出现控制字符（编解码器内部的转义标记不漏进文件）。
        expect(await disk("notes/dialect-all.md")).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u);
        await closeAll(page);
    });

    test("场景 2：给“走吧。”连引号加粗，保存、关闭再打开仍是粗体，原文是中文友好的 `**`", async ({page}) => {
        await open(page);
        await closeAll(page);
        await item(page, "project://notes/bold.md").dblclick();
        await prose(page).click();
        await page.keyboard.press("Home");
        for (let step = 0; step < 3; step += 1) await page.keyboard.press("ArrowRight");
        for (let step = 0; step < 5; step += 1) await page.keyboard.press("Shift+ArrowRight");
        // 编辑器在 `selectionchange` 时才读页面的选区：等页面选区到位、再过一帧，加粗作用于整个选区。
        await expect.poll(() => page.evaluate(() => globalThis.getSelection()?.toString())).toBe("“走吧。”");
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.keyboard.press("Control+b");
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/bold.md")).toBe("他说：**“走吧。”**然后离开。\n");
        await closeAll(page);
        await item(page, "project://notes/bold.md").dblclick();
        await expect(prose(page).locator("strong")).toHaveText("“走吧。”");
        await closeAll(page);
    });

    test("场景 4：任务列表里回车加一项、勾选一项、保存：原文的复选框都在，新加的项是 `- [ ] `", async ({page}) => {
        await open(page);
        await closeAll(page);
        await item(page, "project://notes/tasks.md").dblclick();
        await prose(page).locator("li", {hasText: "乙"}).click();
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await page.keyboard.type("丙");
        await prose(page).locator("li", {hasText: "甲"}).locator("input[type=checkbox]").check();
        await page.keyboard.press("Control+s");
        await expect.poll(() => disk("notes/tasks.md")).toBe("- [x] 甲\n- [x] 乙\n- [ ] 丙\n");
        await closeAll(page);
    });
});

test("Markdown：A 输入、切到 B 输入、回 A 撤销只作用于 A；重做回来", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/h.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("一");
    await item(page, "project://notes/i.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("二");
    await page.locator("[data-editor-tab-label]", {hasText: "h.md"}).click();
    await expect(prose(page)).toHaveText("甲一");
    await prose(page).click();
    await page.keyboard.press("Control+z");
    await expect(prose(page)).toHaveText("甲");
    await page.keyboard.press("Control+Shift+z");
    await expect(prose(page)).toHaveText("甲一");
    await page.locator("[data-editor-tab-label]", {hasText: "i.md"}).click();
    await expect(prose(page)).toHaveText("乙二");
    await closeAll(page);
});

test("资源管理器的结算：未保存时剪切、保存、粘贴，标签跟到新路径、正文保留；复制先问；删除确认列出未保存的文档", async ({page}) => {
    await open(page);
    await closeAll(page);
    for (const folder of ["project://moving", "project://target"]) {
        if (await item(page, folder).getAttribute("aria-expanded") !== "true") await item(page, folder).click();
    }
    await item(page, "project://moving/m.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("动");
    await item(page, "project://moving/m.md").click();
    await page.keyboard.press("Control+x");
    await prose(page).click();
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("moving/m.md")).toBe("迁动\n");
    await atEnd(page);
    await page.keyboard.type("再");
    await item(page, "project://target").click();
    await page.keyboard.press("Control+v");
    // 点目录会切换它的展开：按磁盘与标签核对，不看行。
    await expect.poll(() => disk("target/m.md").catch(() => "")).toBe("迁动\n");
    await expect(page.locator("[data-editor-tab-label]")).toHaveText(["m.md"]);
    await expect(page.locator("[data-editor-tab]").first()).toHaveAttribute("title", "project://target/m.md");
    await expect(prose(page)).toHaveText("迁动再");

    await item(page, "project://moving/k.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("改");
    await item(page, "project://moving/k.md").click();
    await page.keyboard.press("Control+c");
    await item(page, "project://target").click();
    await page.keyboard.press("Control+v");
    await expect(page.locator("[data-explorer-dirty-copy]")).toContainText("project://moving/k.md");
    await page.locator("[data-explorer-dirty-copy-disk]").click();
    await expect.poll(() => disk("target/k.md").catch(() => "")).toBe("复\n");

    await item(page, "project://moving/k.md").click();
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-explorer-delete-unsaved]")).toHaveText("project://moving/k.md");
    await page.getByRole("alertdialog").getByRole("button", {name: "取消"}).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await disk("moving/k.md")).toBe("复\n");
    await closeAll(page);
});

/** Monaco 里当前模型的正文（视图行的文字，不含行号）。 */
const monacoText = (page: Page) => page.locator("[data-editor-kind=\"nbook.editor.code\"]:visible .view-lines").evaluate((element) => [...element.querySelectorAll(".view-line")].sort((a, b) => Number.parseFloat((a as HTMLElement).style.top) - Number.parseFloat((b as HTMLElement).style.top)).map((line) => (line.textContent ?? "").replaceAll("\u00a0", " ")).join("\n"));

test("源码文件用 Monaco：第一次打开源码文件之前不加载它；输入后 Ctrl+S 写盘；A→B→A 后撤销只作用于 A", async ({page}) => {
    const monacoRequests: string[] = [];
    page.on("request", (request) => {
        if (/editor\.api|monaco/iu.test(request.url())) monacoRequests.push(request.url());
    });
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/a.md").dblclick();
    await expect(prose(page)).toBeVisible();
    expect(monacoRequests).toEqual([]);

    if (await item(page, "project://data").getAttribute("aria-expanded") !== "true") await item(page, "project://data").click();
    await item(page, "project://data/f.json").dblclick();
    const editor = page.locator("[data-editor-kind=\"nbook.editor.code\"]:visible .monaco-editor");
    await expect(editor).toBeVisible();
    expect(monacoRequests.length).toBeGreaterThan(0);
    await expect.poll(() => monacoText(page)).toBe("{\"f\": 1}\n");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// f");
    await page.keyboard.press("Control+s");
    await expect.poll(() => disk("data/f.json")).toBe("{\"f\": 1}\n// f");

    await item(page, "project://data/g.json").dblclick();
    await expect.poll(() => monacoText(page)).toBe("{\"g\": 2}\n");
    await editor.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("// g");
    await page.locator("[data-editor-tab-label]", {hasText: "f.json"}).click();
    await expect.poll(() => monacoText(page)).toBe("{\"f\": 1}\n// f");
    await editor.click();
    await page.keyboard.press("Control+z");
    // 撤销作用于 f 自己的历史：Monaco 按词撤掉最后输入的 “ f”。
    await expect.poll(() => monacoText(page)).toBe("{\"f\": 1}\n//");
    await page.locator("[data-editor-tab-label]", {hasText: "g.json"}).click();
    await expect.poll(() => monacoText(page)).toBe("{\"g\": 2}\n// g");

    // 语言服务在模型释放后用 Monaco 的取消错误 reject 在途请求，没有人接：加载 Monaco 之后它不成为页面错误，其它未处理的
    // 拒绝照常报出（只差名字或只差消息的也算其它）。取消的时机由 worker 决定，这里直接在页面里产生同样的未处理拒绝。
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(`${error.name}: ${error.message}`));
    await page.evaluate(() => {
        const rejectWith = (name: string, message: string): void => {
            const error = new Error(message);
            error.name = name;
            void Promise.reject(error);
        };
        rejectWith("Canceled", "Canceled");
        rejectWith("Canceled", "其它失败");
        rejectWith("Error", "Canceled");
    });
    await expect.poll(() => pageErrors.length).toBe(2);
    expect(pageErrors).toEqual(["Canceled: 其它失败", "Error: Canceled"]);
    await closeAll(page);
});

/** 焦点在编辑器区里（不是落到页面根）。 */
const focusInEditor = (page: Page) => page.evaluate(() => document.activeElement?.closest("[data-editor-area]") !== null && document.activeElement !== document.body);

test("关闭标签与空组之后焦点留在编辑器区：交给关闭后的活动视图", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/v.md").dblclick();
    await item(page, "project://notes/w.md").dblclick();
    await page.locator("[data-editor-tab]", {hasText: "w.md"}).focus();
    await page.keyboard.press("Delete");
    await expect(labels(page)).toHaveText(["v.md"]);
    await expect.poll(() => focusInEditor(page)).toBe(true);

    await prose(page).click();
    await page.keyboard.press("Control+\\");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await page.locator("[data-editor-group-active] [data-editor-tab]").focus();
    await page.keyboard.press("Delete");
    await expect(page.locator("[data-editor-group]")).toHaveCount(1);
    await expect.poll(() => focusInEditor(page)).toBe(true);
    await closeAll(page);
});

test("关闭之后活动视图还在加载时，用户把焦点移到资源管理器：控件迟到也不抢回焦点", async ({page}) => {
    // 扣住 Monaco 的下载，让关闭后的活动标签停在“控件还没挂上”：这时焦点交接只是一个待办的意图。
    const monaco = Promise.withResolvers<void>();
    await page.route(/editor\.api/u, async (route) => {
        await monaco.promise;
        await route.continue();
    });
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/a.md").dblclick();
    await expect(prose(page)).toBeVisible();
    if (await item(page, "project://data").getAttribute("aria-expanded") !== "true") await item(page, "project://data").click();
    await item(page, "project://data/late.json").dblclick();
    await expect(page.locator("[data-editor-tab]", {hasText: "late.json"})).toHaveAttribute("aria-selected", "true");
    await page.locator("[data-editor-tab-label]", {hasText: "a.md"}).click();
    await prose(page).click();
    await page.keyboard.press("Control+w");
    await expect(labels(page)).toHaveText(["late.json"]);

    await item(page, "project://target").click();
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-explorer-tree]") !== null)).toBe(true);
    monaco.resolve();
    await expect.poll(() => monacoText(page)).toBe("{\"late\": 1}\n");
    expect(await page.evaluate(() => document.activeElement?.closest("[data-explorer-tree]") !== null)).toBe(true);
    await page.unrouteAll({behavior: "wait"});
    await closeAll(page);
});

test("Markdown 的撤销历史属于各组：拆分之后原组仍能撤销拆分前的输入；两组轮流输入，各自撤销只撤自己的", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/u.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("甲");
    await page.keyboard.press("Control+\\");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    const left = page.locator("[data-editor-group]").first().locator("[data-editor-prose]");
    const right = page.locator("[data-editor-group]").nth(1).locator("[data-editor-prose]");
    await expect(right).toHaveText("基线甲");
    // 拆分后新组是活动组、焦点在它里面：原组重挂不把焦点与活动组抢回去。
    await expect(page.locator("[data-editor-group]").nth(1)).toHaveAttribute("data-editor-group-active", "");
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-editor-group]")?.getAttribute("data-editor-group-active"))).toBe("");
    // 窄组里标签放不下：多行时换行（输出 54），新打开的标签在标签区里完整可见。
    for (const name of ["a.md", "b.md", "c.md", "d.md", "e.md", "v.md", "w.md"]) await item(page, `project://notes/${name}`).dblclick();
    const strip = page.locator("[data-editor-group-active] [data-editor-tabs]");
    await expect.poll(() => strip.evaluate((element) => {
        const active = element.querySelector("[data-editor-tab][aria-selected=\"true\"]")?.parentElement?.getBoundingClientRect();
        const view = element.getBoundingClientRect();
        const rows = new Set([...element.querySelectorAll("[data-editor-tab]")].map((tab) => Math.round(tab.getBoundingClientRect().top))).size;
        return active !== undefined && active.left >= view.left - 0.5 && active.right <= view.right + 0.5 && active.top >= view.top - 0.5 && active.bottom <= view.bottom + 0.5 && rows > 1;
    })).toBe(true);
    await page.locator("[data-editor-group-active] [data-editor-tab]", {hasText: "u.md"}).click();
    await atEnd(page, left);
    await page.keyboard.press("Control+z");
    await expect(left).toHaveText("基线");
    await expect(right).toHaveText("基线");
    await page.keyboard.press("Control+Shift+z");
    await expect(left).toHaveText("基线甲");

    await atEnd(page, left);
    await page.keyboard.type("左");
    await atEnd(page, right);
    await expect(right).toHaveText("基线甲左");
    await page.keyboard.type("右");
    await atEnd(page, left);
    await expect(left).toHaveText("基线甲左右");
    await page.keyboard.press("Control+z");
    // 原组撤销自己的输入（时间相近的输入可能合成一步，所以只看“左”没了、另一组的“右”还在）。
    await expect(left).not.toContainText("左");
    await expect(left).toContainText("右");
    await expect(right).not.toContainText("左");
    await closeAll(page);
});

test("Monaco 保持原文字节：BOM 与混用的换行打开、切走、切回不变 dirty；输入后保存只改动的那一行", async ({page}) => {
    await open(page);
    await closeAll(page);
    if (await item(page, "project://data").getAttribute("aria-expanded") !== "true") await item(page, "project://data").click();
    const editor = page.locator("[data-editor-kind=\"nbook.editor.code\"]:visible .monaco-editor");
    // BOM 的文件在第一行开头输入（BOM 所在的那一行被改了也要留住它），混用换行的在末尾输入。
    for (const [name, key, typed, expected] of [
        ["bom.txt", "Control+Home", "零", [0xef, 0xbb, 0xbf, ...new TextEncoder().encode("零甲\r\n乙\r\n")]],
        ["mixed.txt", "Control+End", "丁", [...new TextEncoder().encode("甲\r\n乙\n丙\r\n丁")]],
    ] as const) {
        await item(page, `project://data/${name}`).dblclick();
        await expect(editor).toBeVisible();
        await item(page, "project://data/f.json").dblclick();
        await page.locator("[data-editor-tab-label]", {hasText: name}).click();
        await expect(page.locator("[data-editor-tab]", {hasText: name})).not.toHaveAttribute("data-editor-tab-dirty", "");
        await editor.click();
        await page.keyboard.press(key);
        await page.keyboard.type(typed);
        await page.keyboard.press("Control+s");
        await expect.poll(async () => [...new Uint8Array(await readFile(join(projectDir, "data", name)))]).toEqual([...expected]);
    }
    await closeAll(page);
});

test("命令面板里“用其它编辑器重新打开”：选择里列出 Markdown（当前）与源码编辑器；换成源码看得到 frontmatter，再换回富文本", async ({page}) => {
    await open(page);
    await closeAll(page);
    // 前面的用例改过这个文件：以打开前的字节为准。
    const before = await disk("notes/dialect.md");
    await item(page, "project://notes/dialect.md").dblclick();
    await expect(prose(page)).toContainText("雨下了一整夜。");
    const combobox = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    const picker = page.getByRole("combobox", {name: "选择打开这个文件的编辑器"});
    const run = async (editor: string): Promise<void> => {
        await expect(async () => {
            await page.keyboard.press("Control+Shift+P");
            await expect(combobox).toBeFocused({timeout: 500});
        }).toPass();
        await combobox.fill("用其它编辑器重新打开");
        await page.getByRole("option", {name: /用其它编辑器重新打开/u}).click();
        await expect(picker).toBeFocused();
        await page.getByRole("option", {name: new RegExp(editor, "u")}).click();
    };
    await run("源码编辑器");
    await expect.poll(() => monacoText(page)).toContain("title: 第三章");
    await run("Markdown 编辑器");
    await expect(prose(page)).toContainText("雨下了一整夜。");
    expect(await disk("notes/dialect.md")).toBe(before);
    await closeAll(page);
});

test("状态栏条目：Markdown 有字数、没有光标位置；输入后出现“未保存 1 个”，点它全部保存；源码编辑器给出行列并随光标移动", async ({page}) => {
    await open(page);
    await closeAll(page);
    const status = (id: string) => page.locator(`[data-workbench-status-bar] [data-workbench-item="${id}"]`);
    // 前面的用例可能改过 h.md：字数按打开时的正文算。
    const before = await disk("notes/h.md");
    await item(page, "project://notes/h.md").dblclick();
    await expect(prose(page)).toContainText(before.trim());
    await expect(status("nbook.editor.word-count")).toHaveText(`${String([...before.trim()].length)} 字`);
    await expect(status("nbook.editor.cursor")).toHaveCount(0);
    await expect(status("nbook.editor.unsaved")).toHaveCount(0);

    await atEnd(page);
    await page.keyboard.type("雨夜");
    await expect(status("nbook.editor.word-count")).toHaveText(`${String([...before.trim()].length + 2)} 字`);
    await expect(status("nbook.editor.unsaved")).toHaveText("未保存 1 个");
    await expect(status("nbook.editor.unsaved")).toHaveAttribute("title", "notes/h.md");
    await status("nbook.editor.unsaved").click();
    await expect(status("nbook.editor.unsaved")).toHaveCount(0);
    await expect.poll(() => disk("notes/h.md")).toContain("雨夜");

    if (await item(page, "project://data").getAttribute("aria-expanded") !== "true") await item(page, "project://data").click();
    await item(page, "project://data/g.json").dblclick();
    const editor = page.locator("[data-editor-kind=\"nbook.editor.code\"]:visible .monaco-editor");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press("Control+Home");
    await expect(status("nbook.editor.cursor")).toHaveText("第 1 行，第 1 列");
    await page.keyboard.press("End");
    await expect(status("nbook.editor.cursor")).toHaveText(/^第 1 行，第 \d+ 列$/u);
    await expect(status("nbook.editor.cursor")).not.toHaveText("第 1 行，第 1 列");
    // 切回 Markdown：光标位置不再显示。
    await page.locator("[data-editor-tab-label]", {hasText: "h.md"}).click();
    await expect(status("nbook.editor.cursor")).toHaveCount(0);
    await closeAll(page);
});

test("纸面与空态：没有标签时正中是淡色标志与三行提示，点提示执行对应命令；Markdown 正文在 720px 版心里、17px、行距 1.95，编辑区是面板底色、外壳根是主题的窗体底", async ({page}) => {
    await open(page);
    await closeAll(page);
    const empty = page.locator("[data-editor-group-active] [data-editor-empty]");
    const tips = empty.locator("[data-editor-empty-tip]");
    await expect(empty.locator(".editor-group__mark")).toBeVisible();
    await expect(tips).toHaveText(["显示所有命令CtrlShiftP", "新建文件资源管理器标题行的“新建文件”", "打开欢迎页帮助 › 欢迎"]);
    await expect(empty.locator("kbd")).toHaveText(["Ctrl", "Shift", "P"]);
    const centered = await page.locator("[data-editor-group-active] [data-editor-content]").evaluate((content) => {
        const mark = content.querySelector("[data-editor-empty] .editor-group__mark")!;
        const [box, logo] = [content.getBoundingClientRect(), mark.getBoundingClientRect()];
        return {offset: Math.abs(box.x + box.width / 2 - (logo.x + logo.width / 2)), size: logo.width};
    });
    expect(centered.offset).toBeLessThan(1);
    expect(centered.size).toBe(132);

    // 点提示执行它的命令：命令面板打开；欢迎页以标签打开（关掉回到空态）。
    await tips.filter({hasText: "显示所有命令"}).click();
    await expect(page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"})).toBeFocused();
    await page.keyboard.press("Escape");
    await tips.filter({hasText: "打开欢迎页"}).click();
    await expect(page.locator("[data-welcome-page]")).toBeVisible();
    await closeAll(page);
    await expect(empty).toBeVisible();

    // 前面的用例可能改过 a.md：只看开头。
    await item(page, "project://notes/a.md").dblclick();
    await expect(prose(page)).toContainText("第一章");
    const paper = await page.locator("[data-editor-group-active]").evaluate((group) => {
        const probe = document.createElement("div");
        probe.style.backgroundColor = "var(--panel-surface)";
        group.append(probe);
        const surface = getComputedStyle(probe).backgroundColor;
        probe.style.backgroundColor = "var(--shell-ground, var(--panel-surface))";
        const ground = getComputedStyle(probe).backgroundColor;
        probe.remove();
        const control = group.querySelector(".markdown-control:not([hidden])")!;
        const text = getComputedStyle(group.querySelector("[data-editor-prose]")!);
        return {
            group: getComputedStyle(group).backgroundColor === surface,
            shell: getComputedStyle(document.querySelector("[data-workbench-shell]")!).backgroundColor === ground,
            measure: getComputedStyle(control).maxWidth,
            size: text.fontSize,
            leading: text.lineHeight,
        };
    });
    expect(paper).toEqual({group: true, shell: true, measure: "720px", size: "17px", leading: "33.15px"});
    await closeAll(page);
});

test("重新打开回到上次的光标：Markdown 放回原处并聚焦、可以直接接着写；源码编辑器回到行列，正文变短时夹到末尾；最近打开记下打开过的文件", async ({page}) => {
    await open(page);
    await closeAll(page);
    const status = (id: string) => page.locator(`[data-workbench-status-bar] [data-workbench-item="${id}"]`);
    if (await item(page, "project://data").getAttribute("aria-expanded") !== "true") await item(page, "project://data").click();
    await item(page, "project://data/cursor.txt").dblclick();
    const code = page.locator("[data-editor-kind=\"nbook.editor.code\"]:visible .monaco-editor");
    await expect(code).toBeVisible();
    await code.click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowDown");
    for (let step = 0; step < 3; step += 1) await page.keyboard.press("ArrowRight");
    await expect(status("nbook.editor.cursor")).toHaveText("第 2 行，第 4 列");
    // 光标停下一秒后记到标签上、随会话记录保存。
    await expect.poll(() => savedCursor(page, "project://data/cursor.txt")).toEqual({line: 2, column: 4});

    await item(page, "project://notes/clamp.md").dblclick();
    await atEnd(page);
    await expect.poll(() => savedCursor(page, "project://notes/clamp.md")).toEqual({offset: 11});

    await item(page, "project://notes/cursor.md").dblclick();
    await prose(page).click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => savedCursor(page, "project://notes/cursor.md")).toEqual({offset: 3});
    await expect.poll(async () => (await projectRecord(page, "editor.recent"))?.addresses).toEqual(["project://notes/cursor.md", "project://notes/clamp.md", "project://data/cursor.txt"]);

    // 刷新前外部把两个不活动的文件改短：记下的第 2 行、第 11 个位置都已不在。
    await writeFile(join(projectDir, "data/cursor.txt"), "甲");
    await writeFile(join(projectDir, "notes/clamp.md"), "一\n");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
    });
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect.poll(() => focusInEditor(page)).toBe(true);
    await page.keyboard.type("X");
    await expect(prose(page)).toHaveText("一二X三四五");
    await page.locator("[data-editor-tab-label]", {hasText: "cursor.txt"}).click();
    await expect(status("nbook.editor.cursor")).toHaveText("第 1 行，第 2 列");
    await page.locator("[data-editor-tab-label]", {hasText: "clamp.md"}).click();
    await expect(prose(page)).toHaveText("一");
    expect(errors).toEqual([]);
    await closeAll(page);
});

test("打开作品时资源管理器揭示一次恢复出的活动文件：展开它所在的目录并选中它；之后切换标签不跟着揭示", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/b.md").dblclick();
    await item(page, "project://notes/c.md").dblclick();
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).toContainText("c.md");
    // 收起 notes 并等它记下：刷新后它要靠揭示重新展开。
    await item(page, "project://notes").click();
    await expect(item(page, "project://notes")).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => ((await projectRecord(page, "explorer.expanded"))?.paths as string[] | undefined)?.includes("notes")).toBe(false);

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(item(page, "project://notes")).toHaveAttribute("aria-expanded", "true");
    await expect(item(page, "project://notes/c.md")).toHaveAttribute("aria-selected", "true");
    await expect(item(page, "project://notes/b.md")).toHaveAttribute("aria-selected", "false");

    await page.locator("[data-editor-tab-label]", {hasText: "b.md"}).click();
    await expect(page.locator("[data-editor-tab][aria-selected=\"true\"]")).toContainText("b.md");
    expect(await item(page, "project://notes/c.md").getAttribute("aria-selected")).toBe("true");
    expect(await item(page, "project://notes/b.md").getAttribute("aria-selected")).toBe("false");
    await closeAll(page);
});

test("服务端重启：终态页列出未保存的正文", async ({page}) => {
    await open(page);
    await closeAll(page);
    await item(page, "project://notes/e.md").dblclick();
    await atEnd(page);
    await page.keyboard.type("来不及保存");
    const port = new URL(server.url).port;
    expect(await server.stop()).toBe(0);
    server = await startProductServer(stateRoot, Number(port));
    await expect(page.locator("[data-browser-host-status=\"server-restarted\"], [data-browser-host-status=\"project-gone\"]")).toBeVisible({timeout: 30_000});
    await expect(page.locator("[data-host-rescued-item] code")).toHaveText("project://notes/e.md");
    await expect(page.locator("[data-host-rescued-item] textarea")).toHaveValue("第五章来不及保存\n");
});

test.describe("编辑区标题（docs/specs/workbench/editor.md 输出 34，验收 21）", () => {
    let titleTmp = "";
    let probe: ProbeServer;

    test.beforeAll(async () => {
        titleTmp = await createTestTmpRoot("neuro-book-e2e", "editor-title");
        const stateRoot = join(titleTmp, "state");
        const book = join(titleTmp, "Book");
        const id = randomUUID();
        await mkdir(join(book, ".nbook"), {recursive: true});
        await mkdir(stateRoot, {recursive: true});
        await writeFile(join(book, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
        await writeFile(join(book, "a.md"), "甲\n");
        await writeFile(join(book, "b.txt"), "乙\n");
        await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: book}]}));
        // `test.menus` 往 `editor.title` 贡献一个只对 .md、带 resource 的按钮“测试编辑区按钮”。
        probe = await startProbeServer(stateRoot, {env: {NBOOK_TEST_PLUGINS: "test.menus"}});
    });

    test.afterAll(async () => {
        expect(await probe.stop()).toBe(0);
        if (titleTmp !== "") await rm(titleTmp, {recursive: true, force: true});
    });

    const actions = (page: Page) => page.locator("[data-editor-title-actions]");

    test("活动组标签条右侧：向右拆分、贡献的 .md 按钮与“⋯”（里面是用其它编辑器重新打开）；换成 .txt 时贡献的按钮消失；两个组时只画在活动组；点贡献的按钮收到活动标签的地址", async ({page}) => {
        await page.setViewportSize({width: 1440, height: 900});
        await page.goto(new URL("/?project=book", probe.url).href);
        await item(page, "project://a.md").dblclick();
        // 作品第一次在本窗口打开时欢迎页也自动打开（workbench.bookshelf 输出 20）：只认 a.md 的标签。
        await expect(tabs(page).filter({hasText: "a.md"})).toHaveCount(1);
        const active = page.locator("[data-editor-group-active] [data-editor-title-actions]");
        await expect(active.locator("[data-title-action-key]")).toHaveCount(2);
        expect(await active.locator("[data-title-action-key], [data-title-actions-more]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-title-action-key") ?? "more"))).toEqual(["own:split-right", "test.menus.editor-md", "more"]);
        await active.locator("[data-title-actions-more]").click();
        await expect(page.getByRole("menu").getByRole("menuitem", {name: "用其它编辑器重新打开"})).toBeVisible();
        await page.keyboard.press("Escape");

        await active.locator('[data-title-action-key="test.menus.editor-md"]').click();
        await expect(page.getByText(`收到 ${JSON.stringify({address: "project://a.md"})}`)).toBeVisible();

        await item(page, "project://b.txt").dblclick();
        await expect(active.locator('[data-title-action-key="test.menus.editor-md"]')).toHaveCount(0);

        await active.locator('[data-title-action-key="own:split-right"]').click();
        await expect(page.locator("[data-editor-group]")).toHaveCount(2);
        await expect(actions(page)).toHaveCount(1);
        const groups = page.locator("[data-editor-group]");
        const first = groups.first();
        await first.locator("[data-editor-tab]").filter({hasText: "a.md"}).click();
        await expect(first).toHaveAttribute("data-editor-group-active", "");
        await expect(first.locator("[data-editor-title-actions]")).toHaveCount(1);
        await expect(actions(page)).toHaveCount(1);
        await expect(first.locator('[data-title-action-key="test.menus.editor-md"]')).toHaveCount(1);
    });

    test("标签的右键菜单作用于被右击的标签、不先激活它：贡献的项收到它的地址；关闭其他只关它所在组的", async ({page}) => {
        await page.setViewportSize({width: 1440, height: 900});
        await page.goto(new URL("/?project=book", probe.url).href);
        await item(page, "project://a.md").dblclick();
        await item(page, "project://b.txt").dblclick();
        await page.locator('[data-editor-group-active] [data-title-action-key="own:split-right"]').click();
        await expect(page.locator("[data-editor-group]")).toHaveCount(2);
        const [left, right] = [page.locator("[data-editor-group]").first(), page.locator("[data-editor-group]").nth(1)];
        await expect(right).toHaveAttribute("data-editor-group-active", "");
        const menu = page.getByRole("menu");

        await left.locator("[data-editor-tab]").filter({hasText: "a.md"}).click({button: "right"});
        await menu.getByRole("menuitem", {name: "测试标签菜单"}).click();
        await expect(page.getByText(`收到 ${JSON.stringify({address: "project://a.md"})}`)).toBeVisible();
        await expect(right).toHaveAttribute("data-editor-group-active", "");

        await left.locator("[data-editor-tab]").filter({hasText: "a.md"}).click({button: "right"});
        await expect(menu.getByRole("menuitem", {name: "固定"})).toBeVisible();
        await menu.getByRole("menuitem", {name: "关闭其他"}).click();
        await expect(left.locator("[data-editor-tab-label]")).toHaveText(["a.md"]);
        await expect(right.locator("[data-editor-tab-label]")).toHaveText(["b.txt"]);

        // 键盘：聚焦标签按 Shift+F10 打开同一个菜单，Escape 关上。
        await left.locator("[data-editor-tab]").filter({hasText: "a.md"}).focus();
        await page.keyboard.press("Shift+F10");
        await expect(menu.getByRole("menuitem", {name: "关闭"}).first()).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
    });

    test("编辑组窄到放不下按钮时：按钮都收进“⋯”，“⋯”与至少一个标签宽的标签条都在这一组里，“⋯”里仍能执行拆分与贡献的项", async ({page}) => {
        // 编辑组至少 220px（输出 2）：窗口放不下四个最小宽度时各组按比例压缩，活动组才会窄到放不下按钮。
        await page.setViewportSize({width: 900, height: 900});
        await page.goto(new URL("/?project=book", probe.url).href);
        await item(page, "project://a.md").dblclick();
        const group = page.locator("[data-editor-group-active]");
        const more = group.locator("[data-title-actions-more]");
        /** 向右拆分活动组：按钮还在时点按钮，收进“⋯”以后从“⋯”里点。 */
        const splitRight = async (): Promise<void> => {
            const count = await page.locator("[data-editor-group]").count();
            const button = group.locator('[data-title-action-key="own:split-right"]');
            if (await button.count() > 0) await button.click();
            else {
                await more.click();
                await page.getByRole("menu").getByRole("menuitem", {name: "向右拆分编辑器"}).click();
            }
            await expect(page.locator("[data-editor-group]")).toHaveCount(count + 1);
        };
        for (let index = 0; index < 3; index += 1) await splitRight();
        const groupBox = await group.boundingBox();
        expect(groupBox).not.toBeNull();
        // 放不下一个按钮：标题行里只剩“⋯”（editor.md 输出 34：编辑组窄时按宽度再少）。
        expect(groupBox!.width).toBeLessThan(104 + 24 + 26);
        await expect(group.locator("[data-title-action-key]")).toHaveCount(0);
        const moreBox = await more.boundingBox();
        const tabsBox = await group.getByRole("tablist").boundingBox();
        expect(moreBox).not.toBeNull();
        expect(tabsBox).not.toBeNull();
        expect(moreBox!.x).toBeGreaterThanOrEqual(groupBox!.x);
        expect(moreBox!.x + moreBox!.width).toBeLessThanOrEqual(groupBox!.x + groupBox!.width + 0.5);
        expect(tabsBox!.width).toBeGreaterThanOrEqual(groupBox!.width - 24 - 8 - 1);

        await more.click();
        const menu = page.getByRole("menu");
        expect(await menu.locator('[role^="menuitem"], [role="separator"]').evaluateAll((nodes) => nodes.map((node) => (node.getAttribute("role") === "separator" ? "---" : (node.textContent ?? "").trim())))).toEqual(["向右拆分编辑器", "用其它编辑器重新打开", "---", "测试编辑区按钮"]);
        await menu.getByRole("menuitem", {name: "测试编辑区按钮"}).click();
        await expect(page.getByText(`收到 ${JSON.stringify({address: "project://a.md"})}`)).toBeVisible();
    });
});
