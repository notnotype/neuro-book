/**
 * 设置窗口的插件页（同名 .md）。远程合同的客户端是按合同类型写的内存替身：页面的行为只取决于合同的输入输出，
 * 服务端的实现与经内核的往返由 `../../plugins.test.ts` 与 `src/plugin-platform/backend/plugins.test.ts` 覆盖（真实实现用
 * Bun 的 API，进不了 Vitest）。替身的写方法可以先挂起、再由用例结算，用来看进行中的界面。
 */

import {flushPromises, mount} from "@vue/test-utils";
import type {VueWrapper} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {InstallPreview, PluginListEntry, PluginListItem, PluginProblem, PluginsRegistry} from "../../shared/contracts";
import type {FolderUploadClient, UploadOutcome} from "../folder-upload";
import {pluginsCatalogs} from "../text";
import PluginsPage from "./PluginsPage.vue";

const mounted: VueWrapper[] = [];

afterEach(() => {
    // 先卸载：打开着的对话框在全应用一份的模态列表里，只清 DOM 会留到下一条用例。
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
});

type Registry = PluginsRegistry;
type Outcome = {readonly ok: true; readonly value: unknown} | {readonly ok: false; readonly code: string; readonly detail?: unknown};

/** 列表才有的字段：显示名、说明与问题；写操作的结果没有它们。 */
const LISTED: Pick<PluginListEntry, "displayName" | "description" | "problems"> = {displayName: null, description: null, problems: []};
const BUILTIN: PluginListEntry = {id: "nbook.settings", version: "0.1.0", source: "builtin", state: "enabled", pending: [], notLoaded: null, ...LISTED};
const HELLO: PluginListEntry = {id: "example.hello", version: "1.0.0", source: "third-party", state: "enabled", pending: [], notLoaded: null, ...LISTED};

interface Fake {
    readonly client: Registry;
    readonly calls: string[];
    /** 让下一次 `list` 返回这个结果（之后恢复正常）。 */
    failNextList(outcome: Outcome): void;
    /** 让下一次写操作挂起，返回结算它的函数。 */
    holdNext(): () => void;
    /** 下一次 `inspect` 或 `install` 返回这个结果。 */
    answerNext(outcome: Outcome): void;
    /** 让下一次 `list` 挂起，永不结算。 */
    hangNextList(): void;
}

function registry(initial: PluginListEntry[], options: {readonly safeMode?: boolean; readonly preview?: InstallPreview} = {}): Fake {
    let plugins = [...initial];
    const calls: string[] = [];
    let nextList: Outcome | null = null;
    let hangList = false;
    let nextAnswer: Outcome | null = null;
    let hold: Promise<void> | null = null;
    // 像服务端一样：表里存列表的条目，写操作返回不带列表字段的那一部分。
    const set = (item: PluginListItem): PluginListItem => {
        const listed: PluginListEntry = {...LISTED, ...plugins.find((plugin) => plugin.id === item.id), ...item};
        plugins = plugins.some((plugin) => plugin.id === item.id) ? plugins.map((plugin) => (plugin.id === item.id ? listed : plugin)) : [...plugins, listed];
        return item;
    };
    const find = (id: string): PluginListItem => plugins.find((plugin) => plugin.id === id)!;
    const write = async <T>(name: string, run: () => T): Promise<T | Outcome> => {
        calls.push(name);
        if (hold !== null) {
            const waiting = hold;
            hold = null;
            await waiting;
        }
        if (nextAnswer !== null) {
            const answer = nextAnswer;
            nextAnswer = null;
            return answer;
        }
        return run();
    };
    const client = {
        list: async () => {
            calls.push("list");
            if (hangList) {
                hangList = false;
                return new Promise<never>(() => undefined);
            }
            if (nextList !== null) {
                const outcome = nextList;
                nextList = null;
                return outcome;
            }
            return {ok: true as const, value: {safeMode: options.safeMode ?? false, plugins}};
        },
        inspect: ({path, upload}: {path?: string; upload?: string}) => write(`inspect ${path ?? `upload:${String(upload)}`}`, () => ({ok: true as const, value: options.preview ?? {id: "example.new", version: "1.0.0", installed: null, relation: "install" as const, blocked: [], unchecked: []}})),
        install: ({path, upload}: {path?: string; upload?: string}) => write(`install ${path ?? `upload:${String(upload)}`}`, () => ({ok: true as const, value: {plugin: set({id: "example.new", version: "1.0.0", source: "third-party", state: "enabled", pending: [{kind: "install"}], notLoaded: null})}})),
        enable: ({id}: {id: string}) => write(`enable ${id}`, () => ({ok: true as const, value: {plugin: set({...find(id), state: "enabled", pending: []})}})),
        disable: ({id}: {id: string}) => write(`disable ${id}`, () => ({ok: true as const, value: {plugin: set({...find(id), state: "disabled", pending: [{kind: "disable"}]})}})),
        uninstall: ({id}: {id: string}) => write(`uninstall ${id}`, () => ({ok: true as const, value: {plugin: set({...find(id), state: "uninstalling", pending: [{kind: "uninstall"}]})}})),
    };
    return {
        client: client as unknown as Registry,
        calls,
        failNextList: (outcome) => {
            nextList = outcome;
        },
        holdNext: () => {
            const {promise, resolve} = Promise.withResolvers<void>();
            hold = promise;
            return () => resolve();
        },
        answerNext: (outcome) => {
            nextAnswer = outcome;
        },
        hangNextList: () => {
            hangList = true;
        },
    };
}

