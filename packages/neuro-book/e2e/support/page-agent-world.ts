/**
 * `ui`（Agent 看懂并引导界面）的应用 e2e 用的场地：生产构建的后端加本机模型端点，作品 `book` 与 `other`，几个后端可以并存，
 * 以及“发一条消息让模型调一次 eval、等它跑完”的辅助。只由 e2e 使用。
 *
 * 与 `page-agent.e2e.ts` 里同名的辅助各写一份：那份属于第一段的测试文件，Playwright 不许测试文件互相导入。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "../fixtures";
import type {ProcessHandle, ProductServer} from "../fixtures";

export interface SeenMessage {
    readonly role: string;
    readonly content?: unknown;
}

export interface AgentWorld {
    readonly server: ProductServer;
    readonly stateRoot: string;
}

export interface StartWorldOptions {
    /** 用户层规则放行 eval：用例里没有审批点击；缺省为询问模式。 */
    readonly allowEval?: boolean;
    /** 在写设置文件之前改设置的内容（例如给 Profile 绑定）。 */
    readonly tweak?: (settings: Record<string, unknown>) => void;
}

export interface AgentLab {
    readonly tmp: string;
    readonly worlds: AgentWorld[];
    control(path: string, body?: unknown): Promise<unknown>;
    script(...replies: unknown[]): Promise<unknown>;
    requests(): Promise<{messages: SeenMessage[]; tools: string[]; descriptions: Record<string, string>; system: string}[]>;
    startWorld(name: string, options?: StartWorldOptions): Promise<AgentWorld>;
    /** 停掉各后端与模型端点，删掉临时根；各后端须有序退出（退出码 0）。 */
    stop(): Promise<void>;
}

/** 作者界面在默认 1280 宽时编辑区太窄、页面落到窄版：e2e 的视口设 1440 以上。 */
export const WIDTH = 1440;
export const HEIGHT = 900;

