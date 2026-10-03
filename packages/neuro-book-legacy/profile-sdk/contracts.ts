import type {Static, TSchema} from "typebox";
import type {VariableDefinition, VariableJsonValue, VariableNamespace} from "nbook/variable-sdk/contracts";

/** Profile SDK 可持久化的 JSON 值。 */
export type ProfileJsonValue =
    | null
    | boolean
    | number
    | string
    | ProfileJsonValue[]
    | {[key: string]: ProfileJsonValue};

/** Profile SDK 暴露的 Project Workspace 只读 locator。 */
export type ProfileProjectWorkspace = {
    readonly ref: {
        readonly projectRoot: string;
    };
    readonly root: string;
};

/** 已通过宿主 Project ready gate 的稳定引用。 */
export type ReadyProjectSessionRef = {
    readonly workspace: ProfileProjectWorkspace;
    readonly generation: number;
};

export type ProfileTextContent = {
    type: "text";
    text: string;
    textSignature?: string;
};

export type ProfileAttachmentContent = {
    type: "attachment";
    attachment: {
        id: `sha256:${string}`;
        mimeType: string;
        bytes: number;
    };
    name?: string;
};

export type ProfileThinkingContent = {
    type: "thinking";
    thinking: string;
    thinkingSignature?: string;
    redacted?: boolean;
};

export type ProfileToolCallContent = {
    type: "toolCall";
    id: string;
    name: string;
    arguments: {[key: string]: ProfileJsonValue};
    thoughtSignature?: string;
};

export type ProfileUserMessage = {
    role: "user";
    content: Array<ProfileTextContent | ProfileAttachmentContent>;
    timestamp: number;
};

export type ProfileAssistantMessage = {
    role: "assistant";
    content: Array<ProfileTextContent | ProfileThinkingContent | ProfileToolCallContent>;
    api: string;
    provider: string;
    model: string;
    responseModel?: string;
    responseId?: string;
    usage: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
        cacheWrite1h?: number;
        reasoning?: number;
        totalTokens: number;
        cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            total: number;
        };
    };
    stopReason: "stop" | "length" | "toolUse" | "error" | "aborted";
    errorMessage?: string;
    timestamp: number;
};

export type ProfileToolResultMessage = {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: Array<ProfileTextContent | ProfileAttachmentContent>;
    details?: ProfileJsonValue;
    isError: boolean;
    timestamp: number;
};

export type ProfileStoredMessage = ProfileUserMessage | ProfileAssistantMessage | ProfileToolResultMessage;

/** Profile 可见的 Session 只读视图。 */
export type RuntimeSessionContext = {
    systemPrompt: string;
    messages: ProfileStoredMessage[];
    model: {providerConfigId: string; modelId: string} | null;
    thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | null;
    profileKey: string;
    currentProjectRoot?: string;
    customState: {[key: string]: ProfileJsonValue};
    linkedAgents: Array<{sessionId: number; profileKey: string; detached: boolean}>;
    title?: string;
    summary?: string;
    archived: boolean;
    agentMode: "normal" | "discuss" | "plan";
};

export type RuntimeSessionSnapshot = {
    metadata: {
        schemaVersion: 2;
        sessionId: number;
        profileKey: string;
        initial: ProfileJsonValue;
        currentProjectRoot?: string;
        createdAt: number;
    };
    entries: Array<{type: string}>;
    leafId: string | null;
};

export type RuntimeSessionReadResult = {
    snapshot: RuntimeSessionSnapshot;
    context: RuntimeSessionContext;
};

export type RuntimeAgentDialogueContentInput = {
    sessionId?: number;
    profileKey?: string;
    initial?: ProfileJsonValue;
};

export type RuntimeSessionFacade = RuntimeSessionContext & {
    workspaceRoot: string;
    currentProject: ReadyProjectSessionRef | null;
    read(sessionId?: number): Promise<RuntimeSessionReadResult>;
    agentDialogueContent(input?: RuntimeAgentDialogueContentInput): Promise<{
        text: string;
        tokens: number;
        fingerprint: string;
        entryIds: string[];
    }>;
};

