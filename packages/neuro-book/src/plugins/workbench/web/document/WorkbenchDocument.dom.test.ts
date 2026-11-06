/**
 * 工作台页面对文档根的设置（docs/specs/theme/system.md 的“运行时流程”）：真实的 nb-ui 主题包与配色、happy-dom 的文档根。
 * 系统明暗变化时的跟随要真实浏览器派发 `change` 事件，happy-dom 不派发，由 `e2e/settings.e2e.ts` 覆盖；这里覆盖
 * 读系统明暗的初值。
 */

import {mount} from "@vue/test-utils";
import {afterEach, describe, expect, it} from "vitest";
import {nextTick, ref} from "vue";

import {getInstalledTheme} from "@notnotype/nb-ui/theme";

import type {DisplayLocale} from "nbook/shared/localized-text";

import WorkbenchDocument from "./WorkbenchDocument.vue";

interface Device {
    prefersColorScheme: string;
}

function device(): Device {
    return (window as unknown as {happyDOM: {settings: {device: Device}}}).happyDOM.settings.device;
}

const root = (): HTMLElement => document.documentElement;
/** 主题包自带配色里的 `--bg-main`（组件按 defaultColorway 选哪一套，这里直接点名）。 */
const expectedBg = (themeId: string, colorwayId: string): string | undefined => getInstalledTheme(themeId)?.colorways[colorwayId]?.["--bg-main"];
const bgMain = (): string => root().style.getPropertyValue("--bg-main");

afterEach(() => {
    device().prefersColorScheme = "light";
});

describe("WorkbenchDocument", () => {
    it("主题与明暗写到文档根，配色取主题包的 defaultColorway[明暗]；配置变化时重写；卸载时去掉自己写下的主题", async () => {
        const locale = ref<DisplayLocale>("zh-CN");
        const theme = ref("nbook");
        const appearance = ref<"light" | "dark" | "system">("light");
        const wrapper = mount(WorkbenchDocument, {props: {locale, appearance, resolveTheme: () => ({base: theme.value, vars: {}, scene: false})}});
        expect(root().lang).toBe("zh-CN");
        expect(root().dataset.nbTheme).toBe("nbook");
        expect(root().dataset.nbAppearance).toBe("light");
        expect(root().style.colorScheme).toBe("light");
        expect(bgMain()).toBe(expectedBg("nbook", "nbook-light"));

        theme.value = "macos";
        appearance.value = "dark";
        locale.value = "en-US";
        await nextTick();
        expect(root().dataset.nbTheme).toBe("macos");
        expect(root().dataset.nbAppearance).toBe("dark");
        expect(bgMain()).toBe(expectedBg("macos", "macos-dark"));
        expect(root().lang).toBe("en-US");

        wrapper.unmount();
        expect(root().dataset.nbTheme).toBeUndefined();
        expect(root().dataset.nbAppearance).toBeUndefined();
        expect(bgMain()).toBe("");
    });

    it("跟随系统：按挂载时系统的明暗取配色，不改写配置；改成显式明暗后不再看系统", async () => {
        device().prefersColorScheme = "dark";
        const appearance = ref<"light" | "dark" | "system">("system");
        const wrapper = mount(WorkbenchDocument, {props: {locale: ref<DisplayLocale>("zh-CN"), appearance, resolveTheme: () => ({base: "nbook", vars: {}, scene: false})}});
        expect(root().dataset.nbAppearance).toBe("dark");
        expect(bgMain()).toBe(expectedBg("nbook", "nbook-dark"));
        expect(appearance.value).toBe("system");
        appearance.value = "light";
        await nextTick();
        expect(root().dataset.nbAppearance).toBe("light");
        wrapper.unmount();
    });
    it("图标集写成一张无层级的样式表：随主题换，换成没有的或卸载时去掉；高对比度与强制颜色下整张包在媒体查询里不生效", async () => {
        const icons = ref<Record<string, string> | undefined>({files: "/a/files.svg", "book-open-text": '/a/"odd".svg'});
        const wrapper = mount(WorkbenchDocument, {props: {locale: ref<DisplayLocale>("zh-CN"), appearance: ref("light"), resolveTheme: () => ({base: "nbook", vars: {}, scene: false, icons: icons.value})}});
        const sheet = (): string | null => document.head.querySelector("style[data-nb-skin-icons]")?.textContent ?? null;
        expect(sheet()).toContain('.i-lucide-files{--svg:url("/a/files.svg")}');
        expect(sheet()).toContain('.i-lucide-book-open-text{--svg:url("/a/\\"odd\\".svg")}');
        expect(sheet()).toMatch(/^@media not \(\(prefers-contrast: more\) or \(forced-colors: active\)\)\{/u);

        icons.value = {search: "/b/search.svg"};
        await nextTick();
        expect(document.head.querySelectorAll("style[data-nb-skin-icons]")).toHaveLength(1);
        expect(sheet()).toContain(".i-lucide-search{");
        expect(sheet()).not.toContain(".i-lucide-files{");

        icons.value = undefined;
        await nextTick();
        expect(sheet()).toBeNull();

        icons.value = {files: "/a/files.svg"};
        await nextTick();
        expect(sheet()).not.toBeNull();
        wrapper.unmount();
        expect(sheet()).toBeNull();
    });
});
