/**
 * 服务端启动时确定本次运行的第三方插件集合（docs/specs/runtime/plugin-install.md 的提交点表与“失败与恢复”）。
 *
 * 宿主在装配插件之前调用一次 `prepareInstalledPlugins`，得到的集合在进程生命期内不变：项目子进程与浏览器引导都用它，
 * 不再自己读登记表，所以同一次运行中后来打开的作品与窗口看到的集合相同。
 *
 * 持登记表的写入锁按顺序做两件事：先按登记表完成卸载中的删除与待切换版本的切换（切换的提交点是登记表改指新版本），
 * 再回收没有被 `version` 或 `pendingVersion` 引用的版本目录与 `.staging` 残留。别的进程（命令行的安装）正在准备的复制
 * 带着自己的锁，回收时跳过。删除失败只记诊断，下次启动重试。登记表读不了时不加载任何第三方插件，也不动任何文件：不知道
 * 哪些目录还被引用。拿不到锁时（别的进程长时间占着）只读不改。
 *
 * 一个状态根只跑一个服务端（runtime.server-host 的实例认领），这里删改的目录不会有别的服务端在用；运行中的服务端只用登记表
 * 里的 `version`，它只在这里改，所以运行期间命令行的安装、卸载也碰不到在用的目录。
 */

import {readdir, rm, rmdir, unlink} from "node:fs/promises";
import {join} from "node:path";

import {errno, lockHeld} from "@notnotype/nb-file-lock";
import type {HeldLock} from "@notnotype/nb-file-lock";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {descriptorOf} from "@notnotype/nb-runtime/plugin-manifest";
import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

import type {NotLoaded} from "nbook/plugin-platform/shared/types";
import type {PlatformProfile} from "nbook/plugin-platform/shared/profile";
import {engineAccepts, engineMismatch} from "nbook/plugin-platform/shared/versions";

import type {InstalledPlugin} from "./installed";
import {assertHeld, brief, byId, isLink, isRecordTemporary, ownedPath, readRecord, STAGING_DIR, withRecordLock, writeRecord} from "./record";
import type {PluginRecord, RecordEntry} from "./record";
import {directoryDigest, installedManifest, missingEntries} from "./version-dir";


/** 本次启动时一个第三方插件的情况。 */
export interface StartupPlugin {
    readonly id: string;
    readonly version: string;
    readonly state: RecordEntry["state"];
    /** 登记了的插件的描述；禁用、卸载中、没有登记的为 null。 */
    readonly descriptor: PluginDescriptor | null;
    /** 登记了的插件的安装信息（装载入口代码、文件端点用）；没有登记的为 null。 */
    readonly installed: InstalledPlugin | null;
    /** 没有登记（或只登记了顶层声明）的原因。 */
    readonly notLoaded: NotLoaded | null;
}

export interface StartupPlugins {
    readonly safeMode: boolean;
    /** 登记表读不了时的说明；此时没有第三方插件。 */
    readonly registryProblem: string | null;
    /** 登记表里的每个插件，按 id 排序。 */
    readonly plugins: ReadonlyArray<StartupPlugin>;
}

/** 安全模式的开关（plugin-install 的“输入与前置条件”）：档案里的环境变量值为 `1` 时本次启动不加载任何第三方插件。 */
export function safeModeOf(env: Readonly<Record<string, string | undefined>>, profile: PlatformProfile): boolean {
    return env[profile.safeModeEnv] === "1";
}

/** 测试与不读安装目录的宿主用：没有第三方插件。 */
export const NO_INSTALLED_PLUGINS: StartupPlugins = {safeMode: false, registryProblem: null, plugins: []};

/** 不读安装目录的宿主用：没有第三方插件、没有要交的诊断。 */
export const NO_PREPARED_PLUGINS: PluginsPreparation = {startup: NO_INSTALLED_PLUGINS, connectDiagnostics: () => undefined};

/** 本次运行登记的第三方插件描述。 */
export function loadedDescriptors(startup: StartupPlugins): PluginDescriptor[] {
    return startup.plugins.flatMap((plugin) => (plugin.descriptor === null ? [] : [plugin.descriptor]));
}

