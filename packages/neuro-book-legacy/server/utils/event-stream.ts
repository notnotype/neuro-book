/**
 * h3 EventStream 在客户端断开附近的写入可能仍抛「流正在关闭/已关闭」错误。该错误来自运行时
 * WritableStream 实现（Node ERR_INVALID_STATE 的 TypeError），文案随运行时/h3 版本敏感——
 * 判定后应当收尾清理而非上抛。presence 与 workspace-files 两个 SSE 路由共用此判定。
 */
export function isClosingEventStreamError(error: unknown): boolean {
    return error instanceof TypeError && error.message.includes("stream is closing or closed");
}
