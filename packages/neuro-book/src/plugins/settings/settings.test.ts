/**
 * `nbook.settings` 三端入口（docs/specs/settings/configuration.md 输出 3、6–8、11、12、15–17、19，验收 1、2、6）：
 * 服务端、项目与浏览器都是真实的内核实例，经进程内链路连到服务端路由，配置文件是真实临时目录里的文件。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {computed} from "@vue/reactivity";

import {defineEntry, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteLink} from "@notnotype/nb-runtime/remote";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {defineSetting, SETTINGS_POINT} from "nbook/shared/settings";
import type {SettingsService} from "nbook/shared/settings";

import {RELOAD_DELAY_MS} from "./backend/layer-owner";
import {APPEARANCE_SECTION, projectSettingsContract, SETTINGS_SECTIONS_POINT, settingsKey, userSettingsContract} from "./shared/contracts";
import type {SettingsContract} from "./shared/contracts";
import {FIRST_SNAPSHOT_MS} from "./shared/instance";
import {settingsWorld} from "./testing/world";
import type {SettingsWorld} from "./testing/world";
import {settingsWindowSourceKey} from "./web/window-source";
import type {SettingsWindowSource} from "./web/window-source";

const title = {"zh-CN": "项", "en-US": "Item"};
const theme = defineSetting({plugin: "x.ui", name: "theme", schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]), default: "nbook", title});
const locale = defineSetting({plugin: "x.ui", name: "locale", schema: Type.Union([Type.Literal("zh-CN"), Type.Literal("en-US")]), default: "zh-CN", title, layers: ["user"]});
const font = defineSetting({plugin: "x.ui", name: "font", schema: Type.Object({family: Type.String(), size: Type.Number()}), default: {family: "serif", size: 12}, title});
const CONTRIBUTIONS = [theme.contribution, locale.contribution, font.contribution];

interface Probe {
    service: SettingsService | null;
}

/** 测试插件：在给定位置启动即激活，把拿到的配置服务交给测试。`x.ui` 的声明在每个位置都登记（宿主由描述生成）。 */
function plugin(id: string, location: "server" | "project" | "browser", probe: Probe): PluginDefinition {
    return {
        id,
        contributions: id === "x.ui" ? CONTRIBUTIONS : [],
        entries: [defineEntry({
            id: location,
            location,
            activationEvents: ["onStartup"],
            dependencies: [{key: settingsKey}],
            activate: (context) => {
                probe.service = context.services.require(settingsKey);
                return {};
            },
        })],
    };
}

function probes(): {ui: Probe; other: Probe} {
    return {ui: {service: null}, other: {service: null}};
}

function both(location: "server" | "project" | "browser", set: {ui: Probe; other: Probe}): PluginDefinition[] {
    return [plugin("x.ui", location, set.ui), plugin("x.other", location, set.other)];
}

function service(probe: Probe): SettingsService {
    if (probe.service === null) throw new Error("测试插件还没激活");
    return probe.service;
}

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-settings", "settings-plugin");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world(files: {readonly user?: string; readonly project?: string} = {}, hubSet = probes(), options: Parameters<typeof settingsWorld>[2] = {}): Promise<SettingsWorld> {
    counter += 1;
    const root = join(tmp, `world-${String(counter)}`);
    for (const [path, text] of [[join(root, "state", "settings.json"), files.user], [join(root, "Book", ".nbook", "settings.json"), files.project]] as const) {
        if (text === undefined) continue;
        await mkdir(dirname(path), {recursive: true});
        await writeFile(path, text);
    }
    await mkdir(join(root, "Book"), {recursive: true});
    const created = await settingsWorld(root, both("server", hubSet), options);
    worlds.push(created);
    return created;
}

/** 推进时钟直到条件成立：外部改文件后，拥有者在合并窗口之后才重读。 */
function settle<T>(created: SettingsWorld, description: string, check: () => T) {
    return waitUntil(description, () => {
        created.clock.advance(RELOAD_DELAY_MS);
        return check();
    });
}

