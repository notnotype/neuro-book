export interface WorkspaceReferenceSearchConfig {
    candidates: {
        includeContentNodes: boolean;
        includeDirectoriesWithIndex: boolean;
        includeFiles: boolean;
        excludedFileExtensions: string[];
        excludedPathSegments: string[];
        pinnedFiles: string[];
    };
    scoring: {
        exactLabel: number;
        exactTarget: number;
        exactFileName: number;
        prefixLabel: number;
        prefixTarget: number;
        prefixFileName: number;
        includesLabel: number;
        includesTarget: number;
        includesFileName: number;
        frontmatterIds: number;
        compact: number;
        pinyinText: number;
        pinyinInitials: number;
        description: number;
        entryType: number;
        menuId: number;
        subsequencePenalty: number;
        fuzzyBase: number;
    };
    boosts: {
        pinnedFile: number;
        configFile: number;
    };
    grouping: {
        groupOrder: string[];
        respectScoreAcrossGroups: boolean;
    };
    limits: {
        maxResults: number;
        fuzzyThreshold: number;
    };
}

/**
 * 引用选择器搜索排序配置。
 * 数字越小越靠前；boost 使用负数表示加权提前。
 */
export const DEFAULT_WORKSPACE_REFERENCE_SEARCH_CONFIG: WorkspaceReferenceSearchConfig = {
    candidates: {
        includeContentNodes: true,
        includeDirectoriesWithIndex: true,
        includeFiles: true,
        excludedFileExtensions: [
            ".7z",
            ".app",
            ".bin",
            ".class",
            ".dll",
            ".dmg",
            ".exe",
            ".gz",
            ".iso",
            ".jar",
            ".lock",
            ".msi",
            ".o",
            ".obj",
            ".rar",
            ".so",
            ".tar",
            ".tmp",
            ".zip",
        ],
        excludedPathSegments: [".git", ".nbook", "node_modules"],
        pinnedFiles: ["AGENTS.md", "PROJECT-STATUS.md", "project.yaml", "workspace.yaml"],
    },
    scoring: {
        exactLabel: 0,
        exactTarget: 2,
        exactFileName: 0,
        prefixLabel: 6,
        prefixTarget: 10,
        prefixFileName: 4,
        includesLabel: 18,
        includesTarget: 28,
        includesFileName: 14,
        frontmatterIds: 8,
        compact: 34,
        pinyinText: 48,
        pinyinInitials: 58,
        description: 72,
        entryType: 86,
        menuId: 92,
        subsequencePenalty: 18,
        fuzzyBase: 100,
    },
    boosts: {
        pinnedFile: -12,
        configFile: -8,
    },
    grouping: {
        groupOrder: ["file", "chapter", "character", "location", "item", "rule", "note", "folder"],
        respectScoreAcrossGroups: true,
    },
    limits: {
        maxResults: 40,
        fuzzyThreshold: 0.42,
    },
};
