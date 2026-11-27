/**
 * 设置窗口的局部宿主：产品里同一个配置实例（`shared/instance.ts`）、分区与选项提供者的注册表、窗口数据来源与窗口模型，
 * 配置层换成内存里的拥有者（`memory-layers.ts`），page 分区与选项提供者的交付由场景按句柄发布、撤回，入口状态与激活事件
 * 由场景给出，触发激活事件时交给场景处理（例如收到后交付）。场景之间互不影响，卸载时一起释放。Lab 与设置窗口的组件测试共用。
 */

import type {TextPort} from "@notnotype/nb-ui/text-port";
import {ref} from "vue";
import type {Component, MaybeRefOrGetter} from "vue";

import type {OptionSource} from "@notnotype/nb-form";

import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import type {ContributionDescriptor, ContributionHandle, EntryState, RevokeReason, TriggerActivationResult} from "@notnotype/nb-runtime/plugins";

import {SETTINGS_CHOICES_POINT, SETTINGS_PAGES_POINT, SETTINGS_SECTIONS_POINT} from "nbook/plugins/settings/shared/contracts";
import type {SettingsChoicesDeclaration, SettingsPageDeclaration, SettingsSectionDeclaration} from "nbook/plugins/settings/shared/contracts";
import {createSettingsInstance} from "nbook/plugins/settings/shared/instance";
import {completeSectionDeclaration} from "nbook/plugins/settings/shared/sections";
import type {WrittenSettingsSectionDeclaration} from "nbook/plugins/settings/shared/sections";
import {acceptedSettingOf} from "nbook/plugins/settings/shared/point";
import type {SettingsInstance} from "nbook/plugins/settings/shared/instance";
import type {AcceptedSetting} from "nbook/plugins/settings/shared/layers";
import {settingsCatalogs} from "nbook/plugins/settings/web/text";
import {workbenchCatalogs} from "nbook/plugins/workbench/web/text";
import {ChoiceSourceRegistry} from "nbook/plugins/settings/web/choices";
import type {SettingsChoicesImplementation, SettingsPageImplementation} from "nbook/plugins/settings/web/contracts";
import {SettingsSectionRegistry} from "nbook/plugins/settings/web/sections";
import {createSettingsWindow} from "nbook/plugins/settings/web/settings-window";
import type {SettingsWindow, SettingsWindowSize} from "nbook/plugins/settings/web/settings-window";
import {choiceReferences, createSettingsWindowSource} from "nbook/plugins/settings/web/window-source";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import type {WindowPluginRetry, WindowPlugins} from "nbook/shared/host";
import {resolverFor} from "nbook/shared/localized-text";
import type {DisplayLocale} from "nbook/shared/localized-text";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import {createHostTextEngine} from "nbook/web/host/text-engine";

import {memoryConnection, memoryLayer} from "./memory-layers";
import type {MemoryLayer} from "./memory-layers";

/** 一层的初始内容。 */
export interface HostLayer {
    readonly values?: Readonly<Record<string, unknown>>;
    readonly invalid?: string;
    readonly unreachable?: boolean;
    readonly path?: string;
    /** 文件文本；缺省由 `values` 写成。 */
    readonly text?: string;
}

/** 场景里的分区：list 来自 `settings.sections`，page 来自 `settings.pages`。 */
export type HostSection =
    | {readonly id: string; readonly plugin: string; readonly kind: "list"; readonly declaration: WrittenSettingsSectionDeclaration}
    | {readonly id: string; readonly plugin: string; readonly kind: "page"; readonly declaration: SettingsPageDeclaration};

export interface SettingsHostOptions {
    /** 已接受的配置项：声明者插件与定义。 */
    readonly settings: ReadonlyArray<{readonly plugin: string; readonly definition: SettingDefinition<unknown>}>;
    readonly sections: ReadonlyArray<HostSection>;
    /** 选项提供者：id 与贡献它的插件（贡献在插件的 `browser` 入口上）。 */
    readonly choices?: ReadonlyArray<{readonly id: string; readonly plugin: string}>;
    /** 各插件 `browser` 入口声明的激活事件；没给的插件不声明。 */
    readonly activationEvents?: Readonly<Record<string, ReadonlyArray<string>>>;
    readonly user?: HostLayer;
    /** 给了就是绑定作品的窗口。 */
    readonly project?: HostLayer;
    readonly projectTitle?: string;
    readonly locale?: DisplayLocale;
    /** 翻译端口严格模式：缺键、缺插值参数抛错（组件测试用）。 */
    readonly strict?: boolean;
    readonly notify: (input: NotificationInput) => void;
    readonly report: (message: string) => void;
}

/** 入口的状态：场景直接给出，交付状态从它与句柄算出。 */
export type HostEntryStatus = "registered" | "activating" | "blocked" | "failed" | "available";

