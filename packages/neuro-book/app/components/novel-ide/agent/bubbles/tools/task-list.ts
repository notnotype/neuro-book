import { z } from "zod";
import type { AgentToolCall } from "nbook/app/components/novel-ide/agent/agent-message";

export const AgentTaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const AgentTaskStepSchema = z.object({
    id: z.string().trim().min(1),
    text: z.string().trim().min(1),
    status: AgentTaskStatusSchema,
    note: z.string().trim().min(1).optional(),
    updatedAt: z.string().trim().min(1),
});

const AgentTaskListSchema = z.object({
    title: z.string().trim().min(1).optional(),
    steps: z.array(AgentTaskStepSchema).min(1),
    updatedAt: z.string().trim().min(1),
});

export type AgentTaskStatus = z.infer<typeof AgentTaskStatusSchema>;
export type AgentTaskStep = z.infer<typeof AgentTaskStepSchema>;
export type AgentTaskList = z.infer<typeof AgentTaskListSchema>;

export type TaskToolCallLike = Pick<AgentToolCall, "resultData" | "result">;

/**
 * 解析 task 工具的结构化返回值。
 * 优先使用有界 resultData，fallback 到 result 里的 JSON 文本。
 */
export const parseTaskList = (toolCall: TaskToolCallLike): AgentTaskList | null => {
    const resultData = AgentTaskListSchema.safeParse(toolCall.resultData);
    if (resultData.success) {
        return resultData.data;
    }

    const resultText = toolCall.result?.trim();
    if (!resultText) {
        return null;
    }

    try {
        return AgentTaskListSchema.parse(JSON.parse(resultText));
    } catch {
        return null;
    }
};

/**
 * 任务步骤状态对应的 locale key。
 */
export const taskStatusLabelKey = (status: AgentTaskStatus): string => {
    switch (status) {
        case "pending":
            return "agent.tasks.todo";
        case "in_progress":
            return "agent.tasks.inProgress";
        case "completed":
            return "agent.tasks.completed";
    }
};

/**
 * 任务步骤状态颜色。
 */
export const taskStatusClass = (status: AgentTaskStatus): string => {
    switch (status) {
        case "pending":
            return "border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-muted)]";
        case "in_progress":
            return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
        case "completed":
            return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
    }
};

/**
 * 任务步骤状态图标。
 */
export const taskStatusIcon = (status: AgentTaskStatus): string => {
    switch (status) {
        case "pending":
            return "i-lucide-circle-dashed";
        case "in_progress":
            return "i-lucide-loader-circle";
        case "completed":
            return "i-lucide-check";
    }
};
