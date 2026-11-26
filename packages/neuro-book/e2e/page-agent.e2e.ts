/**
 * Agent 看懂界面（`ui`）在真实 Chrome 里的验收（docs/specs/agent/page-agent.md 验收 2、3、4、5、8）：生产构建的后端与前端，项目与设置是真的，
 * 模型是 Bun 子进程里的本机端点。判据都取页面上与模型请求里能观察到的东西：eval 交给模型的输出、审批向导、请求里的图片。
 *
 * 几个窗口用同一个浏览器上下文里的几个页面：Playwright 默认让每个页面都“有焦点”，用例经 CDP 关掉焦点模拟，
 * 再按 `bringToFront` 让焦点只落在一个页面上。无头 Chrome 没有后台标签，窗口转后台只能在页面里改 `document.visibilityState`。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {BrowserContext, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "./fixtures";
import type {ProcessHandle, ProductServer} from "./fixtures";

interface World {
    readonly server: ProductServer;
}

interface SeenMessage {
    readonly role: string;
    readonly content?: unknown;
}

let tmp = "";
let modelBaseUrl = "";
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};
/** 询问模式的后端：eval 与截图都要在向导里批准。 */
let asking: World;
const worlds: World[] = [];

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const script = (...replies: unknown[]) => control("/script", replies);
const requests = async () => await control("/requests") as {messages: SeenMessage[]}[];

/**
 * 起一个后端：两部作品（`book` 与 `other`），模型收图（`vision`）。`allowEval` 时用户层规则放行 eval，用例里没有审批点击，
 * 免得点击本身改变“哪个窗口最近有输入”。
 */
async function startWorld(name: string, options: {readonly allowEval: boolean}): Promise<World> {
    const stateRoot = join(tmp, `state-${name}`);
    await mkdir(join(stateRoot, "user"), {recursive: true});
    const settings = localModelSettings(modelBaseUrl) as Record<string, unknown>;
    (settings["nbook.models/providers"] as {models: {vision?: boolean}[]}[])[0]!.models[0]!.vision = true;
    if (options.allowEval) settings["nbook.agent/permissionRules"] = [{tool: "nbook.agent.eval", action: "allow"}];
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(settings));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id: bookId, name: "book", path: join(tmp, "Book")}, {id: otherId, name: "other", path: join(tmp, "Other")}]}));
    const world = {server: await startProductServer(stateRoot)};
    worlds.push(world);
    return world;
}

const bookId = randomUUID();
const otherId = randomUUID();

async function makeProject(dir: string, id: string): Promise<void> {
    await mkdir(join(dir, ".nbook"), {recursive: true});
    await writeFile(join(dir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
}

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "page-agent");
    await makeProject(join(tmp, "Book"), bookId);
    await makeProject(join(tmp, "Other"), otherId);
    await mkdir(join(tmp, "Book", "正文"), {recursive: true});
    await writeFile(join(tmp, "Book", "正文/第三章.md"), "雨越下越大。\n他没有回头。\n");
    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    modelBaseUrl = baseUrl!;
    endpoint = {...handle, control: controlUrl!, child};
    asking = await startWorld("asking", {allowEval: false});
});

