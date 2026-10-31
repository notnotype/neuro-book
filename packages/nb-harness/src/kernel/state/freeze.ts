/** 开发模式下递归冻结状态与事件：扩展改了就抛错，而不是悄悄改坏别的会话共享的快照。已冻结的子树不再走。 */
export function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}
