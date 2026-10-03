import type {AgentTriggerMenuItem, AgentTriggerMenuSection} from "nbook/app/components/novel-ide/agent/trigger-menu";
import type {WorkspaceFileNode} from "nbook/app/stores/novel-ide";
import {
    searchWorkspaceReferences,
    type WorkspaceReferenceSearchInput,
    type WorkspaceReferenceSearchResult,
} from "nbook/app/utils/workspace-reference-search";
import {
    DEFAULT_WORKSPACE_REFERENCE_SEARCH_CONFIG,
    type WorkspaceReferenceSearchConfig,
} from "nbook/app/utils/workspace-reference-search-config";

/**
 * 从 workspace tree 生成按类型分组的引用候选。
 */
export function buildWorkspaceReferenceSections(
    workspaceTree: WorkspaceFileNode[],
    query: string,
    config: WorkspaceReferenceSearchConfig = DEFAULT_WORKSPACE_REFERENCE_SEARCH_CONFIG,
): AgentTriggerMenuSection[] {
    const candidates = workspaceTree
        .filter((node) => isReferenceCandidate(node, config))
        .map((node, index): WorkspaceReferenceSearchInput<AgentTriggerMenuItem> => {
            const label = node.title?.trim() || basename(node.path);
            const target = referenceTarget(node);
            const entryType = resolveReferenceEntryType(node);
            const item = {
                id: `workspace-reference:${target}`,
                label,
                description: node.summary || target,
                iconClass: node.icon ? `i-lucide-${node.icon}` : node.isDirectory ? "i-lucide-folder" : "i-lucide-file-text",
                hint: entryType,
                workspaceReference: {
                    label,
                    target,
                    entryType,
                    icon: node.icon,
                },
            } satisfies AgentTriggerMenuItem;
            return {
                item,
                label,
                target,
                description: node.summary || target,
                entryType,
                menuId: item.id,
                frontmatter: node.frontmatter,
                order: index,
            };
        });
    const results = searchWorkspaceReferences(candidates, query, config.limits.maxResults, config);
    const sections = groupSearchResults(results, config);
    return sections
        .filter((section) => section.items.length > 0);
}

/**
 * 解析引用候选的展示类型。
 */
function resolveReferenceEntryType(node: WorkspaceFileNode): string {
    if (node.contentNode && node.entryType && !node.frontmatterError) {
        return node.entryType;
    }
    return node.isDirectory ? "folder" : "file";
}

/**
 * 引用菜单分组标题。
 */
function referenceSectionTitle(entryType: string): string {
    const titles: Record<string, string> = {
        chapter: "章节",
        character: "角色",
        location: "地点",
        item: "物品",
        rule: "规则",
        note: "笔记",
        file: "文件",
        folder: "目录",
    };
    return titles[entryType] ?? entryType;
}

/**
 * 判断节点是否适合作为 @ 引用候选。
 */
function isReferenceCandidate(node: WorkspaceFileNode, config: WorkspaceReferenceSearchConfig): boolean {
    if (node.isDirectory) {
        return (config.candidates.includeContentNodes && node.contentNode)
            || (config.candidates.includeDirectoriesWithIndex && node.hasIndex);
    }
    if (node.contentNode && node.path.toLowerCase().endsWith("/index.md")) {
        return false;
    }
    if (!config.candidates.includeFiles) {
        return false;
    }
    const lowerPath = node.path.toLocaleLowerCase("zh-CN");
    if (config.candidates.excludedPathSegments.some((segment) => hasPathSegment(lowerPath, segment))) {
        return false;
    }
    return !config.candidates.excludedFileExtensions.some((extension) => lowerPath.endsWith(extension.toLocaleLowerCase("zh-CN")));
}

/**
 * 将节点路径转成 Markdown 引用 target。
 */
function referenceTarget(node: WorkspaceFileNode): string {
    if (node.isDirectory) {
        return `${normalizeWorkspacePath(node.path)}/`;
    }
    return normalizeWorkspacePath(node.path);
}

/**
 * 返回路径 basename。
 */
function basename(filePath: string): string {
    const normalizedPath = normalizeWorkspacePath(filePath);
    return normalizedPath.includes("/") ? normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1) : normalizedPath;
}

/**
 * 标准化 workspace 相对路径。
 */
function normalizeWorkspacePath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/").replace(/^workspace\//, "").replace(/^\.\//, "");
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/**
 * 判断路径是否包含被黑名单排除的目录段。
 */
function hasPathSegment(lowerPath: string, segment: string): boolean {
    const lowerSegment = segment.toLocaleLowerCase("zh-CN");
    return lowerPath.split("/").includes(lowerSegment);
}

/**
 * 保留分组展示，同时用搜索分数决定各组出现顺序。
 */
function groupSearchResults(
    results: Array<WorkspaceReferenceSearchResult<AgentTriggerMenuItem>>,
    config: WorkspaceReferenceSearchConfig,
): AgentTriggerMenuSection[] {
    const groups = new Map<string, Array<WorkspaceReferenceSearchResult<AgentTriggerMenuItem>>>();
    for (const result of results) {
        const entryType = result.item.workspaceReference?.entryType ?? "file";
        const group = groups.get(entryType) ?? [];
        group.push(result);
        groups.set(entryType, group);
    }

    const groupOrder = new Map(config.grouping.groupOrder.map((entryType, index) => [entryType, index]));
    return [...groups.entries()]
        .map(([entryType, groupResults]) => ({
            entryType,
            minScore: Math.min(...groupResults.map((result) => result.score)),
            firstOrder: Math.min(...groupResults.map((result) => result.order)),
            items: groupResults
                .sort((left, right) => left.score - right.score || left.order - right.order)
                .map((result) => result.item),
        }))
        .sort((left, right) => {
            if (config.grouping.respectScoreAcrossGroups) {
                return left.minScore - right.minScore
                    || (groupOrder.get(left.entryType) ?? 999) - (groupOrder.get(right.entryType) ?? 999)
                    || left.firstOrder - right.firstOrder;
            }
            return (groupOrder.get(left.entryType) ?? 999) - (groupOrder.get(right.entryType) ?? 999)
                || left.minScore - right.minScore
                || left.firstOrder - right.firstOrder;
        })
        .map((group) => ({
            id: `workspace-reference-${group.entryType}`,
            title: referenceSectionTitle(group.entryType),
            items: group.items,
        }));
}