describe("合成与跨实例分发", () => {
    it("用户层主题 macos、项目层 nbook：服务端与未绑定窗口读到 macos，项目实例与绑定窗口读到 nbook；项目层里只允许用户层的键被丢弃", async () => {
        const hub = probes();
        const created = await world({user: "{\"x.ui/theme\": \"macos\", \"x.ui/locale\": \"en-US\"}", project: "{\"x.ui/theme\": \"nbook\", \"x.ui/locale\": \"zh-CN\"}"}, hub);
        const project = probes();
        await created.project(1, both("project", project));
        const bound = probes();
        const unbound = probes();
        await created.window("w-bound", both("browser", bound));
        await created.window("w-free", both("browser", unbound), {bound: false});

        expect(service(hub.ui).get(theme)).toBe("macos");
        expect(service(unbound.ui).get(theme)).toBe("macos");
        expect(service(project.ui).get(theme)).toBe("nbook");
        expect(service(bound.ui).get(theme)).toBe("nbook");
        // 项目层里的界面语言被丢弃：各处都是用户层的值。
        expect(service(bound.ui).get(locale)).toBe("en-US");
        expect(service(bound.ui).inspect(theme)).toEqual({value: "nbook", source: "project", default: "nbook", user: {status: "ok", value: "macos"}, project: {status: "ok", value: "nbook"}});
        expect(service(hub.ui).inspect(theme)).toMatchObject({source: "user", project: {status: "absent"}});
        expect(service(bound.ui).inspect(font)).toEqual({value: {family: "serif", size: 12}, source: "default", default: {family: "serif", size: 12}, user: {status: "ok"}, project: {status: "ok"}});
    });

    it("写入：auto 在项目层有这个键时写项目层，否则写用户层；update 返回时本实例已是新值，别的实例经订阅收到", async () => {
        const created = await world({project: "{\"x.ui/theme\": \"macos\"}"});
        const project = probes();
        await created.project(1, both("project", project));
        const a = probes();
        const b = probes();
        const free = probes();
        await created.window("w-a", both("browser", a));
        await created.window("w-b", both("browser", b));
        await created.window("w-free", both("browser", free), {bound: false});

        expect(await service(a.ui).update(theme, "nbook")).toEqual({ok: true});
        expect(service(a.ui).get(theme)).toBe("nbook");
        expect(service(a.ui).inspect(theme).source).toBe("project");
        await waitUntil("另一个窗口收到", () => service(b.ui).get(theme) === "nbook");
        await waitUntil("项目实例收到", () => service(project.ui).get(theme) === "nbook");
        expect(JSON.parse(await readFile(created.projectFile, "utf8"))).toEqual({"x.ui/theme": "nbook"});

        // 字号只在默认值：auto 写用户层，未绑定的窗口也收到。
        expect(await service(a.ui).update(font, {family: "mono", size: 14})).toEqual({ok: true});
        await waitUntil("未绑定窗口收到用户层的写入", () => service(free.ui).get(font).size === 14);
        expect(JSON.parse(await readFile(created.userFile, "utf8"))).toEqual({"x.ui/font": {family: "mono", size: 14}});

        // 显式写用户层而项目层覆盖着：写入成功、用户层的值更新，有效值不变。
        expect(await service(a.ui).update(theme, "macos", {layer: "user"})).toEqual({ok: true});
        expect(service(a.ui).inspect(theme)).toMatchObject({value: "nbook", source: "project", user: {status: "ok", value: "macos"}});
        // 删除这一层里的键：回到下一层的值。
        expect(await service(a.ui).update(theme, undefined, {layer: "project"})).toEqual({ok: true});
        expect(service(a.ui).get(theme)).toBe("macos");
    });

    it("两个窗口同时写同一键与不同键：最终两边一致，不同的键都保留", async () => {
        const created = await world();
        const a = probes();
        const b = probes();
        await created.window("w-a", both("browser", a), {bound: false});
        await created.window("w-b", both("browser", b), {bound: false});
        const results = await Promise.all([
            service(a.ui).update(theme, "macos"),
            service(b.ui).update(theme, "nbook"),
            service(a.ui).update(locale, "en-US"),
            service(b.ui).update(font, {family: "mono", size: 9}),
        ]);
        expect(results).toEqual([{ok: true}, {ok: true}, {ok: true}, {ok: true}]);
        const final = JSON.parse(await readFile(created.userFile, "utf8")) as Record<string, unknown>;
        expect(final["x.ui/locale"]).toBe("en-US");
        expect(final["x.ui/font"]).toEqual({family: "mono", size: 9});
        await waitUntil("两个窗口一致", () => service(a.ui).get(theme) === final["x.ui/theme"] && service(b.ui).get(theme) === final["x.ui/theme"]);
    });

    it("外部改文件：所有实例即时变化；文件改坏时 inspect 变为 invalid 且值不变、写入为 layer-invalid；改回同样的值后恢复", async () => {
        const created = await world({user: "{\"x.ui/theme\": \"macos\"}"});
        const w = probes();
        await created.window("w", both("browser", w), {bound: false});
        await writeFile(created.userFile, "{\"x.ui/theme\": \"nbook\"}");
        await settle(created, "窗口收到外部修改", () => service(w.ui).get(theme) === "nbook");

        // 界面经 computed 读层状态：层状态变了 computed 要失效，值不变时不发变化通知。
        const status = computed(() => service(w.ui).inspect(theme).user.status);
        expect(status.value).toBe("ok");
        const notified: string[][] = [];
        service(w.ui).onDidChange((keys) => notified.push([...keys]));
        await writeFile(created.userFile, "{\"x.ui/theme\": ");
        await settle(created, "窗口看到层无效", () => status.value === "invalid");
        expect(service(w.ui).get(theme)).toBe("nbook");
        expect(await service(w.ui).update(theme, "macos")).toMatchObject({ok: false, code: "layer-invalid"});
        await writeFile(created.userFile, "{\"x.ui/theme\": \"nbook\"}");
        await settle(created, "窗口看到层恢复", () => status.value === "ok");
        expect(notified).toEqual([]);
    });
});

