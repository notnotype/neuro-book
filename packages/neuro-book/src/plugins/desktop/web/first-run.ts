/**
 * 首次启动向导的宿主（docs/specs/runtime/desktop-shell.md 输出 34）：什么时候打开、当前第几步、各项的值与在途值、写配置、写
 * “看过了”的记录、打开两处位置。组件 `FirstRunWizard` 只画它交出的 `props` 并把用户的动作交回来。
 *
 * 值的写法分两种：主题、明暗、语言由别的插件声明，只有声明者能写（configuration.md 输出 11），所以经它们的切换命令写，与命令
 * 面板相同；桌面三项是本插件的配置项，直接写用户层。点了先按所选显示（在途值），写完以配置服务为准；失败时在途值丢掉、控件回到
 * 配置服务的值，状态行说明原因。
 */

import {computed, reactive, watch} from "vue";
import type {ComputedRef, Ref} from "vue";
import {Type} from "typebox";

import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {localeSetting} from "nbook/plugins/settings/shared/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import type {WindowDesktop} from "nbook/shared/host";
import type {InstallFacts} from "nbook/shared/desktop-bridge";
import type {SettingsService} from "nbook/shared/settings";
import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

import {desktopSettings} from "../shared/contracts";

/** “看过首次启动向导”的记录：用户范围、各客户端共用（端口顺延换了客户端身份也不再出现）。只存看过的时刻。 */
export const FIRST_RUN_RECORD = defineRecord({
    key: "first-run",
    scope: "user",
    locality: "shared",
    version: 1,
    schema: Type.Object({at: Type.String({minLength: 1})}, {additionalProperties: false}),
});

export const firstRunStore = defineStore("desktop-first-run", ({persist}) => {
    const seen = persist(FIRST_RUN_RECORD, {initial: {at: ""}});
    return {
        state: {seen},
        actions: {
            /**
             * 记下看过：已有记录（命令重开的向导）不重写；上一次没写成、队列暂停时先整条放弃再写，否则这次会排在暂停的那条
             * 后面一直不发。
             */
            remember: (at: string) => {
                if (seen.base?.status === "ok") return Promise.resolve("unchanged" as const);
                if (seen.save.state === "failed" || seen.save.state === "unknown") seen.discardAll();
                return seen.commit(() => ({at}));
            },
        },
    };
});

export type FirstRunRecordStore = ReturnType<typeof firstRunStore.create>;

/**
 * 切换命令的 id 是声明者的公开接口（`nbook.workbench` 的主题、明暗，`nbook.settings` 的语言）；跨插件只引对方的
 * `shared/contracts.ts`，这三个常量在对方的 `web/` 里，所以照抄字面量。
 */
const SWITCH_THEME = "nbook.settings.switch-theme";
const SWITCH_APPEARANCE = "nbook.settings.switch-appearance";
const SWITCH_LOCALE = "nbook.settings.switch-locale";

type Step = 1 | 2 | 3 | 4;
type DesktopOption = "desktopShortcut" | "openAtLogin" | "tray";
type Appearance = "light" | "dark" | "system";

/** 向导里改了一项（组件 `FirstRunWizard` 的 `change` 事件）。 */
export type FirstRunChange =
    | {readonly key: "theme"; readonly value: string}
    | {readonly key: "appearance"; readonly value: Appearance}
    | {readonly key: "locale"; readonly value: string}
    | {readonly key: DesktopOption; readonly value: boolean};
export type RevealOutcome = "ok" | "missing" | "not-directory" | "not-accessible" | "no-desktop" | "open-failed" | "unavailable";

/** 状态行的文字：宿主按码取好（键在本插件的目录里）。 */
export type FirstRunMessage =
    | {readonly kind: "not-saved"; readonly item: "theme" | "appearance" | "locale" | DesktopOption; readonly cause: "unavailable" | "write-failed" | null}
    | {readonly kind: "unknown-outcome"; readonly item: DesktopOption}
    | {readonly kind: "reveal"; readonly code: Exclude<RevealOutcome, "ok" | "missing">};

