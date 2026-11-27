<script setup lang="ts">
/**
 * 设置窗口的插件页（同名 .md）：列出第三方与内置插件，从服务端上的文件夹安装（先预览），启用、禁用与卸载；全部在下一次
 * 启动生效（docs/specs/runtime/plugin-install.md 输出 1–4、7–9）。
 */
import type {RemoteFailureCode} from "@notnotype/nb-runtime/remote";
import {Badge, Button, Dialog, Input, Spinner, Switch} from "@notnotype/nb-ui/components";
import {useText} from "@notnotype/nb-ui/text-port";
import {computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef} from "vue";

import type {DisplayLocale} from "nbook/shared/localized-text";
import {UPLOAD_LIMITS} from "nbook/plugin-platform/shared/plugin-upload";
import {collectFolder, collectInputFiles, dragHasFiles, readDrop} from "nbook/ui/dropped-folder";
import type {CollectProblem, CollectResult, DroppedItem} from "nbook/ui/dropped-folder";

import {compareVersions} from "nbook/plugin-platform/shared/versions";
import type {WindowPlugins} from "nbook/shared/host";
import {codeText, isRemoteFailureCode, remoteFailureText} from "nbook/web/failure-text";

import type {BlockedPlugin, InstallPreview, PendingChange, PluginFailureCode, PluginListEntry, PluginListItem, PluginProblem, PluginsRegistry} from "../../shared/contracts";
import {pluginsText, usePluginsText} from "../text";
import type {PluginsTextKey} from "../text";
import {builtinPluginTextKey} from "../../shared/builtin-names";
import {COLLECT_OPTIONS, pathCollision, pluginFolderProblem} from "../folder-upload";
import type {FolderUploadClient, UploadFailureCode} from "../folder-upload";

defineOptions({name: "PluginsPage"});

const props = defineProps<{
    registry: PluginsRegistry;
    /** 只用来按语言连接列表（`Intl.ListFormat`）；文字经注入的翻译端口取，由宿主从同一个语言来源传。 */
    locale: DisplayLocale;
    /** 本窗口的插件问题与变化通知；拿不到时（Lab、测试）只显示服务端给的问题。 */
    windowPlugins?: Pick<WindowPlugins, "problems" | "onChange"> | null;
    /** 上传文件夹的客户端（拖入与“选择文件夹”）；不给时页面没有这两个入口，只能输入服务端上的路径。 */
    folderUpload?: FolderUploadClient | null;
}>();

/** 预览关系对应的确认框标题与确认按钮。 */
const PREVIEW_KEYS: Readonly<Record<InstallPreview["relation"], {readonly title: PluginsTextKey; readonly confirm: PluginsTextKey}>> = {
    install: {title: "preview.install.title", confirm: "preview.install.confirm"},
    upgrade: {title: "preview.upgrade.title", confirm: "preview.upgrade.confirm"},
    downgrade: {title: "preview.downgrade.title", confirm: "preview.downgrade.confirm"},
};

const PENDING_KEYS: Readonly<Record<PendingChange["kind"], PluginsTextKey>> = {
    install: "row.pending.install",
    uninstall: "row.pending.uninstall",
    enable: "row.pending.enable",
    disable: "row.pending.disable",
    upgrade: "row.pending.upgrade",
};

type NotLoadedCode = NonNullable<PluginListItem["notLoaded"]>["code"];

const NOT_LOADED: Record<NotLoadedCode, {readonly text: PluginsTextKey; readonly tone: "danger" | "neutral"; readonly showDetail: boolean}> = {
    "manifest-invalid": {text: "row.notLoaded.manifest-invalid", tone: "danger", showDetail: true},
    "entry-missing": {text: "row.notLoaded.entry-missing", tone: "danger", showDetail: true},
    "unreadable": {text: "row.notLoaded.unreadable", tone: "danger", showDetail: true},
    "incompatible-engine": {text: "row.notLoaded.incompatible-engine", tone: "danger", showDetail: true},
    "safe-mode": {text: "row.notLoaded.safe-mode", tone: "neutral", showDetail: false},
};

type FailureCode = PluginFailureCode | RemoteFailureCode;

/**
 * 业务失败码（plugin-install 的失败码表）都有文字，键是 `errors.<码>`；路由层失败码用宿主的文案，不认识的码用宿主的
 * 未知码文案（docs/specs/ui/i18n.md 输出 13）。路由层的码文字已经说全，服务端详情是诊断原文，不列；不认识的码列出详情，
 * 那是唯一能说明发生了什么的信息。
 */
const FAILURE_KEYS: Readonly<Record<PluginFailureCode, PluginsTextKey>> = {
    "manifest-invalid": "errors.manifest-invalid",
    "catalog-invalid": "errors.catalog-invalid",
    "incompatible-engine": "errors.incompatible-engine",
    "already-installed": "errors.already-installed",
    "uninstall-pending": "errors.uninstall-pending",
    "path-rejected": "errors.path-rejected",
    "entry-missing": "errors.entry-missing",
    "copy-failed": "errors.copy-failed",
    "not-installed": "errors.not-installed",
    "builtin-fixed": "errors.builtin-fixed",
    "registry-failed": "errors.registry-failed",
};

/** 服务端详情能补充信息的码；其余的码固定文字已经说全，详情只会重复。 */
const DETAIL_CODES: ReadonlySet<PluginFailureCode> = new Set<PluginFailureCode>(["manifest-invalid", "catalog-invalid", "path-rejected", "copy-failed", "entry-missing", "registry-failed", "incompatible-engine"]);
/** 失败后列表可能已过时的码：写出原因之后重新读列表。 */
const STALE_CODES: ReadonlySet<FailureCode> = new Set<FailureCode>(["unknown-outcome", "not-installed", "uninstall-pending", "already-installed"]);