export type AgentInvokeCaller = {
    kind: "user" | "agent" | "system";
    sessionId?: number;
    profileKey?: string;
    toolCallId?: string;
};

export type ClientStateSnapshot = {
    ide?: {[key: string]: ProfileJsonValue};
    studio?: {[key: string]: ProfileJsonValue};
    [key: string]: ProfileJsonValue | {[key: string]: ProfileJsonValue} | undefined;
};

export type VariableJsonPatchOperation =
    | {op: "add" | "replace" | "test"; path: string; value: ProfileJsonValue}
    | {op: "remove"; path: string};

export type VariableReadResult = {
    path: string;
    value?: ProfileJsonValue;
    truncated?: boolean;
    fingerprint?: string;
    issue?: {
        code: "unavailable" | "not_registered" | "not_readable" | "not_writable" | "schema_mismatch" | "storage_error" | "not_compiled" | "compile_stale" | "compiled_load_failed" | "stale_read_required" | "stale_fingerprint";
        path: string;
        message: string;
    };
};

export type ProfileVariableAccessor = {
    readonly dryRun: boolean;
    get(path: string): Promise<ProfileJsonValue | undefined>;
    read(path: string, options?: {maxBytes?: number}): Promise<VariableReadResult>;
    patch(
        namespace: VariableNamespace,
        path: string,
        operations: VariableJsonPatchOperation[],
        source?: "agent" | "profile" | "frontend" | "user",
        toolCallId?: string,
    ): Promise<VariableReadResult>;
};

export type AgentProfileManifest<TKey extends string = string> = {
    key: TKey;
    name: string;
    description?: string;
    version?: number;
};

export type AgentProfileSourceKind = "memory" | "install" | "project";
export type AgentProfileCreationMode = "public" | "system_only";
export type AgentProfileLoadStatus = "loaded" | "compiling" | "compile_failed" | "not_compiled" | "compile_stale" | "compiled_load_failed" | "source_error";
export type AgentProfileIssueCode = "load_failed" | "invalid_export" | "schema_missing" | "builtin_schema_locked" | "filename_mismatch" | "system_profile_shadowed" | "file_missing" | "not_compiled" | "compile_failed" | "compile_stale" | "source_stale" | "dependency_stale" | "compiled_load_failed" | "source_error";

export type AgentProfileIssue = {
    code: AgentProfileIssueCode;
    message: string;
    profileKey?: string;
    source?: AgentProfileSourceKind;
    sourcePath?: string;
};

export type AgentCatalogItem = {
    key: string;
    name: string;
    description?: string;
    toolKeys?: readonly string[];
    initialSchema?: TSchema;
    payloadSchema?: TSchema;
    outputSchema?: TSchema;
    source: AgentProfileSourceKind;
    sourcePath?: string;
    builtin: boolean;
    loadStatus: AgentProfileLoadStatus;
    hasSettingsForm: boolean;
    canResetHome: boolean;
    creationMode: AgentProfileCreationMode;
    issue?: AgentProfileIssue;
};

export type AgentCatalogSnapshot = {
    profiles: AgentCatalogItem[];
    issues: AgentProfileIssue[];
};

export type ProfileHomeWriteMode = "create" | "overwrite";
export type ProfileHomeWriteResult = {written: boolean};
export type ProfileHomeScope = "global" | "project";
export type ProfileHomeListItem = {name: string; path: string; kind: "file" | "directory"};

export type ProfileHomeFacade = {
    root: string;
    readText(filePath: string): Promise<string>;
    writeText(filePath: string, content: string, options?: {mode?: ProfileHomeWriteMode}): Promise<ProfileHomeWriteResult>;
    readJson(filePath: string): Promise<ProfileJsonValue>;
    writeJson(filePath: string, value: ProfileJsonValue, options?: {mode?: ProfileHomeWriteMode}): Promise<ProfileHomeWriteResult>;
    exists(filePath: string): Promise<boolean>;
    list(directoryPath?: string): Promise<ProfileHomeListItem[]>;
    move(fromPath: string, toPath: string, options?: {mode?: ProfileHomeWriteMode}): Promise<ProfileHomeWriteResult>;
    remove(filePath: string): Promise<void>;
    clear(): Promise<void>;
};

