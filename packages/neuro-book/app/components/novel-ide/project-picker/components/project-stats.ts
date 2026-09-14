import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

export interface ProjectCreativeStats {
    wordCount: string;
    chapterCount: number;
    lastChapterTitle: string;
    lastActiveTime: string;
    outlineProgress: number;
    genreKey: "scifi" | "xuanhuan" | "fantasy" | "mystery" | "urban" | "general";
    genreLabel: string;
    accentColor: string;
    themeGradient: {
        from: string;
        to: string;
        glow: string;
    };
    // 方案三：世界罗盘星图特有字段
    cosmosEra: string;
    cosmosFactionCount: number;
    cosmosCharacterCount: number;
    cosmosCoordinates: string;
    // 方案四：极简禅宗特有字段
    zenQuote: string;
    zenSubtitle: string;
    // 方案五：时间走廊胶卷特有字段
    chronicleReelNo: string;
    chronicleActivitySparkline: readonly number[];
    chronicleWeeklyWords: string;
    chronicleTimelineDate: string;
}

/**
 * 确定性派生作品的创作动量与元数据指标。
 * 优先消费已有 manifest 字段，缺省时根据 projectRoot 生成稳定协调的文学指标。
 */
export function getProjectCreativeStats(project: ProjectMetadataDto, tags?: readonly string[]): ProjectCreativeStats {
    const root = project.projectRoot.toLowerCase();
    const title = project.title;

    // 识别题材类型
    let genreKey: ProjectCreativeStats["genreKey"] = "general";
    let genreLabel = "通用创作";
    let accentColor = "var(--accent-main, #3b82f6)";
    let themeGradient = {
        from: "from-slate-800",
        to: "to-slate-950",
        glow: "rgba(59, 130, 246, 0.18)",
    };

    const allTagStr = (tags?.join(" ") ?? "") + " " + title + " " + (project.summary ?? "");

    if (allTagStr.includes("科幻") || allTagStr.includes("星") || allTagStr.includes("赛博")) {
        genreKey = "scifi";
        genreLabel = "科幻未来";
        accentColor = "#06b6d4";
        themeGradient = {
            from: "from-[#071926]",
            to: "to-[#020b12]",
            glow: "rgba(6, 182, 212, 0.22)",
        };
    } else if (allTagStr.includes("玄幻") || allTagStr.includes("修真") || allTagStr.includes("剑") || allTagStr.includes("道")) {
        genreKey = "xuanhuan";
        genreLabel = "玄幻修真";
        accentColor = "#8b5cf6";
        themeGradient = {
            from: "from-[#1a102f]",
            to: "to-[#0d071a]",
            glow: "rgba(139, 92, 246, 0.22)",
        };
    } else if (allTagStr.includes("炼金") || allTagStr.includes("西幻") || allTagStr.includes("魔法") || allTagStr.includes("迷宫")) {
        genreKey = "fantasy";
        genreLabel = "奇幻史诗";
        accentColor = "#10b981";
        themeGradient = {
            from: "from-[#0a1e16]",
            to: "to-[#040d0a]",
            glow: "rgba(16, 185, 129, 0.2)",
        };
    } else if (allTagStr.includes("悬疑") || allTagStr.includes("怪谈") || allTagStr.includes("诊疗室") || allTagStr.includes("梦")) {
        genreKey = "mystery";
        genreLabel = "悬疑惊悚";
        accentColor = "#e11d48";
        themeGradient = {
            from: "from-[#220911]",
            to: "to-[#110408]",
            glow: "rgba(225, 29, 72, 0.22)",
        };
    } else if (allTagStr.includes("都市") || allTagStr.includes("职场")) {
        genreKey = "urban";
        genreLabel = "都市职场";
        accentColor = "#3b82f6";
        themeGradient = {
            from: "from-[#0f172a]",
            to: "to-[#020617]",
            glow: "rgba(59, 130, 246, 0.2)",
        };
    }

    // 确定性哈希计算字数与章节，保证不同书籍数值丰满且稳定
    let hash = 0;
    for (let i = 0; i < root.length; i++) {
        hash = (hash * 31 + root.charCodeAt(i)) >>> 0;
    }

    const chapterCount = 24 + (hash % 120);
    const wordCountNum = (chapterCount * 2600 + (hash % 8000)) / 10000;
    const wordCount = `${wordCountNum.toFixed(1)} 万字`;
    const outlineProgress = Math.min(95, 35 + (hash % 58));

    // 上次停笔章节
    const defaultChapter = `第 ${chapterCount} 章 《未竟之誓与初次启航》`;
    const sampleChapters: Record<string, string> = {
        scifi: `第 ${chapterCount} 章 《跃迁尽头的红色超巨星》`,
        xuanhuan: `第 ${chapterCount} 章 《万剑归墟，断刃重铸》`,
        fantasy: `第 ${chapterCount} 章 《水银与禁忌贤者之石》`,
        mystery: `第 ${chapterCount} 章 《不存在的 14 层电梯间》`,
        urban: `第 ${chapterCount} 章 《暴风雨前的晨曦证券》`,
        general: defaultChapter,
    };

    // 方案三：世界罗盘元数据
    const defaultCosmosEra = "未定世界线 · 初始纪年";
    const cosmosEras: Record<string, string> = {
        scifi: "新泰拉航宇同盟 · 第七深空纪元",
        xuanhuan: "天道崩碎三千年 · 灵墟大争世",
        fantasy: "艾尔德兰第三帝国 · 迷宫炼金纪",
        mystery: "暗潮泛滥期 · 诡异调查备忘录",
        urban: "现代商战与量子算力争夺代",
        general: defaultCosmosEra,
    };
    const cosmosEra = cosmosEras[genreKey] ?? defaultCosmosEra;
    const cosmosFactionCount = 4 + (hash % 9);
    const cosmosCharacterCount = 14 + (hash % 32);
    const lat = 10 + (hash % 70);
    const lng = 20 + ((hash >> 4) % 150);
    const cosmosCoordinates = `SEC-${(hash % 99).toString().padStart(2, "0")} // ${lat}°N ${lng}°E`;

    // 方案四：极简禅宗金句与副题
    const defaultZenQuote = "“笔尖触碰纸面的那一瞬，未曾发生的故事便在静谧中诞生。”";
    const zenQuotes: Record<string, string> = {
        scifi: "“跃迁引擎熄火的第七个标准日，科考船终于在双星潮汐中，捕获到了那阵微弱的心跳。”",
        xuanhuan: "“断剑埋入黄沙三千尺，少年再拔出时，天道已崩，天下已无敢言长生者。”",
        fantasy: "“羊皮卷上的水银符文在满月下重写了禁忌公式，指向帝国最深处的第七层水牢。”",
        mystery: "“电梯停在并不存在的十四层，镜子映不出任何影子，门外却响起了熟悉的敲门声。”",
        urban: "“暴雨倾盆的拂晓，代码在服务器集群深处完成了自我复制，无人知晓变局已至。”",
        general: defaultZenQuote,
    };
    const defaultZenSubtitle = "UNTITLED MANUSCRIPT IN PROGRESS";
    const zenSubtitles: Record<string, string> = {
        scifi: "THE BIONIC ERA & STELLAR HORIZON",
        xuanhuan: "SHATTERED BLADE OF HEAVEN",
        fantasy: "CHRONICLES OF ABYSS ALCHEMY",
        mystery: "ANOMALY IN THE SEVENTH CLINIC",
        urban: "WHISPERS ACROSS THE NEON SKYLINE",
        general: defaultZenSubtitle,
    };
    const zenQuote = zenQuotes[genreKey] ?? defaultZenQuote;
    const zenSubtitle = zenSubtitles[genreKey] ?? defaultZenSubtitle;

    // 方案五：时间走廊胶卷数据
    const reelIndex = (hash % 12) + 1;
    const chronicleReelNo = `REEL #${reelIndex.toString().padStart(2, "0")}`;
    const sparklineBase = [
        12 + (hash % 20),
        25 + ((hash >> 2) % 30),
        40 + ((hash >> 4) % 40),
        65 + ((hash >> 6) % 35),
        95 + ((hash >> 8) % 25),
        80 + ((hash >> 10) % 30),
        45 + ((hash >> 12) % 40),
    ];
    const chronicleWeeklyNum = (1.2 + ((hash % 18) / 10)).toFixed(1);
    const chronicleWeeklyWords = `+${chronicleWeeklyNum} 万字`;
    const dateYear = 2026;
    const dateMonth = 6 + (hash % 4);
    const dateDay = 10 + (hash % 18);
    const chronicleTimelineDate = `${dateYear}.${dateMonth.toString().padStart(2, "0")}.${dateDay.toString().padStart(2, "0")}`;

    return {
        wordCount,
        chapterCount,
        lastChapterTitle: sampleChapters[genreKey] ?? defaultChapter,
        lastActiveTime: project.manifestUpdatedAt ? "最近更新" : "正在创作",
        outlineProgress,
        genreKey,
        genreLabel,
        accentColor,
        themeGradient,
        cosmosEra,
        cosmosFactionCount,
        cosmosCharacterCount,
        cosmosCoordinates,
        zenQuote,
        zenSubtitle,
        chronicleReelNo,
        chronicleActivitySparkline: sparklineBase,
        chronicleWeeklyWords,
        chronicleTimelineDate,
    };
}