async function open(client: Registry, locale: "zh-CN" | "en-US" = "zh-CN", windowPlugins: {problems(): ReadonlyArray<PluginProblem>; onChange(listener: () => void): () => void} | null = null, folderUpload: FolderUploadClient | null = null) {
    // 页面的文字来自窗口的翻译端口：用宿主引擎登记本插件的目录，语言与 `locale` 属性同一个来源。
    const port = testTextPort(locale, {"nbook.plugins": pluginsCatalogs});
    const wrapper = mount(PluginsPage, {props: {registry: client, locale, windowPlugins, folderUpload}, attachTo: document.body, global: {provide: provideText(port)}});
    mounted.push(wrapper);
    await flushPromises();
    return wrapper;
}

/** 路径输入框：`data-plugin-path` 落在 `Input` 的根上，根可能就是 input。 */
function pathInput(wrapper: Awaited<ReturnType<typeof open>>) {
    const root = wrapper.find("[data-plugin-path]");
    return root.element.tagName === "INPUT" ? root : root.find("input");
}

function row(id: string): HTMLElement {
    return document.querySelector(`[data-plugin-row="${id}"]`) as HTMLElement;
}

function click(selector: string): void {
    (document.querySelector(selector) as HTMLElement).click();
}

function dialogButton(label: string): HTMLButtonElement {
    return [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find((button) => button.textContent?.trim() === label)!;
}

function disabled(element: Element | null): boolean {
    return element?.hasAttribute("disabled") === true;
}

async function submitPath(wrapper: Awaited<ReturnType<typeof open>>, value: string): Promise<void> {
    await pathInput(wrapper).setValue(value);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
}

describe("PluginsPage", () => {
    it("第三方插件在前、内置插件标“内置”且没有操作；待生效变化与没有登记的原因显示在行上", async () => {
        const fake = registry([
            BUILTIN,
            {...HELLO, pending: [{kind: "upgrade", version: "2.0.0"}]},
            {...HELLO, id: "example.old", notLoaded: {code: "incompatible-engine", detail: "要求 NeuroBook >=2.0.0，当前是 0.1.0"}},
            {...HELLO, id: "example.gutted", notLoaded: {code: "entry-missing", detail: "入口文件不存在：dist/browser.js"}},
            {...HELLO, id: "example.locked", notLoaded: {code: "unreadable", detail: "EACCES"}},
        ]);
        await open(fake.client);
        const groups = [...document.querySelectorAll("[data-plugin-group]")].map((group) => group.getAttribute("data-plugin-group"));
        expect(groups).toEqual(["third-party", "builtin"]);
        expect(row("nbook.settings").textContent).toContain("内置");
        expect(row("nbook.settings").querySelector("[data-plugin-toggle]")).toBeNull();
        expect(row("nbook.settings").querySelector("[data-plugin-uninstall]")).toBeNull();
        expect(row("example.hello").querySelector("[data-plugin-pending=upgrade]")?.textContent).toContain("重启后升级到 2.0.0");
        expect(row("example.old").querySelector("[data-plugin-not-loaded=incompatible-engine]")?.textContent).toContain("不兼容");
        expect(row("example.old").textContent).toContain("要求 NeuroBook >=2.0.0");
        expect(row("example.gutted").querySelector("[data-plugin-not-loaded=entry-missing]")?.textContent).toContain("入口文件缺失");
        expect(row("example.gutted").textContent).toContain("入口文件不存在：dist/browser.js");
        expect(row("example.locked").querySelector("[data-plugin-not-loaded=unreadable]")?.textContent).toContain("安装目录读不了");
        expect(row("example.locked").textContent).toContain("EACCES");
        expect(row("example.hello").querySelector("[data-plugin-uninstall]")?.getAttribute("aria-label")).toBe("卸载 example.hello");
        expect(document.querySelector("[data-plugins-restart]")?.textContent).toContain("重启 NeuroBook 后生效");
    });

    it("显示名跟在 id 后面、说明在下一行；服务端与本窗口的问题按种类计数、逐条写出原因，本窗口的随变化通知更新；换到更低的版本写“降级”", async () => {
        const failed: PluginProblem = {kind: "entry-failed", plugin: "example.goal", entry: "server", location: "server", stage: "activate", reason: "activation-threw", message: "local 记录需要客户端身份"};
        const rejected: PluginProblem = {kind: "contribution-rejected", plugin: "example.goal", entry: "browser", location: "browser", capability: "workbench.views", id: "other.goal", reason: "invalid-declaration", detail: "前缀不对"};
        const blocked: PluginProblem = {kind: "entry-blocked", plugin: "example.goal", entry: "browser", location: "browser", reason: "missing-service", key: "example.goal/progress"};
        let windowProblems: ReadonlyArray<PluginProblem> = [rejected];
        let notify: () => void = () => undefined;
        const fake = registry([
            BUILTIN,
            {...HELLO, id: "example.goal", displayName: "Daily Goal", description: "每天写多少字", problems: [failed]},
            {...HELLO, pending: [{kind: "upgrade", version: "0.9.0"}]},
        ]);
        await open(fake.client, "zh-CN", {problems: () => windowProblems, onChange: (listener) => {
            notify = listener;
            return () => undefined;
        }});
        const goal = row("example.goal");
        expect(goal.querySelector("[data-plugin-display-name]")?.textContent).toBe("Daily Goal");
        expect(goal.querySelector("[data-plugin-description]")?.textContent).toBe("每天写多少字");
        expect(goal.querySelector("[data-plugin-problems=entries]")?.textContent).toContain("1 个入口没有运行");
        expect(goal.querySelector("[data-plugin-problems=contributions]")?.textContent).toContain("1 项贡献被拒");
        const lines = () => [...goal.querySelectorAll("[data-plugin-problem-line]")].map((line) => line.textContent);
        expect(lines()).toEqual(["入口 server（server）激活失败：local 记录需要客户端身份", "workbench.views 的 other.goal 被拒：声明不合规则（前缀不对）"]);
        expect(document.querySelector("[data-plugins-snapshot]")).not.toBeNull();
        // 内置插件没有清单：名称与说明取页面这侧的名称表，按界面语言；没有问题的行不占位。
        expect(row("nbook.settings").querySelector("[data-plugin-display-name]")?.textContent).toBe("设置");
        expect(row("nbook.settings").querySelector("[data-plugin-description]")?.textContent).toBe("设置窗口与设置项的读写。");
        expect(row("example.hello").querySelector("[data-plugin-problems]")).toBeNull();
        expect(row("example.hello").querySelector("[data-plugin-pending=upgrade]")?.textContent).toContain("重启后降级到 0.9.0");

        windowProblems = [blocked];
        notify();
        await flushPromises();
        expect(lines()).toEqual(["入口 server（server）激活失败：local 记录需要客户端身份", "入口 browser（browser）受阻：需要的服务 example.goal/progress 没有提供"]);
        expect(goal.querySelector("[data-plugin-problems=entries]")?.textContent).toContain("2 个入口没有运行");
        expect(goal.querySelector("[data-plugin-problems=contributions]")).toBeNull();

        // 本窗口没取到的消息目录：另一种徽标，不算进入口问题。
        windowProblems = [blocked, {kind: "catalog-unavailable", plugin: "example.goal", location: "browser", locale: "en-US", reason: "invalid", detail: "menu.open：值必须是字符串或嵌套的对象，这里是number"}];
        notify();
        await flushPromises();
        expect(goal.querySelector("[data-plugin-problems=entries]")?.textContent).toContain("2 个入口没有运行");
        expect(goal.querySelector("[data-plugin-problems=catalogs]")?.textContent).toContain("1 种语言的文字没有取到");
        expect(lines().at(-1)).toBe("en-US 的文字没有取到：目录内容不合规则（menu.open：值必须是字符串或嵌套的对象，这里是number）");
    });

    it("英文界面里内置插件的名称与说明是英文；名称表里没有的内置插件只显示 id", async () => {
        await open(registry([BUILTIN, {...BUILTIN, id: "nbook.unknown"}]).client, "en-US");
        expect(row("nbook.settings").querySelector("[data-plugin-display-name]")?.textContent).toBe("Settings");
        expect(row("nbook.settings").querySelector("[data-plugin-description]")?.textContent).toBe("The settings window and setting values.");
        expect(row("nbook.unknown").querySelector("[data-plugin-display-name]")).toBeNull();
        expect(row("nbook.unknown").querySelector("[data-plugin-description]")).toBeNull();
    });

    it("顶层声明被拒时服务端与本窗口各有一条，合成一条显示；没有问题时不显示快照说明；卸载后不再听本窗口的变化", async () => {
        const top = (location: string): PluginProblem => ({kind: "contribution-rejected", plugin: "example.goal", entry: null, location, capability: "settings.sections", id: "other.main", reason: "invalid-declaration", detail: "前缀不对"});
        let windowProblems: ReadonlyArray<PluginProblem> = [];
        let listening = 0;
        const windowPlugins = {problems: () => windowProblems, onChange: () => {
            listening += 1;
            return () => void (listening -= 1);
        }};
        const quiet = await open(registry([BUILTIN, {...HELLO, id: "example.goal"}]).client, "zh-CN", windowPlugins);
        expect(document.querySelector("[data-plugins-snapshot]")).toBeNull();
        quiet.unmount();
        mounted.splice(mounted.indexOf(quiet), 1);
        expect(listening).toBe(0);

        windowProblems = [top("browser")];
        await open(registry([BUILTIN, {...HELLO, id: "example.goal", problems: [top("server")]}]).client, "zh-CN", windowPlugins);
        expect([...row("example.goal").querySelectorAll("[data-plugin-problem-line]")]).toHaveLength(1);
        expect(row("example.goal").querySelector("[data-plugin-problems=contributions]")?.textContent).toContain("1 项贡献被拒");
    });

    it("安装先预览：确认框写明首次安装与完全信任；取消不安装；确认后清空输入框、列表出现“重启后安装”", async () => {
        const fake = registry([BUILTIN]);
        const wrapper = await open(fake.client);
        expect(document.querySelector("[data-plugins-restart]")?.textContent).toContain("下一次启动后生效");
        await submitPath(wrapper, "/plugins/new");
        expect(fake.calls).toContain("inspect /plugins/new");
        const dialog = document.querySelector("[role=dialog]");
        expect(dialog?.textContent).toContain("安装插件");
        expect(dialog?.textContent).toContain("example.new 1.0.0");
        expect(dialog?.textContent).toContain("可以访问全部作品、服务器与本机资源");
        dialogButton("取消").click();
        await flushPromises();
        expect(document.querySelector("[role=dialog]")).toBeNull();
        expect(fake.calls.some((call) => call.startsWith("install"))).toBe(false);

        await wrapper.find("form").trigger("submit");
        await flushPromises();
        click("[data-plugin-install-confirm]");
        await flushPromises();
        expect(fake.calls).toContain("install /plugins/new");
        expect(row("example.new").querySelector("[data-plugin-pending=install]")?.textContent).toContain("重启后安装");
        expect((pathInput(wrapper).element as HTMLInputElement).value).toBe("");
    });

    it("路径为空时只把焦点放进输入框，不预览", async () => {
        const fake = registry([BUILTIN]);
        const wrapper = await open(fake.client);
        await submitPath(wrapper, "  ");
        expect(fake.calls.some((call) => call.startsWith("inspect"))).toBe(false);
        expect(document.activeElement).toBe(pathInput(wrapper).element);
    });

    it("安装进行中：确认按钮显示进行中，Esc 与“取消”关不掉对话框；结算后关闭", async () => {
        const fake = registry([BUILTIN]);
        const wrapper = await open(fake.client);
        await submitPath(wrapper, "/plugins/new");
        const settle = fake.holdNext();
        click("[data-plugin-install-confirm]");
        await flushPromises();
        expect(document.querySelector("[data-plugin-install-confirm]")?.getAttribute("aria-busy")).toBe("true");
        expect(disabled(dialogButton("取消"))).toBe(true);
        document.querySelector("[role=dialog]")!.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
        await flushPromises();
        expect(document.querySelector("[role=dialog]")).not.toBeNull();
        settle();
        await flushPromises();
        expect(document.querySelector("[role=dialog]")).toBeNull();
        expect(row("example.new")).not.toBeNull();
    });

    it("降级的确认框写出版本变化与数据提示", async () => {
        const fake = registry([BUILTIN, HELLO], {preview: {id: "example.hello", version: "0.9.0", installed: "1.0.0", relation: "downgrade", blocked: [], unchecked: []}});
        const wrapper = await open(fake.client);
        await submitPath(wrapper, "/plugins/old");
        const dialog = document.querySelector("[role=dialog]");
        expect(dialog?.textContent).toContain("降级插件");
        expect(dialog?.textContent).toContain("example.hello 1.0.0 → 0.9.0");
        expect(dialog?.textContent).toContain("新版本已迁移过的数据");
    });

    it("升级的确认框列出重启后会受阻的插件与要求的范围，确认照常可点；读不了清单的插件写明没有核对", async () => {
        const fake = registry([BUILTIN, HELLO], {preview: {
            id: "example.hello",
            version: "2.0.0",
            installed: "1.0.0",
            relation: "upgrade",
            blocked: [{plugin: "example.panel", entries: ["main"], reason: "provider-blocked"}, {plugin: "example.reader", entries: ["main", "ui"], reason: "version-mismatch", range: "^1.0.0"}],
            unchecked: ["example.broken"],
        }});
        const wrapper = await open(fake.client);
        await submitPath(wrapper, "/plugins/new");
        const items = [...document.querySelectorAll("[data-plugin-preview-blocked-item]")].map((item) => item.textContent);
        expect(items).toEqual(["example.panel（main）：依赖的插件不可用", "example.reader（main和ui）：要求版本 ^1.0.0"]);
        expect(document.querySelector("[data-plugin-preview-unchecked]")?.textContent).toContain("example.broken");
        expect((document.querySelector("[data-plugin-install-confirm]") as HTMLButtonElement | null)?.disabled).toBe(false);
    });

    it("英文界面：文字取英文目录，数量徽标按英文的复数形取，列表按英文连接", async () => {
        const failed: PluginProblem = {kind: "entry-failed", plugin: "example.hello", entry: "server", location: "server", stage: "activate", reason: "activation-threw", message: "boom"};
        const fake = registry([BUILTIN, {...HELLO, problems: [failed]}], {preview: {
            id: "example.hello",
            version: "2.0.0",
            installed: "1.0.0",
            relation: "upgrade",
            blocked: [{plugin: "example.reader", entries: ["main", "ui"], reason: "version-mismatch", range: "^1.0.0"}],
            unchecked: [],
        }});
        const wrapper = await open(fake.client, "en-US");
        expect(row("nbook.settings").textContent).toContain("Built-in");
        expect(row("example.hello").querySelector("[data-plugin-problems=entries]")?.textContent).toContain("1 entry point not running");
        expect([...row("example.hello").querySelectorAll("[data-plugin-problem-line]")].map((line) => line.textContent)).toEqual(["Entry server (server) failed to activate: boom"]);
        await submitPath(wrapper, "/plugins/new");
        expect(document.querySelector("[role=dialog]")?.textContent).toContain("Upgrade plugin");
        expect([...document.querySelectorAll("[data-plugin-preview-blocked-item]")].map((item) => item.textContent)).toEqual(["example.reader (main and ui): requires version ^1.0.0"]);
    });

    it("失败按码显示：清单无效带出错字段；只说原因的码不重复详情；不认识的码给通用文字与路由层的说明", async () => {
        const fake = registry([BUILTIN]);
        const wrapper = await open(fake.client);
        fake.answerNext({ok: false, code: "manifest-invalid", detail: {detail: "清单有错误：name：必须是单个小写 id 段", problems: ["name：必须是单个小写 id 段"]}});
        await submitPath(wrapper, "/plugins/broken");
        let problem = document.querySelector("[data-plugin-problem]");
        expect(problem?.getAttribute("data-plugin-problem")).toBe("manifest-invalid");
        expect(problem?.textContent).toContain("插件的清单无效");
        // 出错字段本身就是原因，服务端那句不再重复。
        expect([...problem!.querySelectorAll("p")].map((line) => line.textContent)).toEqual(["插件的清单无效", "name：必须是单个小写 id 段"]);
        const first = problem!.querySelector("p");

        fake.answerNext({ok: false, code: "manifest-invalid", detail: {detail: "清单有错误：name：必须是单个小写 id 段", problems: ["name：必须是单个小写 id 段"]}});
        await submitPath(wrapper, "/plugins/broken");
        // 同一个失败再来一次：文字换成新节点，读屏会再播报一次。
        expect(document.querySelector("[data-plugin-problem] p")).not.toBe(first);
        expect(document.querySelector("[role=dialog]")).toBeNull();

        fake.answerNext({ok: false, code: "catalog-invalid", detail: {detail: "消息目录有错误：locales/en-US.json：title：……", problems: ["locales/en-US.json：title：值必须是字符串或嵌套的对象，这里是number"]}});
        await submitPath(wrapper, "/plugins/catalogs");
        problem = document.querySelector("[data-plugin-problem]");
        expect(problem?.getAttribute("data-plugin-problem")).toBe("catalog-invalid");
        expect([...problem!.querySelectorAll("p")].map((line) => line.textContent)).toEqual(["插件的消息目录无效", "locales/en-US.json：title：值必须是字符串或嵌套的对象，这里是number"]);

        // 不带详情的码只显示码的文字一次（详情不重复一遍）。
        fake.answerNext({ok: false, code: "already-installed", detail: {detail: "example.hello@1.0.0 已安装或等待重启后切换"}});
        await submitPath(wrapper, "/plugins/again");
        problem = document.querySelector("[data-plugin-problem]");
        expect(problem?.textContent?.match(/已经安装/gu)).toHaveLength(1);

        // 路由层的码用宿主的文案，服务端详情是诊断原文，不列。
        fake.answerNext({ok: false, code: "denied", detail: "调用方没有权限"});
        await submitPath(wrapper, "/plugins/denied");
        problem = document.querySelector("[data-plugin-problem]");
        expect([...problem!.querySelectorAll("p")].map((line) => line.textContent)).toEqual(["没有权限执行这个操作"]);

        // 不认识的码（服务端比页面新）：宿主的中性文案附上码，列出服务端详情。
        fake.answerNext({ok: false, code: "quota-reached", detail: "too many plugins"} as unknown as Parameters<typeof fake.answerNext>[0]);
        await submitPath(wrapper, "/plugins/quota");
        problem = document.querySelector("[data-plugin-problem]");
        expect([...problem!.querySelectorAll("p")].map((line) => line.textContent)).toEqual(["收到了无法识别的结果（quota-reached）", "too many plugins"]);
    });

    it("结果未知：写出原因并重新读列表", async () => {
        const fake = registry([BUILTIN, HELLO]);
        const wrapper = await open(fake.client);
        const before = fake.calls.filter((call) => call === "list").length;
        fake.answerNext({ok: false, code: "unknown-outcome"});
        await wrapper.find("[data-plugin-row=\"example.hello\"] [data-plugin-toggle]").trigger("click");
        await flushPromises();
        expect(document.querySelector("[data-plugin-problem]")?.textContent).toContain("不知道操作有没有完成");
        expect(fake.calls.filter((call) => call === "list").length).toBe(before + 1);
    });

    it("进行中：正在操作的开关保持可用，别的写控件停用、不发起第二个写操作；结算后恢复", async () => {
        const fake = registry([BUILTIN, HELLO, {...HELLO, id: "example.other"}]);
        const wrapper = await open(fake.client);
        const settle = fake.holdNext();
        await wrapper.find("[data-plugin-row=\"example.hello\"] [data-plugin-toggle]").trigger("click");
        await flushPromises();
        expect(disabled(row("example.hello").querySelector("[data-plugin-toggle]"))).toBe(false);
        expect(disabled(row("example.other").querySelector("[data-plugin-toggle]"))).toBe(true);
        expect(disabled(row("example.other").querySelector("[data-plugin-uninstall]"))).toBe(true);
        await wrapper.find("[data-plugin-row=\"example.hello\"] [data-plugin-toggle]").trigger("click");
        expect(fake.calls.filter((call) => call.startsWith("disable") || call.startsWith("enable"))).toEqual(["disable example.hello"]);
        settle();
        await flushPromises();
        expect(row("example.hello").querySelector("[data-plugin-pending=disable]")).not.toBeNull();
        expect(disabled(row("example.other").querySelector("[data-plugin-toggle]"))).toBe(false);
    });

    it("卸载：确认框说明不能撤回，确认按钮是危险操作；之后只剩“重启后卸载”，焦点到第三方插件的小标题", async () => {
        const fake = registry([BUILTIN, HELLO]);
        await open(fake.client);
        click("[data-plugin-row=\"example.hello\"] [data-plugin-uninstall]");
        await flushPromises();
        expect(document.querySelector("[role=dialog]")?.textContent).toContain("重启之前不能撤回");
        expect(document.querySelector("[data-plugin-uninstall-confirm]")?.className).toContain("status-danger");
        click("[data-plugin-uninstall-confirm]");
        await flushPromises();
        expect(row("example.hello").querySelector("[data-plugin-pending=uninstall]")).not.toBeNull();
        expect(row("example.hello").querySelector("[data-plugin-toggle]")).toBeNull();
        expect(row("example.hello").querySelector("[data-plugin-uninstall]")).toBeNull();
        expect(document.activeElement?.textContent).toBe("第三方插件");
    });

    it("卸载失败、重读的列表里这一行已在卸载中：焦点同样到第三方插件的小标题，不落到 body", async () => {
        const fake = registry([BUILTIN, HELLO]);
        await open(fake.client);
        const button = row("example.hello").querySelector<HTMLElement>("[data-plugin-uninstall]")!;
        button.focus();
        button.click();
        await flushPromises();
        fake.answerNext({ok: false, code: "uninstall-pending"});
        fake.failNextList({ok: true, value: {safeMode: false, plugins: [BUILTIN, {...HELLO, state: "uninstalling", pending: [{kind: "uninstall"}]}]}});
        click("[data-plugin-uninstall-confirm]");
        await flushPromises();
        expect(document.querySelector("[data-plugin-problem]")?.getAttribute("data-plugin-problem")).toBe("uninstall-pending");
        expect(row("example.hello").querySelector("[data-plugin-uninstall]")).toBeNull();
        expect(document.activeElement?.textContent).toBe("第三方插件");
    });

    it("读取列表失败：原位显示原因与重试，不画两组；重试成功后显示列表", async () => {
        const fake = registry([BUILTIN]);
        fake.failNextList({ok: false, code: "registry-failed", detail: {detail: "插件登记表不是合法 JSON"}});
        const wrapper = await open(fake.client);
        expect(wrapper.find("[data-plugins-page]").attributes("data-plugins-state")).toBe("failed");
        expect(document.querySelector("[data-plugin-group]")).toBeNull();
        expect(document.querySelector("[data-plugins-load-failure]")?.textContent).toContain("插件登记表不是合法 JSON");
        // 再失败一次：焦点到新的“重试”；成功后到第三方插件的小标题。
        fake.failNextList({ok: false, code: "registry-failed", detail: {detail: "插件登记表不是合法 JSON"}});
        click("[data-plugins-retry]");
        await flushPromises();
        expect(document.activeElement?.hasAttribute("data-plugins-retry")).toBe(true);
        click("[data-plugins-retry]");
        await flushPromises();
        expect(wrapper.find("[data-plugins-page]").attributes("data-plugins-state")).toBe("ready");
        expect(row("nbook.settings")).not.toBeNull();
        expect(document.activeElement?.textContent).toBe("第三方插件");
    });

    it("读取中：根标 loading，加载区域 aria-busy，带名称的进行中指示", async () => {
        const fake = registry([BUILTIN]);
        fake.hangNextList();
        const wrapper = await open(fake.client);
        expect(wrapper.find("[data-plugins-page]").attributes("data-plugins-state")).toBe("loading");
        expect(document.querySelector("[aria-busy=true] [role=status]")?.getAttribute("aria-label")).toBe("正在读取插件…");
    });

    it("安全模式下显示安全模式横幅，第三方插件标中性的“安全模式未加载”", async () => {
        const fake = registry([BUILTIN, {...HELLO, notLoaded: {code: "safe-mode", detail: "安全模式下不加载第三方插件"}}], {safeMode: true});
        await open(fake.client);
        expect(document.querySelector("[data-plugins-safe-mode]")?.textContent).toContain("安全模式");
        expect(row("example.hello").querySelector("[data-plugin-not-loaded=safe-mode]")?.classList.contains("nb-badge--neutral")).toBe(true);
        expect(row("example.hello").textContent).not.toContain("安全模式下不加载第三方插件");
    });
});


/** 拖入、选出的文件夹（plugin-install 输出 11）：上传客户端是替身，记下调用；文件夹是按 `FileSystemDirectoryEntry` 真实形状写的替身。 */
describe("PluginsPage 的文件夹上传", () => {
    const UPLOAD_ID = "00000000-0000-4000-8000-000000000001";

    interface FakeUpload {
        readonly client: FolderUploadClient;
        readonly calls: string[];
        /** 下一次上传的结果。 */
        answerNext(outcome: UploadOutcome): void;
        /** 让下一次上传挂起，返回结算它的函数。 */
        holdNext(): () => void;
    }

    function uploader(): FakeUpload {
        const calls: string[] = [];
        let next: UploadOutcome | null = null;
        let hold: Promise<void> | null = null;
        return {
            calls,
            answerNext: (outcome) => {
                next = outcome;
            },
            holdNext: () => {
                const {promise, resolve} = Promise.withResolvers<void>();
                hold = promise;
                return () => resolve();
            },
            client: {
                upload: async (folder) => {
                    calls.push(`upload ${folder.name} ${folder.files.map((file) => file.path).join(",")}`);
                    if (hold !== null) {
                        const waiting = hold;
                        hold = null;
                        await waiting;
                    }
                    const answer = next;
                    next = null;
                    return answer ?? {ok: true as const, id: UPLOAD_ID, files: folder.files.length, bytes: folder.bytes};
                },
                discard: (id, options) => {
                    calls.push(`discard ${id}${options?.keepalive === true ? " keepalive" : ""}`);
                    return Promise.resolve();
                },
            },
        };
    }

    type Tree = {readonly [name: string]: string | Tree};
    const fileEntry = (name: string, content: string) => ({isFile: true, isDirectory: false, name, file: (success: (file: File) => void) => success(new File([content], name))});
    function directory(name: string, tree: Tree): unknown {
        const children = Object.entries(tree).map(([child, value]) => (typeof value === "string" ? fileEntry(child, value) : directory(child, value)));
        return {
            isFile: false,
            isDirectory: true,
            name,
            createReader: () => {
                let done = false;
                return {readEntries: (success: (entries: unknown[]) => void) => (done ? success([]) : ((done = true), success(children)))};
            },
        };
    }

    /** 在这个元素上派发一个拖放事件，`dataTransfer` 是替身；交回事件，用来看有没有被 `preventDefault`。 */
    function drag(target: Element | Window, type: string, entries: unknown[] = [], types: string[] = ["Files"], related: EventTarget | null = null): Event {
        const event = Object.assign(new Event(type, {bubbles: true, cancelable: true}), {
            dataTransfer: {types, dropEffect: "none", items: entries.map((entry) => ({kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => null}))},
            relatedTarget: related,
        });
        target.dispatchEvent(event);
        return event;
    }

    const PLUGIN = {"package.json": "{}", dist: {"index.js": "1"}, node_modules: {dep: {"a.js": "x"}}};
    const root = (): Element => document.querySelector("[data-plugins-page]")!;
    const problemReason = (): string => document.querySelector("[data-plugin-problem] .plugins-page__problem-reason")?.textContent ?? "";

    async function drop(entries: unknown[]): Promise<void> {
        drag(root(), "drop", entries);
        await flushPromises();
    }

    it("没有给上传客户端（Lab、测试）：没有“选择文件夹”，拖入不被接管", async () => {
        await open(registry([BUILTIN]).client);
        expect(document.querySelector("[data-plugin-choose-folder]")).toBeNull();
        expect(drag(root(), "dragover").defaultPrevented).toBe(false);
        expect(drag(root(), "drop", [directory("plugin", PLUGIN)]).defaultPrevented).toBe(false);
    });

    it("拖着文件经过：覆盖层出现、允许复制；离开页面收起；页面内部元素的拖动（没有 Files）不理", async () => {
        await open(registry([BUILTIN]).client, "zh-CN", null, uploader().client);
        expect(drag(root(), "dragover", [], ["text/plain"]).defaultPrevented).toBe(false);
        expect(document.querySelector("[data-plugin-drop]")).toBeNull();
        const over = drag(root(), "dragover");
        await flushPromises();
        expect(over.defaultPrevented).toBe(true);
        expect((over as unknown as {dataTransfer: {dropEffect: string}}).dataTransfer.dropEffect).toBe("copy");
        expect(document.querySelector("[data-plugin-drop]")?.textContent).toContain("松开以安装插件");
        // 在页面内部从一个子元素移到另一个：不收起；离开页面（relatedTarget 为空）才收起。
        drag(root(), "dragleave", [], ["Files"], document.querySelector("[data-plugin-path]"));
        await flushPromises();
        expect(document.querySelector("[data-plugin-drop]")).not.toBeNull();
        drag(root(), "dragleave");
        await flushPromises();
        expect(document.querySelector("[data-plugin-drop]")).toBeNull();
    });

    it("拖入文件夹：不带 node_modules 上传，对上传的文件夹预览，确认框写“拖入的文件夹”与文件数；确认后装上传的，页面不再删它", async () => {
        const fake = registry([BUILTIN]);
        const up = uploader();
        await open(fake.client, "zh-CN", null, up.client);
        await drop([directory("plugin", PLUGIN)]);
        expect(up.calls).toEqual(["upload plugin dist/index.js,package.json"]);
        expect(fake.calls).toEqual(["list", `inspect upload:${UPLOAD_ID}`]);
        expect(document.querySelector("[role=dialog]")?.textContent).toContain("安装插件");
        expect(document.querySelector("[data-plugin-preview-source]")?.textContent).toBe("拖入的文件夹 plugin（2 个文件，1 KiB）");

        click("[data-plugin-install-confirm]");
        await flushPromises();
        expect(fake.calls).toContain(`install upload:${UPLOAD_ID}`);
        expect(up.calls.filter((call) => call.startsWith("discard"))).toEqual([]);
        expect(row("example.new")).not.toBeNull();
    });

    it("取消预览：删掉页面上传的文件夹；预览失败也删，原因按失败码写；上传失效（path-rejected）写“已经失效”，不是“路径不能用”", async () => {
        const fake = registry([BUILTIN]);
        const up = uploader();
        await open(fake.client, "zh-CN", null, up.client);
        await drop([directory("plugin", PLUGIN)]);
        dialogButton("取消").click();
        await flushPromises();
        expect(up.calls.at(-1)).toBe(`discard ${UPLOAD_ID}`);

        fake.answerNext({ok: false, code: "manifest-invalid", detail: {detail: "清单有错", problems: ["name：必填"]}});
        await drop([directory("plugin", PLUGIN)]);
        expect(up.calls.at(-1)).toBe(`discard ${UPLOAD_ID}`);
        expect(document.querySelector("[role=dialog]")).toBeNull();
        expect(problemReason()).toBe("插件的清单无效");

        fake.answerNext({ok: false, code: "path-rejected", detail: {detail: "上传已失效，重新拖入文件夹"}});
        await drop([directory("plugin", PLUGIN)]);
        expect(problemReason()).toBe("拖入的文件夹已经失效，重新拖入");
    });

    it("上传失败：按失败码写原因、不开确认框、没有残留的上传可删（服务端已删）", async () => {
        const fake = registry([BUILTIN]);
        const up = uploader();
        await open(fake.client, "zh-CN", null, up.client);
        up.answerNext({ok: false, code: "upload-path-invalid", detail: "路径里不能有 .."});
        await drop([directory("plugin", PLUGIN)]);
        expect(problemReason()).toBe("文件夹里有不能上传的文件名");
        expect(document.querySelector(".plugins-page__problem-line")?.textContent).toBe("路径里不能有 ..");
        expect(document.querySelector("[role=dialog]")).toBeNull();
        expect(fake.calls).toEqual(["list"]);
        expect(up.calls.filter((call) => call.startsWith("discard"))).toEqual([]);
        up.answerNext({ok: false, code: "unreachable", detail: ""});
        await drop([directory("plugin", PLUGIN)]);
        expect(problemReason()).toBe("读取或上传没有完成");
    });

    it("上传之前就拒绝并说明：单个文件、压缩包、多个条目、没有 package.json、多拖了一层；都不上传", async () => {
        const up = uploader();
        await open(registry([BUILTIN]).client, "zh-CN", null, up.client);
        const cases: Array<[unknown[], string]> = [
            [[fileEntry("a.txt", "x")], "拖入一个插件文件夹"],
            [[fileEntry("plugin.zip", "x")], "先解压，再拖入解出的文件夹"],
            [[directory("a", PLUGIN), directory("b", PLUGIN)], "拖入一个插件文件夹"],
            [[], "拖入一个插件文件夹"],
            [[directory("plugin", {"readme.md": "x"})], "这个文件夹的根目录没有 package.json，不像是构建好的插件"],
            [[directory("outer", {"my-plugin": {"package.json": "{}", "a.js": "1"}, "notes.txt": "n"})], "插件好像在 my-plugin 里，把它拖进来"],
        ];
        for (const [entries, expected] of cases) {
            await drop(entries);
            expect([expected, problemReason()]).toEqual([expected, expected]);
        }
        expect(up.calls).toEqual([]);
    });

    it("上传中、预览或确认框开着时再拖入：提示正在处理上一个文件夹，不发第二个上传", async () => {
        const up = uploader();
        await open(registry([BUILTIN]).client, "zh-CN", null, up.client);
        const settle = up.holdNext();
        drag(root(), "drop", [directory("plugin", PLUGIN)]);
        await flushPromises();
        expect(document.querySelector("[data-plugin-upload-progress]")?.textContent).toContain("正在上传");
        expect(disabled(document.querySelector("[data-plugin-choose-folder]"))).toBe(true);
        await drop([directory("plugin", PLUGIN)]);
        expect(problemReason()).toBe("正在处理上一个文件夹");
        settle();
        await flushPromises();
        // 预览开着：同样不收。
        expect(document.querySelector("[role=dialog]")).not.toBeNull();
        await drop([directory("plugin", PLUGIN)]);
        expect(problemReason()).toBe("正在处理上一个文件夹");
        expect(up.calls.filter((call) => call.startsWith("upload"))).toHaveLength(1);
    });

    it("松手落在页面以外（侧栏、确认框遮罩）：窗口兜底拦下默认动作、不让页面被导航走，并提示拖到内容区；不是文件的拖动不管", async () => {
        const up = uploader();
        const wrapper = await open(registry([BUILTIN]).client, "zh-CN", null, up.client);
        const outside = document.createElement("div");
        document.body.append(outside);
        expect(drag(outside, "dragover").defaultPrevented).toBe(true);
        expect(drag(outside, "drop", [directory("plugin", PLUGIN)]).defaultPrevented).toBe(true);
        await flushPromises();
        expect(problemReason()).toBe("拖到插件页的内容区");
        expect(up.calls).toEqual([]);
        expect(drag(outside, "drop", [], ["text/plain"]).defaultPrevented).toBe(false);
        // 页面卸载后窗口上不再有兜底。
        wrapper.unmount();
        mounted.splice(mounted.indexOf(wrapper), 1);
        expect(drag(outside, "drop", [directory("plugin", PLUGIN)]).defaultPrevented).toBe(false);
    });

    it("页面离开：还没交给安装的上传用 keepalive 删掉；已经发出安装请求的上传页面不删（服务端在安装结束时删）", async () => {
        const up = uploader();
        const fake = registry([BUILTIN]);
        const first = await open(fake.client, "zh-CN", null, up.client);
        await drop([directory("plugin", PLUGIN)]);
        first.unmount();
        mounted.splice(mounted.indexOf(first), 1);
        expect(up.calls.at(-1)).toBe(`discard ${UPLOAD_ID} keepalive`);

        const second = await open(fake.client, "zh-CN", null, up.client);
        await drop([directory("plugin", PLUGIN)]);
        const settle = fake.holdNext();
        click("[data-plugin-install-confirm]");
        await flushPromises();
        const before = up.calls.length;
        second.unmount();
        mounted.splice(mounted.indexOf(second), 1);
        settle();
        await flushPromises();
        expect(up.calls.slice(before)).toEqual([]);
    });

    it("“选择文件夹”：选出的文件走同一条路（相对路径来自 webkitRelativePath，node_modules 不收）", async () => {
        const up = uploader();
        await open(registry([BUILTIN]).client, "zh-CN", null, up.client);
        const input = document.querySelector<HTMLInputElement>("[data-plugin-folder-input]")!;
        expect(input.hasAttribute("webkitdirectory")).toBe(true);
        const picked = (relative: string): File => Object.defineProperty(new File(["x"], relative.split("/").pop()!), "webkitRelativePath", {value: relative});
        Object.defineProperty(input, "files", {configurable: true, value: [picked("plugin/package.json"), picked("plugin/dist/index.js"), picked("plugin/node_modules/dep/a.js")]});
        input.dispatchEvent(new Event("change", {bubbles: true}));
        await flushPromises();
        expect(up.calls).toEqual(["upload plugin dist/index.js,package.json"]);
        expect(document.querySelector("[role=dialog]")).not.toBeNull();
    });
});