describe("list 分区（settings-window.md“分区声明”）", () => {
    it("写在描述顶层的 list 分区在服务端、项目实例与窗口都登记、都被接受", async () => {
        const hub = probes();
        const created = await world({}, hub);
        const section = {capability: SETTINGS_SECTIONS_POINT, id: "x.ui.main", declaration: {title: {"zh-CN": "界面", "en-US": "UI"}, icon: "i-lucide-square", category: "plugins"}};
        const withSection = (location: "project" | "browser", set: {ui: Probe; other: Probe}) => both(location, set).map((definition) => definition.id === "x.ui" ? {...definition, contributions: [...(definition.contributions ?? []), section]} : definition);
        const project = await created.project(1, withSection("project", probes()));
        const window = await created.window("w-sections", withSection("browser", probes()));
        for (const [name, app] of [["server", created.hub], ["project", project], ["browser", window.app]] as const) {
            expect(app.plugins.contribution(SETTINGS_SECTIONS_POINT, APPEARANCE_SECTION)[0]?.validation, name).toEqual({status: "accepted"});
        }
        for (const [name, app] of [["project", project], ["browser", window.app]] as const) {
            expect(app.plugins.contribution(SETTINGS_SECTIONS_POINT, "x.ui.main")[0]?.validation, name).toEqual({status: "accepted"});
        }
    });
});

