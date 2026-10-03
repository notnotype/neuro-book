import {
    buildReferenceUri,
    INLINE_REFERENCE_KINDS,
    parseReferenceUri,
    type ReferenceKind,
} from "nbook/shared/reference-core";

export type {ReferenceKind} from "nbook/shared/reference-core";

/** 引用候选算法所需的最小章节结构，不绑定已删除的小说章节 HTTP DTO。 */
export interface ChapterReferenceSource {
    id: string;
    volumeId: string;
    title: string;
    status: "NOT_STARTED" | "DRAFT" | "REVISING" | "DONE";
    summary: string;
    characters: string[];
    todos: string[];
    sortOrder: number;
    updatedAt: string;
}

/** 引用候选算法所需的最小分卷结构。 */
export interface VolumeReferenceSource {
    id: string;
    title: string;
    summary: string;
    sortOrder: number;
    updatedAt: string;
    chapters: ChapterReferenceSource[];
}

/**
 * 单个引用源码的结构化结果。
 */
export interface ReferenceLink {
    kind: ReferenceKind;
    title: string;
    targetId: string;
}

/**
 * 文本中的一个引用 token。
 */
export interface ReferenceTextToken {
    kind: "text" | "reference";
    text: string;
    raw: string;
    reference: ReferenceLink | null;
}

/**
 * 当前光标前处于激活态的 trigger。
 */
export interface ActiveTriggerMatch {
    kind:
        | "reference-root"
        | "chapter"
        | "volume"
        | "lorebook"
        | "thread"
        | "scene"
        | "plot"
        | "skill"
        | "command";
    query: string;
    rangeStart: number;
    rangeEnd: number;
    raw: string;
}

/**
 * 章节引用候选。
 */
export interface ChapterReferenceCandidate {
    id: string;
    title: string;
    sortOrder: number;
    volumeId: string;
    volumeTitle: string;
    volumeSortOrder: number;
    summary: string;
    status: ChapterReferenceSource["status"];
    updatedAt: string;
    referenceText: string;
}

/**
 * 分卷引用候选。
 */
export interface VolumeReferenceCandidate {
    id: string;
    title: string;
    sortOrder: number;
    summary: string;
    updatedAt: string;
    referenceText: string;
}

/**
 * lorebook 引用候选。
 */
export interface LorebookReferenceCandidate {
    id: string;
    title: string;
    name: string;
    path: string;
    summary: string;
    updatedAt: string;
    treeIndex: number;
    depth: number;
    type: string;
    status: string;
    referenceText: string;
}

/**
 * 文件化 lorebook 候选树节点。
 * 这里保留纯结构类型，避免依赖旧数据库 lorebook DTO。
 */
export interface LorebookReferenceTreeEntry {
    id: string;
    novelId?: string;
    parentId?: string | null;
    sortOrder?: number;
    title: string;
    name: string;
    path: string;
    summary: string;
    createdAt?: string;
    updatedAt: string;
    type: string;
    subtype?: string | null;
    status: string;
    children: LorebookReferenceTreeEntry[];
}

