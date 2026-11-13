/**
 * `nbook plugin …`（docs/specs/runtime/cli.md 的“plugin 子命令”）：离线读写状态根的插件登记表，不经服务端。与插件页用同一套
 * 插件管理（`createPluginInventory`）与失败码；变化在服务端下一次启动生效。
 *
 * “本次启动的集合”决定列表里的待生效变化：有运行中的实例时取它 `hello` 应答里的集合，与插件页的列表一致；没有时取
 * `previewInstalledPlugins` 算出的下一次启动，此时列表就是重启后的样子，离线也能给出不登记的原因。
 */

import {appendFile, mkdir} from "node:fs/promises";
import {join, resolve} from "node:path";

import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";

import {productPlugins} from "nbook/manifest";
import {createPluginInventory} from "nbook/plugin-platform/backend/inventory";
import type {InventoryFailure, PluginInventory} from "nbook/plugin-platform/backend/inventory";
import {NO_INSTALLED_PLUGINS, previewInstalledPlugins} from "nbook/plugin-platform/backend/startup";
import type {StartupPlugins} from "nbook/plugin-platform/backend/startup";
import type {PendingChange, PluginListEntry} from "nbook/plugin-platform/shared/types";
import {NEUROBOOK_PROFILE} from "nbook/plugin-platform-profile";
import {queryNeuroBook} from "nbook/server/instance";
import type {InstanceInfo} from "nbook/server/instance";

import {CliFailure} from "./output";
import type {Output} from "./output";

export interface PluginContext {
    readonly stateRoot: string;
    readonly output: Output;
    readonly cwd: string;
}

/** 与插件页的确认框同一句话（plugin-install 输出 2.2）。 */
const TRUST = "插件完全受信任：安装后它可以访问全部作品、服务器与本机资源。只安装你信任的来源。";
const RESTART = "重启服务后生效。";

/** 运行中的实例（就绪的才有本次启动的集合）；没有、开发服务或不应答为 null。 */
async function running(stateRoot: string): Promise<InstanceInfo | null> {
    const found = await queryNeuroBook(stateRoot);
    return found.state === "running" && found.instance.plugins !== null ? found.instance : null;
}

function startupOf(instance: InstanceInfo): StartupPlugins {
    const plugins = instance.plugins!;
    return {safeMode: plugins.safeMode, registryProblem: null, plugins: plugins.items.map((item) => ({...item, descriptor: null, installed: null}))};
}

/**
 * 插件管理的诊断写进状态根的日志目录（与服务端的诊断同一种一行一个 JSON）；写不了只提示，不让命令失败。插件管理同步调用
 * `record`，写入排成一列，命令结束前 `flush` 等它们写完。
 */
function recorder(context: PluginContext): {readonly record: (input: DiagnosticInput) => void; readonly flush: () => Promise<void>} {
    const logs = join(context.stateRoot, "logs");
    let tail: Promise<void> = Promise.resolve();
    return {
        record: (input) => {
            const line = `${JSON.stringify({time: new Date().toISOString(), source: "nbook-cli", ...input, ...(input.error instanceof Error ? {error: {name: input.error.name, message: input.error.message}} : {})})}\n`;
            tail = tail
                .then(() => mkdir(logs, {recursive: true}))
                .then(() => appendFile(join(logs, "cli.jsonl"), line))
                .catch((error: unknown) => context.output.hint(`写不了日志（${error instanceof Error ? error.message : String(error)}）`));
        },
        flush: () => tail,
    };
}

interface Opened {
    readonly inventory: PluginInventory;
    readonly instance: InstanceInfo | null;
    /** 等诊断写完；命令返回前调用。 */
    readonly flush: () => Promise<void>;
}

async function inventoryFor(context: PluginContext): Promise<Opened> {
    const root = join(context.stateRoot, "plugins");
    const instance = await running(context.stateRoot);
    const startup = instance !== null ? startupOf(instance) : await previewInstalledPlugins({root, profile: NEUROBOOK_PROFILE, safeMode: false});
    const diagnostics = recorder(context);
    const inventory = createPluginInventory({
        root,
        profile: NEUROBOOK_PROFILE,
        builtin: productPlugins.map(({id, version}) => ({id, version})),
        startup: startup.registryProblem === null ? startup : NO_INSTALLED_PLUGINS,
        record: diagnostics.record,
    });
    return {inventory, instance, flush: diagnostics.flush};
}

function failed(failure: InventoryFailure): CliFailure {
    const problems = failure.problems ?? [];
    // 有逐条问题时 detail 已带着第一条，只列问题，不再重复 detail。
    if (problems.length === 0) return new CliFailure(failure.code, failure.detail, 1);
    const subject = failure.code === "catalog-invalid" ? "消息目录" : "插件清单";
    return new CliFailure(failure.code, `${subject}有 ${String(problems.length)} 处错误：\n${problems.map((problem) => `  - ${problem}`).join("\n")}`, 1, {problems});
}

