/**
 * 把 Composer 从当前 Project Workspace 菜单取得的相对引用补成完整 Project File Address。
 * 已经是 managed 地址或绝对地址的目标只做斜杠规范化，不重复添加前缀。
 * 入参是单段 projectRoot；输出的 `workspace/<root>/...` 是 Address 层仍在消费的旧形态。
 */
export function completeProjectFileAddress(target: string, projectRoot: string | null): string {
    const normalized = target.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
    if (normalized.startsWith("workspace/") || /^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(normalized)) {
        return normalized;
    }
    const normalizedRoot = projectRoot?.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
    return normalizedRoot && !normalizedRoot.includes("/")
        ? `workspace/${normalizedRoot}/${normalized}`
        : normalized;
}
