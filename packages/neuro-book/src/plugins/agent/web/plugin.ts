/**
 * `nbook.agent` 浏览器入口（docs/specs/agent/conversation.md）：贡献对话视图、会话面板、编辑区页面、状态栏的活动条目与命令。`onStartup` 激活，只放声明与
 * 活动条目（`activity.ts`）；视图、宿主与 nb-agent-ui 的 Vue 层用到时才加载，打开窗口不多花时间。
 */

import type {PaintRecord} from "./paint-metric";
import {computed, markRaw, defineAsyncComponent, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch} from "vue";
import type {Component, ShallowRef} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import type {ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import {stickerPickerKey, stickersCatalogContract} from "nbook/plugins/stickers/shared/contracts";
import type {StickerPicker} from "nbook/plugins/stickers/shared/contracts";
import type {CommandImplementation, CommandResult, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_PAGES_POINT, OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {markdownKey} from "nbook/plugins/markdown/shared/contracts";
import {projectFilesContract} from "nbook/plugins/files/shared/contracts";
import {createSelectionData, modelsSettingsContract, PROVIDERS_SECTION} from "nbook/plugins/models/shared/contracts";
import type {ModelRow, ModelsSnapshot, SelectionRemote, SelectionRow} from "nbook/plugins/models/shared/contracts";
import {pluginsRegistryContract} from "nbook/plugins/plugins/shared/contracts";
import {displayLocale, OPEN_SETTINGS_COMMAND, SETTINGS_PAGES_POINT, settingsKey} from "nbook/plugins/settings/shared/contracts";
import type {WrittenSettingsPageDeclaration} from "nbook/plugins/settings/shared/sections";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {notificationsKey, quickPickKey, VIEW_HEAD, VIEW_OWN_HEAD, viewHeadOf, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ViewHeadOptIn, ViewOwnHeadOptIn} from "nbook/plugins/workbench/shared/contracts";
import type {ItemDeclaration} from "nbook/plugins/workbench/shared/items";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation, ViewContext, ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {clockKey} from "nbook/shared/host";
import {PROJECTS_DESK_POINT} from "nbook/plugins/projects/shared/contracts";
import type {DeskImplementation} from "nbook/plugins/projects/web/desk";
import {windowProjectKey} from "nbook/shared/projects";
import {defineRecord} from "nbook/shared/storage";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";
import {windowTextKey, windowTextPort} from "nbook/shared/window-text";
import {providerIcon} from "nbook/ui/provider-icons";
import {settingsFailureText} from "nbook/ui/settings/setting-text";

import {Type} from "typebox";

import type {AgentConversationServices, AgentViewRegistry, AgentWelcomeView, ComposerGroupView, ComposerIcon, ComposerModelView, RequestTraceAction, RequestTraceQuery} from "@notnotype/nb-agent-ui";

import {descriptor} from "../plugin";
import {MAIN_PROFILE, SESSION_OWNERS_POINT, sessionOwnersPoint, stickerAllowlistUsageKey} from "../shared/contracts";
import type {ProfileEntry, SessionOwnerProvider} from "../shared/contracts";
import type {SessionOwner} from "@notnotype/nb-harness/kernel/contracts";
import {agentSessionsContract} from "../shared/remote";
import {agentSettings, PERMISSIONS_SECTION, PROFILES_SECTION, REQUESTS_SECTION, SKILLS_SECTION, STATUS_LINE_SECTION} from "../shared/settings";
import {STATUS_ITEMS_POINT, statusItemsPoint} from "../shared/status-item-point";
import type {SettingWriteResult} from "nbook/shared/settings";
import {MESSAGES_HEAD_BAND} from "./messages-head";
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
import {gatedProvider} from "./owner-providers";
import {createSessionHost} from "./session-host";
import {modelGroups, modelOptions, roleOptions} from "./model-options";
import type {RoleOption, SessionHost, SessionHostDeps, SessionOwners, UploadedAttachment} from "./session-host";
import {createRecentSessions, createSessionList} from "./session-list";
import {createRunResults, createSeenErrors} from "./subagents-panel";
import {RequestsPage, useRequests} from "./requests-page";
import {requestEntriesContribution} from "./request-entries";

export const CONVERSATION_VIEW = "nbook.agent.conversation";
export const CONVERSATION_PAGE = "nbook.agent.conversation";
/** 对话位置：右栏的消息视图、编辑区页面、书房的看板娘面板。各有一个宿主，Skill 初始化的确认框与最近的会话按位置分开。 */
type ConversationPosition = "view" | "page" | "desk";

const ACTIVITY_ITEM = "nbook.agent.activity";
/** 书房案头看板娘那一格上的入口（`projects.desk`）。 */
const DESK_CONTRIBUTION = "nbook.agent.desk";
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

/**
 * “消息”视图（conversation.md 输出 1–3）：沿用对话视图的 id 与位置，已有的布局记录里它就在右栏，不用迁移；取代以前左侧栏的会话面板
 * （`replaces`，workbench/views.md 输出 20）。
 */
const CONVERSATION_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-messages-square", location: "auxiliarybar", order: 0, layout: "fill", replaces: ["nbook.agent.sessions"]};
const PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> & {title?: never} = {icon: "i-lucide-message-square"};
const REQUESTS_PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> & {title?: never} = {icon: "i-lucide-activity"};
const ACTIVITY_DECLARATION: ItemDeclaration = {title: agentText("conversation.activity.title"), alignment: "right", order: 50, priority: 50, command: {id: FOCUS_SESSION_COMMAND}, when: {requires: ["nbook.agent/attention"]}};
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
    /**
     * 状态栏的 Agent 活动条目要不要出现：有会话在跑或等你处理，或者归属插件的联系人有未读（右栏收起时入口角标看不到，这里补上）。
     * 不并进 `active`：主题按 `active` 换“工作中”场景（theme/skins.md 输出 17），有未读不算在工作。
     */
    attention: {type: "boolean", unready: false, reason: agentText("state.attention.reason")},
});

