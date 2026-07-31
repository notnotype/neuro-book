import type {JsonValue} from "nbook/server/agent/messages/types";
import type {StoredContent} from "nbook/server/agent/messages/stored-types";
import type {TSchema} from "typebox";
import type {NeuroAgentHarness} from "nbook/server/agent/harness/neuro-agent-harness";
import type {ToolSessionWriteSink} from "nbook/server/agent/session/tool-session-write-sink";
import type {ProfileVariableAccessor} from "nbook/server/agent/variables/types";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";
import type {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";

export type ToolExecutionMode = "sequential" | "parallel";

/**
 * 工具执行的 NeuroBook 领域结果。
 *
 * 内建工具只能返回可直接进入 session truth 的 text/attachment block；Pi image
 * 不属于该边界。未来接入外部 Pi 工具时，Adapter 必须先把图片保存为 attachment，
 * 再构造 NeuroToolResult。
 */
export type NeuroToolResult = {
    content: StoredContent[];
    /**
     * 执行期结构化结果。工具实现必须在返回前收口为 JSON value；外部 unknown
     * 数据在工具 seam 解析，Harness 不再承担兜底类型转换。
     */
    details?: JsonValue;
    terminate?: boolean;
};

export type NeuroToolUpdateCallback = (partial: NeuroToolResult) => void;

export type ToolExecutionContext = {
    harness: NeuroAgentHarness;
    sessionId: number;
    parentSessionId?: number;
    profileKey: string;
    /** 持久化逻辑引用；配置、子Agent继承和DTO使用。 */
    workspaceRootRef: WorkspaceRootRef;
    /** Workspace Root Reference解析出的物理根；File Scope会结合projectPath选择实际cwd。 */
    workspaceFsRoot: AbsoluteFsPath;
    workspaceKey: string;
    projectPath?: string;
    invocationId?: string;
    vars?: ProfileVariableAccessor;
    sessionWrites?: ToolSessionWriteSink;
    /** Agent Attachment 领域 Store；工具不得访问具体 Local/OSS/DB Adapter。 */
    /** 生产 Harness 必填；旧测试/纯文本工具上下文可省略。图片工具缺失时必须 fail closed。 */
    attachments?: AttachmentStore;
};

/**
 * 工具在创建用户审批或输入请求前可用的只读授权上下文。
 *
 * 这一阶段只判断“当前 profile 是否有权发起该操作”，不得写入 session、
 * Project Workspace 或其他业务状态。真正执行时仍应保留同一权限断言作为纵深防御。
 */
export type ToolAuthorizationContext = {
    sessionId: number;
    profileKey: string;
    workspaceRootRef: WorkspaceRootRef;
    workspaceFsRoot: AbsoluteFsPath;
    workspaceKey: string;
    projectPath?: string;
    invocationId?: string;
};

/**
 * 用户输入请求上下文。
 * 工具在判断是否需要用户输入时可以访问的信息。
 */
export type UserInputRequestContext = {
    /** 工具调用参数 */
    args: unknown;
    /** Session 上下文 */
    session: {
        sessionId: number;
        profileKey: string;
        workspaceRoot: WorkspaceRootRef;
        workspaceKey: string;
        projectPath?: string;
    };
};

/**
 * 用户输入表单规格。
 * Low-Code Form 是可选能力；用户输入工具可返回此结构，让前端渲染结构化表单。
 */
export type UserInputFormSpec = {
    /** Low-Code Form 定义；存在时前端按结构化表单提交 data.userInput。 */
    form?: LowCodeFormDto;
    /** 可选的返回值 schema，用于校验用户提交的数据 */
    resultSchema?: TSchema;
    /** 展示给用户的提示文本 */
    prompt?: string;
    /** 前端布局提示（第一版只支持 dialog） */
    layout?: "dialog" | "inline" | "fullscreen";
};

export type NeuroAgentTool = {
    key: string;
    name: string;
    label: string;
    description: string;
    parameters: TSchema;
    prepareArguments?: (args: unknown) => unknown;
    approvalRequired?: boolean;
    /**
     * 工具会变更 Project Workspace 状态：写 workspace 文件（write/edit/apply_patch 等）
     * 或写入项目数据库（plot 的 save_* 落 project.sqlite，Task 97 D8）。
     * 只读模式（discuss/plan）下 harness 依此标记自动注入写审批（Task 90）。
     * 新增会写文件或写库的工具必须标注，否则只读模式约束不生效。
     */
    mutatesWorkspace?: boolean;
    /** 为空时使用 parameters 校验；非空时 provider-visible parameters 和执行校验 schema 可以分离。 */
    validationSchema?: TSchema;
    /**
     * 同一 assistant turn 内的工具调度策略。未声明时由 harness 默认策略决定。
     */
    executionMode?: ToolExecutionMode;
    /**
     * 在 Harness 创建审批或用户输入 pending 之前执行的只读授权钩子。
     * 抛出错误表示拒绝该调用；Harness 会直接返回错误 tool result，不产生等待状态。
     */
    authorize?: (context: ToolAuthorizationContext, args: unknown) => Promise<void> | void;
    /**
     * 用户输入请求配置。
     * 工具可以通过此字段声明在执行时需要用户输入。
     */
    userInputRequest?: {
        /**
         * 判断是否需要用户输入，返回表单规格 / true 或 null。
         * - 返回 true：暂停执行，由前端根据工具参数渲染专用 UI
         * - 返回 UserInputFormSpec：暂停执行，展示表单，等待用户提交
         * - 返回 null：直接执行，无需用户输入
         */
        when: (context: UserInputRequestContext) => Promise<UserInputFormSpec | true | null> | UserInputFormSpec | true | null;
    };
    /** 无 session context 的工具执行入口。 */
    execute?: (
        toolCallId: string,
        params: unknown,
        signal?: AbortSignal,
        onUpdate?: NeuroToolUpdateCallback,
    ) => Promise<NeuroToolResult>;
    /**
     * v3 harness 自己执行工具时使用的上下文入口。Pi 的 AgentTool.execute 没有当前 session 信息，
     * 所以需要把 Neuro Book 的 session/link 语义保留在这一层。
     *
     * @param userInput - 当工具声明了 userInputRequest 且用户已提交表单时，此参数包含用户输入的数据
     */
    executeWithContext?: (
        context: ToolExecutionContext,
        toolCallId: string,
        params: unknown,
        userInput?: unknown,
        signal?: AbortSignal,
        onUpdate?: NeuroToolUpdateCallback,
    ) => Promise<NeuroToolResult>;
};

export type ToolBinding<TKey extends string = string> = {
    key: TKey;
    /** 非空表示 profile 自带工具；为空时从全局 registry 解析。 */
    definition?: AgentToolDefinition<TKey>;
    /** 为空时使用工具定义或全局工具的默认参数 schema。 */
    parameters?: TSchema;
    /** 为空时使用 parameters 做执行前校验。 */
    validationSchema?: TSchema;
    /** 为空时使用工具定义或全局工具描述。 */
    description?: string;
};

export type ReportResultToolBinding = ToolBinding<"report_result"> & {
    /** 主路 report_result.data 的结构化 schema。 */
    dataSchema?: TSchema;
};

export type ReportSidecarResultToolBinding = ToolBinding<"report_sidecar_result">;

export type ProfileToolBinding<TKey extends string = string> = ToolBinding<TKey> | AgentToolDefinition<TKey> | ReportResultToolBinding | ReportSidecarResultToolBinding;

export type ProfileTools = Record<string, ProfileToolBinding>;

export type AgentToolDefinitionInput<TKey extends string = string> = {
    key: TKey;
    name?: string;
    label?: string;
    description: string;
    parameters: TSchema;
    validationSchema?: TSchema;
    approvalRequired?: boolean;
    /** 见 NeuroAgentTool.mutatesWorkspace：只读模式写审批的能力标记。 */
    mutatesWorkspace?: boolean;
    executionMode?: ToolExecutionMode;
    authorize?: NeuroAgentTool["authorize"];
    userInputRequest?: NeuroAgentTool["userInputRequest"];
    prepareArguments?: NeuroAgentTool["prepareArguments"];
    execute?: NeuroAgentTool["execute"];
    executeWithContext?: NeuroAgentTool["executeWithContext"];
};

export type ToolBindOptions<TKey extends string = string> = Omit<ToolBinding<TKey>, "key" | "definition">;

export type AgentToolDefinition<TKey extends string = string> = AgentToolDefinitionInput<TKey> & {
    bind(options?: ToolBindOptions<TKey>): ToolBinding<TKey>;
    runtime(options?: ToolBindOptions<TKey>): NeuroAgentTool;
};

/**
 * 定义一个 Agent 工具。definition 是 key/schema/description/execute 的唯一真相源；
 * profile 可通过 bind() 引用，也可直接把 definition 放进 tools 作为自带工具。
 */
export function defineAgentTool<const TKey extends string>(input: AgentToolDefinitionInput<TKey>): AgentToolDefinition<TKey> {
    const definition: AgentToolDefinition<TKey> = {
        ...input,
        bind(options = {}) {
            return {
                key: input.key,
                definition,
                ...options,
            };
        },
        runtime(options = {}) {
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
                authorize: input.authorize,
                userInputRequest: input.userInputRequest,
                prepareArguments: input.prepareArguments,
                execute: input.execute ?? (async () => {
                    throw new Error(`${input.key} 必须在 agent session context 内执行。`);
                }),
                executeWithContext: input.executeWithContext,
            };
        },
    };
    return definition;
}

