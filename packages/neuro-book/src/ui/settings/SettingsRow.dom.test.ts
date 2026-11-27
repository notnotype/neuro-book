/**
 * SettingsRow（同名 .md，docs/specs/settings/settings-window.md 输出 9–13、18）：按配置服务与标签算出已修改、恢复默认、
 * 覆盖提示、沿用标签、只读、状态原因、停用。配置服务来自设置场景的局部宿主：产品里同一个配置实例，层的拥有者在
 * 内存里（同 Lab）。排版（控件靠右、右缘对齐、换行、行高）靠样式，真实布局由 Component Lab 的 Playwright 截图看。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {afterEach, describe, expect, it, vi} from "vitest";
import {h} from "vue";
import {Type} from "typebox";

import {settingsTestText} from "nbook/plugins/settings/testing/text";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import {workbenchCatalogs} from "nbook/plugins/workbench/web/text";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import {createSettingsHost} from "nbook/plugins/settings/web/lab/settings-host";
import type {HostLayer, SettingsHost} from "nbook/plugins/settings/web/lab/settings-host";
import {localeSetting} from "nbook/plugins/settings/shared/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import {defineSetting} from "nbook/shared/settings";
import type {SettingDefinition, SettingLayer} from "nbook/shared/settings";

import SettingsRow from "./SettingsRow.vue";

/** 界面文字取自 `nbook.settings` 的目录（经测试端口），断言也经目录解析，不在测试里重复写一份中文。 */
const port = testTextPort("zh-CN", {"nbook.settings": settingsCatalogs, "nbook.workbench": workbenchCatalogs});
const {t} = settingsTestText("zh-CN");

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

/** 只读（schema 的 `readOnly`）与带生效时机的两项，产品里的三项都没有。 */
const readOnlySetting = defineSetting({plugin: "example.rows", name: "library", schema: Type.String({readOnly: true}), default: "wugang-main", title: {"zh-CN": "书库", "en-US": "Library"}, description: {"zh-CN": "由作品决定", "en-US": "Decided by the book"}});
/** 只能写在本作品层的项：没写时显示默认值，不是“来自用户设置”。 */
const projectOnlySetting = defineSetting({plugin: "example.rows", name: "chapterPrefix", schema: Type.String(), default: "第", title: {"zh-CN": "章节前缀", "en-US": "Chapter prefix"}, layers: ["project"]});
const restartSetting = defineSetting({plugin: "example.rows", name: "workers", schema: Type.Integer({minimum: 1, maximum: 8}), default: 2, title: {"zh-CN": "并发数", "en-US": "Workers"}, description: {"zh-CN": "同时抽取的章节数", "en-US": "Chapters extracted at once"}, applies: "restart"});

function host(layers: {readonly user?: HostLayer; readonly project?: HostLayer}): SettingsHost {
    const created = createSettingsHost({
        settings: [
            {plugin: "nbook.workbench", definition: themeSetting},
            {plugin: "nbook.workbench", definition: appearanceSetting},
            {plugin: "nbook.settings", definition: localeSetting},
            {plugin: "example.rows", definition: readOnlySetting},
            {plugin: "example.rows", definition: restartSetting},
            {plugin: "example.rows", definition: projectOnlySetting},
        ] as ReadonlyArray<{plugin: string; definition: SettingDefinition<unknown>}>,
        sections: [],
        ...layers,
        notify: () => undefined,
        report: () => undefined,
    });
    cleanup.push(() => created.dispose());
    return created;
}

function row(created: SettingsHost, setting: SettingDefinition<unknown>, layer: SettingLayer, extra: Record<string, unknown> = {}) {
    const plugin = setting.key.slice(0, setting.key.indexOf("/"));
    const wrapper = mount(SettingsRow, {
        props: {settings: created.service(plugin), setting, layer, ...extra},
        slots: {default: (slot: {value: unknown; disabled: boolean; id: string; describedby: string | undefined}) => h("span", {"data-slot": "", "data-disabled": String(slot.disabled), "data-describedby": slot.describedby}, [JSON.stringify(slot.value), h("input", {id: slot.id})])},
        global: {provide: provideText(port)},
        attachTo: document.body,
    });
    cleanup.push(() => wrapper.unmount());
    return wrapper;
}

