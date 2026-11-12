/**
 * 插件管理的操作：列表、安装（含升级）、启用、禁用、卸载（docs/specs/runtime/plugin-install.md 输出 1–4、8、9）。
 *
 * 所有操作只写登记表与安装目录，在下一次启动生效；本次运行的插件集合是启动时确定的 `StartupPlugins`，列表拿它与
 * 登记表比较得出待生效变化。
 *
 * 安装先在 `.staging/<随机名>/` 里复制与核对（持这个准备目录自己的锁，别的进程启动回收时跳过它），再持登记表的写入锁
 * 重新核对、把准备目录改名为 `<id>/<版本>/`、写登记表：写登记表就是提交点。提交前任何失败都删掉准备目录与已改名的
 * 版本目录；替换待切换版本时，提交之后、仍持锁时删除被取代的版本目录（删不掉的留给下次启动回收）。
 */

import {randomUUID} from "node:crypto";
import {lstat, mkdir, realpath, rename, rm, stat} from "node:fs/promises";
import {join, resolve} from "node:path";

import {errno, holdLock} from "@notnotype/nb-file-lock";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import type {PluginManifest} from "@notnotype/nb-runtime/plugin-manifest";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {InstallFailureCode, InstallPreview, ManageFailureCode, PendingChange, PluginFailureCode, PluginList, PluginListEntry, PluginListItem, PluginProblem} from "nbook/plugin-platform/shared/types";
import type {PlatformProfile} from "nbook/plugin-platform/shared/profile";
import {compareVersions, engineAccepts} from "nbook/plugin-platform/shared/versions";

import {catalogProblemsIn} from "./catalogs";
import {collectCopyRange, copyRange} from "./copy";
import {isInside} from "./paths";
import {assertHeld, brief, byId, isLink, LockLost, ownedPath, readRecord, STAGING_DIR, withRecordLock, writeRecord} from "./record";
import type {PluginRecord, RecordEntry} from "./record";
import {blockedAfter} from "./preview";
import type {StartupPlugins} from "./startup";
import {installedManifest, missingEntries} from "./version-dir";

export type InventoryFailure<Code extends PluginFailureCode = PluginFailureCode> = {readonly ok: false; readonly code: Code; readonly detail: string; readonly problems?: ReadonlyArray<string>};
export type InventoryResult<T, Code extends PluginFailureCode = PluginFailureCode> = {readonly ok: true; readonly value: T} | InventoryFailure<Code>;

export interface PluginInventory {
    list(): Promise<InventoryResult<PluginList, "registry-failed">>;
    /** 只读：安装这个文件夹会是首次安装、升级还是降级；校验与 `install` 相同，但不复制、不写登记表。 */
    inspect(sourcePath: string): Promise<InventoryResult<InstallPreview, InstallFailureCode>>;
    /** `sourcePath` 是服务端本地的插件文件夹；已安装另一版本时按升级处理。 */
    install(sourcePath: string): Promise<InventoryResult<PluginListItem, InstallFailureCode>>;
    setEnabled(id: string, enabled: boolean): Promise<InventoryResult<PluginListItem, ManageFailureCode>>;
    uninstall(id: string): Promise<InventoryResult<PluginListItem, ManageFailureCode>>;
}

/** 服务端宿主提供的宿主能力，应用的插件管理界面（插件页的远程服务）经它实现。服务 id 不带应用名：它属于通用的插件管理。 */
export const pluginInventoryKey: ServiceKey<PluginInventory> = defineServiceKey<PluginInventory>("plugin-platform/inventory");

export interface PluginInventoryOptions {
    /** `<State Root>/plugins`。 */
    readonly root: string;
    readonly profile: PlatformProfile;
    /** 本进程装配的内置插件；列表里标为内置，启停与卸载被拒绝。 */
    readonly builtin: ReadonlyArray<{readonly id: string; readonly version: string}>;
    readonly startup: StartupPlugins;
    readonly record: (input: DiagnosticInput) => void;
    /**
     * 本实例（服务端）此刻的插件问题，列表里按插件分给各项（plugin-install 的插件页）。宿主建插件管理时传入，读的是自己的
     * 内核目录；没给时列表不带问题。
     */
    readonly problems?: () => ReadonlyArray<PluginProblem>;
}

