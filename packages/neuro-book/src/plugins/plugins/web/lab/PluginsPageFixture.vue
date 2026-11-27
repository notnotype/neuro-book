<script setup lang="ts">
/**
 * PluginsPage 的 Lab 场景：`nbook.plugins/registry` 的客户端是内存里的插件表，按场景摆出列表的各种状态。写操作照常改这张
 * 表并记进事件 tab；安装总是预览为首次安装 `example.new`（“pending”场景预览为升级、“downgrade”场景为降级、“blocked”场景
 * 为升级并列出重启后受阻的插件）。“write-failed”场景的写操作都以带出错字段的“清单无效”失败，“busy”场景的写操作永不结算。“problems”场景摆出显示名、说明、服务端与本窗口的问题。
 * 场景名带 `-english` 的是同一场景的英文界面。
 *
 * 页面的文字来自注入的翻译端口，而 Lab 窗口的端口跟着窗口的界面语言：这里另建一个宿主引擎、登记本插件的目录，语言跟着场景的
 * `locale` 属性（属性只管列表的连接，两者要一致），只注入给场景里的页面。
 */
import {computed, watch} from "vue";

import type {InstallPreview, PluginListEntry, PluginProblem, PluginsRegistry} from "nbook/plugins/plugins/shared/contracts";
import PluginsPage from "nbook/plugins/plugins/web/components/PluginsPage.vue";
import type {FolderUploadClient} from "nbook/plugins/plugins/web/folder-upload";
import {pluginsCatalogs} from "nbook/plugins/plugins/web/text";
import {provideHostText} from "nbook/web/host/host-text";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {type LabFixtureProps, useLabEventSink, useLabSubject} from "nbook/plugins/lab/web/scene-kit";

const props = defineProps<LabFixtureProps>();
const record = useLabEventSink();
const subject = useLabSubject<typeof PluginsPage>(() => props.input, []);

const BUILTIN: PluginListEntry[] = ["nbook.commands", "nbook.editor", "nbook.explorer", "nbook.plugins", "nbook.settings", "nbook.workbench"]
    .map((id) => ({id, version: "0.1.0", source: "builtin", state: "enabled", pending: [], notLoaded: null, displayName: null, description: null, problems: []}));
const third = (id: string, version: string, extra: Partial<PluginListEntry> = {}): PluginListEntry => ({id, version, source: "third-party", state: "enabled", pending: [], notLoaded: null, displayName: null, description: null, problems: [], ...extra});

/** “problems”场景里本窗口的问题：浏览器入口缺服务受阻。 */
const WINDOW_PROBLEMS: ReadonlyArray<PluginProblem> = [{kind: "entry-blocked", plugin: "example.daily-goal", entry: "browser", location: "browser", reason: "missing-service", key: "example.daily-goal/progress"}];

