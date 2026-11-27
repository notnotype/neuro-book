import {createSubjectFixture, defineLabFixture, type LabFixture} from "nbook/plugins/lab/web/scene-kit";
import type FirstRunWizard from "nbook/plugins/desktop/web/components/FirstRunWizard.vue";
import {withDesktopText} from "./desktop-text";
import {FIRST_RUN_THUMBNAILS} from "nbook/plugins/desktop/web/first-run-assets";

/** 首次启动向导（desktop-shell 输出 34）的场景：四步、便携版、写入失败、作品目录还没建、插件主题、英文。 */
function firstRunScenes() {
    const themes = [
        {id: "nbook", name: "NeuroBook", thumbnails: FIRST_RUN_THUMBNAILS.nbook ?? null},
        {id: "macos", name: "macOS", thumbnails: FIRST_RUN_THUMBNAILS.macos ?? null},
        {id: "eye-green", name: "护眼绿", thumbnails: FIRST_RUN_THUMBNAILS["eye-green"] ?? null},
        {id: "eye-sepia", name: "护眼米黄", thumbnails: FIRST_RUN_THUMBNAILS["eye-sepia"] ?? null},
    ];
    const base = {
        open: true,
        step: 1 as const,
        themes,
        theme: "nbook",
        appearance: "system" as const,
        dark: false,
        locales: [{value: "zh-CN", label: "简体中文"}, {value: "en-US", label: "English"}],
        locale: "zh-CN",
        options: {desktopShortcut: true, openAtLogin: false, tray: false},
        shownOptions: ["desktopShortcut", "openAtLogin", "tray"] as Array<"desktopShortcut" | "openAtLogin" | "tray">,
        places: {stateRoot: "C:\\Users\\lin\\AppData\\Local\\NeuroBook", library: "C:\\Users\\lin\\Documents\\NeuroBook"},
        libraryMissing: false,
        error: null,
    };
    return [
        {id: "welcome", label: "第 1 步：欢迎", input: {props: base}},
        {id: "appearance", label: "第 2 步：外观", input: {props: {...base, step: 2 as const}}},
        {id: "appearance-dark", label: "第 2 步：选了暗色", input: {props: {...base, step: 2 as const, appearance: "dark" as const, dark: true, theme: "eye-green"}}},
        {id: "plugin-theme", label: "第 2 步：插件主题没有缩略图，当前是自建主题", input: {props: {...base, step: 2 as const, theme: "user.my-theme", themes: [...themes, {id: "acme.paper", name: "Paper", thumbnails: null}]}}},
        {id: "desktop", label: "第 3 步：桌面", input: {props: {...base, step: 3 as const}}},
        {id: "desktop-portable", label: "第 3 步：便携版只有关窗去向", input: {props: {...base, step: 3 as const, shownOptions: ["tray"] as Array<"desktopShortcut" | "openAtLogin" | "tray">}}},
        {id: "desktop-error", label: "第 3 步：写入失败", input: {props: {...base, step: 3 as const, error: "登录时打开没有改成，回到了原来的值。"}}},
        {id: "ready", label: "第 4 步：准备好了", input: {props: {...base, step: 4 as const}}},
        {id: "ready-missing", label: "第 4 步：作品目录还没建、路径很长", input: {props: {...base, step: 4 as const, libraryMissing: true, places: {stateRoot: "C:\\Users\\a-very-long-user-name-for-testing\\AppData\\Local\\NeuroBook\\with\\a\\deep\\nested\\path\\to\\wrap", library: "D:\\Writing\\NeuroBook"}}}},
        {id: "english", label: "英文界面（第 3 步）", input: {props: {...base, step: 3 as const, locale: "en-US"}}},
        {id: "appearance-english", label: "英文界面（第 2 步）", input: {props: {...base, step: 2 as const, locale: "en-US"}}},
    ];
}


export const fixtures: LabFixture[] = [
    defineLabFixture<typeof FirstRunWizard>({
        component: "FirstRunWizard",
        scenes: firstRunScenes(),
        load: async () => withDesktopText(createSubjectFixture<typeof FirstRunWizard>((await import("nbook/plugins/desktop/web/components/FirstRunWizard.vue")).default, {events: ["change", "open-place", "next", "back", "skip", "finish"], class: ""})),
    }),
];