export type ProfileHomeContext = {
    profileKey: string;
    profileVersion: number;
    root: string;
    home: ProfileHomeFacade;
} & ({
    scope: "project";
    workspace: ProfileProjectWorkspace;
} | {
    scope: "global";
    workspaceRoot: string;
    workspaceNbookRoot: string;
});

export type ProfileHomeDefinition = {
    init?: (ctx: ProfileHomeContext) => Promise<void> | void;
    upgrade?: (ctx: ProfileHomeContext, oldVersion: number, targetVersion: number) => Promise<void> | void;
    reset?: (ctx: ProfileHomeContext) => Promise<void> | void;
};

export type ToolBinding<TKey extends string = string> = {
    key: TKey;
    /** 自带工具定义引用；宿主私有的 runtime carrier 不属于 Authoring Interface。 */
    definition?: AgentToolReference<TKey>;
    parameters?: TSchema;
    validationSchema?: TSchema;
    description?: string;
};

export type AgentToolReference<TKey extends string = string> = {
    key: TKey;
};

export type ProfileToolResult = {
    content: Array<ProfileTextContent | ProfileAttachmentContent>;
    details?: ProfileJsonValue;
    terminate?: boolean;
};

export type ProfileToolExecutionContext = {
    sessionId: number;
    parentSessionId?: number;
    profileKey: string;
    workspaceRoot: string;
    currentProject: ReadyProjectSessionRef | null;
    invocationId?: string;
    vars?: ProfileVariableAccessor;
};

export type AgentToolDefinitionInput<TKey extends string = string> = {
    key: TKey;
    name?: string;
    label?: string;
    description: string;
    parameters: TSchema;
    validationSchema?: TSchema;
    approvalRequired?: boolean;
    mutatesWorkspace?: boolean;
    executionMode?: "sequential" | "parallel";
    prepareArguments?: (args: unknown) => unknown;
    execute?: (
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        onUpdate?: (partial: ProfileToolResult) => void,
    ) => Promise<ProfileToolResult>;
    executeWithContext?: (
        context: ProfileToolExecutionContext,
        toolCallId: string,
        params: unknown,
        userInput?: unknown,
        signal?: AbortSignal,
        onUpdate?: (partial: ProfileToolResult) => void,
    ) => Promise<ProfileToolResult>;
};

export type AgentToolDefinition<TKey extends string = string> = AgentToolDefinitionInput<TKey> & {
    bind(options?: Omit<ToolBinding<TKey>, "key" | "definition">): ToolBinding<TKey>;
};

export type ReportResultToolBinding = ToolBinding<"report_result"> & {
    dataSchema?: TSchema;
    dataSchemaFromInitial?: (initial: ProfileJsonValue | null) => TSchema | undefined;
};

export type ProfileToolBinding<TKey extends string = string> = ToolBinding<TKey> | AgentToolDefinition<TKey> | ReportResultToolBinding;
export type ProfileTools = {[key: string]: ProfileToolBinding};

