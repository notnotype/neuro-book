/** 开发模式下递归冻结状态与事件：扩展改了就抛错，而不是悄悄改坏别的会话共享的快照。已冻结的子树不再走。 */
export function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}

const sealed = new WeakSet<object>();
/**
 * 把整个对象图冻结，不因某个节点已冻结就停：外部（拦截层）交来的对象可能只冻结了顶层，下面的内容仍能改。
 * 封好的对象记下，之后再遇到直接返回；按对象身份缓存的东西（请求哈希的消息摘要）只信封好的对象。
 * 先记再走子节点，所以有环的对象也会结束。
 */
export function seal<T>(value: T): T {
    if (value === null || typeof value !== "object" || sealed.has(value)) return value;
    sealed.add(value);
    Object.freeze(value);
    for (const child of Object.values(value)) seal(child);
    return value;
}

export const isSealed = (value: object): boolean => sealed.has(value);
