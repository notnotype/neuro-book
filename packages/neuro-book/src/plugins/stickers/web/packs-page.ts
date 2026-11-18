/**
 * 表情包页的取数与写入（docs/specs/agent/stickers.md 输出 25 到 38）：订阅目录变化、取概要与选中包的详情（晚到的旧结果丢掉）、
 * 选中、上传队列、各种写入。页面组件只画与发出动作，这里把动作变成远程调用或 HTTP 请求，把失败码变成文字与通知。
 *
 * 选中：页面自己新建、改包名、复制、导入之后选中结果那个包（服务端交回时目录里已有它）；只有选中的包被别处删掉时回到第一项。
 * 写入按包排队：同一个包的几次提交按到达顺序做，写完重取概要与详情再交回，页面据此知道“新值已经到了”。
 * 失败：交回原因给还在屏幕上的字段与对话框，同时发一条通知——字段所在的组件可能已经被换掉（点了别的格子、切了包），
 * 通知是用户一定看得到的那条通道。
 */

import {computed, ref, shallowRef} from "vue";
import type {ComputedRef, Ref, ShallowRef} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import type {BoundText} from "nbook/shared/use-plugin-text";

import type zhCN from "../locales/zh-CN.json";
import type {stickersCatalogContract, StickerPackDetail, StickerPackSummary} from "../shared/contracts";
import {firstPackId, folderOf, railGroups} from "./pack-view";
import {UploadQueue} from "./upload-queue";
import type {UploadItem, UploadOutcome, UploadResponse} from "./upload-queue";

export type StickersRemote = Pick<RemoteClient<typeof stickersCatalogContract>, "packs" | "pack" | "revealPack" | "createPack" | "updatePack" | "renamePack" | "deletePack" | "updateSticker" | "deleteSticker" | "listFiles" | "deleteFile" | "copyPack" | "events">;

/** 导入遇到同名时服务端交回的信息（`ImportConflict` 的 JSON）。 */
export interface ImportConflictInfo {
    readonly existing: {readonly id: string; readonly title: string; readonly count: number; readonly files: readonly string[]; readonly token: string | null};
    readonly copyAs: string | null;
}

export type ImportChoice = {readonly mode: "copy"} | {readonly mode: "replace"; readonly token: string};
export type ImportResponse = {readonly ok: true; readonly id: string} | {readonly ok: false; readonly code: "import-conflict"; readonly conflict: ImportConflictInfo} | {readonly ok: false; readonly code: string; readonly reason?: string};

/** 三条 HTTP 路由（`stickers/backend/routes.ts`）；导出由实现触发浏览器下载。 */
export interface StickersHttp {
    upload(packId: string, file: File): Promise<UploadResponse>;
    importZip(file: File, choice?: ImportChoice): Promise<ImportResponse>;
    exportPack(packId: string): Promise<{readonly ok: true} | {readonly ok: false; readonly code: string}>;
}

export interface PacksModelDeps {
    readonly remote: StickersRemote;
    readonly http: StickersHttp;
    readonly t: BoundText<typeof zhCN>;
    readonly notify: (input: NotificationInput) => void;
    /** 选了这个包的 Profile 的显示名；不知道（Agent 入口没起来、查不到）为 null。可选。 */
    readonly allowlistUsage?: (packId: string) => Promise<readonly string[] | null>;
    readonly report: (code: string, message: string) => void;
    readonly uploadLimit?: number;
}

export type PageState = "loading" | "ready" | {readonly failed: string};
export type Failure = {readonly reason: string};

/** 页面写入的字段改动（显示名、说明）。 */
export interface PackChange {
    readonly title?: string | null;
    readonly description?: string | null;
}

/** 一个表情的定位与改动（同远程合同）。 */
export interface StickerTarget {
    readonly file: string;
    readonly name: string | null;
}
export interface StickerEdit {
    readonly name?: string | null;
    readonly description?: string | null;
    readonly common?: boolean;
}

