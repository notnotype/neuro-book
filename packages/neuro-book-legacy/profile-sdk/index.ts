import {Type} from "typebox";
import * as builtinContracts from "nbook/server/agent/profiles/builtin-contracts";
import * as constructors from "nbook/profile-sdk/constructors";
import {buildExecuteWorldDescription} from "nbook/server/agent/world-engine-tool-description";
import {profileHomeResource as profileHomeResourceHost} from "nbook/server/low-code-form/resource-preset";
import type {
    AgentProfileDefinition,
    AgentRuntimeBuiltin,
    AgentRuntimeDefinition,
    AgentRuntimeHook,
    AgentRuntimeHookContext,
    AgentRuntimeHookResult,
    AgentRuntimeHookStage,
    AgentRuntimeItem,
    AgentToolDefinition,
    AgentToolDefinitionInput,
    LowCodeFormDefinition,
    NormalizedAgentRuntimeDefinition,
    ProfileHomeDefinition,
    ProfileJsonValue,
    ProfileToolBinding,
    ProfileTools,
    ReportResultToolBinding,
    ResourcePresetDefinition,
    RuntimeAgentDialogueContentInput,
    RuntimeSessionFacade,
    RuntimeSessionReadResult,
    ToolBinding,
} from "nbook/profile-sdk/contracts";
import type {Static, TSchema} from "typebox";
import type {VariableDefinition} from "nbook/variable-sdk/contracts";

export {Type};
export type {Static, TSchema};
export type * from "nbook/profile-sdk/contracts";

export const {
    DirectorInitialSchema,
    DirectorOutputSchema,
    InlineEditorInitialSchema,
    InlineEditorOutputSchema,
    InlineEditorPayloadSchema,
    LeaderDefaultInitialSchema,
    LeaderDefaultOutputSchema,
    MemoryCuratorInitialSchema,
    MemoryCuratorOutputSchema,
    ResearcherInitialSchema,
    RetrievalInitialSchema,
    RetrievalOutputSchema,
    RpLeaderInitialSchema,
    RpLeaderOutputSchema,
    RpWriterInitialSchema,
    RpWriterOutputSchema,
    SessionSummarizerInitialSchema,
    SessionSummarizerOutputSchema,
    SimulatorLeaderInitialSchema,
    SimulatorLeaderOutputSchema,
    SubjectSimulatorInitialSchema,
    SubjectSimulatorOutputSchema,
    WriterInitialSchema,
    WriterOutputSchema,
    WriterPayloadSchema,
} = builtinContracts;

/** 定义一个只依赖稳定 Profile SDK contracts 的 Agent Profile。 */
export function defineAgentProfile<
    const TInitialSchema extends TSchema,
    const TPayloadSchema extends TSchema = TSchema,
    const TOutputSchema extends TSchema = TSchema,
    const TSettingsSchema extends TSchema | undefined = undefined,
    const TSummarizerKey extends string = string,
    const TTools extends ProfileTools = ProfileTools,
>(profile: AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools>): AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools> {
    return profile;
}

/** 规范化 Profile runtime hooks。 */
export function defineAgentRuntime<TInitial = ProfileJsonValue>(runtime: AgentRuntimeDefinition<TInitial>): NormalizedAgentRuntimeDefinition<TInitial> {
    const hooks: AgentRuntimeHook<TInitial>[] = [];
    for (const item of runtime.hooks) {
        if ("hooks" in item) {
            hooks.push(...item.hooks);
        } else {
            hooks.push(item);
        }
    }
    const seen = new Set<string>();
    for (const hook of hooks) {
        if (!hook.name.trim()) throw new Error("runtime hook name 不能为空");
        const key = `${hook.stage}:${hook.name}`;
        if (seen.has(key)) throw new Error(`runtime hook 重复：${key}`);
        seen.add(key);
    }
    return {hooks};
}

