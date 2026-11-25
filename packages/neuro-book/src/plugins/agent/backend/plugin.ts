/**
 * `nbook.agent` 的服务端入口：依赖、接收、激活与停止。装配在 `agent.ts`。
 *
 * 停止从 `context.signal` 开始：平台在停止时先撤回交给本入口接收者的贡献、再跑 `onStop`，而撤回会让打开着的会话
 * 重新装配、工具撤回还要等执行中的调用。所以信号一触发就关门、把会话按 `interrupted` 关掉（sessions.md 输出 14），
 * 之后的撤回落在已关的会话上什么也不做；`onStop` 等这次关闭完成。
 */

import {lstat, mkdir} from "node:fs/promises";
import {join} from "node:path";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideService, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {PluginDefinition, TriggerActivationResult} from "@notnotype/nb-runtime/plugins";

import {createDialects} from "@notnotype/nb-harness/kit/commands";
import {sessionMetaExtension} from "@notnotype/nb-harness/kit/sessions";
import {SessionEditStores} from "@notnotype/nb-harness/kit/tools";

import {SCHEMES_POINT, workspaceFilesKey} from "nbook/plugins/files/shared/contracts";
import {modelsKey} from "nbook/plugins/models/shared/contracts";
import {tasksKey} from "nbook/plugins/tasks/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {clockKey, runningWorkKey, stateRootKey} from "nbook/shared/host";
import {pluginPackagesKey} from "nbook/plugin-platform/backend/packages";
import {stickersServiceKey} from "nbook/plugins/stickers/shared/contracts";
import type {StickerPackEntry} from "nbook/plugins/stickers/shared/contracts";

import {descriptor} from "../plugin";
import {agentKey} from "../shared/contracts";
import {agentSessionsContract} from "../shared/remote";
import {agentRequestsContract} from "../shared/requests";
import {profileAgents} from "../shared/profile-agents";
import {agentSettings} from "../shared/settings";
import {AGENT_COMPACTION_PREFIX, AGENT_PROFILE_PREFIX, AGENT_SESSION_PREFIX, AGENT_TOOL_PREFIX, COMPACTION_METHODS_POINT, compactionMethodsPoint, evalObjectsPoint, EXTENSIONS_POINT, extensionsPoint, PROFILES_POINT, profilesPoint, SKILLS_POINT, skillsPoint, TOOLS_POINT, toolsPoint} from "../shared/points";

import {agentFacade, createAgentRuntime, revokeAgentFacade} from "./agent";
import {createAttachmentRoutes, sessionDirectoryExists} from "./attachments";
import {BUILTIN_TOOL_CONTRIBUTIONS, builtinTools} from "./builtin";
import {writeEvalDocs} from "./eval/objects";
import {EVAL_STATE_EXTENSION, EVAL_TOOL, evalDeclaration, evalStateExtension, evalTool, kernelEntry} from "./eval/tool";
import {BUILTIN_COMPACTION_CONTRIBUTIONS, builtinCompactionMethods} from "./compaction";
import {approvalPreview} from "./builtin/preview";
import {shellAutoBackground, shellBackground} from "./builtin/shell-background";
import {BUILTIN_PROFILE_CONTRIBUTIONS, builtinProfiles} from "./builtin/profiles";
import {MODES_CONTRIBUTIONS, modesImplementations} from "./permissions/modes";
import {readProjectRules} from "./permissions/project-rules";
import {GUARD_CONTRIBUTIONS, runGuards} from "./guards";
import {JOB_TOOL_CONTRIBUTIONS, jobTools} from "./jobs/tools";
import {ProfileShapes, SUBAGENTS_EXTENSION, subagentsPrompt} from "./subagents/prompt";
import {SUBAGENT_TOOL_CONTRIBUTIONS, subagentTools} from "./subagents/tools";
import {extensionReceiver} from "./extensions";
import {locateDocsRoot} from "./docs-root";
import {SkillCatalog, sourceRoot} from "./skills/catalog";
import {SKILLS_EXTENSION, skillsExtension} from "./skills/extension";
import {restoreSkills} from "./skills/restore";
import {STICKERS_EXTENSION, stickersExtension} from "./stickers/extension";
import {openFolder} from "./skills/folder";
import {SkillInstaller} from "./skills/install";
import {pluginSkillRoots} from "./skills/plugin-roots";
import {profileAllowlist} from "../shared/profile-allowlist";
import {agentRemote, PreviewTokens} from "./remote";
import {requestsRemote} from "./requests";
import {filesFor} from "./resources";
import {AGENT_SCHEMES, agentSchemes} from "./schemes";
import {SESSION_META_CONTRIBUTION, SESSION_META_EXTENSION} from "./session-meta";
import {SESSION_META_TAG} from "./builtin/profiles/session-title";
import {prepareTempContainer, sweepTemps} from "./temps";