const KNOWN = [
    "not-user-pack", "pack-missing", "pack-exists", "pack-changed", "folder-invalid", "name-invalid", "name-duplicate", "description-invalid", "title-invalid", "sticker-missing", "manifest-full",
    "too-large", "permission-denied", "write-failed", "refresh-failed", "busy", "request-aborted", "image-rejected", "import-invalid", "import-conflict", "export-too-large", "export-empty",
    "export-conflict", "pack-invalid", "timeout", "cross-site", "file-unreadable",
] as const;
type KnownCode = (typeof KNOWN)[number];
const REJECTS = ["folder", "file-invalid", "type-mismatch", "unreadable", "too-many-pixels", "gif-too-large", "animated-too-large", "still-too-large"] as const;
type RejectCode = (typeof REJECTS)[number];
const isKnown = (code: string): code is KnownCode => (KNOWN as readonly string[]).includes(code);
const isReject = (code: string): code is RejectCode => (REJECTS as readonly string[]).includes(code);

export interface PacksModel {
    readonly state: Readonly<Ref<PageState>>;
    readonly packs: ShallowRef<readonly StickerPackSummary[]>;
    readonly selected: Readonly<Ref<string | null>>;
    /** 选中包的详情；没取到或与选中不一致时为 null。 */
    readonly detail: ComputedRef<StickerPackDetail | null>;
    readonly uploads: ShallowRef<readonly UploadItem[]>;
    start(): () => void;
    retry(): void;
    select(id: string | null): void;
    createPack(folder: string, title: string): Promise<{readonly id: string} | Failure>;
    /** `token` 是打开改名对话框那一刻页面手里的文件夹令牌：之后文件夹被别处换掉了就不改（null 当作令牌已失效）。 */
    renamePack(id: string, folder: string, token: string | null): Promise<{readonly id: string} | Failure>;
    copyPack(id: string): Promise<{readonly id: string} | Failure>;
    importZip(file: File, choice?: ImportChoice): Promise<{readonly id: string} | {readonly conflict: ImportConflictInfo} | Failure>;
    updatePack(id: string, change: PackChange): Promise<Failure | null>;
    updateSticker(id: string, target: StickerTarget, change: StickerEdit): Promise<Failure | null>;
    /** `token` 是打开确认框那一刻的文件夹令牌，同改包名。 */
    deletePack(id: string, token: string | null): Promise<Failure | null>;
    deleteSticker(id: string, target: StickerTarget): Promise<Failure | null>;
    deleteFile(id: string, file: string): Promise<Failure | null>;
    listFiles(id: string, files: readonly string[] | "all"): Promise<Failure | null>;
    /** `folders` 是拖进来的文件夹名（不传输，汇总里写出）。 */
    addImages(id: string, files: readonly File[], folders?: readonly string[]): Promise<void>;
    exportPack(id: string): Promise<void>;
    revealPack(id: string): Promise<void>;
    allowlistUsage(id: string): Promise<readonly string[] | null>;
}

