import type {ChapterRepository} from "nbook/server/plot/contracts/plot-repositories";
import {PlotDtoAssembler} from "nbook/server/plot/assemblers/plot-dto.assembler";
import type {
    ChapterBriefColumns,
    ParsedCreateStoryActInput,
    ParsedCreateStoryChapterInput,
    ParsedUpdateStoryActInput,
    ParsedUpdateStoryChapterInput,
} from "nbook/server/plot/core/types";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import type {ChapterBriefInputDto, StoryActDto, StoryChapterDto} from "nbook/shared/dto/plot.dto";

/**
 * Act / Chapter(承载树)用例服务。
 * Chapter 是章的一等实体;Prose(manuscript 文件)通过 frontmatter `chapter: <name>` 反指,
 * 本服务不触碰文件系统,Prose 解析见 ChapterProseService。
 */
export class ChapterService {
    constructor(
        private readonly chapterRepository: ChapterRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
        private readonly assembler: PlotDtoAssembler,
    ) {}

    /**
     * 查询卷详情。
     */
    async getStoryActDto(actId: number): Promise<StoryActDto> {
        const story = await this.storyService.ensureStory();
        const act = await this.scopeGuard.assertAct(story.id, actId);
        return this.assembler.toStoryActDto(act);
    }

    /**
     * 创建卷;sortOrder 追加到末尾。
     */
    async createStoryAct(input: ParsedCreateStoryActInput): Promise<StoryActDto> {
        const story = await this.storyService.ensureStory();
        await this.scopeGuard.assertActNameUnique(story.id, input.name);

        const acts = await this.chapterRepository.findActsByStory(story.id);
        const act = await this.chapterRepository.createAct({
            storyId: story.id,
            sortOrder: (acts.at(-1)?.sortOrder ?? -1) + 1,
            name: input.name,
            title: input.title,
            summary: input.summary ?? "",
            note: input.note ?? null,
        });
        return this.assembler.toStoryActDto(act);
    }

    /**
     * 更新卷。
     */
    async updateStoryAct(actId: number, patch: ParsedUpdateStoryActInput): Promise<StoryActDto> {
        const story = await this.storyService.ensureStory();
        const act = await this.scopeGuard.assertAct(story.id, actId);

        if (patch.name !== undefined && patch.name !== act.name) {
            await this.scopeGuard.assertActNameUnique(story.id, patch.name, act.id);
        }

        const updated = await this.chapterRepository.updateAct(act.id, {
            name: patch.name,
            title: patch.title,
            summary: patch.summary,
            note: patch.note,
            sortOrder: patch.sortOrder,
        });
        return this.assembler.toStoryActDto(updated);
    }

    /**
     * 删除卷;旗下章节按外键 SetNull 回落到未归卷区。
     */
    async deleteStoryAct(actId: number): Promise<void> {
        const story = await this.storyService.ensureStory();
        const act = await this.scopeGuard.assertAct(story.id, actId);
        await this.chapterRepository.deleteAct(act.id);
    }

    /**
     * 查询章详情(含 ChapterBrief)。
     */
    async getStoryChapterDto(chapterId: number): Promise<StoryChapterDto> {
        const story = await this.storyService.ensureStory();
        const chapter = await this.scopeGuard.assertChapter(story.id, chapterId);
        return this.assembler.toStoryChapterDto(chapter);
    }

    /**
     * 创建章;sortOrder 追加到末尾,ChapterBrief 可在创建时一并写入。
     */
    async createStoryChapter(input: ParsedCreateStoryChapterInput): Promise<StoryChapterDto> {
        const story = await this.storyService.ensureStory();
        await this.scopeGuard.assertChapterNameUnique(story.id, input.name);
        if (input.actId !== null) {
            await this.scopeGuard.assertAct(story.id, input.actId);
        }

        const chapters = await this.chapterRepository.findChaptersByStory(story.id);
        const chapter = await this.chapterRepository.createChapter({
            storyId: story.id,
            actId: input.actId,
            sortOrder: (chapters.at(-1)?.sortOrder ?? -1) + 1,
            name: input.name,
            title: input.title,
            note: input.note ?? null,
            ...briefInputToColumns(input.brief),
        });
        return this.assembler.toStoryChapterDto(chapter);
    }

    /**
     * 更新章;brief 字段按键更新:undefined 不改,null 清空。
     */
    async updateStoryChapter(chapterId: number, patch: ParsedUpdateStoryChapterInput): Promise<StoryChapterDto> {
        const story = await this.storyService.ensureStory();
        const chapter = await this.scopeGuard.assertChapter(story.id, chapterId);

        if (patch.name !== undefined && patch.name !== chapter.name) {
            await this.scopeGuard.assertChapterNameUnique(story.id, patch.name, chapter.id);
        }
        if (patch.actId !== undefined && patch.actId !== null) {
            await this.scopeGuard.assertAct(story.id, patch.actId);
        }

        const updated = await this.chapterRepository.updateChapter(chapter.id, {
            actId: patch.actId,
            name: patch.name,
            title: patch.title,
            note: patch.note,
            sortOrder: patch.sortOrder,
            ...briefInputToColumns(patch.brief),
        });
        return this.assembler.toStoryChapterDto(updated);
    }

    /**
     * 列出 Story 下全部 Chapter name(供 Prose 孤儿指针检测等按 name 反查的场景)。
     */
    async listChapterNames(storyId: number): Promise<string[]> {
        const chapters = await this.chapterRepository.findChaptersByStory(storyId);
        return chapters.map((chapter) => chapter.name);
    }

    /**
     * 删除章;旗下 Scene 按外键 SetNull 脱离章节承载。
     * 注意:指向本章 name 的 Prose frontmatter 会成为孤儿,由 workspace validate 提示。
     */
    async deleteStoryChapter(chapterId: number): Promise<void> {
        const story = await this.storyService.ensureStory();
        const chapter = await this.scopeGuard.assertChapter(story.id, chapterId);
        await this.chapterRepository.deleteChapter(chapter.id);
    }
}

/**
 * 把 DTO 的嵌套 brief 输入映射为 StoryChapter 上的 brief* 列;只映射显式传入的键。
 */
function briefInputToColumns(brief: ChapterBriefInputDto | undefined): Partial<ChapterBriefColumns> {
    if (!brief) {
        return {};
    }
    const columns: Partial<ChapterBriefColumns> = {};
    if (brief.goal !== undefined) {
        columns.briefGoal = brief.goal;
    }
    if (brief.pov !== undefined) {
        columns.briefPov = brief.pov;
    }
    if (brief.tone !== undefined) {
        columns.briefTone = brief.tone;
    }
    if (brief.pacing !== undefined) {
        columns.briefPacing = brief.pacing;
    }
    if (brief.readerKnows !== undefined) {
        columns.briefReaderKnows = brief.readerKnows;
    }
    if (brief.protagonistKnows !== undefined) {
        columns.briefProtagonistKnows = brief.protagonistKnows;
    }
    if (brief.mustHide !== undefined) {
        columns.briefMustHide = brief.mustHide;
    }
    if (brief.hintOnly !== undefined) {
        columns.briefHintOnly = brief.hintOnly;
    }
    if (brief.opening !== undefined) {
        columns.briefOpening = brief.opening;
    }
    if (brief.ending !== undefined) {
        columns.briefEnding = brief.ending;
    }
    if (brief.doNotWrite !== undefined) {
        columns.briefDoNotWrite = brief.doNotWrite;
    }
    return columns;
}
