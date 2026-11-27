/**
 * SettingsWindow（同名 .md，docs/specs/settings/settings-window.md 输出 1、3、6、7、9、12–14、16、17）：窗口由设置场景的局部
 * 宿主驱动（产品里同一个窗口模型、配置实例与分区注册表，层的拥有者在内存里，同 Lab）。看左栏、标签、通用控件的写入与
 * 失败、层的说明、page 页面在切换标签与离开分区时的寿命、左栏的键盘与关闭。
 */

import {flushPromises, mount} from "@vue/test-utils";
import {Type} from "typebox";
import {afterEach, describe, expect, it, vi} from "vitest";
import {defineComponent, h, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch} from "vue";
import type {PropType} from "vue";

import {createSettingsScene} from "nbook/plugins/settings/web/lab/scene-data";
import {createSettingsHost} from "nbook/plugins/settings/web/lab/settings-host";
import type {SettingsHost} from "nbook/plugins/settings/web/lab/settings-host";
import {SCENE_PROJECT_FILE} from "nbook/plugins/settings/web/lab/scene-data";
import {modelsSettings} from "nbook/plugins/settings/web/lab/scene-settings";
import type {SettingsWindowSceneId} from "nbook/plugins/settings/web/lab/scene-settings";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import {workbenchCatalogs} from "nbook/plugins/workbench/web/text";
import {defineSetting} from "nbook/shared/settings";
import type {SettingDefinition} from "nbook/shared/settings";
import {provideText, testTextPort} from "nbook/shared/testing/text-port";
import SettingsPageActions from "nbook/ui/settings/SettingsPageActions.vue";
import {usePageChrome} from "nbook/ui/settings/page-chrome";

import {settingsTestText} from "../../testing/text";
import type {SettingsPageContext} from "../contracts";
import type {SettingsWindow as SettingsWindowModel} from "../settings-window";
import {settingsCatalogs} from "../text";
import SettingsWindow from "./SettingsWindow.vue";

/** 窗口里固定的文字取自 `nbook.settings` 的目录（经测试端口）；断言也经目录解析，不在测试里重复写一份文案。 */
const textPort = (locale: "zh-CN" | "en-US" = "zh-CN") => testTextPort(locale, {"nbook.settings": settingsCatalogs, "nbook.workbench": workbenchCatalogs});
const {t, resolver} = settingsTestText("zh-CN");
/** 通知交的是文字引用，视口显示时才翻（docs/specs/workbench/notifications.md 输出 9）：断言按中文翻好的样子。 */
const shown = (notice: NotificationInput | undefined) => notice === undefined ? undefined : {tone: notice.tone, title: notice.title === undefined ? undefined : resolver.t(notice.title), message: resolver.t(notice.message)};

const cleanup: Array<() => void> = [];
afterEach(() => {
    for (const dispose of cleanup.splice(0)) dispose();
    document.body.innerHTML = "";
});

function render(model: SettingsWindowModel, locale: "zh-CN" | "en-US" = "zh-CN") {
    const wrapper = mount(SettingsWindow, {props: {window: model}, global: {provide: provideText(textPort(locale))}, attachTo: document.body});
    cleanup.push(() => wrapper.unmount());
    return wrapper;
}

async function scene(id: SettingsWindowSceneId) {
    const notices: NotificationInput[] = [];
    const created = createSettingsScene(id, (input) => notices.push(input), () => undefined);
    cleanup.push(() => created.host.dispose());
    created.open();
    const wrapper = render(created.host.window);
    await flushPromises();
    return {...created, notices, wrapper};
}

const all = (selector: string): HTMLElement[] => [...document.body.querySelectorAll<HTMLElement>(selector)];
const one = (selector: string): HTMLElement => {
    const found = document.body.querySelector<HTMLElement>(selector);
    if (found === null) throw new Error(`没有 ${selector}`);
    return found;
};
/** 层警告的悬停提示逐行写的字（Tooltip 内容在焦点或悬停时才画）。 */
const tooltipLines = (): Array<string | null> => all(".nb-ui-tooltip-surface .settings-section-heading__tip-line").map((line) => line.textContent);
const navIds = (): string[] => all("[data-settings-nav]").map((element) => element.dataset.settingsNav ?? "");
/** 一项的单选：分段控件的选项名在按钮上，单选组的在包着圆钮的 `<label>` 里。 */
const choices = (row: string): HTMLElement[] => all(`[data-settings-row="${row}"] [role="radiogroup"] [role="radio"]`);
const choiceName = (element: HTMLElement): string | undefined => (element.closest("label") ?? element).textContent?.trim();
const segment = (row: string, label: string): HTMLElement => {
    const found = choices(row).find((element) => choiceName(element) === label);
    if (found === undefined) throw new Error(`${row} 没有选项 ${label}`);
    return found;
};
const selected = (row: string): string | undefined => {
    const found = choices(row).find((element) => element.getAttribute("aria-checked") === "true");
    return found === undefined ? undefined : choiceName(found);
};
/** 每一行的控件：行里第一个 `data-nb-widget` 是字段自己的（列表项的控件排在它里面）。 */
const widgetOf = (row: HTMLElement): string | undefined => row.querySelector<HTMLElement>("[data-nb-widget]")?.dataset.nbWidget;