export interface SettingsHost {
    readonly window: SettingsWindow;
    readonly instance: SettingsInstance;
    readonly user: MemoryLayer;
    readonly project: MemoryLayer | null;
    /** 窗口与它里面的零件共用的翻译端口：宿主引擎加 `nbook.settings` 的目录；夹具和测试把它注入后代组件。 */
    readonly text: TextPort;
    /** 按插件取配置服务（页面用自己插件的）。 */
    service(plugin: string): SettingsService;
    /** 交付一个 page 分区的实现：入口转为可用，句柄发布；已有句柄时先撤回它（入口换了一代）。 */
    publish(sectionId: string, load: () => Promise<Component>): void;
    /** 撤回已交付的实现。 */
    revoke(sectionId: string, reason: RevokeReason): void;
    /** 分区所属入口的状态（没有句柄时决定交付状态）。 */
    entry(sectionId: string, status: HostEntryStatus, reason?: string): void;
    /** 插件 `browser` 入口的状态（选项提供者按它所属的插件给）。 */
    pluginEntry(plugin: string, status: HostEntryStatus, reason?: string): void;
    /** 交付一个选项提供者：入口转为可用，句柄发布；已有句柄时先撤回它。 */
    publishChoices(providerId: string, source: () => MaybeRefOrGetter<OptionSource<string>>): void;
    revokeChoices(providerId: string): void;
    /** 窗口触发激活事件时调用；缺省什么都不做。 */
    onTrigger(handler: (event: string) => void): void;
    /** “重试”时要做的事；缺省什么都不做、报告失败。 */
    onRetry(handler: (sectionId: string) => Promise<WindowPluginRetry>): void;
    dispose(): void;
}

const consumer = (plugin: string): ConsumerIdentity => ({instanceId: "lab", location: "browser", client: "lab", plugin, entry: "browser", generation: 1, via: null});