export function createPacksModel(deps: PacksModelDeps): PacksModel {
    const {t, remote} = deps;
    const state = ref<PageState>("loading");
    const packs = shallowRef<readonly StickerPackSummary[]>([]);
    const selected = ref<string | null>(null);
    const loaded = shallowRef<StickerPackDetail | null>(null);
    const uploads = shallowRef<readonly UploadItem[]>([]);
    const detail = computed(() => (loaded.value !== null && loaded.value.summary.id === selected.value ? loaded.value : null));
    let packsSeq = 0;
    let detailSeq = 0;
    let stopped = false;
    const queue = new UploadQueue({limit: deps.uploadLimit ?? 3, send: (id, file) => deps.http.upload(id, file), onChange: (items) => {
        uploads.value = items;
    }});

    /** 失败码与细节变成一句话。 */
    function reasonOf(code: string, detail?: string): string {
        const reason = detail === undefined ? "" : isReject(detail) ? t(`reject.${detail}`) : detail;
        // 写入没成功时服务端的原因里有“做了一部分”之类的具体说明，直接给用户。
        if (code === "write-failed" && reason !== "") return t("error.write-failed-detail", {reason});
        return t(`error.${isKnown(code) ? code : "unavailable"}`, {reason});
    }

    /** 写入失败：同时发一条通知（见文件头）。 */
    function failed(result: {readonly ok: false; readonly code: string; readonly detail?: unknown}): Failure {
        const outcome = failure(result);
        if (result.code !== "unknown-outcome") deps.notify({tone: "warning", title: t("notify.title"), message: t("notify.failed", {reason: outcome.reason})});
        return outcome;
    }

    /** 远程调用的失败：结果不知道的（断开在写之后）重新读一次，其余按业务码。 */
    function failure(result: {readonly ok: false; readonly code: string; readonly detail?: unknown}): Failure {
        if (result.code === "unknown-outcome") {
            deps.notify({tone: "warning", title: t("notify.title"), message: t("notify.unknownOutcome")});
            void refreshAll();
            return {reason: t("notify.unknownOutcome")};
        }
        const detailText = typeof result.detail === "object" && result.detail !== null && "detail" in result.detail && typeof result.detail.detail === "string" ? result.detail.detail : undefined;
        return {reason: reasonOf(result.code, ["image-rejected", "import-invalid", "write-failed"].includes(result.code) ? detailText : undefined)};
    }

    async function loadPacks(): Promise<boolean> {
        const seq = (packsSeq += 1);
        const result = await remote.packs({});
        if (stopped || seq !== packsSeq) return true;
        if (!result.ok) {
            // 已经显示出来的，重取失败不换成失败页。
            if (state.value === "loading") state.value = {failed: String(result.code)};
            else deps.report("packs-reload-failed", String(result.code));
            return false;
        }
        packs.value = result.value;
        state.value = "ready";
        const current = selected.value;
        if (current === null || !result.value.some((pack) => pack.id === current)) {
            const next = firstPackId(railGroups(result.value));
            if (next !== current) select(next);
        }
        return true;
    }

    async function loadDetail(id: string): Promise<void> {
        const seq = (detailSeq += 1);
        const result = await remote.pack({id});
        if (stopped || seq !== detailSeq || selected.value !== id) return;
        if (result.ok) loaded.value = result.value;
        else if (result.code === "pack-missing") void loadPacks();
        else deps.report("pack-load-failed", String(result.code));
    }

    function select(id: string | null): void {
        if (selected.value === id) return;
        selected.value = id;
        loaded.value = null;
        if (id !== null) void loadDetail(id);
    }

    /** 写完之后重取概要与详情，交回时页面上已是写完的样子。 */
    async function refreshAll(): Promise<void> {
        await loadPacks();
        const id = selected.value;
        if (id !== null) await loadDetail(id);
    }

    /** 同一个包的写入按到达顺序做。 */
    const tails = new Map<string, Promise<unknown>>();
    function serial<T>(id: string, work: () => Promise<T>): Promise<T> {
        const run = (tails.get(id) ?? Promise.resolve()).then(work, work);
        tails.set(id, run.catch(() => undefined));
        return run;
    }

    /** 做一次写入：成功重取后交回 null，失败交回原因。 */
    async function mutate(id: string, call: () => Promise<{readonly ok: true} | {readonly ok: false; readonly code: string; readonly detail?: unknown}>): Promise<Failure | null> {
        return serial(id, async () => {
            const result = await call();
            if (!result.ok) {
                // 别处改过：页面按现在的目录显示。
                if (result.code === "pack-changed" || result.code === "refresh-failed") await refreshAll();
                return failed(result);
            }
            await refreshAll();
            return null;
        });
    }

    /** 新建、改名、复制、导入之后：重取概要，选中结果那个包。 */
    async function created(id: string): Promise<{readonly id: string}> {
        await loadPacks();
        select(id);
        await loadDetail(id);
        return {id};
    }

    const model: PacksModel = {
        state,
        packs,
        selected,
        detail,
        uploads,
        start() {
            stopped = false;
            let release: (() => void) | null = null;
            // 先订阅再取：取回之前发生的变化一定有事件跟着，不会停在旧列表上（订阅失败照旧上报，仍取一次）。
            void (async () => {
                const subscription = await remote.events.changed.subscribe({}, () => void refreshAll(), {onResync: () => void refreshAll()});
                if (!subscription.ok) deps.report("changed-subscribe-failed", String(subscription.code));
                else if (stopped) subscription.value.release();
                else release = () => subscription.value.release();
            })().catch((error: unknown) => deps.report("changed-subscribe-failed", String(error))).finally(() => void loadPacks());
            return () => {
                stopped = true;
                release?.();
                queue.cancelPending();
            };
        },
        retry() {
            state.value = "loading";
            void refreshAll();
        },
        select,
        async createPack(folder, title) {
            const result = await remote.createPack({folder, title: title.trim() === "" ? null : title});
            return result.ok ? created(result.value.id) : failure(result);
        },
        async renamePack(id, folder, token) {
            if (token === null) return failed({ok: false, code: "pack-changed"});
            const result = await serial(id, () => remote.renamePack({id, folder, token}));
            if (!result.ok) {
                if (result.code === "pack-changed") await refreshAll();
                return failed(result);
            }
            return created(result.value.id);
        },
        async copyPack(id) {
            const result = await remote.copyPack({id});
            return result.ok ? created(result.value.id) : failed(result);
        },
        async importZip(file, choice) {
            const result = await deps.http.importZip(file, choice);
            if (result.ok) {
                deps.notify({tone: "success", title: t("notify.title"), message: t("notify.imported", {name: folderOf(result.id)})});
                return created(result.id);
            }
            if (result.code === "import-conflict" && "conflict" in result) return {conflict: result.conflict};
            if (result.code === "pack-changed") await refreshAll();
            const reason = reasonOf(result.code, "reason" in result ? result.reason : undefined);
            // 第一次选的 zip 就失败时页面没有别的地方显示；选了冲突的处理方式之后失败写在对话框里。
            if (choice === undefined) deps.notify({tone: "warning", title: t("notify.title"), message: t("notify.failed", {reason})});
            return {reason};
        },
        updatePack: (id, change) => mutate(id, () => remote.updatePack({id, ...change})),
        updateSticker: (id, target, change) => mutate(id, () => remote.updateSticker({id, ...target, change})),
        async deletePack(id, token) {
            if (token === null) return failed({ok: false, code: "pack-changed"});
            return mutate(id, () => remote.deletePack({id, token}));
        },
        deleteSticker: (id, target) => mutate(id, () => remote.deleteSticker({id, ...target})),
        deleteFile: (id, file) => mutate(id, () => remote.deleteFile({id, file})),
        listFiles: (id, files) => mutate(id, () => remote.listFiles({id, files: files === "all" ? "all" : [...files]})),
        async addImages(id, files, folders) {
            const outcomes = await queue.add(id, files, folders);
            summarize(outcomes);
            await refreshAll();
        },
        async exportPack(id) {
            const result = await deps.http.exportPack(id);
            if (!result.ok) deps.notify({tone: "warning", title: t("notify.title"), message: t("notify.exportFailed", {reason: reasonOf(result.code)})});
        },
        async revealPack(id) {
            const result = await remote.revealPack({id});
            if (result.ok) return;
            const detailOf = (typeof result.detail === "object" && result.detail !== null ? result.detail : {}) as {path?: string; detail?: string};
            if (result.code === "no-desktop") deps.notify({tone: "warning", title: t("notify.title"), message: t("notify.revealNoDesktop", {path: detailOf.path ?? ""})});
            else if (result.code === "open-failed") deps.notify({tone: "warning", title: t("notify.title"), message: t("notify.revealFailed", {path: detailOf.path ?? ""}), ...(detailOf.detail === undefined ? {} : {detail: detailOf.detail})});
            else deps.notify({tone: "warning", title: t("notify.title"), message: failure(result).reason});
        },
        async allowlistUsage(id) {
            return deps.allowlistUsage === undefined ? null : deps.allowlistUsage(id).catch(() => null);
        },
    };

    /** 一次添加做完后汇总：没加进去的写文件名与原因，缩小过的写个数。 */
    function summarize(outcomes: readonly UploadOutcome[]): void {
        // 页面关掉时丢掉的不是失败。
        const rejected = outcomes.filter((outcome): outcome is UploadOutcome & {readonly ok: false} => !outcome.ok && outcome.code !== "cancelled");
        const resized = outcomes.filter((outcome) => outcome.ok && outcome.resized).length;
        if (rejected.length > 0) {
            const list = rejected.map((outcome) => t("notify.uploadedItem", {name: outcome.name, reason: outcome.code === "image-rejected" && outcome.reason !== undefined && isReject(outcome.reason) ? t(`reject.${outcome.reason}`) : reasonOf(outcome.code)})).join(t("notify.separator"));
            deps.notify({tone: "warning", title: t("notify.title"), message: t("notify.uploaded", {list})});
        }
        if (resized > 0) deps.notify({tone: "info", title: t("notify.title"), message: t("notify.resized", {count: String(resized)})});
    }

    return model;
}
