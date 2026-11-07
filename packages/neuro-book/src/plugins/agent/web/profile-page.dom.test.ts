/**
 * “Profile”页（docs/specs/agent/profile-settings.md）：配置是设置场景的局部宿主（产品里同一个配置实例），远程是脚本化的替身：形状与
 * `sessions.md` 的合同一致，真实的目录、事件与新建在 `profiles.test.ts` 经真实服务端测。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {readonly, ref, shallowRef} from "vue";
import type {Ref} from "vue";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import {modelsCatalogs} from "nbook/plugins/models/web/text";
import {pluginsCatalogs} from "nbook/plugins/plugins/web/text";
import type {ModelsSnapshot} from "nbook/plugins/models/shared/contracts";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {ProfileEntry, ToolCatalogEntry} from "../shared/contracts";
import {agentSettings} from "../shared/settings";
import ProfileDetail from "./components/ProfileDetail.vue";
import ProfileSettingsPage from "./components/ProfileSettingsPage.vue";
import {createProfileWriters, profilesPage} from "./profile-page";
import {agentCatalogs} from "./text";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const MAIN: ProfileEntry = {key: "nbook.agent.main", name: "写作助手", description: "和作者一起写", source: "nbook.agent", status: "ok", tools: {required: ["nbook.agent.read"], optional: ["nbook.agent.edit"]}, role: "main"};
const MINE: ProfileEntry = {key: "user.mine", name: "我的", description: "", source: "user", status: "ok", tools: {required: [], optional: []}};
const TITLE: ProfileEntry = {key: "nbook.agent.session-title", name: "会话标题", description: "", source: "nbook.agent", status: "ok", hidden: true, tools: {required: [], optional: []}, role: "tiny"};
const TOOLS: readonly ToolCatalogEntry[] = [
    {id: "nbook.agent.read", description: "读", providerName: "read", effect: "read", plugin: "nbook.agent"},
    {id: "nbook.agent.edit", description: "改", providerName: "edit", effect: "write", plugin: "nbook.agent"},
    {id: "nbook.agent.edit-replace", description: "换", providerName: "edit", effect: "write", plugin: "nbook.agent"},
    {id: "plot.search", description: "查\n第二行", providerName: "plot_search", effect: "read", plugin: "nbook.plot"},
];
const SNAPSHOT = {
    providers: [{id: "p", kind: "catalog", name: "P", baseUrl: null, catalogBaseUrl: null, key: {kind: "stored"}, models: [{id: "a", name: "模型 A", group: "g", enabled: true, contextWindow: 100_000, maxOutput: null, vision: false, reasoning: false, efforts: [], compaction: null, price: null, headers: {}, status: "ok"}]}],
    roles: [{id: "main", axis: "gradient", builtin: false, name: "主力", description: "", model: "p/a", status: "ok"}],
} as unknown as ModelsSnapshot;

/** 脚本化的远程：`profiles` 交回 `listed`，可以按次挂起；记下调用先后。 */
function fakeRemote(options: {readonly listed?: () => readonly ProfileEntry[]; readonly failList?: () => string | null} = {}) {
    const calls: string[] = [];
    let onEvent: (() => void) | null = null;
    let onResync: (() => void) | null = null;
    let released = 0;
    const gates: Array<() => void> = [];
    let hold = false;
    const remote = {
        profiles: async () => {
            calls.push("profiles");
            const snapshot = options.listed?.() ?? [MAIN, MINE, TITLE];
            if (hold) await new Promise<void>((resolve) => gates.push(resolve));
            const failed = options.failList?.() ?? null;
            return failed === null ? {ok: true as const, value: snapshot} : {ok: false as const, code: failed};
        },
        toolCatalog: async () => ({ok: true as const, value: TOOLS}),
        createUserProfile: async () => ({ok: true as const, value: {key: "user.new", address: "user://profiles/new.profile.tsx"}}),
        deleteUserProfile: async () => ({ok: true as const, value: {}}),
        events: {
            profileCatalogChanged: {
                subscribe: async (_filter: unknown, next: () => void, handlers?: {onResync?: () => void}) => {
                    calls.push("subscribe");
                    onEvent = next;
                    onResync = handlers?.onResync ?? null;
                    return {ok: true as const, value: {release: () => void (released += 1)}};
                },
            },
        },
    };
    return {
        remote: remote as never,
        calls,
        fire: () => onEvent?.(),
        resync: () => onResync?.(),
        released: () => released,
        hold: () => void (hold = true),
        releaseOne: () => gates.shift()?.(),
        resume: () => {
            hold = false;
            for (const gate of gates.splice(0)) gate();
        },
    };
}