type Failure = {readonly ok: false; readonly code: FailureCode; readonly detail?: unknown};
type Problem = {readonly serial: number; readonly code: string; readonly reason: string; readonly lines: ReadonlyArray<string>};

/** 本插件目录里的一段文字，按窗口的当前语言。 */
const text = usePluginsText();
/** 宿主目录里的文字（路由失败码、未知码）。 */
const port = useText();
/** 显示名与说明：第三方插件取清单里的；内置插件清单里没有，取窗口这侧的名称表（builtin-names.ts）。 */
const builtinText = (item: PluginListEntry, field: "name" | "description"): string | null => {
    const key = item.source === "builtin" ? builtinPluginTextKey(item.id, field) : null;
    return key === null ? null : text(key);
};
const displayNameOf = (item: PluginListEntry): string | null => item.displayName ?? builtinText(item, "name");
const descriptionOf = (item: PluginListEntry): string | null => item.description ?? builtinText(item, "description");
/** 列表按界面语言连接（“a、b和c”“a, b, and c”）。 */
const list = (items: ReadonlyArray<string>): string => new Intl.ListFormat(props.locale, {type: "conjunction"}).format(items);
const BLOCKED_KEYS: Readonly<Record<BlockedPlugin["reason"], PluginsTextKey>> = {
    "version-mismatch": "preview.blockedReasons.version-mismatch",
    "missing-service": "preview.blockedReasons.missing-service",
    "dependency-cycle": "preview.blockedReasons.dependency-cycle",
    "provider-blocked": "preview.blockedReasons.provider-blocked",
};
/** 升级确认框里一条受阻的插件：版本不符时写出它要求的范围。 */
const blockedLine = (item: BlockedPlugin): string => text(BLOCKED_KEYS[item.reason], {plugin: item.plugin, entries: list(item.entries), range: item.range ?? "", service: item.service ?? ""});

const state = ref<"loading" | "failed" | "ready">("loading");
const loadFailure = ref<string>("");
const items = ref<ReadonlyArray<PluginListEntry>>([]);
const safeMode = ref(false);
/** 进行中的写操作：`preview`、`install`、`toggle:<id>`、`uninstall:<id>`；没有为 null。 */
const busy = ref<string | null>(null);
const problem = ref<Problem | null>(null);
let serial = 0;
const path = ref("");
const pathInput = ref<{$el?: Element} | null>(null);
const problemRegion = ref<HTMLElement | null>(null);
const retryButton = ref<{$el?: Element} | null>(null);
// 对话框的开合与内容分开：关闭时内容留到下一次打开再换，淡出动画里不会先变成空壳。
const previewOpen = ref(false);
const preview = ref<InstallPreview | null>(null);
/** 预览的来源：服务端上的路径，或上传的文件夹（上传时记下页面上传的 id，取消预览时删它）。 */
type Source = {readonly kind: "path"; readonly path: string} | {readonly kind: "upload"; readonly id: string; readonly name: string; readonly files: number; readonly bytes: number};
const previewSource = ref<Source>({kind: "path", path: ""});
/** 上传进度（百分比）；没有在上传为 null。 */
const uploadPercent = ref<number | null>(null);
/** 拖着文件经过插件页：显示“松开以安装”的覆盖层。 */
const dragging = ref(false);
const pageRoot = ref<HTMLElement | null>(null);
const folderInput = shallowRef<HTMLInputElement | null>(null);
/** 页面上传了、还没交给安装的那个上传的 id；页面离开或取消时删它。已发出安装请求就不再记，由服务端在安装结束时删。 */
let heldUpload: string | null = null;
let uploadAbort: AbortController | null = null;
/** 页面已卸载：收集或上传在途时用户离开了，之后收尾的步骤不再往页面里写，已经上传的删掉。 */
let disposed = false;
const uninstallOpen = ref(false);
const uninstalling = ref<PluginListItem | null>(null);
/** 打开对话框的控件不在了时焦点的落点（第三方插件的小标题）；函数 ref 记下。 */
let thirdPartyTitle: HTMLElement | null = null;
function rememberTitle(key: string, element: unknown): void {
    if (key === "third-party") thirdPartyTitle = element instanceof HTMLElement ? element : null;
}

const MIB = 1024 * 1024;
const mib = (bytes: number): string => `${String(bytes / MIB)} MiB`;
const sizeText = (bytes: number): string => (bytes < MIB ? `${String(Math.max(1, Math.round(bytes / 1024)))} KiB` : `${(bytes / MIB).toFixed(1)} MiB`);
/** 预览里“从哪来”一行：路径原样，上传的写文件夹名、文件数与大小。 */
const previewSourceText = computed(() => (previewSource.value.kind === "path" ? previewSource.value.path : text("upload.source", {name: previewSource.value.name, files: previewSource.value.files, size: sizeText(previewSource.value.bytes)})));

const hasPending = computed(() => items.value.some((item) => item.pending.length > 0));

/** 本窗口的问题：变化通知到来时重读（通知不精确，读方重新查询）。 */
const windowProblems = shallowRef<ReadonlyArray<PluginProblem>>(props.windowPlugins?.problems() ?? []);
const stopWindow = props.windowPlugins?.onChange(() => {
    windowProblems.value = props.windowPlugins?.problems() ?? [];
});
onBeforeUnmount(() => stopWindow?.());

const problemKey = (problem: PluginProblem): string => [problem.kind, problem.kind === "catalog-unavailable" ? problem.locale : (problem.entry ?? ""), problem.location, problem.kind === "contribution-rejected" ? `${problem.capability} ${problem.id}` : ""].join("|");