test.afterAll(async () => {
    for (const world of worlds) expect(await world.server.stop()).toBe(0);
    endpoint.child.stdin?.end();
    await endpoint.exit;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

// ---------- 页面与会话的辅助 ----------

const input = (page: Page) => page.getByRole("textbox", {name: "消息输入框"});

/** 作者界面在默认 1280 宽时编辑区太窄、页面落到窄版：e2e 的视口设 1440 以上。 */
const WIDTH = 1440;

/** 打开作品，经命令面板把对话带到前面。 */
async function openConversation(page: Page, world: World): Promise<void> {
    await page.goto(new URL("/?project=book", world.server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeVisible();
}

const newSession = async (page: Page): Promise<void> => {
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("新建 Agent 会话");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
};

async function send(page: Page, text: string): Promise<void> {
    await input(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
}

/** 模型最近一次请求里最后一条工具结果的文字：eval 交回的输出。 */
async function lastToolText(): Promise<string> {
    const messages = (await requests()).at(-1)!.messages;
    const tool = messages.findLast((message) => message.role === "tool");
    if (tool === undefined) throw new Error("最近一次请求里没有工具结果");
    return typeof tool.content === "string" ? tool.content : JSON.stringify(tool.content);
}

/** 最近一次请求里整段历史带着的图片（JPEG 的字节），按出现的先后。 */
async function imagesInHistory(): Promise<Uint8Array[]> {
    const images: Uint8Array[] = [];
    for (const message of (await requests()).at(-1)!.messages) {
        if (!Array.isArray(message.content)) continue;
        for (const part of message.content as {type?: string; image_url?: {url: string}}[]) {
            if (part.type !== "image_url") continue;
            const [, base64] = /^data:image\/jpeg;base64,(.+)$/u.exec(part.image_url!.url)!;
            images.push(new Uint8Array(Buffer.from(base64!, "base64")));
        }
    }
    return images;
}

/** JPEG 帧头（SOF0 到 SOF2）里的宽高。 */
function jpegSize(bytes: Uint8Array): {width: number; height: number} {
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) throw new Error(`JPEG 段头不对：偏移 ${String(offset)}`);
        const marker = bytes[offset + 1]!;
        const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
        if (marker >= 0xc0 && marker <= 0xc2) return {height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!};
        offset += 2 + length;
    }
    throw new Error("JPEG 里没有帧头");
}

/**
 * 发一条消息让模型调一次 eval，批准 eval，等模型的最终回复出现，交回 eval 的输出。`approvals` 在批准 eval 之后处理代码里调用弹出的审批。
 * 回复文字与发的消息不同，免得页面上用户气泡里的同一句话让“回复出现”提前成立。
 */
async function runEval(page: Page, label: string, code: string, approvals?: (wizard: ReturnType<Page["locator"]>, title: ReturnType<Page["locator"]>) => Promise<void>): Promise<string> {
    const reply = `${label}：已处理`;
    await script({tool: "eval", args: {title: label, code}}, reply);
    await send(page, label);
    const wizard = page.locator("[data-agent-wizard]");
    const title = wizard.locator(".acv-wizard-frame__title");
    await expect(title).toHaveText("调用工具 eval");
    await wizard.locator("[data-approval-decision='allow']").click();
    await approvals?.(wizard, title);
    await expect(page.getByText(reply, {exact: true})).toBeVisible();
    return lastToolText();
}

// ---------- 验收 3（引用部分）、4、5 ----------

test.describe("询问模式下的一个窗口", () => {
    test("验收 3（引用部分）：同一次加载里引用不变且能再用；刷新窗口后旧引用得 stale-ref，快照另发新引用", async ({page}) => {
        await page.setViewportSize({width: WIDTH, height: 900});
        await openConversation(page, asking);
        await newSession(page);
        const first = JSON.parse(await runEval(page, "取引用", [
            "const one = await ui.snapshot();",
            "const two = await ui.snapshot();",
            "var oldRef = one.elements[0].ref;",
            "const scoped = await ui.snapshot({scope: {ref: oldRef}});",
            "return JSON.stringify({ref: oldRef, same: one.elements[0].ref === two.elements[0].ref, scopeLine: scoped.text.split('\\n')[1]});",
        ].join("\n"))) as {ref: string; same: boolean; scopeLine: string};
        expect(first.ref).toMatch(/^[a-z0-9]+\.\d+$/u);
        expect(first.same).toBe(true);
        expect(first.scopeLine).toContain(first.ref);

        await page.reload();
        await expect(input(page)).toBeVisible();
        const second = JSON.parse(await runEval(page, "刷新后再用旧引用", [
            "let failure = null;",
            "try { await ui.snapshot({scope: {ref: oldRef}}); } catch (error) { failure = {code: error.code, name: error.name}; }",
            "const fresh = await ui.snapshot();",
            "return JSON.stringify({failure, freshRef: fresh.elements[0].ref});",
        ].join("\n"))) as {failure: {code: string; name: string} | null; freshRef: string};
        expect(second.failure).toEqual({code: "stale-ref", name: "ToolCallError"});
        // 新加载发的引用前缀不同：旧引用不会碰巧重新生效。
        expect(second.freshRef.split(".")[0]).not.toBe(first.ref.split(".")[0]);
    });

    test("验收 4：询问模式先批 eval，再出截图的审批卡；拒绝后代码里看到被拒、没有图；批准后结果里有一张不超过 512 KB 的图，写明截的是哪个窗口", async ({page}) => {
        await page.setViewportSize({width: WIDTH, height: 900});
        await openConversation(page, asking);
        await newSession(page);
        const imagesBefore = (await imagesInHistory()).length;

        // 拒绝：eval 批过之后弹出截图自己的审批，向导写明是 eval 里的调用。
        const denied = JSON.parse(await runEval(page, "截图被拒", [
            "try { await ui.screenshot(); return JSON.stringify({ok: true}); }",
            "catch (error) { return JSON.stringify({ok: false, code: error.code, name: error.name}); }",
        ].join("\n"), async (wizard, title) => {
            await expect(title).toHaveText("eval 里的调用：调用工具 screenshot");
            await wizard.locator("[data-approval-decision='deny']").click();
        })) as {ok: boolean; code?: string; name?: string};
        expect(denied).toEqual({ok: false, code: "user-denied", name: "ToolCallError"});
        expect((await imagesInHistory()).length).toBe(imagesBefore);

        // 批准：整个窗口的截图。
        const shot = JSON.parse(await runEval(page, "截整个窗口", "return JSON.stringify(await ui.screenshot());", async (wizard, title) => {
            await expect(title).toHaveText("eval 里的调用：调用工具 screenshot");
            await wizard.locator("[data-approval-decision='allow']").click();
        })) as {window: {path: string; width: number; height: number}; target: string; width: number; height: number};
        expect(shot.target).toBe("window");
        expect(shot.window).toMatchObject({path: "/?project=book", width: WIDTH, height: 900});
        const images = await imagesInHistory();
        expect(images).toHaveLength(imagesBefore + 1);
        const image = images.at(-1)!;
        expect(image.length).toBeLessThanOrEqual(512 * 1024);
        const size = jpegSize(image);
        expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1280);
        expect(size).toEqual({width: shot.width, height: shot.height});

        // 按元素截：审批卡写出要截的元素；图是那个元素的大小。
        const element = JSON.parse(await runEval(page, "截一个按钮", "return JSON.stringify(await ui.screenshot({of: {role: 'button', name: '回到书架', nth: 0}}));", async (wizard, title) => {
            await expect(title).toHaveText("eval 里的调用：调用工具 screenshot");
            await expect(wizard).toContainText("回到书架");
            await wizard.locator("[data-approval-decision='allow']").click();
        })) as {target: string; width: number; height: number};
        expect(element.target).toBe("element");
        expect(element.width).toBeLessThan(shot.width);
        expect(jpegSize((await imagesInHistory()).at(-1)!)).toEqual({width: element.width, height: element.height});

        // `of` 找不到时得 not-found，不改截整个窗口。
        const imagesAfterElement = (await imagesInHistory()).length;
        const missing = JSON.parse(await runEval(page, "截不存在的按钮", [
            "try { await ui.screenshot({of: {role: 'button', name: '这个按钮不存在'}}); return JSON.stringify({ok: true}); }",
            "catch (error) { return JSON.stringify({ok: false, code: error.code}); }",
        ].join("\n"), async (wizard) => {
            await wizard.locator("[data-approval-decision='allow']").click();
        })) as {ok: boolean; code?: string};
        expect(missing).toEqual({ok: false, code: "not-found"});
        expect((await imagesInHistory()).length).toBe(imagesAfterElement);
    });

    test("验收 5：快照全列出来远超大小上限的页面：快照被截断并标明，窗口连接不断开，下一次调用照常", async ({page}) => {
        await page.setViewportSize({width: WIDTH, height: 900});
        await openConversation(page, asking);
        await newSession(page);
        // 在窗口里造一个巨大的页面状态：左边一条窄带里排满 1350 个看得见的小按钮，名字是 100 个要转义的控制字符。
        await page.evaluate(() => {
            const host = document.createElement("div");
            host.id = "probe-big-page";
            host.style.cssText = "position:fixed;left:0;top:0;width:300px;height:900px;z-index:99999;background:#fff;display:flex;flex-wrap:wrap;align-content:flex-start;overflow:hidden";
            const control = String.fromCharCode(0x202e).repeat(100);
            for (let index = 0; index < 1350; index += 1) {
                const button = document.createElement("button");
                button.setAttribute("aria-label", `${control}${String(index)}`);
                button.style.cssText = "width:10px;height:20px;padding:0;border:0;flex:none";
                host.append(button);
            }
            document.body.append(host);
        });
        const big = JSON.parse(await runEval(page, "大页面快照", [
            "const s = await ui.snapshot({maxTokens: 8000});",
            "const bytes = (value) => new TextEncoder().encode(value).length;",
            "return JSON.stringify({truncated: s.truncated, elements: s.elements.length, textBytes: bytes(s.text), jsonBytes: bytes(JSON.stringify(s)), warnings: s.warnings.length, window: s.window.name, hint: s.text.split('\\n').at(-1).slice(0, 40)});",
        ].join("\n"))) as {truncated: boolean; elements: number; textBytes: number; jsonBytes: number; warnings: number; window: string; hint: string};
        expect(big.truncated).toBe(true);
        expect(big.warnings).toBeGreaterThan(0);
        expect(big.hint).toMatch(/^truncated:/u);
        expect(big.elements).toBeGreaterThan(0);
        expect(big.elements).toBeLessThanOrEqual(500);
        expect(big.textBytes).toBeLessThanOrEqual(64 * 1024);
        expect(big.jsonBytes).toBeLessThanOrEqual(256 * 1024);

        // 连接没断：同一个窗口马上再答一次，没有 window-gone、window-unresponsive。
        const again = JSON.parse(await runEval(page, "截断后再调一次", [
            "try { const s = await ui.snapshot(); return JSON.stringify({ok: true, window: s.window.name, elements: s.elements.length}); }",
            "catch (error) { return JSON.stringify({ok: false, code: error.code}); }",
        ].join("\n"))) as {ok: boolean; window?: string; elements?: number};
        expect(again.ok).toBe(true);
        expect(again.window).toBe(big.window);
        expect(again.elements).toBeGreaterThan(0);
    });
});

// ---------- 验收 2、8：几个窗口 ----------

test.describe("多个窗口", () => {
    let auto: World;
    let context: BrowserContext;

    test.beforeAll(async ({browser}) => {
        auto = await startWorld("auto", {allowEval: true});
        context = await browser.newContext();
    });

    test.afterAll(async () => {
        await context.close();
    });

    /** 开一个窗口：视口宽度各不相同，快照交回的窗口宽度就是“选中了哪个窗口”的判据。 */
    async function openWindow(project: "book" | "other", width: number): Promise<Page> {
        const page = await context.newPage();
        await page.setViewportSize({width, height: 900});
        await page.goto(new URL(`/?project=${project}`, auto.server.url).href);
        if (project === "book") await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
        else await expect(page.locator("[data-activity-item]").first()).toBeVisible();
        return page;
    }

    /** 关掉焦点模拟：之后页面的焦点跟着 `bringToFront` 走，同一时刻只有一个页面有焦点。 */
    async function realFocus(page: Page): Promise<void> {
        const session = await context.newCDPSession(page);
        await session.send("Emulation.setFocusEmulationEnabled", {enabled: false});
    }

    /** 用户切到这个窗口并真实输入一下。 */
    async function userUses(page: Page): Promise<void> {
        await page.bringToFront();
        await page.mouse.click(5, 5);
    }

    /** 窗口转后台：无头 Chrome 没有后台标签，只能让页面自己报告看不见。 */
    async function sendToBackground(page: Page): Promise<void> {
        await page.evaluate(() => {
            Object.defineProperty(document, "visibilityState", {get: () => "hidden", configurable: true});
            Object.defineProperty(document, "hidden", {get: () => true, configurable: true});
            document.dispatchEvent(new Event("visibilitychange"));
        });
    }

    /**
     * 在聊天窗口发一条让模型调 eval 的消息，扣住模型的这次请求，让 `beforeRun` 先做窗口上的动作，再放行；
     * eval 由规则放行、不需要点击。交回 eval 的输出。
     */
    async function callWhile(chat: Page, label: string, code: string, beforeRun: () => Promise<void>): Promise<string> {
        const before = (await requests()).length;
        await script({tool: "eval", args: {title: label, code}}, `${label}：已处理`);
        await control("/hold", {});
        await chat.bringToFront();
        await send(chat, label);
        await control("/hold/arrived", {});
        await beforeRun();
        await control("/hold/release", {});
        await expect.poll(async () => (await requests()).length, {message: `${label}：模型收到 eval 的结果`}).toBeGreaterThanOrEqual(before + 2);
        return lastToolText();
    }

    const WHICH = [
        "try { const s = await ui.snapshot(); return JSON.stringify({ok: true, width: s.window.width}); }",
        "catch (error) { return JSON.stringify({ok: false, code: error.code, message: error.message}); }",
    ].join("\n");

    test("验收 2（去掉 2 分钟那一步）：同一作品三个窗口加一个别的作品的窗口：有真实输入的被选中、别的作品的不被选中；用户切到另一个窗口仍用上次的；上次的转后台后改用新的；同一作品的窗口都没了得 no-window", async () => {
        const a = await openWindow("book", 1440);
        const b = await openWindow("book", 1450);
        const c = await openWindow("book", 1460);
        const d = await openWindow("other", 1470);
        for (const page of [a, b, c, d]) await realFocus(page);
        await a.bringToFront();
        await newSession(a);
        const widthOf = (output: string) => (JSON.parse(output) as {ok: boolean; width?: number; code?: string; message?: string});

        // 在 B 上有真实输入、随后别的作品的窗口 D 拿到焦点与最近的输入：候选不含 D，选 B。
        const first = widthOf(await callWhile(a, "第一次调用", WHICH, async () => {
            await userUses(b);
            await userUses(d);
        }));
        expect(first).toEqual({ok: true, width: 1450});

        // 用户切到 C 并输入：B 还看得见、刚用过，不跟过去。
        const second = widthOf(await callWhile(a, "第二次调用", WHICH, async () => {
            await userUses(c);
        }));
        expect(second).toEqual({ok: true, width: 1450});

        // B 转后台：改用有焦点、有最近输入的 C；D 仍不被选中。
        const third = widthOf(await callWhile(a, "第三次调用", WHICH, async () => {
            await sendToBackground(b);
            await userUses(d);
            await userUses(c);
        }));
        expect(third).toEqual({ok: true, width: 1460});

        // 同一作品的窗口都没了（聊天的窗口回到书架，B、C 关掉），只剩别的作品的 D：没有可用的窗口，说明写明是没有打开这部作品的窗口。
        const none = widthOf(await callWhile(a, "第四次调用", WHICH, async () => {
            await b.close();
            await c.close();
            await a.goto(new URL("/", auto.server.url).href);
        }));
        expect(none.ok).toBe(false);
        expect(none.code).toBe("no-window");
        expect(none.message).toContain("没有打开这部作品的窗口");
        await d.close();
        await a.close();
    });

    test("验收 8：窗口刚打开就调 ui.snapshot：新窗口一显示出来就在时限内交回快照", async () => {
        const chat = await openWindow("book", 1440);
        await realFocus(chat);
        await chat.bringToFront();
        await newSession(chat);
        // 聊天窗口扣住模型的请求，另开一个窗口；窗口一显示出来就放行，选中的应当是这个刚开的窗口，且它在 3 秒的时限内应答。
        const output = await callWhile(chat, "刚开的窗口", WHICH, async () => {
            const fresh = await context.newPage();
            await fresh.setViewportSize({width: 1480, height: 900});
            await realFocus(fresh);
            await fresh.goto(new URL("/?project=book", auto.server.url).href);
            await expect(fresh.locator("[data-explorer-row]").first()).toBeVisible();
            await userUses(fresh);
        });
        expect(JSON.parse(output)).toEqual({ok: true, width: 1480});
    });
});
