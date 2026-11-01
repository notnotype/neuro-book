/**
 * 片段设置页的交互（`SnippetsPage.vue` 与 `SnippetsEditor.vue`）：把页面挂在 happy-dom 里，像用户那样点按钮、改输入框，
 * 再看配置文件里真的写了什么。场景 06 在 Bun 里核对插件的声明、交付与按层写入，但 Bun 不能加载 `.vue`，页面本身由
 * 这个测试负责，由 Vitest 运行（`plugin-sdk/examples/README.md` 的“运行”）。
 *
 * 要说明的事：
 * - “用户”标签下改的是用户层：添加、下移、改名都写进 `<状态根>/settings.json`；名字为空不合 schema，写入被拒，
 *   页面在状态行里写出原因，输入框回到文件里的值。
 * - “本作品”标签下本作品层没写：页面显示用户设置的列表、标“来自用户设置”，编辑器照常可用；第一次删除把删好的整份
 *   列表写进本作品层，用户层不变；“移除本作品的设置”删掉本作品层的键，又回到沿用。
 *
 * 场地：`nbook.settings` 的多实例场地（`src/plugins/settings/testing/world.ts`）——服务端、项目 `book` 与绑定它的窗口，
 * 每层的拥有者读写场景临时目录里的真实文件。不用示例自己的 `testing/stage.ts`：它装了 `nbook.storage`，SQLite 只在
 * Bun 里有，而组件测试在 Node 里跑。页面拿到的配置服务以 `example.snippets` 的身份取得，和产品里一样只能写本插件
 * 声明的项（docs/specs/settings/configuration.md 输出第 11 条）。
 *
 * 行为合同：docs/specs/settings/settings-window.md 输出第 6、9、10、12、14、18 条。
 */

import {readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {flushPromises, mount} from "@vue/test-utils";
import {afterAll, afterEach, beforeAll, describe, expect, it} from "vitest";
import {readonly, ref} from "vue";

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {settingsWorld} from "nbook/plugins/settings/testing/world";
import {settingsTestText} from "nbook/plugins/settings/testing/text";
import type {SettingsWorld} from "nbook/plugins/settings/testing/world";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import type {SettingLayer, SettingsService} from "nbook/shared/settings";
import {provideText} from "nbook/shared/testing/text-port";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import enUS from "../locales/en-US.json";
import zhCN from "../locales/zh-CN.json";
import {descriptor} from "../plugin";
import {itemsSetting, plugin, SNIPPETS_SECTION} from "../shared/contracts";
import type {Snippet} from "../shared/contracts";
import SnippetsPage from "./SnippetsPage.vue";

/**
 * 页面的文字取自插件自己的目录（`../locales/`），设置行的固定文字取自 `nbook.settings` 的目录，两份都登记进宿主的翻译引擎，
 * 像窗口那样注入（严格模式：缺键抛错）。设置行的断言经目录解析。
 */
const {t} = settingsTestText("zh-CN");

function textEngine() {
    const engine = createHostTextEngine({locale: "zh-CN", strict: true});
    engine.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
    engine.register(plugin.id, {"zh-CN": zhCN, "en-US": enUS}, "zh-CN");
    return engine;
}

let tmp = "";
let cases = 0;
const worlds: SettingsWorld[] = [];
const mounted: Array<{unmount(): void}> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-examples", "示例 snippets 的设置页");
});

afterEach(async () => {
    for (const wrapper of mounted.splice(0)) wrapper.unmount();
    document.body.innerHTML = "";
    for (const world of worlds.splice(0)) {
        for (const result of await world.close()) expect(result).toMatchObject({status: "closed"});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/**
 * 服务端、项目 `book` 与绑定它的窗口，三处都登记片段的配置项（`definitionAt` 是宿主装配插件的写法，见场景 06）。窗口
 * 里的片段插件只有一个探针入口，交出这个插件自己的配置服务：设置窗口交给页面的就是它。页面挂在一个可以切换的层上，
 * 相当于设置窗口顶部的“用户 | 本作品”。
 */
async function openPage() {
    cases += 1;
    const world = await settingsWorld(join(tmp, `case-${String(cases)}`), [definitionAt("server", descriptor, undefined)]);
    worlds.push(world);
    await world.project(1, [definitionAt("project", descriptor, undefined)]);
    const probe: {settings: SettingsService | null} = {settings: null};
    const snippets = {
        id: descriptor.id,
        entries: [defineEntry({
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: settingsKey}],
            activate: (context) => {
                probe.settings = context.services.require(settingsKey);
                return {};
            },
        })],
    };
    await world.window("w1", [definitionAt("browser", descriptor, snippets)], {bound: true});
    if (probe.settings === null) throw new Error("探针入口没有拿到配置服务");
    const layer = ref<SettingLayer>("user");
    const engine = textEngine();
    const wrapper = mount(SnippetsPage, {
        props: {context: {id: SNIPPETS_SECTION, layer: readonly(layer), projectTitle: readonly(ref("book")), options: {}, writable: readonly(ref(true)), dirty: () => undefined, reportWriteFailure: () => undefined}, settings: probe.settings},
        global: {provide: provideText(engine.port)},
        attachTo: document.body,
    });
    mounted.push(wrapper);
    await flushPromises();
    return {world, wrapper, layer, engine};
}

/** 文件里这一层的片段名；没写这个键为 null。文件在第一次写入时才建，还不存在时按空对象读。 */
async function namesIn(file: string): Promise<string[] | null> {
    const text = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
    });
    const items = (JSON.parse(text) as Record<string, ReadonlyArray<Snippet> | undefined>)[itemsSetting.key];
    return items === undefined ? null : items.map((item) => item.name);
}