/** 一个插件的问题：服务端的加上本窗口的。顶层声明在每个实例里都登记，被拒时两边各有一条，按贡献合成一条。 */
function problemsOf(item: PluginListEntry): ReadonlyArray<PluginProblem> {
    const merged = new Map<string, PluginProblem>();
    for (const problem of [...item.problems, ...windowProblems.value.filter((candidate) => candidate.plugin === item.id)]) {
        const key = problem.kind === "contribution-rejected" && problem.entry === null ? `top|${problem.capability} ${problem.id}` : problemKey(problem);
        if (!merged.has(key)) merged.set(key, problem);
    }
    return [...merged.values()];
}

const hasProblems = computed(() => items.value.some((item) => problemsOf(item).length > 0));
const entryProblemCount = (item: PluginListEntry): number => problemsOf(item).filter((problem) => problem.kind === "entry-failed" || problem.kind === "entry-blocked").length;
const rejectedCount = (item: PluginListEntry): number => problemsOf(item).filter((problem) => problem.kind === "contribution-rejected").length;
const catalogCount = (item: PluginListEntry): number => problemsOf(item).filter((problem) => problem.kind === "catalog-unavailable").length;

const BLOCKED_REASON_KEYS: Readonly<Record<Extract<PluginProblem, {kind: "entry-blocked"}>["reason"], PluginsTextKey>> = {
    "missing-service": "problems.blockedReasons.missing-service",
    "location-mismatch": "problems.blockedReasons.location-mismatch",
    "provider-blocked": "problems.blockedReasons.provider-blocked",
    "provider-failed": "problems.blockedReasons.provider-failed",
    "dependency-cycle": "problems.blockedReasons.dependency-cycle",
    "version-mismatch": "problems.blockedReasons.version-mismatch",
};

const CATALOG_REASON_KEYS: Readonly<Record<Extract<PluginProblem, {kind: "catalog-unavailable"}>["reason"], PluginsTextKey>> = {
    "not-found": "problems.catalogReasons.not-found",
    "invalid": "problems.catalogReasons.invalid",
    "fetch-failed": "problems.catalogReasons.fetch-failed",
};

const REJECTED_REASON_KEYS: Readonly<Record<Extract<PluginProblem, {kind: "contribution-rejected"}>["reason"], PluginsTextKey>> = {
    "invalid-declaration": "problems.rejectedReasons.invalid-declaration",
    "implementation-required": "problems.rejectedReasons.implementation-required",
    "implementation-not-accepted": "problems.rejectedReasons.implementation-not-accepted",
    "duplicate-contribution": "problems.rejectedReasons.duplicate-contribution",
};

/** 一条问题写成一句话：固定的部分按界面语言，激活错误的消息与拒绝的详情原样接上。 */
function problemLine(problem: PluginProblem): string {
    if (problem.kind === "entry-failed") return text("problems.entryFailed", {entry: problem.entry, location: problem.location, reason: problem.message ?? `${problem.stage}/${problem.reason}`});
    if (problem.kind === "entry-blocked") return text("problems.entryBlocked", {entry: problem.entry, location: problem.location, reason: text(BLOCKED_REASON_KEYS[problem.reason], {key: problem.key})});
    if (problem.kind === "catalog-unavailable") {
        const reason = text(CATALOG_REASON_KEYS[problem.reason]);
        return text("problems.catalogUnavailable", {locale: problem.locale, reason: problem.detail === null ? reason : text("problems.withDetail", {reason, detail: problem.detail})});
    }
    const reason = text(REJECTED_REASON_KEYS[problem.reason]);
    return text("problems.contributionRejected", {capability: problem.capability, id: problem.id, reason: problem.detail === null ? reason : text("problems.withDetail", {reason, detail: problem.detail})});
}
/** 第三方插件在前：它们才有操作；内置插件随产品，放在后面。 */
const groups = computed(() => [
    {key: "third-party", heading: "groups.thirdParty" as const, items: items.value.filter((item) => item.source === "third-party")},
    {key: "builtin", heading: "groups.builtin" as const, items: items.value.filter((item) => item.source === "builtin")},
]);

/** 失败码的一句原因：路由码取宿主目录，本插件的码取本插件目录，都不是时是宿主的未知码文案。 */
const reasonOf = (code: string): string => port.t(isRemoteFailureCode(code) ? remoteFailureText(code) : codeText(pluginsText, FAILURE_KEYS, code));
/** 列不列服务端详情：本插件的码只在能补充时列，路由码不列，不认识的码列。 */
const listsDetail = (code: string): boolean => (Object.hasOwn(FAILURE_KEYS, code) ? DETAIL_CODES.has(code as PluginFailureCode) : !isRemoteFailureCode(code));

function detailOf(failure: Failure): {readonly detail: string; readonly problems: ReadonlyArray<string>} {
    const detail = failure.detail;
    if (typeof detail === "string") return {detail, problems: []};
    if (typeof detail !== "object" || detail === null) return {detail: "", problems: []};
    return {
        detail: "detail" in detail && typeof detail.detail === "string" ? detail.detail : "",
        problems: "problems" in detail && Array.isArray(detail.problems) ? detail.problems.map(String) : [],
    };
}

/** 写出失败说明并让它进入视野（行内操作的失败可能发生在滚下去的位置）；列表可能已过时时等重新读完。 */
async function report(failure: Failure, source: Source["kind"] = "path"): Promise<void> {
    const {detail, problems} = detailOf(failure);
    // 出错字段（清单无效）本身就是原因；没有时才用服务端的一句话。
    const lines = problems.length > 0 ? problems : [detail].filter((line) => line !== "");
    // 上传的文件夹失效时（已删、已过期）路径没有错，原因换成“拖入的文件夹已经失效”。
    if (source === "upload" && failure.code === "path-rejected") await showProblem("path-rejected", text("upload.expired"), []);
    else await showProblem(failure.code, reasonOf(failure.code), listsDetail(failure.code) ? lines : []);
    if (STALE_CODES.has(failure.code)) await refresh();
}

