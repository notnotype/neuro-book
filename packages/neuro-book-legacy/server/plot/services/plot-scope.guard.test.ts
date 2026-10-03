import type {
    ChapterRepository,
    DecisionRepository,
    PromiseRepository,
    SceneRepository,
    StoryRepository,
    ThreadRepository,
} from "nbook/server/plot/contracts/plot-repositories";
import type {StoryAct, StoryChapter} from "nbook/server/generated/project-prisma/client";
import type {StoryDecisionEntity, StoryPromiseEntity} from "nbook/server/plot/core/types";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {describe, expect, it, vi} from "vitest";

/** 构造只带指定仓储的 guard,其余仓储用空对象占位。 */
function createGuard(overrides: {chapter?: Partial<ChapterRepository>; promise?: Partial<PromiseRepository>; decision?: Partial<DecisionRepository>}): PlotScopeGuard {
    return new PlotScopeGuard(
        {} as StoryRepository,
        {} as ThreadRepository,
        {} as SceneRepository,
        (overrides.chapter ?? {}) as ChapterRepository,
        (overrides.promise ?? {}) as PromiseRepository,
        (overrides.decision ?? {}) as DecisionRepository,
    );
}

describe("PlotScopeGuard", () => {
    it("assertChapter 校验章存在且属于当前 Story", async () => {
        const chapter = {id: 7, storyId: 10, actId: null, name: "001-opening", title: "开篇"} as StoryChapter;
        const guard = createGuard({chapter: {
            findChapterById: vi.fn(async (chapterId: number) => chapterId === 7 ? chapter : null),
        }});

        await expect(guard.assertChapter(10, 7)).resolves.toBe(chapter);
        await expect(guard.assertChapter(10, 8)).rejects.toThrow("章节不存在");
        // 属于其他 Story 的章不可见。
        await expect(guard.assertChapter(11, 7)).rejects.toThrow("章节不存在");
    });

    it("assertAct 校验卷存在且属于当前 Story", async () => {
        const act = {id: 3, storyId: 10, name: "002-volume", title: "第二卷"} as StoryAct;
        const guard = createGuard({chapter: {
            findActById: vi.fn(async (actId: number) => actId === 3 ? act : null),
        }});

        await expect(guard.assertAct(10, 3)).resolves.toBe(act);
        await expect(guard.assertAct(10, 4)).rejects.toThrow("剧情卷不存在");
        await expect(guard.assertAct(11, 3)).rejects.toThrow("剧情卷不存在");
    });

    it("assertChapterNameUnique 拒绝重名章;Prose frontmatter 依赖 name 反指", async () => {
        const guard = createGuard({chapter: {
            findChapterByName: vi.fn(async (_storyId: number, name: string, excludeChapterId?: number) => (
                name === "001-opening" && excludeChapterId !== 7
                    ? {id: 7, storyId: 10, name} as StoryChapter
                    : null
            )),
        }});

        await expect(guard.assertChapterNameUnique(10, "001-opening")).rejects.toThrow("章节 name 已存在");
        await expect(guard.assertChapterNameUnique(10, "001-opening", 7)).resolves.toBeUndefined();
        await expect(guard.assertChapterNameUnique(10, "002-chapter")).resolves.toBeUndefined();
    });

    it("assertPromise 校验 Promise 存在且属于当前 Story;beat 写入两侧过守卫即保证同 story", async () => {
        const promise = {id: 5, storyId: 10, name: "silver-key", title: "银钥匙之谜"} as StoryPromiseEntity;
        const guard = createGuard({promise: {
            findPromiseById: vi.fn(async (promiseId: number) => promiseId === 5 ? promise : null),
        }});

        await expect(guard.assertPromise(10, 5)).resolves.toBe(promise);
        await expect(guard.assertPromise(10, 6)).rejects.toThrow("Promise 不存在");
        // 属于其他 Story 的 Promise 不可见。
        await expect(guard.assertPromise(11, 5)).rejects.toThrow("Promise 不存在");
    });

    it("assertPromiseNameUnique 拒绝重名 Promise;name 是互指引用 slug", async () => {
        const guard = createGuard({promise: {
            findPromiseByName: vi.fn(async (_storyId: number, name: string, excludePromiseId?: number) => (
                name === "silver-key" && excludePromiseId !== 5
                    ? {id: 5, storyId: 10, name} as StoryPromiseEntity
                    : null
            )),
        }});

        await expect(guard.assertPromiseNameUnique(10, "silver-key")).rejects.toThrow("Promise name 已存在");
        await expect(guard.assertPromiseNameUnique(10, "silver-key", 5)).resolves.toBeUndefined();
        await expect(guard.assertPromiseNameUnique(10, "iron-crown")).resolves.toBeUndefined();
    });

    it("assertDecision 校验 Decision 存在且属于当前 Story;anchor 外键与 supersededById 写入共用本守卫", async () => {
        const decision = {id: 8, storyId: 10, name: "d-liya-truth", title: "莉雅误召真相"} as StoryDecisionEntity;
        const guard = createGuard({decision: {
            findDecisionById: vi.fn(async (decisionId: number) => decisionId === 8 ? decision : null),
        }});

        await expect(guard.assertDecision(10, 8)).resolves.toBe(decision);
        await expect(guard.assertDecision(10, 9)).rejects.toThrow("Decision 不存在");
        // 属于其他 Story 的 Decision 不可见。
        await expect(guard.assertDecision(11, 8)).rejects.toThrow("Decision 不存在");
    });
});