/** 控件的 `aria-describedby` 指向的文字连起来：读屏会念到的说明。 */
function describedText(element: Element): string {
    return (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

describe("SettingsWindow", () => {
    it("左栏三组各有组标题；绑定作品时有“用户 | 本作品”，没绑定没有；外观分区按小组画控件", async () => {
        await scene("user");
        expect(navIds()).toEqual(["nbook.appearance", "example.models.main", "example.snippets.main", "other", "file"]);
        expect(one("[data-settings-nav-current]").dataset.settingsNav).toBe("nbook.appearance");
        expect(document.body.querySelector("[data-settings-tabs]")).not.toBeNull();
        expect(one("[data-settings-section='nbook.appearance']").textContent).toContain(t("settingsSections.nbook.appearance.description"));
        expect(all("[data-settings-group]").map((group) => group.dataset.settingsGroup)).toEqual(["ui", "language"]);
        expect(selected(appearanceSetting.key)).toBe("跟随系统");
        // 分段控件与单选组拿不到 `<label for>` 的名字，经 aria-labelledby 指向行的标题。
        const appearance = one(`[data-settings-row="${appearanceSetting.key}"]`);
        expect(document.getElementById(appearance.querySelector("[role='radiogroup']")!.getAttribute("aria-labelledby")!)?.textContent).toContain("明暗");
        cleanup.splice(0).forEach((dispose) => dispose());
        document.body.innerHTML = "";

        await scene("unbound");
        expect(document.body.querySelector("[data-settings-tabs]")).toBeNull();
    });

    it("改值经窗口模型写当前标签那一层；本作品标签下沿用的行照常可改、改了才写本作品层；只允许用户层的项不列出，末尾说明", async () => {
        const {host} = await scene("user");
        segment(appearanceSetting.key, "深色").click();
        await flushPromises();
        expect(host.user.values()).toMatchObject({"nbook.workbench/appearance": "dark"});
        expect(selected(appearanceSetting.key)).toBe("深色");

        const tabs = all("[data-settings-tabs] button[role='radio']");
        tabs.find((button) => button.textContent?.trim() === t("window.project"))?.click();
        await flushPromises();
        expect(host.window.layer.value).toBe("project");
        expect(document.body.querySelector("[data-settings-row='nbook.settings/locale']")).toBeNull();
        expect(one("[data-settings-excluded]").textContent).toBe(t("list.excludedUser", {titles: t("settings.locale.title")}));
        // 沿用的行照常画控件、显示用户层的值，标“来自用户设置”（输出 12）
        const theme = one(`[data-settings-row="${themeSetting.key}"]`);
        expect(theme.dataset.settingsRowState).toBe("inherit");
        expect(theme.querySelector("[data-settings-row-inherited]")?.textContent).toBe(t("row.inherited"));
        const inherited = selected(themeSetting.key);
        const userBefore = host.user.values();
        const projectBefore = host.project?.values();
        // 点已选中的那一项不写：不会因为点一下就变成本作品单独设置的（分段控件对已选中的项不发改值）
        segment(themeSetting.key, inherited ?? "").click();
        await flushPromises();
        expect(host.project?.values()).toEqual(projectBefore);
        expect(theme.dataset.settingsRowState).toBe("inherit");
        // 改成别的值就写进本作品层，用户层不变
        const other = choices(themeSetting.key).map(choiceName).find((name) => name !== inherited) ?? "";
        segment(themeSetting.key, other).click();
        await flushPromises();
        expect(host.project?.values()).toHaveProperty([themeSetting.key]);
        expect(host.user.values()).toEqual(userBefore);
        expect(selected(themeSetting.key)).toBe(other);
        expect(theme.dataset.settingsRowState).toBe("edit");
        expect(theme.querySelector("[data-settings-row-inherited]")).toBeNull();
    });

    it("写入失败：发通知，控件回到层里的实际值；结果未知另有提示", async () => {
        const {host, notices} = await scene("write-failed");
        expect(selected(themeSetting.key)).toBe("macOS");
        segment(themeSetting.key, "NeuroBook").click();
        await flushPromises();
        expect(notices.map(shown)).toEqual([{tone: "warning", title: t("model.notSavedTitle"), message: t("model.notSaved", {title: "主题", reason: t("writeFailure.writeFailed", {detail: "场景让写入失败"})})}]);
        expect(selected(themeSetting.key)).toBe("macOS");
        host.user.failWrites("unknown-outcome");
        segment(themeSetting.key, "NeuroBook").click();
        await flushPromises();
        expect(shown(notices[1])).toEqual({tone: "warning", title: t("model.unknownTitle"), message: t("model.notSaved", {title: "主题", reason: t("writeFailure.unknownOutcome")})});
    });

    it("层文件无效：标题区右侧的警告是按钮，悬停提示写原因、修复前的后果与路径，控件停用；层连不上是不能点的文字；恢复后警告消失", async () => {
        const {host} = await scene("project-invalid");
        const warning = one("[data-settings-layer-notice='invalid']");
        expect(warning.tagName).toBe("BUTTON");
        expect(warning.textContent).toContain(t("window.invalid"));
        expect(warning.textContent).toContain(t("window.openAction"));
        expect(warning.closest("[data-settings-heading]")).not.toBeNull();
        expect(one(`[data-settings-row="${appearanceSetting.key}"]`).dataset.settingsRowBlocked).toBe("");
        warning.focus();
        await vi.waitFor(() => expect(tooltipLines()).toEqual([t("window.invalidAt", {line: 3, column: 1, reason: "缺右花括号 }"}), t("window.cannotSave"), SCENE_PROJECT_FILE]));
        host.project?.setInvalid(null);
        await flushPromises();
        expect(document.body.querySelector("[data-settings-layer-notice]")).toBeNull();
        host.project?.setUnreachable(true);
        await flushPromises();
        const unreachable = one("[data-settings-layer-notice='unavailable']");
        expect(unreachable.textContent).toContain(t("window.unavailable"));
        expect(unreachable.tagName).not.toBe("BUTTON");
        expect(unreachable.querySelector("button")).toBeNull();
        expect(document.body.querySelector("[data-settings-open-file]")).toBeNull();
    });

    it("“其它”分区：开关、下拉、数字、单行输入与字符串列表（宽排法、可编辑）、生效时机的标注；数字框回车提交，不合 schema 的值被拒、回到实际值", async () => {
        const {host, notices} = await scene("other");
        host.window.select("other");
        await flushPromises();
        expect(all("[data-settings-row]").map(widgetOf)).toEqual(["select", "switch", "number", "switch", "text", "select", "string-list"]);
        const tags = one("[data-settings-row='example.notes/tags']");
        expect(tags.querySelector("[data-settings-row-wide] [data-nb-widget='string-list']")).not.toBeNull();
        // 控件的名字是行的标题（`<label for>` 指向它），说明经 aria-describedby 接上。
        const autosave = one("[data-settings-row='example.notes/autosave']");
        const control = document.getElementById(autosave.querySelector("label")!.htmlFor)!;
        expect(autosave.contains(control)).toBe(true);
        expect(control.getAttribute("aria-describedby")?.split(" ")).toContain(autosave.querySelector("p")!.id);
        // applies 不是 now 时标题后标注生效时机，不进控件的名字、接进说明；now 不标。
        const described = (row: string) => (one(`[data-settings-row='${row}'] #${CSS.escape((one(`[data-settings-row='${row}'] label`) as HTMLLabelElement).htmlFor)}`).getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "");
        expect(one("[data-settings-row='example.notes/interval'] label").textContent).toBe("保存间隔（秒）");
        const heading = (row: string) => one(`[data-settings-row='${row}'] label`).parentElement!.textContent;
        expect(heading("example.notes/interval")).toContain(t("applies.next-session"));
        expect(described("example.notes/interval")).toContain(t("applies.next-session"));
        expect(heading("example.notes/tags")).toContain(t("applies.restart"));
        expect(heading("example.notes/autosave")).not.toContain("生效");
        const input = one("[data-settings-row='example.notes/interval'] input") as HTMLInputElement;
        input.value = "1000";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true}));
        await flushPromises();
        expect(shown(notices[0])?.message).toContain("保存间隔（秒）：这个值不能用");
        expect(input.value).toBe("120");
        // 不是数：不写，行里写出原因；改好后原因消失。
        input.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input.value = "abc";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        // 原因收在标题后的图标里（出错的色调），读屏文字经 aria-describedby 接到控件上。
        const interval = one("[data-settings-row='example.notes/interval']");
        expect(interval.querySelector("[data-settings-row-reason]")?.getAttribute("data-tone")).toBe("error");
        // 字段自己已经念了解析不了的原因，行上的“未保存：…”不再接一遍：同一个原因只念一次。
        expect(interval.querySelector("[data-settings-row-reasons]")).toBeNull();
        const reasons = described("example.notes/interval").map((text) => text.replace(/^未保存：/u, ""));
        expect(reasons.length).toBeGreaterThan(0);
        expect(new Set(reasons).size).toBe(reasons.length);
        expect(host.user.values()).toMatchObject({"example.notes/interval": 120});
        input.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input.value = "90";
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/interval": 90});
        expect(document.body.querySelector("[data-settings-row='example.notes/interval'] [data-settings-row-reason]")).toBeNull();
        expect(document.body.querySelector("[data-settings-row='example.notes/interval'] [data-settings-row-reasons]")).toBeNull();

        // 字符串列表加一项：空项不合 schema，先留在行里、不写，写出原因；填好失焦后整个数组写进这一层。
        (tags.querySelector("[data-nb-list-add]") as HTMLButtonElement).click();
        await flushPromises();
        expect(host.user.values()["example.notes/tags"]).toBeUndefined();
        expect(tags.querySelector("[data-settings-row-reasons]")?.textContent).toMatch(/^未保存：.*第 4 项/u);
        const added = [...tags.querySelectorAll<HTMLInputElement>("[data-nb-list-item] input")].at(-1)!;
        expect(document.activeElement).toBe(added);
        added.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        added.value = "对白";
        added.dispatchEvent(new Event("input"));
        added.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/tags": ["人物", "地点", "伏笔", "对白"]});
        expect(tags.querySelector("[data-settings-row-reasons]")).toBeNull();

        // 删一项时写入失败：发通知，项回来，焦点留在列表里（不掉到页面上）。
        host.user.failWrites("write-failed");
        const remove = tags.querySelector<HTMLButtonElement>("[aria-label='删除：第 2 项']")!;
        remove.focus();
        remove.click();
        await flushPromises();
        expect([...tags.querySelectorAll<HTMLInputElement>("[data-nb-list-item] input")].map((element) => element.value)).toEqual(["人物", "地点", "伏笔", "对白"]);
        expect(shown(notices.at(-1))?.title).toBe(t("model.notSavedTitle"));
        expect(tags.contains(document.activeElement)).toBe(true);
        expect(tags.querySelector("[aria-live='polite']")?.textContent).toBe("刚才的改动没有生效");
    });

    it("动态选项：列出提供者给的选项，当前值不在选项里时照常显示并标“已不存在”", async () => {
        const {host} = await scene("choices");
        const row = one("[data-settings-row='example.notes/template']");
        const trigger = row.querySelector<HTMLElement>("[data-nb-widget='select'] button, [data-nb-widget='select'] [role='combobox']")!;
        expect(row.querySelector("[data-settings-row-reason]")?.getAttribute("data-tone")).toBe("warning");
        // 字段自己的警告由控件念（aria-describedby），行不再写一份读屏文字，免得念两遍。
        expect(describedText(trigger)).toContain("已不存在");
        expect(row.querySelector("[data-settings-row-reasons]")).toBeNull();
        expect(trigger.hasAttribute("disabled")).toBe(false);
        expect(host.window.options()["example.notes.templates"]).toBeDefined();
        const items = host.window.options()["example.notes.templates"];
        const value = typeof items === "function" ? items() : (items as {value: unknown}).value;
        expect(value).toMatchObject({status: "ready", items: [{value: "diary"}, {value: "scene"}, {value: "character"}]});
    });

    it("动态选项：提供者按需激活时先显示加载中、停用，交付后可选；提供者的入口失败时停用并在行里写原因", async () => {
        await scene("choices-lazy");
        const row = () => one("[data-settings-row='example.notes/template']");
        const control = () => row().querySelector<HTMLElement>("[data-nb-widget='select'] button, [data-nb-widget='select'] [role='combobox']")!;
        expect(control().hasAttribute("disabled") || control().getAttribute("aria-disabled") === "true").toBe(true);
        await vi.waitFor(() => expect(control().hasAttribute("disabled")).toBe(false), {timeout: 3_000});
        expect(row().textContent).not.toContain("已不存在");
        cleanup.splice(0).forEach((dispose) => dispose());
        document.body.innerHTML = "";

        await scene("choices-unavailable");
        expect(row().querySelector("[data-settings-row-reason]")?.getAttribute("data-tone")).toBe("muted");
        expect(describedText(control())).toContain("无法加载选项：模板库读不到：权限不足");
        expect(row().querySelector("[data-settings-row-reasons]")).toBeNull();
        expect(control().hasAttribute("disabled")).toBe(true);
    });

    it("左栏：上下键（窄窗口横排时左右键同义）切到上一个、下一个可用分区，焦点跟着走；停用项说明原因、点了不动；窗口没有标题栏，可访问名称是“设置”，关闭按钮关窗口", async () => {
        const {host} = await scene("project");
        const first = host.window.section.value;
        one("[data-settings-nav-current]").focus();
        one("[data-settings-nav-current]").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true}));
        await flushPromises();
        // 模型服务只在用户设置里，本作品标签下停用、被跳过。
        expect(host.window.section.value).toBe("example.snippets.main");
        expect(document.activeElement).toBe(one("[data-settings-nav-current]"));
        const models = one("[data-settings-nav='example.models.main']");
        expect(models.getAttribute("aria-disabled")).toBe("true");
        expect(document.getElementById(models.getAttribute("aria-describedby") ?? "")?.textContent).toBeTruthy();
        models.click();
        await flushPromises();
        expect(host.window.section.value).toBe("example.snippets.main");
        one("[data-settings-nav-current]").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowLeft", bubbles: true}));
        await flushPromises();
        expect(host.window.section.value).toBe(first);
        one("[data-settings-nav-current]").dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true}));
        await flushPromises();
        expect(host.window.section.value).toBe("example.snippets.main");
        one("[data-settings-nav-current]").dispatchEvent(new KeyboardEvent("keydown", {key: "Home", bubbles: true}));
        await flushPromises();
        expect(host.window.section.value).toBe("nbook.appearance");
        // 窗口没有标题栏（输出 16）：“设置”只作可访问名称，关闭按钮在右上角
        const dialog = one("[role='dialog']");
        expect(dialog.querySelector("header.nb-dialog__header")).toBeNull();
        expect(document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(t("window.title"));
        one(`button[aria-label='${t("window.close")}']`).click();
        await flushPromises();
        expect(host.window.open.value).toBe(false);
    });
});

