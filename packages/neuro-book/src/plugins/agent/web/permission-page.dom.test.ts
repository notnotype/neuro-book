/**
 * “权限规则”页与规则写入（docs/specs/agent/permissions.md 输出 22、23）：配置是设置场景的局部宿主（产品里同一个配置实例），用户层的拥有者在内存里。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {readonly, ref} from "vue";
import type {Ref} from "vue";

import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import type {SettingsService} from "nbook/shared/settings";
import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import type {Rule} from "../shared/permissions";
import {agentSettings} from "../shared/settings";
import {agentCatalogs} from "./text";
import PermissionRulesPage from "./components/PermissionRulesPage.vue";
import {permissionsPage} from "./permission-page";
import {createRulesWriter} from "./permission-writes";
import {createSettingWriter} from "./setting-writes";

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

const rule = (pattern: string, action: Rule["action"] = "allow"): Rule => ({tool: "shell", when: {type: "command", pattern}, action});
const RULES_KEY = agentSettings.settings.permissionRules.key;

function settingsWith(rules: readonly Rule[]) {
    const settings = Object.values(agentSettings.settings).map((definition) => ({plugin: "nbook.agent", definition}));
    const host = createSettingsHost({settings, sections: [], user: {values: rules.length === 0 ? {} : {[RULES_KEY]: rules}}, notify: () => undefined, report: () => undefined});
    cleanup.push(() => host.dispose());
    return host.service("nbook.agent");
}

describe("规则写入", () => {
    it("同一拍追加两次，两条都存下，先后不变", async () => {
        const settings = settingsWith([rule("git *", "deny")]);
        const writer = createRulesWriter(settings);
        const results = await Promise.all([writer.append([rule("touch *")]), writer.append([rule("mkdir *")])]);
        expect(results.every((result) => result.ok)).toBe(true);
        expect(settings.get(agentSettings.settings.permissionRules)).toEqual([rule("git *", "deny"), rule("touch *"), rule("mkdir *")]);
    });

    it("键还不在用户层时也能写", async () => {
        const settings = settingsWith([]);
        expect(await createRulesWriter(settings).append([rule("touch *")])).toEqual({ok: true});
        expect(settings.get(agentSettings.settings.permissionRules)).toEqual([rule("touch *")]);
    });
});

describe("写入队列（别处抢先写了）", () => {
    /** 这个写入发出之前，另一个窗口抢先写了 `other`：比较的值已经过时。只抢前 `times` 次。 */
    const raced = (settings: SettingsService, other: () => Rule[], times = 1): SettingsService => {
        let left = times;
        return {
            ...settings,
            inspect: settings.inspect.bind(settings),
            get: settings.get.bind(settings),
            update: (async (setting: never, value: never, options: never) => {
                if (left > 0) {
                    left -= 1;
                    await settings.update(agentSettings.settings.permissionRules, other());
                }
                return settings.update(setting, value, options);
            }) as SettingsService["update"],
        };
    };

    it("edit 按新值再求一次，两边的都留下", async () => {
        const settings = settingsWith([]);
        const writer = createSettingWriter(raced(settings, () => [rule("别处 *")]), agentSettings.settings.permissionRules);
        expect(await writer.edit((current) => [...current, rule("这里 *")])).toEqual({ok: true});
        expect(settings.get(agentSettings.settings.permissionRules)).toEqual([rule("别处 *"), rule("这里 *")]);
    });

    it("edit 重试一次后还冲突就交回 conflict，不再写", async () => {
        const settings = settingsWith([]);
        let counter = 0;
        const writer = createSettingWriter(raced(settings, () => [rule(`别处 ${String((counter += 1))}`)], 2), agentSettings.settings.permissionRules);
        expect(await writer.edit((current) => [...current, rule("这里 *")])).toMatchObject({ok: false, code: "conflict"});
        expect(settings.get(agentSettings.settings.permissionRules)).toEqual([rule("别处 2")]);
    });

    it("replace 不重试：得 conflict，别处的改动留着", async () => {
        const settings = settingsWith([]);
        const writer = createSettingWriter(raced(settings, () => [rule("别处 *")]), agentSettings.settings.permissionRules);
        expect(await writer.replace([rule("这里 *")])).toMatchObject({ok: false, code: "conflict"});
        expect(settings.get(agentSettings.settings.permissionRules)).toEqual([rule("别处 *")]);
    });

    it("连着 edit 两次不等结算，都在上一次的结果上求", async () => {
        const settings = settingsWith([]);
        const writer = createSettingWriter(settings, agentSettings.settings.permissionRules);
        const results = await Promise.all([writer.edit((current) => [...current, rule("一 *")]), writer.edit((current) => [...current, rule("二 *")])]);
        expect(results.every((result) => result.ok)).toBe(true);
        expect(settings.get(agentSettings.settings.permissionRules)).toEqual([rule("一 *"), rule("二 *")]);
    });
});

