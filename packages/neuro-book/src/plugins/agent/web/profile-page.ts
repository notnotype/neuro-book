/**
 * “Profile”页的包装（docs/specs/agent/profile-settings.md）：页面组件只吃普通的属性，能在 Lab 里直接摆；这里取目录与模型快照、算视图，把
 * 改动写回用户层，写失败交给窗口通知。做法同 `permission-page.ts`。
 */

import {computed, defineComponent, h, onBeforeUnmount, onMounted, shallowRef, watch} from "vue";
import type {Component, PropType, ShallowRef} from "vue";

import type {RemoteClient} from "@notnotype/nb-runtime/remote";

import type {ModelRow, ModelsSnapshot, SelectionRow} from "nbook/plugins/models/shared/contracts";
import {builtinPluginNameRef} from "nbook/plugins/plugins/shared/contracts";
import type {SettingsPageContext} from "nbook/plugins/settings/web/contracts";
import type {TextResolver} from "nbook/shared/localized-text";
import type {SettingDefinition, SettingsService, SettingWriteResult} from "nbook/shared/settings";
import {settingsFailureText} from "nbook/ui/settings/setting-text";

import type {ProfileEntry, ToolCatalogEntry} from "../shared/contracts";
import type {agentSessionsContract} from "../shared/remote";
import {agentSettings} from "../shared/settings";
import type {ProfileSetting, ToolBinding} from "../shared/settings";
import {changeToolBinding, userProfileAddress, withToolBinding} from "../shared/profile-tools";
import type {ToolChange} from "../shared/profile-tools";
import {agentText} from "../shared/text";
import {withAllowlistChoice, withApprovalChoice, withModelChoice} from "./profile-edits";
import {changeAgentsBinding} from "../shared/profile-agents";
import {declaredAllowlist} from "../shared/profile-allowlist";
import type {SkillsClient} from "./skills";
import type {StickerPacksClient} from "./sticker-packs";
import {objectAwareChange, profileViews, toolChangeContext} from "./profile-view";
import {createSettingWriter} from "./setting-writes";
import type {SettingWriter} from "./setting-writes";

/** 窗口里只有一份：连点、两个 Profile 都走同一个队。 */
export interface ProfileWriters {
    readonly bindings: SettingWriter<Record<string, ToolBinding>>;
    readonly settings: SettingWriter<Record<string, ProfileSetting>>;
}