/** 失败说明区写一条原因并让它进入视野（行内操作的失败可能发生在滚下去的位置）。 */
async function showProblem(code: string, reason: string, lines: ReadonlyArray<string>): Promise<void> {
    serial += 1;
    problem.value = {serial, code, reason, lines};
    await nextTick();
    problemRegion.value?.scrollIntoView({block: "nearest"});
}

// 只采用最新一次读取的结果；读取途中又完成了写操作时重新读，旧结果不会盖掉写操作刚换上的行。
let generation = 0;
let reading = false;

/** 读列表；返回这次读取之后页面的状态（被更新的一次读取取代时为 null）。 */
async function refresh(): Promise<"failed" | "ready" | null> {
    generation += 1;
    const mine = generation;
    reading = true;
    const result = await props.registry.list({});
    if (mine !== generation) return null;
    reading = false;
    if (!result.ok) {
        const {detail} = detailOf(result);
        loadFailure.value = [reasonOf(result.code), listsDetail(result.code) ? detail : ""].filter((line) => line !== "").join(" · ");
        state.value = "failed";
        return "failed";
    }
    items.value = result.value.plugins;
    safeMode.value = result.value.safeMode;
    state.value = "ready";
    return "ready";
}

async function retry(): Promise<void> {
    state.value = "loading";
    const after = await refresh();
    // “重试”随失败块一起被换掉了：焦点放到新的“重试”或第三方插件的小标题，不落到 body。
    await nextTick();
    if (after === "failed") focusComponent(retryButton.value);
    else if (after === "ready") thirdPartyTitle?.focus();
}

/** 写操作的结果换上行的状态；显示名、说明与问题是列表才有的，留着上一次读到的。 */
function replace(item: PluginListItem): void {
    items.value = items.value.map((current) => (current.id === item.id ? {...current, ...item} : current));
    if (reading) void refresh();
}

function focusComponent(component: {$el?: Element} | null): void {
    const element = component?.$el;
    const target = element instanceof HTMLInputElement || element instanceof HTMLButtonElement ? element : element?.querySelector("input, button");
    if (target instanceof HTMLElement) target.focus();
}

async function startInstall(): Promise<void> {
    if (busy.value !== null) return;
    const source = path.value.trim();
    if (source === "") {
        focusComponent(pathInput.value);
        return;
    }
    busy.value = "preview";
    const result = await props.registry.inspect({path: source});
    busy.value = null;
    if (!result.ok) {
        await report(result);
        return;
    }
    problem.value = null;
    previewSource.value = {kind: "path", path: source};
    preview.value = result.value;
    previewOpen.value = true;
}

async function confirmInstall(): Promise<void> {
    if (busy.value !== null || !previewOpen.value) return;
    busy.value = "install";
    const source = previewSource.value;
    // 发出安装请求之后页面不再管这个上传：服务端在安装结束（成功或失败）时删它；这时页面关掉也不会让安装用到一半的目录被删。
    if (source.kind === "upload") heldUpload = null;
    const result = await (source.kind === "upload" ? props.registry.install({upload: source.id}) : props.registry.install({path: source.path}));
    busy.value = null;
    previewOpen.value = false;
    if (!result.ok) {
        await report(result, source.kind);
        return;
    }
    problem.value = null;
    if (source.kind === "path") path.value = "";
    await refresh();
}

/** 删掉页面上传的、还没交给安装的那个上传；`keepalive` 用于页面离开。 */
function discardHeld(keepalive = false): void {
    const id = heldUpload;
    heldUpload = null;
    if (id !== null) void props.folderUpload?.discard(id, {keepalive});
}

function collectProblemLines(found: CollectProblem): {readonly reason: string; readonly lines: ReadonlyArray<string>} {
    switch (found.kind) {
        case "too-many-files":
            return {reason: text("upload.problem.too-many-files", {max: UPLOAD_LIMITS.maxFiles}), lines: []};
        case "file-too-large":
            return {reason: text("upload.problem.file-too-large", {path: found.path, max: mib(UPLOAD_LIMITS.maxFileBytes)}), lines: []};
        case "too-large":
            return {reason: text("upload.problem.too-large", {max: mib(UPLOAD_LIMITS.maxTotalBytes)}), lines: []};
        case "path-invalid":
            return {reason: text("upload.problem.path-invalid"), lines: [`${found.path}：${found.detail}`]};
        case "too-deep":
            return {reason: text("upload.problem.too-deep"), lines: []};
        case "read-failed":
            return {reason: text("upload.problem.read-failed", {path: found.path}), lines: []};
    }
}

/**
 * 一个文件夹走完“收集、检查、上传、预览”：收集与检查在页面里（拒绝的当场说明、不上传），上传成功后对上传的文件夹调 `inspect`，
 * 之后与路径安装同一个确认框。任何一步失败都不留下上传：预览失败就删。
 */