describe("授权与值", () => {
    it("非声明者 denied（经代理也是原插件）；未声明 undeclared；值不合 schema 或不是 JSON 为 invalid-value；层不允许；服务端写项目层为 no-project", async () => {
        const hub = probes();
        const created = await world({}, hub);
        await created.project(1, both("project", probes()));
        const w = probes();
        await created.window("w", both("browser", w));
        expect(await service(w.other).update(theme, "macos")).toMatchObject({ok: false, code: "denied"});
        const undeclared = defineSetting({plugin: "x.ui", name: "missing", schema: Type.String(), default: "", title});
        expect(await service(w.ui).update(undeclared, "x")).toMatchObject({ok: false, code: "undeclared"});
        expect(await service(w.ui).update(theme, "solarized" as "nbook")).toMatchObject({ok: false, code: "invalid-value"});
        expect(await service(w.ui).update(font, {family: "mono", size: Number.NaN})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await service(w.ui).update(locale, "en-US", {layer: "project"})).toMatchObject({ok: false, code: "layer-not-allowed"});
        expect(await service(hub.ui).update(theme, "macos", {layer: "project"})).toMatchObject({ok: false, code: "no-project"});
        // 同时违反几条时按输出 11 的顺序报第一条：非声明者先于层与值，值先于层。
        expect(await service(w.other).update(locale, "en-US", {layer: "project"})).toMatchObject({ok: false, code: "denied"});
        expect(await service(hub.other).update(theme, "macos", {layer: "project"})).toMatchObject({ok: false, code: "denied"});
        expect(await service(w.other).update(font, {family: "mono", size: Number.NaN})).toMatchObject({ok: false, code: "denied"});
        expect(await service(w.ui).update(locale, "fr-FR" as "zh-CN", {layer: "project"})).toMatchObject({ok: false, code: "invalid-value"});
        // 审计看到的调用方是原插件，经 nbook.settings 代理。
        expect(await service(w.ui).update(theme, "macos")).toEqual({ok: true});
        const audit = created.diagnostics("hub").query({}).records.filter((entry) => entry.event === "settings.write");
        expect(audit.map((entry) => entry.data)).toContainEqual({key: theme.key, layer: "user", plugin: "x.ui", via: "nbook.settings", code: "ok"});
    });

    it("读到的对象值深冻结：改不动，也影响不到别的读取方；写入前复制，之后改原对象不影响写入", async () => {
        const created = await world({user: "{\"x.ui/font\": {\"family\": \"mono\", \"size\": 14}}"});
        const w = probes();
        await created.window("w", both("browser", w), {bound: false});
        const value = service(w.ui).get(font);
        expect(Object.isFrozen(value)).toBe(true);
        expect(() => {
            (value as {size: number}).size = 99;
        }).toThrow(TypeError);
        expect(service(w.other).get(font)).toEqual({family: "mono", size: 14});

        const next = {family: "serif", size: 20};
        const writing = service(w.ui).update(font, next);
        next.size = 1;
        expect(await writing).toEqual({ok: true});
        expect(service(w.ui).get(font)).toEqual({family: "serif", size: 20});
    });
});

describe("比较后写入（输出 25）", () => {
    it("当前值对得上才写；期间别处改过文件得 conflict、文件不变；期望“没有这个键”同样按当前文件判断", async () => {
        const created = await world({user: "{\"x.ui/font\": {\"family\": \"mono\", \"size\": 14}}"});
        const w = probes();
        await created.window("w", both("browser", w), {bound: false});
        const ui = service(w.ui);
        const seen = ui.get(font);
        expect(await ui.update(font, {family: "mono", size: 16}, {expect: {value: seen}})).toEqual({ok: true});
        // 别处（这里直接改文件，同设置文件视图、外部编辑）在读出之后改过：按旧值期望的写入被拒，文件保持别处写入的内容。
        const path = created.userFile;
        await writeFile(path, "{\"x.ui/font\": {\"family\": \"sans\", \"size\": 18}}");
        expect(await ui.update(font, {family: "mono", size: 20}, {expect: {value: {family: "mono", size: 16}}})).toMatchObject({ok: false, code: "conflict"});
        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({"x.ui/font": {family: "sans", size: 18}});
        // 键序不同的同一个值算对得上。
        expect(await ui.update(font, {family: "sans", size: 22}, {expect: {value: {size: 18, family: "sans"}}})).toEqual({ok: true});
        expect(await ui.update(theme, "macos", {expect: {value: undefined}})).toEqual({ok: true});
        expect(await ui.update(theme, "nbook", {expect: {value: undefined}})).toMatchObject({ok: false, code: "conflict"});
    });
});

