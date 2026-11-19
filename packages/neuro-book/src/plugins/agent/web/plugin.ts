/**
 * `nbook.agent` 浏览器入口（docs/specs/agent/conversation.md）：贡献对话视图、会话面板、编辑区页面、状态栏的活动条目与命令。`onStartup` 激活，只放声明与
 * 活动条目（`activity.ts`）；视图、宿主与 nb-agent-ui 的 Vue 层用到时才加载，打开窗口不多花时间。
 */

import {computed, markRaw, defineAsyncComponent, defineComponent, h, onBeforeUnmount, onMounted, shallowRef, watch} from "vue";
import type {Component, ShallowRef} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {stickerPickerKey, stickersCatalogContract} from "nbook/plugins/stickers/shared/contracts";
import type {StickerPicker} from "nbook/plugins/stickers/shared/contracts";
import type {CommandImplementation, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_PAGES_POINT, OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {markdownKey} from "nbook/plugins/markdown/shared/contracts";
import {projectFilesContract} from "nbook/plugins/files/shared/contracts";
import {builtinRoleNameKey, hasCredentials, modelsSettingsContract, modelsText, roleReference} from "nbook/plugins/models/shared/contracts";
import type {ModelsSnapshot} from "nbook/plugins/models/shared/contracts";
import {pluginsRegistryContract} from "nbook/plugins/plugins/shared/contracts";
import {displayLocale, OPEN_SETTINGS_COMMAND, SETTINGS_PAGES_POINT, settingsKey} from "nbook/plugins/settings/shared/contracts";
import type {WrittenSettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {notificationsKey, PROJECT_VIEW_CONTAINER, quickPickKey, VIEW_HEAD, viewHeadOf, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ViewHeadOptIn} from "nbook/plugins/workbench/shared/contracts";
import type {ItemDeclaration} from "nbook/plugins/workbench/shared/items";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation, ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {clockKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {defineRecord} from "nbook/shared/storage";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";
import {windowTextKey, windowTextPort} from "nbook/shared/window-text";
import {settingsFailureText} from "nbook/ui/settings/setting-text";

import {Type} from "typebox";

import type {AgentConversationServices, AgentWelcomeView, ComposerModelView, RequestTraceAction, RequestTraceQuery} from "@notnotype/nb-agent-ui";

import {descriptor} from "../plugin";
import {agentConversationKey, MAIN_PROFILE, SESSION_OWNERS_POINT, sessionOwnersPoint, stickerAllowlistUsageKey} from "../shared/contracts";
import type {ProfileEntry, SessionOwnerOpener} from "../shared/contracts";
import {agentSessionsContract} from "../shared/remote";
import {agentSettings, PERMISSIONS_SECTION, PROFILES_SECTION, REQUESTS_SECTION, SKILLS_SECTION, STATUS_LINE_SECTION} from "../shared/settings";
import {STATUS_ITEMS_POINT, statusItemsPoint} from "../shared/status-item-point";
import type {SettingWriteResult} from "nbook/shared/settings";
import {createStatusItems} from "./status-items";
import {createStatusLineWriter} from "./status-line-writes";
import {statusLinePage, statusCatalog} from "./status-line-page";
import {profileAllowlist} from "../shared/profile-allowlist";
import {agentText} from "../shared/text";
import {settingsPage} from "nbook/ui/settings/settings-page";
import {createAgentActivity} from "./activity";
import {createRulesWriter} from "./permission-writes";
import {permissionsPage} from "./permission-page";
import {createProfileWriters, profilesPage} from "./profile-page";
import {ATTACHMENT_LIMIT_BYTES} from "../shared/attachments";
import {createFileMentions} from "./mentions";
import {stickerMenu, stickersContribution} from "./sticker-composer";
import {createSkillInit} from "./skill-init";
import type {SkillInit} from "./skill-init";
import {createSkillsClient, OPEN_PROFILE_SETTINGS_ITEM, skillAddress, skillMenu} from "./skills";
import {createStickerPacksClient} from "./sticker-packs";
import {profilesUsingSticker} from "./sticker-usage";
import {draftOf, DraftsSchema, NO_DRAFTS, withDraft} from "./drafts";
import {createSessionHost} from "./session-host";
import type {RoleOption, SessionHost, SessionHostDeps, UploadedAttachment} from "./session-host";
import {createRecentSessions, createSessionList} from "./session-list";
import {createRunResults, createSeenErrors} from "./subagents-panel";
import {RequestsPage, useRequests} from "./requests-page";
import {requestEntriesContribution} from "./request-entries";

export const CONVERSATION_VIEW = "nbook.agent.conversation";
export const SESSIONS_VIEW = "nbook.agent.sessions";
export const CONVERSATION_PAGE = "nbook.agent.conversation";
const ACTIVITY_ITEM = "nbook.agent.activity";
export const OPEN_COMMAND = "nbook.agent.open";
export const NEW_SESSION_COMMAND = "nbook.agent.new-session";
export const FOCUS_SESSION_COMMAND = "nbook.agent.focus-session";
export const OPEN_IN_EDITOR_COMMAND = "nbook.agent.open-in-editor";
/** “模型请求”页与打开它的命令（docs/specs/agent/request-trace.md 输出 13、26）。 */
export const REQUESTS_PAGE = "nbook.agent.requests";
export const OPEN_REQUESTS_COMMAND = "nbook.agent.open-requests";
/** 别的插件的命令，公开合同：打开编辑器的文件（docs/specs/workbench/editor.md）、打开视图（docs/specs/workbench/views.md 输出 14）。 */
const EDITOR_OPEN_COMMAND = "nbook.editor.open";
const OPEN_VIEW_COMMAND = "nbook.view.open";

const CONVERSATION_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-message-square", location: "auxiliarybar", order: 0, layout: "fill"};
const SESSIONS_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-messages-square", location: "sidebar", order: 50, layout: "fill", container: PROJECT_VIEW_CONTAINER};
const PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> & {title?: never} = {icon: "i-lucide-message-square"};
const REQUESTS_PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> & {title?: never} = {icon: "i-lucide-activity"};
const ACTIVITY_DECLARATION: ItemDeclaration = {title: agentText("conversation.activity.title"), alignment: "right", order: 50, priority: 50, command: {id: FOCUS_SESSION_COMMAND}, when: {requires: ["nbook.agent/active"]}};
const command = (description: string, args: WrittenCommandDeclaration["args"] = Type.Object({}, {additionalProperties: false})): WrittenCommandDeclaration => ({
    category: agentText("commands.category"),
    description,
    args,
    effect: "read",
    expose: {agent: "never"},
});
const COMMANDS: Readonly<Record<string, WrittenCommandDeclaration>> = {
    [OPEN_COMMAND]: command("Bring the Agent conversation to the front."),
    [OPEN_IN_EDITOR_COMMAND]: command("Open the Agent conversation as a page in the editor area."),
    [NEW_SESSION_COMMAND]: command("Start a new Agent session in the conversation."),
    [FOCUS_SESSION_COMMAND]: command("Show an Agent session in the conversation; without an id, the one that needs the user.", Type.Object({sessionId: Type.Optional(Type.String())}, {additionalProperties: false})),
    [OPEN_REQUESTS_COMMAND]: command("Open the model requests page; with a session id, only that session, and with a request number, that request selected.", Type.Object({sessionId: Type.Optional(Type.String({minLength: 1})), request: Type.Optional(Type.Integer({minimum: 1}))}, {additionalProperties: false})),
};

const agentState = definePublicState(descriptor.id, {
    active: {type: "boolean", unready: false, reason: agentText("state.active.reason")},
});

const RecentSchema = Type.Object({id: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false});
/** 按位置（视图、页面）分键；作品范围按作品分区，没有打开作品时放用户层（输出：当前会话）。 */
const DRAFTS_RECORD = defineRecord({key: "agent.drafts", scope: "user", locality: "local", version: 1, keyed: true, schema: DraftsSchema});
const recentRecord = (project: boolean) => defineRecord({key: "agent.recent-session", scope: project ? "project" : "user", locality: "local", version: 1, keyed: true, schema: RecentSchema});

function modelOptions(snapshot: ModelsSnapshot): ComposerModelView[] {
    return snapshot.providers.filter(hasCredentials).flatMap((provider) => provider.models
        .filter((model) => model.enabled && model.status === "ok")
        .map((model) => ({
            key: `${provider.id}/${model.id}`,
            label: model.name,
            supportsImages: model.vision,
            group: provider.name,
            contextWindow: model.contextWindow,
            reasoning: model.reasoning,
            price: model.price === null ? null : {input: model.price[0], output: model.price[1]},
        })));
}

/** 附件地址换成读取路由。不是附件的（别的方案）不显示。 */
function attachmentUrl(locator: string): string | null {
    const match = /^sessions:\/\/([^/]+)\/home\/attachments\/([^/]+)$/u.exec(locator);
    return match === null ? null : `/api/${descriptor.id}/sessions/${encodeURIComponent(match[1]!)}/attachments/${encodeURIComponent(match[2]!)}`;
}

function roleNameOf(role: ModelsSnapshot["roles"][number]): RoleOption["name"] {
    const key = builtinRoleNameKey(role);
    return key === null ? (role.name === "" ? role.id : role.name) : modelsText(key);
}

function roleOptions(snapshot: ModelsSnapshot): RoleOption[] {
    const labels = new Map<string, string>(snapshot.providers.flatMap((provider) => provider.models.map((model) => [`${provider.id}/${model.id}`, model.name] as const)));
    return snapshot.roles.map((role) => ({
        key: roleReference(role.id),
        name: roleNameOf(role),
        axis: role.axis,
        modelLabel: role.model === null ? null : labels.get(role.model) ?? role.model,
        status: role.status,
    }));
}

/** 这个文件也由不带 DOM 类型的 tsc 检查，所以按需要的那几个取。 */
const browser = globalThis as {readonly location?: {readonly pathname: string}; readonly navigator?: {readonly clipboard?: {writeText(text: string): Promise<void>}}; readonly open?: (url: string, target: string, features: string) => unknown};

const PROFILES_PAGE: WrittenSettingsPageDeclaration = {icon: "i-lucide-user-round-cog", category: "ai", order: 25, layers: ["user"], layout: "fill", description: agentText("settingsPages.profiles.description")};
const PERMISSIONS_PAGE: WrittenSettingsPageDeclaration = {icon: "i-lucide-shield-check", category: "ai", order: 40, layers: ["user"], description: agentText("settingsPages.permissions.description")};
const STATUS_LINE_PAGE: WrittenSettingsPageDeclaration = {icon: "i-lucide-panel-bottom", category: "ai", order: 35, layers: ["user"], description: agentText("settingsPages.status-line.description")};
const SKILLS_PAGE: WrittenSettingsPageDeclaration = {icon: "i-lucide-sparkles", category: "ai", order: 30, layers: ["user"], description: agentText("settingsPages.skills.description")};

export const agentBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [statusItemsPoint, sessionOwnersPoint],
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        receives: [STATUS_ITEMS_POINT, SESSION_OWNERS_POINT],
        provides: [agentConversationKey, stickerAllowlistUsageKey],
        dependencies: [{key: diagnosticsKey}, {key: commandServiceKey}, {key: windowProjectKey}, {key: settingsKey}, {key: storageKey}, {key: clockKey}, {key: quickPickKey}, {key: notificationsKey}, {key: markdownKey}, {key: windowTextKey, required: false}, {key: stickerPickerKey, required: false}],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: CONVERSATION_VIEW, declaration: CONVERSATION_DECLARATION},
            {capability: WORKBENCH_VIEWS_POINT, id: SESSIONS_VIEW, declaration: SESSIONS_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: CONVERSATION_PAGE, declaration: PAGE_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: REQUESTS_PAGE, declaration: REQUESTS_PAGE_DECLARATION},
            {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id: ACTIVITY_ITEM, declaration: ACTIVITY_DECLARATION},
            ...Object.entries(COMMANDS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
            {capability: SETTINGS_PAGES_POINT, id: PROFILES_SECTION, declaration: PROFILES_PAGE},
            {capability: SETTINGS_PAGES_POINT, id: PERMISSIONS_SECTION, declaration: PERMISSIONS_PAGE},
            {capability: SETTINGS_PAGES_POINT, id: SKILLS_SECTION, declaration: SKILLS_PAGE},
            {capability: SETTINGS_PAGES_POINT, id: STATUS_LINE_SECTION, declaration: STATUS_LINE_PAGE},
            ...agentState.contributions,
        ],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const commands = context.services.require(commandServiceKey);
            const windowProject = context.services.require(windowProjectKey);
            const settings = context.services.require(settingsKey);
            const storage = context.services.require(storageKey);
            const clock = context.services.require(clockKey);
            const quickPick = context.services.require(quickPickKey);
            const notifications = context.services.require(notificationsKey);
            const text = await windowTextPort(context.services, () => displayLocale(settings));
            // 表情选择器（docs/specs/agent/stickers.md 输出 39 到 45）：没装表情包插件时没有 `:` 补全、表情按钮，用户消息照常画气泡。
            const pickerService = await context.services.resolve(stickerPickerKey);
            const picker: StickerPicker | null = pickerService.status === "resolved" ? pickerService.instance : null;
            const remote = context.remote.use(agentSessionsContract);
            const rulesWriter = createRulesWriter(settings);
            const profileWriters = createProfileWriters(settings);
            const report = (code: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
                diagnostics.record({level: "warn", event: `agent.${code}`, message, data, source: {plugin: descriptor.id}});
            };
            /** 菜单里勾选没写成功：与设置页同样交给通知（页面里走窗口的通知，这里没有窗口，直接发）。 */
            const reportStatusLineFailure = (result: SettingWriteResult): void => {
                if (result.ok) return;
                void notifications.notify({tone: "warning", title: agentText("statusLine.notSaved"), message: settingsFailureText(result.code, result.detail, text)});
            };
            const openSettings = (target?: {readonly section: string; readonly layer?: "user" | "project"}): void => {
                void (target === undefined ? commands.execute(OPEN_SETTINGS_COMMAND) : commands.execute(OPEN_SETTINGS_COMMAND, target)).then((result) => {
                    if (!result.ok) report("open-settings-failed", `opening settings ${target?.section ?? ""} failed: ${result.code}`);
                });
            };
            /** 状态栏里插件加的项（conversation.md 输出 45）：目录与登记项；写入走同一个队列，菜单与设置页共用。 */
            const statusItems = createStatusItems((message) => report("status-item-failed", message));
            const statusLineWriter = createStatusLineWriter(settings, () => statusCatalog(statusItems));

            const activity = createAgentActivity(remote, (message) => report("activity-failed", message));
            // Lab 窗口不看活动（Component Lab 只在开发模式，直接开它不该多一个订阅）。
            if (browser.location?.pathname.startsWith("/lab") !== true) void activity.start(context.signal);

            const project = windowProject.project?.id ?? null;
            const profiles = shallowRef<readonly ProfileEntry[]>([]);
            const skills = createSkillsClient(remote, context.signal, (message) => report("skills-failed", message));
            // 表情包列表只给 Profile 设置页（stickers.md 输出 19）：没装 `nbook.stickers` 时取不到，那一节不画。
            const stickerPacks = createStickerPacksClient(context.remote.use(stickersCatalogContract), context.signal, (message) => report("sticker-packs-failed", message));
            /** 一个 Profile 的 Skill 白名单（skills.md 的“输入与前置条件”），与服务端认标签用的同一个换算。 */
            const allowedSkills = (profile: string): readonly string[] => profileAllowlist(
                profiles.value.find((entry) => entry.key === profile)?.skills,
                settings.get(agentSettings.settings.profileSettings)[profile]?.skills,
                (skills.entries.value ?? []).map((entry) => entry.id),
            );
            /** 对话位置的确认框（输出 27）：每个位置一份，右栏与编辑区页面同时开着时只在选了 Skill 的那个位置弹出。 */
            const inits = new Map<string, SkillInit>();
            const initAt = (position: string): SkillInit => {
                let init = inits.get(position);
                if (init === undefined) {
                    init = createSkillInit(remote, (message) => report("skill-init-failed", message));
                    inits.set(position, init);
                }
                return init;
            };
            const loadProfiles = async (): Promise<void> => {
                const result = await remote.profiles({});
                if (result.ok) profiles.value = result.value;
                else report("profiles-failed", result.code);
            };
            const models = shallowRef<readonly ComposerModelView[] | null>(null);
            const roles = shallowRef<readonly RoleOption[] | null>(null);
            /** 没过滤的快照：Profile 设置页要看已绑定但用不了的模型。 */
            const modelsSnapshot = shallowRef<ModelsSnapshot | null>(null);
            const modelsFailed = shallowRef(false);
            const takeModels = (snapshot: ModelsSnapshot): void => {
                // 先换角色：宿主看着 `models` 重读会话的模型，这时角色应当已经是新的。
                roles.value = roleOptions(snapshot);
                models.value = modelOptions(snapshot);
                modelsSnapshot.value = snapshot;
                modelsFailed.value = false;
            };
            let modelsStarted = false;
            /** 第一次有对话位置或打开 Profile 页时才取：两个都没打开的窗口不多发请求。 */
            const ensureModels = (): void => {
                if (modelsStarted) return;
                modelsStarted = true;
                void (async () => {
                    const modelsRemote = context.remote.use(modelsSettingsContract);
                    const subscription = await modelsRemote.events.changed.subscribe({}, takeModels);
                    if (!subscription.ok) {
                        // 模型服务不在是正常情况（下拉隐藏），别的失败下一个对话位置再试。
                        report("models-failed", subscription.code);
                        modelsFailed.value = true;
                        modelsStarted = false;
                        return;
                    }
                    context.signal.addEventListener("abort", () => subscription.value.release(), {once: true});
                    const snapshot = await modelsRemote.snapshot({});
                    if (snapshot.ok) takeModels(snapshot.value);
                    else {
                        report("models-failed", snapshot.code);
                        modelsFailed.value = true;
                    }
                })().catch((error: unknown) => {
                    report("models-failed", String(error));
                    modelsFailed.value = true;
                });
            };
            let started = false;
            const ensureStarted = (): void => {
                if (!started) void loadProfiles();
                started = true;
                skills.ensure();
                ensureModels();
            };

            const openRecent = async (position: string) => {
                const opened = await storage.open(recentRecord(project !== null), position);
                return opened.ok ? opened.handle : null;
            };
            /** 打开文件的结果不用等，但打不开要留诊断：命令参数不对时这里是唯一的线索。 */
            const openAddress = (address: string): void => {
                void commands.execute(EDITOR_OPEN_COMMAND, {address, mode: "permanent"}).then((opened) => {
                    if (!opened.ok) report("open-address-failed", `opening ${address} failed: ${opened.code}`);
                });
            };
            /**
             * 子代理管理（conversation.md 输出 43）：出错看过没有、收口结果的缓存，右栏与编辑区页面两个对话位置共用。激活之前收口的出错算看过；
             * 切到哪个会话，它此前的出错就算看过（不论从卡片、停靠区还是浮层切过去）。
             */
            const seenErrors = createSeenErrors(clock.now());
            const runResults = createRunResults((message) => report("run-result-failed", message));
            const hosts = new Map<string, SessionHost>();
            /** 最近用过的位置：命令优先用它。 */
            let lastPosition = "view";
            /**
             * 有归属的会话交给归属插件（conversation.md 的转交）：会话头的 `owner.plugin` 找到那个插件的贡献就交给它；读不到会话头、没有那个
             * 插件的贡献或它揭示不成时照常在通用视图里打开。贡献按贡献 id 记，一个插件有几条时用最先登记的那条，撤掉一条不影响别的。
             */
            const openers = new Map<string, {readonly plugin: string; readonly opener: SessionOwnerOpener}>();
            const ownersReceiver: ContributionReceiver<unknown, SessionOwnerOpener> = {
                published: (handle) => {
                    openers.set(handle.id, {plugin: handle.plugin, opener: handle.implementation()});
                },
                revoke: (handle) => {
                    openers.delete(handle.id);
                },
            };
            const sessionOwners: NonNullable<SessionHostDeps["owners"]> = {
                ownerOf: async (id) => {
                    const read = await remote.header({sessionId: id});
                    return read.ok ? read.value.owner ?? null : null;
                },
                open: async (id, owner) => {
                    const found = [...openers.values()].find((entry) => entry.plugin === owner.plugin);
                    return found === undefined ? false : found.opener.open(id, {plugin: owner.plugin, id: owner.id});
                },
            };
            /** 两个通用位置（右栏、编辑区页面）与固定会话共用的依赖；`position` 分开最近用过的记录与 Skill 初始化的确认框。 */
            const hostDeps = (position: string): SessionHostDeps => ({
                    remote,
                    project,
                    now: () => clock.now(),
                    schedule: (run, delay) => clock.schedule(run, delay),
                    text,
                    newId: () => crypto.randomUUID(),
                    recent: {
                        read: async () => {
                            const handle = await openRecent(position);
                            const snapshot = await handle?.read();
                            return snapshot?.status === "ok" ? snapshot.value.id : null;
                        },
                        write: (id) => {
                            void openRecent(position).then((handle) => handle?.update(() => ({id}))).catch((error: unknown) => report("recent-save-failed", String(error)));
                        },
                    },
                    attachments: {
                        upload: async (session, file) => {
                            // 服务端读到超限会断开，浏览器只看到网络错误：大小先在这里说清楚。
                            if (file.size > ATTACHMENT_LIMIT_BYTES) return {ok: false, code: "too-large"};
                            try {
                                const response = await fetch(`/api/${descriptor.id}/sessions/${encodeURIComponent(session)}/attachments`, {
                                    method: "POST",
                                    body: file,
                                    headers: {"Content-Type": file.type === "" ? "application/octet-stream" : file.type, "X-Attachment-Name": encodeURIComponent(file.name)},
                                });
                                if (response.ok) return {ok: true, value: await response.json() as UploadedAttachment};
                                const body = await response.json().catch(() => null) as {error?: {code?: string}} | null;
                                return {ok: false, code: body?.error?.code ?? `http-${String(response.status)}`};
                            } catch (error) {
                                report("attachment-upload-failed", String(error));
                                return {ok: false, code: "network"};
                            }
                        },
                    },
                    drafts: {
                        read: async (session) => {
                            const opened = await storage.open(DRAFTS_RECORD, "drafts");
                            if (!opened.ok) return null;
                            const snapshot = await opened.handle.read();
                            return snapshot.status === "ok" ? draftOf(snapshot.value, session, clock.now()) : null;
                        },
                        write: (session, value) => {
                            void storage.open(DRAFTS_RECORD, "drafts").then(async (opened) => {
                                if (opened.ok) await opened.handle.update((current) => withDraft(current ?? NO_DRAFTS, session, value, clock.now()));
                            }).catch((error: unknown) => report("draft-save-failed", String(error)));
                        },
                    },
                    warnCost: () => settings.get(agentSettings.settings.warnCost),
                    resumeMode: () => settings.get(agentSettings.settings.resumeMode),
                    rememberRules: (rules) => rulesWriter.append(rules),
                    models: () => models.value,
                    roles: () => roles.value,
                    providers: () => modelsSnapshot.value?.providers.map((provider) => ({id: provider.id, name: provider.name})) ?? null,
                    profiles: () => profiles.value,
                    copy: (value) => void browser.navigator?.clipboard?.writeText(value),
                    openSettings,
                    openRequests: (target) => void commands.execute(OPEN_REQUESTS_COMMAND, target),
                    openAddress,
                    openLink: (href) => void browser.open?.(href, "_blank", "noopener"),
                    ...(picker === null ? {} : {
                        triggers: [":"],
                        stickerSelected: (raw: string) => {
                            const item = picker.groups().flatMap((group) => group.items).find((candidate) => candidate.raw === raw);
                            if (item !== undefined) picker.used(item);
                        },
                    }),
                    skills: {
                        selected: (id, profile) => {
                            if (id === OPEN_PROFILE_SETTINGS_ITEM) {
                                void commands.execute(OPEN_SETTINGS_COMMAND, {section: PROFILES_SECTION});
                                return;
                            }
                            skills.touch(id);
                            // 选了未初始化的照常插入了标签，再问要不要初始化（输出 27）；白名单之外的菜单里不会有。
                            const entry = skills.entries.value?.find((candidate) => candidate.id === id);
                            if (entry?.status === "needs-init" && allowedSkills(profile).includes(id)) void initAt(position).ask(entry);
                        },
                        address: (name, profile) => skillAddress(name, skills.entries.value ?? [], allowedSkills(profile)),
                    },
                    report,
            });
            /** 交回的函数停掉监视并摘掉插件关闭时的监听：随组件挂卸的宿主（固定会话）卸载时调用，不让插件级的 `signal` 留着它。 */
            const watchSeen = (host: SessionHost): (() => void) => {
                const stopSeen = watch(host.sessionId, (id) => {
                    if (id !== null) seenErrors.markSession(id, clock.now());
                }, {immediate: true});
                context.signal.addEventListener("abort", stopSeen, {once: true});
                return () => {
                    stopSeen();
                    context.signal.removeEventListener("abort", stopSeen);
                };
            };
            const hostAt = (position: "view" | "page"): SessionHost => {
                let host = hosts.get(position);
                if (host !== undefined) return host;
                host = createSessionHost({...hostDeps(position), owners: sessionOwners});
                hosts.set(position, host);
                watchSeen(host);
                return host;
            };
            context.signal.addEventListener("abort", () => {
                for (const host of hosts.values()) host.dispose();
            }, {once: true});

            const list = createSessionList({
                remote,
                project,
                profileEntries: () => profiles.value,
                activity: () => activity.items.value,
                failed: (code) => text.t(agentText("conversation.listFailed", {code})),
                now: () => clock.now(),
            });

            /** 第一屏的最近对话（conversation.md 输出 41）：两个对话位置共用一份，与会话面板那份分开。 */
            const recentSessions = createRecentSessions({remote, project});
            /** 第一屏只显示 3 张卡片；最近对话里不列当前会话。 */
            const WELCOME_RECENT = 3;
            /** 第一屏的数据：指令取这个位置当前会话的 Profile，没选会话时取新会话会用的那个（`profileKey()` 已按此交回）。 */
            const welcomeOf = (host: SessionHost): AgentWelcomeView => {
                const current = host.sessionId.value;
                const others = recentSessions.sessions.value.filter((session) => session.id !== current);
                const profile = profiles.value.find((entry) => entry.key === host.profileKey());
                return {title: text.t(agentText("conversation.welcomeTitle")), recent: others.slice(0, WELCOME_RECENT), total: others.length, starters: profile?.starters ?? []};
            };
            /** 没选会话时头上的图标：新会话会用的 Profile。 */
            const draftProfileOf = (host: SessionHost): {name: string; icon: string} | null => {
                const profile = profiles.value.find((entry) => entry.key === host.profileKey());
                return profile === undefined ? null : {name: profile.name, icon: profile.icon ?? "i-lucide-bot"};
            };

            /** 新建时选 Profile：目录里不隐藏、可用的多于一个才问；交回 null 是取消，undefined 是用缺省。 */
            const pickProfile = async (): Promise<string | null | undefined> => {
                await loadProfiles();
                const options = profiles.value.filter((profile) => profile.hidden !== true && profile.status === "ok");
                if (options.length <= 1) return undefined;
                const picked = await quickPick.pick({title: agentText("conversation.pickProfile"), placeholder: agentText("conversation.pickProfile"), items: options.map((profile) => ({id: profile.key, label: profile.name, detail: profile.description}))});
                return picked.kind === "item" ? picked.id : null;
            };

            const panelLabels = () => ({
                get renameTitle() {
                    return text.t(agentText("conversation.renameTitle"));
                },
                get rename() {
                    return text.t(agentText("conversation.rename"));
                },
                get cancel() {
                    return text.t(agentText("conversation.cancel"));
                },
            });

            // 组件与渲染组件用到时才加载（nb-agent-ui 的 Vue 层不小）。
            const loadVue = async () => {
                const [{builtinContributions}, {createAgentViewRegistry}, {default: ConversationHost}, {default: FixedConversationHost}, {default: SessionPanelHost}, {default: AgentFormRenderer}, {default: SubagentCard}, {default: BackgroundCommandCard}, {subagentContribution}, {default: EvalDetail}, {evalContribution}] = await Promise.all([
                    import("@notnotype/nb-agent-ui/vue"),
                    import("@notnotype/nb-agent-ui"),
                    import("./ConversationHost.vue"),
                    import("./FixedConversationHost.vue"),
                    import("./SessionPanelHost.vue"),
                    import("./form-renderer.vue"),
                    import("./components/SubagentCard.vue"),
                    import("./components/BackgroundCommandCard.vue"),
                    import("./subagent-renderers"),
                    import("./components/EvalDetail.vue"),
                    import("./eval-renderer"),
                ]);
                return {builtinContributions, createAgentViewRegistry, ConversationHost, FixedConversationHost, SessionPanelHost, AgentFormRenderer, SubagentCard, BackgroundCommandCard, subagentContribution, EvalDetail, evalContribution};
            };
            let vue: ReturnType<typeof loadVue> | null = null;
            const vueOnce = () => (vue ??= loadVue());

            /**
             * 对话位置共用的部分：注册表的登记项、渲染组件，与按会话的 Profile 取白名单的菜单服务（`servicesFor` 每个对话一份，交回取消
             * 监听的函数）。通用的两个位置与固定会话的组件都用它。
             */
            const conversationParts = async () => {
                ensureStarted();
                const {builtinContributions, createAgentViewRegistry, AgentFormRenderer, SubagentCard, BackgroundCommandCard, subagentContribution, EvalDetail, evalContribution} = await vueOnce();
                const markdown = await context.services.resolve(markdownKey);
                const components = markdown.status === "resolved" ? markdown.instance.components : null;
                const stickers = picker === null ? null : await stickersContribution(picker, (message, error) => report("sticker-picker-failed", `${message}: ${String(error)}`));
                const baseContributions = [...builtinContributions, subagentContribution({card: SubagentCard}), evalContribution({detail: EvalDetail}), requestEntriesContribution, ...(stickers === null ? [] : [stickers.contribution])];
                const renderers = {
                    form: markRaw(AgentFormRenderer),
                    backgroundCommand: markRaw(BackgroundCommandCard),
                    ...(components === null ? {} : {markdown: markRaw(components.MarkdownDisplay), promptEditor: markRaw(components.PromptEditor), promptTextView: markRaw(components.PromptTextView)}),
                    ...(stickers === null ? {} : {promptBareness: stickers.bareness}),
                };
                const servicesFor = (profileOf: () => string): {readonly services: ShallowRef<AgentConversationServices>; stop(): void} => {
                    // 编辑器按函数身份重取菜单：查到新结果时换一个新函数（nb-agent-ui 的 `resolveTriggerMenu` 约定）。
                    const services = shallowRef<AgentConversationServices>({});
                    const projectFiles = project === null ? null : context.remote.use(projectFilesContract);
                    const mentions = createFileMentions({
                        find: projectFiles === null ? null : (query, limit) => projectFiles.find({query, limit}) as never,
                        texts: () => ({
                            title: text.t(agentText("conversation.mentions.title")),
                            empty: text.t(agentText("conversation.mentions.empty")),
                            noProject: text.t(agentText("conversation.mentions.noProject")),
                            failed: text.t(agentText("conversation.mentions.failed")),
                        }),
                        onChange: () => refreshServices(),
                    });
                    const skillTexts = () => ({
                        title: text.t(agentText("skills.menu.title")),
                        recentGroup: text.t(agentText("skills.menu.recent")),
                        allGroup: text.t(agentText("skills.menu.all")),
                        noMatch: text.t(agentText("skills.menu.noMatch")),
                        openSettings: text.t(agentText("skills.menu.openSettings")),
                        noSkills: text.t(agentText("skills.menu.noSkills")),
                        needsInit: text.t(agentText("skills.menu.needsInit")),
                        initializing: text.t(agentText("skills.menu.initializing")),
                    });
                    /** `$` 菜单按这个位置当前会话的 Profile 取白名单（skills.md 输出 26）。 */
                    const refreshServices = (): void => {
                        services.value = {
                            resolveAttachmentUrl: attachmentUrl,
                            resolveTriggerMenu: (context) => (context.trigger === ":" && picker !== null
                                ? stickerMenu(picker, context.query)
                                : context.trigger === "$"
                                ? skillMenu(context.query, {entries: skills.entries.value, allowed: allowedSkills(profileOf()), recent: skills.recent.value, texts: skillTexts()})
                                : mentions.resolve(context)),
                        };
                    };
                    refreshServices();
                    // 目录、最近用过的或 Profile（白名单由它求出，启动时可能比目录晚到）变了：换一个新函数，开着的菜单按当前查询重取。
                    const stopWatching = watch([skills.entries, skills.recent, profiles], refreshServices);
                    context.signal.addEventListener("abort", stopWatching, {once: true});
                    return {services, stop: () => {
                        stopWatching();
                        context.signal.removeEventListener("abort", stopWatching);
                    }};
                };
                return {createAgentViewRegistry, baseContributions, renderers, servicesFor};
            };

            const conversationComponent = async (position: "view" | "page"): Promise<Component> => {
                const {createAgentViewRegistry, baseContributions, renderers, servicesFor} = await conversationParts();
                const {ConversationHost} = await vueOnce();
                const labels = panelLabels();
                const {services} = servicesFor(() => hostAt(position).profileKey());
                return defineComponent({
                    name: "AgentConversationPosition",
                    inheritAttrs: false,
                    // 右栏的视图拿到工作台给的上下文，经它取标题区（views.md 输出 19）；编辑区页面没有，头照旧画在内容里。
                    props: {context: {type: Object, default: null}},
                    setup(props) {
                        const head = position === "view" && props.context !== null ? viewHeadOf(props.context) : null;
                        // 状态栏里插件加的项随贡献的发布与撤回变：登记项变了重建注册表（注册表是只读的合并结果）。
                        const registry = computed(() => createAgentViewRegistry([...baseContributions, {source: "agent.statusItems", statusItems: statusItems.entries.value}]));
                        lastPosition = position;
                        // 页面标签关了或切走了：命令回到右栏，不再把它开回来。
                        onBeforeUnmount(() => {
                            if (lastPosition === position) lastPosition = "view";
                        });
                        return () => {
                            const host = hostAt(position);
                            return h(ConversationHost, {host, list, recent: recentSessions, welcome: welcomeOf(host), draftProfile: draftProfileOf(host), registry: registry.value, renderers, services: services.value, pickProfile, labels, skillInit: initAt(position), subagents: {profiles: profiles.value, seen: seenErrors, results: runResults}, head, statusLine: {setting: settings.get(agentSettings.settings.statusLine), toggle: (id: string) => void statusLineWriter.toggle(id).then(reportStatusLineFailure), openSettings: () => openSettings({section: STATUS_LINE_SECTION, layer: "user"})}});
                        };
                    },
                });
            };

            /**
             * 固定会话的对话组件（conversation.md 的固定会话）：给别的插件经 `agentConversationKey` 用。每个挂载的实例有自己的宿主，只开属性
             * 里的那个会话；`sessionId` 换了要调用方按它换 `key` 重挂。别的会话（子会话卡片、子代理浮层）交给通用视图打开。
             */
            const fixedConversation = defineAsyncComponent(async () => {
                const {createAgentViewRegistry, baseContributions, renderers, servicesFor} = await conversationParts();
                const {FixedConversationHost} = await vueOnce();
                return defineComponent({
                    name: "AgentFixedConversation",
                    inheritAttrs: false,
                    props: {
                        sessionId: {type: String, required: true},
                        identity: {type: Object as () => {readonly name: string; readonly avatar?: string}, required: true},
                        active: {type: Boolean, default: false},
                    },
                    emits: {seen: (seq: number) => typeof seq === "number"},
                    setup(props, {emit}) {
                        const host = createSessionHost({...hostDeps(`fixed:${props.sessionId}`), fixed: {sessionId: props.sessionId, openElsewhere: (id) => void commands.execute(FOCUS_SESSION_COMMAND, {sessionId: id})}});
                        const stopSeen = watchSeen(host);
                        const {services, stop} = servicesFor(() => host.profileKey());
                        const registry = computed(() => createAgentViewRegistry([...baseContributions, {source: "agent.statusItems", statusItems: statusItems.entries.value}]));
                        onBeforeUnmount(() => {
                            stopSeen();
                            stop();
                            host.dispose();
                        });
                        return () => h(FixedConversationHost, {host, identity: props.identity, active: props.active, registry: registry.value, renderers, services: services.value, skillInit: initAt(`fixed:${props.sessionId}`), subagents: {profiles: profiles.value, seen: seenErrors, results: runResults}, statusLine: {setting: settings.get(agentSettings.settings.statusLine), toggle: (id: string) => void statusLineWriter.toggle(id).then(reportStatusLineFailure), openSettings: () => openSettings({section: STATUS_LINE_SECTION, layer: "user"})}, onSeen: (seq: number) => emit("seen", seq)});
                    },
                });
            });

            /** 对话视图接管面板头的标题区：头写会话，按标题开会话列表（conversation.md 输出 44）。 */
            const view: ViewImplementation & ViewHeadOptIn = {load: () => conversationComponent("view"), [VIEW_HEAD]: true};
            const page: EditorPageImplementation = {load: () => conversationComponent("page")};

            // “模型请求”页：状态在插件作用域里一份（命令先写它、再打开页面），页面挂载时借用。
            let requestsStore: RequestsPage | null = null;
            const requestsOf = (): RequestsPage => (requestsStore ??= new RequestsPage(useRequests(context), report));
            const copy = (text: string): void => {
                void browser.navigator?.clipboard?.writeText(text).catch((error: unknown) => report("copy-failed", `could not copy to the clipboard: ${error instanceof Error ? error.message : String(error)}`));
            };
            const requestsPage: EditorPageImplementation = {
                load: async () => {
                    const {AgentRequestTrace} = await import("@notnotype/nb-agent-ui/vue");
                    const store = requestsOf();
                    const onAction = (action: RequestTraceAction): void => {
                        switch (action.type) {
                            case "request.select": store.select(action.id); return;
                            case "request.more": void store.more(); return;
                            case "request.refresh": void store.refresh(); return;
                            case "request.retry-detail": store.reload(); return;
                            case "request.load-content": void store.loadContent(action.hash); return;
                            case "request.load-payload": void store.loadPayload(action.id); return;
                            case "request.compare-base": void store.compareWith(action.id); return;
                            case "request.search-more": void store.searchMore(); return;
                            case "request.clear": void store.clear(action.scope); return;
                            case "request.list-at-top": store.setAtTop(action.atTop); return;
                            case "request.open-session": void commands.execute(FOCUS_SESSION_COMMAND, {sessionId: action.session}); return;
                            case "request.open-settings": void commands.execute(OPEN_SETTINGS_COMMAND, {section: REQUESTS_SECTION}); return;
                            case "request.copy": {
                                const detail = store.detail.value;
                                const payload = store.payload.value;
                                if (action.what === "payload" && payload.state === "ready") copy(payload.text);
                                else if (action.what === "request" && detail.state === "ready" && detail.value.id === action.id) copy(JSON.stringify(detail.value, null, 2));
                                return;
                            }
                        }
                    };
                    return defineComponent({
                        name: "AgentRequestsPage",
                        inheritAttrs: false,
                        setup() {
                            const now = shallowRef(clock.now());
                            const enabled = shallowRef(settings.get(agentSettings.settings.requestTrace));
                            let cancelTick = (): void => undefined;
                            let stopSettings = (): void => undefined;
                            let giveBack = (): void => undefined;
                            // 进行中的请求写已经等了多久：有进行中的（列表里的或选中的详情）才每秒重画一次。没有时也每 30 秒走一次，
                            // 时间筛选（最近一小时、今天）按它算起点，页面开着很久之后选也不会差太多。
                            const tick = (): void => {
                                const detail = store.detail.value;
                                const running = store.rows.value.some((row) => row.status === "running") || (detail.state === "ready" && detail.value.status === "running");
                                const time = clock.now();
                                if (running || time - now.value >= 30_000) now.value = time;
                                cancelTick = clock.schedule(tick, 1000);
                            };
                            onMounted(() => {
                                giveBack = store.borrow();
                                tick();
                                stopSettings = settings.onDidChange(() => {
                                    enabled.value = settings.get(agentSettings.settings.requestTrace);
                                });
                            });
                            onBeforeUnmount(() => {
                                giveBack();
                                cancelTick();
                                stopSettings();
                            });
                            return () => h(AgentRequestTrace, {
                                rows: store.rows.value,
                                list: store.list.value,
                                totals: store.totals.value,
                                facets: store.facets.value,
                                query: store.query.value,
                                pending: store.pending.value,
                                selected: store.selected.value,
                                detail: store.detail.value,
                                contents: store.contents.value,
                                payload: store.payload.value,
                                compare: store.compare.value,
                                search: store.search.value,
                                searchState: store.searchState.value,
                                hits: store.hits.value,
                                usage: store.usage.value,
                                "onUpdate:search": (text: string) => store.setSearch(text),
                                enabled: enabled.value,
                                now: now.value,
                                locale: displayLocale(settings) === "en-US" ? "en-US" : "zh-CN",
                                "onUpdate:query": (query: RequestTraceQuery) => store.setQuery(query),
                                onAction,
                            });
                        },
                    });
                },
            };
            const sessionsView: ViewImplementation = {
                load: async () => {
                    ensureStarted();
                    const {SessionPanelHost} = await vueOnce();
                    const labels = panelLabels();
                    return defineComponent({
                        name: "AgentSessionsView",
                        inheritAttrs: false,
                        setup() {
                            const host = hostAt("view");
                            return () => h(SessionPanelHost, {store: list, host, pickProfile, labels, onOpened: () => void commands.execute(OPEN_VIEW_COMMAND, {viewId: CONVERSATION_VIEW})});
                        },
                    });
                },
            };

            /** 把活的对话位置带到前面：优先最近用过的，其次打开默认右栏。 */
            const reveal = async (): Promise<SessionHost> => {
                ensureStarted();
                if (lastPosition === "page") await commands.execute(OPEN_PAGE_COMMAND, {id: CONVERSATION_PAGE});
                else await commands.execute(OPEN_VIEW_COMMAND, {viewId: CONVERSATION_VIEW});
                return hostAt(lastPosition === "page" ? "page" : "view");
            };
            const done = {ok: true, value: null} as const;
            const commandImplementations: Record<string, CommandImplementation> = {
                [OPEN_COMMAND]: {run: async () => {
                    await reveal();
                    return done;
                }},
                [OPEN_IN_EDITOR_COMMAND]: {run: async () => {
                    ensureStarted();
                    lastPosition = "page";
                    await commands.execute(OPEN_PAGE_COMMAND, {id: CONVERSATION_PAGE});
                    return done;
                }},
                [NEW_SESSION_COMMAND]: {run: async () => {
                    const host = await reveal();
                    const profile = await pickProfile();
                    if (profile !== null) await host.create(profile ?? MAIN_PROFILE);
                    return done;
                }},
                [OPEN_REQUESTS_COMMAND]: {run: async (args) => {
                    await requestsOf().open((args as {sessionId?: string; request?: number} | undefined) ?? {});
                    await commands.execute(OPEN_PAGE_COMMAND, {id: REQUESTS_PAGE});
                    return done;
                }},
                [FOCUS_SESSION_COMMAND]: {run: async (args) => {
                    const sessionId = (args as {sessionId?: string} | undefined)?.sessionId ?? activity.target.value;
                    // 有归属的会话交给归属插件，不揭示通用的对话视图、不写它的“最近的会话”（conversation.md 的转交）。
                    if (sessionId !== null) {
                        const owner = await sessionOwners.ownerOf(sessionId);
                        if (owner !== null && await sessionOwners.open(sessionId, owner)) return done;
                    }
                    const host = await reveal();
                    if (sessionId !== null) await host.open(sessionId);
                    return done;
                }},
            };

            const item: ItemImplementation = {
                text: () => {
                    const running = activity.running.value;
                    const waiting = activity.waiting.value;
                    if (running > 0 && waiting > 0) return agentText("conversation.activity.both", {running, waiting});
                    return waiting > 0 ? agentText("conversation.activity.waiting", {waiting}) : agentText("conversation.activity.running", {running});
                },
                state: () => (activity.waiting.value > 0 ? "warning" : "normal"),
            };
            const published = bindingsOf(agentState, {active: activity.active});
            return {
                services: [provideService(agentConversationKey, {FixedConversation: markRaw(fixedConversation)}), provideService(stickerAllowlistUsageKey, {
                    profilesUsing: async (packId) => {
                        const listed = await remote.profiles({});
                        return listed.ok ? profilesUsingSticker(listed.value, settings.get(agentSettings.settings.profileSettings), packId) : null;
                    },
                })],
                receivers: {[STATUS_ITEMS_POINT]: statusItems.receiver(), [SESSION_OWNERS_POINT]: ownersReceiver},
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[CONVERSATION_VIEW]: view, [SESSIONS_VIEW]: sessionsView},
                    [EDITOR_PAGES_POINT]: {[CONVERSATION_PAGE]: page, [REQUESTS_PAGE]: requestsPage},
                    [WORKBENCH_STATUSBAR_ITEMS_POINT]: {[ACTIVITY_ITEM]: item},
                    [COMMANDS_POINT]: commandImplementations,
                    [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                    [SETTINGS_PAGES_POINT]: {[PROFILES_SECTION]: settingsPage(async () => profilesPage((await import("./components/ProfileSettingsPage.vue")).default, {
                        settings,
                        remote,
                        pluginNames: async () => {
                            const listed = await context.remote.use(pluginsRegistryContract).list({});
                            if (!listed.ok) {
                                report("plugin-names-failed", listed.code);
                                return new Map();
                            }
                            return new Map(listed.value.plugins.flatMap((plugin) => (plugin.displayName === undefined ? [] : [[plugin.id, plugin.displayName] as const])));
                        },
                        models: {snapshot: modelsSnapshot, failed: modelsFailed, ensure: ensureModels},
                        writers: profileWriters,
                        text,
                        openAddress,
                        report,
                        skills,
                        stickerPacks,
                    })), [STATUS_LINE_SECTION]: settingsPage(async () => statusLinePage((await import("./components/StatusLinePage.vue")).default, {settings, items: statusItems, writer: statusLineWriter, text})), [PERMISSIONS_SECTION]: settingsPage(async () => permissionsPage((await import("./components/PermissionRulesPage.vue")).default, {settings, remote, project: windowProject.project?.id ?? null, text, writer: rulesWriter, report})), [SKILLS_SECTION]: settingsPage(async () => {
                        const [{skillsPage}, {default: page}] = await Promise.all([import("./skills-page"), import("./components/SkillsSettingsPage.vue")]);
                        return skillsPage(page, {skills, remote, openAddress, notify: (input) => void notifications.notify(input), report});
                    })},
                },
            };
        },
    })],
};