function open(options: {readonly rules?: readonly Rule[]; readonly project?: string | null; readonly projectResult?: unknown; readonly writable?: boolean} = {}) {
    const text = createHostTextEngine({locale: "zh-CN", strict: true});
    text.register("nbook.agent", agentCatalogs.catalogs, agentCatalogs.source);
    text.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
    const settings = settingsWith(options.rules ?? []);
    const failures: string[] = [];
    const reports: string[] = [];
    const page = permissionsPage(PermissionRulesPage, {
        settings,
        remote: {projectPermissionRules: async () => (options.projectResult ?? {ok: true, value: []}) as never},
        project: options.project ?? null,
        text: text.port,
        writer: createRulesWriter(settings),
        report: (code) => void reports.push(code),
    });
    const context = {
        id: "nbook.agent.permissions",
        layer: readonly(ref("user")) as Readonly<Ref<"user">>,
        projectTitle: readonly(ref("雨夜")),
        writable: readonly(ref(options.writable ?? true)),
        reportWriteFailure: (subject: string) => void failures.push(subject),
    } as unknown as SettingsPageContext;
    const wrapper = mount(page, {global: {provide: provideText(text.port)}, props: {context}, attachTo: document.body});
    cleanup.push(() => wrapper.unmount());
    return {settings, wrapper, failures, reports};
}
const stored = (settings: ReturnType<typeof settingsWith>) => settings.get(agentSettings.settings.permissionRules);

describe("权限规则页", () => {
    it("连点两下删除：第二下在第一下的结果上算，不会把删掉的写回来", async () => {
        const {settings, wrapper} = open({rules: [rule("a *"), rule("b *"), rule("c *")]});
        await flushPromises();
        const removeFirst = () => wrapper.findAll("[data-permission-rule]")[0]!.findAll("button").at(-1)!;
        await removeFirst().trigger("click");
        expect(wrapper.findAll("[data-permission-rule]")).toHaveLength(2);
        await removeFirst().trigger("click");
        await flushPromises();
        expect(stored(settings)).toEqual([rule("c *")]);
    });

    it("上移：顺序写回；不能写时按钮都停用", async () => {
        const {settings, wrapper} = open({rules: [rule("a *"), rule("b *")]});
        await flushPromises();
        await wrapper.findAll("[data-permission-rule]")[1]!.findAll("button")[0]!.trigger("click");
        await flushPromises();
        expect(stored(settings)).toEqual([rule("b *"), rule("a *")]);
        const barred = open({rules: [rule("a *")], writable: false});
        await flushPromises();
        expect(barred.wrapper.get("[data-permission-add]").attributes("disabled")).toBeDefined();
        expect(barred.wrapper.get("[data-permission-rule]").findAll("button").every((button) => button.attributes("disabled") !== undefined)).toBe(true);
    });

    it("这本书的规则：只读列出，放行标不生效；文件坏了、请求失败都写明，不当成没有规则", async () => {
        const listed = open({project: "p", projectResult: {ok: true, value: [rule("git push *", "deny"), rule("touch *")]}});
        await flushPromises();
        const section = listed.wrapper.get("[data-permission-project]");
        expect(section.text()).toContain("git push *");
        expect(section.findAll(".is-ignored")).toHaveLength(1);
        expect(section.findAll("button")).toHaveLength(0);

        const invalid = open({project: "p", projectResult: {ok: true, value: "invalid"}});
        await flushPromises();
        expect(invalid.wrapper.find("[data-permission-project] [role='status']").exists()).toBe(true);

        const failed = open({project: "p", projectResult: {ok: false, code: "unavailable"}});
        await flushPromises();
        expect(failed.wrapper.find("[data-permission-project] [role='status']").exists()).toBe(true);
        expect(failed.reports).toEqual(["project-rules-unavailable"]);

        const unbound = open();
        await flushPromises();
        expect(unbound.wrapper.find("[data-permission-project]").exists()).toBe(false);
    });

    it("只读命令失去焦点才写，一行一条；页面关掉时也写", async () => {
        const {settings, wrapper} = open();
        await flushPromises();
        const box = wrapper.get("[data-permission-others] textarea");
        await box.setValue("npm ls\n\n  git log \n");
        expect(settings.get(agentSettings.settings.readOnlyCommands)).toEqual([]);
        await box.trigger("blur");
        await flushPromises();
        expect(settings.get(agentSettings.settings.readOnlyCommands)).toEqual(["npm ls", "git log"]);
        await wrapper.get("[data-permission-others] textarea").setValue("cargo tree");
        wrapper.unmount();
        await flushPromises();
        expect(settings.get(agentSettings.settings.readOnlyCommands)).toEqual(["cargo tree"]);
    });
});