describe("片段设置页", () => {
    it("“用户”标签：添加、下移、改名写进用户层；名字为空被拒，状态行写出原因，输入框回到文件里的值；切换界面语言后状态行与按钮换成英文", async () => {
        const {world, wrapper, engine} = await openPage();
        // 用户层还没写：显示默认的三条，能编辑。
        expect(wrapper.findAll("[data-snippet]")).toHaveLength(3);

        await wrapper.find("[data-snippets-editor] > button").trigger("click");
        await waitUntil("添加写进用户层", async () => (await namesIn(world.userFile))?.length === 4);
        expect(await namesIn(world.userFile)).toEqual(["开场白", "场景转换", "章末钩子", "新片段"]);

        await wrapper.find("[data-snippet='0'] button[aria-label='下移']").trigger("click");
        await waitUntil("下移写进用户层", async () => (await namesIn(world.userFile))?.[0] === "场景转换");
        expect(await namesIn(world.userFile)).toEqual(["场景转换", "开场白", "章末钩子", "新片段"]);

        // 改名边打边改草稿，离开输入框才写。
        const name = wrapper.find<HTMLInputElement>("[data-snippet='3'] input");
        await name.setValue("落款");
        expect((await namesIn(world.userFile))?.[3]).toBe("新片段");
        await name.trigger("focusout");
        await waitUntil("改名写进用户层", async () => (await namesIn(world.userFile))?.[3] === "落款");

        await name.setValue("");
        await name.trigger("focusout");
        await waitUntil("状态行写出原因", () => wrapper.find("[data-snippets-problem]").exists());
        expect(wrapper.find("[data-snippets-problem]").text()).toContain("没有保存（invalid-value）");
        expect(wrapper.find<HTMLInputElement>("[data-snippet='3'] input").element.value).toBe("落款");
        expect((await namesIn(world.userFile))?.[3]).toBe("落款");

        // 页面存的是失败本身，句子在显示时按当前语言拼（`SnippetsPage.vue` 的 `problem`）：还没清掉的提示也跟着换语言。
        engine.setLocale("en-US");
        await flushPromises();
        expect(wrapper.find("[data-snippets-problem]").text()).toContain("Not saved (invalid-value)");
        expect(wrapper.find("[data-snippets-editor] > button").text()).toBe("Add Snippet");
        expect(wrapper.find("[data-snippet='0'] button[aria-label='Move Down']").exists()).toBe(true);
    });

    it("“本作品”标签：沿用时编辑器照常可用；第一次删除把删好的整份列表写进本作品层，用户层不变；移除后本作品层清空，回到沿用", async () => {
        const {world, wrapper, layer} = await openPage();
        await wrapper.find("[data-snippets-editor] > button").trigger("click");
        await waitUntil("用户层先有四条", async () => (await namesIn(world.userFile))?.length === 4);

        // 切换标签：设置窗口不重建页面，只是 `context.layer` 变了。
        layer.value = "project";
        await flushPromises();
        const row = () => wrapper.find("[data-settings-row]");
        expect(row().attributes("data-settings-row-state")).toBe("inherit");
        expect(wrapper.find("[data-settings-row-inherited]").text()).toBe(t("row.inherited"));
        expect(wrapper.findAll("[data-snippet]")).toHaveLength(4);
        expect(wrapper.find<HTMLInputElement>("[data-snippet='0'] input").element.disabled).toBe(false);

        await wrapper.find("[data-snippet='0'] button[aria-label='删除']").trigger("click");
        await waitUntil("删好的整份列表写进本作品层", async () => (await namesIn(world.projectFile)) !== null);
        expect(await namesIn(world.projectFile)).toEqual(["场景转换", "章末钩子", "新片段"]);
        expect(await namesIn(world.userFile)).toEqual(["开场白", "场景转换", "章末钩子", "新片段"]);
        await waitUntil("本作品写了", () => row().attributes("data-settings-row-state") === "edit");
        expect(wrapper.find("[data-settings-row-inherited]").exists()).toBe(false);

        await wrapper.find("[data-settings-row-remove]").trigger("click");
        await waitUntil("本作品层的键删掉", async () => (await namesIn(world.projectFile)) === null);
        await waitUntil("回到沿用", () => row().attributes("data-settings-row-state") === "inherit");
    });
});
