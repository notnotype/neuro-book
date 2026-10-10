/**
 * 书架页的模型（docs/specs/workbench/bookshelf.md）：取数与刷新、选中、打开与继续写作、新建、修改信息、移出书架与加入已有
 * 目录。界面只呈现这里的状态、把动作交回来；对话框与确认由界面宿主（`BookshelfHost.vue`）负责，这里给出每个动作的结果
 * 与已按当前语言写好的失败原因。
 *
 * 刷新：页面可见时每 30 秒一次，窗口重新获得焦点时也刷新，两者合并成同一时间至多一个在途请求；页面隐藏时停止。
 * 新建、修改、移出之后强制刷新一次（在途的旧响应作废），界面不先行修改数据。
 */

import {computed, ref, shallowRef} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import {WORKBENCH_PATH} from "nbook/plugins/workbench/shared/home";
import type {QuickPick, QuickPickRequest} from "nbook/plugins/workbench/shared/contracts";
import type {WindowNavigation} from "nbook/shared/host";
import {localize} from "nbook/shared/localized-text";
import type {DisplayLocale, DisplayText, LocalizedText} from "nbook/shared/localized-text";
import type {SettingsService} from "nbook/shared/settings";

import {librarySetting, projectsRemoteContract} from "../shared/contracts";
import type {ShelfItem} from "../shared/shelf";
import {failureReason, fieldName, projectsText, registerFailureReason, shelfText} from "./messages";
import {projectUrl} from "./open-project";
import {sortShelf} from "./shelf-format";
import type {ShelfSort} from "./shelf-format";
import type {ShelfView} from "./shelf-preferences";

/** 页面可见时的刷新间隔。 */
export const SHELF_REFRESH_MS = 30_000;

export interface ShelfNotice {
    readonly kind: "refresh" | "popup" | "library" | "unknown-outcome";
    readonly text: string;
    /** 带“重试”按钮：重试就是再刷新一次。 */
    readonly retry: boolean;
}

export type ShelfActionOutcome = {readonly ok: true} | {readonly ok: false; readonly message: string};

export interface ProjectInfoValues {
    readonly title: string;
    readonly description: string;
    readonly color: string | null;
}

/** 新建作品放在哪：`remember` 为真表示这是用户刚选的作品目录，新建成功后写进设置。 */
export interface CreateTarget {
    readonly parent: string;
    readonly remember: boolean;
}

export interface ShelfPreferencesPort {
    readonly view: Readonly<Ref<ShelfView>>;
    readonly sort: Readonly<Ref<ShelfSort>>;
    setView(view: ShelfView): void;
    setSort(sort: ShelfSort): void;
}

export interface ShelfPageHost {
    readonly remote: RemoteClient<typeof projectsRemoteContract>;
    readonly clock: RuntimeClock;
    readonly locale: () => DisplayLocale;
    /** 视图与排序的偏好（产品里接 `shelfPreferencesStore`）。 */
    readonly preferences: ShelfPreferencesPort;
    readonly settings: SettingsService;
    readonly quickPick: QuickPick;
    readonly navigation: WindowNavigation;
    /** 记诊断：取数失败、设置写失败这类用户已经看到提示的事。 */
    readonly report: (event: string, message: string) => void;
}

export interface ShelfPage {
    readonly status: Readonly<Ref<"loading" | "ready" | "error">>;
    /** `status` 为 error 时的原因，已按当前语言写好。 */
    readonly error: Readonly<Ref<string>>;
    readonly items: Readonly<ShallowRef<ReadonlyArray<ShelfItem>>>;
    /** 最近一次取数的时刻（ISO）；相对时间按它算。 */
    readonly now: Readonly<Ref<string>>;
    readonly notice: Readonly<Ref<ShelfNotice | null>>;
    readonly activeId: Readonly<Ref<string | null>>;
    readonly view: ComputedRef<ShelfView>;
    readonly sort: ComputedRef<ShelfSort>;
    select(id: string | null): void;
    setView(view: ShelfView): void;
    setSort(sort: ShelfSort): void;
    /** 页面可见：立刻刷新并开始定时；不可见：停止定时。 */
    setVisible(visible: boolean): void;
    /** 窗口重新获得焦点。 */
    focused(): void;
    /** 再取一次；在途时合并进在途的那次。`force` 作废在途的响应、必定再发一次（写操作之后用）。 */
    refresh(force?: boolean): Promise<void>;
    dismissNotice(): void;
    open(id: string): void;
    openInNewWindow(id: string): void;
    continueWriting(id: string): void;
    enterWorkbench(): void;
    /** 新建前决定放在哪：设置里有作品目录就用它；没有就经命令面板的路径输入选一个，取消为 null。 */
    createTarget(): Promise<CreateTarget | null>;
    create(values: ProjectInfoValues, target: CreateTarget): Promise<ShelfActionOutcome>;
    update(id: string, values: ProjectInfoValues): Promise<ShelfActionOutcome>;
    /** 移出成功后选中相邻的一部。 */
    remove(id: string): Promise<ShelfActionOutcome>;
    /** 经命令面板的路径输入登记一个目录；登记失败时带着原因重新打开输入。 */
    addExisting(): Promise<void>;
    dispose(): void;
}

