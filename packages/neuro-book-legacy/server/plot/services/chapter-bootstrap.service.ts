import fs from "node:fs/promises";
import path from "node:path";
import type {ChapterRepository} from "nbook/server/plot/contracts/plot-repositories";
import {PlotScopeGuard} from "nbook/server/plot/services/plot-scope.guard";
import {StoryService} from "nbook/server/plot/services/story.service";
import {chapterIdentityFromPath} from "nbook/server/workspace-files/project-workspace";
import {parseMarkdownDocument, renderMarkdownDocument} from "nbook/server/workspace-files/workspace-files";
import type {WorkspaceFileNode} from "nbook/server/workspace-files/workspace-files";
import {recordProjectWrite} from "nbook/server/workspace-history/project-history";
import type {ProjectHistoryHandle} from "nbook/server/workspace-history/project-history";
import type {ProjectFileIndexHandle} from "nbook/server/workspace-files/project-file-index";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";

type ProjectWorkspaceFileTarget = Extract<WorkspaceFileTarget, {kind: "project-workspace"}>;

/** Bootstrap 执行结果统计。 */
export type CarrierTreeBootstrapResult = {
    actsCreated: number;
    chaptersCreated: number;
    chaptersLinkedToAct: number;
    proseFrontmatterWritten: string[];
    warnings: string[];
};

/** 待回写的 Prose frontmatter 反指:章目录节点 + 章 name。事务提交后由 writeProsePointers 落盘。 */
export type PendingProsePointer = {
    node: WorkspaceFileNode;
    chapterName: string;
};

/** applyCarrierTree(事务内)产出:DB 统计 + 待事务外落盘的 frontmatter 指针清单。 */
export type CarrierTreeDbResult = {
    actsCreated: number;
    chaptersCreated: number;
    chaptersLinkedToAct: number;
    pendingPointers: PendingProsePointer[];
};

/**
 * 承载树 Bootstrap:把现有 manuscript 目录结构导入 Act/Chapter 实体,并回写 Prose frontmatter 反指。
 *
 * 用于旧项目一次性迁移(《命定之诗2》等)。幂等:已存在的同 name Act/Chapter 不重建,
 * 已有 chapter 指针的 Prose 不改写;可反复执行。
 * Scene.chapterPath → chapterId 的数据迁移由 initProjectDatabase 的 DB 级迁移负责,本服务不重复处理。
 */
export class ChapterBootstrapService {
    constructor(
        private readonly chapterRepository: ChapterRepository,
        private readonly storyService: StoryService,
        private readonly scopeGuard: PlotScopeGuard,
    ) {}

    /**
     * 事务内:根据 manuscript 节点建 Act(卷)/Chapter(章)行,并收集待写 frontmatter 反指清单。
     *
     * 只做 DB 写入。manuscript 目录扫描已由调用方在事务外完成(传入 nodes),Prose frontmatter
     * 回写由 writeProsePointers 在事务提交后执行——两处慢文件 I/O 都不能进 Prisma interactive
     * transaction,否则真实项目会撑爆默认 5s 事务超时(见 Task 87 bootstrap 实测)。
     */
    async applyCarrierTree(nodes: WorkspaceFileNode[]): Promise<CarrierTreeDbResult> {
        const story = await this.storyService.ensureStory();
        const result: CarrierTreeDbResult = {
            actsCreated: 0,
            chaptersCreated: 0,
            chaptersLinkedToAct: 0,
            pendingPointers: [],
        };

        const volumeNodes = collectManuscriptNodes(nodes, "volume");
        const chapterNodes = collectManuscriptNodes(nodes, "chapter");

        // 1. 卷:按目录序 ensure StoryAct;name 与 chapter 同一推导契约。
        const actIdByVolumePath = new Map<string, number>();
        for (const [index, node] of volumeNodes.entries()) {
            const identity = chapterIdentityFromPath(node.path);
            let act = await this.chapterRepository.findActByName(story.id, identity.name);
            if (!act) {
                act = await this.chapterRepository.createAct({
                    storyId: story.id,
                    sortOrder: index,
                    name: identity.name,
                    title: node.title || identity.title,
                    summary: "",
                    note: null,
                });
                result.actsCreated += 1;
            } else if (act.sortOrder !== index) {
                act = await this.chapterRepository.updateAct(act.id, {sortOrder: index});
            }
            actIdByVolumePath.set(normalizeNodePath(node.path), act.id);
        }

        // 2. 章:按目录序 ensure StoryChapter,归属父 volume 的 Act。
        for (const [index, node] of chapterNodes.entries()) {
            const identity = chapterIdentityFromPath(node.path);
            const parentVolumePath = findParentVolumePath(node.path, actIdByVolumePath);
            const actId = parentVolumePath === null ? null : actIdByVolumePath.get(parentVolumePath) ?? null;
            let chapter = await this.chapterRepository.findChapterByName(story.id, identity.name);
            if (!chapter) {
                chapter = await this.chapterRepository.createChapter({
                    storyId: story.id,
                    actId,
                    sortOrder: index,
                    name: identity.name,
                    title: node.title || identity.title,
                    note: null,
                });
                result.chaptersCreated += 1;
            } else {
                // DB 迁移建的行 actId 为空;bootstrap 负责补卷归属与目录序,不覆盖用户改过的 title。
                const patch: {actId?: number | null; sortOrder?: number} = {};
                if (chapter.actId === null && actId !== null) {
                    patch.actId = actId;
                    result.chaptersLinkedToAct += 1;
                }
                if (chapter.sortOrder !== index) {
                    patch.sortOrder = index;
                }
                if (Object.keys(patch).length > 0) {
                    chapter = await this.chapterRepository.updateChapter(chapter.id, patch);
                }
            }

            // 3. 收集待写 frontmatter 反指清单(不碰文件系统,留到事务提交后)。
            result.pendingPointers.push({node, chapterName: identity.name});
        }

        return result;
    }
}