export function createSettingsHost(options: SettingsHostOptions): SettingsHost {
    // Lab 不经插件宿主登记：照登记时那样补全并校验（`acceptedSettingOf`），与产品里经登记得到的声明相同。
    const declarations = new Map<string, AcceptedSetting>(options.settings.map((setting) => [setting.definition.key, acceptedSettingOf(setting.plugin, setting.definition)]));
    const connection = memoryConnection();
    const user = memoryLayer({layer: "user", declarations, connection, ...options.user});
    const project = options.project === undefined ? null : memoryLayer({layer: "project", declarations, connection, ...options.project});
    const instance = createSettingsInstance({
        layers: {user: user.link, ...(project === null ? {} : {project: project.link})},
        declarations,
        clock: systemClock,
        firstSnapshotMs: 3_000,
        connection: connection.connection,
        record: (_level, _event, message) => options.report(message),
    });

    // page 分区所属入口的状态与“重试”。
    const states = new Map<string, EntryState>();
    const listeners = new Set<() => void>();
    let retry: (sectionId: string) => Promise<WindowPluginRetry> = async () => ({status: "failed", reason: "场景没有给重试"});
    let onTrigger: (event: string) => void = () => undefined;
    const sectionOf = new Map(options.sections.map((section) => [section.plugin, section.id]));
    const plugins: WindowPlugins = {
        entryState: (ref) => states.get(ref.plugin) ?? null,
        onChange: (listener) => {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
        retry: (ref) => retry(sectionOf.get(ref.plugin) ?? ""),
        activationEvents: (ref) => options.activationEvents?.[ref.plugin] ?? [],
        // 场景里的插件没有问题可报：设置窗口不读它，插件页的场景另给数据。
        problems: () => [],
    };
    const changed = (): void => {
        for (const listener of [...listeners]) listener();
    };

    const abort = new AbortController();
    // 同产品：list 分区是顶层声明（没有入口），page 分区是浏览器入口的贡献。
    // 省略的标题在产品里由贡献点补成约定键；局部宿主不经内核，自己补。
    const lists: ContributionDescriptor<SettingsSectionDeclaration>[] = options.sections.flatMap((section) => {
        if (section.kind !== "list") return [];
        const written = {capability: SETTINGS_SECTIONS_POINT, id: section.id, plugin: section.plugin, entry: null, location: "browser", declaration: section.declaration} as const;
        return [{...written, declaration: completeSectionDeclaration(written) as SettingsSectionDeclaration}];
    });
    const pages: ContributionDescriptor<SettingsPageDeclaration>[] = options.sections.flatMap((section) => section.kind === "page" ? [{capability: SETTINGS_PAGES_POINT, id: section.id, plugin: section.plugin, entry: "browser", location: "browser", declaration: section.declaration}] : []);
    // 触发激活事件交给场景；内核的“已触发”结果在这里只用作诊断，场景自己决定交付。
    const trigger = async (event: string): Promise<TriggerActivationResult> => {
        onTrigger(event);
        return {status: "triggered", event: event as TriggerActivationResult["event"], results: []};
    };
    const registry = new SettingsSectionRegistry(lists, pages, plugins, options.report, abort.signal, trigger);
    const receiver = registry.receiver();
    const providers: ContributionDescriptor<SettingsChoicesDeclaration>[] = (options.choices ?? []).map((choice) => ({capability: SETTINGS_CHOICES_POINT, id: choice.id, plugin: choice.plugin, entry: "browser", location: "browser", declaration: {}}));
    const choices = new ChoiceSourceRegistry(providers, choiceReferences(declarations), plugins, options.report, abort.signal, trigger);
    const choiceReceiver = choices.receiver();
    const choiceHandles = new Map<string, ContributionHandle<SettingsChoicesDeclaration, SettingsChoicesImplementation> & {published: boolean}>();
    const handles = new Map<string, ContributionHandle<SettingsPageDeclaration, SettingsPageImplementation> & {published: boolean}>();
    let generation = 0;

    const source = createSettingsWindowSource({
        sections: registry,
        choices,
        declarations,
        editors: {user: user.editor, ...(project === null ? {} : {project: project.editor})},
        files: {user: user.file, ...(project === null ? {} : {project: project.file})},
        instance,
    });
    const facades = new Map<string, SettingsService>();
    const service = (plugin: string): SettingsService => {
        let found = facades.get(plugin);
        if (found === undefined) {
            found = instance.facade(consumer(plugin)).service;
            facades.set(plugin, found);
        }
        return found;
    };
    const size = ref<SettingsWindowSize | null>(null);
    const locale = ref(options.locale ?? "zh-CN");
    const engine = createHostTextEngine({locale: locale.value, ...(options.strict === true ? {strict: true} : {})});
    engine.register("nbook.settings", settingsCatalogs.catalogs, settingsCatalogs.source);
    // 场景里的主题、明暗两项是 nbook.workbench 的配置项，标题与选项的文字在它的目录里。
    engine.register("nbook.workbench", workbenchCatalogs.catalogs, workbenchCatalogs.source);
    const settingsWindow = createSettingsWindow({
        source,
        settings: service("nbook.settings"),
        bound: project !== null,
        projectTitle: project === null ? null : options.projectTitle ?? null,
        locale,
        text: resolverFor(() => locale.value, engine.port),
        size: {remembered: size, remember: (next) => {
            size.value = next;
        }},
        notify: options.notify,
        report: options.report,
    });

    const setEntry = (plugin: string, status: EntryState["status"], reason: string | null): void => {
        states.set(plugin, {
            plugin,
            entry: "browser",
            location: "browser",
            status,
            generation: null,
            scopeId: null,
            failure: status === "failed" ? {status: "failed", plugin, entry: "browser", generation: 1, stage: "activate", reason: "activation-threw", capability: null, contribution: null, key: null, error: {name: "Error", message: reason ?? "激活失败"}, path: []} : null,
            blocked: status === "blocked" ? {reason: "missing-service", key: reason ?? "", path: []} : null,
            closeout: null,
        });
        changed();
    };

    const revokeChoices = (providerId: string): void => {
        const handle = choiceHandles.get(providerId);
        if (handle === undefined) return;
        handle.published = false;
        choiceHandles.delete(providerId);
        choiceReceiver.revoke(handle);
    };

    const revoke = (sectionId: string, reason: RevokeReason): void => {
        const handle = handles.get(sectionId);
        if (handle === undefined) return;
        handle.published = false;
        handles.delete(sectionId);
        receiver.revoke?.(handle, undefined, reason);
    };

    return {
        window: settingsWindow,
        instance,
        user,
        project,
        text: engine.port,
        service,
        publish: (sectionId, load) => {
            const section = options.sections.find((candidate) => candidate.id === sectionId);
            if (section?.kind !== "page") throw new Error(`场景没有 page 分区 ${sectionId}`);
            revoke(sectionId, "scope-closed");
            setEntry(section.plugin, "available", null);
            generation += 1;
            const implementation: SettingsPageImplementation = {load};
            const handle = {capability: SETTINGS_PAGES_POINT, id: sectionId, plugin: section.plugin, entry: "browser", generation, kind: "entry" as const, declaration: section.declaration, published: true, implementation: () => {
                if (!handle.published) throw new Error("句柄已撤回");
                return implementation;
            }};
            handles.set(sectionId, handle);
            receiver.published?.(handle, undefined);
        },
        revoke,
        entry: (sectionId, status, reason) => {
            const section = options.sections.find((candidate) => candidate.id === sectionId);
            if (section !== undefined) setEntry(section.plugin, status, reason ?? null);
        },
        onRetry: (handler) => {
            retry = handler;
        },
        pluginEntry: (plugin, status, reason) => setEntry(plugin, status, reason ?? null),
        publishChoices: (providerId, source) => {
            const provider = options.choices?.find((candidate) => candidate.id === providerId);
            if (provider === undefined) throw new Error(`场景没有选项提供者 ${providerId}`);
            revokeChoices(providerId);
            setEntry(provider.plugin, "available", null);
            generation += 1;
            const implementation: SettingsChoicesImplementation = {source};
            const handle = {capability: SETTINGS_CHOICES_POINT, id: providerId, plugin: provider.plugin, entry: "browser", generation, kind: "entry" as const, declaration: {}, published: true, implementation: () => {
                if (!handle.published) throw new Error("句柄已撤回");
                return implementation;
            }};
            choiceHandles.set(providerId, handle);
            choiceReceiver.published(handle);
        },
        revokeChoices,
        onTrigger: (handler) => {
            onTrigger = handler;
        },
        dispose: () => {
            settingsWindow.dispose();
            abort.abort();
            instance.close();
        },
    };
}
