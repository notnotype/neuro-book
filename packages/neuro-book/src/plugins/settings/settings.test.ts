/**
 * `nbook.settings` 三端入口（docs/specs/settings/configuration.md 输出 3、6–8、11、12、15–17，验收 1、2、6）：服务端、
 * 项目与浏览器都是真实的内核实例，经进程内链路连到服务端路由，配置文件是真实临时目录里的文件。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import {computed} from "@vue/reactivity";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {defineSetting, SETTINGS_POINT} from "nbook/shared/settings";
import type {SettingsService} from "nbook/shared/settings";

import {RELOAD_DELAY_MS} from "./backend/layer-owner";
import {settingsKey} from "./shared/contracts";
import {FIRST_SNAPSHOT_MS} from "./shared/instance";
import {settingsWorld} from "./testing/world";
import type {SettingsWorld} from "./testing/world";

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

describe("手写的声明", () => {
    it("不经 defineSetting 的声明：默认值在接受时复制并深冻结，读取方改不动，作者手里的原对象也不影响有效值", async () => {
        const created = await world();
        const raw = {schema: Type.Object({nested: Type.Object({label: Type.String()})}), default: {nested: {label: "a"}}, title, layers: ["user", "project"], restart: false};
        const opts = defineSetting({plugin: "x.raw", name: "opts", schema: raw.schema, default: {nested: {label: "a"}}, title});
        const probe: Probe = {service: null};
        const rawPlugin: PluginDefinition = {...plugin("x.raw", "browser", probe), contributions: [{capability: SETTINGS_POINT, id: opts.key, declaration: raw}]};
        await created.window("w", [rawPlugin], {bound: false});
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