async function installFolder(collect: () => Promise<CollectResult>): Promise<void> {
    const client = props.folderUpload;
    if (client === null || client === undefined) return;
    if (busy.value !== null || previewOpen.value) {
        await showProblem("upload-busy-now", text("upload.busyNow"), []);
        return;
    }
    busy.value = "upload";
    problem.value = null;
    try {
        const collected = await collect();
        if (disposed) return;
        if (!collected.ok) {
            const {reason, lines} = collectProblemLines(collected.problem);
            await showProblem(collected.problem.kind, reason, lines);
            return;
        }
        const {folder} = collected;
        const verdict = pluginFolderProblem(folder);
        if (verdict !== null) {
            await showProblem("no-manifest", verdict.kind === "nested" ? text("upload.nested", {name: verdict.name}) : text("upload.noManifest"), []);
            return;
        }
        const collision = pathCollision(folder);
        if (collision !== null) {
            await showProblem("path-invalid", text("upload.problem.path-invalid"), [collision]);
            return;
        }
        uploadAbort = new AbortController();
        uploadPercent.value = 0;
        const uploaded = await client.upload(folder, {signal: uploadAbort.signal, onProgress: (sent, total) => (uploadPercent.value = total === 0 ? 100 : Math.floor((sent * 100) / total))});
        uploadAbort = null;
        if (disposed) {
            // 页面在上传途中卸载了：上传到了就删（卸载那一刻 `heldUpload` 还没有它）。
            if (uploaded.ok) void client.discard(uploaded.id, {keepalive: true});
            return;
        }
        if (!uploaded.ok) {
            await showProblem(uploaded.code, text(`upload.errors.${uploaded.code}` satisfies `upload.errors.${UploadFailureCode}`), uploaded.detail === "" ? [] : [uploaded.detail]);
            return;
        }
        heldUpload = uploaded.id;
        uploadPercent.value = null;
        const result = await props.registry.inspect({upload: uploaded.id});
        if (!result.ok) {
            discardHeld();
            await report(result, "upload");
            return;
        }
        problem.value = null;
        previewSource.value = {kind: "upload", id: uploaded.id, name: folder.name, files: uploaded.files, bytes: uploaded.bytes};
        preview.value = result.value;
        previewOpen.value = true;
    } finally {
        uploadAbort = null;
        uploadPercent.value = null;
        busy.value = null;
    }
}

const ARCHIVE = /\.(?:zip|tgz|tar|tar\.gz|gz|7z|rar)$/iu;

/** 拖进来的东西：恰好一个文件夹才收，别的说明为什么不收。 */
async function dropped(items: ReadonlyArray<DroppedItem>): Promise<void> {
    const only = items.length === 1 ? items[0]! : null;
    if (only === null || only.kind === "file") {
        const archive = only !== null && ARCHIVE.test(only.name);
        await showProblem(archive ? "archive" : "not-folder", text(archive ? "upload.archive" : "upload.notFolder"), []);
        return;
    }
    await installFolder(() => collectFolder(only.entry, COLLECT_OPTIONS));
}

/** `webkitdirectory` 是非标准属性（Chrome、Edge、Firefox、Safari 都支持），Vue 的 input 属性类型里没有它：挂上元素时设。 */
function bindFolderInput(element: unknown): void {
    folderInput.value = element instanceof HTMLInputElement ? element : null;
    folderInput.value?.setAttribute("webkitdirectory", "");
}

function onFolderPicked(): void {
    const input = folderInput.value;
    const files = Array.from(input?.files ?? []);
    // 清空，选同一个文件夹第二次时才会再触发 change。
    if (input !== null) input.value = "";
    // 空文件夹没有文件可上传：说清楚没有清单，不要什么反应都没有。
    if (files.length === 0) void showProblem("no-manifest", text("upload.noManifest"), []);
    else void installFolder(() => Promise.resolve(collectInputFiles(files, COLLECT_OPTIONS)));
}

/** 设置窗口里的任何位置（侧栏、标题、列表下面的空白）都是落点：页面根只有内容那么高，只认它会让空白处的松手被当成“落在别处”。 */
function inDropRegion(target: EventTarget | null): boolean {
    const region = pageRoot.value?.closest("[data-settings-window]") ?? pageRoot.value;
    return target instanceof Node && region?.contains(target) === true;
}

/**
 * 窗口上的拖放（页面挂载期间，给了上传客户端才处理）：含文件的拖动一律 `preventDefault`（落在没人接的地方，浏览器的缺省动作是把
 * 文件当文档打开、整页导航走）；落在设置窗口里的当作拖入，其余提示拖到插件页。拖动经过时显示覆盖层，离开窗口（`relatedTarget` 为空）或松手
 * 时收起。松手时在事件的同步段里读出条目，之后异步遍历。
 */