function open(options: {readonly remote?: ReturnType<typeof fakeRemote>; readonly writable?: boolean; readonly values?: Readonly<Record<string, unknown>>; readonly snapshot?: ModelsSnapshot | null; readonly openAddress?: (address: string) => void} = {}) {
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.agent", agentCatalogs.catalogs, agentCatalogs.source);
    text.register("nbook.models", modelsCatalogs.catalogs, modelsCatalogs.source);
    text.register("nbook.plugins", pluginsCatalogs.catalogs, pluginsCatalogs.source);
    text.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
    const definitions = Object.values(agentSettings.settings).map((definition) => ({plugin: "nbook.agent", definition}));
    const host = createSettingsHost({settings: definitions, sections: [], user: {values: {...options.values}}, notify: () => undefined, text: text.port} as never);
    cleanup.push(() => host.dispose());
    const settings = host.service("nbook.agent");
    const remote = options.remote ?? fakeRemote();
    const failures: string[] = [];
    const page = profilesPage(ProfileSettingsPage, {
        settings,
        remote: remote.remote,
        pluginNames: async () => new Map(),
        models: {snapshot: shallowRef(options.snapshot === undefined ? SNAPSHOT : options.snapshot), failed: shallowRef(false), ensure: () => undefined},
        writers: createProfileWriters(settings),
        text: text.port,
        openAddress: options.openAddress ?? (() => undefined),
        report: () => undefined,
    });
    const context = {
        id: "nbook.agent.profiles",
        layer: readonly(ref("user")) as Readonly<Ref<"user">>,
        projectTitle: readonly(ref(null)),
        writable: readonly(ref(options.writable ?? true)),
        reportWriteFailure: (subject: string) => void failures.push(subject),
        dirty: () => undefined,
        options: {},
    } as unknown as SettingsPageContext;
    const wrapper = mount(page, {props: {context}, attachTo: document.body, global: {provide: provideText(text.port)}});
    cleanup.push(() => wrapper.unmount());
    return {wrapper, settings, remote, failures};
}

const ready = async (wrapper: ReturnType<typeof open>["wrapper"]) => waitUntil("页面取到目录", () => wrapper.find("[data-profile-rail-item]").exists(), {timeoutMs: 20_000});

describe("目录", () => {
    it("先订阅再取；事件和重连都重取，晚到的旧结果不盖新的", async () => {
        let list: readonly ProfileEntry[] = [MAIN];
        const remote = fakeRemote({listed: () => list});
        const {wrapper} = open({remote});
        await ready(wrapper);
        expect(remote.calls.slice(0, 2)).toEqual(["subscribe", "profiles"]);

        list = [MAIN, MINE];
        remote.fire();
        await waitUntil("事件后重取", () => wrapper.find("[data-profile-rail-item='user.mine']").exists());

        list = [MAIN];
        remote.resync();
        await waitUntil("重连后重取", () => !wrapper.find("[data-profile-rail-item='user.mine']").exists());

        // 第一次重取挂着时列表又变了、又来一个事件：先发出去的结果不算。
        remote.hold();
        list = [MAIN, MINE];
        remote.fire();
        await flushPromises();
        list = [MAIN];
        remote.fire();
        await flushPromises();
        remote.resume();
        await flushPromises();
        expect(wrapper.find("[data-profile-rail-item='user.mine']").exists()).toBe(false);
    });

    it("读失败显示原因与重试，重试成功后显示列表；已经显示着时重取失败不换成失败态", async () => {
        let failing: string | null = "unavailable";
        const remote = fakeRemote({failList: () => failing});
        const {wrapper} = open({remote});
        await waitUntil("失败态", () => wrapper.find("[data-profile-load-failed]").exists(), {timeoutMs: 20_000});
        expect(wrapper.find("[data-profile-load-failed]").attributes("role")).toBe("alert");
        failing = null;
        await wrapper.get("[data-profile-retry]").trigger("click");
        await ready(wrapper);
        failing = "unavailable";
        remote.fire();
        await flushPromises();
        expect(wrapper.find("[data-profile-rail-item]").exists()).toBe(true);
    });

    it("关页面时释放订阅", async () => {
        const remote = fakeRemote();
        const {wrapper} = open({remote});
        await ready(wrapper);
        wrapper.unmount();
        cleanup.pop();
        expect(remote.released()).toBe(1);
    });

    it("选中的 Profile 消失时回到第一项", async () => {
        let list: readonly ProfileEntry[] = [MAIN, MINE];
        const remote = fakeRemote({listed: () => list});
        const {wrapper} = open({remote});
        await ready(wrapper);
        await wrapper.get("[data-profile-rail-item='user.mine']").trigger("click");
        expect(wrapper.find("[data-profile-detail='user.mine']").exists()).toBe(true);
        list = [MAIN];
        remote.fire();
        await waitUntil("回到第一项", () => wrapper.find("[data-profile-detail='nbook.agent.main']").exists());
    });
});

