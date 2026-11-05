/**
 * 世界是不可变的（canon.model 输出 36：一次读取共用同一份读取输入）：存进世界表的对象、读取视图交出的引擎结果都深冻结，
 * 同进程的插件拿到以后改不了，改了就抛错（模块是严格模式），不会悄悄改掉世界、引擎的快照或别的诊断看到的对象。
 *
 * 已冻结的子树不再往下走：世界里只有这里冻结对象，冻过的就是整棵冻过的；新对象与旧对象共用的子树（例如改一个字段时没变的
 * 部分）只冻一次。
 */
export function deepFreeze<T>(value: T): T {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
}