export interface PrepareOptions {
    /** `<State Root>/plugins`。 */
    readonly root: string;
    readonly profile: PlatformProfile;
    readonly safeMode: boolean;
}

export interface PluginsPreparation {
    readonly startup: StartupPlugins;
    /** 接上宿主的诊断存储，交出准备期间的记录（准备在存储建立之前进行）。只接一次。 */
    connectDiagnostics(record: (input: DiagnosticInput) => void): void;
}

/** 本次登记的第三方插件的安装信息。 */
export function installedPlugins(startup: StartupPlugins): InstalledPlugin[] {
    return startup.plugins.flatMap((plugin) => (plugin.installed === null ? [] : [plugin.installed]));
}

/** 诊断先存着，接上宿主的存储后一并交出，之后的直接转交。 */
function diagnosticSink(): {readonly emit: (input: DiagnosticInput) => void; readonly connect: (record: (input: DiagnosticInput) => void) => void} {
    const buffered: DiagnosticInput[] = [];
    let sink: ((input: DiagnosticInput) => void) | null = null;
    return {
        emit: (input) => {
            if (sink === null) buffered.push(input);
            else sink(input);
        },
        connect: (record) => {
            sink = record;
            for (const input of buffered.splice(0)) record(input);
        },
    };
}

export async function prepareInstalledPlugins(options: PrepareOptions): Promise<PluginsPreparation> {
    const diagnostics = diagnosticSink();
    const warn = (event: string, message: string, data?: unknown, error?: unknown): void => {
        diagnostics.emit({level: "warn", event, message, ...(data === undefined ? {} : {data}), ...(error === undefined ? {} : {error})});
    };
    const info = (event: string, message: string, data: unknown): void => {
        diagnostics.emit({level: "info", event, message, data});
    };

    const applied = await withRecordLock(options.root, (event, error) => warn(`plugins.${event}`, "插件登记表的写入锁出错", undefined, error), async (lock) => {
        const read = await readRecord(options.root, options.profile);
        if (!read.ok) return read;
        const record = await applyPending(options.root, read.record, lock, info, warn);
        await reclaim(options.root, record, lock, warn).catch((error: unknown) => warn("plugins.cleanup.failed", "回收插件目录的残留没有完成，下次启动重试", undefined, error));
        return {ok: true as const, record};
    });
    let record: PluginRecord;
    if (applied.ok) {
        if (!applied.value.ok) return failed(options, applied.value.detail, diagnostics.connect, warn);
        record = applied.value.record;
    } else {
        warn("plugins.startup.unlocked", "拿不到插件登记表的写入锁，本次启动不处理待生效变化、不回收残留", {detail: applied.detail});
        const read = await readRecord(options.root, options.profile);
        if (!read.ok) return failed(options, read.detail, diagnostics.connect, warn);
        record = read.record;
    }

    const plugins: StartupPlugin[] = [];
    for (const [id, entry] of Object.entries(record.plugins)) {
        const plugin = await startupPlugin(options, id, entry);
        if (plugin.notLoaded !== null && plugin.notLoaded.code !== "safe-mode") {
            warn("plugins.startup.not-loaded", `第三方插件 ${id}@${entry.version} 没有完整登记`, {id, version: entry.version, ...plugin.notLoaded});
        }
        plugins.push(plugin);
    }
    return {startup: {safeMode: options.safeMode, registryProblem: null, plugins: plugins.sort(byId)}, connectDiagnostics: diagnostics.connect};
}

function failed(options: PrepareOptions, detail: string, connectDiagnostics: PluginsPreparation["connectDiagnostics"], warn: (event: string, message: string, data?: unknown) => void): PluginsPreparation {
    warn("plugins.registry.invalid", "插件登记表不可用，本次启动不加载任何第三方插件", {detail});
    return {startup: {safeMode: options.safeMode, registryProblem: detail, plugins: []}, connectDiagnostics};
}

