import type {AiAnnotationBlock} from "nbook/server/content/ai-annotation";

export type AiAnnotationExecutionContext = {
    module: "chapter" | "lorebook" | "plot";
    field: string;
    entityLabel: string;
};

/**
 * 执行单个文本字段中的 AI 批注块。
 * v1 采用整字段一次模型调用，由模型返回 unified diff。
 */
export class AiAnnotationExecutor {
    /**
     * 执行 AI 批注，并返回最终 resolved 文本。
     */
    async execute(
        text: string,
        annotations: AiAnnotationBlock[],
        context: AiAnnotationExecutionContext,
    ): Promise<string> {
        if (annotations.length === 0) {
            return text;
        }

        void annotations;
        void context;
        throwAiExecutionError("AI 批注执行器依赖的旧 LangChain provider 已移除，等待迁移到 Pi provider");
    }
}

/**
 * 抛出 AI 批注执行错误。
 */
function throwAiExecutionError(message: string): never {
    throw createError({
        statusCode: 502,
        message,
    });
}
