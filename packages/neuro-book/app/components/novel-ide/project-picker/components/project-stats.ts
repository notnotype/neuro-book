import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

export interface CollectorBookStats {
    // 基础文学指标
    wordCount: string;
    chapterCount: number;
    lastChapterTitle: string;
    outlineProgress: number;
    // 典藏装帧色彩与质感
    leatherColor: string;
    leatherGradient: string;
    gildedColor: string;
    gildedBorder: string;
    ribbonColor: string;
    // 古典书目罗马卷号与藏书票
    tomeRoman: string;
    volumeName: string;
    exLibrisMotto: string;
    catalogCode: string;
    // 实体印鉴与工艺
    waxSealColor: string;
    waxSealText: string;
    marbledBg: string;
}

/**
 * 确定性派生典藏级别装帧参数。
 * 包含皮质色调、凸脊竹节、烫金排印、大理石环衬纹路与火漆印章。
 */
export function getCollectorBookStats(project: ProjectMetadataDto, index: number = 0): CollectorBookStats {
    const root = project.projectRoot.toLowerCase();
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

    // 典藏装帧皮革与金箔色阶库
    const leatherThemes = [
        {
            // 摩洛哥深红真皮 (Deep Morocco Red)
            leatherColor: "#451219",
            leatherGradient: "linear-gradient(135deg, #591b24 0%, #3d1217 50%, #29080c 100%)",
            gildedColor: "#f3cc69",
            gildedBorder: "#cba038",
            ribbonColor: "#a3222e",
            waxSealColor: "#8b1822",
            waxSealText: "连载",
            marbledBg: "radial-gradient(ellipse at 40% 30%, #5e1c25 0%, #2b0c10 70%, #150406 100%)",
        },
        {
            // 墨绿猎装真皮 (Forest Hunter Green)
            leatherColor: "#132d1d",
            leatherGradient: "linear-gradient(135deg, #1d422b 0%, #132d1d 50%, #0a1b10 100%)",
            gildedColor: "#e8c872",
            gildedBorder: "#be9e46",
            ribbonColor: "#226a3f",
            waxSealColor: "#144e2b",
            waxSealText: "精校",
            marbledBg: "radial-gradient(ellipse at 40% 30%, #1d442b 0%, #102919 70%, #06110a 100%)",
        },
        {
            // 牛津午夜蓝皮 (Oxford Midnight Navy)
            leatherColor: "#111d2e",
            leatherGradient: "linear-gradient(135deg, #182a42 0%, #111d2e 50%, #080f1a 100%)",
            gildedColor: "#f0d588",
            gildedBorder: "#caa852",
            ribbonColor: "#284b77",
            waxSealColor: "#17375e",
            waxSealText: "孤本",
            marbledBg: "radial-gradient(ellipse at 40% 30%, #1c3250 0%, #0e1927 70%, #050a11 100%)",
        },
        {
            // 鞍马琥珀棕皮 (Saddle Vintage Amber)
            leatherColor: "#3a2214",
            leatherGradient: "linear-gradient(135deg, #4f301d 0%, #3a2214 50%, #241309 100%)",
            gildedColor: "#f5d378",
            gildedBorder: "#c99e3a",
            ribbonColor: "#8c4a1e",
            waxSealColor: "#7e370f",
            waxSealText: "珍藏",
            marbledBg: "radial-gradient(ellipse at 40% 30%, #56331d 0%, #2f1a0e 70%, #140904 100%)",
        },
        {
            // 拜占庭御用紫皮 (Imperial Byzantine Violet)
            leatherColor: "#2c1533",
            leatherGradient: "linear-gradient(135deg, #3d1f47 0%, #2c1533 50%, #190a1e 100%)",
            gildedColor: "#eed07b",
            gildedBorder: "#c5a44a",
            ribbonColor: "#67297e",
            waxSealColor: "#57186f",
            waxSealText: "初辑",
            marbledBg: "radial-gradient(ellipse at 40% 30%, #43214e 0%, #220e29 70%, #0f0413 100%)",
        },
    ];

    const theme = leatherThemes[hash % leatherThemes.length] ?? leatherThemes[0]!;

    const romanNumerals = ["TOMUS I", "TOMUS II", "TOMUS III", "TOMUS IV", "TOMUS V", "TOMUS VI", "TOMUS VII", "TOMUS VIII"];
    const tomeRoman = romanNumerals[index % romanNumerals.length] ?? `TOMUS ${index + 1}`;
    const volumeName = `第 ${(index + 1).toString().padStart(2, "0")} 卷`;

    const exLibrisMottos = [
        "EX LIBRIS · 恒久沉思与真理之书",
        "VERITAS IN SCRIPTIS · 文字中的永恒秩序",
        "ARS LONGA, VITA BREVIS · 孤本文存",
        "MEMORIA IN PERPETUUM · 私家秘藏阁",
        "LUMEN IN TENEBRIS · 黑暗中的提灯漫笔者",
    ];
    const exLibrisMotto = exLibrisMottos[hash % exLibrisMottos.length] ?? exLibrisMottos[0]!;
    const catalogCode = `NB-CAT-${(1001 + (hash % 8999))}`;

    return {
        wordCount,
        chapterCount,
        lastChapterTitle,
        outlineProgress,
        leatherColor: theme.leatherColor,
        leatherGradient: theme.leatherGradient,
        gildedColor: theme.gildedColor,
        gildedBorder: theme.gildedBorder,
        ribbonColor: theme.ribbonColor,
        tomeRoman,
        volumeName,
        exLibrisMotto,
        catalogCode,
        waxSealColor: theme.waxSealColor,
        waxSealText: theme.waxSealText,
        marbledBg: theme.marbledBg,
    };
}