const PENDING: Readonly<Record<PendingChange["kind"], string>> = {install: "重启后安装", uninstall: "重启后卸载", enable: "重启后启用", disable: "重启后禁用", upgrade: "重启后升级"};
const STATE: Readonly<Record<PluginListEntry["state"], string>> = {enabled: "已启用", disabled: "已禁用", uninstalling: "卸载中"};

function describeEntry(entry: PluginListEntry): string {
    const pending = entry.pending.map((change) => (change.kind === "upgrade" ? `${PENDING.upgrade}到 ${change.version}` : PENDING[change.kind]));
    const notes = [...pending, ...(entry.notLoaded === null ? [] : [`没有登记：${entry.notLoaded.detail || entry.notLoaded.code}`])];
    const name = entry.displayName === null ? "" : `  ${entry.displayName}`;
    return `${entry.id}@${entry.version}  ${entry.source === "builtin" ? "内置" : "第三方"}  ${STATE[entry.state]}${name}${notes.length === 0 ? "" : `  （${notes.join("；")}）`}`;
}

/** 打开插件管理，跑完 `task` 后（失败也一样）等诊断写完。 */
async function withInventory<T>(context: PluginContext, task: (opened: Opened) => Promise<T>): Promise<T> {
    const opened = await inventoryFor(context);
    try {
        return await task(opened);
    } finally {
        await opened.flush();
    }
}

export function listPlugins(context: PluginContext): Promise<void> {
    return withInventory(context, async ({inventory, instance}) => {
        const listed = await inventory.list();
        if (!listed.ok) throw failed(listed);
        if (instance !== null) context.output.hint(`服务端正在运行（pid ${String(instance.pid)}，${instance.url ?? ""}）：待生效的变化在重启服务后生效。`);
        context.output.hint(`入口激活失败等运行中的问题记在服务端的日志里：${join(context.stateRoot, "logs")}`);
        const text = [listed.value.safeMode ? "本次以安全模式启动，没有加载第三方插件。" : null, ...listed.value.plugins.map(describeEntry)].filter((line) => line !== null).join("\n");
        context.output.result(text, {safeMode: listed.value.safeMode, running: instance === null ? null : {pid: instance.pid, url: instance.url}, plugins: listed.value.plugins});
    });
}

export function installPlugin(context: PluginContext, directory: string, options: {readonly yes: boolean}): Promise<void> {
    const source = resolve(context.cwd, directory);
    return withInventory(context, async ({inventory}) => {
        const preview = await inventory.inspect(source);
        if (!preview.ok) throw withHint(failed(preview), preview.code);
        const {id, version, installed, relation, blocked, unchecked} = preview.value;
        context.output.hint(TRUST);
        const lines = [
            relation === "install" ? `安装 ${id}@${version}` : `${relation === "upgrade" ? "升级" : "降级"} ${id}：${installed ?? ""} → ${version}`,
            ...(relation === "downgrade" ? ["降级后新版本迁移过的插件数据可能读不了。"] : []),
            ...(blocked.length === 0 ? [] : ["重启后会受阻的插件：", ...blocked.map((item) => `  - ${item.plugin}（${item.entries.join("、")}）：${item.reason}${item.range === undefined ? "" : ` 要求 ${item.range}`}`)]),
            ...(unchecked.length === 0 ? [] : [`清单读不了、没有核对的插件：${unchecked.join("、")}`]),
        ];
        if ((relation === "downgrade" || blocked.length > 0) && !options.yes) {
            throw new CliFailure("confirmation-required", `${lines.join("\n")}\n要继续，加 --yes 再运行一次。`, 2, {preview: preview.value});
        }
        const done = await inventory.install(source);
        if (!done.ok) throw withHint(failed(done), done.code);
        context.output.result(`${lines.join("\n")}\n已写入 ${context.stateRoot} 的插件登记表，${RESTART}`, {preview: preview.value, plugin: done.value, stateRoot: context.stateRoot, restartRequired: true});
    });
}

/** 命令行特有的补充：作者最常撞上的两种失败，告诉他下一步。 */
function withHint(failure: CliFailure, code: string): CliFailure {
    if (code === "path-rejected") return new CliFailure(failure.code, `${failure.message}\n确认这个路径存在，并且是 nbooke build 构建出的 dist 目录。`, 1, failure.fields);
    if (code === "already-installed") return new CliFailure(failure.code, `${failure.message}\n开发中改了代码不想改版本号：用 nbooke build --dev 构建，每次得到一个更新的开发版本号。`, 1, failure.fields);
    return failure;
}

export function setPluginEnabled(context: PluginContext, id: string, enabled: boolean): Promise<void> {
    return withInventory(context, async ({inventory}) => {
        const done = await inventory.setEnabled(id, enabled);
        if (!done.ok) throw failed(done);
        context.output.result(`${id} 已${enabled ? "启用" : "禁用"}，${RESTART}`, {plugin: done.value, restartRequired: true});
    });
}

export function uninstallPlugin(context: PluginContext, id: string): Promise<void> {
    return withInventory(context, async ({inventory}) => {
        const done = await inventory.uninstall(id);
        if (!done.ok) throw failed(done);
        context.output.result(`${id} 已标记为卸载，${RESTART}插件的私有数据保留。`, {plugin: done.value, restartRequired: true});
    });
}
