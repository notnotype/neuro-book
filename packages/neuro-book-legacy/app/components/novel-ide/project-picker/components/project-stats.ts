import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

export interface ProjectClassicStats {
    wordCount: string;
    chapterCount: number;
    lastChapterTitle: string;
    outlineProgress: number;
    genreKey: "scifi" | "xuanhuan" | "fantasy" | "mystery" | "urban" | "general";
    genreLabel: string;
    accentColor: string;
    themeGradient: {
        from: string;
        to: string;
        glow: string;
    };
}

/**
 * 派生经典界面的文学统计数据与题材主题色
 */
export function getProjectClassicStats(project: ProjectMetadataDto, tags?: readonly string[]): ProjectClassicStats {
    const root = project.projectRoot.toLowerCase();
    const title = project.title;

    let genreKey: ProjectClassicStats["genreKey"] = "general";
    let genreLabel = "文学创作";
    let accentColor = "var(--accent-main, #3b82f6)";
    let themeGradient = {
        from: "from-slate-700",
        to: "to-slate-900",
        glow: "rgba(59, 130, 246, 0.15)",
    };

    const allTagStr = (tags?.join(" ") ?? "") + " " + title + " " + (project.summary ?? "");

    if (allTagStr.includes("科幻") || allTagStr.includes("星") || allTagStr.includes("赛博")) {
        genreKey = "scifi";
        genreLabel = "科幻未来";
        accentColor = "#06b6d4";
        themeGradient = {
            from: "from-cyan-900",
            to: "to-slate-950",
            glow: "rgba(6, 182, 212, 0.18)",
        };
    } else if (allTagStr.includes("玄幻") || allTagStr.includes("修真") || allTagStr.includes("剑") || allTagStr.includes("道")) {
        genreKey = "xuanhuan";
        genreLabel = "玄幻修真";
        accentColor = "#8b5cf6";
        themeGradient = {
            from: "from-purple-900",
            to: "to-slate-950",
            glow: "rgba(139, 92, 246, 0.18)",
        };
    } else if (allTagStr.includes("炼金") || allTagStr.includes("西幻") || allTagStr.includes("魔法") || allTagStr.includes("迷宫")) {
        genreKey = "fantasy";
        genreLabel = "奇幻史诗";
        accentColor = "#10b981";
        themeGradient = {
            from: "from-emerald-900",
            to: "to-slate-950",
            glow: "rgba(16, 185, 129, 0.16)",
        };
    } else if (allTagStr.includes("悬疑") || allTagStr.includes("怪谈") || allTagStr.includes("诊疗室") || allTagStr.includes("梦")) {
        genreKey = "mystery";
        genreLabel = "悬疑惊悚";
        accentColor = "#e11d48";
        themeGradient = {
            from: "from-rose-950",
            to: "to-slate-950",
            glow: "rgba(225, 29, 72, 0.18)",
        };
    } else if (allTagStr.includes("都市") || allTagStr.includes("职场")) {
        genreKey = "urban";
        genreLabel = "都市职场";
        accentColor = "#3b82f6";
        themeGradient = {
            from: "from-blue-900",
            to: "to-slate-950",
            glow: "rgba(59, 130, 246, 0.16)",
        };
    }

    let hash = 0;
    for (let i = 0; i < root.length; i++) {
        hash = (hash * 31 + root.charCodeAt(i)) >>> 0;
    }

    const chapterCount = 24 + (hash % 120);
    const wordCountNum = (chapterCount * 2600 + (hash % 8000)) / 10000;
    const wordCount = `${wordCountNum.toFixed(1)} 万字`;
    const outlineProgress = Math.min(95, 35 + (hash % 58));

    const defaultChapter = `第 ${chapterCount} 章 《未竟之誓与初次启航》`;
    const sampleChapters: readonly string[] = [
        `第 ${chapterCount} 章 《跃迁尽头的红色超巨星》`,
        `第 ${chapterCount} 章 《万剑归墟，断刃重铸》`,
        `第 ${chapterCount} 章 《水银与禁忌贤者之石》`,
        `第 ${chapterCount} 章 《不存在的 14 层电梯间》`,
        `第 ${chapterCount} 章 《暴风雨前的晨曦证券》`,
    ];
    const lastChapterTitle = sampleChapters[hash % sampleChapters.length] ?? defaultChapter;

    return {
        wordCount,
        chapterCount,
        lastChapterTitle,
        outlineProgress,
        genreKey,
        genreLabel,
        accentColor,
        themeGradient,
    };
}
