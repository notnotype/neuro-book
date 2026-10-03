import {readProjectWorkspaceTreeSnapshot} from "nbook/server/workspace-files/project-workspace-index";
import type {WorkspaceFileNode} from "nbook/server/workspace-files/workspace-files";
import type {ProjectFileIndexHandle} from "nbook/server/workspace-files/project-file-index";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";

type ProjectWorkspaceFileTarget = Extract<WorkspaceFileTarget, {kind: "project-workspace"}>;

/** Prose 节点解析结果:manuscript 下通过 frontmatter `chapter: <name>` 反指某章的内容节点。 */
export type ChapterProseNode = {
    // Project Workspace 相对目录路径,例如 manuscript/002-volume/001-chapter。
    path: string;
    // 正文写入目标(index.md)的 Project Workspace 相对路径。
    indexPath: string;
    title: string;
    // frontmatter.chapter 的原始指针值(已 trim)。
    chapterName: string;
    words: number;
};

/**
 * Chapter ↔ Prose 关联服务(frontmatter 反指)。
 *
 * Chapter 是 Plot 系统的一等实体;Prose 是 manuscript 下的内容节点,通过 frontmatter
 * `chapter: <StoryChapter.name>` 反指所属章。关联信息长在文件上,文件移动/改名不影响 Chapter。
 * 查询复用 ProjectWorkspaceIndex 内存快照(watcher 自动失效重建),不做额外磁盘扫描。
 */
export class ChapterProseService {
    constructor(
        private readonly target: ProjectWorkspaceFileTarget,
        private readonly fileIndex: ProjectFileIndexHandle,
    ) {}

    /**
     * 解析指定章的全部 Prose(按 path 升序;通常一章一份,多份表示草稿/重写版共存)。
     */
    async findProseForChapter(chapterName: string): Promise<ChapterProseNode[]> {
        const pointers = await this.listChapterPointers();
        return pointers.filter((node) => node.chapterName === chapterName);
    }

    /**
     * 全量列出 manuscript 下带 chapter 指针的 Prose 节点,供 brief 编译、审计与孤儿检测。
     */
    async listChapterPointers(): Promise<ChapterProseNode[]> {
        const snapshot = await readProjectWorkspaceTreeSnapshot({
            target: this.target,
            fileIndex: this.fileIndex,
        });
        return snapshot.nodes
            .filter((node) => isProsePointerNode(node))
            .map((node) => toChapterProseNode(node))
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    /**
     * 按已注册 Chapter name 集合分拣孤儿指针(指向不存在的章)。
     * 返回值供上层生成 workspace validate WARN 或 brief warning。
     */
    async findOrphanPointers(knownChapterNames: Set<string>): Promise<ChapterProseNode[]> {
        const pointers = await this.listChapterPointers();
        return pointers.filter((node) => !knownChapterNames.has(node.chapterName));
    }
}

/**
 * 判断节点是否是带合法 chapter 指针的 manuscript 内容节点。
 */
function isProsePointerNode(node: WorkspaceFileNode): boolean {
    if (!node.isDirectory || !node.contentNode) {
        return false;
    }
    const normalizedPath = node.path.replace(/\/+$/, "");
    if (!normalizedPath.startsWith("manuscript/")) {
        return false;
    }
    const pointer = node.frontmatter.chapter;
    return typeof pointer === "string" && pointer.trim().length > 0;
}

/**
 * 把 workspace 节点转成 Prose 解析结果。
 */
function toChapterProseNode(node: WorkspaceFileNode): ChapterProseNode {
    const normalizedPath = node.path.replace(/\/+$/, "");
    return {
        path: normalizedPath,
        indexPath: `${normalizedPath}/index.md`,
        title: node.title,
        chapterName: String(node.frontmatter.chapter).trim(),
        words: node.words,
    };
}