const REFERENCE_KIND_PATTERN = INLINE_REFERENCE_KINDS.join("|");
const REFERENCE_LINK_PATTERN = new RegExp(`\\[([^\\]]+)\\]\\((?:@)?(${REFERENCE_KIND_PATTERN}):\\/\\/([^)]+)\\)`, "g");
const ROOT_REFERENCE_TRIGGER_PATTERN = /(?:^|[\s(])(@[a-z-]*)$/i;
const CHAPTER_TRIGGER_PATTERN = /(?:^|[\s(])(@chapter:\/\/[^\s)]*)$/i;
const VOLUME_TRIGGER_PATTERN = /(?:^|[\s(])(@volume:\/\/[^\s)]*)$/i;
const LOREBOOK_TRIGGER_PATTERN = /(?:^|[\s(])(@lorebook:\/\/[^\s)]*)$/i;
const THREAD_TRIGGER_PATTERN = /(?:^|[\s(])(@thread:\/\/[^\s)]*)$/i;
const SCENE_TRIGGER_PATTERN = /(?:^|[\s(])(@scene:\/\/[^\s)]*)$/i;
const PLOT_TRIGGER_PATTERN = /(?:^|[\s(])(@plot:\/\/[^\s)]*)$/i;
const SKILL_TRIGGER_PATTERN = /(?:^|[\s(])(\$(?:\{(?:[\p{L}_-][\p{L}\p{N}_-]*)?\}?|[\p{L}_-][\p{L}\p{N}_-]*|)?)$/u;
const COMMAND_TRIGGER_PATTERN = /(?:^|[\s(])(\/[a-z-]*)$/i;
const MAX_CONTEXT_TERMS = 16;

interface WeightedContextTerm {
    term: string;
    weight: number;
}

/**
 * 构造引用 markdown 源码。
 */
export function buildReferenceMarkdown(link: ReferenceLink): string {
    return `[${link.title}](${buildReferenceUri(link.kind, link.targetId)})`;
}

/**
 * 解析完整的引用 markdown 源码。
 */
export function parseReferenceLink(raw: string): ReferenceLink | null {
    const matched = /^\[([^\]]+)\]\((?:@)?([a-z]+):\/\/([^)]+)\)$/.exec(raw);
    if (!matched) {
        return null;
    }

    const title = matched[1]?.trim() ?? "";
    const uri = parseReferenceUri(`${matched[2] ?? ""}://${matched[3] ?? ""}`);
    if (!title || !uri) {
        return null;
    }

    return {
        kind: uri.kind,
        title,
        targetId: uri.targetId,
    };
}

/**
 * 将文本切分为普通文本与引用 token。
 */
export function tokenizeReferenceText(text: string): ReferenceTextToken[] {
    const tokens: ReferenceTextToken[] = [];
    let lastIndex = 0;

    for (const matched of text.matchAll(REFERENCE_LINK_PATTERN)) {
        const matchedIndex = matched.index ?? -1;
        const raw = matched[0] ?? "";
        if (matchedIndex < 0 || !raw) {
            continue;
        }

        if (matchedIndex > lastIndex) {
            const plainText = text.slice(lastIndex, matchedIndex);
            tokens.push({
                kind: "text",
                text: plainText,
                raw: plainText,
                reference: null,
            });
        }

        tokens.push({
            kind: "reference",
            text: raw,
            raw,
            reference: parseReferenceLink(raw),
        });
        lastIndex = matchedIndex + raw.length;
    }

    if (lastIndex < text.length) {
        const plainText = text.slice(lastIndex);
        tokens.push({
            kind: "text",
            text: plainText,
            raw: plainText,
            reference: null,
        });
    }

    return tokens;
}

/**
 * 在当前光标位置查找激活中的 trigger。
 */
export function findActiveTrigger(text: string, caret: number): ActiveTriggerMatch | null {
    const safeCaret = Math.max(0, Math.min(caret, text.length));
    const prefix = text.slice(0, safeCaret);

    return resolveTriggerMatch(prefix, CHAPTER_TRIGGER_PATTERN, "chapter")
        ?? resolveTriggerMatch(prefix, VOLUME_TRIGGER_PATTERN, "volume")
        ?? resolveTriggerMatch(prefix, LOREBOOK_TRIGGER_PATTERN, "lorebook")
        ?? resolveTriggerMatch(prefix, THREAD_TRIGGER_PATTERN, "thread")
        ?? resolveTriggerMatch(prefix, SCENE_TRIGGER_PATTERN, "scene")
        ?? resolveTriggerMatch(prefix, PLOT_TRIGGER_PATTERN, "plot")
        ?? resolveTriggerMatch(prefix, ROOT_REFERENCE_TRIGGER_PATTERN, "reference-root")
        ?? resolveTriggerMatch(prefix, SKILL_TRIGGER_PATTERN, "skill")
        ?? resolveTriggerMatch(prefix, COMMAND_TRIGGER_PATTERN, "command");
}

/**
 * 用选中的引用替换当前 trigger 片段。
 */
export function replaceTriggerWithReference(
    text: string,
    trigger: Pick<ActiveTriggerMatch, "rangeStart" | "rangeEnd">,
    link: ReferenceLink,
): {text: string; caret: number} {
    const referenceText = `${buildReferenceMarkdown(link)} `;
    const nextText = `${text.slice(0, trigger.rangeStart)}${referenceText}${text.slice(trigger.rangeEnd)}`;
    return {
        text: nextText,
        caret: trigger.rangeStart + referenceText.length,
    };
}

/**
 * 用选中的普通 token 替换当前 trigger。
 */
export function replaceTriggerText(
    text: string,
    trigger: Pick<ActiveTriggerMatch, "rangeStart" | "rangeEnd">,
    value: string,
): {text: string; caret: number} {
    const nextValue = `${value} `;
    return {
        text: `${text.slice(0, trigger.rangeStart)}${nextValue}${text.slice(trigger.rangeEnd)}`,
        caret: trigger.rangeStart + nextValue.length,
    };
}

/**
 * 将章节树拍平成引用候选。
 */
export function flattenChapterReferenceCandidates(volumes: VolumeReferenceSource[]): ChapterReferenceCandidate[] {
    return volumes.flatMap((volume) => volume.chapters.map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        sortOrder: chapter.sortOrder,
        volumeId: volume.id,
        volumeTitle: volume.title,
        volumeSortOrder: volume.sortOrder,
        summary: chapter.summary,
        status: chapter.status,
        updatedAt: chapter.updatedAt,
        referenceText: buildReferenceMarkdown({
            kind: "chapter",
            title: chapter.title,
            targetId: chapter.id,
        }),
    })));
}