export const agentRuntimeBuiltins: {
    defaultSessionRuntime<TInitial = ProfileJsonValue>(): NormalizedAgentRuntimeDefinition<TInitial>;
    sessionRuntime<TInitial = ProfileJsonValue>(): AgentRuntimeBuiltin<TInitial>;
    profilePrompt<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial>;
    sessionContext<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial>;
    transcriptPersistence<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial>;
    runtimeOnlyTranscript<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial>;
    reportResult<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial>;
} = {
    defaultSessionRuntime<TInitial = ProfileJsonValue>() {
        return defineAgentRuntime({hooks: [this.sessionRuntime<TInitial>()]});
    },
    sessionRuntime<TInitial = ProfileJsonValue>() {
        return {
            kind: "builtin",
            name: "sessionRuntime",
            hooks: [
                this.profilePrompt<TInitial>(),
                this.sessionContext<TInitial>(),
                this.transcriptPersistence<TInitial>(),
                this.reportResult<TInitial>(),
            ],
        };
    },
    profilePrompt<TInitial = ProfileJsonValue>() {
        return builtinRuntimeHook<TInitial>("profilePrompt", "prepareRun", {builtinBehavior: {profilePrompt: true}});
    },
    sessionContext<TInitial = ProfileJsonValue>() {
        return builtinRuntimeHook<TInitial>("sessionContext", "prepareRun", {builtinBehavior: {sessionContext: true}});
    },
    transcriptPersistence<TInitial = ProfileJsonValue>() {
        return builtinRuntimeHook<TInitial>("transcriptPersistence", "ingestTurn", {transcript: "persist"});
    },
    runtimeOnlyTranscript<TInitial = ProfileJsonValue>() {
        return builtinRuntimeHook<TInitial>("runtimeOnlyTranscript", "ingestTurn", {transcript: "runtime_only"});
    },
    reportResult<TInitial = ProfileJsonValue>() {
        return {
            name: "builtin.reportResult",
            stage: "prepareRun",
            builtin: true,
            run(ctx) {
                return {builtinBehavior: {reportResultReminder: ctx.invocation.caller.kind !== "user"}};
            },
        };
    },
};

/** 构造无副作用的内置 runtime hook。 */
function builtinRuntimeHook<TInitial = ProfileJsonValue>(name: string, stage: AgentRuntimeHookStage, result: AgentRuntimeHookResult): AgentRuntimeHook<TInitial> {
    return {name: `builtin.${name}`, stage, builtin: true, run: () => result};
}

export const ProfilePrompt = constructors.ProfilePrompt;
export const System = constructors.System;
export const HistorySet = constructors.HistorySet;
export const ModelContext = constructors.ModelContext;
export const AppendingSet = constructors.AppendingSet;
export const FileChangeNotice = constructors.FileChangeNotice;
export const Message = constructors.Message;
export const AIMessage = constructors.AIMessage;
export const ToolCall = constructors.ToolCall;
export const ToolResult = constructors.ToolResult;
export const Reminder = constructors.Reminder;
export const Watch = constructors.Watch;
export const If = constructors.If;
export const SkillCatalog = constructors.SkillCatalog;
export const AgentCatalog = constructors.AgentCatalog;
export const WorkflowCatalog = constructors.WorkflowCatalog;
export const ActivatedSkills = constructors.ActivatedSkills;
export const SqlSchemaSummary = constructors.SqlSchemaSummary;
export const Import = constructors.Import;
export const SystemReminder = constructors.SystemReminder;
export const LinkedAgentsSummary = constructors.LinkedAgentsSummary;
export const LinkedAgentsReminder = constructors.LinkedAgentsReminder;
export const WorkspaceFocusReminder = constructors.WorkspaceFocusReminder;
export const ModeAvailabilityReminder = constructors.ModeAvailabilityReminder;
export const TaskReminder = constructors.TaskReminder;
export const ModeReminder = constructors.ModeReminder;
export const MentionedSkillsReminder = constructors.MentionedSkillsReminder;
export const ModeSlot = constructors.ModeSlot;
export const Fragment = constructors.Fragment;

