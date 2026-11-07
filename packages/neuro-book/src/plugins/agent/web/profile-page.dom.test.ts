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

describe("工具", () => {
    const bindings = (settings: ReturnType<typeof open>["settings"]) => settings.get(agentSettings.settings.toolBindings);
    const removeButton = (wrapper: ReturnType<typeof open>["wrapper"], id: string) => wrapper.get(`[data-profile-tool="${id}"] [data-profile-tool-remove]`);
    const addDialog = () => document.body.querySelector("[data-profile-add-tools]")!;
    const click = (element: Element | null | undefined) => (element as HTMLElement).click();
    const confirmAdd = () => click([...addDialog().querySelectorAll("button")].find((button) => button.textContent?.trim() === "完成"));

    it("必需的标必需、没有去掉按钮；可访问名称分得清同名工具", async () => {
        const {wrapper} = open({values: {[agentSettings.settings.toolBindings.key]: {"nbook.agent.main": {added: ["plot.search"], removed: []}}}});
        await ready(wrapper);
        expect(wrapper.get("[data-profile-tool='nbook.agent.read']").find("[data-profile-tool-remove]").exists()).toBe(false);
        expect(removeButton(wrapper, "nbook.agent.edit").attributes("aria-label")).toContain("nbook.agent.edit");
        expect(wrapper.findAll("[data-profile-tool-group]").map((group) => group.attributes("data-profile-tool-group"))).toEqual(["nbook.agent", "nbook.plot"]);
    });

    it("去掉写进 removed；连点两个不等结算，两个都生效；页面立刻不再列", async () => {
        const remote = fakeRemote({listed: () => [{...MAIN, tools: {required: ["nbook.agent.read"], optional: ["nbook.agent.edit", "plot.search"]}}]});
        const {wrapper, settings} = open({remote});
        await ready(wrapper);
        await removeButton(wrapper, "nbook.agent.edit").trigger("click");
        await removeButton(wrapper, "plot.search").trigger("click");
        expect(wrapper.find("[data-profile-tool='nbook.agent.edit']").exists()).toBe(false);
        expect(wrapper.find("[data-profile-tool='plot.search']").exists()).toBe(false);
        await waitUntil("两个都写下", () => bindings(settings)["nbook.agent.main"]?.removed.length === 2);
        expect(bindings(settings)["nbook.agent.main"]).toEqual({added: [], removed: ["nbook.agent.edit", "plot.search"]});
    });

    it("恢复默认删掉这个 key，别的 Profile 不动", async () => {
        const other = {added: ["plot.search"], removed: []};
        const {wrapper, settings} = open({values: {[agentSettings.settings.toolBindings.key]: {"nbook.agent.main": {added: [], removed: ["nbook.agent.edit"]}, "user.mine": other}}});
        await ready(wrapper);
        await wrapper.get("[data-profile-tools-restore]").trigger("click");
        await waitUntil("删掉", () => bindings(settings)["nbook.agent.main"] === undefined);
        expect(bindings(settings)).toEqual({"user.mine": other});
        expect(wrapper.find("[data-profile-tools-restore]").exists()).toBe(false);
    });

    it("添加：一次写入多项，同名的同一次换掉，取消不写，没改动直接关", async () => {
        const {wrapper, settings} = open();
        await ready(wrapper);
        await wrapper.get("[data-profile-tools-add]").trigger("click");
        await waitUntil("对话框", () => addDialog() !== null);
        const toggle = (id: string) => click(addDialog().querySelector(`[data-add-tool="${id}"] [data-add-tool-toggle]`));
        expect(addDialog().querySelector("[data-add-tool='nbook.agent.edit-replace'] [data-add-tool-replaces]")).not.toBeNull();
        toggle("plot.search");
        toggle("nbook.agent.edit-replace");
        await flushPromises();
        confirmAdd();
        await waitUntil("写下", () => bindings(settings)["nbook.agent.main"] !== undefined);
        expect(bindings(settings)["nbook.agent.main"]).toEqual({added: ["nbook.agent.edit-replace", "plot.search"], removed: ["nbook.agent.edit"]});
        await waitUntil("完成后关掉", () => document.body.querySelector("[data-profile-add-tools]") === null || wrapper.findComponent({name: "AddToolsDialog"}).props("open") === false);
    });

    it("添加：必需的同名工具换不了，按钮停用并写原因", async () => {
        const remote = fakeRemote({listed: () => [{...MAIN, tools: {required: ["nbook.agent.edit"], optional: []}}]});
        const {wrapper} = open({remote});
        await ready(wrapper);
        await wrapper.get("[data-profile-tools-add]").trigger("click");
        await waitUntil("对话框", () => addDialog() !== null);
        const row = addDialog().querySelector("[data-add-tool='nbook.agent.edit-replace']")!;
        expect((row.querySelector("[data-add-tool-toggle]") as HTMLButtonElement).disabled).toBe(true);
        expect(row.textContent).toContain("必需");
    });

    it("添加：写失败留在对话框并写原因，不走窗口通知", async () => {
        const {wrapper, settings, failures} = open();
        await ready(wrapper);
        settings.update = (async () => ({ok: false, code: "unavailable", detail: ""})) as never;
        await wrapper.get("[data-profile-tools-add]").trigger("click");
        await waitUntil("对话框", () => addDialog() !== null);
        click(addDialog().querySelector("[data-add-tool='plot.search'] [data-add-tool-toggle]"));
        await flushPromises();
        confirmAdd();
        await waitUntil("写出原因", () => wrapper.findComponent({name: "AddToolsDialog"}).props("status") !== "");
        expect(wrapper.findComponent({name: "AddToolsDialog"}).props("open")).toBe(true);
        expect(failures).toEqual([]);
    });

    it("添加：打开期间目录变了，候选不刷新；完成时按当时的设置值写，别处的改动留着", async () => {
        let list: readonly ProfileEntry[] = [MAIN];
        const remote = fakeRemote({listed: () => list});
        const {wrapper, settings} = open({remote});
        await ready(wrapper);
        await wrapper.get("[data-profile-tools-add]").trigger("click");
        await waitUntil("对话框", () => addDialog() !== null);
        const rows = () => [...addDialog().querySelectorAll("[data-add-tool]")].map((row) => row.getAttribute("data-add-tool"));
        const before = rows();
        // 候选里的工具变成 Profile 本来就有的；别处同时改了另一个 Profile 的绑定。
        list = [{...MAIN, tools: {required: ["nbook.agent.read"], optional: ["nbook.agent.edit", "plot.search"]}}];
        remote.fire();
        await flushPromises();
        expect(rows()).toEqual(before);
        await settings.update(agentSettings.settings.toolBindings, {"user.mine": {added: ["plot.search"], removed: []}});
        click(addDialog().querySelector("[data-add-tool='nbook.agent.edit-replace'] [data-add-tool-toggle]"));
        await flushPromises();
        confirmAdd();
        await waitUntil("写下", () => bindings(settings)["nbook.agent.main"] !== undefined);
        expect(bindings(settings)["user.mine"]).toEqual({added: ["plot.search"], removed: []});
    });

    it("选中的 Profile 变了，对话框关掉", async () => {
        const {wrapper} = open();
        await ready(wrapper);
        await wrapper.get("[data-profile-tools-add]").trigger("click");
        await waitUntil("对话框", () => addDialog() !== null);
        await wrapper.get("[data-profile-rail-item='user.mine']").trigger("click");
        await waitUntil("关掉", () => wrapper.findComponent({name: "AddToolsDialog"}).props("open") === false);
    });
});

