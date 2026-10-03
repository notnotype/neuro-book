/**
 * 根据模型 ID 推导稳定分组。
 * 命名空间模型保留最后一个模型 slug 之前的完整路径，普通模型使用首个连字符前缀。
 */
export function deriveModelGroup(modelId: string): string {
    const normalizedId = modelId.trim();
    if (!normalizedId) {
        return "default";
    }

    const slashIndex = normalizedId.lastIndexOf("/");
    if (slashIndex > 0) {
        return normalizedId.slice(0, slashIndex);
    }

    const colonIndex = normalizedId.indexOf(":");
    if (colonIndex > 0) {
        return normalizedId.slice(0, colonIndex);
    }

    const hyphenIndex = normalizedId.indexOf("-");
    return hyphenIndex > 0 ? normalizedId.slice(0, hyphenIndex) : normalizedId;
}
