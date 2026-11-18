/**
 * `nbook.desktop` 的首次启动向导入口（docs/specs/runtime/desktop-shell.md 输出 34）：单开一个入口，依赖多（命令、存储、时钟），
 * 解析不了时只是向导出不来，不拖累缩放与把设置交给壳的那个入口。贡献页面浮层（挂向导）与命令“打开桌面版欢迎向导”。
 *
 * 浏览器里（没有壳）浮层的 `load()` 交回空组件、不导入向导，命令的 `when` 要求在桌面里，记录也不打开。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import {Type} from "typebox";
import {computed, defineComponent, h, ref} from "vue";

import {commandServiceKey, COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {projectsRemoteContract} from "nbook/plugins/projects/shared/contracts";
import {displayLocale, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {WORKBENCH_OVERLAYS_POINT, WORKBENCH_THEMES_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ThemeDeclaration} from "nbook/plugins/workbench/shared/contracts";
import type {WorkbenchOverlayImplementation} from "nbook/plugins/workbench/web/contracts";
import {HOST_LOCALES} from "nbook/shared/host-locales";
import {clockKey, windowDesktopKey} from "nbook/shared/host";
import {windowTextPort} from "nbook/shared/window-text";
import {windowTextKey} from "nbook/shared/window-text-key";

import {descriptor} from "../plugin";
import {desktopText} from "../shared/text";
import {createFirstRun, firstRunStore} from "./first-run";
import type {FirstRunMessage, RevealOutcome} from "./first-run";
import {FIRST_RUN_THUMBNAILS} from "./first-run-assets";
import {desktopState} from "./state";

export const DESKTOP_WELCOME_COMMAND = "nbook.help.desktop-welcome";
const FIRST_RUN_OVERLAY = "nbook.desktop.first-run";

const WELCOME_DECLARATION: WrittenCommandDeclaration = {
    category: desktopText("commands.nbook.help.desktop-welcome.category"),
    description: "Open the desktop welcome wizard: theme, light or dark, display language, desktop shortcut, opening at sign-in and staying in the tray.",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "read",
    when: {requires: [desktopState.key("inDesktop")]},
    // Agent 不该在用户面前弹出模态向导。
    expose: {agent: "never"},
};

/** 状态行的文字键：失败的那一项按它在向导里的名字说。 */
const ITEM_NAME = {
    theme: "firstRun.appearance.theme",
    appearance: "firstRun.appearance.scheme",
    locale: "firstRun.appearance.locale",
    desktopShortcut: "firstRun.desktop.desktopShortcut.title",
    openAtLogin: "firstRun.desktop.openAtLogin.title",
    tray: "firstRun.desktop.tray.title",
} as const;