const slotOf = (wrapper: ReturnType<typeof row>) => wrapper.find("[data-slot]");
const dotOf = (wrapper: ReturnType<typeof row>) => wrapper.find("[data-settings-row-dot]");
/** 最右一格：没改过的行也有，所以各行控件的右缘对齐。 */
const cellOf = (wrapper: ReturnType<typeof row>) => wrapper.get("[data-settings-row-cell]");
/** 提示浮层里看得见的各行（浮层在 body 下，不在组件里；读屏用的隐藏副本不算）。 */
const tooltipLines = () => [...document.body.querySelectorAll(".nb-ui-tooltip-surface [data-settings-row-reason-line]")].map((line) => line.textContent);

describe("SettingsRow", () => {
    it("用户标签：这一层写了才算已修改；恢复默认删掉这一层的键，控件回到默认值", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "dark"}}});
        await flushPromises();
        const clean = row(created, themeSetting as SettingDefinition<unknown>, "user");
        expect(clean.attributes("data-settings-row-modified")).toBeUndefined();
        expect(clean.find("[data-settings-row-reset]").exists()).toBe(false);
        expect(dotOf(clean).exists()).toBe(false);
        // 没改过的行也留着最右一格（空的），控件的右缘与改过的行对齐。
        expect(cellOf(clean).element.children).toHaveLength(0);
        expect(slotOf(clean).text()).toBe("\"nbook\"");

        const modified = row(created, appearanceSetting as SettingDefinition<unknown>, "user");
        expect(modified.attributes("data-settings-row-modified")).toBe("");
        // 已修改：标题后一个小圆点（读屏名字“已修改”），恢复默认在最右一格里，是图标按钮。
        expect(dotOf(modified).attributes("aria-label")).toBe(t("row.modified"));
        expect(modified.get("label").element.parentElement?.contains(dotOf(modified).element)).toBe(true);
        expect(cellOf(modified).find("[data-settings-row-reset]").attributes("aria-label")).toBe(t("row.reset"));
        expect(slotOf(modified).text()).toBe("\"dark\"");
        await modified.find("[data-settings-row-reset]").trigger("click");
        await flushPromises();
        expect(created.user.values()).toEqual({});
        expect(modified.attributes("data-settings-row-modified")).toBeUndefined();
        expect(dotOf(modified).exists()).toBe(false);
        expect(slotOf(modified).text()).toBe("\"light\"");
    });

    it("用户标签里本作品层写了：行下提示本作品的值与书名；没有书名时写“本作品”", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "system"}}, project: {values: {"nbook.workbench/appearance": "light"}}});
        await flushPromises();
        const titled = row(created, appearanceSetting as SettingDefinition<unknown>, "user", {projectTitle: "雾港"});
        expect(titled.find("[data-settings-row-overridden]").text()).toBe(t("row.overridden", {title: "雾港", value: "浅色"}));
        const untitled = row(created, appearanceSetting as SettingDefinition<unknown>, "user");
        expect(untitled.find("[data-settings-row-overridden]").text()).toBe(t("row.overriddenUntitled", {value: "浅色"}));
        // 本作品没写的项没有提示。
        expect(row(created, themeSetting as SettingDefinition<unknown>, "user").find("[data-settings-row-overridden]").exists()).toBe(false);
    });

    it("本作品标签：没写时照常画控件、显示用户层的值，标题后标“来自用户设置”；写了有小圆点、没有标签，最右一格的“移除本作品的设置”回到沿用", async () => {
        const created = host({user: {values: {"nbook.workbench/theme": "macos"}}, project: {}});
        await flushPromises();
        const wrapper = row(created, themeSetting as SettingDefinition<unknown>, "project");
        expect(wrapper.attributes("data-settings-row-state")).toBe("inherit");
        const tag = wrapper.get("[data-settings-row-inherited]");
        expect(tag.text()).toBe(t("row.inherited"));
        // 标签不是控件的名字：不在 label 里，经 describedby 念
        expect(wrapper.get("label").text()).toBe("主题");
        expect((slotOf(wrapper).attributes("data-describedby") ?? "").split(" ")).toContain(tag.attributes("id"));
        expect(slotOf(wrapper).text()).toBe("\"macos\"");
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("false");
        expect(dotOf(wrapper).exists()).toBe(false);
        expect(cellOf(wrapper).element.children).toHaveLength(0);
        // 控件改值由调用方写当前标签那一层（产品里是窗口模型）：写进本作品层后行变成“写了”
        await created.service("nbook.workbench").update(themeSetting, "nbook", {layer: "project"});
        await flushPromises();
        expect(created.project?.values()).toEqual({"nbook.workbench/theme": "nbook"});
        expect(created.user.values()).toEqual({"nbook.workbench/theme": "macos"});
        expect(wrapper.attributes("data-settings-row-state")).toBe("edit");
        expect(wrapper.attributes("data-settings-row-modified")).toBe("");
        expect(wrapper.find("[data-settings-row-inherited]").exists()).toBe(false);
        expect(slotOf(wrapper).text()).toBe("\"nbook\"");
        // 写了的项：小圆点，“移除本作品的设置”与“恢复默认”同一个图标按钮、放在最右一格，只是名字不同。
        expect(dotOf(wrapper).exists()).toBe(true);
        const remove = cellOf(wrapper).get("[data-settings-row-remove]");
        expect(remove.attributes("aria-label")).toBe(t("row.remove"));
        expect(remove.text()).toBe("");
        expect(wrapper.find("[data-settings-row-reset]").exists()).toBe(false);
        await remove.trigger("click");
        await flushPromises();
        expect(created.project?.values()).toEqual({});
        expect(wrapper.attributes("data-settings-row-state")).toBe("inherit");
        expect(wrapper.find("[data-settings-row-inherited]").exists()).toBe(true);
        expect(slotOf(wrapper).text()).toBe("\"macos\"");
    });

    it("只能写在本作品层的项没写时显示默认值、不标“来自用户设置”；沿用的行在本作品层文件无效时控件停用、标签照旧", async () => {
        const created = host({user: {values: {"nbook.workbench/theme": "macos"}}, project: {invalid: "第 2 行：缺少引号"}});
        await flushPromises();
        const projectOnly = row(created, projectOnlySetting as SettingDefinition<unknown>, "project");
        expect(projectOnly.attributes("data-settings-row-state")).toBe("inherit");
        expect(slotOf(projectOnly).text()).toBe("\"第\"");
        expect(projectOnly.find("[data-settings-row-inherited]").exists()).toBe(false);

        const inherited = row(created, themeSetting as SettingDefinition<unknown>, "project");
        expect(inherited.attributes("data-settings-row-state")).toBe("inherit");
        expect(slotOf(inherited).attributes("data-disabled")).toBe("true");
        expect(inherited.find("[data-settings-row-inherited]").exists()).toBe(true);
    });

    it("层文件无效时控件停用、显示上一份有效值，动作停用；层连不上同样；恢复后自动解除", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "dark"}, invalid: "第 3 行：缺少逗号"}});
        await flushPromises();
        const wrapper = row(created, appearanceSetting as SettingDefinition<unknown>, "user");
        expect(wrapper.attributes("data-settings-row-blocked")).toBe("");
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("true");
        expect(slotOf(wrapper).text()).toBe("\"dark\"");
        expect(wrapper.find<HTMLButtonElement>("[data-settings-row-reset]").element.disabled).toBe(true);
        created.user.setInvalid(null);
        await flushPromises();
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("false");

        created.user.setUnreachable(true);
        await flushPromises();
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("true");
        created.user.setUnreachable(false);
        await flushPromises();
        expect(slotOf(wrapper).attributes("data-disabled")).toBe("false");
        expect(slotOf(wrapper).text()).toBe("\"dark\"");
    });

    it("行自己的写入没有成功：发 write-failed（动作与失败码），显示的仍是层里的值", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "dark"}}});
        await flushPromises();
        created.user.failWrites("write-failed");
        const wrapper = row(created, appearanceSetting as SettingDefinition<unknown>, "user");
        await wrapper.find("[data-settings-row-reset]").trigger("click");
        await flushPromises();
        expect(wrapper.emitted("write-failed")).toEqual([[{action: "reset", code: "write-failed", detail: "场景让写入失败"}]]);
        expect(slotOf(wrapper).text()).toBe("\"dark\"");
    });

    it("宽排法：控件另起一行，恢复默认在标题那一行，沿用时控件照常可用；声明不允许这一层时不画控件", async () => {
        const created = host({user: {values: {"nbook.workbench/appearance": "dark"}}, project: {}});
        await flushPromises();
        const wide = row(created, appearanceSetting as SettingDefinition<unknown>, "user", {wide: true});
        expect(wide.find("[data-settings-row-wide] [data-slot]").exists()).toBe(true);
        expect(wide.find("[data-settings-row-head] [data-settings-row-cell] [data-settings-row-reset]").exists()).toBe(true);
        // 宽排法沿用时控件照常画在下一行、可用，显示沿用的值；标题那一行只有标签，右端没有别的东西。
        const inherited = row(created, themeSetting as SettingDefinition<unknown>, "project", {wide: true});
        expect(inherited.attributes("data-settings-row-state")).toBe("inherit");
        expect(inherited.findAll("[data-slot]")).toHaveLength(1);
        expect(inherited.find("[data-settings-row-wide] [data-slot]").attributes("data-disabled")).toBe("false");
        expect(inherited.find("[data-settings-row-wide] [data-slot]").text()).toBe("\"nbook\"");
        expect(inherited.find("[data-settings-row-inherited]").exists()).toBe(true);
        expect(inherited.get("[data-settings-row-head]").text()).toBe("");
        const notAllowed = row(created, localeSetting as SettingDefinition<unknown>, "project");
        expect(notAllowed.attributes("data-settings-row-state")).toBe("not-allowed");
        expect(notAllowed.text()).toContain(t("row.userOnly"));
        expect(slotOf(notAllowed).exists()).toBe(false);
    });

    it("applies 不是 now 时标题后一枚小标签，不在 label 里，经 describedby 接给控件", async () => {
        const created = host({user: {}});
        await flushPromises();
        const tagged = row(created, restartSetting as SettingDefinition<unknown>, "user");
        const tag = tagged.get("[data-settings-row] .settings-row__applies");
        expect(tag.text()).toBe(t("applies.restart"));
        expect(tagged.get("label").text()).toBe("并发数");
        const ids = (slotOf(tagged).attributes("data-describedby") ?? "").split(" ");
        expect(ids).toContain(tag.attributes("id"));
        expect(ids).toContain(tagged.get("p").attributes("id"));
        // now 不标。
        expect(row(created, themeSetting as SettingDefinition<unknown>, "user").find(".settings-row__applies").exists()).toBe(false);
    });

    it("状态原因：标题后只有一个图标，色调取最重的（出错 > 警告 > 淡色），读屏文字与控件的 describedby 合并而不覆盖", async () => {
        const created = host({user: {}});
        await flushPromises();
        const wrapper = row(created, restartSetting as SettingDefinition<unknown>, "user");
        const icons = () => wrapper.findAll("[data-settings-row-reason]");
        expect(icons()).toHaveLength(0);
        expect(wrapper.find("[data-settings-row-reasons]").exists()).toBe(false);
        const plain = (slotOf(wrapper).attributes("data-describedby") ?? "").split(" ");
        expect(plain).toHaveLength(2);

        await wrapper.setProps({reasons: [{tone: "muted", text: "无法加载选项：没有网络"}]});
        expect(icons().map((icon) => icon.attributes("data-tone"))).toEqual(["muted"]);
        await wrapper.setProps({reasons: [{tone: "muted", text: "没有网络"}, {tone: "warning", text: "已不存在"}]});
        expect(icons().map((icon) => icon.attributes("data-tone"))).toEqual(["warning"]);
        await wrapper.setProps({reasons: [{tone: "warning", text: "已不存在"}, {tone: "error", text: "未保存：取值范围为 1–8"}, {tone: "muted", text: "没有网络"}]});
        expect(icons().map((icon) => icon.attributes("data-tone"))).toEqual(["error"]);
        // 图标在标题那一行里，紧跟小圆点之后；不另起一行，所以出现与消失不改变行高。
        expect(wrapper.get("label").element.nextElementSibling).toBe(icons()[0]!.element);
        expect(wrapper.find("[title]").exists()).toBe(false);

        const reasons = wrapper.get("[data-settings-row-reasons]");
        expect(reasons.text()).toBe("已不存在；未保存：取值范围为 1–8；没有网络");
        // 原有的说明与生效时机 id 还在，原因的 id 加在后面。
        expect((slotOf(wrapper).attributes("data-describedby") ?? "").split(" ")).toEqual([...plain, reasons.attributes("id")]);

        // 控件已经念过的原因（announced）只画图标，读屏文字不再写一份；全都念过时没有读屏文字，describedby 回到原样。
        await wrapper.setProps({reasons: [{tone: "warning", text: "已不存在", announced: true}, {tone: "error", text: "未保存：不是数"}]});
        expect(icons().map((icon) => icon.attributes("data-tone"))).toEqual(["error"]);
        expect(wrapper.get("[data-settings-row-reasons]").text()).toBe("未保存：不是数");
        await wrapper.setProps({reasons: [{tone: "warning", text: "已不存在", announced: true}]});
        expect(icons().map((icon) => icon.attributes("data-tone"))).toEqual(["warning"]);
        expect(wrapper.find("[data-settings-row-reasons]").exists()).toBe(false);
        expect(slotOf(wrapper).attributes("data-describedby")?.split(" ")).toEqual(plain);

        await wrapper.setProps({reasons: []});
        expect(icons()).toHaveLength(0);
        expect(slotOf(wrapper).attributes("data-describedby")?.split(" ")).toEqual(plain);
    });

    it("焦点在行里的控件上时，原因的提示逐条列出，失焦后收起；焦点在最右一格的按钮上不算", async () => {
        const created = host({user: {values: {"example.rows/workers": 4}}});
        await flushPromises();
        const wrapper = row(created, restartSetting as SettingDefinition<unknown>, "user", {reasons: [{tone: "error", text: "未保存：不是数"}, {tone: "warning", text: "偏大"}, {tone: "muted", text: "没有网络"}]});
        expect(tooltipLines()).toEqual([]);
        const input = wrapper.get<HTMLInputElement>("input").element;
        input.focus();
        await vi.waitFor(() => {
            expect(tooltipLines()).toEqual(["未保存：不是数", "偏大", "没有网络"]);
        });
        input.blur();
        await vi.waitFor(() => {
            expect(tooltipLines()).toEqual([]);
        });
        wrapper.get<HTMLButtonElement>("[data-settings-row-reset]").element.focus();
        await flushPromises();
        expect(tooltipLines()).toEqual([]);
    });

    it("只读：不画控件，只写当前值，最右一格放锁；没有已修改圆点与恢复默认；本作品标签下沿用时也标“来自用户设置”", async () => {
        const created = host({user: {values: {"example.rows/library": "other-book"}}, project: {}});
        await flushPromises();
        const user = row(created, readOnlySetting as SettingDefinition<unknown>, "user");
        expect(slotOf(user).exists()).toBe(false);
        expect(user.find("input").exists()).toBe(false);
        expect(user.get("[data-settings-row-value]").text()).toBe("other-book");
        expect(cellOf(user).get("[data-settings-row-lock]").attributes("aria-label")).toBe(t("row.readOnly"));
        expect(dotOf(user).exists()).toBe(false);
        expect(user.find("[data-settings-row-reset]").exists()).toBe(false);

        const project = row(created, readOnlySetting as SettingDefinition<unknown>, "project");
        expect(project.get("[data-settings-row-value]").text()).toBe("other-book");
        expect(project.get("[data-settings-row-inherited]").text()).toBe(t("row.inherited"));
        expect(slotOf(project).exists()).toBe(false);
        expect(cellOf(project).find("[data-settings-row-lock]").exists()).toBe(true);
    });
});