describe("page 页面的寿命（输出 6）", () => {
    function counting() {
        const counts = {mounted: 0, unmounted: 0, loads: 0};
        const Page = defineComponent({
            name: "CountingPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup(props) {
                onMounted(() => void (counts.mounted += 1));
                onUnmounted(() => void (counts.unmounted += 1));
                return () => h("p", {"data-page-layer": ""}, props.context.layer.value);
            },
        });
        return {counts, Page};
    }

    function pageHost(): SettingsHost {
        const created = createSettingsHost({
            settings: [{plugin: "nbook.workbench", definition: themeSetting as SettingDefinition<unknown>}],
            sections: [
                {id: "x.page.main", plugin: "x.page", kind: "page", declaration: {title: {"zh-CN": "页面", "en-US": "Page"}, icon: "i-lucide-square", category: "plugins"}},
            ],
            project: {},
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        return created;
    }

    it("切换标签时页面不重建、拿到新的层；离开分区时卸载，回到分区时用同一份组件定义重新创建", async () => {
        const {counts, Page} = counting();
        const created = pageHost();
        created.publish("x.page.main", async () => {
            counts.loads += 1;
            return Page;
        });
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await flushPromises();
        expect(one("[data-page-layer]").textContent).toBe("user");
        all("[data-settings-tabs] button[role='radio']").find((button) => button.textContent?.trim() === t("window.project"))?.click();
        await flushPromises();
        expect(one("[data-page-layer]").textContent).toBe("project");
        expect(counts).toEqual({mounted: 1, unmounted: 0, loads: 1});
        // 主题指向这里没有的外观分区，落在“其它”。
        one("[data-settings-nav='other']").click();
        await flushPromises();
        expect(counts.unmounted).toBe(1);
        one("[data-settings-nav='x.page.main']").click();
        await flushPromises();
        expect(counts).toEqual({mounted: 2, unmounted: 1, loads: 1});
    });

    it("打开时给的 focus 交给页面：页面取走后定位，焦点留在页面定的地方；窗口已开在这一页时再打开一次，焦点也不被左栏抢回去（输出 15）", async () => {
        // 像模型的两页那样：看着 focus，取走后等一拍再聚焦。
        const Page = defineComponent({
            name: "FocusPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup(props) {
                const root = ref<HTMLElement | null>(null);
                watch(() => props.context.focus.value, async (focus) => {
                    if (focus === null) return;
                    const target = props.context.takeFocus();
                    await nextTick();
                    root.value?.querySelector<HTMLElement>(`[data-target="${target ?? ""}"]`)?.focus();
                }, {immediate: true});
                return () => h("div", {ref: root}, ["a", "b", "c"].map((id) => h("input", {"data-target": id, "aria-label": id})));
            },
        });
        const created = pageHost();
        created.publish("x.page.main", async () => Page);
        created.window.openWindow({section: "x.page.main", focus: "b"});
        render(created.window);
        await flushPromises();
        expect(document.activeElement?.getAttribute("data-target")).toBe("b");

        created.window.openWindow({section: "x.page.main", focus: "c"});
        await flushPromises();
        expect(document.activeElement?.getAttribute("data-target")).toBe("c");
    });

    it("交付状态原位呈现：入口失败给“重试”，重试后交付并显示页面；渲染出错给“重试”重建", async () => {
        let crash = true;
        const Fragile = defineComponent({name: "FragilePage", setup: () => () => {
            if (crash) throw new Error("页面出错了");
            return h("p", {"data-page-ok": ""}, "好了");
        }});
        const created = pageHost();
        created.entry("x.page.main", "failed", "读不到片段库");
        created.onRetry(async () => {
            created.publish("x.page.main", async () => Fragile);
            return {status: "activated"};
        });
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await flushPromises();
        expect(one("[data-settings-page-state='entry-failed']").textContent).toContain("读不到片段库");
        one("[data-settings-page-retry-entry]").click();
        await flushPromises();
        expect(one("[data-settings-page-state='render-failed']").textContent).toContain("页面出错了");
        crash = false;
        one("[data-settings-page-retry-render]").click();
        await flushPromises();
        expect(document.body.querySelector("[data-page-ok]")).not.toBeNull();
    });
});

describe("搜索与未保存保护（输出 21、22）", () => {
    it("Mod+F 在窗口里聚焦搜索框；搜到的项可以直接改；框里有字时 Esc 只清空、回到原分区，空了再按才关窗口", async () => {
        const {host} = await scene("other");
        one("[data-settings-nav-current]").dispatchEvent(new KeyboardEvent("keydown", {key: "f", code: "KeyF", ctrlKey: true, bubbles: true, cancelable: true}));
        const input = one("[data-settings-search] input, input[data-settings-search]") as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        input.value = "落款";
        input.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(all("[data-settings-row]").map((row) => row.dataset.settingsRow)).toEqual(["example.notes/signature"]);
        expect(document.body.querySelector("[data-settings-nav-current]")?.getAttribute("aria-current")).toBeNull();
        const signature = one("[data-settings-row='example.notes/signature'] input") as HTMLInputElement;
        signature.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        signature.value = "——雾港";
        signature.dispatchEvent(new Event("input"));
        signature.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/signature": "——雾港"});
        input.value = "没有这样的设置";
        input.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(one("[data-settings-no-results]").textContent).toBe(t("window.noResults"));
        const escape = new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true});
        input.dispatchEvent(escape);
        await flushPromises();
        expect(escape.defaultPrevented).toBe(true);
        expect(host.window.query.value).toBe("");
        expect(one("[data-settings-section]").dataset.settingsSection).toBe("other");
        expect(host.window.open.value).toBe(true);
    });

    it("换搜索词时搜索结果里留着的不合格值丢掉，回来不复活", async () => {
        const {host} = await scene("other");
        host.window.search("常用标签");
        await flushPromises();
        const tags = () => one("[data-settings-row='example.notes/tags']");
        (tags().querySelector("[data-nb-list-add]") as HTMLButtonElement).click();
        await flushPromises();
        expect(tags().querySelector("[data-settings-row-reasons]")).not.toBeNull();
        host.window.search("常用标签 ");
        await flushPromises();
        host.window.search("常用");
        await flushPromises();
        expect(tags().querySelector("[data-settings-row-reasons]")).toBeNull();
        expect(tags().querySelectorAll("[data-nb-list-item]")).toHaveLength(3);
    });

    it("page 命中给“打开”，点了清空搜索并切到这个分区", async () => {
        const {host} = await scene("other");
        host.window.search("片段");
        await flushPromises();
        const hit = one("[data-settings-page-hit='example.snippets.main']");
        expect(hit.getAttribute("aria-label")).toBe(t("window.openHit", {title: "常用片段"}));
        hit.click();
        await flushPromises();
        expect([host.window.query.value, host.window.section.value]).toEqual(["", "example.snippets.main"]);
    });

    it("页面报了未保存：点左栏别的分区先弹确认；继续编辑留在原处、焦点回到点的位置；放弃后切过去", async () => {
        let context: SettingsPageContext | null = null;
        const Dirty = defineComponent({
            name: "DirtyPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup(props) {
                context = props.context;
                return () => h("p", {"data-dirty-page": ""}, "草稿");
            },
        });
        const created = createSettingsHost({
            settings: [{plugin: "nbook.workbench", definition: themeSetting as SettingDefinition<unknown>}],
            sections: [{id: "x.page.main", plugin: "x.page", kind: "page", declaration: {title: {"zh-CN": "页面", "en-US": "Page"}, icon: "i-lucide-square", category: "plugins"}}],
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        created.publish("x.page.main", async () => Dirty);
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await flushPromises();
        context!.dirty(true);
        const other = one("[data-settings-nav='other']");
        other.focus();
        other.click();
        await flushPromises();
        const dialog = one("[role='alertdialog']");
        expect(dialog.textContent).toContain(t("window.leave.title"));
        expect(dialog.textContent).toContain(t("window.leave.description", {title: "页面"}));
        expect(created.window.section.value).toBe("x.page.main");
        [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === t("window.leave.keepEditing"))!.click();
        await vi.waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).toBeNull());
        await vi.waitFor(() => expect(document.activeElement).toBe(other));
        expect(created.window.unsaved.value).toBe(true);
        other.click();
        await flushPromises();
        [...one("[role='alertdialog']").querySelectorAll("button")].find((button) => button.textContent?.trim() === t("window.leave.discard"))!.click();
        await flushPromises();
        expect(created.window.section.value).toBe("other");
        expect(created.window.unsaved.value).toBe(false);
        expect(document.body.querySelector("[data-dirty-page]")).toBeNull();
    });
});