export const firstRunEntry = defineEntry({
    id: "first-run",
    location: "browser",
    activationEvents: ["onStartup"],
    dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: commandServiceKey}, {key: storageKey}, {key: clockKey}, {key: windowDesktopKey, required: false}, {key: windowTextKey, required: false}],
    contributions: [
        {capability: COMMANDS_POINT, id: DESKTOP_WELCOME_COMMAND, declaration: WELCOME_DECLARATION},
        {capability: WORKBENCH_OVERLAYS_POINT, id: FIRST_RUN_OVERLAY, declaration: {}},
    ],
    activate: async (context) => {
        const diagnostics = context.services.require(diagnosticsKey);
        const settings = context.services.require(settingsKey);
        const resolved = await context.services.resolve(windowDesktopKey);
        const desktop = resolved.status === "resolved" && resolved.instance.available ? resolved.instance : null;
        const report = (event: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
            diagnostics.record({level: "warn", event, message, ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
        };
        if (desktop === null) {
            const empty: WorkbenchOverlayImplementation = {load: async () => defineComponent({name: "FirstRunOverlay", setup: () => () => null})};
            return {
                contributions: {
                    [COMMANDS_POINT]: {[DESKTOP_WELCOME_COMMAND]: {run: () => ({ok: false as const, code: "unavailable" as const, reason: "Only in the NeuroBook desktop app"})}},
                    [WORKBENCH_OVERLAYS_POINT]: {[FIRST_RUN_OVERLAY]: empty},
                },
            };
        }

        const text = await windowTextPort(context.services, () => displayLocale(settings));
        const store = firstRunStore.create(context, {storage: context.services.require(storageKey), diagnostics});
        const projects = context.remote.use(projectsRemoteContract);
        const clock = context.services.require(clockKey);
        // 跟随系统时缩略图取哪张：看系统的明暗偏好，变了跟着换。
        // 这个文件也在后端的类型检查范围里（没有 DOM 类型），所以只按用到的成员取 `matchMedia`。
        type Media = {readonly matches: boolean; addEventListener(type: "change", listener: (event: {readonly matches: boolean}) => void): void; removeEventListener(type: "change", listener: (event: {readonly matches: boolean}) => void): void};
        const media = (globalThis as {matchMedia?: (query: string) => Media}).matchMedia?.("(prefers-color-scheme: dark)");
        const systemDark = ref(media?.matches ?? false);
        const onMedia = (event: {readonly matches: boolean}): void => {
            systemDark.value = event.matches;
        };
        media?.addEventListener("change", onMedia);
        // 主题：内置的四个按缩略图表的顺序排前面，插件给的按 id 排在后面；名字随界面语言换。用户在主题编辑器里自建的不走贡献点，不列。
        const builtinOrder = Object.keys(FIRST_RUN_THUMBNAILS);
        const themes = computed(() => context.declarations.list<ThemeDeclaration>(WORKBENCH_THEMES_POINT)
            .map((entry) => ({id: entry.id, name: text.t(entry.declaration.title), thumbnails: FIRST_RUN_THUMBNAILS[entry.id] ?? null}))
            .sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
        const rank = (id: string): number => {
            const index = builtinOrder.indexOf(id);
            return index === -1 ? builtinOrder.length : index;
        };
        const firstRun = createFirstRun({
            settings,
            commands: context.services.require(commandServiceKey),
            desktop,
            store,
            themes,
            locales: HOST_LOCALES.map((locale) => ({value: locale.tag, label: locale.name})),
            systemDark,
            library: async () => {
                const result = await projects.library({});
                if (result.ok) return result.value.path;
                report("desktop.first-run.library-failed", `Reading the works folder failed: ${result.code}`);
                return null;
            },
            revealLibrary: async (): Promise<RevealOutcome> => {
                const result = await projects.revealLibrary({});
                if (result.ok) return "ok";
                const known: ReadonlyArray<RevealOutcome> = ["missing", "not-directory", "not-accessible", "no-desktop", "open-failed"];
                if (known.includes(result.code as RevealOutcome)) return result.code as RevealOutcome;
                report("desktop.first-run.reveal-failed", `Opening the works folder failed: ${result.code}`);
                return "unavailable";
            },
            now: () => clock.now(),
            report,
        });
        context.scope.register({
            kind: "desktop-first-run",
            label: `${descriptor.id} first run`,
            value: firstRun,
            release: (value) => {
                value.dispose();
                media?.removeEventListener("change", onMedia);
            },
        });

        const messageText = (message: FirstRunMessage | null): string | null => {
            if (message === null) return null;
            if (message.kind === "reveal") return text.t(desktopText(`firstRun.errors.reveal.${message.code}`));
            const name = text.t(desktopText(ITEM_NAME[message.item]));
            if (message.kind === "unknown-outcome") return text.t(desktopText("firstRun.errors.unknownOutcome", {name}));
            if (message.cause === null) return text.t(desktopText("firstRun.errors.notSaved", {name}));
            return text.t(desktopText("firstRun.errors.notSavedBecause", {name, cause: text.t(desktopText(`firstRun.errors.causes.${message.cause}`))}));
        };
        const overlay: WorkbenchOverlayImplementation = {
            // `.vue` 只在 load() 里动态导入：插件的合同测试在 bun test 里导入本文件，bun 不能加载 `.vue`。
            load: async () => {
                const FirstRunWizard = (await import("./components/FirstRunWizard.vue")).default;
                return defineComponent({
                    name: "FirstRunOverlay",
                    setup: () => () => {
                        const {message, ...view} = firstRun.view.value;
                        return h(FirstRunWizard, {
                            ...view,
                            error: messageText(message),
                            onChange: firstRun.change,
                            onOpenPlace: firstRun.openPlace,
                            onNext: firstRun.next,
                            onBack: firstRun.back,
                            onSkip: firstRun.close,
                            onFinish: firstRun.close,
                        });
                    },
                });
            },
        };
        return {
            contributions: {
                [COMMANDS_POINT]: {[DESKTOP_WELCOME_COMMAND]: {run: () => {
                    firstRun.show();
                    return {ok: true as const, value: undefined};
                }}},
                [WORKBENCH_OVERLAYS_POINT]: {[FIRST_RUN_OVERLAY]: overlay},
            },
        };
    },
});