/** 场景 → 第三方插件。 */
const THIRD_PARTY: Readonly<Record<string, PluginListEntry[]>> = {
    "empty": [],
    "pending": [
        third("example.gone", "1.0.0", {state: "uninstalling", pending: [{kind: "uninstall"}]}),
        third("example.hello", "1.0.0", {pending: [{kind: "upgrade", version: "1.10.0-beta.3"}]}),
        third("example.notes-lite", "0.2.0", {pending: [{kind: "install"}]}),
        third("example.quiet", "2.1.0", {state: "disabled", pending: [{kind: "disable"}]}),
        third("example.rollback", "1.2.0", {pending: [{kind: "upgrade", version: "1.1.0"}]}),
    ],
    "problems": [
        third("example.daily-goal", "0.1.0", {
            displayName: "Daily Goal",
            description: "每天写多少字，状态栏显示今天的进度；这句说明故意写得长一些，看窄的时候怎样单行截断。",
            problems: [{kind: "entry-failed", plugin: "example.daily-goal", entry: "server", location: "server", stage: "activate", reason: "activation-threw", message: "local 记录 progress 需要客户端身份，这个位置没有"}],
        }),
        third("example.hello", "1.0.0", {displayName: "Hello"}),
        third("example.typo", "1.0.0", {
            problems: [
                {kind: "contribution-rejected", plugin: "example.typo", entry: "browser", location: "browser", capability: "workbench.views", id: "other.goal", reason: "invalid-declaration", detail: "贡献 id 要以插件 id example.typo 加“.”开头：other.goal"},
                {kind: "contribution-rejected", plugin: "example.typo", entry: "server", location: "server", capability: "commands.definitions", id: "example.typo.say", reason: "duplicate-contribution", detail: null},
            ],
        }),
    ],
    "not-loaded": [
        third("example.broken", "1.0.0", {notLoaded: {code: "entry-missing", detail: "入口文件不存在：dist/browser.js"}}),
        third("example.future", "3.0.0", {notLoaded: {code: "incompatible-engine", detail: "要求 NeuroBook >=2.0.0，当前是 0.1.0"}}),
    ],
    "safe-mode": [third("example.hello", "1.0.0", {notLoaded: {code: "safe-mode", detail: ""}})],
    "long": [third("acme-really-long-publisher.an-extremely-long-plugin-name-for-overflow", "12.340.5678-beta.10", {pending: [{kind: "upgrade", version: "12.341.0-beta.10+build.20261017.sha.abcdef"}]})],
    "downgrade": [third("example.hello", "1.0.0")],
    "blocked": [third("example.reader", "1.0.0"), third("example.panel", "1.0.0"), third("example.tts", "1.0.0")],
    "english": [third("example.hello", "1.0.0", {pending: [{kind: "upgrade", version: "1.10.0-beta.3"}]})],
    "write-failed": [third("example.hello", "1.0.0")],
    "busy": [third("example.hello", "1.0.0"), third("example.quiet", "2.1.0")],
};

const PREVIEW: Readonly<Record<string, InstallPreview>> = {
    pending: {id: "example.hello", version: "1.1.0", installed: "1.0.0", relation: "upgrade", blocked: [], unchecked: []},
    downgrade: {id: "example.hello", version: "0.9.0", installed: "1.0.0", relation: "downgrade", blocked: [], unchecked: []},
    blocked: {
        id: "example.tts",
        version: "2.0.0",
        installed: "1.0.0",
        relation: "upgrade",
        blocked: [{plugin: "example.panel", entries: ["main"], reason: "provider-blocked"}, {plugin: "example.reader", entries: ["main", "ui"], reason: "version-mismatch", range: "^1.0.0"}],
        unchecked: ["example.broken"],
    },
};

/** 去掉 `-english` 后缀的场景名：英文界面的场景与中文的用同一份数据。 */
const base = props.scene.replace(/-english$/u, "");
let plugins: PluginListEntry[] = [...(THIRD_PARTY[base] ?? []), ...BUILTIN];
const set = (item: PluginListEntry): PluginListEntry => {
    // 与服务端一样按 id 排序。
    plugins = (plugins.some((plugin) => plugin.id === item.id) ? plugins.map((plugin) => (plugin.id === item.id ? item : plugin)) : [...plugins, item]).sort((left, right) => (left.id < right.id ? -1 : 1));
    return item;
};
const find = (id: string): PluginListEntry => plugins.find((plugin) => plugin.id === id)!;
/** 本窗口的问题只在“problems”场景里有；变化通知不会来。 */
const windowPlugins = base === "problems" ? {problems: () => WINDOW_PROBLEMS, onChange: () => () => undefined} : null;

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);
/** 一个方法的失败结果，取插件管理客户端的类型：失败按码区分，详情随码定型。 */
type FailureOf<Method extends keyof PluginsRegistry> = PluginsRegistry[Method] extends (...args: never[]) => Promise<infer Result> ? Extract<Result, {readonly ok: false}> : never;