describe("左栏", () => {
    it("后台的放最后一组；上下键、Home、End 移动并选中，只有当前项在 Tab 序列里", async () => {
        const {wrapper} = open();
        await ready(wrapper);
        const items = () => wrapper.findAll("[data-profile-rail-item]");
        expect(items().map((item) => item.attributes("data-profile-rail-item"))).toEqual(["nbook.agent.main", "user.mine", "nbook.agent.session-title"]);
        expect(items().map((item) => item.attributes("tabindex"))).toEqual(["0", "-1", "-1"]);
        await items()[0]!.trigger("keydown", {key: "ArrowDown"});
        expect(wrapper.find("[data-profile-detail='user.mine']").exists()).toBe(true);
        await items()[1]!.trigger("keydown", {key: "End"});
        expect(wrapper.find("[data-profile-detail='nbook.agent.session-title']").exists()).toBe(true);
        await items()[2]!.trigger("keydown", {key: "Home"});
        expect(wrapper.find("[data-profile-detail='nbook.agent.main']").exists()).toBe(true);
    });

    it("后台的 Profile 没有审批一行", async () => {
        const {wrapper} = open();
        await ready(wrapper);
        expect(wrapper.find("[data-profile-approval]").exists()).toBe(true);
        await wrapper.get("[data-profile-rail-item='nbook.agent.session-title']").trigger("click");
        expect(wrapper.find("[data-profile-approval]").exists()).toBe(false);
        expect(wrapper.find("[data-profile-model]").exists()).toBe(true);
    });
});

describe("模型与审批的写入", () => {
    const settingsValue = (settings: ReturnType<typeof open>["settings"]) => settings.get(agentSettings.settings.profileSettings);

    it("选模型、选角色、跟随默认写回设置，回执前页面已经显示新值", async () => {
        const {wrapper, settings} = open();
        await ready(wrapper);
        const detail = wrapper.findComponent(ProfileDetail);
        detail.vm.$emit("model", "p/a");
        await wrapper.vm.$nextTick();
        expect(wrapper.findComponent(ProfileDetail).props("profile").model.value).toBe("p/a");
        await waitUntil("写进设置", () => settingsValue(settings)["nbook.agent.main"]?.model === "p/a");

        wrapper.findComponent(ProfileDetail).vm.$emit("model", "role:main");
        await waitUntil("换成角色", () => settingsValue(settings)["nbook.agent.main"]?.role === "main");
        expect(settingsValue(settings)["nbook.agent.main"]?.model).toBeUndefined();

        wrapper.findComponent(ProfileDetail).vm.$emit("model", "");
        await waitUntil("跟随默认时不留 key", () => settingsValue(settings)["nbook.agent.main"] === undefined);
    });

    it("连着改模型和审批不等结算，两个都存下；改两个 Profile 也不互相盖", async () => {
        const {wrapper, settings} = open();
        await ready(wrapper);
        const detail = wrapper.findComponent(ProfileDetail);
        detail.vm.$emit("model", "p/a");
        detail.vm.$emit("approval", "auto");
        await wrapper.get("[data-profile-rail-item='user.mine']").trigger("click");
        wrapper.findComponent(ProfileDetail).vm.$emit("approval", "yolo");
        await waitUntil("都存下", () => settingsValue(settings)["user.mine"]?.approvalMode === "yolo");
        expect(settingsValue(settings)).toEqual({"nbook.agent.main": {model: "p/a", approvalMode: "auto"}, "user.mine": {approvalMode: "yolo"}});
    });

    it("写失败走窗口通知，页面回到设置里的实际值", async () => {
        const {wrapper, settings, failures} = open();
        await ready(wrapper);
        const update = settings.update.bind(settings);
        settings.update = (async () => ({ok: false, code: "unavailable", detail: ""})) as never;
        wrapper.findComponent(ProfileDetail).vm.$emit("model", "p/a");
        await waitUntil("通知", () => failures.length === 1);
        await flushPromises();
        expect(wrapper.findComponent(ProfileDetail).props("profile").model.value).toBe("");
        settings.update = update;
    });
});

describe("只读", () => {
    it("这一层不能写时写入控件停用，“打开文件”照常", async () => {
        const opened: string[] = [];
        const {wrapper} = open({writable: false, openAddress: (address) => void opened.push(address)});
        await ready(wrapper);
        await wrapper.get("[data-profile-rail-item='user.mine']").trigger("click");
        expect(wrapper.get("[data-profile-delete]").attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-profile-model] input").attributes("disabled")).toBeDefined();
        expect(wrapper.findAll("[data-profile-create]").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
        await wrapper.get("[data-profile-open-file]").trigger("click");
        expect(opened).toEqual(["user://profiles/mine.profile.tsx"]);
    });
});