const allActivated = (result: TriggerActivationResult): boolean => result.status === "triggered" && result.results.every((item) => item.status === "activated");

export const agentBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    activationEventPrefixes: [AGENT_SESSION_PREFIX, AGENT_TOOL_PREFIX, AGENT_PROFILE_PREFIX, AGENT_COMPACTION_PREFIX],
    contributionPoints: [extensionsPoint, toolsPoint, profilesPoint, compactionMethodsPoint, skillsPoint, evalObjectsPoint],
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: diagnosticsKey}, {key: settingsKey}, {key: stateRootKey}, {key: clockKey}, {key: workspaceFilesKey}, {key: modelsKey, required: false}, {key: tasksKey, required: false}, {key: runningWorkKey, required: false}, {key: pluginPackagesKey, required: false}, {key: stickersServiceKey, required: false}],
        provides: [agentKey],
        remoteProvides: [agentSessionsContract, agentRequestsContract],
        receives: [EXTENSIONS_POINT, TOOLS_POINT, PROFILES_POINT, COMPACTION_METHODS_POINT, SKILLS_POINT],
        contributions: [{capability: HTTP_ROUTES_POINT, id: descriptor.id, declaration: {}}, ...AGENT_SCHEMES.map((id) => ({capability: SCHEMES_POINT, id, declaration: {}})), ...BUILTIN_TOOL_CONTRIBUTIONS, ...JOB_TOOL_CONTRIBUTIONS, ...SUBAGENT_TOOL_CONTRIBUTIONS, ...BUILTIN_COMPACTION_CONTRIBUTIONS, ...BUILTIN_PROFILE_CONTRIBUTIONS, ...GUARD_CONTRIBUTIONS, ...MODES_CONTRIBUTIONS, SESSION_META_CONTRIBUTION, {capability: TOOLS_POINT, id: EVAL_TOOL, declaration: evalDeclaration}, {capability: EXTENSIONS_POINT, id: EVAL_STATE_EXTENSION, declaration: {}}, {capability: EXTENSIONS_POINT, id: SUBAGENTS_EXTENSION, declaration: {}}, {capability: EXTENSIONS_POINT, id: SKILLS_EXTENSION, declaration: {}}, {capability: EXTENSIONS_POINT, id: STICKERS_EXTENSION, declaration: {}}],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const report = (code: string, message: string, data?: Readonly<Record<string, unknown>>): void => {
                diagnostics.record({level: "warn", event: `agent.${code}`, message, ...(data === undefined ? {} : {data}), source: {plugin: descriptor.id}});
            };
            const models = await context.services.resolve(modelsKey);
            const tasks = await context.services.resolve(tasksKey);
            const pluginPackages = await context.services.resolve(pluginPackagesKey);
            const editStores = new SessionEditStores();
            const dialects = createDialects(() => context.services.require(settingsKey).get(agentSettings.settings.readOnlyCommands));
            // 用户的 Skill 在 `user://skills/`；内置的随应用分发，这一版还没有内置的 Skill；插件的随 `agent.skills` 贡献由接收者增删（skills.md 的来源）。
            // 目录按“在装”算状态，初始化又要从目录取 Skill：两者互相引用，安装器在目录打开之后接上。
            let skillInstaller: SkillInstaller | null = null;
            const userSkills = join(context.services.require(stateRootKey).path, "user", "skills");
            const skillCatalog = await SkillCatalog.open({
                roots: [sourceRoot("user", userSkills, true), sourceRoot("builtin", null, false)],
                clock: context.services.require(clockKey),
                report,
                installing: (id) => skillInstaller?.installing(id) ?? false,
            });
            const installer = new SkillInstaller({
                item: (id) => skillCatalog.item(id),
                refresh: (id) => skillCatalog.refresh(id),
                locksRoot: join(context.services.require(stateRootKey).path, "agent", "skills", "locks"),
                bun: process.execPath,
                clock: context.services.require(clockKey),
                // 没装 `nbook.tasks` 时安装照样能用，只是关掉确认框后看不到进度（skills.md 输出 29）。
                ...(tasks.status === "resolved" ? {tasks: tasks.instance} : {}),
            });
            skillInstaller = installer;
            const runtime = await createAgentRuntime({
                stateRoot: context.services.require(stateRootKey).path,
                settings: context.services.require(settingsKey),
                dialects,
                models: models.status === "resolved" ? models.instance : null,
                files: context.services.require(workspaceFilesKey),
                clock: context.services.require(clockKey),
                declarations: context.declarations,
                editStores,
                trigger: async (event) => allActivated(await context.activation.trigger(event, {signal: context.signal})),
                restoreMore: (args, previous) => restoreSkills({catalog: skillCatalog, report}, args, previous),
                report,
            });
            const attachmentRoutes = createAttachmentRoutes({
                files: context.services.require(workspaceFilesKey),
                hasSession: sessionDirectoryExists(runtime.sessionsRoot),
            });
            const clock = context.services.require(clockKey);
            // eval 的内核跟着这一次激活：会话关闭不结束内核（eval.md 输出 11），停止时会话都关完之后再全部结束。
            const evalTools = evalTool({entry: kernelEntry(), clock, toolsOf: (context) => runtime.codeTools(context), notices: runtime.evalNotices});
            const previews = new PreviewTokens(clock);
            const stateRoot = context.services.require(stateRootKey).path;
            const profilesRoot = join(stateRoot, "agent", "profiles");
            await mkdir(profilesRoot, {recursive: true});
            const tempContainer = await prepareTempContainer(stateRoot, (message) => report("temps-unavailable", message));
            // 注册方案之前清：这时新进程里没有工具在用这些临时目录（resources.md 输出 7）。只删能确定的：索引说已归档的，或会话
            // 目录已经不在的。索引读不了的会话不在列表里，但目录还在，按活会话保留。
            if (tempContainer !== null) {
                const archived = new Set((await runtime.listSessions()).filter((session) => session.archived).map((session) => session.id));
                await sweepTemps(tempContainer, async (session) => !archived.has(session) && (await lstat(join(runtime.sessionsRoot, session)).then(() => true, () => false)), (message) => report("temps-sweep", message));
            }
            const allowedSkills = (profile: string): ReadonlySet<string> => new Set(profileAllowlist(
                runtime.service.profiles().find((entry) => entry.key === profile)?.skills,
                context.services.require(settingsKey).get(agentSettings.settings.profileSettings)[profile]?.skills,
                skillCatalog.list().map((entry) => entry.id),
            ));
            // 表情包白名单（stickers.md 的“白名单”）：没装 `nbook.stickers` 时目录为空，槽没有内容。
            const stickerCatalog = await context.services.resolve(stickersServiceKey);
            const stickerPacks = (): readonly StickerPackEntry[] => (stickerCatalog.status === "resolved" ? stickerCatalog.instance.list() : []);
            const allowedStickers = (profile: string): readonly string[] => profileAllowlist(
                runtime.service.profiles().find((entry) => entry.key === profile)?.stickers,
                context.services.require(settingsKey).get(agentSettings.settings.profileSettings)[profile]?.stickers,
                stickerPacks().map((entry) => entry.id),
            );
            // 全局对象的文档（resources.md 输出 16）：声明在进程生命期内不变，激活时生成一次，`docs://eval/` 指到这里。
            const evalDocsContainer = join(stateRoot, "agent", "eval-docs");
            await writeEvalDocs(join(evalDocsContainer, "eval"), runtime.evalDocs());
            const schemes = agentSchemes({
                sessionsRoot: runtime.sessionsRoot,
                evalDocs: {container: evalDocsContainer, names: () => [...runtime.evalObjects.keys()]},
                profilesRoot,
                tempContainer,
                docsRoot: locateDocsRoot(),
                // 不列后台会话（resources.md 的方案表）：每个前台会话有一个标题会话，列出来会占满上限；按 id 仍然读得到。
                listSessions: async () => (await runtime.listSessions()).filter((session) => !session.archived && !session.background),
                profiles: () => runtime.service.profiles(),
                relations: runtime.relations,
                activity: () => runtime.sessions.activity().filter((item): item is {id: string; state: "running" | "waiting"} => item.state !== "held"),
                skills: {userRoot: join(stateRoot, "user", "skills"), list: () => skillCatalog.list(), item: (id) => skillCatalog.item(id), allowed: allowedSkills},
                allowedAgents: (profile) => profileAgents(runtime.service.profiles().find((entry) => entry.key === profile)?.agents, context.services.require(settingsKey).get(agentSettings.settings.profileSettings)[profile]?.agents).allowed,
            });
            const settings = context.services.require(settingsKey);
            const shapes = new ProfileShapes((key) => runtime.profiles.resolve(key));
            runtime.profileAdmin.onCatalogChanged(() => shapes.clear());
            const agentsBinding = (profile: string) => settings.get(agentSettings.settings.profileSettings)[profile]?.agents;
            const subagents = subagentsPrompt({catalog: () => runtime.service.profiles(), binding: agentsBinding}, shapes);
            const subagentToolImplementations = subagentTools({
                table: runtime.sessions,
                service: runtime.service,
                relations: runtime.relations,
                jobs: runtime.jobs,
                children: runtime.children,
                models: runtime.models,
                catalog: () => runtime.service.profiles(),
                binding: agentsBinding,
                resolveProfile: (key) => runtime.profiles.resolve(key),
                depthLimit: () => settings.get(agentSettings.settings.subagentDepth),
                stopping: () => runtime.stopping(),
                report,
                clock: runtime.kernelClock,
            });
            // 后台任务清单的提供方（jobs.md 输出 20）：停止的第一步撤回，之后清单不再读行、不再转来停止；入口停止时门面释放也会撤回。
            // 没装 `nbook.tasks` 时不登记，别的照常。
            const revokeRows = tasks.status === "resolved" ? tasks.instance.provide(runtime.taskRows()) : () => undefined;
            let stopped: Promise<void> | null = null;
            const stop = () => {
                revokeRows();
                return (stopped ??= Promise.all([runtime.stop().finally(() => evalTools.stop()), installer.stop().then(() => skillCatalog.close())]).then(() => undefined).finally(() => previews.clear()));
            };
            context.signal.addEventListener("abort", () => void stop(), {once: true});
            context.onStop(stop);
            // 入口停止时宿主随门面撤下这条登记，不必自己 release。没有这个能力的宿主照常运行，只是不报。
            const work = await context.services.resolve(runningWorkKey);
            if (work.status === "resolved") work.instance.register(() => runtime.runningWork());
            return {
                // 别的插件拿到按调用方生成的门面：视图的发出者由门面盖章（sessions.md 输出 21）。
                services: [provideServicePerConsumer(agentKey, (consumer) => agentFacade(runtime.service, consumer), {release: (facade) => revokeAgentFacade(facade)})],
                remote: [provideRemote(agentSessionsContract, () => agentRemote({service: runtime.service, profileAdmin: runtime.profileAdmin, sessions: runtime.sessions, clock, skills: skillCatalog, skillInstaller: installer, skillsFolder: {path: userSkills, open: () => openFolder(userSkills, process.env, process.platform)}, previewApproval: (session, tool, args, signal) => approvalPreview(tool, args, filesFor(context.services.require(workspaceFilesKey))(session, tool), editStores, session.sessionId, signal), projectRules: (project, signal) => readProjectRules(context.services.require(workspaceFilesKey), project, signal), subagents: {relations: runtime.relations, jobs: runtime.jobs, tree: runtime.tree, entry: (id) => runtime.sessionEntry(id), sessionsRoot: runtime.sessionsRoot, report}}, previews)), provideRemote(agentRequestsContract, () => requestsRemote({recorder: runtime.requests, owners: runtime.requestOwners, titles: runtime.titles, sessionEntry: (id) => runtime.sessionEntry(id)}))],
                contributions: {[HTTP_ROUTES_POINT]: {[descriptor.id]: attachmentRoutes}, [SCHEMES_POINT]: schemes, [TOOLS_POINT]: {...builtinTools(editStores, dialects, (sessionId, patch) => runtime.service.session(sessionId).changeSettings({commandId: crypto.randomUUID(), patch}), shellBackground(runtime.jobs, clock), shellAutoBackground(runtime.jobs, runtime.kernelClock, {seconds: () => settings.get(agentSettings.settings.shellAutoBackground), isChild: (id) => runtime.relations.parentOf(id) !== null, report})), ...jobTools(runtime.jobs, runtime.sessions, runtime.kernelClock, report), ...subagentToolImplementations, [EVAL_TOOL]: evalTools.implementation}, [COMPACTION_METHODS_POINT]: builtinCompactionMethods(), [PROFILES_POINT]: builtinProfiles(report), [EXTENSIONS_POINT]: {...runGuards(settings, runtime.treeSpend), ...modesImplementations, [SESSION_META_EXTENSION]: sessionMetaExtension({id: SESSION_META_EXTENSION, tag: SESSION_META_TAG, notify: (session, trigger) => runtime.meta.notify(session, trigger)}), [SUBAGENTS_EXTENSION]: subagents, [SKILLS_EXTENSION]: skillsExtension({catalog: skillCatalog, allowed: allowedSkills}), [STICKERS_EXTENSION]: stickersExtension({stickers: {list: stickerPacks}, allowed: allowedStickers}), [EVAL_STATE_EXTENSION]: evalStateExtension}},
                receivers: {
                    [EXTENSIONS_POINT]: extensionReceiver(runtime.host, (message, cause) => report("extension-revoke-failed", message, {message: cause instanceof Error ? cause.message : String(cause)}), () => runtime.profiles.extensionsChanged()),
                    [TOOLS_POINT]: runtime.tools.receiver,
                    [COMPACTION_METHODS_POINT]: runtime.compaction.receiver,
                    [PROFILES_POINT]: runtime.profiles.receiver,
                    [SKILLS_POINT]: pluginSkillRoots({catalog: skillCatalog, packages: pluginPackages.status === "resolved" ? pluginPackages.instance : null, report}),
                },
            };
        },
    })],
};