export type ProfileDslChild = ProfileDslNode | string | number | boolean | null | undefined | ProfileDslChild[];
export type ProfileDslNode = ProfilePromptNode | ProfileSetNode | ProfileMessageNode | ProfileToolCallNode | ProfileReminderNode | ProfileWatchNode | ProfileIfNode | ProfileStringFragmentNode | ProfileBuiltinNode | ProfileModeSlotNode | ProfileFileChangeNoticeNode | ProfileFragmentNode;
export type ProfilePromptNode = {kind: "ProfilePrompt"; children: ProfileDslChild[]};
export type ProfileSetNode = {kind: "System" | "HistorySet" | "ModelContext" | "AppendingSet"; children: ProfileDslChild[]};
export type ProfileMessageNode = {kind: "Message" | "AIMessage" | "ToolResult"; role?: "user" | "assistant" | "toolResult" | "system"; toolCallId?: string; toolName?: string; isError?: boolean; children: ProfileDslChild[]};
export type ProfileToolCallNode = {kind: "ToolCall"; id: string; name: string; args?: {[key: string]: ProfileJsonValue}};
export type ReminderChange = {previousValue: ProfileJsonValue | undefined; currentValue: ProfileJsonValue | undefined; hasPreviousValue: boolean; hasCurrentValue: boolean; didChange: boolean; session: RuntimeSessionContext};
export type WatchChange = {previousValue: ProfileJsonValue | undefined; currentValue: ProfileJsonValue | undefined; path: string; hasPreviousValue: boolean; hasCurrentValue: boolean; session: RuntimeSessionContext};
export type ProfileReminderNode = {kind: "Reminder"; id: string; when: boolean; watchPath?: string; watchValue?: ProfileJsonValue; watch?: (ctx: ProfilePrepareContext) => ProfileJsonValue | undefined | Promise<ProfileJsonValue | undefined>; render?: (change: ReminderChange) => ProfileDslChild | Promise<ProfileDslChild>; repeatEveryTurns?: number; children: ProfileDslChild[]};
export type ProfileWatchNode = {kind: "Watch"; id?: string; path?: string; value?: ProfileJsonValue; render?: (change: WatchChange) => ProfileDslChild | Promise<ProfileDslChild>; children: ProfileDslChild[]};
export type ProfileIfNode = {kind: "If"; condition: boolean; children: ProfileDslChild[]};
export type ProfileStringFragmentNode = {kind: "StringFragment"; text: string | ((ctx: ProfilePrepareContext) => string | Promise<string>); label?: string};
/**
 * SDK 只保存宿主内置 DSL 能力的声明；文件读取、catalog 渲染和 session 状态解释
 * 由宿主在加载 artifact 后统一实现，不能被冻结进每个 Profile artifact。
 */
export type ProfileBuiltinNode =
    | {kind: "ProfileBuiltin"; name: "SkillCatalog"; props: {mode?: "workspace" | "userAssets"; text?: string | ((ctx: ProfilePrepareContext) => string | Promise<string>)}}
    | {kind: "ProfileBuiltin"; name: "AgentCatalog" | "WorkflowCatalog" | "ActivatedSkills" | "SqlSchemaSummary"; props: {text?: string | ((ctx: ProfilePrepareContext) => string | Promise<string>)}}
    | {kind: "ProfileBuiltin"; name: "Import"; props: ProfileImportProps}
    | {kind: "ProfileBuiltin"; name: "SystemReminder"; props: {children?: ProfileDslChild | ProfileDslChild[]}}
    | {kind: "ProfileBuiltin"; name: "LinkedAgentsSummary" | "MentionedSkillsReminder"; props: {}}
    | {kind: "ProfileBuiltin"; name: "LinkedAgentsReminder" | "WorkspaceFocusReminder" | "ModeAvailabilityReminder"; props: {id?: string; repeatEveryTurns?: number}}
    | {kind: "ProfileBuiltin"; name: "TaskReminder"; props: {id?: string; stateKey?: string; repeatEveryTurns?: number}}
    | {kind: "ProfileBuiltin"; name: "ModeReminder"; props: {id?: string; stateKey?: string; repeatEveryTurns?: number; children?: ProfileDslChild | ProfileDslChild[]}};
export type ProfileImportAs = "text";
export type ProfileImportProps = {path: string; heading?: string; maxBytes?: number; required?: boolean; label?: string; as?: ProfileImportAs};
export type ModeSlotKind = "plan_enter" | "plan_reentry" | "plan_steady" | "discuss_enter" | "discuss_steady" | "exit_from_plan" | "exit_plain";
export type ProfileModeSlotNode = {kind: "ModeSlot"; slot: ModeSlotKind; children: ProfileDslChild[]};
export type ProfileFragmentNode = {kind: "Fragment"; children: ProfileDslChild[]};
export type ProfileFileChangeNoticeNode = {kind: "FileChangeNotice"; mode: "off" | "minimal" | "full"};
export type ReminderState = {hasValue?: boolean; value?: ProfileJsonValue | null; fingerprint?: string; injectedAtTurn?: number};
export type WatchState = {hasValue: boolean; value: ProfileJsonValue | null; fingerprint: string};
export type ProfileRuntimeState = {reminders?: {[key: string]: ReminderState}; watches?: {[key: string]: WatchState}};