/**
 * 将分卷列表拍平成引用候选。
 */
export function flattenVolumeReferenceCandidates(volumes: VolumeReferenceSource[]): VolumeReferenceCandidate[] {
    return volumes.map((volume) => ({
        id: volume.id,
        title: volume.title,
        sortOrder: volume.sortOrder,
        summary: volume.summary,
        updatedAt: volume.updatedAt,
        referenceText: buildReferenceMarkdown({
            kind: "volume",
            title: volume.title,
            targetId: volume.id,
        }),
    }));
}

/**
 * 过滤章节引用候选。
 */
export function filterChapterReferenceCandidates(
    candidates: ChapterReferenceCandidate[],
    query: string,
): ChapterReferenceCandidate[] {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) {
        return candidates;
    }

    return candidates.filter((candidate) => {
        const chapterNumber = buildChapterNumberLabel(candidate.sortOrder);
        const compactChapterNumber = chapterNumber.replace(/\s+/g, "");
        const numberText = String(candidate.sortOrder + 1);
        const paddedNumberText = String(candidate.sortOrder + 1).padStart(2, "0");
        const haystack = [
            candidate.id,
            candidate.title,
            candidate.summary,
            candidate.volumeTitle,
            chapterNumber,
            compactChapterNumber,
            numberText,
            paddedNumberText,
        ].map(normalizeQuery).join("\n");

        return haystack.includes(normalizedQuery);
    });
}

/**
 * 根据当前章节与最近访问历史生成三组章节候选。
 */
export function groupChapterReferenceCandidates(
    volumes: VolumeReferenceSource[],
    selectedChapterId: string,
    recentChapterIds: string[],
    query: string,
): {
    nearby: ChapterReferenceCandidate[];
    recent: ChapterReferenceCandidate[];
    ascending: ChapterReferenceCandidate[];
} {
    const allCandidates = flattenChapterReferenceCandidates(volumes)
        .sort((left, right) => left.volumeSortOrder - right.volumeSortOrder || left.sortOrder - right.sortOrder);
    const filteredAscending = filterChapterReferenceCandidates(allCandidates, query);
    const candidateMap = new Map(filteredAscending.map((candidate) => [candidate.id, candidate]));

    const nearbyIds = resolveNearbyChapterIds(volumes, selectedChapterId);
    const nearby = nearbyIds
        .map((chapterId) => candidateMap.get(chapterId) ?? null)
        .filter((candidate): candidate is ChapterReferenceCandidate => candidate !== null);

    const nearbyIdSet = new Set(nearby.map((candidate) => candidate.id));
    const recent: ChapterReferenceCandidate[] = [];
    for (const chapterId of recentChapterIds) {
        if (chapterId === selectedChapterId || nearbyIdSet.has(chapterId)) {
            continue;
        }

        const candidate = candidateMap.get(chapterId);
        if (!candidate) {
            continue;
        }

        recent.push(candidate);
        nearbyIdSet.add(chapterId);
    }

    return {
        nearby,
        recent,
        ascending: filteredAscending.filter((candidate) => !nearbyIdSet.has(candidate.id)),
    };
}

/**
 * 过滤分卷引用候选。
 */