/**
 * 完成卸载中的删除与待切换版本的切换，返回提交后的登记表。登记表写不进去（或中途失去了锁）时返回原表：切换没有
 * 提交，本次仍按旧版本；已删除的卸载目录在下次启动时再确认并移除记录。每次删除之前核对仍持有锁。
 */
async function applyPending(
    root: string,
    record: PluginRecord,
    lock: HeldLock,
    info: (event: string, message: string, data: unknown) => void,
    warn: (event: string, message: string, data?: unknown, error?: unknown) => void,
): Promise<PluginRecord> {
    const plugins: Record<string, RecordEntry> = {...record.plugins};
    const done: Array<() => void> = [];
    try {
        for (const [id, entry] of Object.entries(record.plugins)) {
            if (entry.state === "uninstalling") {
                await assertHeld(lock);
                try {
                    // 私有数据的删除（`deleteData`）本轮没有入口，总是保留。
                    await rm(ownedPath(root, id), {recursive: true, force: true});
                } catch (error) {
                    warn("plugins.uninstall.failed", `删除 ${id} 的安装目录失败，下次启动重试`, {id}, error);
                    continue;
                }
                delete plugins[id];
                done.push(() => info("plugins.uninstall.completed", `已卸载 ${id}`, {id, version: entry.version}));
            } else if (entry.pendingVersion !== null) {
                plugins[id] = {...entry, version: entry.pendingVersion, pendingVersion: null};
                done.push(() => info("plugins.upgrade.switched", `${id} 已切换到 ${entry.pendingVersion}`, {id, from: entry.version, to: entry.pendingVersion}));
            }
        }
        if (done.length === 0) return record;
        await writeRecord(root, {...record, plugins}, lock);
    } catch (error) {
        warn("plugins.startup.commit-failed", "处理待生效变化没有完成，留到下次启动", undefined, error);
        // 卸载中的插件本次照样不加载：它们的目录可能已经删了。
        return record;
    }
    for (const report of done) report();
    return {...record, plugins};
}

/** 回收没有被引用的版本目录、没有记录的插件目录、写登记表留下的临时文件与没有持锁的准备目录。 */
async function reclaim(
    root: string,
    record: PluginRecord,
    lock: HeldLock,
    warn: (event: string, message: string, data?: unknown, error?: unknown) => void,
): Promise<void> {
    // 失去锁时 `assertHeld` 抛出，整个回收停下：手里的登记表可能已经过时。
    const remove = async (path: string, recursive: boolean): Promise<void> => {
        await assertHeld(lock);
        try {
            if (recursive) await rm(path, {recursive: true, force: true});
            else await unlink(path);
        } catch (error) {
            warn("plugins.cleanup.failed", "回收插件目录的残留失败，下次启动重试", {path}, error);
        }
    };
    for (const {name, directory} of await entriesIn(root)) {
        if (isRecordTemporary(name)) {
            await remove(join(root, name), false);
            continue;
        }
        // 插件目录都是以 id 命名的目录；登记表、它的锁、准备目录与别的文件都不是。
        if (!directory || name.startsWith(".")) continue;
        const entry = record.plugins[name];
        // 卸载中的目录由下一次成功的卸载删除；它的版本都还算被引用。
        if (entry?.state === "uninstalling") continue;
        for (const version of await namesIn(join(root, name))) {
            if (version === entry?.version || version === entry?.pendingVersion) continue;
            await remove(ownedPath(root, name, version), true);
        }
        // 没有登记的插件：版本目录都删了，插件目录也删；删不掉的版本留着时 ENOTEMPTY 不算失败。
        if (entry === undefined) {
            await assertHeld(lock);
            await rmdir(ownedPath(root, name)).catch((error: unknown) => {
                if (errno(error) !== "ENOTEMPTY" && errno(error) !== "EEXIST" && errno(error) !== "ENOENT") warn("plugins.cleanup.failed", "回收插件目录的残留失败，下次启动重试", {path: ownedPath(root, name)}, error);
            });
        }
    }
    const staging = join(root, STAGING_DIR);
    if (await isLink(staging)) {
        warn("plugins.cleanup.skipped", "准备目录是符号链接，不回收其中的残留", {path: staging});
        return;
    }
    for (const name of await namesIn(staging)) {
        if (name.endsWith(".lock")) continue;
        const lockPath = join(staging, `${name}.lock`);
        let held: boolean;
        try {
            held = await lockHeld(lockPath);
        } catch (error) {
            warn("plugins.cleanup.failed", "核对准备目录的锁失败，跳过", {path: join(staging, name)}, error);
            continue;
        }
        if (!held) await remove(ownedPath(root, STAGING_DIR, name), true);
    }
}