/** `prepare` 核对通过的安装源。 */
interface Prepared {
    readonly source: string;
    readonly manifest: PluginManifest;
    readonly raw: unknown;
    readonly files: ReadonlyArray<string> | null;
    /** 已安装的当前版本；没有安装为 null。 */
    readonly installed: string | null;
}

/** 目录有问题时的失败：说明写第一处问题，逐条问题另给（与清单无效同一种写法）。 */
function catalogFailure(problems: ReadonlyArray<string>): InventoryFailure<"catalog-invalid"> {
    const more = problems.length > 1 ? `，另有 ${String(problems.length - 1)} 处` : "";
    return failure("catalog-invalid", `消息目录有错误：${problems[0] ?? ""}${more}`, problems);
}

function failure<Code extends PluginFailureCode>(code: Code, detail: string, problems?: ReadonlyArray<string>): InventoryFailure<Code> {
    return {ok: false, code, detail, ...(problems === undefined ? {} : {problems})};
}

/** 路径上有没有东西；只有 ENOENT 算没有，别的错误（权限）抛出，由调用方按复制失败处理。 */
async function exists(path: string): Promise<boolean> {
    try {
        await lstat(path);
        return true;
    } catch (error) {
        if (errno(error) === "ENOENT") return false;
        throw error;
    }
}

/** 已安装的记录不接受这次安装的原因；没有为 null。 */
function conflict(entry: RecordEntry | undefined, id: string, version: string): InventoryFailure<InstallFailureCode> | null {
    if (entry === undefined) return null;
    if (entry.state === "uninstalling") return failure("uninstall-pending", `${id} 正在卸载，重启后再安装`);
    if (entry.version === version || entry.pendingVersion === version) return failure("already-installed", `${id}@${version} 已安装或等待重启后切换`);
    return null;
}