export type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: ProfileStoredMessage[];
    appendingMessages?: ProfileStoredMessage[];
    modelContextAppendingMessages?: ProfileStoredMessage[];
    modelContextMessages?: ProfileStoredMessage[];
    turnContexts?: Array<{kind: "file-change-notice"; mode: "minimal" | "full"; appendingIndex: number}>;
    promptSourceLabels?: {
        historyInit?: Array<readonly string[] | null>;
        modelContext?: Array<readonly string[] | null>;
        modelContextAppending?: Array<readonly string[] | null>;
        appending?: Array<readonly string[] | null>;
    };
    stateWrites?: Array<{type: "custom"; key: string; value: ProfileJsonValue}>;
};

export type AgentRuntimeHookStage = "prepareRun" | "prepareTurn" | "ingestTurn" | "prepareNextTurn" | "settleRun";
export type AgentRuntimeHookResult = {
    writePlans?: Array<{
        target: {sessionId: number};
        cause: string;
        durability?: "immediate" | "savePoint";
        ops: Array<{
            kind: "append";
            entry: {type: "custom"; key: string; value: ProfileJsonValue};
        }>;
    }>;
    runtimeState?: ProfileJsonValue;
    runtimeMessages?: ProfileStoredMessage[];
    transcript?: "persist" | "runtime_only";
    builtinBehavior?: {profilePrompt?: boolean; reportResultReminder?: boolean; sessionContext?: boolean};
    turnSnapshotPatch?: {requestOptions?: {[key: string]: ProfileJsonValue}; toolKeys?: string[]};
};
export type AgentRuntimeHookContext<TInitial = ProfileJsonValue> = {
    stage: AgentRuntimeHookStage;
    sessionId: number;
    invocationId: string;
    profileKey: string;
    initial: TInitial;
    payload?: ProfileJsonValue;
    session: RuntimeSessionFacade;
    runtimeState: ProfileJsonValue | undefined;
    turnIndex?: number;
    pendingUserMessage?: ProfileUserMessage;
    invocation: {caller: AgentInvokeCaller; payload?: ProfileJsonValue; message?: string};
    turn?: {
        assistant: ProfileAssistantMessage;
        toolResults: ProfileToolResultMessage[];
        waiting?: {toolCallId: string; toolName: string};
        messageStatus?: "partial" | "interrupted" | "error";
    };
    runResult?: {
        status: "completed" | "waiting";
        finalAssistant?: ProfileAssistantMessage;
        reportResult?: {result: string; success?: boolean; data?: unknown};
        waiting?: {toolCallId: string; toolName: string};
    };
    modelMessages?: ProfileStoredMessage[];
};
export type AgentRuntimeHook<TInitial = ProfileJsonValue> = {name: string; stage: AgentRuntimeHookStage; builtin?: true; run(ctx: AgentRuntimeHookContext<TInitial>): AgentRuntimeHookResult | Promise<AgentRuntimeHookResult>};
export type AgentRuntimeBuiltin<TInitial = ProfileJsonValue> = {kind: "builtin"; name: string; hooks: readonly AgentRuntimeHook<TInitial>[]};
export type AgentRuntimeItem<TInitial = ProfileJsonValue> = AgentRuntimeHook<TInitial> | AgentRuntimeBuiltin<TInitial>;
export type AgentRuntimeDefinition<TInitial = ProfileJsonValue> = {hooks: readonly AgentRuntimeItem<TInitial>[]};
export type NormalizedAgentRuntimeDefinition<TInitial = ProfileJsonValue> = {hooks: readonly AgentRuntimeHook<TInitial>[]};

