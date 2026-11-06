/**
 * `nbook.agent` 浏览器入口（docs/specs/agent/conversation.md）：贡献对话视图、会话面板、编辑区页面、状态栏的活动条目与命令。`onStartup` 激活，只放声明与
 * 活动条目（`activity.ts`）；视图、宿主与 nb-agent-ui 的 Vue 层用到时才加载，打开窗口不多花时间。
 */

import {markRaw, defineComponent, h, onBeforeUnmount, shallowRef} from "vue";
import type {Component} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {COMMANDS_POINT, commandServiceKey} from "nbook/plugins/commands/shared/contracts";
import type {CommandImplementation, WrittenCommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {EDITOR_PAGES_POINT, OPEN_PAGE_COMMAND} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import type {EditorPageImplementation} from "nbook/plugins/editor/web/pages";
import {markdownKey} from "nbook/plugins/markdown/shared/contracts";
import {projectFilesContract} from "nbook/plugins/files/shared/contracts";
import {modelsSettingsContract} from "nbook/plugins/models/shared/contracts";
import type {ModelsSnapshot} from "nbook/plugins/models/shared/contracts";
import {roleReference} from "nbook/plugins/models/shared/rules";
import {builtinRoleNameKey, modelsText} from "nbook/plugins/models/shared/text";
import {displayLocale, OPEN_SETTINGS_COMMAND, settingsKey} from "nbook/plugins/settings/shared/contracts";
import {PUBLIC_STATE_POINT} from "nbook/plugins/state/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {quickPickKey, WORKBENCH_STATUSBAR_ITEMS_POINT, WORKBENCH_VIEWS_POINT} from "nbook/plugins/workbench/shared/contracts";
import type {ItemDeclaration} from "nbook/plugins/workbench/shared/items";
import type {WrittenViewDeclaration} from "nbook/plugins/workbench/shared/views";
import type {ItemImplementation, ViewImplementation} from "nbook/plugins/workbench/web/contracts";
import {clockKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {defineRecord} from "nbook/shared/storage";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";
import {windowTextKey, windowTextPort} from "nbook/shared/window-text";

import {Type} from "typebox";

import type {AgentConversationServices, ComposerModelView} from "@notnotype/nb-agent-ui";

import {descriptor} from "../plugin";
import {MAIN_PROFILE} from "../shared/contracts";
import type {ProfileEntry} from "../shared/contracts";
import {agentSessionsContract} from "../shared/remote";
import {agentSettings} from "../shared/settings";
import {agentText} from "../shared/text";
import {createAgentActivity} from "./activity";
import {ATTACHMENT_LIMIT_BYTES} from "../shared/attachments";
import {createFileMentions} from "./mentions";
import {draftOf, DraftsSchema, NO_DRAFTS, withDraft} from "./drafts";
import {createSessionHost} from "./session-host";
import type {RoleOption, SessionHost, UploadedAttachment} from "./session-host";
import {createSessionList} from "./session-list";

export const CONVERSATION_VIEW = "nbook.agent.conversation";
export const SESSIONS_VIEW = "nbook.agent.sessions";
export const CONVERSATION_PAGE = "nbook.agent.conversation";
const ACTIVITY_ITEM = "nbook.agent.activity";
export const OPEN_COMMAND = "nbook.agent.open";
export const NEW_SESSION_COMMAND = "nbook.agent.new-session";
export const FOCUS_SESSION_COMMAND = "nbook.agent.focus-session";
export const OPEN_IN_EDITOR_COMMAND = "nbook.agent.open-in-editor";
/** 别的插件的命令，公开合同：打开编辑器的文件（docs/specs/workbench/editor.md）、打开视图（docs/specs/workbench/views.md 输出 14）。 */
const EDITOR_OPEN_COMMAND = "nbook.editor.open";
const OPEN_VIEW_COMMAND = "nbook.view.open";

const CONVERSATION_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-message-square", location: "auxiliarybar", order: 0, layout: "fill"};
const SESSIONS_DECLARATION: WrittenViewDeclaration = {icon: "i-lucide-messages-square", location: "sidebar", order: 50, layout: "fill"};
const PAGE_DECLARATION: Omit<EditorPageDeclaration, "title"> & {title?: never} = {icon: "i-lucide-message-square"};
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
};

const agentState = definePublicState(descriptor.id, {
    active: {type: "boolean", unready: false, reason: agentText("state.active.reason")},
});

const RecentSchema = Type.Object({id: Type.Union([Type.String(), Type.Null()])}, {additionalProperties: false});
/** 按位置（视图、页面）分键；作品范围按作品分区，没有打开作品时放用户层（输出：当前会话）。 */
const DRAFTS_RECORD = defineRecord({key: "agent.drafts", scope: "user", locality: "local", version: 1, keyed: true, schema: DraftsSchema});
const recentRecord = (project: boolean) => defineRecord({key: "agent.recent-session", scope: project ? "project" : "user", locality: "local", version: 1, keyed: true, schema: RecentSchema});

/** 有凭据：不要密钥的服务商，或者密钥已经设了。 */
function hasCredentials(provider: ModelsSnapshot["providers"][number]): boolean {
    return provider.key.kind === "stored" || provider.key.kind === "keyless" || (provider.key.kind === "env" && provider.key.found);
}

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

export const agentBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "browser",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: commandServiceKey}, {key: windowProjectKey}, {key: settingsKey}, {key: storageKey}, {key: clockKey}, {key: quickPickKey}, {key: markdownKey}, {key: windowTextKey, required: false}],
        contributions: [
            {capability: WORKBENCH_VIEWS_POINT, id: CONVERSATION_VIEW, declaration: CONVERSATION_DECLARATION},
            {capability: WORKBENCH_VIEWS_POINT, id: SESSIONS_VIEW, declaration: SESSIONS_DECLARATION},
            {capability: EDITOR_PAGES_POINT, id: CONVERSATION_PAGE, declaration: PAGE_DECLARATION},
            {capability: WORKBENCH_STATUSBAR_ITEMS_POINT, id: ACTIVITY_ITEM, declaration: ACTIVITY_DECLARATION},
            ...Object.entries(COMMANDS).map(([id, declaration]) => ({capability: COMMANDS_POINT, id, declaration})),
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
            const text = await windowTextPort(context.services, () => displayLocale(settings));
            const remote = context.remote.use(agentSessionsContract);
            const report = (code: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
                diagnostics.record({level: "warn", event: `agent.${code}`, message, data, source: {plugin: descriptor.id}});
            };

            const activity = createAgentActivity(remote, (message) => report("activity-failed", message));
            // Lab 窗口不看活动（Component Lab 只在开发模式，直接开它不该多一个订阅）。
            if (browser.location?.pathname.startsWith("/lab") !== true) void activity.start(context.signal);

            const project = windowProject.project?.id ?? null;
            const profiles = shallowRef<readonly ProfileEntry[]>([]);
            const loadProfiles = async (): Promise<void> => {
                const result = await remote.profiles({});
                if (result.ok) profiles.value = result.value;
                else report("profiles-failed", result.code);
            };
            const models = shallowRef<readonly ComposerModelView[] | null>(null);
            const roles = shallowRef<readonly RoleOption[] | null>(null);
            const takeModels = (snapshot: ModelsSnapshot): void => {
                // 先换角色：宿主看着 `models` 重读会话的模型，这时角色应当已经是新的。
                roles.value = roleOptions(snapshot);
                models.value = modelOptions(snapshot);
            };
            let started = false;
            /** 第一次有对话位置时才取：没打开对话的窗口不多发请求。 */
            const ensureStarted = (): void => {
                if (started) return;
                started = true;
                void loadProfiles();
                void (async () => {
                    const modelsRemote = context.remote.use(modelsSettingsContract);
                    const subscription = await modelsRemote.events.changed.subscribe({}, takeModels);
                    if (!subscription.ok) {
                        // 模型服务不在是正常情况（下拉隐藏），别的失败下一个对话位置再试。
                        report("models-failed", subscription.code);
                        started = false;
                        return;
                    }
                    context.signal.addEventListener("abort", () => subscription.value.release(), {once: true});
                    const snapshot = await modelsRemote.snapshot({});
                    if (snapshot.ok) takeModels(snapshot.value);
                    else report("models-failed", snapshot.code);
                })().catch((error: unknown) => report("models-failed", String(error)));
            };

            const openRecent = async (position: string) => {
                const opened = await storage.open(recentRecord(project !== null), position);
                return opened.ok ? opened.handle : null;
            };
            const hosts = new Map<string, SessionHost>();
            /** 最近用过的位置：命令优先用它。 */
            let lastPosition = "view";
            const hostAt = (position: "view" | "page"): SessionHost => {
                let host = hosts.get(position);
                if (host !== undefined) return host;
                host = createSessionHost({
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
                    models: () => models.value,
                    roles: () => roles.value,
                    profiles: () => profiles.value,
                    copy: (value) => void browser.navigator?.clipboard?.writeText(value),
                    openSettings: () => void commands.execute(OPEN_SETTINGS_COMMAND),
                    openAddress: (address) => void commands.execute(EDITOR_OPEN_COMMAND, {address}),
                    openLink: (href) => void browser.open?.(href, "_blank", "noopener"),
                    report,
                });
                hosts.set(position, host);
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
                const [{builtinContributions}, {createAgentViewRegistry}, {default: ConversationHost}, {default: SessionPanelHost}, {default: AgentFormRenderer}] = await Promise.all([
                    import("@notnotype/nb-agent-ui/vue"),
                    import("@notnotype/nb-agent-ui"),
                    import("./ConversationHost.vue"),
                    import("./SessionPanelHost.vue"),
                    import("./form-renderer.vue"),
                ]);
                return {builtinContributions, createAgentViewRegistry, ConversationHost, SessionPanelHost, AgentFormRenderer};
            };
            let vue: ReturnType<typeof loadVue> | null = null;
            const vueOnce = () => (vue ??= loadVue());

            const conversationComponent = async (position: "view" | "page"): Promise<Component> => {
                ensureStarted();
                const {builtinContributions, createAgentViewRegistry, ConversationHost, AgentFormRenderer} = await vueOnce();
                const markdown = await context.services.resolve(markdownKey);
                const components = markdown.status === "resolved" ? markdown.instance.components : null;
                const registry = createAgentViewRegistry(builtinContributions);
                const renderers = {
                    form: markRaw(AgentFormRenderer),
                    ...(components === null ? {} : {markdown: markRaw(components.MarkdownDisplay), promptEditor: markRaw(components.PromptEditor), promptTextView: markRaw(components.PromptTextView)}),
                };
                const labels = panelLabels();
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
                    onChange: () => {
                        services.value = {resolveAttachmentUrl: attachmentUrl, resolveTriggerMenu: (context) => mentions.resolve(context)};
                    },
                });
                services.value = {resolveAttachmentUrl: attachmentUrl, resolveTriggerMenu: (context) => mentions.resolve(context)};
                return defineComponent({
                    name: "AgentConversationPosition",
                    inheritAttrs: false,
                    setup() {
                        lastPosition = position;
                        // 页面标签关了或切走了：命令回到右栏，不再把它开回来。
                        onBeforeUnmount(() => {
                            if (lastPosition === position) lastPosition = "view";
                        });
                        return () => h(ConversationHost, {host: hostAt(position), list, registry, renderers, services: services.value, pickProfile, labels});
                    },
                });
            };

            const view: ViewImplementation = {load: () => conversationComponent("view")};
            const page: EditorPageImplementation = {load: () => conversationComponent("page")};
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
                [FOCUS_SESSION_COMMAND]: {run: async (args) => {
                    const sessionId = (args as {sessionId?: string} | undefined)?.sessionId ?? activity.target.value;
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
                contributions: {
                    [WORKBENCH_VIEWS_POINT]: {[CONVERSATION_VIEW]: view, [SESSIONS_VIEW]: sessionsView},
                    [EDITOR_PAGES_POINT]: {[CONVERSATION_PAGE]: page},
                    [WORKBENCH_STATUSBAR_ITEMS_POINT]: {[ACTIVITY_ITEM]: item},
                    [COMMANDS_POINT]: commandImplementations,
                    [PUBLIC_STATE_POINT]: Object.fromEntries(published.bindings),
                },
            };
        },
    })],
};
