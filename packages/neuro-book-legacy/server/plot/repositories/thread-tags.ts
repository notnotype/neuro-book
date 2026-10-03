import type {StoryThreadEntity} from "nbook/server/plot/core/types";

type ThreadWithJsonTags = Omit<StoryThreadEntity, "tags"> & {
    tags: string;
};

/**
 * 把数据库 JSON tags 归一化为 Plot DTO 使用的字符串数组。
 */
export function normalizeThreadJsonTags<T extends ThreadWithJsonTags>(thread: T): Omit<T, "tags"> & {tags: string[]} {
    return {
        ...thread,
        tags: normalizeTags(thread.tags),
    };
}

function normalizeTags(value: string): string[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        return [];
    }
    return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
}