export function createProfileWriters(settings: SettingsService): ProfileWriters {
    return {
        bindings: createSettingWriter(settings, agentSettings.settings.toolBindings),
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
        /** 能选的模型与按引用取到的行（`nbook.models/shared` 的选用数据）。 */
        readonly rows: Readonly<ShallowRef<readonly SelectionRow[]>>;
        readonly lookup: Readonly<ShallowRef<ReadonlyMap<string, ModelRow | null>>>;
        /** 登记页面要取的引用（角色绑定的、各 Profile 指名的）。 */
        want(references: readonly string[]): void;
        ensure(): void;
    };
    readonly writers: ProfileWriters;
    readonly text: TextResolver;
    readonly openAddress: (address: string) => void;
    readonly report: (code: string, message: string) => void;
    /** 窗口的 Skill 目录：Skill 一节要它；不给时这一节不画。 */
    readonly skills?: SkillsClient;
    /** 表情包列表：表情包一节要它；不给或取不到时这一节不画（stickers.md 输出 19）。 */
    readonly stickerPacks?: StickerPacksClient;
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
            const bindingEdits = pendingEdits(deps.settings, agentSettings.settings.toolBindings, deps.writers.bindings);

            /**
             * 事件可能接连来：只认最后一次请求的结果，晚到的旧列表不盖新的。被顶掉的那次等最新的那次：`await load()` 之后目录一定是新的，
             * 新建靠这一点才选得中刚建的。
             */
            let sequence = 0;
            let latest: Promise<void> = Promise.resolve();
            const fetchCatalog = async (mine: number): Promise<void> => {
                const [listed, tools] = await Promise.all([deps.remote.profiles({}), deps.remote.toolCatalog({})]);
                if (mine !== sequence) return latest;
                if (!listed.ok || !tools.ok) {
                    const code = listed.ok ? (tools as {readonly code: string}).code : listed.code;
                    deps.report("profiles-failed", code);
                    // 已经显示着的留着：重取失败不把页面换成失败态。
                    if (state.value !== "ready") state.value = {failed: code};
                    return undefined;
                }
                entries.value = listed.value;
                catalog.value = tools.value;
                state.value = "ready";
                return undefined;
            };
            const load = (): Promise<void> => {
                latest = fetchCatalog((sequence += 1));
                return latest;
            };

            let release: (() => void) | null = null;
            let unmounted = false;
            onMounted(async () => {
                deps.models.ensure();
                deps.skills?.ensure();
                deps.stickerPacks?.ensure();
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
            // 页面要显示名字的模型：角色绑着的，加上各 Profile 设置里指名的。
            watch([() => deps.models.snapshot.value, () => settingEdits.value()], () => {
                const references = new Set<string>();
                for (const role of deps.models.snapshot.value?.roles ?? []) if (role.model !== null) references.add(role.model);
                for (const setting of Object.values(settingEdits.value())) if (setting.model !== undefined) references.add(setting.model);
                deps.models.want([...references]);
            }, {immediate: true});
            const views = computed(() => profileViews({
                profiles: entries.value,
                catalog: catalog.value,
                bindings: bindingEdits.value(),
                settings: settingEdits.value(),
                snapshot: deps.models.snapshot.value,
                models: {rows: deps.models.rows.value, lookup: deps.models.lookup.value},
                modelsFailed: deps.models.failed.value,
                pluginName,
                text: deps.text,
                skills: deps.skills?.entries.value ?? null,
                stickerPacks: deps.stickerPacks?.entries.value ?? null,
            }));

            /** 写的那一刻对当时的值求改动，按这时的目录换算（用到的是 Profile 本来就有哪些工具）。 */
            const changeTools = (key: string, change: ToolChange): Promise<SettingWriteResult> => {
                const entry = entries.value.find((candidate) => candidate.key === key);
                if (entry === undefined) return Promise.resolve({ok: true});
                const {requirements, defaultForAll, methodsOf} = toolChangeContext(entry, catalog.value);
                return bindingEdits.apply((current) => withToolBinding(current, key, changeToolBinding(current[key], requirements, defaultForAll, objectAwareChange(change), methodsOf)));
            };

            /** 白名单的改动按写的那一刻的声明换算：加声明里有的就是撤销“去掉”（profile-settings.md 输出 25）。 */
            const changeAgents = (key: string, change: ToolChange): Promise<SettingWriteResult> => {
                const declared = entries.value.find((candidate) => candidate.key === key)?.agents?.allowed ?? [];
                return settingEdits.apply((current) => withAllowlistChoice(current, key, "agents", changeAgentsBinding(current[key]?.agents, declared, change)));
            };

            /** Skill 白名单的写法同可派的子代理：`"all"` 的声明按此刻的目录展开（skills.md 的“输入与前置条件”）。 */
            const changeSkills = (key: string, change: ToolChange): Promise<SettingWriteResult> => {
                const declared = declaredAllowlist(entries.value.find((candidate) => candidate.key === key)?.skills, (deps.skills?.entries.value ?? []).map((skill) => skill.id));
                return settingEdits.apply((current) => withAllowlistChoice(current, key, "skills", changeAgentsBinding(current[key]?.skills, declared, change)));
            };

            /** 表情包白名单的写法同 Skill（stickers.md 的“白名单”）。 */
            const changeStickers = (key: string, change: ToolChange): Promise<SettingWriteResult> => {
                const declared = declaredAllowlist(entries.value.find((candidate) => candidate.key === key)?.stickers, (deps.stickerPacks?.entries.value ?? []).map((pack) => pack.id));
                return settingEdits.apply((current) => withAllowlistChoice(current, key, "stickers", changeAgentsBinding(current[key]?.stickers, declared, change)));
            };

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
                onRemoveTool: (key: string, id: string) => void changeTools(key, {remove: [id]}).then(reportIfFailed),
                onRestoreTools: (key: string) => void bindingEdits.apply((current) => withToolBinding(current, key, undefined)).then(reportIfFailed),
                onRemoveAgent: (key: string, id: string) => void changeAgents(key, {remove: [id]}).then(reportIfFailed),
                onRestoreAgents: (key: string) => void settingEdits.apply((current) => withAllowlistChoice(current, key, "agents", undefined)).then(reportIfFailed),
                onRemoveSkill: (key: string, id: string) => void changeSkills(key, {remove: [id]}).then(reportIfFailed),
                onAddBackSkill: (key: string, id: string) => void changeSkills(key, {add: [id]}).then(reportIfFailed),
                onRestoreSkills: (key: string) => void settingEdits.apply((current) => withAllowlistChoice(current, key, "skills", undefined)).then(reportIfFailed),
                onRemoveSticker: (key: string, id: string) => void changeStickers(key, {remove: [id]}).then(reportIfFailed),
                onAddBackSticker: (key: string, id: string) => void changeStickers(key, {add: [id]}).then(reportIfFailed),
                onRestoreStickers: (key: string) => void settingEdits.apply((current) => withAllowlistChoice(current, key, "stickers", undefined)).then(reportIfFailed),
                addStickers: async (key: string, change: ToolChange): Promise<string | null> => {
                    const result = await changeStickers(key, change);
                    return result.ok ? null : settingsFailureText(result.code, result.detail, deps.text);
                },
                addSkills: async (key: string, change: ToolChange): Promise<string | null> => {
                    const result = await changeSkills(key, change);
                    return result.ok ? null : settingsFailureText(result.code, result.detail, deps.text);
                },
                addAgents: async (key: string, change: ToolChange): Promise<string | null> => {
                    const result = await changeAgents(key, change);
                    return result.ok ? null : settingsFailureText(result.code, result.detail, deps.text);
                },
                // 对话框自己显示失败，留在原地；不走窗口通知。
                addTools: async (key: string, change: ToolChange): Promise<string | null> => {
                    const result = await changeTools(key, change);
                    return result.ok ? null : settingsFailureText(result.code, result.detail, deps.text);
                },
                onOpenFile: (key: string) => deps.openAddress(userProfileAddress(key)),
                // 服务端交回时打包已有结果，重取一次目录里就有它（事件也会来，序号让两次重取只算最后一次）。
                createProfile: async (name: string): Promise<{readonly key: string} | {readonly reason: string}> => {
                    const created = await deps.remote.createUserProfile({
                        name,
                        description: deps.text.t(agentText("profiles.skeleton.description")),
                        system: deps.text.t(agentText("profiles.skeleton.system")),
                    });
                    if (!created.ok) {
                        if (created.code === "exists") return {reason: deps.text.t(agentText("profiles.create.exists"))};
                        if (created.code === "invalid-name") return {reason: deps.text.t(agentText("profiles.create.invalid"))};
                        return {reason: deps.text.t(agentText("profiles.create.failed", {code: created.code}))};
                    }
                    await load();
                    deps.openAddress(created.value.address);
                    return {key: created.value.key};
                },
                deleteProfile: async (key: string): Promise<void> => {
                    const name = entries.value.find((entry) => entry.key === key)?.name ?? key;
                    const deleted = await deps.remote.deleteUserProfile({key});
                    // 文件已经不在：结果和删掉一样，重取就好。
                    if (!deleted.ok && deleted.code !== "not-found") {
                        props.context.reportWriteFailure(deps.text.t(agentText("profiles.remove.failed", {name})), {reason: deleted.code, uncertain: deleted.code === "unknown-outcome"});
                    }
                    await load();
                },
            });
        },
    });
}