/** “write-failed”“busy”场景的安装结果；其余场景为 null，照常改内存里的表。 */
const failing = (): Promise<FailureOf<"install">> | null => {
    if (base === "busy") return never();
    if (base === "write-failed") return Promise.resolve({ok: false, code: "manifest-invalid", detail: {detail: "清单有错误", problems: ["entries.ui.main：入口文件必须在插件目录里", "contributes.0.id：必须以插件 id 开头"]}});
    return null;
};
/** 启停与卸载的结果：“write-failed”是登记表写不进去，“busy”永不结算；其余场景为 null。 */
const failingManage = (): Promise<FailureOf<"enable">> | null => {
    if (base === "busy") return never();
    if (base === "write-failed") return Promise.resolve({ok: false, code: "registry-failed", detail: {detail: "写插件登记表失败：EACCES"}});
    return null;
};

// 类型标注让替身按合同客户端核对每个方法的输入与输出。
const registry: PluginsRegistry = {
    list: () => {
        record("list", {});
        // “loading”场景的读取永不结算，摆出加载指示；“failed”场景读不了登记表。
        if (props.scene === "loading") return never();
        if (props.scene === "failed") return Promise.resolve({ok: false as const, code: "registry-failed" as const, detail: {detail: "插件登记表不是合法 JSON"}});
        return Promise.resolve({ok: true as const, value: {safeMode: props.scene === "safe-mode", plugins}});
    },
    inspect: async ({path, upload}: {path?: string; upload?: string}) => {
        record("inspect", {path, upload});
        return {ok: true as const, value: PREVIEW[base] ?? {id: "example.new", version: "1.0.0", installed: null, relation: "install" as const, blocked: [], unchecked: []}};
    },
    install: async ({path, upload}: {path?: string; upload?: string}) => {
        record("install", {path, upload});
        return failing() ?? {ok: true as const, value: {plugin: set(third("example.new", "1.0.0", {pending: [{kind: "install"}]}))}};
    },
    enable: async ({id}: {id: string}) => {
        record("enable", {id});
        return failingManage() ?? {ok: true as const, value: {plugin: set({...find(id), state: "enabled", pending: []})}};
    },
    disable: async ({id}: {id: string}) => {
        record("disable", {id});
        return failingManage() ?? {ok: true as const, value: {plugin: set({...find(id), state: "disabled", pending: [{kind: "disable"}]})}};
    },
    uninstall: async ({id}: {id: string}) => {
        record("uninstall", {id});
        return failingManage() ?? {ok: true as const, value: {plugin: set({...find(id), state: "uninstalling", pending: [{kind: "uninstall"}]})}};
    },
};
/** 上传的客户端也是替身：收下文件夹、交回一个 id，并记进事件 tab；真实的请求体与路由由单元测试与 e2e 覆盖。 */
const folderUpload: FolderUploadClient = {
    upload: async (folder) => {
        record("upload", {name: folder.name, files: folder.files.length, bytes: folder.bytes});
        return base === "busy" ? never() : {ok: true as const, id: "00000000-0000-4000-8000-000000000001", files: folder.files.length, bytes: folder.bytes};
    },
    discard: async (id) => {
        record("discard", {id});
    },
};
const bindings = computed(() => subject.bindings.value);

const sceneLocale = (): string => (typeof bindings.value.locale === "string" ? bindings.value.locale : "zh-CN");
const text = createHostTextEngine({locale: sceneLocale()});
text.register("nbook.plugins", pluginsCatalogs.catalogs, pluginsCatalogs.source);
provideHostText(text.port);
// 数据面板改了 `locale` 时端口跟着换。
watch(sceneLocale, (locale) => text.setLocale(locale));
</script>

<template>
    <PluginsPage v-bind="bindings" :registry="registry" :window-plugins="windowPlugins" :folder-upload="folderUpload" data-lab-subject />
</template>