describe("用户级 Profile", () => {
    const dialog = () => document.body.querySelector("[data-profile-new]");
    const buttonIn = (root: Element, label: string) => [...root.querySelectorAll("button")].find((button) => button.textContent?.trim() === label) as HTMLButtonElement;
    const typeName = async (value: string) => {
        const input = dialog()!.querySelector("input")!;
        input.value = value;
        input.dispatchEvent(new Event("input"));
        await flushPromises();
    };

    it("新建：出现在列表里并选中，打开文件", async () => {
        let list: readonly ProfileEntry[] = [MAIN];
        const remote = fakeRemote({listed: () => list});
        (remote.remote as {createUserProfile: unknown}).createUserProfile = async (input: {name: string}) => {
            list = [MAIN, {...MINE, key: `user.${input.name}`, name: input.name}];
            return {ok: true, value: {key: `user.${input.name}`, address: `user://profiles/${input.name}.profile.tsx`}};
        };
        const opened: string[] = [];
        const {wrapper} = open({remote, openAddress: (address) => void opened.push(address)});
        await ready(wrapper);
        await wrapper.get("[data-profile-create]").trigger("click");
        await waitUntil("对话框", () => dialog() !== null);
        await typeName("lore-check");
        buttonIn(dialog()!, "新建并打开").click();
        await waitUntil("选中新的", () => wrapper.find("[data-profile-detail='user.lore-check']").exists());
        expect(opened).toEqual(["user://profiles/lore-check.profile.tsx"]);
    });

    it("新建：目录事件接连来、重取被顶掉时，照样选中新的", async () => {
        let list: readonly ProfileEntry[] = [MAIN, MINE];
        const remote = fakeRemote({listed: () => list});
        (remote.remote as {createUserProfile: unknown}).createUserProfile = async (input: {name: string}) => {
            list = [MAIN, MINE, {...MINE, key: `user.${input.name}`, name: input.name}];
            // 建好之后、页面重取挂着时，服务端的目录事件也到了。
            remote.hold();
            void (async () => {
                await flushPromises();
                remote.fire();
                // 先放行被顶掉的那次，等页面处理完，才放行最新的：`await load()` 要等到最新的才算数。
                remote.releaseOne();
                await flushPromises();
                remote.resume();
            })();
            return {ok: true, value: {key: `user.${input.name}`, address: `user://profiles/${input.name}.profile.tsx`}};
        };
        const {wrapper} = open({remote});
        await ready(wrapper);
        // 当前项不是第一项：选中的还不在目录里时页面会退回第一项，把选中改掉。
        await wrapper.get("[data-profile-rail-item='user.mine']").trigger("click");
        await wrapper.get("[data-profile-create]").trigger("click");
        await waitUntil("对话框", () => dialog() !== null);
        await typeName("racing");
        buttonIn(dialog()!, "新建并打开").click();
        await waitUntil("选中新的", () => wrapper.find("[data-profile-detail='user.racing']").exists());
        await flushPromises();
        expect(wrapper.find("[data-profile-detail='user.racing']").exists()).toBe(true);
    });

    it("新建：名字不合规则不发请求；同名留在对话框写原因", async () => {
        const names: string[] = [];
        const remote = fakeRemote();
        (remote.remote as {createUserProfile: unknown}).createUserProfile = async (input: {name: string}) => {
            names.push(input.name);
            return {ok: false, code: "exists"};
        };
        const {wrapper} = open({remote});
        await ready(wrapper);
        await wrapper.get("[data-profile-create]").trigger("click");
        await waitUntil("对话框", () => dialog() !== null);
        await typeName("Bad Name");
        buttonIn(dialog()!, "新建并打开").click();
        await flushPromises();
        expect(names).toEqual([]);
        expect(dialog()!.textContent).toContain("小写字母");
        await typeName("mine");
        buttonIn(dialog()!, "新建并打开").click();
        await waitUntil("写出原因", () => dialog()!.textContent?.includes("同名") === true);
        expect(names).toEqual(["mine"]);
    });

    it("删除：确认文字写明不能恢复、会话变只读；确认后回到第一项；取消不删", async () => {
        let list: readonly ProfileEntry[] = [MAIN, MINE];
        const remote = fakeRemote({listed: () => list});
        const deleted: string[] = [];
        (remote.remote as {deleteUserProfile: unknown}).deleteUserProfile = async (input: {key: string}) => {
            deleted.push(input.key);
            list = [MAIN];
            return {ok: true, value: {}};
        };
        const {wrapper} = open({remote});
        await ready(wrapper);
        await wrapper.get("[data-profile-rail-item='user.mine']").trigger("click");
        await wrapper.get("[data-profile-delete]").trigger("click");
        const alert = () => document.body.querySelector("[role='alertdialog']");
        await waitUntil("确认框", () => alert() !== null);
        expect(alert()!.textContent).toContain("不能恢复");
        expect(alert()!.textContent).toContain("只读");
        buttonIn(alert()!, "取消").click();
        await waitUntil("确认框关掉", () => alert() === null);
        expect(deleted).toEqual([]);

        await wrapper.get("[data-profile-delete]").trigger("click");
        await waitUntil("确认框", () => alert() !== null);
        buttonIn(alert()!, "删除").click();
        await waitUntil("回到第一项", () => wrapper.find("[data-profile-detail='nbook.agent.main']").exists());
        expect(deleted).toEqual(["user.mine"]);
    });

    it("删除失败走窗口通知，Profile 还在", async () => {
        const remote = fakeRemote({listed: () => [MAIN, MINE]});
        (remote.remote as {deleteUserProfile: unknown}).deleteUserProfile = async () => ({ok: false, code: "unavailable"});
        const {wrapper, failures} = open({remote});
        await ready(wrapper);
        await wrapper.get("[data-profile-rail-item='user.mine']").trigger("click");
        await wrapper.get("[data-profile-delete]").trigger("click");
        const alert = () => document.body.querySelector("[role='alertdialog']");
        await waitUntil("确认框", () => alert() !== null);
        buttonIn(alert()!, "删除").click();
        await waitUntil("通知", () => failures.length === 1);
        expect(wrapper.find("[data-profile-rail-item='user.mine']").exists()).toBe(true);
    });
});