export interface FirstRunOptions {
    readonly settings: SettingsService;
    readonly commands: Pick<CommandService, "execute">;
    readonly desktop: WindowDesktop;
    readonly store: FirstRunRecordStore;
    /** 已接受的主题与它们的缩略图，按显示顺序；名字已按当前语言取好（语言换了重新求值）。 */
    readonly themes: ComputedRef<ReadonlyArray<{readonly id: string; readonly name: string; readonly thumbnails: {readonly light: string; readonly dark: string} | null}>>;
    readonly locales: ReadonlyArray<{readonly value: string; readonly label: string}>;
    /** 系统此刻是不是暗色（跟随系统时缩略图取哪张）。 */
    readonly systemDark: Ref<boolean>;
    readonly library: () => Promise<string | null>;
    readonly revealLibrary: () => Promise<RevealOutcome>;
    readonly now: () => number;
    readonly report: (event: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

export interface FirstRun {
    /** 组件要的属性（`error` 是结构化的，组件外层按码取文字）。 */
    readonly view: ComputedRef<{
        readonly open: boolean;
        readonly step: Step;
        readonly themes: FirstRunOptions["themes"]["value"];
        readonly theme: string;
        readonly appearance: Appearance;
        readonly dark: boolean;
        readonly locales: FirstRunOptions["locales"];
        readonly locale: string;
        readonly options: Readonly<Record<DesktopOption, boolean>>;
        readonly shownOptions: ReadonlyArray<DesktopOption>;
        readonly places: {readonly stateRoot: string | null; readonly library: string | null};
        readonly libraryMissing: boolean;
        readonly message: FirstRunMessage | null;
    }>;
    /** 命令面板的“打开桌面版欢迎向导”：不看记录；已开着时什么也不做。 */
    show(): void;
    next(): void;
    back(): void;
    /** 跳过、Esc 与第四步的“开始写作”：关掉并写记录。 */
    close(): void;
    change(change: FirstRunChange): void;
    openPlace(place: "state-root" | "library"): void;
    dispose(): void;
}

export function createFirstRun(options: FirstRunOptions): FirstRun {
    const {settings, desktop, store} = options;
    const state = reactive({
        open: false,
        step: 1 as Step,
        /** 这一页里关过向导：之后记录写不成也不再自己打开（下次打开桌面版时再出现）。 */
        dismissed: false,
        pending: {} as Partial<Record<FirstRunChange["key"], string | boolean>>,
        message: null as FirstRunMessage | null,
        facts: desktop.facts() as InstallFacts | null,
        library: null as string | null,
        libraryMissing: false,
    });
    const stopFacts = desktop.onFacts((facts) => {
        state.facts = facts;
    });

    // 出现条件（输出 34 的表）：记录读到了、是“没有”，用户层配置可用（否则控件按缺省值显示），这一页还没关过。
    const seen = computed(() => store.state.seen);
    const shouldOpen = computed(() => {
        const field = seen.value;
        if (!desktop.available || state.dismissed || !field.ready || field.base?.status !== "missing") return false;
        return settings.inspect(desktopSettings.zoom).user.status === "ok";
    });
    const stopOpen = watch(shouldOpen, (open) => {
        if (!open || state.open) return;
        state.open = true;
        state.step = 1;
    }, {immediate: true});
    // 另一个窗口写了记录：这一页开着的向导随之关掉；坏记录、别的版本写的当作看过，记一条诊断。
    const stopSeen = watch(() => seen.value.base?.status, (status) => {
        if (status === "ok" && state.open && !state.dismissed) {
            state.open = false;
            state.dismissed = true;
        }
        if (status === "corrupt" || status === "unsupported-version") options.report("desktop.first-run.record-unreadable", `The first-run record is ${status}; treating it as seen`);
    }, {immediate: true});

    const appearance = computed(() => (state.pending.appearance as Appearance | undefined) ?? (settings.get(appearanceSetting) as Appearance));
    const view = computed(() => ({
        open: state.open,
        step: state.step,
        themes: options.themes.value,
        theme: (state.pending.theme as string | undefined) ?? String(settings.get(themeSetting)),
        appearance: appearance.value,
        dark: appearance.value === "dark" || (appearance.value === "system" && options.systemDark.value),
        locales: options.locales,
        locale: (state.pending.locale as string | undefined) ?? String(settings.get(localeSetting)),
        options: {
            desktopShortcut: (state.pending.desktopShortcut as boolean | undefined) ?? settings.get(desktopSettings.desktopShortcut),
            openAtLogin: (state.pending.openAtLogin as boolean | undefined) ?? settings.get(desktopSettings.openAtLogin),
            tray: (state.pending.tray as boolean | undefined) ?? settings.get(desktopSettings.closeLastWindow) === "tray",
        },
        // 桌面快捷方式与开机自启只对安装版、缺省状态根生效（输出 27、33）；安装事实还没到时只给关窗去向。
        shownOptions: state.facts?.installed === true && state.facts.defaultStateRoot ? ["desktopShortcut", "openAtLogin", "tray"] as const : ["tray"] as const,
        places: {stateRoot: state.facts?.stateRoot ?? null, library: state.library},
        libraryMissing: state.libraryMissing,
        message: state.message,
    }));

    /** 写一项：在途值先显示；写完（不论成败）丢掉在途值，配置服务的值就是结果。 */
    const write = async (change: FirstRunChange): Promise<void> => {
        state.pending[change.key] = change.value;
        state.message = null;
        let message: FirstRunMessage | null = null;
        try {
            if (change.key === "theme" || change.key === "appearance" || change.key === "locale") {
                const command = change.key === "theme" ? SWITCH_THEME : change.key === "appearance" ? SWITCH_APPEARANCE : SWITCH_LOCALE;
                const result = await options.commands.execute(command, {[change.key]: change.value});
                if (!result.ok) {
                    // 命令的失败码只分得出连不上；写入失败、结果未知都并成 execution-error，不另说原因。
                    message = {kind: "not-saved", item: change.key, cause: result.code === "unavailable" ? "unavailable" : null};
                    options.report("desktop.first-run.write-failed", `Switching ${change.key} failed: ${result.code}`, {reason: result.reason});
                }
            } else {
                const result = change.key === "tray"
                    ? await settings.update(desktopSettings.closeLastWindow, change.value ? "tray" : "quit", {layer: "user"})
                    : await settings.update(change.key === "desktopShortcut" ? desktopSettings.desktopShortcut : desktopSettings.openAtLogin, change.value, {layer: "user"});
                if (!result.ok) {
                    message = result.code === "unknown-outcome"
                        ? {kind: "unknown-outcome", item: change.key}
                        : {kind: "not-saved", item: change.key, cause: result.code === "unavailable" || result.code === "write-failed" ? result.code : null};
                    options.report("desktop.first-run.write-failed", `Writing ${change.key} failed: ${result.code}`, {detail: result.detail});
                }
            }
        } finally {
            // 只在没有更新的点选覆盖时清：快速连点两张卡片，后一次的在途值不该被前一次的结果抹掉。
            if (state.pending[change.key] === change.value) delete state.pending[change.key];
            if (message !== null) state.message = message;
        }
    };

    const loadLibrary = async (): Promise<void> => {
        const path = await options.library();
        if (path !== null) state.library = path;
    };

    return {
        view,
        show() {
            if (state.open) return;
            state.open = true;
            state.step = 1;
            state.message = null;
        },
        next() {
            if (state.step >= 4) return;
            state.step = (state.step + 1) as Step;
            state.message = null;
            if (state.step === 4) void loadLibrary();
        },
        back() {
            if (state.step <= 1) return;
            state.step = (state.step - 1) as Step;
            state.message = null;
        },
        close() {
            if (!state.open) return;
            state.open = false;
            state.dismissed = true;
            state.message = null;
            void store.actions.remember(new Date(options.now()).toISOString()).then((result) => {
                // 别的窗口先写了也算成功：commit 遇到冲突会在新快照上重放，结果仍是 saved。
                if (result !== "failed" && result !== "unknown") return;
                const save = store.state.seen.save;
                options.report("desktop.first-run.record-failed", `Writing the first-run record ended ${result}; the wizard shows again next time`, {code: "code" in save ? save.code : null});
            });
        },
        change(change) {
            void write(change);
        },
        openPlace(place) {
            state.message = null;
            if (place === "state-root") {
                desktop.openStateRoot();
                return;
            }
            void options.revealLibrary().then((outcome) => {
                state.libraryMissing = outcome === "missing";
                if (outcome !== "ok" && outcome !== "missing") state.message = {kind: "reveal", code: outcome};
            });
        },
        dispose() {
            stopFacts();
            stopOpen();
            stopSeen();
        },
    };
}