describe("设置文件视图（输出 23）", () => {
    const area = (): HTMLTextAreaElement => one("[data-settings-file-text]") as HTMLTextAreaElement;
    const type = async (value: string): Promise<void> => {
        area().value = value;
        area().dispatchEvent(new Event("input"));
        await flushPromises();
    };
    const button = (label: string): HTMLButtonElement => {
        const found = all("[data-settings-file] button").find((element) => element.textContent?.trim() === label);
        if (found === undefined) throw new Error(`没有按钮 ${label}`);
        return found as HTMLButtonElement;
    };

    /** 行号列的每一行：行号与有没有标出错底。 */
    const numbers = (): string[] => all("[data-settings-file-line]").map((line) => line.textContent?.trim() ?? "");
    const marked = (): string[] => all("[data-settings-file-line][data-error]").map((line) => line.textContent?.trim() ?? "");
    /** 窗口标题区右侧写的警告文字（保存被拒、层无效时的“改好后保存”）。 */
    const headingNote = (): string | undefined => document.body.querySelector("[data-settings-heading] [data-settings-layer-notice]")?.textContent?.trim();

    it("显示这一层文件的全文（注释、没有声明的键都在）；改了才有“保存”“放弃更改”；保存后写进这一层、列表同步", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        expect(area().value).toContain("// 主题跟着 macOS");
        expect(area().value).toContain("retired.plugin/flag");
        expect(document.getElementById(one("[data-settings-file] label").getAttribute("for")!)).toBe(area());
        expect(button(t("saveBar.save")).disabled).toBe(true);
        // 没有改动：保存栏的两个按钮在、都停用，不写文字。
        expect(button(t("saveBar.discard")).disabled).toBe(true);
        expect(document.body.querySelector("[data-settings-save-bar-note]")).toBeNull();
        await type(area().value.replace("120", "90"));
        expect(one("[data-settings-save-bar-note]").textContent?.trim()).toBe(t("saveBar.unsaved"));
        expect([button(t("saveBar.discard")).disabled, button(t("saveBar.save")).disabled]).toEqual([false, false]);
        expect(host.window.unsaved.value).toBe(true);
        button(t("saveBar.save")).click();
        await flushPromises();
        expect(host.user.values()).toMatchObject({"example.notes/interval": 90});
        expect(host.user.text()).toContain("retired.plugin/flag");
        expect(button(t("saveBar.save")).disabled).toBe(true);
        expect(document.activeElement).toBe(area());
        expect(host.window.unsaved.value).toBe(false);
        await type("{}");
        button(t("saveBar.discard")).click();
        await flushPromises();
        expect(area().value).toBe(host.user.text());
    });

    it("行号列与文本的行数一致，改文本时跟着增减；行号随文本框滚动平移；框下写着三个键", async () => {
        await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        expect(numbers()).toEqual(area().value.split("\n").map((_, index) => String(index + 1)));
        await type("{\n}");
        expect(numbers()).toEqual(["1", "2"]);
        await type("{\n\n\n}\n");
        expect(numbers()).toEqual(["1", "2", "3", "4", "5"]);
        // 滚动：行号列跟着文本框的 scrollTop 平移，不滚时不动。
        expect(one("[data-settings-file-lines]").style.transform).toBe("translateY(0px)");
        area().scrollTop = 42;
        area().dispatchEvent(new Event("scroll"));
        await flushPromises();
        expect(one("[data-settings-file-lines]").style.transform).toBe("translateY(-42px)");
        expect(one("[data-settings-file-keys]").textContent).toMatch(/^Tab插入缩进Esc后Tab移出编辑区(Ctrl|⌘)S保存$/u);
        expect(all("[data-settings-file-keys] kbd").map((key) => key.textContent)).toEqual(["Tab", "Esc", "Tab", expect.stringMatching(/^(Ctrl|⌘)$/u), "S"]);
    });

    it("换标签后文本框是新建的、从顶上起，行号列也回到顶上", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        area().scrollTop = 42;
        area().dispatchEvent(new Event("scroll"));
        await flushPromises();
        expect(one("[data-settings-file-lines]").style.transform).toBe("translateY(-42px)");
        host.window.setLayer("project");
        await vi.waitFor(() => expect(area().value).toBe(host.project!.text()));
        await flushPromises();
        expect(one("[data-settings-file-lines]").style.transform).toBe("translateY(0px)");
    });

    it("文本不合格：不写，在标题区右侧写出行与列、出错行标底色、文本框标出错；别处改过：有改动时只提示，保存被拒为冲突，“重新读取”换成新文本", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        await type("{\n  \"a\": 1\n  \"b\": 2\n}");
        (one("[data-settings-file-text]") as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", {key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true}));
        await flushPromises();
        expect(headingNote()).toMatch(/^未保存：第 3 行第 3 列：/u);
        expect(one("[data-settings-file-error]").textContent).toContain("第 3 行第 3 列");
        // 出错行（第 3 行）在行号列与文本行上标出，只这一行。
        expect(marked()).toEqual(["3"]);
        expect(area().getAttribute("aria-invalid")).toBe("true");
        expect(area().getAttribute("aria-describedby")?.split(" ")).toContain(one("[data-settings-file-error]").id);
        // 光标放到出错的地方（第 3 行第 3 列）。
        expect(area().selectionStart).toBe("{\n  \"a\": 1\n  ".length);
        // 改了文本，出错的标记随之去掉。
        await type("{\n  \"a\": 1,\n  \"b\": 2\n}");
        expect(document.body.querySelector("[data-settings-file-error]")).toBeNull();
        expect(headingNote()).toBeUndefined();
        expect(marked()).toEqual([]);
        expect(area().getAttribute("aria-invalid")).not.toBe("true");
        await type("{\n  \"a\": 1\n  \"b\": 2\n}");
        expect(host.user.values()).toMatchObject({"example.notes/interval": 120});

        host.user.setText("{\"example.notes/interval\": 300}");
        await flushPromises();
        expect(one("[data-settings-file-changed]").textContent).toContain(t("file.changedElsewhere"));
        expect(area().value).toContain("\"b\": 2");
        await type("{\"example.notes/interval\": 60}");
        button(t("saveBar.save")).click();
        await flushPromises();
        expect(one("[data-settings-file-error]").textContent).toContain(t("file.conflict"));
        // 冲突的提示与两个按钮在框上面，不在标题区。
        expect(headingNote()).toBeUndefined();
        expect(host.user.values()).toMatchObject({"example.notes/interval": 300});
        all("[data-settings-file-error] button")[0]!.click();
        await flushPromises();
        expect(area().value).toBe("{\"example.notes/interval\": 300}");
        // 没有改动时别处又改了：直接换成新文本。
        host.user.setText("{\"example.notes/interval\": 30}");
        await flushPromises();
        expect(area().value).toBe("{\"example.notes/interval\": 30}");
    });

    it("这一层连不上：文本框只读，“保存”停用，“放弃更改”照常可用；恢复后“保存”回来", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        await type("{}");
        expect(button(t("saveBar.save")).disabled).toBe(false);
        host.user.setUnreachable(true);
        await vi.waitFor(() => expect(host.window.layerNotice.value?.kind).toBe("unavailable"));
        expect(area().readOnly).toBe(true);
        // 放弃只丢本地草稿，不需要连上。
        expect([button(t("saveBar.discard")).disabled, button(t("saveBar.save")).disabled]).toEqual([false, true]);
        host.user.setUnreachable(false);
        await vi.waitFor(() => expect(button(t("saveBar.save")).disabled).toBe(false));
    });

    it("Tab 插入两个空格，Esc 之后的 Tab 照常移走焦点；有改动时离开先确认", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        area().focus();
        area().setSelectionRange(0, 0);
        const tab = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
        area().dispatchEvent(tab);
        await flushPromises();
        expect(tab.defaultPrevented).toBe(true);
        expect(area().value.startsWith("  // 我的设置")).toBe(true);
        area().dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
        const next = new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true});
        area().dispatchEvent(next);
        expect(next.defaultPrevented).toBe(false);
        host.window.select("nbook.appearance");
        expect(host.window.leaving.value).toEqual({kind: "section", id: "nbook.appearance"});
    });

    it("层文件无效（没有语法位置，只有原因）：点标题区的警告打开设置文件，看到坏的文本，修好保存后警告消失", async () => {
        const {host} = await scene("user-invalid");
        one("[data-settings-open-file]").click();
        await flushPromises();
        expect(host.window.section.value).toBe("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        expect(area().value.trim().endsWith("}")).toBe(false);
        await type("{\"nbook.workbench/appearance\": \"dark\"}");
        button(t("saveBar.save")).click();
        await flushPromises();
        expect(host.window.layerNotice.value).toBeNull();
        expect(document.body.querySelector("[data-settings-layer-notice]")).toBeNull();
    });
});

