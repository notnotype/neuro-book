/**
 * Prompt cache 命中率口径（Task 126）。
 *
 * 唯一真相源：`AgentChatSurface` 的会话累计芯片、`AgentTextBubble` 的单条消息标签
 * 和上下文面板必须共用这里，否则同一个概念会出现三个不同的数。
 */

/** 命中率计算只需要 usage 的三个输入侧字段。 */
export type PromptCacheUsage = {
    input: number;
    cacheRead: number;
    cacheWrite: number;
};

/**
 * 本次请求的 prompt token 总量。
 *
 * 三项相加，**不能漏 cacheWrite**：Anthropic 的 `input_tokens` 既不含缓存读取也不含
 * 缓存写入，漏掉写入会让命中率系统性偏高——首轮把整个 HistorySet 写进缓存时尤其失真。
 *
 * OpenAI 兼容 provider 的 `cached_tokens` 含在 `prompt_tokens` 里，由 pi 适配器在
 * 映射成 `{input, cacheRead}` 时已经拆开，到这里口径是一致的。
 */
export function promptCacheTotalTokens(usage: PromptCacheUsage): number {
    return usage.input + usage.cacheRead + usage.cacheWrite;
}

/**
 * 命中率，返回 0-100 的数值；总量为 0 时返回 null（无从计算，调用方应显示「—」而不是 0%）。
 *
 * 注意语义边界：**会话累计命中率不适合用来诊断**。首轮必然是全量 cacheWrite、cacheRead
 * 为 0，这一笔会永久压在累计分母里，后续每轮命中再好也拉不回来。要判断缓存健康度请看
 * 逐请求命中率。
 */
export function promptCacheHitRate(usage: PromptCacheUsage): number | null {
    const total = promptCacheTotalTokens(usage);
    return total > 0 ? usage.cacheRead / total * 100 : null;
}