export type ProfileRuntimeDefaults = {
    summarizer?: {enabled?: boolean; profileKey?: string; trigger?: "afterInvocation"; interval?: {kind: "sourceInvocation" | "dialogueContentTokens"; value: number}; maxDialogueContentTokens?: number};
    compaction?: {enabled?: boolean; trigger?: {kind: "autoReserve"} | {kind: "percent"; value: number} | {kind: "tokens"; value: number}; reserveTokens?: number; keepRecent?: {kind: "percent"; value: number} | {kind: "tokens"; value: number}; prompt?: string; summaryPrefix?: string};
    fileChangeNotice?: {diffMaxChars?: number};
};

type ProfileSettingsContext<TSettings> = TSettings extends undefined
    ? {settings: {[key: string]: ProfileJsonValue}}
    : unknown extends TSettings
        ? {settings: {[key: string]: ProfileJsonValue}}
        : {settings: TSettings};

export type ProfilePrepareContext<TInitial = ProfileJsonValue, TPayload = ProfileJsonValue, TSettings = undefined> = {
    session: RuntimeSessionFacade;
    initial: TInitial;
    invocation?: {payload?: TPayload; message?: string; clientState?: ClientStateSnapshot; caller: AgentInvokeCaller};
    vars: ProfileVariableAccessor;
    catalog: AgentCatalogSnapshot;
    skills: Array<{key: string; name: string; description?: string; whenToUse?: string; version?: string; source: "install" | "project"; rootPath: string; skillPath: string}>;
    workflows?: Array<{key: string; title: string; description: string; whenToUse?: string; source: "install" | "project"}>;
    agentVisibleModels?: Array<{modelKey: string; note: string}>;
    runtime?: {now: string; promptUserTurnCount: number; currentProject?: ReadyProjectSessionRef | null; pendingUserMessage?: ProfileUserMessage; sqlSchemaSummary?: () => Promise<string>};
    home?: ProfileHomeFacade;
} & ProfileSettingsContext<TSettings>;

export type AgentProfileDefinition<
    TInitialSchema extends TSchema = TSchema,
    TPayloadSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSettingsSchema extends TSchema | undefined = TSchema | undefined,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
> = {
    manifest: AgentProfileManifest;
    capabilities?: {creation?: AgentProfileCreationMode};
    initialSchema: TInitialSchema;
    payloadSchema?: TPayloadSchema;
    outputSchema?: TOutputSchema;
    settingsForm?: TSettingsSchema extends TSchema ? LowCodeFormDefinition<TSettingsSchema> : never;
    home?: ProfileHomeDefinition;
    tools: TTools;
    toolKeys?: readonly (keyof TTools & string)[];
    skills?: {include: readonly string[]};
    runtimeDefaults?: ProfileRuntimeDefaults;
    runtime?: AgentRuntimeDefinition<Static<TInitialSchema>> | NormalizedAgentRuntimeDefinition<Static<TInitialSchema>>;
    variableDefinitions?: readonly VariableDefinition[];
    context?(ctx: ProfilePrepareContext<Static<TInitialSchema>, Static<TPayloadSchema>, TSettingsSchema extends TSchema ? Static<TSettingsSchema> : undefined>): ProfileDslNode | Promise<ProfileDslNode>;
    prepare?(ctx: ProfilePrepareContext<Static<TInitialSchema>, Static<TPayloadSchema>, TSettingsSchema extends TSchema ? Static<TSettingsSchema> : undefined>): ProfileTurnPlan | Promise<ProfileTurnPlan>;
};

export type AgentProfile<
    TInitialSchema extends TSchema = TSchema,
    TPayloadSchema extends TSchema = TSchema,
    TOutputSchema extends TSchema = TSchema,
    TSettingsSchema extends TSchema | undefined = TSchema | undefined,
    TSummarizerKey extends string = string,
    TTools extends ProfileTools = ProfileTools,
> = AgentProfileDefinition<TInitialSchema, TPayloadSchema, TOutputSchema, TSettingsSchema, TSummarizerKey, TTools> & {
    rootToolKeys: readonly (keyof TTools & string)[];
};