async function namesIn(directory: string): Promise<string[]> {
    return (await entriesIn(directory)).map((entry) => entry.name);
}

async function entriesIn(directory: string): Promise<Array<{readonly name: string; readonly directory: boolean}>> {
    try {
        return (await readdir(directory, {withFileTypes: true})).map((entry) => ({name: entry.name, directory: entry.isDirectory()}));
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return [];
        throw error;
    }
}

/**
 * 不改任何文件，算出下一次启动会是什么样：待切换的版本按已切换算，卸载中的不算。没有运行中的服务端时，应用的命令行拿它列插件
 * （登记表是目标状态，“本次启动”就是下一次启动），离线也能给出不登记的原因。不取登记表锁：只读，读者只会读到完整的表。
 */
export async function previewInstalledPlugins(options: PrepareOptions): Promise<StartupPlugins> {
    const read = await readRecord(options.root, options.profile);
    if (!read.ok) return {safeMode: options.safeMode, registryProblem: read.detail, plugins: []};
    const plugins: StartupPlugin[] = [];
    for (const [id, entry] of Object.entries(read.record.plugins)) {
        if (entry.state === "uninstalling") continue;
        plugins.push(await startupPlugin(options, id, entry.pendingVersion === null ? entry : {...entry, version: entry.pendingVersion, pendingVersion: null}));
    }
    return {safeMode: options.safeMode, registryProblem: null, plugins: plugins.sort(byId)};
}

/** 一个已安装插件在本次启动的情况：读清单、核对与登记表一致、兼容、入口文件都在。 */
async function startupPlugin(options: PrepareOptions, id: string, entry: RecordEntry): Promise<StartupPlugin> {
    const base = {id, version: entry.version, state: entry.state, installed: null};
    if (entry.state !== "enabled") return {...base, descriptor: null, notLoaded: null};
    if (options.safeMode) return {...base, descriptor: null, notLoaded: {code: "safe-mode", detail: "安全模式下不加载第三方插件"}};
    const read = await installedManifest(join(options.root, id, entry.version), options.profile.format);
    if (!read.ok) return {...base, descriptor: null, notLoaded: {code: "manifest-invalid", detail: read.detail}};
    const {manifest} = read;
    if (manifest.id !== id || manifest.version !== entry.version) {
        return {...base, descriptor: null, notLoaded: {code: "manifest-invalid", detail: `清单声明的是 ${manifest.id}@${manifest.version}`}};
    }
    if (!engineAccepts(options.profile, manifest.engine)) {
        return {...base, descriptor: null, notLoaded: {code: "incompatible-engine", detail: engineMismatch(options.profile, manifest.engine)}};
    }
    const missing = await missingEntries(join(options.root, id, entry.version), manifest);
    if (missing.length > 0) return {...base, descriptor: null, notLoaded: {code: "entry-missing", detail: `入口文件不存在：${missing.join("、")}`}};
    const root = join(options.root, id, entry.version);
    let digest: string;
    try {
        digest = await directoryDigest(root);
    } catch (error) {
        return {...base, descriptor: null, notLoaded: {code: "unreadable", detail: `读不了安装目录：${brief(error)}`}};
    }
    return {...base, descriptor: descriptorOf(manifest), installed: {id, version: entry.version, root, digest, manifest: read.raw}, notLoaded: null};
}