/** 继续写作的地址：编辑器插件读 `open` 与 `at`（docs/specs/workbench/editor.md 输出 29）。 */
export function continueUrl(name: string, address: string): string {
    return `/?${new URLSearchParams({project: name, open: address, at: "end"}).toString()}`;
}

export function createShelfPage(host: ShelfPageHost): ShelfPage {
    const status = ref<"loading" | "ready" | "error">("loading");
    const error = ref("");
    const items = shallowRef<ReadonlyArray<ShelfItem>>([]);
    const now = ref(new Date(host.clock.now()).toISOString());
    const notice = ref<ShelfNotice | null>(null);
    const activeId = ref<string | null>(null);
    const text = (value: LocalizedText | DisplayText): string => (typeof value === "string" ? value : localize(value, host.locale()));
    const reason = (code: string, detail?: unknown): string => text(failureReason(code, detail));

    /** 移出后要选中的那一部：移出前算好，刷新回来时用。 */
    let nextActive: string | null = null;
    let disposed = false;
    let visible = false;
    let sequence = 0;
    let inFlight: Promise<void> | null = null;
    let cancelTimer: (() => void) | null = null;

    const byId = (id: string): ShelfItem | null => items.value.find((item) => item.id === id) ?? null;

    function schedule(): void {
        cancelTimer?.();
        cancelTimer = null;
        if (!visible || disposed) return;
        cancelTimer = host.clock.schedule(() => void refresh(), SHELF_REFRESH_MS);
    }

    async function fetchOnce(id: number): Promise<void> {
        const result = await host.remote.shelf({});
        // 作废的响应（页面卸载、之后又强制刷新过）不改变任何状态。
        if (disposed || id !== sequence) return;
        now.value = new Date(host.clock.now()).toISOString();
        if (result.ok) {
            items.value = result.value;
            status.value = "ready";
            if (notice.value?.kind === "refresh") notice.value = null;
            if (activeId.value !== null && byId(activeId.value) === null) activeId.value = nextActive !== null && byId(nextActive) !== null ? nextActive : null;
            nextActive = null;
            return;
        }
        host.report("projects.shelf-failed", `取书架失败：${result.code}`);
        if (status.value === "ready") {
            notice.value = {kind: "refresh", text: text(shelfText("refreshFailed", {reason: reason(result.code, result.detail)})), retry: true};
            return;
        }
        status.value = "error";
        error.value = text(shelfText("shelfFailed", {reason: reason(result.code, result.detail)}));
    }

    function refresh(force = false): Promise<void> {
        if (disposed) return Promise.resolve();
        if (inFlight !== null && !force) return inFlight;
        sequence += 1;
        const id = sequence;
        const run = fetchOnce(id).finally(() => {
            if (inFlight === run) {
                inFlight = null;
                schedule();
            }
        });
        inFlight = run;
        cancelTimer?.();
        cancelTimer = null;
        return run;
    }

    function pathRequest(title: DisplayText, placeholder: DisplayText, label: (path: string) => DisplayText): QuickPickRequest {
        return {title, placeholder, items: [], text: {label}, empty: placeholder};
    }

    function navigateTo(id: string, url: (item: ShelfItem) => string): void {
        const item = byId(id);
        if (item !== null) host.navigation.navigateDocument(url(item));
    }

    /** 相邻的一部：按当前排序取下一部，没有时上一部。 */
    function neighbourOf(id: string): string | null {
        const sorted = sortShelf(items.value, sort.value, host.locale());
        const index = sorted.findIndex((item) => item.id === id);
        if (index === -1) return null;
        return (sorted[index + 1] ?? sorted[index - 1])?.id ?? null;
    }

    const view = computed(() => host.preferences.view.value);
    const sort = computed(() => host.preferences.sort.value);

    return {
        status,
        error,
        items,
        now,
        notice,
        activeId,
        view,
        sort,
        select: (id) => {
            activeId.value = id;
        },
        setView: (next) => host.preferences.setView(next),
        setSort: (next) => host.preferences.setSort(next),
        setVisible: (next) => {
            visible = next;
            if (next) void refresh();
            else schedule();
        },
        focused: () => {
            if (visible) void refresh();
        },
        refresh,
        dismissNotice: () => {
            notice.value = null;
        },
        open: (id) => navigateTo(id, (item) => projectUrl(item.name)),
        openInNewWindow: (id) => {
            const item = byId(id);
            if (item === null) return;
            if (host.navigation.openExternal(projectUrl(item.name)) === "blocked") notice.value = {kind: "popup", text: text(shelfText("popupBlocked")), retry: false};
        },
        continueWriting: (id) => navigateTo(id, (item) => (item.stats.last === null ? projectUrl(item.name) : continueUrl(item.name, item.stats.last.address))),
        enterWorkbench: () => host.navigation.navigateDocument(WORKBENCH_PATH),
        createTarget: async () => {
            const library = host.settings.get(librarySetting);
            if (library !== "") return {parent: library, remember: false};
            const picked = await host.quickPick.pick(pathRequest(shelfText("libraryTitle"), shelfText("libraryPlaceholder"), (path) => shelfText("libraryUse", {path})));
            return picked.kind === "text" ? {parent: picked.text, remember: true} : null;
        },
        create: async (values, target) => {
            const result = await host.remote.create({title: values.title, ...(values.description === "" ? {} : {description: values.description}), parent: target.parent});
            if (result.ok) {
                nextActive = result.value.id;
                activeId.value = result.value.id;
                if (target.remember) {
                    const written = await host.settings.update(librarySetting, target.parent);
                    if (!written.ok) {
                        host.report("projects.library-not-saved", `作品目录没有写进设置：${written.code}：${written.detail}`);
                        notice.value = {kind: "library", text: text(shelfText("libraryNotSaved", {reason: `${written.code}：${written.detail}`})), retry: false};
                    }
                }
                await refresh(true);
                return {ok: true};
            }
            const detail = result.detail as {readonly field?: string; readonly reason?: string; readonly detail?: string; readonly path?: string} | undefined;
            switch (result.code) {
                case "invalid-metadata":
                    return {ok: false, message: text(shelfText("createInvalid", {field: text(fieldName(detail?.field ?? "")), reason: detail?.detail ?? ""}))};
                case "no-library":
                    return {ok: false, message: text(shelfText("createNoLibrary"))};
                case "invalid-parent":
                    return {ok: false, message: text(shelfText("createInvalidParent", {reason: text(registerFailureReason(detail?.reason ?? ""))}))};
                case "exists":
                    return {ok: false, message: text(shelfText("createExists", {path: detail?.path ?? ""}))};
                case "write-failed":
                    return {ok: false, message: text(shelfText("createWriteFailed", {reason: detail?.detail ?? ""}))};
                case "register-failed":
                    return {ok: false, message: text(shelfText("createRegisterFailed", {path: detail?.path ?? "", reason: text(registerFailureReason(detail?.reason ?? ""))}))};
                case "unknown-outcome": {
                    // 新建是写操作，结果未知时不盲目重试：重新取书架，书名在上面就算成功。
                    await refresh(true);
                    const created = items.value.find((item) => item.title === values.title);
                    if (created !== undefined) {
                        activeId.value = created.id;
                        return {ok: true};
                    }
                    return {ok: false, message: text(shelfText("createUnknown"))};
                }
                default:
                    return {ok: false, message: reason(result.code, result.detail)};
            }
        },
        update: async (id, values) => {
            const result = await host.remote.update({id, title: values.title, description: values.description === "" ? null : values.description, color: values.color});
            if (result.ok) {
                await refresh(true);
                return {ok: true};
            }
            if (result.code === "invalid-metadata") {
                const detail = result.detail as {readonly field: string; readonly detail: string};
                return {ok: false, message: text(shelfText("createInvalid", {field: text(fieldName(detail.field)), reason: detail.detail}))};
            }
            return {ok: false, message: text(shelfText("updateFailed", {reason: reason(result.code, result.detail)}))};
        },
        remove: async (id) => {
            const neighbour = neighbourOf(id);
            const result = await host.remote.unregister({id});
            if (result.ok) {
                nextActive = neighbour;
                await refresh(true);
                return {ok: true};
            }
            if (result.code === "project-running") return {ok: false, message: text(shelfText("removeRunning"))};
            if (result.code === "unknown-outcome") {
                await refresh(true);
                return byId(id) === null ? {ok: true} : {ok: false, message: text(shelfText("removeFailed", {reason: reason(result.code)}))};
            }
            return {ok: false, message: text(shelfText("removeFailed", {reason: reason(result.code, result.detail)}))};
        },
        addExisting: async () => {
            let title: DisplayText = shelfText("addTitle");
            for (;;) {
                const picked = await host.quickPick.pick(pathRequest(title, shelfText("addPlaceholder"), (path) => shelfText("addLabel", {path})));
                if (picked.kind !== "text") return;
                const registered = await host.remote.register({path: picked.text});
                if (registered.ok) {
                    nextActive = registered.value.id;
                    activeId.value = registered.value.id;
                    await refresh(true);
                    return;
                }
                if (registered.code !== "register-failed") {
                    // 登记按目录幂等，结果未知时重新取书架即可；别的路由层失败也只提示。
                    await refresh(true);
                    notice.value = {kind: "unknown-outcome", text: text(projectsText("notCompleted", {code: registered.code})), retry: false};
                    return;
                }
                const failure = registered.detail as {readonly reason: string; readonly detail: string};
                host.report("projects.register-failed", `登记失败：${failure.reason}：${failure.detail}`);
                title = addRetryTitle(failure.reason);
            }
        },
        dispose: () => {
            disposed = true;
            visible = false;
            cancelTimer?.();
            cancelTimer = null;
        },
    };
}

function addRetryTitle(code: string): LocalizedText {
    const why = registerFailureReason(code);
    return {
        "zh-CN": localize(shelfText("addRetryTitle", {reason: why["zh-CN"]}), "zh-CN"),
        "en-US": localize(shelfText("addRetryTitle", {reason: why["en-US"]}), "en-US"),
    };
}