export type LowCodeJsonValue = ProfileJsonValue;
export type LowCodeJsonObject = {[key: string]: LowCodeJsonValue};
export type LowCodeFieldOption = {value: string | number | boolean; label: string; description?: string; disabled?: boolean};
export type LowCodeFormIssue = {path?: string; severity: "error" | "warning"; code?: string; message: string};
export type LowCodeFormResolveContext = {
    profileKey: string;
    values?: LowCodeJsonObject;
    home?: ProfileHomeFacade;
    globalHome?: ProfileHomeFacade;
    allowGlobalResourceKeys?: boolean;
} & ({scope: "project"; projectWorkspace: ProfileProjectWorkspace} | {scope: "global"; projectWorkspace?: never});
export type ResourcePresetDefinition = {
    contentType: "markdown";
    template?: string;
    createKeyPrefix?: string;
    createKeySuffix?: string;
    list(ctx: LowCodeFormResolveContext): readonly ResourcePresetOption[] | Promise<readonly ResourcePresetOption[]>;
    read(ctx: LowCodeFormResolveContext, key: string): ResourcePresetContent | Promise<ResourcePresetContent>;
    create?: (ctx: LowCodeFormResolveContext, input: ResourcePresetCreateInput) => ResourcePresetContent | Promise<ResourcePresetContent>;
    createKey?: (ctx: LowCodeFormResolveContext, input: ResourcePresetCreateInput) => string | Promise<string>;
    update?: (ctx: LowCodeFormResolveContext, key: string, patch: ResourcePresetUpdatePatch) => void | Promise<void>;
    rename?: (ctx: LowCodeFormResolveContext, key: string, input: ResourcePresetRenameInput) => {key: string; label?: string} | Promise<{key: string; label?: string}>;
    renameKey?: (ctx: LowCodeFormResolveContext, key: string, input: ResourcePresetRenameInput) => string | Promise<string>;
    remove?: (ctx: LowCodeFormResolveContext, key: string) => void | Promise<void>;
    validateKey?: (ctx: LowCodeFormResolveContext, key: string) => boolean | Promise<boolean>;
};
export type ResourcePresetOption = {key: string; label: string; description?: string; origin?: "global" | "project"; editable: boolean; deletable: boolean};
export type ResourcePresetContent = {key: string; content: string; contentType: "markdown"; origin?: "global" | "project"; updatedAt?: string};
export type ResourcePresetCreateInput = {type: "create"; fieldPath: string; label: string; slug: string; content?: string};
export type ResourcePresetUpdatePatch = {label?: string; content?: string};
export type ResourcePresetRenameInput = {label: string; slug: string};
export type LowCodeFieldOptionsProvider = (ctx: LowCodeFormResolveContext) => readonly LowCodeFieldOption[] | Promise<readonly LowCodeFieldOption[]>;
export type LowCodeFieldDefinition = {path: string; component: "text" | "textarea" | "number" | "switch" | "select" | "combobox" | "radio" | "checkbox" | "resource-preset"; label: string; description?: string; placeholder?: string; required?: boolean; defaultValue?: LowCodeJsonValue; options?: readonly LowCodeFieldOption[] | LowCodeFieldOptionsProvider; rows?: number; min?: number; max?: number; step?: number; integer?: boolean; resource?: ResourcePresetDefinition};
export type LowCodeFormDefinition<TSettingsSchema extends TSchema = TSchema> = {schema: TSettingsSchema; defaults: Static<TSettingsSchema>; fields: readonly LowCodeFieldDefinition[]; validate?: (value: Static<TSettingsSchema>, ctx: LowCodeFormResolveContext) => readonly LowCodeFormIssue[] | Promise<readonly LowCodeFormIssue[]>};

export type WritingStyleDefinition = {key: string; label: string; sourcePreset: string; identifier: string; name: string; enabled: boolean | null; role: string | null; readonly sourceFile: string; readonly content: string};
export type WritingStylePreset = string;
export type WritingReferenceDefinition = {key: string; label: string; sourceTitle: string; sourceChapters: string; generatedFrom: string; readonly sourceFile: string; readonly content: string};
export type WritingReferencePreset = string;
