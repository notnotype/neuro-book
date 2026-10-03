import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {NeuroAgentTool} from "nbook/server/agent/tools/types";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {AGENT_TASKS_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";

const TaskStatusSchema = Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("completed"),
]);

const TaskStepInputSchema = Type.Object({
    id: Type.String({description: "Stable machine-readable step id."}),
    text: Type.String({description: "User-facing step text."}),
    status: TaskStatusSchema,
});

const TaskStepSchema = Type.Object({
    id: Type.String(),
    text: Type.String(),
    status: TaskStatusSchema,
    note: Type.Optional(Type.String()),
    updatedAt: Type.String(),
});

const TaskListSchema = Type.Object({
    title: Type.Optional(Type.String()),
    steps: Type.Array(TaskStepSchema),
    updatedAt: Type.String(),
});

const TaskCreateSchema = Type.Object({
    title: Type.Optional(Type.String({description: "Optional task list title shown to the user."})),
    steps: Type.Array(TaskStepInputSchema, {
        minItems: 1,
        description: "Initial task steps in display order. At most one step may be in_progress.",
    }),
});

const TaskSetStatusSchema = Type.Object({
    id: Type.String({description: "Stable id of the task step to update."}),
    status: TaskStatusSchema,
    note: Type.Optional(Type.String({description: "Optional short reason or progress note for this status change."})),
});

type TaskStatus = Static<typeof TaskStatusSchema>;
type TaskList = Static<typeof TaskListSchema>;

/**
 * 构造 v3 task 工具。任务状态写入 session custom state，前端复用 AgentTaskBubble 渲染。
 */
export function createTaskTools(): NeuroAgentTool[] {
    return [
        {
            key: "task_create",
            name: "task_create",
            label: "Task Create",
            executionMode: "sequential",
            description: "Create or replace the current session task list. Use it to track multi-step or cross-turn work.",
            parameters: TaskCreateSchema,
            async execute() {
                throw new Error("task_create 需要 v3 session context。");
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const input = params as Static<typeof TaskCreateSchema>;
                const now = new Date().toISOString();
                let seenInProgress = false;
                const taskList: TaskList = {
                    title: trimOptional(input.title),
                    steps: input.steps.map((step) => {
                        const status: TaskStatus = step.status === "in_progress" && seenInProgress ? "pending" : step.status;
                        if (status === "in_progress") {
                            seenInProgress = true;
                        }
                        return {
                            id: step.id.trim(),
                            text: step.text.trim(),
                            status,
                            updatedAt: now,
                        };
                    }),
                    updatedAt: now,
                };
                assertTaskList(taskList);
                await writeTaskList(context, taskList);
                return taskToolResult(taskList);
            },
        },
        {
            key: "task_set_status",
            name: "task_set_status",
            label: "Task Set Status",
            executionMode: "sequential",
            description: "Update one task step status in the current session task list and return the full task list.",
            parameters: TaskSetStatusSchema,
            async execute() {
                throw new Error("task_set_status 需要 v3 session context。");
            },
            async executeWithContext(context, _toolCallId, params: unknown) {
                const input = params as Static<typeof TaskSetStatusSchema>;
                const session = await context.harness.readSessionContext(context.sessionId);
                const current = readTaskList(session.customState[AGENT_TASKS_STATE_KEY]);
                if (!current) {
                    throw new Error("当前 session 还没有任务清单，请先调用 task_create。");
                }
                const now = new Date().toISOString();
                let found = false;
                const taskList: TaskList = {
                    title: current.title,
                    steps: current.steps.map((step) => {
                        if (step.id !== input.id.trim()) {
                            return input.status === "in_progress" && step.status === "in_progress"
                                ? {...step, status: "pending", updatedAt: now}
                                : step;
                        }
                        found = true;
                        return {
                            ...step,
                            status: input.status,
                            note: trimOptional(input.note),
                            updatedAt: now,
                        };
                    }),
                    updatedAt: now,
                };
                if (!found) {
                    throw new Error(`任务步骤不存在：${input.id}`);
                }
                assertTaskList(taskList);
                await writeTaskList(context, taskList);
                return taskToolResult(taskList);
            },
        },
    ];
}

async function writeTaskList(context: ToolExecutionContext, taskList: TaskList): Promise<void> {
    await context.harness.appendCustomState(context.sessionId, AGENT_TASKS_STATE_KEY, taskList as JsonValue, context.invocationId);
    context.sessionWrites?.savePointCustomState("tool.custom_state", AGENT_TASKS_STATE_KEY, taskList as JsonValue);
}

function trimOptional(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}

function readTaskList(value: JsonValue | undefined): TaskList | null {
    try {
        return Value.Parse(TaskListSchema, value);
    } catch {
        return null;
    }
}

function assertTaskList(taskList: TaskList): void {
    Value.Parse(TaskListSchema, taskList);
    if (taskList.steps.length === 0) {
        throw new Error("任务清单至少需要一个步骤。");
    }
    const ids = new Set<string>();
    let inProgressCount = 0;
    for (const step of taskList.steps) {
        if (!step.id.trim() || !step.text.trim()) {
            throw new Error("任务步骤 id 和 text 不能为空。");
        }
        if (ids.has(step.id)) {
            throw new Error(`任务步骤 id 重复：${step.id}`);
        }
        ids.add(step.id);
        if (step.status === "in_progress") {
            inProgressCount += 1;
        }
    }
    if (inProgressCount > 1) {
        throw new Error("同一任务清单最多只能有一个 in_progress 步骤。");
    }
}

function taskToolResult(taskList: TaskList) {
    return {
        content: [{type: "text" as const, text: JSON.stringify(taskList, null, 2)}],
        details: taskList as JsonValue,
    };
}