describe("手写的声明", () => {
    it("不经 defineSetting 的声明：默认值在接受时复制并深冻结，读取方改不动，作者手里的原对象也不影响有效值", async () => {
        const created = await world();
        const raw = {schema: Type.Object({nested: Type.Object({label: Type.String()})}), default: {nested: {label: "a"}}, title, layers: ["user", "project"], applies: "now"};
        const opts = defineSetting({plugin: "x.raw", name: "opts", schema: raw.schema, default: {nested: {label: "a"}}, title});
        const probe: Probe = {service: null};
        const rawPlugin: PluginDefinition = {...plugin("x.raw", "browser", probe), contributions: [{capability: SETTINGS_POINT, id: opts.key, declaration: raw}]};
        const window = await created.window("w", [rawPlugin], {bound: false});
        // 手写的声明要被接受，下面读到的才是它的默认值，而不是 defineSetting 那份。
        expect(window.app.plugins.contribution(SETTINGS_POINT, opts.key)[0]?.validation).toEqual({status: "accepted"});
        const value = service(probe).get(opts);
        expect(Object.isFrozen(value) && Object.isFrozen(value.nested)).toBe(true);
        raw.default.nested.label = "changed";
        expect(service(probe).get(opts)).toEqual({nested: {label: "a"}});
    });
});

describe("就绪与恢复", () => {
    it("服务端的配置入口迟迟不就绪：窗口在截止后按默认值启动，快照晚到时照常生效", async () => {
        let open: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            open = resolve;
        });
        const created = await world({user: "{\"x.ui/theme\": \"macos\"}"}, probes(), {hubGate: gate});
        const w = probes();
        const opening = created.window("w", both("browser", w), {bound: false});
        await waitUntil("截止计时已排上", () => {
            created.clock.advance(FIRST_SNAPSHOT_MS);
            return w.ui.service !== null;
        });
        await opening;
        expect(service(w.ui).get(theme)).toBe("nbook");
        expect(service(w.ui).inspect(theme).user).toEqual({status: "unavailable"});
        open();
        await waitUntil("快照晚到后生效", () => service(w.ui).get(theme) === "macos");
    });

    it("首次订阅时已断线：窗口按默认值启动；连接回到在线时重新订阅，收到文件里的值", async () => {
        const created = await world({user: "{\"x.ui/theme\": \"macos\"}"});
        const w = probes();
        const window = await created.window("w", both("browser", w), {bound: false, connected: false});
        expect(service(w.ui).get(theme)).toBe("nbook");
        expect(service(w.ui).inspect(theme).user).toEqual({status: "unavailable"});
        expect(await window.reconnect()).toMatchObject({ok: true});
        await waitUntil("重新订阅后收到", () => service(w.ui).get(theme) === "macos");
    });

    it("已建立的订阅断线重连：断线期间的外部修改在重连后到达", async () => {
        const hub = probes();
        const created = await world({user: "{\"x.ui/theme\": \"macos\"}"}, hub);
        const w = probes();
        const window = await created.window("w", both("browser", w), {bound: false});
        window.disconnect();
        await writeFile(created.userFile, "{\"x.ui/theme\": \"nbook\"}");
        await settle(created, "服务端重读", () => service(hub.ui).get(theme) === "nbook");
        expect(service(w.ui).get(theme)).toBe("macos");
        expect(await window.reconnect()).toMatchObject({ok: true});
        await waitUntil("重连后收到", () => service(w.ui).get(theme) === "nbook");
    });

    it("写请求发出后断线：unknown-outcome，不报已保存；不自动重发", async () => {
        const created = await world();
        const w = probes();
        const window = await created.window("w", both("browser", w), {bound: false});
        const writing = service(w.ui).update(theme, "macos");
        window.disconnect();
        expect(await writing).toMatchObject({ok: false, code: "unknown-outcome"});
    });
});