export function filterVolumeReferenceCandidates(
    candidates: VolumeReferenceCandidate[],
    query: string,
): VolumeReferenceCandidate[] {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) {
        return [...candidates].sort((left, right) => left.sortOrder - right.sortOrder);
    }

    return [...candidates]
        .filter((candidate) => {
            const volumeNumber = `第${String(candidate.sortOrder + 1)}卷`;
            const haystack = [
                candidate.id,
                candidate.title,
                candidate.summary,
                volumeNumber,
                String(candidate.sortOrder + 1),
                String(candidate.sortOrder + 1).padStart(2, "0"),
            ].map(normalizeQuery).join("\n");
            return haystack.includes(normalizedQuery);
        })
        .sort((left, right) => left.sortOrder - right.sortOrder);
}

/**
 * 将 lorebook 树拍平成引用候选。
 */
export function flattenLorebookReferenceCandidates(entries: LorebookReferenceTreeEntry[]): LorebookReferenceCandidate[] {
    const result: LorebookReferenceCandidate[] = [];

    /**
     * 递归拍平树结构。
     */
    const visitEntries = (items: LorebookReferenceTreeEntry[], depth: number): void => {
        for (const entry of items) {
            result.push({
                id: entry.id,
                title: entry.title,
                name: entry.name,
                path: entry.path,
                summary: entry.summary,
                updatedAt: entry.updatedAt,
                treeIndex: result.length,
                depth,
                type: entry.type,
                status: entry.status,
                referenceText: buildReferenceMarkdown({
                    kind: "lorebook",
                    title: entry.title,
                    targetId: entry.id,
                }),
            });
            visitEntries(entry.children, depth + 1);
        }
    };

    visitEntries(entries, 0);
    return result;
}

/**
 * 按 query 与当前章节上下文对 lorebook 候选排序。
 */
export function rankLorebookReferenceCandidates(
    candidates: LorebookReferenceCandidate[],
    query: string,
    currentChapter: Pick<ChapterReferenceSource, "title" | "summary" | "characters" | "todos"> | null,
): LorebookReferenceCandidate[] {
    const normalizedQuery = normalizeQuery(query);
    const contextTerms = extractChapterContextTerms(currentChapter);

    return [...candidates]
        .map((candidate) => ({
            candidate,
            queryScore: buildLorebookQueryScore(candidate, normalizedQuery),
            contextScore: buildLorebookContextScore(candidate, contextTerms),
        }))
        .filter((item) => normalizedQuery ? item.queryScore > 0 : true)
        .sort((left, right) => (
            right.queryScore - left.queryScore
            || right.contextScore - left.contextScore
            || right.candidate.updatedAt.localeCompare(left.candidate.updatedAt)
            || left.candidate.treeIndex - right.candidate.treeIndex
        ))
        .map((item) => item.candidate);
}

/**
 * 章节编号文案。
 */
export function buildChapterNumberLabel(sortOrder: number): string {
    return `第${String(sortOrder + 1).padStart(2, "0")}章`;
}

/**
 * 解析具体 trigger 正文。
 */
function resolveTriggerMatch(
    prefix: string,
    pattern: RegExp,
    kind: ActiveTriggerMatch["kind"],
): ActiveTriggerMatch | null {
    const matched = pattern.exec(prefix);
    const raw = matched?.[1] ?? "";
    if (!raw) {
        return null;
    }
    if (kind === "skill" && raw === "${}") {
        return null;
    }

    return {
        kind,
        query: resolveTriggerQuery(kind, raw),
        rangeStart: prefix.length - raw.length,
        rangeEnd: prefix.length,
        raw,
    };
}

/**
 * 根据 trigger 类型提取不含协议头的查询文本。
 */
function resolveTriggerQuery(kind: ActiveTriggerMatch["kind"], raw: string): string {
    if (kind === "chapter") {
        return raw.slice("@chapter://".length);
    }
    if (kind === "volume") {
        return raw.slice("@volume://".length);
    }
    if (kind === "lorebook") {
        return raw.slice("@lorebook://".length);
    }
    if (kind === "skill" && raw.startsWith("${")) {
        return raw.slice(2, raw.endsWith("}") ? -1 : undefined);
    }
    return raw.slice(1);
}

/**
 * 归一化搜索关键词。
 */
function normalizeQuery(value: string): string {
    return value.trim().toLocaleLowerCase("zh-CN");
}

/**
 * 生成附近章节 ID。
 */
function resolveNearbyChapterIds(volumes: VolumeReferenceSource[], selectedChapterId: string): string[] {
    for (const volume of volumes) {
        const chapterIndex = volume.chapters.findIndex((chapter) => chapter.id === selectedChapterId);
        if (chapterIndex < 0) {
            continue;
        }

        return volume.chapters
            .slice(Math.max(0, chapterIndex - 3), chapterIndex + 4)
            .map((chapter) => chapter.id);
    }

    return [];
}