function onWindowDragOver(event: DragEvent): void {
    if (props.folderUpload == null || !dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    const inside = inDropRegion(event.target);
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = inside ? "copy" : "none";
    dragging.value = inside;
}

function onWindowDragLeave(event: DragEvent): void {
    if (event.relatedTarget === null) dragging.value = false;
}

function onWindowDrop(event: DragEvent): void {
    if (props.folderUpload == null || !dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragging.value = false;
    if (inDropRegion(event.target)) {
        void dropped(readDrop(event.dataTransfer!));
        return;
    }
    void showProblem("drop-outside", text(busy.value !== null || previewOpen.value ? "upload.busyNow" : "upload.outside"), []);
}
const leavePage = (): void => discardHeld(true);

async function toggle(item: PluginListItem, enabled: boolean): Promise<void> {
    if (busy.value !== null) return;
    busy.value = `toggle:${item.id}`;
    const result = enabled ? await props.registry.enable({id: item.id}) : await props.registry.disable({id: item.id});
    busy.value = null;
    if (!result.ok) {
        await report(result);
        return;
    }
    problem.value = null;
    replace(result.value.plugin);
}

/** 这一行还画着“卸载”（第三方插件、不在卸载中）。 */
function hasUninstall(id: string): boolean {
    return items.value.some((item) => item.id === id && item.source === "third-party" && item.state !== "uninstalling");
}

async function confirmUninstall(): Promise<void> {
    const item = uninstalling.value;
    if (item === null || busy.value !== null) return;
    busy.value = `uninstall:${item.id}`;
    const result = await props.registry.uninstall({id: item.id});
    busy.value = null;
    uninstallOpen.value = false;
    if (result.ok) {
        problem.value = null;
        replace(result.value.plugin);
    } else {
        await report(result);
    }
    // 卸载成功，或失败后重读的列表里这一行已在卸载中、已不在：打开对话框的“卸载”没了，对话框还不了焦点。
    if (!hasUninstall(item.id)) {
        await nextTick();
        thirdPartyTitle?.focus();
    }
}

/** 只停用别的写控件：正在操作的那个保持可聚焦（键盘用户不丢焦点），重复操作由处理函数忽略。 */
function blockedFor(key: string): boolean {
    return busy.value !== null && busy.value !== key;
}

/** 换到更低的版本写“降级”，与安装确认框的说法一致。 */
function pendingText(change: PendingChange, current: string): string {
    if (change.kind !== "upgrade") return text(PENDING_KEYS[change.kind]);
    return text(compareVersions(change.version, current) < 0 ? "row.pending.downgrade" : PENDING_KEYS.upgrade, {version: change.version});
}

function openUninstall(item: PluginListItem): void {
    uninstalling.value = item;
    uninstallOpen.value = true;
}

function closePreview(open: boolean): void {
    if (open || busy.value === "install") return;
    previewOpen.value = false;
    // 取消预览：页面上传的文件夹没人要了，删掉。
    discardHeld();
}

function closeUninstall(open: boolean): void {
    if (!open && busy.value === null) uninstallOpen.value = false;
}

onMounted(() => {
    void refresh();
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);
    window.addEventListener("pagehide", leavePage);
});

onBeforeUnmount(() => {
    window.removeEventListener("dragover", onWindowDragOver);
    window.removeEventListener("dragleave", onWindowDragLeave);
    window.removeEventListener("drop", onWindowDrop);
    window.removeEventListener("pagehide", leavePage);
    disposed = true;
    uploadAbort?.abort();
    discardHeld(true);
});
</script>

<template>
    <div ref="pageRoot" class="plugins-page" data-plugins-page :data-plugins-state="state" >
        <!-- 拖着文件经过：盖住整页，写“松开以安装插件”。自己不收事件（pointer-events: none），松手仍落在页面根上。 -->
        <div v-if="dragging" class="plugins-page__drop" aria-hidden="true" data-plugin-drop>
            <span class="i-lucide-folder-down plugins-page__drop-icon"></span>
            <span>{{ text('upload.overlay') }}</span>
        </div>
        <!-- 与设置窗口画在分区顶部的层状态说明同一种写法：一行图标加文字，不画框。 -->
        <p class="plugins-page__note" :class="{'plugins-page__note--warning': hasPending}" role="status" data-plugins-restart>
            <span :class="hasPending ? 'i-lucide-triangle-alert' : 'i-lucide-info'" class="plugins-page__note-icon" aria-hidden="true"></span>
            <span>{{ text(hasPending ? 'page.pendingNote' : 'page.restartNote') }}</span>
        </p>
        <p v-if="safeMode" class="plugins-page__note plugins-page__note--warning" data-plugins-safe-mode>
            <span class="i-lucide-shield-alert plugins-page__note-icon" aria-hidden="true"></span>
            <span>{{ text('page.safeMode') }}</span>
        </p>
        <p v-if="hasProblems" class="plugins-page__note" data-plugins-snapshot>
            <span class="i-lucide-info plugins-page__note-icon" aria-hidden="true"></span>
            <span>{{ text('page.problemsSnapshot') }}</span>
        </p>

        <form class="plugins-page__install" @submit.prevent="startInstall">
            <label class="plugins-page__label" for="nbook-plugins-path">{{ text('install.pathLabel') }}</label>
            <div class="plugins-page__install-row">
                <Input id="nbook-plugins-path" ref="pathInput" v-model="path" :placeholder="text('install.pathPlaceholder')" spellcheck="false" data-plugin-path />
                <Button variant="primary" type="submit" :disabled="blockedFor('preview')" :aria-busy="busy === 'preview' ? 'true' : undefined" data-plugin-install>{{ text('install.start') }}</Button>
            </div>
            <div v-if="folderUpload" class="plugins-page__folder">
                <span class="plugins-page__muted">{{ text('upload.hint') }}</span>
                <Button type="button" variant="secondary" size="sm" :aria-disabled="busy !== null ? 'true' : undefined" data-plugin-choose-folder @click="busy === null && folderInput?.click()">{{ text('upload.choose') }}</Button>
                <!-- 选目录：浏览器给的文件列表带相对路径（webkitRelativePath）。藏起来，由上面的按钮打开。 -->
                <input :ref="bindFolderInput" type="file" class="plugins-page__folder-input" tabindex="-1" aria-hidden="true" data-plugin-folder-input @change="onFolderPicked" />
            </div>
            <p v-if="uploadPercent !== null" class="plugins-page__muted" role="status" data-plugin-upload-progress>{{ text('upload.progress', {percent: uploadPercent}) }}</p>
        </form>

        <div ref="problemRegion" class="plugins-page__problem" role="alert" :data-plugin-problem="problem?.code">
            <template v-if="problem !== null">
                <p :key="problem.serial" class="plugins-page__problem-reason" :title="problem.code">{{ problem.reason }}</p>
                <p v-for="line in problem.lines" :key="`${problem.serial}:${line}`" class="plugins-page__problem-line">{{ line }}</p>
            </template>
        </div>

        <!-- Spinner 自己是带名称的 status；aria-busy 标出正在加载的区域。 -->
        <div v-if="state === 'loading'" class="plugins-page__notice plugins-page__notice--delayed" aria-busy="true">
            <Spinner size="sm" :label="text('page.loading')" show-label />
        </div>
        <div v-else-if="state === 'failed'" class="plugins-page__notice" role="alert" data-plugins-load-failure>
            <span>{{ loadFailure }}</span>
            <Button ref="retryButton" size="sm" variant="secondary" data-plugins-retry @click="retry">{{ text('page.retry') }}</Button>
        </div>
        <div v-else class="plugins-page__groups">
            <section v-for="group in groups" :key="group.key" class="plugins-page__group" :data-plugin-group="group.key">
                <h3 :ref="(element) => rememberTitle(group.key, element)" class="plugins-page__group-title" tabindex="-1">{{ text(group.heading) }}</h3>
                <p v-if="group.items.length === 0" class="plugins-page__muted" data-plugins-empty>{{ text('groups.noThirdParty') }}</p>
                <ul v-else class="plugins-page__list">
                    <li v-for="item in group.items" :key="item.id" class="plugins-page__item" :data-plugin-row="item.id" :data-plugin-source="item.source">
                        <div class="plugins-page__meta">
                            <div class="plugins-page__heading">
                                <span class="plugins-page__id">{{ item.id }}</span>
                                <span v-if="displayNameOf(item) !== null" class="plugins-page__display-name" data-plugin-display-name>{{ displayNameOf(item) }}</span>
                                <span class="plugins-page__version">{{ item.version }}</span>
                                <Badge v-if="item.source === 'builtin'" size="sm" variant="soft">{{ text('row.builtin') }}</Badge>
                                <Badge v-for="change in item.pending" :key="change.kind" class="plugins-page__badge" size="sm" variant="soft" tone="warning" :data-plugin-pending="change.kind">{{ pendingText(change, item.version) }}</Badge>
                                <Badge v-if="item.notLoaded !== null" class="plugins-page__badge" size="sm" variant="soft" :tone="NOT_LOADED[item.notLoaded.code].tone" :data-plugin-not-loaded="item.notLoaded.code">{{ text(NOT_LOADED[item.notLoaded.code].text) }}</Badge>
                                <Badge v-if="entryProblemCount(item) > 0" class="plugins-page__badge" size="sm" variant="soft" tone="danger" data-plugin-problems="entries">{{ text('row.entryProblems', {count: entryProblemCount(item)}) }}</Badge>
                                <Badge v-if="rejectedCount(item) > 0" class="plugins-page__badge" size="sm" variant="soft" tone="danger" data-plugin-problems="contributions">{{ text('row.rejectedProblems', {count: rejectedCount(item)}) }}</Badge>
                                <Badge v-if="catalogCount(item) > 0" class="plugins-page__badge" size="sm" variant="soft" tone="warning" data-plugin-problems="catalogs">{{ text('row.catalogProblems', {count: catalogCount(item)}) }}</Badge>
                            </div>
                            <p v-if="item.notLoaded !== null && NOT_LOADED[item.notLoaded.code].showDetail" class="plugins-page__reason">{{ item.notLoaded.detail }}</p>
                            <p v-if="descriptionOf(item) !== null" class="plugins-page__description" :title="descriptionOf(item) ?? undefined" data-plugin-description>{{ descriptionOf(item) }}</p>
                            <p v-for="line in problemsOf(item).map(problemLine)" :key="line" class="plugins-page__reason" data-plugin-problem-line>{{ line }}</p>
                        </div>
                        <div v-if="item.source === 'third-party' && item.state !== 'uninstalling'" class="plugins-page__actions">
                            <Switch
                                :model-value="item.state === 'enabled'"
                                :disabled="blockedFor(`toggle:${item.id}`)"
                                :aria-label="text('row.toggle', {id: item.id})"
                                data-plugin-toggle
                                @update:model-value="(value: boolean) => toggle(item, value)"
                            />
                            <Button
                                variant="secondary"
                                size="sm"
                                :disabled="busy !== null"
                                :aria-label="text('row.uninstallNamed', {id: item.id})"
                                data-plugin-uninstall
                                @click="openUninstall(item)"
                            >
                                {{ text('row.uninstall') }}
                            </Button>
                        </div>
                    </li>
                </ul>
            </section>
        </div>

        <Dialog
            :open="previewOpen"
            size="sm"
            :title="preview === null ? '' : text(PREVIEW_KEYS[preview.relation].title)"
            :busy="busy === 'install'"
            @update:open="closePreview"
        >
            <template v-if="preview !== null">
                <p class="plugins-page__dialog-subject">{{ preview.installed === null ? `${preview.id} ${preview.version}` : `${preview.id} ${preview.installed} → ${preview.version}` }}</p>
                <p v-if="preview.relation === 'downgrade'" class="plugins-page__dialog-warning">{{ text('preview.downgradeWarning') }}</p>
                <div v-if="preview.blocked.length > 0" class="plugins-page__dialog-warning" data-plugin-preview-blocked>
                    <p class="plugins-page__dialog-list-title">{{ text('preview.blockedTitle') }}</p>
                    <ul class="plugins-page__dialog-list">
                        <li v-for="item in preview.blocked" :key="`${item.plugin} ${item.reason} ${item.range ?? item.service ?? ''}`" :data-plugin-preview-blocked-item="item.plugin">{{ blockedLine(item) }}</li>
                    </ul>
                </div>
                <p v-if="preview.unchecked.length > 0" class="plugins-page__dialog-text" data-plugin-preview-unchecked>{{ text('preview.unchecked', {plugins: list(preview.unchecked)}) }}</p>
                <p class="plugins-page__dialog-text">{{ text('preview.trust') }}</p>
                <p class="plugins-page__path" data-plugin-preview-source>{{ previewSourceText }}</p>
            </template>
            <template #footer="{cancel}">
                <Button class="flex-1" variant="secondary" :disabled="busy === 'install'" @click="cancel">{{ text('dialog.cancel') }}</Button>
                <Button variant="primary" class="flex-1" :loading="busy === 'install'" data-plugin-install-confirm @click="confirmInstall">{{ preview === null ? "" : text(PREVIEW_KEYS[preview.relation].confirm) }}</Button>
            </template>
        </Dialog>

        <Dialog
            :open="uninstallOpen"
            size="sm"
            :title="text('uninstall.title')"
            :busy="busy !== null && busy.startsWith('uninstall:')"
            @update:open="closeUninstall"
        >
            <p class="plugins-page__dialog-text">{{ uninstalling === null ? "" : text('uninstall.body', {id: uninstalling.id}) }}</p>
            <template #footer="{cancel}">
                <Button class="flex-1" variant="secondary" :disabled="busy !== null" @click="cancel">{{ text('dialog.cancel') }}</Button>
                <Button class="flex-1" variant="danger" :loading="busy !== null && busy.startsWith('uninstall:')" data-plugin-uninstall-confirm @click="confirmUninstall">{{ text('row.uninstall') }}</Button>
            </template>
        </Dialog>
    </div>
</template>

<style scoped>
.plugins-page {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

/* 拖入的覆盖层：盖住整页、不收指针事件，松手仍落在页面根上。 */
.plugins-page__drop {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    /* 页面比视口高时整页正中可能在视口之外：文字靠上放。 */
    align-items: flex-start;
    justify-content: center;
    padding-top: var(--space-7);
    gap: var(--space-2);
    border: 2px dashed var(--accent-main);
    border-radius: var(--radius-panel);
    background: color-mix(in srgb, var(--accent-main) 8%, transparent);
    color: var(--accent-text);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    pointer-events: none;
}

.plugins-page__drop-icon {
    font-size: 1.25em;
}

.plugins-page__folder {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
}

.plugins-page__folder-input {
    display: none;
}

.plugins-page__install {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
}

.plugins-page__note {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.plugins-page__note--warning {
    color: var(--status-warning);
}

.plugins-page__note-icon {
    width: var(--text-sm);
    height: var(--text-sm);
    flex-shrink: 0;
}

.plugins-page__label,
.plugins-page__muted {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
}

/* 标签是表单里唯一的说明，不用最淡的字色。 */
.plugins-page__label {
    color: var(--text-secondary);
}

.plugins-page__install-row {
    display: flex;
    gap: var(--space-2);
    align-items: center;
}

.plugins-page__install-row > :first-child {
    flex: 1 1 auto;
    min-width: 0;
}

/* 空着时不占高度；`display: none` 让它暂时不在无障碍树里，第一次失败时容器与文字一起出现，靠 alert 角色出现时的播报。 */
.plugins-page__problem:empty {
    display: none;
}

.plugins-page__problem {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    overflow-wrap: anywhere;
}

/* 失败原因、插件说明与来源路径都是内容，要能复制（nb-ui 规范的“文字能否选中”）。 */
.plugins-page__problem-reason {
    margin: 0;
    user-select: text;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--status-danger);
}

.plugins-page__problem-line {
    margin: 0;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
}

.plugins-page__notice {
    display: flex;
    min-height: 160px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    padding: var(--space-5);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    text-align: center;
    overflow-wrap: anywhere;
}

/* 读得快时不闪：加载指示约 200ms 后才显现。 */
.plugins-page__notice--delayed {
    animation: plugins-page-appear 0s linear 200ms both;
}

@keyframes plugins-page-appear {
    from {
        visibility: hidden;
    }

    to {
        visibility: visible;
    }
}

/* 组与组、安装区与第一组之间用设置列表的分组间距（SettingsListSection）。 */
.plugins-page__groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-7);
    margin-top: calc(var(--space-7) - var(--space-4));
}