describe("Lab“模型服务”：一张列表加下一级页面、草稿、未保存保护与动态选项", () => {
    const providers = (host: SettingsHost) => host.user.values()["example.models/providers"] as ReadonlyArray<{readonly id: string; readonly name: string}> | undefined;
    const fill = async (input: HTMLInputElement, value: string): Promise<void> => {
        input.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        input.value = value;
        input.dispatchEvent(new Event("input"));
        input.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
    };
    const detailInputs = (): HTMLInputElement[] => all("[data-sample-models-detail] input") as HTMLInputElement[];
    const rows = (): HTMLElement[] => all("[data-sample-models] [data-settings-page-list-item]");
    const rowTitle = (element: HTMLElement): string | undefined => element.querySelector(".settings-page-list__title-text")?.textContent?.trim();
    /** 列表里服务商的标题；打开了一家（列表不画）时为空。 */
    const listTitles = (): Array<string | undefined> => rows().map(rowTitle);
    const heading = (): HTMLElement => one("[data-settings-heading]");
    const titleText = (): string | null | undefined => heading().querySelector("h2")?.textContent;
    /** 按标题点列表里的一项。 */
    const pick = async (title: string): Promise<void> => {
        const item = rows().find((element) => rowTitle(element) === title);
        if (item === undefined) throw new Error(`列表里没有 ${title}`);
        item.click();
        await flushPromises();
    };
    const goBack = async (): Promise<void> => {
        one("[data-settings-heading-back]").click();
        await flushPromises();
    };
    /** 保存栏的按钮。 */
    const action = (label: string): HTMLButtonElement => {
        const found = all("[data-sample-models-bar] button").find((element) => element.textContent?.trim() === label);
        if (found === undefined) throw new Error(`没有按钮 ${label}`);
        return found as HTMLButtonElement;
    };
    /** 标题区右侧的页面级操作（Teleport 出来的，不在页面正文里）。 */
    const headingAction = (selector: string): HTMLButtonElement => heading().querySelector<HTMLButtonElement>(`[data-settings-heading-actions] ${selector}`) ?? (() => {
        throw new Error(`标题区没有 ${selector}`);
    })();
    const loaded = () => vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());

    it("打开分区时才激活入口；首屏是列表（“常规”两项在上、服务商在下），标题区没有返回；默认模型的选项来自已保存的服务商", async () => {
        const {host} = await scene("page-fill");
        await loaded();
        expect(listTitles()).toEqual(["DeepSeek", "本地 Ollama"]);
        expect(document.body.querySelector("[data-settings-heading-back]")).toBeNull();
        expect(titleText()).toBe("模型服务");
        expect(all("[data-sample-models] h3").map((title) => title.textContent)).toEqual(["常规", "服务商"]);
        const source = host.window.options()["example.models.models"];
        const value = typeof source === "function" ? source() : (source as {value: unknown}).value;
        expect(value).toMatchObject({status: "ready", items: [{value: "deepseek/deepseek-chat"}, {value: "deepseek/deepseek-reasoner"}, {value: "local/qwen3:8b"}]});
        expect(one("[data-settings-row='example.models/defaultModel']").textContent).not.toContain("已不存在");
    });

    it("点一家服务商：整页换成它的详情，标题区写“‹ 模型服务”与它的名字；返回回到列表，焦点回到这一行；列表状态没有改动时没有保存栏", async () => {
        await scene("page-fill");
        await loaded();
        expect(document.body.querySelector("[data-sample-models-bar]")).toBeNull();
        await pick("本地 Ollama");
        expect(rows()).toEqual([]);
        expect(document.body.querySelector("[data-sample-models-general]")).toBeNull();
        expect(titleText()).toBe("本地 Ollama");
        expect(one("[data-settings-heading-back]").textContent?.trim()).toBe("模型服务");
        expect(one("[data-settings-heading-back]").getAttribute("aria-label")).toBe(t("window.back", {title: "模型服务"}));
        expect(detailInputs()[1]!.value).toBe("本地 Ollama");
        // 详情里一直有保存栏，没有改动时两个按钮停用。
        expect(action(t("saveBar.save")).disabled).toBe(true);
        expect(action(t("saveBar.discard")).disabled).toBe(true);
        await goBack();
        expect(titleText()).toBe("模型服务");
        expect(document.body.querySelector("[data-settings-heading-back]")).toBeNull();
        expect(document.activeElement).toBe(rows().find((element) => rowTitle(element) === "本地 Ollama"));
        expect(document.body.querySelector("[data-sample-models-bar]")).toBeNull();
    });

    it("“添加服务商”在标题区右侧、只在列表状态；详情状态换成“测试连接”与删除；层坏了时整体停用，修好后恢复", async () => {
        const {host} = await scene("page-fill");
        await loaded();
        expect(document.body.querySelector("[data-sample-models] [data-sample-models-add]")).toBeNull();
        expect(headingAction("[data-sample-models-add]").textContent?.trim()).toBe("添加服务商");
        expect(document.body.querySelector("[data-sample-models-test]")).toBeNull();
        const scope = () => heading().querySelector<HTMLFieldSetElement>("[data-settings-heading-actions] [data-settings-page-actions]")!;
        expect(scope().disabled).toBe(false);
        host.user.setInvalid("第 1 行：缺右花括号");
        await flushPromises();
        // jsdom 不把 fieldset 的停用传给里面的按钮（浏览器会，e2e 里看 toBeDisabled）：这里看按钮在停用的作用域里。
        expect(scope().disabled).toBe(true);
        expect(scope().contains(headingAction("[data-sample-models-add]"))).toBe(true);
        host.user.setInvalid(null);
        await flushPromises();
        expect(scope().disabled).toBe(false);

        await pick("DeepSeek");
        expect(document.body.querySelector("[data-sample-models-add]")).toBeNull();
        expect(headingAction("[data-sample-models-test]").textContent?.trim()).toBe("测试连接");
        expect(headingAction("[data-sample-models-remove]").getAttribute("aria-label")).toBe("删除：DeepSeek");
        host.user.setInvalid("第 1 行：缺右花括号");
        await flushPromises();
        expect(scope().disabled).toBe(true);
        expect([headingAction("[data-sample-models-test]"), headingAction("[data-sample-models-remove]")].every((button) => scope().contains(button))).toBe(true);
        // 页面自己的控件按 context.writable 停用：字段只读。
        expect(detailInputs().every((input) => input.readOnly)).toBe(true);
        host.user.setInvalid(null);
        await flushPromises();
        expect(scope().disabled).toBe(false);
    });

    it("测试连接：结果写在列表的这一行右端（已连接是成功色，连不上是出错色）", async () => {
        await scene("page-fill");
        await loaded();
        expect(all("[data-settings-page-list-status]")).toEqual([]);
        await pick("DeepSeek");
        headingAction("[data-sample-models-test]").click();
        await flushPromises();
        await goBack();
        const statuses = all("[data-sample-models] [data-settings-page-list-status]");
        expect(statuses.map((status) => [status.textContent, status.dataset.tone])).toEqual([["已连接", "success"]]);
        expect(statuses[0]!.closest("[data-settings-page-list-item]")).toBe(rows().find((element) => rowTitle(element) === "DeepSeek"));
    });

    it("改动先进草稿、报未保存；新加的一项没填好时保存被拒并写出原因；填好保存后整组写进用户层，焦点回到第一个输入框", async () => {
        const {host} = await scene("page-fill");
        await loaded();
        // 停在列表、没有改动时没有保存栏：“常规”两项即时写入。
        expect(document.body.querySelector("[data-sample-models-bar]")).toBeNull();
        headingAction("[data-sample-models-add]").click();
        await flushPromises();
        // 新加的一家随即打开，标题区写“未命名的服务商”。
        expect(titleText()).toBe("未命名的服务商");
        expect(host.window.unsaved.value).toBe(true);
        expect(providers(host)).toHaveLength(2);
        action(t("saveBar.save")).click();
        await flushPromises();
        expect(one("[data-settings-save-bar-note]").textContent).toMatch(/^还没保存：/u);
        expect(providers(host)).toHaveLength(2);
        const [id, name, baseUrl, timeout] = detailInputs();
        await fill(id!, "openai");
        await fill(name!, "OpenAI");
        await fill(baseUrl!, "https://api.openai.com/v1");
        await fill(timeout!, "30");
        expect(titleText()).toBe("OpenAI");
        action(t("saveBar.save")).click();
        await flushPromises();
        expect(providers(host)?.map((provider) => provider.id)).toEqual(["deepseek", "local", "openai"]);
        expect(host.window.unsaved.value).toBe(false);
        expect(action(t("saveBar.save")).disabled).toBe(true);
        expect(document.activeElement).toBe(detailInputs()[0]);
    });

    it("删掉一家回到列表，保存栏仍在（有没保存的改动）；放弃更改回到已保存的值；删掉默认模型所在的服务商并保存：默认模型照常显示、标“已不存在”", async () => {
        const {host} = await scene("page-fill");
        await loaded();
        await pick("DeepSeek");
        headingAction("[data-sample-models-remove]").click();
        await flushPromises();
        expect(listTitles()).toEqual(["本地 Ollama"]);
        expect(titleText()).toBe("模型服务");
        action(t("saveBar.discard")).click();
        await flushPromises();
        expect(listTitles()).toEqual(["DeepSeek", "本地 Ollama"]);
        expect(host.window.unsaved.value).toBe(false);
        expect(document.body.querySelector("[data-sample-models-bar]")).toBeNull();
        await pick("DeepSeek");
        headingAction("[data-sample-models-remove]").click();
        await flushPromises();
        action(t("saveBar.save")).click();
        await flushPromises();
        expect(providers(host)?.map((provider) => provider.id)).toEqual(["local"]);
        expect(host.user.values()["example.models/defaultModel"]).toBe("deepseek/deepseek-chat");
        expect(one("[data-settings-row='example.models/defaultModel']").textContent).toContain("已不存在");
    });

    it("有未保存的改动时切到别的分区：先弹确认；放弃后离开，回来时是已保存的值", async () => {
        const {host} = await scene("page-fill");
        await loaded();
        await pick("DeepSeek");
        await fill(detailInputs()[1]!, "深度求索");
        expect(host.window.unsaved.value).toBe(true);
        one("[data-settings-nav='nbook.appearance']").click();
        await flushPromises();
        [...one("[role='alertdialog']").querySelectorAll("button")].find((button) => button.textContent?.trim() === t("window.leave.discard"))!.click();
        await flushPromises();
        expect(host.window.section.value).toBe("nbook.appearance");
        // 页面卸载，标题区也不再带着上一页的“‹ 模型服务”。
        expect(document.body.querySelector("[data-settings-heading-back]")).toBeNull();
        host.window.select("example.models.main");
        await loaded();
        expect(listTitles()[0]).toBe("DeepSeek");
        expect(titleText()).toBe("模型服务");
        expect(host.window.unsaved.value).toBe(false);
    });

    it("改过的服务商在列表里标圆点；解析不了的输入随详情卸载丢掉，回来是原值、不再算未保存", async () => {
        const {host} = await scene("page-fill");
        await loaded();
        const edited = () => rows().filter((element) => element.querySelector("[data-settings-page-list-modified]") !== null).map(rowTitle);
        await pick("DeepSeek");
        await fill(detailInputs()[1]!, "深度求索");
        await goBack();
        expect(edited()).toEqual(["深度求索"]);
        await pick("深度求索");
        await fill(detailInputs()[1]!, "DeepSeek");
        await goBack();
        expect(edited()).toEqual([]);
        expect(host.window.unsaved.value).toBe(false);

        await pick("DeepSeek");
        await fill(detailInputs()[3]!, "abc");
        expect(host.window.unsaved.value).toBe(true);
        await goBack();
        expect(host.window.unsaved.value).toBe(false);
        expect(edited()).toEqual([]);
        await pick("DeepSeek");
        expect(detailInputs()[3]!.value).toBe("60");
    });

    it("没有改动时别处在最前面加了一家：草稿跟上，打开的仍是原来那家", async () => {
        const {host} = await scene("page-fill");
        await loaded();
        await pick("本地 Ollama");
        // 配置服务给的是只读值，写回去要一份可改的。
        const before = host.service("example.models").get(modelsSettings.providers).map(({models, ...rest}) => ({...rest, ...(models === undefined ? {} : {models: [...models]})}));
        await host.service("example.models").update(modelsSettings.providers, [{id: "other", name: "别处加的", baseUrl: "https://example.com", timeout: 10}, ...before], {layer: "user"});
        await flushPromises();
        expect(titleText()).toBe("本地 Ollama");
        expect(detailInputs()[1]!.value).toBe("本地 Ollama");
        await goBack();
        expect(listTitles()).toEqual(["别处加的", "DeepSeek", "本地 Ollama"]);
    });
});

describe("实现审查补的用例（Sonnet 第 1、2、9、10、13 条，第 5 条的样板）", () => {
    const area = (): HTMLTextAreaElement => one("[data-settings-file-text]") as HTMLTextAreaElement;
    const key = (target: Element, init: KeyboardEventInit): KeyboardEvent => {
        const event = new KeyboardEvent("keydown", {bubbles: true, cancelable: true, ...init});
        target.dispatchEvent(event);
        return event;
    };
    const ready = () => vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));

    it("设置文件文本框里第一次 Esc 不关窗口（只放开 Tab），再按一次才交给窗口；文本框里的 Mod+F 留给浏览器", async () => {
        const {host} = await scene("file");
        await ready();
        area().focus();
        expect(key(area(), {key: "f", code: "KeyF", ctrlKey: true}).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(area());
        expect(key(area(), {key: "Escape"}).defaultPrevented).toBe(true);
        await flushPromises();
        expect(host.window.open.value).toBe(true);
        // 按了别的键之后 Tab 又是插空格；紧接着的第二次 Esc 才交给窗口。
        key(area(), {key: "Escape"});
        await flushPromises();
        expect(host.window.open.value).toBe(false);
    });

    it("CRLF 的文件：文本框里是归一后的换行，Tab 插在光标处；保存后整个文件仍是 CRLF", async () => {
        const {host} = await scene("file");
        await ready();
        host.user.setText("{\r\n    \"example.notes/interval\": 120\r\n}\r\n");
        await flushPromises();
        expect(area().value).toBe("{\n    \"example.notes/interval\": 120\n}\n");
        area().focus();
        area().setSelectionRange(2, 2);
        key(area(), {key: "Tab"});
        await flushPromises();
        expect(area().value).toBe("{\n      \"example.notes/interval\": 120\n}\n");
        all("[data-settings-file] button").find((element) => element.textContent?.trim() === t("saveBar.save"))!.click();
        await flushPromises();
        expect(host.user.text()).toBe("{\r\n      \"example.notes/interval\": 120\r\n}\r\n");
    });

    it("放弃确认框里按 Esc 等于“继续编辑”；从搜索框起手的放弃之后焦点回到搜索框", async () => {
        const {host} = await scene("file");
        await ready();
        await (async () => {
            area().value = "{}";
            area().dispatchEvent(new Event("input"));
            await flushPromises();
        })();
        const search = one("[data-settings-search] input") as HTMLInputElement;
        search.focus();
        search.value = "语言";
        search.dispatchEvent(new Event("input"));
        await flushPromises();
        expect(host.window.leaving.value).toEqual({kind: "search", query: "语言"});
        key(one("[role='alertdialog']"), {key: "Escape"});
        await vi.waitFor(() => expect(host.window.leaving.value).toBeNull());
        expect(host.window.query.value).toBe("");
        expect(host.window.unsaved.value).toBe(true);
        await vi.waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).toBeNull());

        search.focus();
        search.value = "语言";
        search.dispatchEvent(new Event("input"));
        await flushPromises();
        [...one("[role='alertdialog']").querySelectorAll("button")].find((button) => button.textContent?.trim() === t("window.leave.discard"))!.click();
        await flushPromises();
        expect(host.window.query.value).toBe("语言");
        await vi.waitFor(() => expect(document.activeElement).toBe(one("[data-settings-search] input")));
    });

    it("模型服务：有改动时别处改了服务商，提示并停用“保存”；“仍然保存”盖掉别处的改动", async () => {
        const {host} = await scene("page-fill");
        await vi.waitFor(() => expect(document.body.querySelector("[data-sample-models]")).not.toBeNull());
        all("[data-sample-models] [data-settings-page-list-item]")[0]!.click();
        await flushPromises();
        const name = (all("[data-sample-models-detail] input") as HTMLInputElement[])[1]!;
        name.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
        name.value = "深度求索";
        name.dispatchEvent(new Event("input"));
        name.dispatchEvent(new FocusEvent("focusout", {bubbles: true}));
        await flushPromises();
        await host.service("example.models").update(modelsSettings.providers, [{id: "other", name: "别处加的", baseUrl: "https://example.com", timeout: 10}], {layer: "user"});
        await flushPromises();
        expect(one("[data-sample-models-changed]").textContent).toContain("别处改过了");
        const save = all("[data-sample-models-bar] button").find((element) => element.textContent?.trim() === t("saveBar.save")) as HTMLButtonElement;
        expect(save.disabled).toBe(true);
        (all("[data-sample-models-changed] button").find((element) => element.textContent?.trim() === t("file.saveAnyway")) as HTMLButtonElement).click();
        await flushPromises();
        expect((host.user.values()["example.models/providers"] as ReadonlyArray<{readonly name: string}>).map((provider) => provider.name)).toEqual(["深度求索", "本地 Ollama"]);
        expect(document.body.querySelector("[data-sample-models-changed]")).toBeNull();
    });
});