/**
 * 将现有 NeuroAgentTool 包装成 definition。用于渐进迁移旧工具模块，保持执行行为不变。
 */
export function defineAgentToolFromRuntime<const TKey extends string>(tool: NeuroAgentTool & {key: TKey}): AgentToolDefinition<TKey> {
    return defineAgentTool({
        key: tool.key,
        name: tool.name,
        label: tool.label,
        description: tool.description,
        parameters: tool.parameters,
        validationSchema: tool.validationSchema,
        approvalRequired: tool.approvalRequired,
        mutatesWorkspace: tool.mutatesWorkspace,
        executionMode: tool.executionMode,
        authorize: tool.authorize,
        userInputRequest: tool.userInputRequest,
        prepareArguments: tool.prepareArguments,
        execute: tool.execute,
        executeWithContext: tool.executeWithContext,
    });
}

export function isAgentToolDefinition(value: ProfileToolBinding | undefined): value is AgentToolDefinition {
    return Boolean(value && typeof value === "object" && "runtime" in value && typeof value.runtime === "function");
}

export type ToolApprovalResolution = {
    kind: "tool_approval";
    toolCallId: string;
    approved: boolean;
    resultText?: string;
    data?: JsonValue;
    answers?: UserInputAnswer[];
};

export type UserInputAnswer = {
    questionIndex: number;
    text?: string;
    selectedOptionIndex?: number;
    note?: string;
    ignored?: boolean;
};

export type UserInputResolution = {
    kind: "user_input";
    toolCallId: string;
    data?: JsonValue;
    answers?: UserInputAnswer[];
};

export type AgentResolution = ToolApprovalResolution | UserInputResolution;