export async function startLab(name: string): Promise<AgentLab> {
    const tmp = await createTestTmpRoot("neuro-book-e2e", name);
    const bookId = randomUUID();
    const otherId = randomUUID();
    for (const [dir, id] of [["Book", bookId], ["Other", otherId]] as const) {
        await mkdir(join(tmp, dir, ".nbook"), {recursive: true});
        await writeFile(join(tmp, dir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    }
    await mkdir(join(tmp, "Book", "正文"), {recursive: true});
    await writeFile(join(tmp, "Book", "正文/第三章.md"), "雨越下越大。\n他没有回头。\n");
    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle: ProcessHandle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    const worlds: AgentWorld[] = [];
    const control = async (path: string, body?: unknown): Promise<unknown> => {
        const response = await fetch(`${controlUrl!}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
        return response.json();
    };
    return {
        tmp,
        worlds,
        control,
        script: (...replies) => control("/script", replies),
        requests: async () => await control("/requests") as never,
        async startWorld(worldName, options = {}) {
            const stateRoot = join(tmp, `state-${worldName}`);
            await mkdir(join(stateRoot, "user"), {recursive: true});
            const settings = localModelSettings(baseUrl!) as Record<string, unknown>;
            (settings["nbook.models/providers"] as {models: {vision?: boolean}[]}[])[0]!.models[0]!.vision = true;
            if (options.allowEval === true) settings["nbook.agent/permissionRules"] = [{tool: "nbook.agent.eval", action: "allow"}];
            options.tweak?.(settings);
            await writeFile(join(stateRoot, "settings.json"), JSON.stringify(settings));
            await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id: bookId, name: "book", path: join(tmp, "Book")}, {id: otherId, name: "other", path: join(tmp, "Other")}]}));
            const world = {server: await startProductServer(stateRoot), stateRoot};
            worlds.push(world);
            return world;
        },
        async stop() {
            for (const world of worlds) expect(await world.server.stop()).toBe(0);
            child.stdin.end();
            await handle.exit;
            await rm(tmp, {recursive: true, force: true});
        },
    };
}

// ---------- 页面与会话 ----------

export const composer = (page: Page): Locator => page.getByRole("textbox", {name: "消息输入框"});

/** 打开作品，经命令面板把对话带到前面。 */
export async function openConversation(page: Page, world: AgentWorld): Promise<void> {
    await page.goto(new URL("/?project=book", world.server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await expect(composer(page)).toBeVisible();
}

export async function newSession(page: Page): Promise<void> {
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("新建 Agent 会话");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-agent-welcome]")).toBeVisible();
}

export async function send(page: Page, text: string): Promise<void> {
    await composer(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
}

/** 模型最近一次请求里最后一条工具结果的文字：eval 交回的输出。 */
export async function lastToolText(lab: AgentLab): Promise<string> {
    const messages = (await lab.requests()).at(-1)!.messages;
    const tool = messages.findLast((message) => message.role === "tool");
    if (tool === undefined) throw new Error("最近一次请求里没有工具结果");
    return typeof tool.content === "string" ? tool.content : JSON.stringify(tool.content);
}

export interface RunningEval {
    /** 等模型收到 eval 的结果（eval 已结束），交回 eval 的输出。 */
    result(): Promise<string>;
}

export interface StartEvalOptions {
    /** eval 的单元时限（秒）。 */
    readonly timeout?: number;
    /** 询问模式：批准 eval 的审批卡。规则放行的后端不要给。 */
    readonly approve?: boolean;
}

/**
 * 发一条消息让模型调一次 eval，批准 eval 之后立刻交回：`ui.highlight` 会一直等用户，用例要在 eval 跑着时操作页面。
 * 回复文字与发的消息不同，免得页面上用户气泡里的同一句话让“回复出现”提前成立。
 */
export async function startEval(page: Page, lab: AgentLab, label: string, code: string, options: StartEvalOptions = {}): Promise<RunningEval> {
    const reply = `${label}：已处理`;
    const before = (await lab.requests()).length;
    await lab.script({tool: "eval", args: {title: label, code, ...(options.timeout === undefined ? {} : {timeout: options.timeout})}}, reply);
    await send(page, label);
    if (options.approve === true) {
        const wizard = page.locator("[data-agent-wizard]");
        await expect(wizard.locator(".acv-wizard-frame__title")).toHaveText("调用工具 eval");
        await wizard.locator("[data-approval-decision='allow']").click();
    }
    return {
        async result() {
            // eval 结束后模型带着工具结果再发一条请求，它的最后一条消息是 eval 的结果。别的会话（例如自动起的标题）也会发请求，
            // 所以不数请求条数，认“这次发送之后第一条以工具结果结尾的请求”；按请求认也不怕页面刷新、会话换了。
            let text = "";
            await expect.poll(async () => {
                const request = (await lab.requests()).slice(before).find((item) => item.messages.at(-1)?.role === "tool");
                if (request === undefined) return false;
                const content = request.messages.at(-1)!.content;
                text = typeof content === "string" ? content : JSON.stringify(content);
                return true;
            }, {message: `${label}：模型收到 eval 的结果`, timeout: 60_000}).toBe(true);
            return text;
        },
    };
}

// ---------- 说明框 ----------

/** 说明框的某个部件（在引擎的 open shadow root 里，Playwright 的 CSS 定位器能穿进去）。 */
export const guidePart = (page: Page, name: string): Locator => page.locator(`[data-nb-page-agent="${name}"]`);

/** 页面上一个引擎节点都没有：高亮撤干净了。 */
export async function expectGuideRemoved(page: Page): Promise<void> {
    await expect.poll(() => page.evaluate(() => document.querySelectorAll("[data-nb-page-agent]").length)).toBe(0);
    expect(await page.evaluate(() => document.querySelectorAll("[data-nb-agent-reveal]").length)).toBe(0);
}
