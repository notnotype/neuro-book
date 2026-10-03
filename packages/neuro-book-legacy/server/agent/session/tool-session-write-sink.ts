import type {JsonValue} from "nbook/server/agent/messages/types";
import type {SessionEntry, SessionEntryDraft, SessionId} from "nbook/server/agent/session/types";
import type {SessionWriteExecutor, SessionWritePlan} from "nbook/server/agent/session/write-plan";

export type ToolSessionWriteSinkInput = {
    executor: SessionWriteExecutor;
    sessionId: SessionId;
    invocationId?: string;
    toolCallIndex?: number;
    toolCallId?: string;
    enqueueSavePoint?: (plan: SessionWritePlan, source: ToolSessionWriteSource) => void;
};

export type ToolSessionWriteSource = {
    toolCallIndex: number;
    toolCallId: string;
};

/**
 * 工具和运行时辅助模块的 session 写入入口。
 *
 * 它只把领域写入包装成 SessionWritePlan；真正 append 与事件发布仍由 executor 负责。
 */
export class ToolSessionWriteSink {
    private readonly executor: SessionWriteExecutor;
    private readonly sessionId: SessionId;
    private readonly invocationId?: string;
    private readonly toolCallIndex?: number;
    private readonly toolCallId?: string;
    private readonly enqueueSavePoint?: (plan: SessionWritePlan, source: ToolSessionWriteSource) => void;

    constructor(input: ToolSessionWriteSinkInput) {
        this.executor = input.executor;
        this.sessionId = input.sessionId;
        this.invocationId = input.invocationId;
        this.toolCallIndex = input.toolCallIndex;
        this.toolCallId = input.toolCallId;
        this.enqueueSavePoint = input.enqueueSavePoint;
    }

    /**
     * 写入一条普通 session entry。
     */
    async append(cause: string, entry: SessionEntryDraft): Promise<SessionEntry> {
        const entries = await this.execute({
            target: {sessionId: this.sessionId},
            cause,
            durability: "immediate",
            ops: [{
                kind: "append",
                entry,
            }],
        });
        return entries[0]!;
    }

    /**
     * 写入 profile/tool custom state。
     */
    async customState(cause: string, key: string, value: JsonValue): Promise<SessionEntry> {
        return this.append(cause, {
            type: "custom",
            key,
            value,
        });
    }

    /**
     * 排队到当前 turn save point，与 assistant/toolResult transcript 一起 flush。
     */
    savePointAppend(cause: string, entry: SessionEntryDraft): void {
        this.enqueue({
            target: {sessionId: this.sessionId},
            cause,
            durability: "savePoint",
            ops: [{
                kind: "append",
                entry,
            }],
        });
    }

    /**
     * 排队写入 profile/tool custom state，直到 turn save point 才落盘。
     */
    savePointCustomState(cause: string, key: string, value: JsonValue): void {
        this.savePointAppend(cause, {
            type: "custom",
            key,
            value,
        });
    }

    private async execute(plan: SessionWritePlan): Promise<SessionEntry[]> {
        return (await this.executor.execute([plan], this.invocationId)).entries;
    }

    private enqueue(plan: SessionWritePlan): void {
        if (!this.enqueueSavePoint) {
            throw new Error("savePoint session write 只能在 active turn frame 内使用。");
        }
        if (this.toolCallIndex === undefined || !this.toolCallId) {
            throw new Error("savePoint session write 需要 tool call source。");
        }
        this.enqueueSavePoint(plan, {
            toolCallIndex: this.toolCallIndex,
            toolCallId: this.toolCallId,
        });
    }
}