export function createPluginInventory(options: PluginInventoryOptions): PluginInventory {
    const root = resolve(options.root);
    const startupOf = new Map(options.startup.plugins.map((plugin) => [plugin.id, plugin]));
    const isBuiltin = (id: string): boolean => options.profile.format.isBuiltinId(id) || options.builtin.some((plugin) => plugin.id === id);
    const reportLock = (event: string, error: unknown): void => {
        options.record({level: "warn", event: `plugins.${event}`, message: "插件登记表的写入锁出错", error});
    };
    // 同一进程内的操作串行，结果按请求顺序；跨进程的互斥靠登记表的写入锁。
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(task: () => Promise<T>): Promise<T> => {
        const next = queue.then(task, task);
        queue = next.catch(() => undefined);
        return next;
    };

    /**
     * 一个第三方插件的列表项：登记表是目标状态，本次启动的集合是本进程实际运行的状态，待生效变化是两者之差
     * （plugin-install 输出 9）。版本也按两者比较，不只看 `pendingVersion`：命令行列表时本次启动的集合来自运行中实例的
     * 应答，没有运行中的实例时为空，每个插件都按重启后的目标状态列出。
     */
    function itemOf(id: string, entry: RecordEntry | undefined): PluginListItem {
        const atStartup = startupOf.get(id);
        const running = atStartup === undefined || atStartup.state === "uninstalling" ? null : atStartup;
        const pending: PendingChange[] = [];
        if (entry === undefined || entry.state === "uninstalling") {
            pending.push({kind: "uninstall"});
        } else {
            if (running === null) pending.push({kind: "install"});
            const target = entry.pendingVersion ?? entry.version;
            if (running !== null && target !== running.version) pending.push({kind: "upgrade", version: target});
            const before = running?.state ?? "enabled";
            if (before !== entry.state) pending.push({kind: entry.state === "enabled" ? "enable" : "disable"});
        }
        // 本次没有运行的插件，行上的版本是重启后要装上的版本。
        const version = running?.version ?? (entry === undefined ? atStartup?.version : entry.pendingVersion ?? entry.version) ?? "";
        return {
            id,
            version,
            source: "third-party",
            state: entry?.state ?? "uninstalling",
            pending,
            notLoaded: atStartup?.notLoaded ?? null,
        };
    }

    /** 持写入锁读改写登记表；`change` 返回 null 表示不用写。 */
    async function update(change: (record: PluginRecord) => InventoryResult<RecordEntry | null, ManageFailureCode>, id: string): Promise<InventoryResult<PluginListItem, ManageFailureCode>> {
        const locked = await withRecordLock(root, reportLock, async (lock): Promise<InventoryResult<PluginListItem, ManageFailureCode>> => {
            const read = await readRecord(root, options.profile);
            if (!read.ok) return failure("registry-failed", read.detail);
            const changed = change(read.record);
            if (!changed.ok) return changed;
            if (changed.value === null) return {ok: true, value: itemOf(id, read.record.plugins[id])};
            try {
                await writeRecord(root, {...read.record, plugins: {...read.record.plugins, [id]: changed.value}}, lock);
            } catch (error) {
                options.record({level: "error", event: "plugins.registry.write-failed", message: "写入插件登记表失败", data: {id}, error});
                return failure("registry-failed", `写入插件登记表失败：${brief(error)}`);
            }
            return {ok: true, value: itemOf(id, changed.value)};
        });
        return locked.ok ? locked.value : failure("registry-failed", locked.detail);
    }

    /** 安装前的核对，`inspect` 与 `install` 共用：源路径、清单、兼容、`files` 写法、安装源里的消息目录与登记表里的冲突。 */
    async function prepare(sourcePath: string): Promise<InventoryResult<Prepared, InstallFailureCode>> {
        let source: string;
        try {
            source = await realpath(resolve(sourcePath));
            if (!(await stat(source)).isDirectory()) return failure("path-rejected", "安装源不是文件夹");
        } catch (error) {
            return failure("path-rejected", `安装源不存在或不可读：${brief(error)}`);
        }
        let realRoot: string;
        try {
            await mkdir(root, {recursive: true});
            realRoot = await realpath(root);
        } catch (error) {
            return failure("copy-failed", `无法创建插件目录：${brief(error)}`);
        }
        // 两个方向都拒绝：源在安装根里会把已安装的插件当安装源，安装根在源里会把准备目录复制进自己。
        if (isInside(source, realRoot) || isInside(realRoot, source)) return failure("path-rejected", "安装源不能与插件目录互相包含");

        const read = await installedManifest(source, options.profile.format);
        if (!read.ok) {
            return failure(read.code, read.detail, read.problems);
        }
        const {manifest, raw} = read;
        const {productName, productVersion} = options.profile;
        if (!engineAccepts(productVersion, manifest.engine)) {
            return failure("incompatible-engine", `插件要求 ${productName} ${manifest.engine}，当前是 ${productVersion}`);
        }
        const files = filesOf(raw);
        if (files === undefined) return failure("manifest-invalid", "package.json 的 files 必须是字符串数组", ["files：必须是字符串数组"]);
        const catalogs = await catalogProblemsIn(source, manifest);
        if (catalogs.length > 0) return catalogFailure(catalogs);

        // 不持锁的核对：免得白复制，也让确认界面先知道结果；提交时持锁再核对。
        const record = await readRecord(root, options.profile);
        if (!record.ok) return failure("registry-failed", record.detail);
        const existing = record.record.plugins[manifest.id];
        const early = conflict(existing, manifest.id, manifest.version);
        if (early !== null) return early;
        return {ok: true, value: {source, manifest, raw, files, installed: existing?.version ?? null}};
    }

    async function inspect(sourcePath: string): Promise<InventoryResult<InstallPreview, InstallFailureCode>> {
        const prepared = await prepare(sourcePath);
        if (!prepared.ok) return prepared;
        const {manifest, installed} = prepared.value;
        const relation = installed === null ? "install" : compareVersions(manifest.version, installed) > 0 ? "upgrade" : "downgrade";
        const preview = relation === "install" ? {blocked: [], unchecked: []} : await blockedAfter(root, options.profile, manifest);
        return {ok: true, value: {id: manifest.id, version: manifest.version, installed, relation, ...preview}};
    }

    async function install(sourcePath: string): Promise<InventoryResult<PluginListItem, InstallFailureCode>> {
        const prepared = await prepare(sourcePath);
        if (!prepared.ok) return prepared;
        const {source, manifest, raw, files} = prepared.value;

        const staging = join(root, STAGING_DIR, randomUUID());
        try {
            await mkdir(join(root, STAGING_DIR), {recursive: true});
        } catch (error) {
            return failure("copy-failed", `无法创建准备目录：${brief(error)}`);
        }
        const stagingLock = await holdLock(`${staging}.lock`, reportLock);
        if (!stagingLock.ok) return failure("copy-failed", `无法锁定准备目录：${stagingLock.detail}`);
        try {
            await mkdir(staging);
            const range = await collectCopyRange(source, files, raw);
            if (!range.ok) return failure(range.code, range.detail);
            const copied = await copyRange(source, staging, range.files);
            if (!copied.ok) return failure(copied.code, copied.detail);
            const missing = await missingEntries(staging, manifest);
            if (missing.length > 0) return failure("entry-missing", `复制范围里缺少入口文件：${missing.join("、")}`, missing);
            // 安装源里的目录 prepare 已查过；这里查复制范围（`files` 漏了目录文件时只有这里发现）。
            const catalogs = await catalogProblemsIn(staging, manifest);
            if (catalogs.length > 0) return catalogFailure(catalogs);
            return await commit(manifest.id, manifest.version, staging);
        } catch (error) {
            options.record({level: "error", event: "plugins.install.failed", message: `安装 ${manifest.id}@${manifest.version} 失败`, error});
            return failure("copy-failed", `安装失败：${brief(error)}`);
        } finally {
            await rm(staging, {recursive: true, force: true}).catch((error: unknown) => {
                options.record({level: "warn", event: "plugins.cleanup.failed", message: "删除准备目录失败，下次启动回收", data: {path: staging}, error});
            });
            await stagingLock.lock.release();
        }
    }

    /**
     * 持锁提交：再核对一次、改名进安装目录、写登记表，提交之后在同一把锁里删除被取代的待切换版本。每一步删改之前核对仍
     * 持有锁；失去锁之后什么都不再删：接管者可能已经提交了同名目录，留下的残留由下次启动的回收处理。
     */
    async function commit(id: string, version: string, staging: string): Promise<InventoryResult<PluginListItem, InstallFailureCode>> {
        const locked = await withRecordLock(root, reportLock, async (lock): Promise<InventoryResult<PluginListItem, InstallFailureCode>> => {
            const read = await readRecord(root, options.profile);
            if (!read.ok) return failure("registry-failed", read.detail);
            const existing = read.record.plugins[id];
            const late = conflict(existing, id, version);
            if (late !== null) return late;
            // 走到这里的版本目录不被登记表引用（`conflict` 已挡掉 `version` 与 `pendingVersion`），是崩溃留下的残留：运行中的
            // 服务端只用登记表里的 `version`（一个状态根只跑一个服务端），不会在用它。
            const target = ownedPath(root, id, version);
            try {
                await assertHeld(lock);
                await mkdir(ownedPath(root, id), {recursive: true});
                if (await isLink(ownedPath(root, id))) return failure("copy-failed", `安装目录里的 ${id} 是符号链接，不能往里面安装`);
                await assertHeld(lock);
                await rm(target, {recursive: true, force: true});
                await assertHeld(lock);
                await rename(staging, target);
            } catch (error) {
                if (error instanceof LockLost) return failure("registry-failed", error.message);
                return failure("copy-failed", `移入安装目录失败：${brief(error)}`);
            }
            const entry: RecordEntry = existing === undefined
                ? {version, pendingVersion: null, state: "enabled", deleteData: false}
                : {...existing, pendingVersion: version};
            try {
                await writeRecord(root, {...read.record, plugins: {...read.record.plugins, [id]: entry}}, lock);
            } catch (error) {
                options.record({level: "error", event: "plugins.registry.write-failed", message: "写入插件登记表失败，安装已撤回", data: {id, version}, error});
                if (!(error instanceof LockLost)) {
                    await assertHeld(lock).then(() => rm(target, {recursive: true, force: true})).catch((cleanup: unknown) => {
                        options.record({level: "warn", event: "plugins.cleanup.failed", message: "撤回安装目录失败，下次启动回收", data: {path: target}, error: cleanup});
                    });
                }
                return failure("registry-failed", `写入插件登记表失败：${brief(error)}`);
            }
            // 被取代的待切换版本还没有被任何服务端加载过（切换只在启动时发生）。
            const replaced = existing?.pendingVersion ?? null;
            if (replaced !== null) {
                // 提交之后、释放锁之前删：释放之后别的进程可能重新装回这个版本、让登记表又引用它。
                await assertHeld(lock)
                    .then(() => rm(ownedPath(root, id, replaced), {recursive: true, force: true}))
                    .catch((error: unknown) => {
                        options.record({level: "warn", event: "plugins.cleanup.failed", message: "删除被取代的待切换版本失败，下次启动回收", data: {id, version: replaced}, error});
                    });
            }
            options.record({
                level: "info",
                event: existing === undefined ? "plugins.install.committed" : "plugins.upgrade.pending",
                message: existing === undefined ? `已安装 ${id}@${version}，下一次启动生效` : `${id} 将在下一次启动时切换到 ${version}`,
                data: {id, version, ...(existing === undefined ? {} : {from: existing.version, replacedPending: replaced})},
            });
            return {ok: true, value: itemOf(id, entry)};
        });
        return locked.ok ? locked.value : failure("registry-failed", locked.detail);
    }

    return {
        list: async () => {
            const read = await readRecord(root, options.profile);
            if (!read.ok) return failure("registry-failed", read.detail);
            const problems = options.problems?.() ?? [];
            const problemsOf = (id: string): PluginProblem[] => problems.filter((problem) => problem.plugin === id);
            const builtin: PluginListEntry[] = options.builtin
                .map((plugin): PluginListEntry => ({id: plugin.id, version: plugin.version, source: "builtin", state: "enabled", pending: [], notLoaded: null, displayName: null, description: null, problems: problemsOf(plugin.id)}))
                .sort(byId);
            // 本次启动的集合里有、登记表里已经没有的插件（登记表被手工改过）也列出：本进程里它仍在运行，重启后才没有。
            const ids = new Set([...Object.keys(read.record.plugins), ...startupOf.keys()]);
            const thirdParty = await Promise.all([...ids].sort().map(async (id): Promise<PluginListEntry> => {
                const item = itemOf(id, read.record.plugins[id]);
                // 显示名与说明取行上那个版本的清单（运行中的，或重启后要装上的）；读不了时不显示，原因另在 notLoaded 里。
                const manifest = item.version === "" ? null : await installedManifest(join(root, id, item.version), options.profile.format);
                const shown = manifest?.ok === true ? manifest.manifest : null;
                return {...item, displayName: shown?.displayName ?? null, description: shown?.description ?? null, problems: problemsOf(id)};
            }));
            return {ok: true, value: {safeMode: options.startup.safeMode, plugins: [...builtin, ...thirdParty]}};
        },
        inspect: (sourcePath) => inspect(sourcePath),
        install: (sourcePath) => serial(async () => {
            const result = await install(sourcePath);
            if (!result.ok) options.record({level: "warn", event: "plugins.install.rejected", message: "安装没有完成", data: {source: sourcePath, code: result.code, detail: result.detail}});
            return result;
        }),
        setEnabled: (id, enabled) => serial(async () => {
            if (isBuiltin(id)) return failure("builtin-fixed", "内置插件不能启用或禁用");
            const state = enabled ? "enabled" : "disabled";
            const result = await update((record) => {
                const entry = record.plugins[id];
                if (entry === undefined) return failure("not-installed", `没有安装 ${id}`);
                if (entry.state === "uninstalling") return failure("uninstall-pending", `${id} 正在卸载，重启后再操作`);
                return {ok: true, value: entry.state === state ? null : {...entry, state}};
            }, id);
            if (result.ok) options.record({level: "info", event: `plugins.${enabled ? "enable" : "disable"}`, message: `${id} 将在下一次启动时${enabled ? "启用" : "禁用"}`, data: {id}});
            return result;
        }),
        uninstall: (id) => serial(async () => {
            if (isBuiltin(id)) return failure("builtin-fixed", "内置插件不能卸载");
            const result = await update((record) => {
                const entry = record.plugins[id];
                if (entry === undefined) return failure("not-installed", `没有安装 ${id}`);
                return {ok: true, value: entry.state === "uninstalling" ? null : {...entry, state: "uninstalling", deleteData: false}};
            }, id);
            if (result.ok) options.record({level: "info", event: "plugins.uninstall.pending", message: `${id} 将在下一次启动时卸载`, data: {id}});
            return result;
        }),
    };
}

/** `files`：没有写为 null；写了但不是字符串数组为 undefined。 */
function filesOf(raw: unknown): ReadonlyArray<string> | null | undefined {
    if (typeof raw !== "object" || raw === null || !("files" in raw) || raw.files === undefined) return null;
    const files = raw.files;
    return Array.isArray(files) && files.every((item): item is string => typeof item === "string" && item.trim() !== "") ? files : undefined;
}