/**
 * 计算 lorebook query 的优先级分数。
 */
function buildLorebookQueryScore(candidate: LorebookReferenceCandidate, normalizedQuery: string): number {
    if (!normalizedQuery) {
        return 1;
    }

    const normalizedId = normalizeQuery(candidate.id);
    const normalizedPath = normalizeQuery(candidate.path);
    const normalizedName = normalizeQuery(candidate.name);
    const normalizedTitle = normalizeQuery(candidate.title);
    const normalizedSummary = normalizeQuery(candidate.summary);

    if (normalizedId === normalizedQuery) {
        return 900;
    }
    if (normalizedId.startsWith(normalizedQuery)) {
        return 820;
    }
    if ([normalizedPath, normalizedName, normalizedTitle].some((field) => field === normalizedQuery)) {
        return 760;
    }
    if ([normalizedPath, normalizedName, normalizedTitle].some((field) => field.startsWith(normalizedQuery))) {
        return 680;
    }
    if ([normalizedPath, normalizedName, normalizedTitle].some((field) => field.includes(normalizedQuery))) {
        return 620;
    }
    if (normalizedSummary.includes(normalizedQuery)) {
        return 540;
    }

    return 0;
}

/**
 * 计算 lorebook 与当前章节的相关度。
 */
function buildLorebookContextScore(candidate: LorebookReferenceCandidate, contextTerms: WeightedContextTerm[]): number {
    if (contextTerms.length === 0) {
        return 0;
    }

    const titleHaystack = [
        candidate.title,
        candidate.name,
        candidate.path,
    ].map(normalizeQuery).join("\n");
    const summaryHaystack = normalizeQuery(candidate.summary);

    let score = 0;
    for (const item of contextTerms) {
        if (titleHaystack.includes(item.term)) {
            score += item.weight + Math.max(3, Math.min(item.term.length, 6));
            continue;
        }

        if (summaryHaystack.includes(item.term)) {
            score += Math.max(1, Math.floor(item.weight / 2));
        }
    }

    return score;
}

/**
 * 从当前章节抽取 lorebook 相关度用词。
 */
function extractChapterContextTerms(
    currentChapter: Pick<ChapterReferenceSource, "title" | "summary" | "characters" | "todos"> | null,
): WeightedContextTerm[] {
    if (!currentChapter) {
        return [];
    }

    const weightedTerms = [
        ...segmentSearchTerms([currentChapter.title]).map((term) => ({term, weight: 10})),
        ...segmentSearchTerms([currentChapter.summary]).map((term) => ({term, weight: 6})),
        ...segmentSearchTerms(currentChapter.characters).map((term) => ({term, weight: 5})),
        ...segmentSearchTerms(currentChapter.todos).map((term) => ({term, weight: 4})),
    ];

    const dedupedTerms = new Map<string, WeightedContextTerm>();
    for (const item of weightedTerms) {
        const previous = dedupedTerms.get(item.term);
        if (!previous || previous.weight < item.weight) {
            dedupedTerms.set(item.term, item);
        }
    }

    return [...dedupedTerms.values()].slice(0, MAX_CONTEXT_TERMS);
}

/**
 * 将自然语言切分成搜索词。
 */
function segmentSearchTerms(parts: string[]): string[] {
    const sourceText = parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" ");
    if (!sourceText) {
        return [];
    }

    const terms: string[] = [];
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
        const segmenter = new Intl.Segmenter("zh", {granularity: "word"});
        for (const item of segmenter.segment(sourceText)) {
            const value = normalizeQuery(item.segment);
            if (isUsefulSearchTerm(value)) {
                terms.push(value);
            }
        }
    }

    if (terms.length > 0) {
        return terms;
    }

    return sourceText
        .split(/[\s,，。！？、；：\-_/]+/)
        .map(normalizeQuery)
        .filter(isUsefulSearchTerm);
}

/**
 * 判断搜索词是否有意义。
 */
function isUsefulSearchTerm(term: string): boolean {
    if (!term) {
        return false;
    }

    if (/^[a-z0-9-]{2,}$/i.test(term)) {
        return true;
    }

    return /[\u4e00-\u9fff]/.test(term);
}