describe("别处抢先写了（设置项是一整份 Record）", () => {
    /** 这次写入发出之前，另一个窗口抢先写了别的 key：比较的值已经过时。只抢一次。 */
    function racing(settings: ReturnType<typeof open>["settings"], other: () => Promise<unknown>): void {
        const update = settings.update.bind(settings);
        settings.update = (async (setting: never, value: never, options: never) => {
            settings.update = update;
            await other();
            return update(setting, value, options);
        }) as never;
    }

    it("模型与审批：重算后两边的 key 和同一 Profile 的别的字段都留着", async () => {
        const {wrapper, settings} = open({values: {[agentSettings.settings.profileSettings.key]: {"nbook.agent.main": {approvalMode: "ask"}}}});
        await ready(wrapper);
        const setting = agentSettings.settings.profileSettings;
        racing(settings, () => settings.update(setting, {"nbook.agent.main": {approvalMode: "auto"}, "user.mine": {role: "main"}}));
        wrapper.findComponent(ProfileDetail).vm.$emit("model", "p/a");
        await waitUntil("写下", () => settings.get(setting)["nbook.agent.main"]?.model === "p/a");
        expect(settings.get(setting)).toEqual({"nbook.agent.main": {approvalMode: "auto", model: "p/a"}, "user.mine": {role: "main"}});
    });

    it("工具：重算后别的 Profile 的绑定留着，这个 Profile 也按新值算", async () => {
        const {wrapper, settings} = open();
        await ready(wrapper);
        const setting = agentSettings.settings.toolBindings;
        const other = {added: ["plot.search"], removed: []};
        racing(settings, () => settings.update(setting, {"user.mine": other, "nbook.agent.main": {added: ["plot.search"], removed: []}}));
        await wrapper.get("[data-profile-tool='nbook.agent.edit'] [data-profile-tool-remove]").trigger("click");
        await waitUntil("写下", () => settings.get(setting)["nbook.agent.main"]?.removed.length === 1);
        expect(settings.get(setting)).toEqual({"user.mine": other, "nbook.agent.main": {added: ["plot.search"], removed: ["nbook.agent.edit"]}});
    });

    it("重试后还冲突：走窗口通知，页面回到设置里的实际值", async () => {
        const {wrapper, settings, failures} = open();
        await ready(wrapper);
        const setting = agentSettings.settings.profileSettings;
        const update = settings.update.bind(settings);
        let counter = 0;
        settings.update = (async (definition: never, value: never, options: never) => {
            counter += 1;
            await update(setting, {"user.mine": {role: `r${String(counter)}`}});
            return update(definition, value, options);
        }) as never;
        wrapper.findComponent(ProfileDetail).vm.$emit("model", "p/a");
        await waitUntil("通知", () => failures.length === 1);
        await flushPromises();
        expect(counter).toBe(2);
        expect(wrapper.findComponent(ProfileDetail).props("profile").model.value).toBe("");
    });

    it("前一次写失败、后一次还在队里：后一次照常生效，失败的不留在页面上", async () => {
        const {wrapper, settings, failures} = open();
        await ready(wrapper);
        const setting = agentSettings.settings.profileSettings;
        const update = settings.update.bind(settings);
        let first = true;
        settings.update = (async (definition: never, value: never, options: never) => {
            if (first) {
                first = false;
                return {ok: false, code: "unavailable", detail: ""};
            }
            return update(definition, value, options);
        }) as never;
        const detail = wrapper.findComponent(ProfileDetail);
        detail.vm.$emit("model", "p/a");
        detail.vm.$emit("approval", "auto");
        await waitUntil("通知", () => failures.length === 1);
        await waitUntil("后一次写下", () => settings.get(setting)["nbook.agent.main"]?.approvalMode === "auto");
        await flushPromises();
        expect(settings.get(setting)["nbook.agent.main"]?.model).toBeUndefined();
        expect(wrapper.findComponent(ProfileDetail).props("profile").model.value).toBe("");
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
        expect(wrapper.get("[data-profile-create]").attributes("disabled")).toBeDefined();
        expect(wrapper.get("[data-profile-create-short]").attributes("disabled")).toBeDefined();
        await wrapper.get("[data-profile-open-file]").trigger("click");
        expect(opened).toEqual(["user://profiles/mine.profile.tsx"]);
    });
});