.plugins-page__group {
    display: flex;
    flex-direction: column;
}

.plugins-page__group-title {
    margin: 0;
    padding-bottom: var(--space-3);
    border-bottom: var(--border-w) solid var(--divider);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    outline: none;
}

.plugins-page__group-title:focus-visible {
    box-shadow: var(--focus-ring);
}

.plugins-page__group > .plugins-page__muted {
    padding: var(--space-3) 0;
}

.plugins-page__list {
    margin: 0;
    padding: 0;
    list-style: none;
}

.plugins-page__item {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-4);
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3) 0;
    border-bottom: var(--border-w) solid var(--divider);
}

.plugins-page__meta {
    display: flex;
    flex: 1 1 240px;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
}

.plugins-page__heading {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    min-width: 0;
}

/*
 * 徽标默认不换行、高度只有一行；长文字（英文的“重启后升级到 x”、很长的版本号）在窄行里允许折行，高度随之撑开，
 * 不压到右边的控件、不溢出底框。
 */
.plugins-page__badge {
    max-width: 100%;
    height: auto;
    min-height: calc(var(--control-h-sm) * 0.68);
    padding-block: 1px;
    white-space: normal;
}

.plugins-page__id {
    font-size: var(--text-sm);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.plugins-page__version {
    font-size: var(--text-xs);
    color: var(--text-muted);
}

.plugins-page__display-name {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}

/* 说明只占一行，放不下截断，悬停看全文：多数行没有说明，长说明不把窄屏下的每一行都拉高。 */
.plugins-page__description {
    margin: 0;
    user-select: text;
    overflow: hidden;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.plugins-page__reason {
    margin: 0;
    user-select: text;
    font-size: var(--text-xs);
    line-height: var(--leading-ui);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}

.plugins-page__actions {
    display: flex;
    flex: none;
    gap: var(--space-2);
    align-items: center;
    margin-left: auto;
}

.plugins-page__dialog-subject {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.plugins-page__dialog-warning {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--status-warning);
    overflow-wrap: anywhere;
}

.plugins-page__dialog-list-title {
    margin: 0;
}

.plugins-page__dialog-list {
    margin: var(--space-1) 0 0;
    padding-left: var(--space-5);
}

.plugins-page__dialog-text {
    margin: 0 0 var(--space-3);
    font-size: var(--text-sm);
    line-height: var(--leading-ui);
    color: var(--text-main);
    overflow-wrap: anywhere;
}

.plugins-page__path {
    margin: 0;
    user-select: text;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-secondary);
    overflow-wrap: anywhere;
}
</style>
