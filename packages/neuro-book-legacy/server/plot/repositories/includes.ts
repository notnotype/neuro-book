/**
 * Scene refs 详情 include。
 */
export const STORY_SCENE_REF_INCLUDE = {
    targetThread: {
        select: {
            id: true,
            name: true,
        },
    },
    targetScene: {
        select: {
            id: true,
        },
    },
} as const;

/**
 * Scene 内嵌 Chapter 轻量摘要 include(供 summary DTO 展示所属章)。
 */
export const STORY_SCENE_CHAPTER_INCLUDE = {
    chapter: {
        select: {
            id: true,
            name: true,
            title: true,
        },
    },
} as const;
