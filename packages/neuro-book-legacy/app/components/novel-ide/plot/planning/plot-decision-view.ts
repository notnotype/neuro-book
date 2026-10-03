import type {
    PlotThreadPanelChapter,
    PlotThreadPanelScene,
    PlotThreadPanelThread,
} from "nbook/app/components/novel-ide/plot/thread-panel/plot-thread-panel.types";
import type {StoryActDto, StoryDecisionDto, StoryPromiseDto} from "nbook/shared/dto/plot.dto";

/**
 * 决策记录视图层的名称解析纯函数:列表行与 ADR 详情共用。
 * 数据源约定:acts/chapters/threads/scenes 来自工作台 props(承载树/因果树),promises/decisions 来自账本 tab 自拉列表;
 * 解析不到一律回退显示实体 id,不抛错(死引用与数据未就绪都按回退处理)。
 */

/** 实体 id → 可读名索引集合。 */
export type PlanningNameMaps = {
    actNames: Map<string, string>;
    chapterNames: Map<string, string>;
    threadNames: Map<string, string>;
    sceneNames: Map<string, string>;
    promiseNames: Map<string, string>;
    decisionNames: Map<string, string>;
};

/** 从工作台 props 与自拉列表构建名称索引。 */
export function buildPlanningNameMaps(input: {
    acts: StoryActDto[];
    chapters: PlotThreadPanelChapter[];
    threads: PlotThreadPanelThread[];
    scenes: PlotThreadPanelScene[];
    promises: StoryPromiseDto[];
    decisions: StoryDecisionDto[];
}): PlanningNameMaps {
    return {
        actNames: new Map(input.acts.map((act) => [act.id, act.title || act.name])),
        chapterNames: new Map(input.chapters.map((chapter) => [chapter.id, `${chapter.numberLabel} ${chapter.title}`.trim()])),
        threadNames: new Map(input.threads.map((thread) => [thread.id, thread.title || "未命名 Thread"])),
        sceneNames: new Map(input.scenes.map((scene) => [scene.id, scene.title || "未命名 Scene"])),
        promiseNames: new Map(input.promises.map((promise) => [promise.id, promise.title || promise.name])),
        decisionNames: new Map(input.decisions.map((decision) => [decision.id, decision.title || decision.name])),
    };
}

/**
 * 锚点 chip 的目标实体名。
 * 为空表示锚在全书层(chip 只显示「全书」);各实体 kind 查不到名时回退显示实体 id(死引用容错)。
 */
export function decisionAnchorName(decision: StoryDecisionDto, maps: PlanningNameMaps): string | null {
    const targetId = decision.anchorTargetId ?? "";
    switch (decision.anchorKind) {
        case "story":
            return null;
        case "content":
            return decision.anchorPath ?? "";
        case "act":
            return maps.actNames.get(targetId) ?? targetId;
        case "chapter":
            return maps.chapterNames.get(targetId) ?? targetId;
        case "thread":
            return maps.threadNames.get(targetId) ?? targetId;
        case "scene":
            return maps.sceneNames.get(targetId) ?? targetId;
        case "promise":
            return maps.promiseNames.get(targetId) ?? targetId;
    }
}

/**
 * 期限章显示名:优先承载树章名(含序号),回退 DTO 内嵌章摘要 title。
 * 为空表示无期限或期限章已删除(调用方按 deadlineChapterId 是否非空区分,后者显示 danger「期限章已删除」)。
 */
export function decisionDeadlineName(decision: StoryDecisionDto, maps: PlanningNameMaps): string | null {
    if (!decision.deadlineChapterId || !decision.deadlineChapter) {
        return null;
    }
    return maps.chapterNames.get(decision.deadlineChapterId) ?? decision.deadlineChapter.title;
}

/** serves/dependsOn 引用中可跳转的场景 id;为空表示不是(有效的)scene:// 引用。 */
export function refTargetSceneId(target: string, valid: boolean): string | null {
    return valid && target.startsWith("scene://") ? target.slice("scene://".length) : null;
}

/**
 * serves/dependsOn 引用的可读名:promise/decision/thread/scene 协议尝试本地解析。
 * 为空表示解析不到(目标不在本地数据)或引用本身已可读(内容节点相对路径)。
 */
export function refTargetDisplayName(target: string, maps: PlanningNameMaps): string | null {
    if (target.startsWith("promise://")) {
        return maps.promiseNames.get(target.slice("promise://".length)) ?? null;
    }
    if (target.startsWith("decision://")) {
        return maps.decisionNames.get(target.slice("decision://".length)) ?? null;
    }
    if (target.startsWith("thread://")) {
        return maps.threadNames.get(target.slice("thread://".length)) ?? null;
    }
    if (target.startsWith("scene://")) {
        return maps.sceneNames.get(target.slice("scene://".length)) ?? null;
    }
    return null;
}