/**
 * 事务提交后回写 Prose frontmatter 反指(纯文件 I/O,与 DB 事务解耦)。
 * 已有 chapter 指针的文件跳过；全部写入经 File Index mutation gate 串行并自动刷新 snapshot。
 */
export async function writeProsePointers(
    target: ProjectWorkspaceFileTarget,
    pointers: PendingProsePointer[],
    history: ProjectHistoryHandle,
    fileIndex: ProjectFileIndexHandle,
): Promise<{proseFrontmatterWritten: string[]; warnings: string[]}> {
    const proseFrontmatterWritten: string[] = [];
    const warnings: string[] = [];
    await fileIndex.mutate(async () => {
        for (const {node, chapterName} of pointers) {
            const written = await writeChapterPointer(target.root, node, chapterName, warnings, history);
            if (written) {
                proseFrontmatterWritten.push(written);
            }
        }
    });
    return {proseFrontmatterWritten, warnings};
}

/**
 * 收集 manuscript 下指定 entryType 的内容节点,按 path 升序(即目录名前缀序)。
 */
function collectManuscriptNodes(nodes: WorkspaceFileNode[], entryType: "volume" | "chapter"): WorkspaceFileNode[] {
    return nodes
        .filter((node) => node.isDirectory && node.contentNode && node.entryType === entryType)
        .filter((node) => normalizeNodePath(node.path).startsWith("manuscript/"))
        .sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * 去掉路径结尾斜杠。
 */
function normalizeNodePath(nodePath: string): string {
    return nodePath.replace(/\/+$/, "");
}

/**
 * 找到 chapter 目录所属的 volume 目录(最长前缀匹配);不在任何 volume 下时返回 null。
 */
function findParentVolumePath(chapterPath: string, actIdByVolumePath: Map<string, number>): string | null {
    const normalized = normalizeNodePath(chapterPath);
    let best: string | null = null;
    for (const volumePath of actIdByVolumePath.keys()) {
        if (normalized.startsWith(`${volumePath}/`) && (best === null || volumePath.length > best.length)) {
            best = volumePath;
        }
    }
    return best;
}

/**
 * 向 Prose index.md 写入 `chapter: <name>` 反指;已有指针或解析失败时跳过。
 * 返回写入的文件相对路径,未写入返回 null。
 */
async function writeChapterPointer(
    projectRoot: AbsoluteFsPath,
    node: WorkspaceFileNode,
    chapterName: string,
    warnings: string[],
    history: ProjectHistoryHandle,
): Promise<string | null> {
    const indexPath = path.join(node.absolutePath, "index.md");
    let content: string;
    try {
        content = await fs.readFile(indexPath, "utf-8");
    } catch {
        warnings.push(`跳过 ${node.path}:index.md 不可读`);
        return null;
    }
    const parsed = parseMarkdownDocument(content);
    if (parsed.error) {
        warnings.push(`跳过 ${node.path}:frontmatter 解析失败(${parsed.error})`);
        return null;
    }
    if (typeof parsed.frontmatter.chapter === "string" && parsed.frontmatter.chapter.trim()) {
        return null;
    }
    const rendered = renderMarkdownDocument({...parsed.frontmatter, chapter: chapterName}, parsed.body);
    await fs.writeFile(indexPath, rendered, "utf-8");
    const relativePath = `${normalizeNodePath(node.path)}/index.md`;
    // frontmatter 反指绕过常规写入口，这里直接记 system 归因账（fail-open，不阻断 bootstrap）。
    await recordProjectWrite(history, {
        relativePath,
        actor: {kind: "system", source: "chapter-bootstrap"},
        before: Buffer.from(content, "utf-8"),
        after: Buffer.from(rendered, "utf-8"),
    });
    return relativePath;
}
