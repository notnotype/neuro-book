/**
 * “Profile”页的包装（docs/specs/agent/profile-settings.md）：页面组件只吃普通的属性，能在 Lab 里直接摆；这里取目录与模型快照、算视图，把
 * 改动写回用户层，写失败交给窗口通知。做法同 `permission-page.ts`。
 */

import {computed, defineComponent, h, onBeforeUnmount, onMounted, shallowRef} from "vue";
import type {Component, PropType, ShallowRef} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {ModelsSnapshot} from "nbook/plugins/models/shared/contracts";
import {builtinPluginNameRef} from "nbook/plugins/plugins/shared/contracts";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {TextResolver} from "nbook/shared/localized-text";
import type {SettingDefinition, SettingsService, SettingWriteResult} from "nbook/shared/settings";
import {settingsFailureText} from "nbook/ui/settings/setting-text";

import type {ProfileEntry, ToolCatalogEntry} from "../shared/contracts";
import type {agentSessionsContract} from "../shared/remote";
import {agentSettings} from "../shared/settings";
import type {ProfileSetting} from "../shared/settings";
import type {ToolBinding} from "../shared/profile-tools";
import {agentText} from "../shared/text";
import {profileViews, withApprovalChoice, withModelChoice} from "./profile-view";
import {createSettingWriter} from "./setting-writes";
import type {SettingWriter} from "./setting-writes";

/** 窗口里只有一份：连点、两个 Profile 都走同一个队。 */
export interface ProfileWriters {
    readonly bindings: SettingWriter<Record<string, ToolBinding>>;
    readonly settings: SettingWriter<Record<string, ProfileSetting>>;
}

export function createProfileWriters(settings: SettingsService): ProfileWriters {
    return {
        bindings: createSettingWriter(settings, agentSettings.settings.toolBindings) as unknown as SettingWriter<Record<string, ToolBinding>>,
        settings: createSettingWriter(settings, agentSettings.settings.profileSettings),
    };
}

/**
 * 写到一半时页面照着刚改的显示（配置服务写成功才更新快照）：排队的每一步都在上一步的结果上算，队列清空后回到配置服务的值，写失败时
 * 也就回到了实际值。
 */
function pendingEdits<T>(settings: SettingsService, setting: SettingDefinition<T>, writer: SettingWriter<T>) {
    const editing = shallowRef<T | null>(null);
    let writing = 0;
    const value = (): T => editing.value ?? (settings.get(setting) as T);
    return {
        value,
        apply: async (change: (current: T) => T): Promise<SettingWriteResult> => {
            editing.value = change(value());
            writing += 1;
            const result = await writer.edit(change);
            writing -= 1;
            if (writing === 0) editing.value = null;
            return result;
        },
    };
}

export interface ProfilePageDeps {
    readonly settings: SettingsService;
    readonly remote: Pick<RemoteClient<typeof agentSessionsContract>, "profiles" | "toolCatalog" | "createUserProfile" | "deleteUserProfile" | "events">;
    /** 第三方插件的显示名（`nbook.plugins` 的 `list`）；取不到时交回空表。 */
    readonly pluginNames: () => Promise<ReadonlyMap<string, string>>;
    readonly models: {
        readonly snapshot: Readonly<ShallowRef<ModelsSnapshot | null>>;
        readonly failed: Readonly<ShallowRef<boolean>>;
        ensure(): void;
    };
    readonly writers: ProfileWriters;
    readonly text: TextResolver;
    readonly openAddress: (address: string) => void;
    readonly report: (code: string, message: string) => void;
}

export function profilesPage(component: Component, deps: ProfilePageDeps): Component {
    return defineComponent({
        name: "ProfileSettingsPageHost",
        props: {context: {type: Object as PropType<SettingsPageContext>, required: true}},
        setup: (props) => {
            const state = shallowRef<"loading" | "ready" | {failed: string}>("loading");
            const entries = shallowRef<readonly ProfileEntry[]>([]);
            const catalog = shallowRef<readonly ToolCatalogEntry[]>([]);
            const pluginNames = shallowRef<ReadonlyMap<string, string>>(new Map());
            const settingEdits = pendingEdits(deps.settings, agentSettings.settings.profileSettings, deps.writers.settings);

            /** 事件可能接连来：只认最后一次请求的结果，晚到的旧列表不盖新的。 */
            let sequence = 0;
            const load = async (): Promise<void> => {
                const mine = (sequence += 1);
                const [listed, tools] = await Promise.all([deps.remote.profiles({}), deps.remote.toolCatalog({})]);
                if (mine !== sequence) return;
                if (!listed.ok || !tools.ok) {
                    const code = listed.ok ? (tools as {readonly code: string}).code : listed.code;
                    deps.report("profiles-failed", code);
                    // 已经显示着的留着：重取失败不把页面换成失败态。
                    if (state.value !== "ready") state.value = {failed: code};
                    return;
                }
                entries.value = listed.value;
                catalog.value = tools.value;
                state.value = "ready";
            };

            let release: (() => void) | null = null;
            let unmounted = false;
            onMounted(async () => {
                deps.models.ensure();
                void deps.pluginNames().then((names) => {
                    pluginNames.value = names;
                });
                // 先订阅、再取：两步之间的变化不会漏（sessions.md 输出 17）。
                const subscription = await deps.remote.events.profileCatalogChanged.subscribe({}, () => void load(), {onResync: () => void load()});
                if (subscription.ok) {
                    if (unmounted) subscription.value.release();
                    else release = () => subscription.value.release();
                } else deps.report("profile-catalog-subscribe-failed", subscription.code);
                await load();
            });
            onBeforeUnmount(() => {
                unmounted = true;
                release?.();
            });

            const reportIfFailed = (result: SettingWriteResult): void => {
                if (result.ok) return;
                props.context.reportWriteFailure(deps.text.t(agentText("profiles.notSaved")), {reason: settingsFailureText(result.code, result.detail, deps.text), uncertain: result.code === "unknown-outcome"});
            };
            const pluginName = (plugin: string): string => {
                const named = pluginNames.value.get(plugin);
                if (named !== undefined) return named;
                const builtin = builtinPluginNameRef(plugin);
                return builtin === null ? plugin : deps.text.t(builtin);
            };
            const views = computed(() => profileViews({
                profiles: entries.value,
                settings: settingEdits.value(),
                snapshot: deps.models.snapshot.value,
                modelsFailed: deps.models.failed.value,
                pluginName,
                text: deps.text,
            }));

            return () => h(component, {
                state: state.value,
                profiles: views.value,
                writable: props.context.writable.value,
                onRetry: () => {
                    state.value = "loading";
                    void load();
                },
                onModel: (key: string, value: string) => void settingEdits.apply((current) => withModelChoice(current, key, value)).then(reportIfFailed),
                onApproval: (key: string, value: string) => void settingEdits.apply((current) => withApprovalChoice(current, key, value)).then(reportIfFailed),
                onOpenFile: (key: string) => deps.openAddress(`user://profiles/${key.replace(/^user\./u, "")}.profile.tsx`),
            });
        },
    });
}