describe("用户编辑（输出 19）", () => {
    /** 远程调用的结果折成配置的失败码：拥有者一侧的失败经业务失败码 settings-failed 带回。 */
    type Outcome = "ok" | string;

    async function call(remote: Pick<ActivationContext["remote"], "use">, contract: SettingsContract, method: "edit" | "unset", key: string, value?: unknown): Promise<Outcome> {
        const client = contract === userSettingsContract ? remote.use(userSettingsContract) : remote.use(projectSettingsContract);
        const result = method === "edit" ? await client.edit({key, value}) : await client.unset({key});
        if (result.ok) return "ok";
        return result.code === "settings-failed" ? (result.detail as {readonly code: string}).code : result.code;
    }

    interface Relay {
        edit(contract: SettingsContract, key: string, value: unknown): Promise<Outcome>;
    }

    const relayKey = defineServiceKey<Relay>("nbook.settings/test-relay");

    interface Window {
        source: SettingsWindowSource | null;
        relay: Relay | null;
        /** `test-window` 入口自己的远程访问：调用方是 `nbook.settings`、没有经过代理。 */
        remote: ActivationContext["remote"] | null;
    }

    function window(): Window {
        return {source: null, relay: null, remote: null};
    }

    /** 包住窗口一端的链路：`hold()` 之后推迟收到的订阅推送，让写入结果先于层快照的推送到达。 */
    function eventGate(): {wrap: (link: RemoteLink) => RemoteLink; hold(): void; release(): void} {
        let held = false;
        const queued: Array<() => void> = [];
        return {
            wrap: (link) => ({
                send: (frame) => link.send(frame),
                onFrame: (listener) => link.onFrame((value) => {
                    if (held && (value as {readonly type?: unknown}).type === "event") {
                        queued.push(() => listener(value));
                        return;
                    }
                    listener(value);
                }),
                onClose: (listener) => link.onClose(listener),
                close: () => link.close(),
            }),
            hold: () => {
                held = true;
            },
            release: () => {
                held = false;
                for (const deliver of queued.splice(0)) deliver();
            },
        };
    }

    /**
     * 窗口里 `nbook.settings` 另加的两个入口：`test-window` 像设置窗口那样取数据来源；`test-relay` 以调用方的身份代发
     * `edit`，于是拥有者看到的调用方是 `nbook.settings`、`via` 也是 `nbook.settings`。
     */
    function settingsEntries(target: Window): PluginEntryDefinition[] {
        return [
            defineEntry({
                id: "test-relay",
                location: "browser",
                provides: [relayKey],
                remoteDelegates: [userSettingsContract, projectSettingsContract],
                activate: (context) => ({
                    services: [provideServicePerConsumer(relayKey, (consumer) => ({
                        edit: (contract: SettingsContract, key: string, value: unknown) => call(context.remote.on(consumer), contract, "edit", key, value),
                    }))],
                }),
            }),
            defineEntry({
                id: "test-window",
                location: "browser",
                activationEvents: ["onStartup"],
                dependencies: [{key: settingsWindowSourceKey}, {key: relayKey}],
                activate: (context) => {
                    target.source = context.services.require(settingsWindowSourceKey);
                    target.relay = context.services.require(relayKey);
                    target.remote = context.remote;
                    return {};
                },
            }),
        ];
    }

    /** 别的插件：拿到自己的远程访问，直接调用两份合同。 */
    function intruder(target: {remote: ActivationContext["remote"] | null}): PluginDefinition {
        return {
            id: "x.intruder",
            entries: [defineEntry({
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                activate: (context) => {
                    target.remote = context.remote;
                    return {};
                },
            })],
        };
    }

    function windowSource(target: Window): SettingsWindowSource {
        if (target.source === null) throw new Error("设置窗口的入口还没激活");
        return target.source;
    }

    it("别的插件直接调用 edit、unset 为 denied，两层都是；文件不变", async () => {
        const user = "{\"x.ui/theme\": \"macos\"}";
        const created = await world({user, project: user});
        await created.project(1, both("project", probes()));
        const outsider: {remote: ActivationContext["remote"] | null} = {remote: null};
        await created.window("w", [...both("browser", probes()), intruder(outsider)]);
        const remote = outsider.remote!;
        expect(await call(remote, userSettingsContract, "edit", theme.key, "nbook")).toBe("denied");
        expect(await call(remote, userSettingsContract, "unset", theme.key)).toBe("denied");
        expect(await call(remote, projectSettingsContract, "edit", theme.key, "nbook")).toBe("denied");
        // 调用方先于键与值核对：未声明的键、不合 schema 的值同样是 denied。
        expect(await call(remote, userSettingsContract, "edit", "x.ui/missing", 1)).toBe("denied");
        expect(await readFile(created.userFile, "utf8")).toBe(user);
        expect(await readFile(created.projectFile, "utf8")).toBe(user);
    });

    it("经代理的 nbook.settings 请求为 denied：拥有者只接受 nbook.settings 自己、没有经过代理的请求", async () => {
        const created = await world();
        await created.project(1, both("project", probes()));
        const target = window();
        await created.window("w", both("browser", probes()), {settingsEntries: settingsEntries(target)});
        expect(await target.relay!.edit(userSettingsContract, theme.key, "macos")).toBe("denied");
        expect(await target.relay!.edit(projectSettingsContract, theme.key, "macos")).toBe("denied");
        await expect(readFile(created.userFile, "utf8")).rejects.toThrow();
        const audit = created.diagnostics("hub").query({}).records.filter((entry) => entry.event === "settings.write");
        expect(audit.map((entry) => entry.data)).toContainEqual({key: theme.key, layer: "user", plugin: "nbook.settings", via: "nbook.settings", code: "denied", userEdit: true});
    });

    it("nbook.settings 自己写任何已声明项的允许层：其余内容按原文保留，返回时本窗口已是新值，别处经订阅收到；unset 删掉这一层的键；审计标出用户编辑", async () => {
        const userText = "// 我的设置\n{\n\t\"x.ui/font\": {\"family\": \"serif\", \"size\": 12}, // 字体\n\t\"unknown/key\": 1,\n}\n";
        const created = await world({user: userText});
        const project = probes();
        await created.project(1, both("project", project));
        const target = window();
        const ui = probes();
        const gate = eventGate();
        await created.window("w", both("browser", ui), {settingsEntries: settingsEntries(target), wrapLink: gate.wrap});
        const other = probes();
        await created.window("w-other", both("browser", other));
        const source = windowSource(target);

        // 主题是 x.ui 声明的，nbook.settings 照样能写。层快照的推送被推迟：返回时本窗口已是新值，靠的是写入结果。
        gate.hold();
        expect(await source.edit(theme.key, "user", "macos")).toEqual({ok: true});
        expect(service(ui.ui).inspect(theme).user).toEqual({status: "ok", value: "macos"});
        gate.release();
        expect(await readFile(created.userFile, "utf8")).toBe("// 我的设置\n{\n\t\"x.ui/font\": {\"family\": \"serif\", \"size\": 12}, // 字体\n\t\"unknown/key\": 1,\n\t\"x.ui/theme\": \"macos\",\n}\n");
        await waitUntil("另一个窗口收到", () => service(other.ui).get(theme) === "macos");

        // 项目层：本作品单独设置，再移除。
        expect(await source.edit(theme.key, "project", "nbook")).toEqual({ok: true});
        expect(service(ui.ui).inspect(theme)).toMatchObject({value: "nbook", source: "project"});
        await waitUntil("项目实例收到", () => service(project.ui).get(theme) === "nbook");
        expect(await source.unset(theme.key, "project")).toEqual({ok: true});
        expect(service(ui.ui).inspect(theme)).toMatchObject({value: "macos", source: "user", project: {status: "ok"}});
        expect(JSON.parse(await readFile(created.projectFile, "utf8"))).toEqual({});

        // 恢复默认：从用户层删掉，注释与别的键不动。
        expect(await source.unset(theme.key, "user")).toEqual({ok: true});
        expect(await readFile(created.userFile, "utf8")).toBe(userText);

        const audit = created.diagnostics("hub").query({}).records.filter((entry) => entry.event === "settings.write").map((entry) => entry.data);
        expect(audit).toContainEqual({key: theme.key, layer: "user", plugin: "nbook.settings", via: null, code: "ok", userEdit: true});
    });

    it("层文件坏了：窗口一侧的层状态带出错的原因与位置（用户层经服务端、项目层经项目子进程的链路），修好后没有", async () => {
        const created = await world({user: "{}", project: "{}"});
        await created.project(1, both("project", probes()));
        const target = window();
        await created.window("w", both("browser", probes()), {settingsEntries: settingsEntries(target)});
        const source = windowSource(target);
        await writeFile(created.userFile, "{\"x.ui/theme\": ");
        await writeFile(created.projectFile, "{\n  \"x.ui/theme\": \"nbook\"\n  \"x.ui/size\": 1\n}");
        await settle(created, "窗口看到两层都无效", () => source.layer("user").status === "invalid" && source.layer("project").status === "invalid");
        for (const [layer, position] of [["user", {line: 1, column: 16}], ["project", {line: 3, column: 3}]] as const) {
            const state = source.layer(layer);
            if (state.status !== "invalid") throw new Error(`${layer} 层不是无效`);
            expect(state.position, layer).toEqual(position);
            expect(state.reason, layer).toEqual(expect.any(String));
            expect(state.detail, layer).toBe(`第 ${String(position.line)} 行：${state.reason!}`);
        }
        await writeFile(created.userFile, "{\"x.ui/theme\": \"nbook\"}");
        await settle(created, "用户层恢复", () => source.layer("user").status === "ok");
        expect(source.layer("user")).not.toHaveProperty("position");
        expect(source.layer("user")).not.toHaveProperty("reason");
    });

    it("不允许的层 layer-not-allowed、未声明 undeclared、值不合 schema invalid-value、未绑定作品的窗口写项目层 no-project、文件无效 layer-invalid", async () => {
        const created = await world();
        await created.project(1, both("project", probes()));
        const bound = window();
        await created.window("w", both("browser", probes()), {settingsEntries: settingsEntries(bound)});
        const free = window();
        await created.window("w-free", both("browser", probes()), {bound: false, settingsEntries: settingsEntries(free)});
        expect(await windowSource(bound).edit(locale.key, "project", "en-US")).toMatchObject({ok: false, code: "layer-not-allowed"});
        expect(await windowSource(bound).edit("x.ui/missing", "user", 1)).toMatchObject({ok: false, code: "undeclared"});
        expect(await windowSource(bound).edit(theme.key, "user", "solarized")).toMatchObject({ok: false, code: "invalid-value"});
        expect(await windowSource(bound).edit(font.key, "user", {family: "mono", size: Number.NaN})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await windowSource(free).edit(theme.key, "project", "macos")).toMatchObject({ok: false, code: "no-project"});
        expect(await windowSource(free).edit(locale.key, "user", "en-US")).toEqual({ok: true});
        await expect(readFile(created.projectFile, "utf8")).rejects.toThrow();
        // 拥有者自己也核对，不靠浏览器一侧先挡：nbook.settings 直接调用远程方法得到同样的失败码。
        expect(await call(bound.remote!, userSettingsContract, "edit", "x.ui/missing", 1)).toBe("undeclared");
        expect(await call(bound.remote!, userSettingsContract, "edit", theme.key, "solarized")).toBe("invalid-value");
        expect(await call(bound.remote!, projectSettingsContract, "edit", locale.key, "en-US")).toBe("layer-not-allowed");
        expect(await call(bound.remote!, projectSettingsContract, "unset", "x.ui/missing")).toBe("undeclared");

        // 拥有者写入前按磁盘上的当前文本核对，不必等层快照跟上。
        await writeFile(created.userFile, "{\"x.ui/theme\": ");
        expect(await windowSource(bound).edit(theme.key, "user", "macos")).toMatchObject({ok: false, code: "layer-invalid"});
        expect(await readFile(created.userFile, "utf8")).toBe("{\"x.ui/theme\": ");
    });
});