const RecentSchema = Type.Object({id: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false});
/** 按位置（视图、页面）分键；作品范围按作品分区，没有打开作品时放用户层（输出：当前会话）。 */
const DRAFTS_RECORD = defineRecord({key: "agent.drafts", scope: "user", locality: "local", version: 1, keyed: true, schema: DraftsSchema});
const recentRecord = (project: boolean) => defineRecord({key: "agent.recent-session", scope: project ? "project" : "user", locality: "local", version: 1, keyed: true, schema: RecentSchema});

/** 附件地址换成读取路由。不是附件的（别的方案）不显示。 */
function attachmentUrl(locator: string): string | null {
    const match = /^sessions:\/\/([^/]+)\/home\/attachments\/([^/]+)$/u.exec(locator);
    return match === null ? null : `/api/${descriptor.id}/sessions/${encodeURIComponent(match[1]!)}/attachments/${encodeURIComponent(match[2]!)}`;
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
        provides: [stickerAllowlistUsageKey],
        dependencies: [{key: diagnosticsKey}, {key: commandServiceKey}, {key: windowProjectKey}, {key: settingsKey}, {key: storageKey}, {key: clockKey}, {key: quickPickKey}, {key: notificationsKey}, {key: markdownKey}, {key: windowTextKey, required: false}, {key: stickerPickerKey, required: false}],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: CONVERSATION_VIEW, declaration: CONVERSATION_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: CONVERSATION_PAGE, declaration: PAGE_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: REQUESTS_PAGE, declaration: REQUESTS_PAGE_DECLARATION},
            {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id: ACTIVITY_ITEM, declaration: ACTIVITY_DECLARATION},
            {capability: PROJECTS_DESK_POINT, id: DESK_CONTRIBUTION, declaration: {}},
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
            /** 首屏指标（conversation.md 输出 56）：量在 `ConversationHost.vue` 里（碰 DOM），这里只给诊断出口。 */
            const recordPaint = (level: "info" | "warning", record: PaintRecord): void => {
                const slow = level === "warning";
                diagnostics.record({
                    level: slow ? "warn" : "info",
                    event: slow ? "agent.conversation-paint-slow" : "agent.conversation-painted",
                    message: `${record.position} 打开 ${record.sessionId} 到画出 ${String(record.ms)} 毫秒（${String(record.events)} 个事件、${String(record.messages)} 条消息）`,
                    data: {...record},
                    source: {plugin: descriptor.id},
                });
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
            const initAt = (position: ConversationPosition): SkillInit => {
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
            const groups = shallowRef<readonly ComposerGroupView[]>([]);
            /** 没过滤的快照：Profile 设置页要看已绑定但用不了的模型。 */
            const modelsSnapshot = shallowRef<ModelsSnapshot | null>(null);
            const modelsFailed = shallowRef(false);
            /** 有没有可用的模型（点 bot 联系人之前看，bots/view.md）：模型服务读不到当成有，对话里的提示兜底；还没读到为 null。 */
            const hasModel = computed(() => (modelsFailed.value ? true : modelsSnapshot.value === null ? null : modelsSnapshot.value.providers.length > 0));
            const openModelSettings = (): void => {
                void commands.execute(OPEN_SETTINGS_COMMAND, {section: PROVIDERS_SECTION, focus: "add", layer: "user"}).then((result) => {
                    if (!result.ok) report("open-settings-failed", `opening the model providers failed: ${result.code}`);
                });
            };
            /** 选用数据（只要有凭据的服务商里可用的模型）：选择器与标签用；Profile 页另取按引用的行。 */
            const selection = shallowRef<ReturnType<typeof createSelectionData> | null>(null);
            /** Profile 设置页读的两份：能选的模型、按引用取到的行（角色绑着的与各 Profile 指名的）。 */
            const profileRows = shallowRef<readonly SelectionRow[]>([]);
            const profileLookup = shallowRef<ReadonlyMap<string, ModelRow | null>>(new Map());
            let roleReferences: readonly string[] = [];
            let pageReferences: readonly string[] = [];
            const wantReferences = (): void => selection.value?.want([...roleReferences, ...pageReferences]);
            /**
             * 选用数据换了（行读完、引用取到）或来了新快照：重算角色的模型名与模型列表。角色先于模型换：宿主看着 `models` 重读会话的模型，
             * 这时角色应当已经是新的。`models` 只在它的两样输入（快照、行）真的换了时才重算：宿主每见一次新值就重取一次会话快照。
             */
            let modelsBuiltFrom: {readonly snapshot: ModelsSnapshot; readonly rows: readonly SelectionRow[]} | null = null;
            const rebuild = (options: {readonly models: boolean} = {models: true}): void => {
                const snapshot = modelsSnapshot.value;
                const data = selection.value;
                if (snapshot === null || data === null) return;
                profileRows.value = data.rows.value;
                profileLookup.value = data.lookup.value;
                roles.value = roleOptions(snapshot, data.lookup.value);
                if (!options.models || !data.ready.value) return;
                if (modelsBuiltFrom?.snapshot === snapshot && modelsBuiltFrom.rows === data.rows.value) return;
                modelsBuiltFrom = {snapshot, rows: data.rows.value};
                models.value = modelOptions(snapshot, data.rows.value);
            };
            const takeModels = (snapshot: ModelsSnapshot): void => {
                modelsSnapshot.value = snapshot;
                groups.value = modelGroups(snapshot);
                modelsFailed.value = false;
                roleReferences = snapshot.roles.flatMap((role) => (role.model === null ? [] : [role.model]));
                wantReferences();
                // 要重读行时先不重算模型列表：等行到齐的那次通知一起算，不交出新快照配旧行的中间状态。
                const rereads = selection.value?.attach(snapshot) ?? false;
                rebuild({models: !rereads});
            };
            let modelsStarted = false;
            /** 第一次有对话位置或打开 Profile 页时才取：两个都没打开的窗口不多发请求。 */
            const ensureModels = (): void => {
                if (modelsStarted) return;
                modelsStarted = true;
                void (async () => {
                    const modelsRemote = context.remote.use(modelsSettingsContract);
                    const data = createSelectionData({remote: modelsRemote as unknown as SelectionRemote, ref: (initial) => shallowRef(initial), usable: true, onFailure: (code) => report("models-failed", code)});
                    data.subscribe(() => rebuild());
                    selection.value = data;
                    context.signal.addEventListener("abort", () => data.dispose(), {once: true});
                    const subscription = await modelsRemote.events.changed.subscribe({}, takeModels);
                    if (!subscription.ok) {
                        // 模型服务不在是正常情况（下拉隐藏），别的失败下一个对话位置再试。
                        report("models-failed", subscription.code);
                        modelsFailed.value = true;
                        modelsStarted = false;
                        // 下一个对话位置会再建一份：这一份放掉。
                        data.dispose();
                        selection.value = null;
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

            const openRecent = async (position: ConversationPosition) => {
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
             * 子代理管理（conversation.md 输出 43）：出错看过没有、收口结果的缓存，几个对话位置（右栏、编辑区页面、书房的面板）共用。激活之前收口的出错算看过；
             * 切到哪个会话，它此前的出错就算看过（不论从卡片、停靠区还是浮层切过去）。
             */
            const seenErrors = createSeenErrors(clock.now());
            const runResults = createRunResults((message) => report("run-result-failed", message));
            const hosts = new Map<string, SessionHost>();
            /** 最近用过的位置：命令优先用它。 */
            let lastPosition = "view";
            /**
             * 归属插件（conversation.md 输出 53）：每个插件至多一条贡献，第二条不接、记诊断。发布与撤回换整个列表：消息视图的 bot 一页、
             * 视图计数、顶栏的身份都在计算里读它，晚激活或被停用的归属插件也跟着变。按插件 id 排。
             */
            const providers = shallowRef<readonly {readonly plugin: string; readonly id: string; readonly provider: SessionOwnerProvider}[]>([]);
            const ownersReceiver: ContributionReceiver<unknown, SessionOwnerProvider> = {
                published: (handle) => {
                    if (providers.value.some((entry) => entry.plugin === handle.plugin)) {
                        report("owner-duplicate", `${handle.plugin} 的第二条 ${SESSION_OWNERS_POINT} 贡献 ${handle.id} 不接：每个插件至多一条`);
                        return;
                    }
                    providers.value = [...providers.value, {plugin: handle.plugin, id: handle.id, provider: gatedProvider(handle)}].sort((a, b) => (a.plugin < b.plugin ? -1 : a.plugin > b.plugin ? 1 : 0));
                },
                revoke: (handle) => {
                    providers.value = providers.value.filter((entry) => entry.id !== handle.id);
                },
            };
            const providerOf = (plugin: string): SessionOwnerProvider | null => providers.value.find((entry) => entry.plugin === plugin)?.provider ?? null;
            /** 会话头读不到、打开前就能确定打不开的码：`focus-session` 交回失败（conversation.md 输出 53）。 */
            const UNOPENABLE: ReadonlySet<string> = new Set(["session-not-found", "log-corrupt", "needs-migration"]);
            /** 会话的归属表：插件级一份，几个宿主与 `focus-session` 共用。会话头里的归属建会话时定下、不会变，读到就记住。 */
            const ownerTable = new Map<string, SessionOwner | null>();
            const sessionOwners: SessionOwners = {
                known: (id) => ownerTable.get(id),
                ownerOf: async (id) => {
                    const known = ownerTable.get(id);
                    if (known !== undefined) return known;
                    const read = await remote.header({sessionId: id});
                    if (!read.ok) return read.code === "session-not-found" ? "missing" : "unreadable";
                    const owner = read.value.owner ?? null;
                    ownerTable.set(id, owner);
                    return owner;
                },
                identity: (owner) => {
                    const contact = providerOf(owner.plugin)?.contacts.value.find((candidate) => candidate.id === owner.id);
                    return contact === undefined ? null : {name: contact.name, ...(contact.avatar === undefined ? {} : {avatar: contact.avatar})};
                },
                seenOf: (owner) => providerOf(owner.plugin)?.contacts.value.find((candidate) => candidate.id === owner.id)?.seenSeq ?? null,
            };
            /** 会话树的根有没有归属（这个会话本身，或它的祖先链里的根）：`focus-session` 据此决定打开到消息视图。读不到时当成没有，照旧。 */
            const ownedTree = async (id: string): Promise<boolean> => {
                const owner = await sessionOwners.ownerOf(id);
                if (owner === "missing") return false;
                if (owner !== null && owner !== "unreadable") return true;
                // 没有归属，或这个会话的头读不出来（祖先关系还在）：看祖先链的根。读不出来不代替它自己的档位，只决定打开到哪里。
                const ancestors = await remote.ancestors({sessionId: id});
                return ancestors.ok && ancestors.value.at(-1)?.owner !== undefined;
            };
            /** 第一个有未读、已经有主对话的联系人的会话：状态栏“N 条新消息”点进去打开它。 */
            const unreadSession = (): string | null => {
                for (const {provider} of providers.value) {
                    const contact = provider.contacts.value.find((candidate) => (candidate.unread ?? 0) > 0 && candidate.sessionId !== null);
                    if (contact !== undefined) return contact.sessionId;
                }
                return null;
            };
            /** 消息视图的版式与列表栏收起：插件作用域一份，视图换代时接着用（只在内存，重开窗口回到缺省）。 */
            const messagesMemory = reactive({layout: "narrow" as "wide" | "narrow", listCollapsed: false, listWidth: 260});

            /** 对话位置（右栏的消息视图、编辑区页面、书房的面板）共用的依赖；`position` 分开最近用过的记录与 Skill 初始化的确认框。 */
            const hostDeps = (position: ConversationPosition): SessionHostDeps => ({
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
                    groups: () => groups.value,
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
            /** 各位置的宿主随插件活着：插件关闭时停掉监视。 */
            const watchSeen = (host: SessionHost): void => {
                const stopSeen = watch(host.sessionId, (id) => {
                    if (id !== null) seenErrors.markSession(id, clock.now());
                }, {immediate: true});
                context.signal.addEventListener("abort", stopSeen, {once: true});
            };
            const hostAt = (position: ConversationPosition): SessionHost => {
                let host = hosts.get(position);
                if (host !== undefined) return host;
                // 编辑区页面不开有归属的会话：交给消息视图（页面没有联系人列表，也不记“看到”）。
                // 编辑区页面把有归属的会话转给消息视图，等它的结果：打不开时写一条提示，不当作已经打开（conversation.md 输出 53）。
                const owners: SessionOwners = position === "page" ? {...sessionOwners, elsewhere: async (id) => {
                    const focused = await commands.execute(FOCUS_SESSION_COMMAND, {sessionId: id});
                    if (!focused.ok) void notifications.notify({tone: "warning", message: focused.reason});
                }} : sessionOwners;
                // 书房的面板只开点看板娘打开的那个主对话：不恢复、不记最近的会话。
                const deps = position === "desk" ? {...hostDeps(position), recent: {read: async () => null, write: () => undefined}} : hostDeps(position);
                host = createSessionHost({...deps, owners});
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

            /** 第一屏的最近对话（conversation.md 输出 41）：各对话位置共用一份，与会话面板那份分开。 */
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
                const [{builtinContributions}, {createAgentViewRegistry}, {default: ConversationHost}, {default: MessagesHost}, {default: AgentFormRenderer}, {default: SubagentCard}, {default: BackgroundCommandCard}, {subagentContribution}, {default: EvalDetail}, {evalContribution}] = await Promise.all([
                    import("@notnotype/nb-agent-ui/vue"),
                    import("@notnotype/nb-agent-ui"),
                    import("./ConversationHost.vue"),
                    import("./MessagesHost.vue"),
                    import("./form-renderer.vue"),
                    import("./components/SubagentCard.vue"),
                    import("./components/BackgroundCommandCard.vue"),
                    import("./subagent-renderers"),
                    import("./components/EvalDetail.vue"),
                    import("./eval-renderer"),
                ]);
                return {builtinContributions, createAgentViewRegistry, ConversationHost, MessagesHost, AgentFormRenderer, SubagentCard, BackgroundCommandCard, subagentContribution, EvalDetail, evalContribution};
            };
            let vue: ReturnType<typeof loadVue> | null = null;
            const vueOnce = () => (vue ??= loadVue());

            /**
             * 对话位置共用的部分：注册表的登记项、渲染组件，与按会话的 Profile 取白名单的菜单服务（`servicesFor` 每个对话一份，交回取消
             * 监听的函数）。各对话位置都用它。
             */
            const conversationParts = async () => {
                ensureStarted();
                const {builtinContributions, createAgentViewRegistry, AgentFormRenderer, SubagentCard, BackgroundCommandCard, subagentContribution, EvalDetail, evalContribution} = await vueOnce();
                const markdown = await context.services.resolve(markdownKey);
                const components = markdown.status === "resolved" ? markdown.instance.components : null;
                const stickers = picker === null ? null : await stickersContribution(picker, (message, error) => report("sticker-picker-failed", `${message}: ${String(error)}`));
                const baseContributions = [...builtinContributions, subagentContribution({card: SubagentCard}), evalContribution({detail: EvalDetail}), requestEntriesContribution, ...(stickers === null ? [] : [stickers.contribution])];
                const renderers = {
                    // 图标解析端口：在渲染里调，`providerIcon` 读的表是响应式的，表晚到时用到图标的地方自动重画。
                    icons: (icon: ComposerIcon) => {
                        if (icon.kind !== "key" || icon.set !== "provider") return null;
                        return providerIcon(icon.key);
                    },
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

            type ConversationParts = Awaited<ReturnType<typeof conversationParts>>;
            /** 状态栏里插件加的项随贡献的发布与撤回变：登记项变了重建注册表（注册表是只读的合并结果）。每个对话位置一份。 */
            const positionRegistry = (create: ConversationParts["createAgentViewRegistry"], base: ConversationParts["baseContributions"]) =>
                computed(() => create([...base, {source: "agent.statusItems", statusItems: statusItems.entries.value}]));

            /** 交给 `ConversationHost` 的那一大组属性：右栏、编辑区页面与书房的面板各按自己的宿主取一份。 */
            const conversationProps = (position: ConversationPosition, host: SessionHost, registry: AgentViewRegistry, services: AgentConversationServices, renderers: ConversationParts["renderers"]) => ({
                host,
                list,
                recent: recentSessions,
                welcome: welcomeOf(host),
                draftProfile: draftProfileOf(host),
                registry,
                renderers,
                services,
                pickProfile,
                labels: panelLabels(),
                skillInit: initAt(position),
                subagents: {profiles: profiles.value, seen: seenErrors, results: runResults},
                statusLine: {setting: settings.get(agentSettings.settings.statusLine), toggle: (id: string) => void statusLineWriter.toggle(id).then(reportStatusLineFailure), openSettings: () => openSettings({section: STATUS_LINE_SECTION, layer: "user"})},
                // 与宿主同一个时钟：起点是宿主按它记的。
                paint: {position, now: () => clock.now(), record: recordPaint},
            });

            const conversationComponent = async (position: "view" | "page"): Promise<Component> => {
                const {createAgentViewRegistry, baseContributions, renderers, servicesFor} = await conversationParts();
                const {ConversationHost, MessagesHost} = await vueOnce();
                const {services} = servicesFor(() => hostAt(position).profileKey());
                return defineComponent({
                    name: "AgentConversationPosition",
                    inheritAttrs: false,
                    // 右栏的视图拿到工作台给的上下文，经它取标题区（views.md 输出 19）；编辑区页面没有，头照旧画在内容里。
                    props: {context: {type: Object, default: null}},
                    setup(props) {
                        const head = position === "view" && props.context !== null ? viewHeadOf(props.context) : null;
                        const registry = positionRegistry(createAgentViewRegistry, baseContributions);
                        lastPosition = position;
                        // 页面标签关了或切走了：命令回到右栏，不再把它开回来。
                        onBeforeUnmount(() => {
                            if (lastPosition === position) lastPosition = "view";
                        });
                        return () => {
                            const host = hostAt(position);
                            const conversation = conversationProps(position, host, registry.value, services.value, renderers);
                            // 右栏是消息视图（列表、头像列加聊天区）；编辑区页面照旧只有对话，会话列表在头的下拉里。
                            if (position === "page" || props.context === null) return h(ConversationHost, {...conversation, head});
                            return h(MessagesHost, {context: props.context as ViewContext, conversation, host, list, providers: providers.value, activity: activity.items.value, hasModel: hasModel.value, openModelSettings, memory: messagesMemory});
                        };
                    },
                });
            };

            /**
             * 消息视图：窄版接管面板头的标题区（头写会话，按标题开列表抽屉），宽版交还（conversation.md 输出 44）。计数是各归属插件联系人的未读
             * 合计，写在面板头标题后与入口角标上（views.md 输出 17）；视图没打开时照样读。
             */
            const unreadTotal = computed(() => providers.value.reduce((sum, {provider}) => sum + provider.contacts.value.reduce((inner, contact) => inner + (contact.unread ?? 0), 0), 0));
            /**
             * 书房案头的看板娘入口与滑出聊天（conversation.md 输出 54）：只在书房画（`projects.desk`），书架画出来时才加载；面板里的对话第一次
             * 打开时才加载，宿主是 `desk` 位置的那一个。
             */
            const deskConversation = async (): Promise<Component> => {
                const {createAgentViewRegistry, baseContributions, renderers, servicesFor} = await conversationParts();
                const {ConversationHost} = await vueOnce();
                const {services} = servicesFor(() => hostAt("desk").profileKey());
                return defineComponent({
                    name: "AgentDeskConversation",
                    props: {close: {type: Function, required: true}},
                    setup(props, {expose}) {
                        const registry = positionRegistry(createAgentViewRegistry, baseContributions);
                        const inner = ref<{focusComposer(): void} | null>(null);
                        expose({focusComposer: () => inner.value?.focusComposer()});
                        return () => h(ConversationHost, {
                            ...conversationProps("desk", hostAt("desk"), registry.value, services.value, renderers),
                            head: null,
                            close: props.close as () => void,
                            noSessionList: true,
                            ref: inner,
                        });
                    },
                });
            };
            const desk: DeskImplementation = {
                load: async () => {
                    const {default: DeskCompanion} = await import("./components/DeskCompanion.vue");
                    const conversation = defineAsyncComponent(deskConversation);
                    return defineComponent({
                        name: "AgentDeskCompanion",
                        emits: ["update:mood"],
                        setup(_, {emit}) {
                            const host = hostAt("desk");
                            return () => h(DeskCompanion, {
                                providers: providers.value,
                                activity: activity.items.value,
                                hasModel: hasModel.value,
                                host,
                                conversation,
                                openModelSettings,
                                ensureStarted,
                                "onUpdate:mood": (mood: string) => emit("update:mood", mood),
                            });
                        },
                    });
                },
            };

            // 浮成只有它一个标签的窗时自绘整个头（workbench/views.md 输出 19 的“自绘头”）。
            const view: ViewImplementation & ViewHeadOptIn & ViewOwnHeadOptIn = {load: () => conversationComponent("view"), [VIEW_HEAD]: true, [VIEW_OWN_HEAD]: {band: MESSAGES_HEAD_BAND}, badge: () => (unreadTotal.value > 0 ? unreadTotal.value : null)};
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
            /** 把活的对话位置带到前面：优先最近用过的，其次打开默认右栏。 */
            /** 揭示上次用的位置；视图或页面揭示不了时交回那次命令的失败（conversation.md 输出 53）。 */
            const reveal = async (): Promise<CommandResult<SessionHost>> => {
                ensureStarted();
                const shown = lastPosition === "page" ? await commands.execute(OPEN_PAGE_COMMAND, {id: CONVERSATION_PAGE}) : await commands.execute(OPEN_VIEW_COMMAND, {viewId: CONVERSATION_VIEW});
                return shown.ok ? {ok: true, value: hostAt(lastPosition === "page" ? "page" : "view")} : shown;
            };
            const done = {ok: true, value: null} as const;
            const commandImplementations: Record<string, CommandImplementation> = {
                [OPEN_COMMAND]: {run: async () => {
                    const revealed = await reveal();
                    return revealed.ok ? done : revealed;
                }},
                [OPEN_IN_EDITOR_COMMAND]: {run: async () => {
                    ensureStarted();
                    lastPosition = "page";
                    await commands.execute(OPEN_PAGE_COMMAND, {id: CONVERSATION_PAGE});
                    return done;
                }},
                [NEW_SESSION_COMMAND]: {run: async () => {
                    const revealed = await reveal();
                    if (!revealed.ok) return revealed;
                    const profile = await pickProfile();
                    if (profile !== null) await revealed.value.create(profile ?? MAIN_PROFILE);
                    return done;
                }},
                [OPEN_REQUESTS_COMMAND]: {run: async (args) => {
                    await requestsOf().open((args as {sessionId?: string; request?: number} | undefined) ?? {});
                    await commands.execute(OPEN_PAGE_COMMAND, {id: REQUESTS_PAGE});
                    return done;
                }},
                [FOCUS_SESSION_COMMAND]: {run: async (args) => {
                    const sessionId = (args as {sessionId?: string} | undefined)?.sessionId ?? activity.target.value ?? unreadSession();
                    // 打开之前就能确定打不开的，交回失败（后台任务清单的“打开”据此提示）。每次都读：归属记过了不等于会话头此刻还读得出来。
                    // 读到的会话头顺手记进归属表，下面判归属不再读一次；别的读失败（例如暂时打不开）照常去打开，读快照的失败画在视图里
                    // （conversation.md 输出 53）。
                    if (sessionId !== null) {
                        const header = await remote.header({sessionId});
                        if (!header.ok && UNOPENABLE.has(header.code)) return {ok: false, code: "execution-error", reason: agentText("conversation.openFailed", {code: header.code})};
                        if (header.ok) ownerTable.set(sessionId, header.value.owner ?? null);
                    }
                    // 会话树的根有归属（bot 的主对话本身或它的子会话）：打开到消息视图，不去编辑区页面（conversation.md 输出 53）。
                    if (sessionId !== null && await ownedTree(sessionId)) {
                        ensureStarted();
                        const shown = await commands.execute(OPEN_VIEW_COMMAND, {viewId: CONVERSATION_VIEW});
                        if (!shown.ok) return shown;
                        await hostAt("view").open(sessionId);
                        return done;
                    }
                    const revealed = await reveal();
                    if (!revealed.ok) return revealed;
                    if (sessionId !== null) await revealed.value.open(sessionId);
                    return done;
                }},
            };

            /**
             * 状态栏的 Agent 活动条目：在跑、等你处理，没有这两样时写 bot 的新消息（t15 决定 7：右栏收起时角标看不到，这里补上），点了打开那个
             * bot。等你处理优先。
             */
            const item: ItemImplementation = {
                text: () => {
                    const running = activity.running.value;
                    const waiting = activity.waiting.value;
                    if (running > 0 && waiting > 0) return agentText("conversation.activity.both", {running, waiting});
                    if (waiting > 0) return agentText("conversation.activity.waiting", {waiting});
                    if (running === 0 && unreadTotal.value > 0) return agentText("conversation.activity.unread", {count: unreadTotal.value});
                    return agentText("conversation.activity.running", {running});
                },
                state: () => (activity.waiting.value > 0 ? "warning" : "normal"),
            };
            const published = bindingsOf(agentState, {active: activity.active, attention: computed(() => activity.active.value || unreadTotal.value > 0)});
            return {
                services: [provideService(stickerAllowlistUsageKey, {
                    profilesUsing: async (packId) => {
                        const listed = await remote.profiles({});
                        return listed.ok ? profilesUsingSticker(listed.value, settings.get(agentSettings.settings.profileSettings), packId) : null;
                    },
                })],
                receivers: {[STATUS_ITEMS_POINT]: statusItems.receiver(), [SESSION_OWNERS_POINT]: ownersReceiver},
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[CONVERSATION_VIEW]: view},
                    [EDITOR_PAGES_POINT]: {[CONVERSATION_PAGE]: page, [REQUESTS_PAGE]: requestsPage},
                    [PROJECTS_DESK_POINT]: {[DESK_CONTRIBUTION]: desk},
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
                            // 内置插件与没写显示名的第三方插件是 null（不是 undefined）：不进表，按内置名或 id 显示（`profile-page.ts` 的 `pluginName`）。
                            return new Map(listed.value.plugins.flatMap((plugin) => (plugin.displayName === null ? [] : [[plugin.id, plugin.displayName] as const])));
                        },
                        models: {snapshot: modelsSnapshot, failed: modelsFailed, ensure: ensureModels, rows: profileRows, lookup: profileLookup, want: (references) => {
                            pageReferences = references;
                            wantReferences();
                        }},
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