describe("实现审查补的用例（omp 第 1、5 条）", () => {
    const area = (): HTMLTextAreaElement => one("[data-settings-file-text]") as HTMLTextAreaElement;

    it("读取进行中文件又变了：读回来的已经过时，读完再读一次，显示最新的文本", async () => {
        const {host} = await scene("other");
        const release = host.user.holdReads();
        host.window.select("file");
        await flushPromises();
        expect(one("[data-settings-file]").dataset.settingsFileState).toBe("loading");
        host.user.setText("{\"example.notes/interval\": 45}");
        release();
        await vi.waitFor(() => expect(area().value).toBe("{\"example.notes/interval\": 45}"));
    });

    it("连不上期间别处改了文件：恢复连接后重新订阅，没有改动时换成新文本", async () => {
        const {host} = await scene("file");
        await vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
        host.user.setUnreachable(true);
        await vi.waitFor(() => expect(host.window.layerNotice.value?.kind).toBe("unavailable"));
        host.user.setText("{\"example.notes/interval\": 15}");
        host.user.setUnreachable(false);
        await vi.waitFor(() => expect(host.window.layerNotice.value).toBeNull());
        await vi.waitFor(() => expect(area().value).toBe("{\"example.notes/interval\": 15}"));
    });
});

describe("实现审查补的用例（omp 第 4 条）", () => {
    it("页面就绪后关窗再开：重新挂上的页面拿到新的上下文，在它上面报未保存照常生效", async () => {
        const contexts: SettingsPageContext[] = [];
        const Page = defineComponent({
            name: "ContextPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup(props) {
                contexts.push(props.context);
                return () => h("p", {"data-context-page": ""}, "页面");
            },
        });
        const created = createSettingsHost({
            settings: [{plugin: "nbook.workbench", definition: themeSetting as SettingDefinition<unknown>}],
            sections: [{id: "x.page.main", plugin: "x.page", kind: "page", declaration: {title: {"zh-CN": "页面", "en-US": "Page"}, icon: "i-lucide-square", category: "plugins"}}],
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        created.publish("x.page.main", async () => Page);
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await vi.waitFor(() => expect(contexts).toHaveLength(1));
        created.window.close();
        await flushPromises();
        created.window.openWindow({});
        await vi.waitFor(() => expect(contexts).toHaveLength(2));
        expect(contexts[1]).not.toBe(contexts[0]);
        contexts[0]!.dirty(true);
        expect(created.window.unsaved.value).toBe(false);
        contexts[1]!.dirty(true);
        expect(created.window.unsaved.value).toBe(true);
    });
});

describe("标题区：层警告、定位与页面级操作（输出 3、13、19、22、23）", () => {
    const area = (): HTMLTextAreaElement => one("[data-settings-file-text]") as HTMLTextAreaElement;
    const ready = () => vi.waitFor(() => expect(one("[data-settings-file]").dataset.settingsFileState).toBe("ready"));
    const heading = (): HTMLElement => one("[data-settings-heading]");
    const titleText = (): string | null | undefined => heading().querySelector("h2")?.textContent;
    /** “file-invalid”场景的坏文件：第 3 行（缺逗号的下一行）行首缩进之后。 */
    const BROKEN_POSITION = {line: 3, column: 5};
    const brokenOffset = (text: string): number => text.split("\n").slice(0, BROKEN_POSITION.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + BROKEN_POSITION.column - 1;

    it("层文件有语法错误：点警告切到设置文件、光标放在出错处；标题区改写成“第 N 行第 M 列：原因，改好后保存”；位置只用一次，修好保存后警告消失", async () => {
        const {host} = await scene("file-invalid");
        await ready();
        // 已在设置文件视图里：不再给按钮，写出错位置。
        expect(document.body.querySelector("[data-settings-open-file]")).toBeNull();
        const fixing = one("[data-settings-layer-notice='fixing']").textContent ?? "";
        expect(fixing).toMatch(/^第 3 行第 5 列：.+，改好后保存$/u);
        host.window.select("nbook.appearance");
        await flushPromises();
        const warning = one("[data-settings-layer-notice='invalid']");
        expect(warning.textContent).toContain(t("window.invalid"));
        warning.focus();
        await vi.waitFor(() => expect(tooltipLines()[0]).toMatch(/^第 3 行第 5 列：/u));
        expect(tooltipLines().slice(1)).toEqual(["修复前，这一层的设置无法保存"]);
        warning.click();
        await flushPromises();
        expect(host.window.section.value).toBe("file");
        await ready();
        await vi.waitFor(() => expect(document.activeElement).toBe(area()));
        expect(area().selectionStart).toBe(brokenOffset(area().value));
        expect(area().selectionEnd).toBe(area().selectionStart);
        expect(host.window.fileLocation.value).toBeNull();
        expect(one("[data-settings-layer-notice='fixing']").textContent).toBe(fixing);
        // 出错行（第 3 行）标底色；一改文本就去掉，标题区仍写层的“改好后保存”。
        expect(all("[data-settings-file-line][data-error]").map((line) => line.textContent?.trim())).toEqual(["3"]);
        area().value = `${area().value} `;
        area().dispatchEvent(new Event("input"));
        await flushPromises();
        expect(document.body.querySelector("[data-settings-file-line][data-error]")).toBeNull();
        expect(one("[data-settings-layer-notice='fixing']").textContent).toBe(fixing);
        // 修好、保存：警告消失。
        area().value = "{\"nbook.workbench/theme\": \"macos\"}";
        area().dispatchEvent(new Event("input"));
        await flushPromises();
        const save = all("[data-settings-file] button").find((element) => element.textContent?.trim() === t("saveBar.save")) as HTMLButtonElement;
        save.click();
        await flushPromises();
        expect(document.body.querySelector("[data-settings-layer-notice]")).toBeNull();
    });

    it("位置用过一次就没有了：离开设置文件再回来，光标不再被放回出错处", async () => {
        const {host} = await scene("file-invalid");
        host.window.select("nbook.appearance");
        await flushPromises();
        one("[data-settings-open-file]").click();
        await flushPromises();
        await ready();
        await vi.waitFor(() => expect(area().selectionStart).toBe(brokenOffset(area().value)));
        host.window.select("nbook.appearance");
        await flushPromises();
        host.window.select("file");
        await flushPromises();
        await ready();
        expect(area().selectionStart).not.toBe(brokenOffset(area().value));
        expect(document.body.querySelector("[data-settings-file-line][data-error]")).toBeNull();
    });

    it("读取进行中文件又变了：位置留到重读的最新文本上再用", async () => {
        const {host} = await scene("file-invalid");
        host.window.select("nbook.appearance");
        await flushPromises();
        const release = host.user.holdReads();
        one("[data-settings-open-file]").click();
        await flushPromises();
        // 末尾加一行：出错处仍在第 3 行，最新文本与第一次读回的不同。
        const latest = `${host.user.text()}\n`;
        host.user.setText(latest);
        release();
        await vi.waitFor(() => expect(area().value).toBe(latest));
        await vi.waitFor(() => expect(area().selectionStart).toBe(brokenOffset(latest)));
        expect(all("[data-settings-file-line][data-error]").map((line) => line.textContent?.trim())).toEqual(["3"]);
    });

    /** 一个会报未保存的 page 分区，用户层文件是坏的：点警告要先过未保存确认。 */
    async function dirtyPageWithBrokenLayer() {
        let context: SettingsPageContext | null = null;
        const Dirty = defineComponent({
            name: "DirtyPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup(props) {
                context = props.context;
                return () => h("p", {"data-dirty-page": ""}, "草稿");
            },
        });
        const created = createSettingsHost({
            settings: [{plugin: "nbook.workbench", definition: themeSetting as SettingDefinition<unknown>}],
            sections: [{id: "x.page.main", plugin: "x.page", kind: "page", declaration: {title: {"zh-CN": "页面", "en-US": "Page"}, icon: "i-lucide-square", category: "plugins"}}],
            user: {text: "{\n    \"nbook.workbench/theme\": \"macos\"\n    \"example.notes/interval\": 120\n}\n"},
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        created.publish("x.page.main", async () => Dirty);
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-dirty-page]")).not.toBeNull());
        context!.dirty(true);
        return created;
    }

    it("页面有未保存的改动：点警告先弹同切分区一样的确认；继续编辑留在原页面、什么也不挂；放弃后切到设置文件并定位", async () => {
        const created = await dirtyPageWithBrokenLayer();
        const warning = one("[data-settings-open-file]");
        warning.focus();
        warning.click();
        await flushPromises();
        const dialog = one("[role='alertdialog']");
        expect(dialog.textContent).toContain(t("window.leave.title"));
        expect(dialog.textContent).toContain(t("window.leave.description", {title: "页面"}));
        expect([created.window.section.value, created.window.fileLocation.value]).toEqual(["x.page.main", null]);
        [...dialog.querySelectorAll("button")].find((button) => button.textContent?.trim() === t("window.leave.keepEditing"))!.click();
        await vi.waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).toBeNull());
        expect([created.window.section.value, created.window.fileLocation.value, created.window.unsaved.value]).toEqual(["x.page.main", null, true]);
        expect(document.body.querySelector("[data-dirty-page]")).not.toBeNull();

        one("[data-settings-open-file]").click();
        await flushPromises();
        [...one("[role='alertdialog']").querySelectorAll("button")].find((button) => button.textContent?.trim() === t("window.leave.discard"))!.click();
        await flushPromises();
        expect(created.window.section.value).toBe("file");
        await ready();
        await vi.waitFor(() => expect(area().selectionStart).toBe(brokenOffset(area().value)));
        // 确认框关掉之后焦点仍在文本框里，没有被拉回左栏。
        await vi.waitFor(() => expect(document.body.querySelector("[role='alertdialog']")).toBeNull());
        await flushPromises();
        expect(document.activeElement).toBe(area());
    });

    /** 一个会按按钮登记标题替换的 page 分区，另带一个页面级操作；`events` 记下 back 与卸载。 */
    function claimingHost() {
        const events: string[] = [];
        let crash = false;
        const crashNow = ref(false);
        const Page = defineComponent({
            name: "ClaimingPage",
            props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
            setup() {
                const chrome = usePageChrome()!;
                // 页面自己管层级：进入下一级时登记新标题，再把上一次登记的撤销交出去（已被盖过，应当不起作用）；返回时撤销当前的、
                // 重新登记上一级的标题。
                const titles: string[] = [];
                let undoCurrent: (() => void) | null = null;
                const show = (): void => {
                    const previous = undoCurrent;
                    const title = titles.at(-1);
                    undoCurrent = title === undefined ? null : chrome.claim({title, back});
                    previous?.();
                };
                const back = (): void => {
                    events.push(`back ${titles.at(-1)}`);
                    titles.pop();
                    show();
                };
                const open = (title: string): void => {
                    titles.push(title);
                    show();
                };
                onBeforeUnmount(() => {
                    events.push("unmount");
                    undoCurrent?.();
                });
                return () => {
                    if (crashNow.value && crash) throw new Error("页面出错了");
                    return h("div", {"data-claim-page": ""}, [
                        h("button", {type: "button", "data-claim": "深层 A", onClick: () => open("深层 A")}, "进入 A"),
                        h("button", {type: "button", "data-claim": "深层 B", onClick: () => open("深层 B")}, "进入 B"),
                        h(SettingsPageActions, null, {default: () => h("button", {type: "button", "data-page-action": ""}, "新增")}),
                    ]);
                };
            },
        });
        const created = createSettingsHost({
            settings: [{plugin: "nbook.workbench", definition: themeSetting as SettingDefinition<unknown>}],
            sections: [{id: "x.page.main", plugin: "x.page", kind: "page", declaration: {title: {"zh-CN": "页面", "en-US": "Page"}, description: {"zh-CN": "页面的说明", "en-US": "Page description"}, icon: "i-lucide-square", category: "plugins"}}],
            project: {},
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        created.publish("x.page.main", async () => Page);
        created.window.openWindow({section: "x.page.main"});
        render(created.window);
        return {created, events, breakPage: () => {
            crash = true;
            crashNow.value = true;
        }, fixPage: () => {
            crash = false;
        }};
    }
    const claim = async (title: string): Promise<void> => {
        one(`[data-claim="${title}"]`).click();
        await flushPromises();
    };

    it("页面级操作出现在标题区右侧、不在页面正文里；层文件坏了时停用，修好后恢复；离开分区时消失", async () => {
        const {created} = claimingHost();
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        expect(one("[data-settings-heading-actions] [data-page-action]").textContent).toBe("新增");
        expect(document.body.querySelector("[data-claim-page] [data-page-action]")).toBeNull();
        const scope = () => one("[data-settings-heading-actions] [data-settings-page-actions]") as HTMLFieldSetElement;
        expect(scope().disabled).toBe(false);
        created.user.setInvalid("第 1 行：缺右花括号");
        await flushPromises();
        expect(scope().disabled).toBe(true);
        // 警告与操作同在标题区右侧。
        expect(heading().contains(one("[data-settings-layer-notice='invalid']"))).toBe(true);
        created.user.setInvalid(null);
        await flushPromises();
        expect(scope().disabled).toBe(false);
        created.window.select("other");
        await flushPromises();
        expect(document.body.querySelector("[data-page-action]")).toBeNull();
    });

    it("页面登记标题替换：标题区写“‹ 页面标题”与下一级的标题、说明收起；点返回由页面退一级；被盖过的旧登记撤销时不动新的", async () => {
        const {events} = claimingHost();
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        expect(titleText()).toBe("页面");
        expect(document.body.querySelector("[data-settings-heading-description]")?.textContent).toBe("页面的说明");
        expect(document.body.querySelector("[data-settings-heading-back]")).toBeNull();
        await claim("深层 A");
        expect(titleText()).toBe("深层 A");
        expect(one("[data-settings-heading-back]").textContent?.trim()).toBe("页面");
        expect(document.body.querySelector("[data-settings-heading-description]")).toBeNull();
        await claim("深层 B");
        expect(titleText()).toBe("深层 B");
        one("[data-settings-heading-back]").click();
        await flushPromises();
        // 页面的 back 退回上一级：重新登记 A；再返回一次回到页面标题。
        expect(events).toEqual(["back 深层 B"]);
        expect(titleText()).toBe("深层 A");
        one("[data-settings-heading-back]").click();
        await flushPromises();
        expect(titleText()).toBe("页面");
        expect(document.body.querySelector("[data-settings-heading-back]")).toBeNull();
        expect(document.body.querySelector("[data-settings-heading-description]")?.textContent).toBe("页面的说明");
    });

    it("标题替换随页面的寿命：切标签保留；离开分区、开始搜索、关窗口再开都回到页面标题", async () => {
        const {created, events} = claimingHost();
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        await claim("深层 A");
        // 切标签：页面不重建，标题替换还在。
        all("[data-settings-tabs] button[role='radio']").find((button) => button.textContent?.trim() === t("window.project"))?.click();
        await flushPromises();
        expect(events).toEqual([]);
        expect(titleText()).toBe("深层 A");
        // 离开分区：下一个分区的标题不被上一个页面的登记占着。
        one("[data-settings-nav='other']").click();
        await flushPromises();
        expect(events).toEqual(["unmount"]);
        expect(titleText()).toBe(t("model.otherTitle"));
        one("[data-settings-nav='x.page.main']").click();
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        expect(titleText()).toBe("页面");
        // 开始搜索：页面卸载，搜索结果的标题是搜索的标题；清空搜索回来是页面标题。
        await claim("深层 A");
        created.window.search("主题");
        await flushPromises();
        expect(document.body.querySelector("[data-settings-heading-back]")).toBeNull();
        expect(titleText()).not.toBe("深层 A");
        created.window.search("");
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        expect(titleText()).toBe("页面");
        // 关窗口再开。
        await claim("深层 B");
        created.window.close();
        await flushPromises();
        created.window.openWindow({section: "x.page.main"});
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        expect(titleText()).toBe("页面");
        expect(document.body.querySelector("[data-settings-heading-back]")).toBeNull();
    });

    it("页面渲染出错：卸载时撤销登记，标题回到页面标题；重试重建后也是页面标题", async () => {
        const {events, breakPage, fixPage} = claimingHost();
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        await claim("深层 A");
        breakPage();
        await vi.waitFor(() => expect(document.body.querySelector("[data-settings-page-state='render-failed']")).not.toBeNull());
        expect(events).toContain("unmount");
        expect(titleText()).toBe("页面");
        expect(document.body.querySelector("[data-settings-heading-back]")).toBeNull();
        fixPage();
        one("[data-settings-page-retry-render]").click();
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        expect(titleText()).toBe("页面");
    });

    it("标题上的说明放不下时靠悬停显示全文；很长的说明只占一行", async () => {
        claimingHost();
        await flushPromises();
        await vi.waitFor(() => expect(document.body.querySelector("[data-claim-page]")).not.toBeNull());
        const description = one("[data-settings-heading-description]");
        description.focus();
        description.dispatchEvent(new PointerEvent("pointermove", {bubbles: true, pointerType: "mouse"}));
        await vi.waitFor(() => expect(document.body.querySelector(".nb-ui-tooltip-surface")?.textContent).toContain("页面的说明"));
    });
});

describe("左栏、搜索结果与命中高亮（输出 1、21）", () => {
    const text = (zh: string, en: string = zh) => ({"zh-CN": zh, "en-US": en});
    const define = (name: string, title: string, options: {description?: string; section: string; group?: string}) => defineSetting({
        plugin: "x.editor",
        name,
        schema: Type.Integer(),
        default: 14,
        title: text(title),
        ...(options.description === undefined ? {} : {description: text(options.description)}),
        section: options.section,
        ...(options.group === undefined ? {} : {group: options.group}),
    }) as SettingDefinition<unknown>;

    /** 一个“编辑器”分区（带“终端”小组）、一个“常用片段”页面分区，设置的文字里有大小写混写与要转义的字符。 */
    function searchHost() {
        const fontSize = define("fontSize", "字号", {description: "代码里的字号与行距；字号越大越清楚", section: "x.editor.main"});
        const termSize = define("termSize", "终端字号", {section: "x.editor.main", group: "terminal"});
        const mixed = define("mixed", "Font Size 字体", {description: "FONT family 与 font weight", section: "x.editor.main"});
        const special = define("special", "<b>粗体</b> & (a+b)*", {description: "1 < 2 && 3 > 2 [x] .*", section: "x.editor.main"});
        const created = createSettingsHost({
            settings: [fontSize, termSize, mixed, special].map((definition) => ({plugin: "x.editor", definition})),
            sections: [
                {id: "x.editor.main", plugin: "x.editor", kind: "list", declaration: {title: text("编辑器"), icon: "i-lucide-square", category: "app", groups: [{id: "terminal", title: text("终端")}]}},
                {id: "x.snippets.main", plugin: "x.snippets", kind: "page", declaration: {title: text("常用片段"), description: text("插入片段时的字号与快捷键"), icon: "i-lucide-square", category: "plugins"}},
            ],
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        created.window.openWindow({section: "x.editor.main"});
        render(created.window);
        return created;
    }

    /** 一个元素里所有 `<mark>` 的字。 */
    const marks = (element: Element | null): string[] => [...(element?.querySelectorAll("mark") ?? [])].map((mark) => mark.textContent ?? "");
    const rowOf = (key: string): HTMLElement => one(`[data-settings-row="${key}"]`);
    const titleOf = (key: string): HTMLElement => rowOf(key).querySelector("label") as HTMLElement;
    const descriptionOf = (key: string): HTMLElement | null => rowOf(key).querySelector(".settings-row__description");
    async function searchFor(created: ReturnType<typeof searchHost>, query: string): Promise<void> {
        created.window.search(query);
        await flushPromises();
    }

    it("左栏三组的上方各有一个组标题，顺序是通用、写作助手、扩展；组标题之后才是这一组的分区；不再有分隔线", async () => {
        await scene("user");
        const order = all("[data-settings-nav-label], [data-settings-nav]").map((element) => element.dataset.settingsNavLabel === undefined ? element.dataset.settingsNav : `组：${element.textContent}`);
        expect(order).toEqual([`组：${t("window.groups.app")}`, "nbook.appearance", `组：${t("window.groups.ai")}`, "example.models.main", `组：${t("window.groups.plugins")}`, "example.snippets.main", "other", "file"]);
        expect(document.body.querySelector("[data-settings-nav-separator]")).toBeNull();
    });

    it("英文界面的组标题；没有归入分区的设置在左栏与标题里是“插件设置”（id 仍是 other），说明是“未提供独立分区的插件设置”", async () => {
        const created = createSettingsHost({
            settings: [define("orphan", "孤儿", {section: "x.nowhere"})].map((definition) => ({plugin: "x.editor", definition})),
            sections: [
                {id: "x.a", plugin: "x.a", kind: "list", declaration: {title: text("甲", "A"), icon: "i-lucide-square", category: "app"}},
                {id: "x.b", plugin: "x.b", kind: "list", declaration: {title: text("乙", "B"), icon: "i-lucide-square", category: "ai"}},
                {id: "x.c", plugin: "x.c", kind: "list", declaration: {title: text("丙", "C"), icon: "i-lucide-square", category: "plugins"}},
            ],
            locale: "en-US",
            notify: () => undefined,
            report: () => undefined,
        });
        cleanup.push(() => created.dispose());
        created.window.openWindow({section: "other"});
        render(created.window, "en-US");
        await flushPromises();
        const english = settingsTestText("en-US").t;
        expect(all("[data-settings-nav-label]").map((label) => label.textContent)).toEqual([english("window.groups.app"), english("window.groups.ai"), english("window.groups.plugins")]);
        expect(one("[data-settings-nav='other']").textContent?.trim()).toBe(english("model.otherTitle"));
        expect(one("[data-settings-heading] h2").textContent).toBe(english("model.otherTitle"));
        expect(one("[data-settings-heading-description]").textContent).toBe(english("model.otherDescription"));
        expect(english("model.otherTitle")).not.toBe(t("model.otherTitle"));

        cleanup.splice(0).forEach((dispose) => dispose());
        document.body.innerHTML = "";
        await scene("other");
        expect(one("[data-settings-nav='other']").textContent?.trim()).toBe(t("model.otherTitle"));
        expect(one("[data-settings-heading] h2").textContent).toBe(t("model.otherTitle"));
        expect(one("[data-settings-heading-description]").textContent).toBe(t("model.otherDescription"));
    });

    it("左栏的分区是列表行：当前项标 aria-current、悬停与按下都没有缩放（类与行内样式里没有 scale）", async () => {
        await scene("user");
        const items = all("[data-settings-nav]");
        expect(items.filter((item) => item.getAttribute("aria-current") === "page").map((item) => item.dataset.settingsNav)).toEqual(["nbook.appearance"]);
        const target = items[1]!;
        for (const type of ["pointerenter", "pointerdown", "mousedown"]) target.dispatchEvent(new MouseEvent(type, {bubbles: true}));
        for (const item of items) {
            expect(item.className).not.toMatch(/scale|active:/u);
            expect(item.getAttribute("style") ?? "").not.toMatch(/scale|transform/u);
        }
    });

    it("搜索结果的组标题：有小组写“分区名 › 小组名”（分区名淡色单独成段），没有小组只写分区名；页面命中在最后的“页面”组，每条一行、右端“打开 ›”", async () => {
        const created = searchHost();
        await searchFor(created, "字号");
        const groups = all("[data-settings-group]");
        expect(groups.map((group) => group.dataset.settingsGroup)).toEqual(["x.editor.main#", "x.editor.main#terminal"]);
        const [plain, grouped] = groups.map((group) => group.querySelector("h3")!);
        expect(plain!.textContent?.trim()).toBe("编辑器");
        expect(plain!.querySelector(".settings-list-section__crumb")).toBeNull();
        expect(grouped!.textContent?.replace(/\s+/gu, " ").trim()).toBe("编辑器 › 终端");
        expect(grouped!.querySelector(".settings-list-section__crumb")?.textContent).toBe("编辑器 ›");

        const pages = one("[data-settings-page-hits]");
        expect(pages.querySelector("h3")?.textContent).toBe("页面");
        // “页面”组排在所有设置组之后。
        expect(one("[data-settings-list]").compareDocumentPosition(pages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        const hits = all("[data-settings-page-hit]");
        expect(hits.map((hit) => hit.dataset.settingsPageHit)).toEqual(["x.snippets.main"]);
        expect(hits[0]!.tagName).toBe("BUTTON");
        expect(hits[0]!.textContent).toContain("常用片段");
        expect(hits[0]!.textContent?.trim().endsWith(t("window.openAction"))).toBe(true);
        expect(one("[data-settings-result-count]").textContent).toBe(t("window.results", {settings: 2, pages: 1}));
    });

    it("高亮：标题与说明各自标出命中的字，每个词的所有命中都标；文本总值不变，list 行与页面命中都一样", async () => {
        const created = searchHost();
        await searchFor(created, "字号");
        expect(marks(titleOf("x.editor/fontSize"))).toEqual(["字号"]);
        expect(titleOf("x.editor/fontSize").textContent).toBe("字号");
        expect(marks(descriptionOf("x.editor/fontSize"))).toEqual(["字号", "字号"]);
        expect(descriptionOf("x.editor/fontSize")?.textContent).toBe("代码里的字号与行距；字号越大越清楚");
        expect(marks(titleOf("x.editor/termSize"))).toEqual(["字号"]);
        expect(titleOf("x.editor/termSize").textContent).toBe("终端字号");
        // 页面命中：标题没有命中，说明里命中。
        const hit = one("[data-settings-page-hit='x.snippets.main']");
        expect(marks(hit.querySelector(".settings-window__hit-title"))).toEqual([]);
        expect(marks(hit.querySelector(".settings-window__description"))).toEqual(["字号"]);
        expect(hit.querySelector(".settings-window__description")?.textContent).toBe("插入片段时的字号与快捷键");

        // 多个词：每个词各自标出；不是每个词都命中的项不在结果里。
        await searchFor(created, "字号 行距");
        expect(all("[data-settings-row]").map((row) => row.dataset.settingsRow)).toEqual(["x.editor/fontSize"]);
        expect(marks(titleOf("x.editor/fontSize"))).toEqual(["字号"]);
        expect(marks(descriptionOf("x.editor/fontSize"))).toEqual(["字号", "行距", "字号"]);
        expect(descriptionOf("x.editor/fontSize")?.textContent).toBe("代码里的字号与行距；字号越大越清楚");

        // 页面命中里两个词：标题与说明各标各的。
        await searchFor(created, "片段 字号");
        expect(marks(one("[data-settings-page-hit] .settings-window__hit-title"))).toEqual(["片段"]);
        expect(marks(one("[data-settings-page-hit] .settings-window__description"))).toEqual(["片段", "字号"]);
    });

    it("高亮不分大小写，标出的是原文的写法；只靠键命中的项不标字", async () => {
        const created = searchHost();
        await searchFor(created, "FONT");
        expect(marks(titleOf("x.editor/mixed"))).toEqual(["Font"]);
        expect(titleOf("x.editor/mixed").textContent).toBe("Font Size 字体");
        expect(marks(descriptionOf("x.editor/mixed"))).toEqual(["FONT", "font"]);
        expect(descriptionOf("x.editor/mixed")?.textContent).toBe("FONT family 与 font weight");
        // “字号”的键 x.editor/fontSize 里有 font：列出，但标题与说明里没有这个词。
        expect(marks(rowOf("x.editor/fontSize"))).toEqual([]);
    });

    it("高亮对特殊字符：尖括号、&、正则元字符都按字面找、按文字显示，不生成元素，文本总值不变", async () => {
        const created = searchHost();
        const original = {title: "<b>粗体</b> & (a+b)*", description: "1 < 2 && 3 > 2 [x] .*"};
        const expectUnchanged = (): void => {
            expect(titleOf("x.editor/special").textContent).toBe(original.title);
            expect(descriptionOf("x.editor/special")?.textContent).toBe(original.description);
            // 用户文字里的标签不会成为元素。
            expect(rowOf("x.editor/special").querySelector("b")).toBeNull();
        };
        await searchFor(created, "<b>");
        expect(marks(titleOf("x.editor/special"))).toEqual(["<b>"]);
        expect(marks(descriptionOf("x.editor/special"))).toEqual([]);
        expectUnchanged();
        await searchFor(created, "&");
        expect(marks(titleOf("x.editor/special"))).toEqual(["&"]);
        expect(marks(descriptionOf("x.editor/special"))).toEqual(["&", "&"]);
        expectUnchanged();
        await searchFor(created, "(a+b)*");
        expect(marks(titleOf("x.editor/special"))).toEqual(["(a+b)*"]);
        expectUnchanged();
        // `.*` 不是“任意文字”：只标原文里的那两个字符。
        await searchFor(created, ".*");
        expect(marks(titleOf("x.editor/special"))).toEqual([]);
        expect(marks(descriptionOf("x.editor/special"))).toEqual([".*"]);
        expectUnchanged();
        await searchFor(created, "[x]");
        expect(marks(descriptionOf("x.editor/special"))).toEqual(["[x]"]);
        expectUnchanged();
    });
});