/** 定义 Profile Home 生命周期声明，不执行文件系统操作。 */
export function defineProfileHome(definition: ProfileHomeDefinition): ProfileHomeDefinition {
    return definition;
}

/** 渲染缩进友好的 Profile 文本模板。 */
export function profileText(strings: TemplateStringsArray, ...values: unknown[]): string {
    const rawParts = strings.raw.map((part) => part.replace(/\\u([0-9a-fA-F]{4})/gu, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))).replace(/\r\n/gu, "\n"));
    rawParts[0] = (rawParts[0] ?? "").replace(/^\n/u, "");
    const lastIndex = rawParts.length - 1;
    rawParts[lastIndex] = (rawParts[lastIndex] ?? "").replace(/\n[ \t]*$/u, "");
    const indents = rawParts.flatMap((part) => part.split("\n")).filter((line) => line.trim()).map((line) => line.match(/^[ \t]*/u)?.[0].length ?? 0);
    const indent = indents.length > 0 ? Math.min(...indents) : 0;
    return rawParts.map((part, index) => {
        const normalized = indent > 0 ? part.split("\n").map((line) => line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line).join("\n") : part;
        return normalized + (index < values.length ? String(values[index] ?? "") : "");
    }).join("").trim();
}

/** 定义只在当前 Profile 中可见的自带工具。 */
export function defineProfileTool<const TKey extends string>(input: AgentToolDefinitionInput<TKey>): AgentToolDefinition<TKey> {
    const adapter: AgentToolDefinition<TKey> = {
        ...input,
        bind(options = {}) {
            return {
                key: input.key,
                definition: adapter,
                ...options,
            };
        },
    };
    // `runtime` 是宿主消费的 Implementation 细节；不进入作者 Interface。
    Object.defineProperty(adapter, "runtime", {
        configurable: false,
        enumerable: true,
        value(options: Omit<ToolBinding<TKey>, "key" | "definition"> = {}) {
            return {
                key: input.key,
                name: input.name ?? input.key,
                label: input.label ?? input.name ?? input.key,
                description: options.description ?? input.description,
                parameters: options.parameters ?? input.parameters,
                validationSchema: options.validationSchema ?? input.validationSchema,
                approvalRequired: input.approvalRequired,
                mutatesWorkspace: input.mutatesWorkspace,
                executionMode: input.executionMode,
                prepareArguments: input.prepareArguments,
                execute: input.execute ?? (async () => {
                    throw new Error(`${input.key} 必须在 agent session context 内执行。`);
                }),
                executeWithContext: input.executeWithContext,
            };
        },
        writable: false,
    });
    return adapter;
}

/** 组装 Profile root tools，并保留字面量 key。 */
export function toolset<const TItems extends readonly ProfileToolBinding[]>(...items: TItems): {
    [TItem in TItems[number] as TItem["key"]]: TItem;
} {
    const result: ProfileTools = {};
    for (const item of items) {
        if (result[item.key]) throw new Error(`profile tools 重复：${item.key}`);
        result[item.key] = item;
    }
    return result as {[TItem in TItems[number] as TItem["key"]]: TItem};
}

function registeredTool<const TKey extends string>(key: TKey): ToolBinding<TKey> {
    return {key};
}

export const builtin = {
    file: {read: registeredTool("read"), write: registeredTool("write"), edit: registeredTool("edit"), applyPatch: registeredTool("apply_patch"), bash: registeredTool("bash")},
    agent: {create: registeredTool("create_agent"), invoke: registeredTool("invoke_agent"), get: registeredTool("get_agent"), getProfile: registeredTool("get_agent_profile"), getSession: registeredTool("get_session"), detach: registeredTool("detach_agent")},
    control: {requestUserInput: registeredTool("request_user_input"), switchMode: registeredTool("switch_mode")},
    task: {create: registeredTool("task_create"), setStatus: registeredTool("task_set_status")},
    plot: {
        getTree: registeredTool("get_story_tree"),
        getThread: registeredTool("get_story_thread"),
        getSceneContext: registeredTool("get_story_scene_context"),
        getSceneWorldContext: registeredTool("get_scene_world_context"),
        getChapter: registeredTool("get_story_chapter"),
        getChapterWriterBrief: registeredTool("get_chapter_writer_brief"),
        getPromise: registeredTool("get_story_promise"),
        getDecision: registeredTool("get_story_decision"),
        saveAct: registeredTool("save_story_act"),
        saveChapter: registeredTool("save_story_chapter"),
        saveThread: registeredTool("save_story_thread"),
        saveScene: registeredTool("save_story_scene"),
        savePromise: registeredTool("save_story_promise"),
        savePromiseBeat: registeredTool("save_promise_beat"),
        saveDecision: registeredTool("save_story_decision"),
    },
    sql: {execute: registeredTool("execute_sql")},
    workflow: {run: registeredTool("run_workflow"), list: registeredTool("list_workflows")},
    jobs: {list: registeredTool("list_jobs"), get: registeredTool("get_job"), cancel: registeredTool("cancel_job")},
    subject: {ragSearch: registeredTool("subject_rag_search"), eventAppend: registeredTool("subject_event_append"), memoryUpdate: registeredTool("subject_memory_update")},
    world: {
        execute(mode: "readonly" | "readwrite"): ToolBinding<"execute_world"> {
            return {key: "execute_world", description: buildExecuteWorldDescription(mode)};
        },
    },
    web: {search: registeredTool("web_search"), fetch: registeredTool("web_fetch")},
    result: {
        main(options: {dataSchema?: TSchema; dataSchemaFromInitial?: ReportResultToolBinding["dataSchemaFromInitial"]} = {}): ReportResultToolBinding {
            return {key: "report_result", ...options};
        },
    },
};

export const plotReadBindings = [builtin.plot.getTree, builtin.plot.getThread, builtin.plot.getSceneContext, builtin.plot.getSceneWorldContext, builtin.plot.getChapter, builtin.plot.getChapterWriterBrief, builtin.plot.getPromise, builtin.plot.getDecision] as const;
export const plotWriteBindings = [builtin.plot.saveAct, builtin.plot.saveChapter, builtin.plot.saveThread, builtin.plot.saveScene, builtin.plot.savePromise, builtin.plot.savePromiseBeat, builtin.plot.saveDecision] as const;
export function pluginTool<const TKey extends string>(key: TKey): ToolBinding<TKey> {
    return registeredTool(key);
}

/** Profile 内声明 session namespace variable。 */
export function defineSessionVariable<const TSchemaValue extends TSchema>(input: Omit<VariableDefinition<TSchemaValue>, "namespace">): VariableDefinition<TSchemaValue> {
    return {
        ...input,
        namespace: "session",
        readable: input.readable ?? true,
        writableBy: input.writableBy ?? ["user"],
        writeMode: input.writeMode ?? "patch",
    };
}

export function defineLowCodeForm<const TSettingsSchema extends TSchema>(definition: LowCodeFormDefinition<TSettingsSchema>): LowCodeFormDefinition<TSettingsSchema> {
    return definition;
}
/** 定义 resource preset 声明，执行由宿主低代码表单 Module 负责。 */
export function defineResourcePreset(definition: ResourcePresetDefinition): ResourcePresetDefinition {
    return definition;
}
export const profileHomeResource: (input: {directory: string; extension?: ".md"; template?: string}) => ResourcePresetDefinition = profileHomeResourceHost;

export type {
    AgentRuntimeHook,
    AgentRuntimeHookContext,
    AgentRuntimeHookResult,
    AgentRuntimeHookStage,
    AgentRuntimeItem,
    NormalizedAgentRuntimeDefinition,
    ReportResultToolBinding,
    RuntimeAgentDialogueContentInput,
    RuntimeSessionFacade,
    RuntimeSessionReadResult,
};
