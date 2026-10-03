import fs from "node:fs/promises";
import path from "node:path";
import {Buffer} from "node:buffer";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {Command} from "commander";

type CliOptions = {
    project?: string;
    out: string;
    force: boolean;
    json: boolean;
    rp?: boolean;
};

type CardKind = "character-card" | "preset" | "unknown";

type RawCardInput = {
    kind: CardKind;
    sourcePath: string;
    sourceType: "json" | "png";
    raw: unknown;
    card: Record<string, unknown>;
};

type MarkerCounts = Record<string, number>;

type EntryCategory =
    | "character"
    | "location"
    | "faction"
    | "rule"
    | "item"
    | "event"
    | "species"
    | "system"
    | "formatting"
    | "dynamic-mvu"
    | "dynamic-prompt"
    | "unknown";

type ClassificationConfidence = "high" | "medium" | "low";

type LorebookImportTarget = {
    root: string;
    type: string;
    subtype: string | null;
    status: "draft" | "pending" | "archived";
};

type MappingSummary = {
    categories: Record<EntryCategory, number>;
    lorebookTargets: Record<string, number>;
    dynamicArchived: number;
    structuralMarkers: number;
    needsReview: number;
    cardBodyMaterials: number;
};

type GeneratedManifest = {
    marker: string;
    version: 1;
    files: Record<string, {hash: string; kind: "text" | "binary"}>;
};

type UnpackedCard = {
    root: string;
    workspaceRoot: string;
    manifest: GeneratedManifest;
    inspection: CardInspection;
    loaded: RawCardInput;
};

export type EntryClassification = {
    uid: string;
    comment: string;
    enabled: boolean;
    constant: boolean;
    categories: EntryCategory[];
    primaryCategory: EntryCategory;
    confidence: ClassificationConfidence;
    reason: string;
    markerKeys: string[];
    reviewFlags: string[];
    structuralMarker: boolean;
};

type CardBodyMaterial = {
    filePath: string;
    title: string;
    content: string;
};

export type CardInspection = {
    kind: CardKind;
    sourcePath: string;
    sourceType: "json" | "png";
    slug: string;
    name: string;
    spec: string | null;
    specVersion: string | null;
    counts: {
        worldbookEntries: number;
        enabledEntries: number;
        constantEntries: number;
        regexScripts: number;
        tavernHelperScripts: number;
        tavernHelperVariables: number;
    };
    markers: MarkerCounts;
    mappingSummary: MappingSummary;
    entries: EntryClassification[];
    warnings: string[];
};

const DEFAULT_OUT = "reference/silly-tavern";
const GENERATED_MARKER = "neuro-book:silly-tavern-card generated-sha256";
const ENTRY_CATEGORIES: EntryCategory[] = ["character", "location", "faction", "rule", "item", "event", "species", "system", "formatting", "dynamic-mvu", "dynamic-prompt", "unknown"];
const PRIMARY_CATEGORY_ORDER: EntryCategory[] = ["dynamic-mvu", "dynamic-prompt", "character", "location", "faction", "species", "rule", "system", "item", "event", "formatting", "unknown"];
const DYNAMIC_CATEGORIES = new Set<EntryCategory>(["dynamic-mvu", "dynamic-prompt"]);
const IMPORT_CATEGORY_TO_LOREBOOK_ROOT: Record<EntryCategory, string> = {
    character: "lorebook/character",
    location: "lorebook/location",
    faction: "lorebook/faction",
    rule: "lorebook/world/rule",
    item: "lorebook/item",
    event: "lorebook/event",
    species: "lorebook/species",
    system: "lorebook/system",
    formatting: "lorebook/note",
    unknown: "lorebook/note",
    "dynamic-mvu": "reference/silly-tavern",
    "dynamic-prompt": "reference/silly-tavern",
};
const IMPORT_CATEGORY_TO_NODE_TYPE: Record<EntryCategory, {type: string; subtype: string | null}> = {
    character: {type: "character", subtype: null},
    location: {type: "location", subtype: null},
    faction: {type: "faction", subtype: null},
    rule: {type: "world", subtype: "rule"},
    item: {type: "item", subtype: null},
    event: {type: "event", subtype: null},
    species: {type: "species", subtype: null},
    system: {type: "system", subtype: null},
    formatting: {type: "note", subtype: null},
    unknown: {type: "note", subtype: null},
    "dynamic-mvu": {type: "note", subtype: null},
    "dynamic-prompt": {type: "note", subtype: null},
};
const DYNAMIC_MARKERS: Array<{key: string; pattern: RegExp; category: EntryCategory}> = [
    {key: "initVar", pattern: /\[initvar\]|<initvar\b/i, category: "dynamic-mvu"},
    {key: "initialVariables", pattern: /\[InitialVariables\]|@@initial_variables/i, category: "dynamic-mvu"},
    {key: "updateVariable", pattern: /<UpdateVariable\b|\[mvu_update\]|_\.(?:set|insert|assign|remove|unset|delete|add)\s*\(/i, category: "dynamic-mvu"},
    {key: "jsonPatch", pattern: /<json_?patch\b/i, category: "dynamic-mvu"},
    {key: "ejs", pattern: /<%[\s=-]?/i, category: "dynamic-prompt"},
    {key: "inject", pattern: /@INJECT/i, category: "dynamic-prompt"},
    {key: "condition", pattern: /@@if\b/i, category: "dynamic-prompt"},
    {key: "generate", pattern: /\[GENERATE:[^\]]+\]|@@generate_(?:before|after)/i, category: "dynamic-prompt"},
    {key: "render", pattern: /\[RENDER:[^\]]+\]|@@render_(?:before|after)|@@iframe|@@message_formatting/i, category: "dynamic-prompt"},
];
const COMMENT_PATTERN_RULES: Array<{category: EntryCategory; pattern: RegExp; reason: string}> = [
    {category: "species", pattern: /(?:^|[-_【\[\s])(?:种族|智慧生物|种族概览|种族血脉)(?:[-_】\]\s]|$)|DLC-扩展-.*种族-/u, reason: "comment 命中种族命名模式。"},
    {category: "character", pattern: /DLC-角色-|角色卡DLC|(?:^|[-_【\[\s])(?:角色|人物|NPC)(?:[-_】\]\s]|$)/u, reason: "comment 命中角色命名模式。"},
    {category: "location", pattern: /城镇-|地块-|冒险区域-|封印区|内城区|外环区|中城区|圣都-|(?:^|[-_【\[\s])(?:地点|地区|区域|城市|建筑|房间)(?:[-_】\]\s]|$)/u, reason: "comment 命中地点层级命名模式。"},
    {category: "faction", pattern: /政治与社会|总览$|文化$|势力概览|组织概览|(?:^|[-_【\[\s])(?:势力|组织|阵营|公会|教会)(?:[-_】\]\s]|$)/u, reason: "comment 命中势力/组织命名模式。"},
    {category: "system", pattern: /命定系统-|核心数值|状态规则|经验值|好感度|复活机制|战斗生产|品质效果|登神长阶|经济价格|角色生成|随机池|生产制作|战斗协议/u, reason: "comment 命中系统/玩法命名模式。"},
    {category: "event", pattern: /DLC-事件-.*(?:入口|本体)\b|(?:^|[-_【\[\s])(?:事件|剧情|任务|主线|支线|历史|传说)(?:[-_】\]\s]|$)/u, reason: "comment 命中事件/剧情命名模式。"},
];
const SEMANTIC_RULES: Array<{category: EntryCategory; pattern: RegExp; reason: string}> = [
    {category: "character", pattern: /(^|[-_【\s])(?:角色|人物|NPC|主角|女主|男主|学生|老师|人设|角色卡|DLC-角色)(?:[-_】\s]|$)|背景故事|关键经历|性格|外貌|口癖|关系网/u, reason: "命中角色/人物设定特征。"},
    {category: "location", pattern: /(^|[-_【\s])(?:地点|地区|区域|城市|村镇|学院区|场景|建筑|房间|宿舍|教室|酒馆|公会|广场|街区|地图|地理)(?:[-_】\s]|$)|位于|坐落|地处/u, reason: "命中地点/区域设定特征。"},
    {category: "faction", pattern: /(^|[-_【\s])(?:势力|组织|阵营|国家|帝国|王国|学院|协会|公会|社团|家族|部门|军团|教会)(?:[-_】\s]|$)|成员|隶属于/u, reason: "命中势力/组织设定特征。"},
    {category: "rule", pattern: /(^|[-_【\s])(?:规则|法则|世界规则|限制|机制|设定|能力体系|魔法|炼金|战斗|技能|数值)(?:[-_】\s]|$)|不可|必须|消耗|判定/u, reason: "命中规则/机制设定特征。"},
    {category: "item", pattern: /(^|[-_【\s])(?:物品|道具|装备|武器|药剂|材料|资源|遗物|凭证|货币|钥匙)(?:[-_】\s]|$)|持有|用途/u, reason: "命中物品/资源设定特征。"},
    {category: "event", pattern: /(^|[-_【\s])(?:事件|剧情|任务|主线|支线|历史|传说|事故|战争|仪式|开场|序章)(?:[-_】\s]|$)|发生于|导火索/u, reason: "命中事件/剧情背景特征。"},
    {category: "species", pattern: /(^|[-_【\s])(?:种族|智慧生物|亚种|血脉|寿命|繁衍|族群)(?:[-_】\s]|$)/u, reason: "命中种族/生物族群设定特征。"},
    {category: "system", pattern: /(^|[-_【\s])(?:系统|玩法|面板|状态栏|好感度|变量|背包|任务栏|日程|时间|命定系统|核心数值|状态规则|经验值|复活机制|战斗协议|生产制作|随机池|经济价格|品质效果|登神长阶|角色生成)(?:[-_】\s]|$)/u, reason: "命中系统/玩法说明特征。"},
    {category: "formatting", pattern: /(^|[-_【\s])(?:格式|回复格式|输出格式|文风|写作规则|禁止|示例回复|状态栏格式)(?:[-_】\s]|$)|不要输出|必须输出/u, reason: "命中格式/写作约束特征。"},
];
const REVIEW_MARKERS: Array<{key: string; pattern: RegExp}> = [
    {key: "status-ui", pattern: /状态栏|状态条|status\s*bar|UI|界面|面板格式|状态栏格式/i},
    {key: "runtime-meter", pattern: /好感度|变量栏|任务栏格式|日程面板|背包栏|数值栏|属性栏/u},
];

const program = new Command();

program
    .name("silly-tavern-card")
    .description("SillyTavern 角色卡 inspect、解包与 Neuro Book project 导入工具");

program
    .command("inspect")
    .description("读取本地角色卡或预设，只在 stdout 输出临时 overview，不写文件")
    .argument("<input>", "本地 .json/.raw.json/.png 文件")
    .option("--json", "stdout 输出 inspect JSON", false)
    .action(async (input: string, options: CliOptions) => {
        await runInspect(input, options);
    });

program
    .command("unpack")
    .alias("extract")
    .description("读取本地角色卡或预设，生成 reference/silly-tavern/{slug}/ 解包目录")
    .argument("<input>", "本地 .json/.raw.json/.png 文件")
    .requiredOption("--project <path>", "当前小说 Project Workspace 根目录")
    .option("--out <path>", "Project Workspace 内解包输出目录", DEFAULT_OUT)
    .option("--force", "允许覆盖未被用户手改的脚本生成文件", false)
    .option("--json", "stdout 输出解包摘要", false)
    .action(async (input: string, options: CliOptions) => {
        await runUnpack(input, options);
    });

program
    .command("import")
    .description("从解包目录导入 worldbook 到 Project Workspace 的 lorebook 文件")
    .argument("<unpackDir>", "解包目录，例如 reference/silly-tavern/{slug}")
    .requiredOption("--project <path>", "当前小说 Project Workspace 根目录")
    .option("--rp", "额外生成 RP/simulation 迁移参考归档到 reference/silly-tavern", false)
    .option("--force", "允许覆盖未被用户手改的脚本生成文件", false)
    .option("--json", "stdout 输出 import JSON 摘要", false)
    .action(async (unpackDir: string, options: CliOptions) => {
        await runImport(unpackDir, options);
    });

if (isCliEntry()) {
    runCli(process.argv).catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

export async function runCli(argv: string[]): Promise<void> {
    await program.parseAsync(argv);
}

async function runInspect(input: string, options: CliOptions): Promise<void> {
    const loaded = await loadCardInput(input);
    const inspection = inspectCard(loaded);
    if (options.json) {
        console.log(JSON.stringify({ok: true, inspection, mappingSummary: inspection.mappingSummary}, null, 2));
        return;
    }
    console.log(renderInspectMarkdown(inspection));
}

async function runUnpack(input: string, options: CliOptions): Promise<void> {
    const workspaceRoot = await assertProjectWorkspace(requiredProject(options));
    const loaded = await loadCardInput(input);
    const inspection = inspectCard(loaded);
    const target = resolveUnpackTarget(workspaceRoot, options.out, inspection.slug);
    const manifest = await loadGeneratedManifest(target.cardRoot);
    const written = await writeUnpackDirectory(target, loaded, inspection, manifest, options.force);
    await saveGeneratedManifest(target.cardRoot, manifest);
    printUnpackSummary(inspection, target, written, options.json);
}

async function runImport(unpackDir: string, options: CliOptions): Promise<void> {
    const workspaceRoot = await assertProjectWorkspace(requiredProject(options));
    const unpacked = await loadUnpackedCard(workspaceRoot, unpackDir);
    if (unpacked.inspection.kind === "unknown") {
        throw new Error("解包目录不是可识别的 SillyTavern 角色卡或 preset，已停止 import。");
    }
    const written: string[] = [];
    let importSummary: MappingSummary = emptyMappingSummary();
    if (unpacked.inspection.kind === "character-card") {
        const imported = await importWorldbookEntries(unpacked, options.force);
        written.push(...imported.written);
        importSummary = imported.mappingSummary;
        if (options.rp) {
            written.push(...await writeRpExtension(unpacked, options.force));
        }
    }
    const reportPath = path.join(unpacked.root, "import-report.md");
    await writeGeneratedText(unpacked, reportPath, renderImportReport(unpacked.inspection, written.map((item) => toProjectRelativePath(workspaceRoot, item)), importSummary), options.force);
    written.push(reportPath);
    await saveGeneratedManifest(unpacked.root, unpacked.manifest);
    printImportSummary(unpacked.inspection, workspaceRoot, written, options.json, importSummary);
}

export async function loadCardInput(inputPath: string): Promise<RawCardInput> {
    const sourcePath = path.resolve(inputPath);
    const extension = path.extname(sourcePath).toLowerCase();
    if (extension === ".json") {
        const raw = JSON.parse(await fs.readFile(sourcePath, "utf-8")) as unknown;
        return normalizeRawInput(sourcePath, "json", raw);
    }
    if (extension === ".png") {
        const raw = await readSillyTavernPngJson(sourcePath);
        return normalizeRawInput(sourcePath, "png", raw);
    }
    throw new Error(`不支持的输入类型：${extension || sourcePath}`);
}

export function inspectCard(input: RawCardInput): CardInspection {
    const data = readObject(input.card.data);
    const characterBook = readObject(data.character_book ?? input.card.character_book);
    const rawEntries = readArray(characterBook.entries);
    const entries = rawEntries.map((entry, index) => classifyEntry(entry, index));
    const extensions = readObject(data.extensions ?? input.card.extensions);
    const tavernHelper = readObject(extensions.tavern_helper);
    const regexScripts = readArray(extensions.regex_scripts);
    const helperScripts = readArray(tavernHelper.scripts);
    const helperVariables = readObject(tavernHelper.variables);
    const cardBodyMaterials = collectCardBodyMaterials(input.card);
    const allText = [
        readString(data.description),
        readString(data.scenario),
        readString(data.first_mes),
        readString(data.mes_example),
        ...rawEntries.map((entry, index) => {
            const rawEntry = readObject(entry);
            const classified = entries[index];
            return `${classified?.comment ?? ""}\n${classified?.uid ?? ""}\n${readString(rawEntry.content)}`;
        }),
        JSON.stringify(extensions),
    ].join("\n");
    const markers = countMarkers(allText);
    const mappingSummary = buildMappingSummary(entries);
    mappingSummary.cardBodyMaterials = cardBodyMaterials.length;
    const name = readString(data.name) || readString(input.card.name) || inferNameFromPath(input.sourcePath);
    const warnings: string[] = [];
    if (input.kind === "preset") {
        warnings.push("输入看起来是 SillyTavern preset，不会作为角色主体导入 lorebook。");
    }
    if (input.sourceType === "png") {
        warnings.push("PNG 内嵌 JSON 解析为 best-effort；如结果异常，优先使用已提取的 .raw.json。");
    }
    return {
        kind: input.kind,
        sourcePath: input.sourcePath,
        sourceType: input.sourceType,
        slug: slugify(name),
        name,
        spec: readString(input.card.spec) || null,
        specVersion: readString(input.card.spec_version) || null,
        counts: {
            worldbookEntries: entries.length,
            enabledEntries: entries.filter((entry) => entry.enabled).length,
            constantEntries: entries.filter((entry) => entry.constant).length,
            regexScripts: regexScripts.length,
            tavernHelperScripts: helperScripts.length,
            tavernHelperVariables: Object.keys(helperVariables).length,
        },
        markers,
        mappingSummary,
        entries,
        warnings,
    };
}

function normalizeRawInput(sourcePath: string, sourceType: "json" | "png", raw: unknown): RawCardInput {
    const card = readObject(raw);
    return {
        kind: detectCardKind(card),
        sourcePath,
        sourceType,
        raw,
        card,
    };
}

function detectCardKind(card: Record<string, unknown>): CardKind {
    const data = readObject(card.data);
    if (readString(card.spec).startsWith("chara_card") || readString(data.name) || data.character_book) {
        return "character-card";
    }
    if (card.SPreset || card.prompts || card.prompt_order || readObject(card.extensions).tavern_helper || readObject(card.extensions).regex_scripts) {
        return "preset";
    }
    return "unknown";
}

function classifyEntry(rawEntry: unknown, index: number): EntryClassification {
    const entry = readObject(rawEntry);
    const comment = readString(entry.comment) || readString(entry.name) || `entry-${index + 1}`;
    const content = readString(entry.content);
    const keys = [...readStringArray(entry.keys), ...readStringArray(entry.secondary_keys)].join("\n");
    const text = `${comment}\n${keys}\n${content}`;
    const structuralMarker = isStructuralMarker(comment, content);
    const matchedDynamicMarkers = DYNAMIC_MARKERS.filter((marker) => marker.pattern.test(text));
    const commentMatches = COMMENT_PATTERN_RULES.filter((rule) => rule.pattern.test(comment));
    const semanticMatches = SEMANTIC_RULES.filter((rule) => rule.pattern.test(text));
    const reviewFlags = REVIEW_MARKERS.filter((marker) => marker.pattern.test(text)).map((marker) => marker.key);
    const stableMatches = commentMatches.length > 0 ? commentMatches : semanticMatches;
    const categories = uniqueCategories([
        ...matchedDynamicMarkers.map((marker) => marker.category),
        ...stableMatches.map((rule) => rule.category),
    ]);
    if (categories.length === 0) {
        categories.push("unknown");
    }
    const primaryCategory = choosePrimaryCategory(categories);
    const confidence = classifyConfidence(primaryCategory, matchedDynamicMarkers.length, commentMatches.length, semanticMatches.length);
    const reason = classificationReason(structuralMarker, matchedDynamicMarkers, commentMatches, semanticMatches);
    return {
        uid: String(entry.uid ?? entry.id ?? index),
        comment,
        enabled: entry.disable !== true,
        constant: entry.constant === true,
        categories,
        primaryCategory,
        confidence,
        reason,
        markerKeys: matchedDynamicMarkers.map((marker) => marker.key),
        reviewFlags,
        structuralMarker,
    };
}

function classificationReason(
    structuralMarker: boolean,
    matchedDynamicMarkers: Array<{key: string}>,
    commentMatches: Array<{reason: string}>,
    semanticMatches: Array<{reason: string}>,
): string {
    if (matchedDynamicMarkers.length > 0) {
        return `命中动态标记：${matchedDynamicMarkers.map((marker) => marker.key).join(", ")}。`;
    }
    if (structuralMarker) {
        return "comment 命中结构分隔标记，正文为空或极短。";
    }
    return commentMatches[0]?.reason ?? semanticMatches[0]?.reason ?? "未命中明确规则，保守归入 unknown。";
}

function isStructuralMarker(comment: string, content: string): boolean {
    return comment.includes("➡️") && /(?:开始|结束)\s*$/u.test(comment) && content.length <= 40;
}

function emptyMappingSummary(): MappingSummary {
    const categories = Object.fromEntries(ENTRY_CATEGORIES.map((category) => [category, 0])) as Record<EntryCategory, number>;
    return {
        categories,
        lorebookTargets: {},
        dynamicArchived: 0,
        structuralMarkers: 0,
        needsReview: 0,
        cardBodyMaterials: 0,
    };
}

function buildMappingSummary(entries: EntryClassification[]): MappingSummary {
    const summary = emptyMappingSummary();
    for (const entry of entries) {
        summary.categories[entry.primaryCategory] += 1;
        if (entry.structuralMarker) {
            summary.structuralMarkers += 1;
            continue;
        }
        if (DYNAMIC_CATEGORIES.has(entry.primaryCategory)) {
            summary.dynamicArchived += 1;
            continue;
        }
        if (needsClassificationReview(entry)) {
            summary.needsReview += 1;
        }
        const target = resolveLorebookImportTarget(entry).root;
        summary.lorebookTargets[target] = (summary.lorebookTargets[target] ?? 0) + 1;
    }
    return summary;
}

function uniqueCategories(categories: EntryCategory[]): EntryCategory[] {
    return ENTRY_CATEGORIES.filter((category) => categories.includes(category));
}

function choosePrimaryCategory(categories: EntryCategory[]): EntryCategory {
    return PRIMARY_CATEGORY_ORDER.find((category) => categories.includes(category)) ?? "unknown";
}

function classifyConfidence(primaryCategory: EntryCategory, dynamicMatches: number, commentMatches: number, semanticMatches: number): ClassificationConfidence {
    if (primaryCategory === "unknown") {
        return "low";
    }
    if (DYNAMIC_CATEGORIES.has(primaryCategory)) {
        return dynamicMatches > 0 ? "high" : "medium";
    }
    if (commentMatches > 0) {
        return "high";
    }
    return semanticMatches > 0 ? "medium" : "low";
}

function resolveLorebookImportTarget(classified: EntryClassification): LorebookImportTarget {
    if (classified.primaryCategory === "unknown" || shouldImportAsPendingNote(classified)) {
        return {
            root: "lorebook/note",
            type: "note",
            subtype: null,
            status: classified.enabled ? "pending" : "archived",
        };
    }
    const node = IMPORT_CATEGORY_TO_NODE_TYPE[classified.primaryCategory];
    return {
        root: IMPORT_CATEGORY_TO_LOREBOOK_ROOT[classified.primaryCategory],
        type: node.type,
        subtype: node.subtype,
        status: classified.enabled ? "draft" : "archived",
    };
}

function shouldImportAsPendingNote(classified: EntryClassification): boolean {
    if (classified.confidence === "low") {
        return true;
    }
    return needsClassificationReview(classified);
}

function needsClassificationReview(classified: EntryClassification): boolean {
    if (classified.structuralMarker) {
        return false;
    }
    if (classified.primaryCategory === "unknown") {
        return true;
    }
    if (classified.categories.includes("formatting")) {
        return true;
    }
    if (classified.reviewFlags.length > 0) {
        return true;
    }
    const stableCategories = classified.categories.filter((category) => !DYNAMIC_CATEGORIES.has(category));
    return stableCategories.length > 1;
}

function readStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((item) => readString(item)).filter((item) => item.length > 0);
    }
    const single = readString(value);
    return single ? [single] : [];
}

function countMarkers(text: string): MarkerCounts {
    const counts: MarkerCounts = {};
    for (const marker of DYNAMIC_MARKERS) {
        const matches = text.match(new RegExp(marker.pattern.source, marker.pattern.flags.includes("g") ? marker.pattern.flags : `${marker.pattern.flags}g`));
        counts[marker.key] = matches?.length ?? 0;
    }
    return counts;
}

async function readSillyTavernPngJson(sourcePath: string): Promise<unknown> {
    const buffer = await fs.readFile(sourcePath);
    const chunks = readPngTextChunks(buffer);
    for (const chunk of chunks) {
        if (!/chara|ccv3|json|comment|description/i.test(chunk.keyword)) {
            continue;
        }
        const parsed = tryParseCardText(chunk.text);
        if (parsed !== undefined) {
            return parsed;
        }
    }
    for (const chunk of chunks) {
        const parsed = tryParseCardText(chunk.text);
        if (parsed !== undefined) {
            return parsed;
        }
    }
    throw new Error("未能从 PNG 中解析 SillyTavern JSON；请先使用已提取的 .raw.json。");
}

function readPngTextChunks(buffer: Buffer): Array<{keyword: string; text: string}> {
    if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
        throw new Error("输入不是有效 PNG 文件。");
    }
    const chunks: Array<{keyword: string; text: string}> = [];
    let offset = 8;
    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString("latin1");
        const dataStart = offset + 8;
        const dataEnd = dataStart + length;
        if (dataEnd + 4 > buffer.length) {
            break;
        }
        if (type === "tEXt") {
            const separator = buffer.indexOf(0, dataStart);
            if (separator > dataStart && separator < dataEnd) {
                chunks.push({
                    keyword: buffer.subarray(dataStart, separator).toString("latin1"),
                    text: buffer.subarray(separator + 1, dataEnd).toString("utf-8"),
                });
            }
        }
        offset = dataEnd + 4;
    }
    return chunks;
}

function tryParseCardText(text: string): unknown {
    const candidates = [text.trim()];
    try {
        candidates.push(Buffer.from(text.trim(), "base64").toString("utf-8").trim());
    } catch {
        // ignore invalid base64 candidate
    }
    for (const candidate of candidates) {
        if (!candidate || (!candidate.startsWith("{") && !candidate.startsWith("["))) {
            continue;
        }
        try {
            return JSON.parse(candidate);
        } catch {
            // ignore non-json candidate
        }
    }
    return undefined;
}

async function writeUnpackDirectory(target: {workspaceRoot: string; cardRoot: string}, loaded: RawCardInput, inspection: CardInspection, manifest: GeneratedManifest, force: boolean): Promise<string[]> {
    const data = readObject(loaded.card.data);
    const extensions = readObject(data.extensions ?? loaded.card.extensions);
    const tavernHelper = readObject(extensions.tavern_helper);
    const characterBook = readObject(data.character_book ?? loaded.card.character_book);
    const worldbookEntries = readArray(characterBook.entries);
    const regexScripts = readArray(extensions.regex_scripts);
    const helperScripts = readArray(tavernHelper.scripts);
    const helperVariables = readObject(tavernHelper.variables);
    const cardBodyMaterials = collectCardBodyMaterials(loaded.card);
    const written: string[] = [];
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "raw", "card.json"), JSON.stringify(loaded.raw, null, 2) + "\n", force));
    if (loaded.sourceType === "png") {
        written.push(await writeGeneratedBinary({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "raw", "source.png"), await fs.readFile(loaded.sourcePath), force));
    }
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "inspect.json"), JSON.stringify(inspection, null, 2) + "\n", force));
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "overview.md"), renderInspectMarkdown(inspection), force));
    for (const material of cardBodyMaterials) {
        written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "card-body", material.filePath), renderCardBodyMaterial(material), force));
    }
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "worldbook", "entries.json"), JSON.stringify(worldbookEntries, null, 2) + "\n", force));
    for (const item of sortWorldbookEntries(worldbookEntries)) {
        const classified = classifyEntry(item.entry, item.originalIndex);
        const fileName = `${formatInsertionOrder(item.entry)}-${slugify(classified.comment) || "entry"}.md`;
        written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "worldbook", "entries", fileName), renderWorldbookEntryArchive(item.entry, classified), force));
    }
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "extensions", "extensions.json"), JSON.stringify(extensions, null, 2) + "\n", force));
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "extensions", "regex_scripts.json"), JSON.stringify(regexScripts, null, 2) + "\n", force));
    for (const [index, script] of regexScripts.entries()) {
        written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "extensions", "regex_scripts", `${String(index + 1).padStart(3, "0")}-${slugify(readExtensionName(script, `regex-${index + 1}`))}.json`), JSON.stringify(script, null, 2) + "\n", force));
    }
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "extensions", "tavern_helper.json"), JSON.stringify(tavernHelper, null, 2) + "\n", force));
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "extensions", "tavern_helper.scripts.json"), JSON.stringify(helperScripts, null, 2) + "\n", force));
    for (const [index, script] of helperScripts.entries()) {
        written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "extensions", "tavern_helper", "scripts", `${String(index + 1).padStart(3, "0")}-${slugify(readExtensionName(script, `script-${index + 1}`))}.json`), JSON.stringify(script, null, 2) + "\n", force));
    }
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "extensions", "tavern_helper.variables.json"), JSON.stringify(helperVariables, null, 2) + "\n", force));
    for (const [key, value] of Object.entries(helperVariables)) {
        written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "extensions", "tavern_helper", "variables", `${slugify(key)}.json`), JSON.stringify({key, value}, null, 2) + "\n", force));
    }
    written.push(await writeGeneratedText({root: target.cardRoot, workspaceRoot: target.workspaceRoot, manifest}, path.join(target.cardRoot, "unpack-report.md"), renderUnpackReport(inspection, written.map((item) => toProjectRelativePath(target.workspaceRoot, item))), force));
    return written;
}

async function loadUnpackedCard(workspaceRoot: string, unpackDir: string): Promise<UnpackedCard> {
    const root = resolveUnpackRoot(workspaceRoot, unpackDir);
    const raw = JSON.parse(await fs.readFile(path.join(root, "raw", "card.json"), "utf-8")) as unknown;
    const savedInspection = JSON.parse(await fs.readFile(path.join(root, "inspect.json"), "utf-8")) as CardInspection;
    const loaded = normalizeRawInput(savedInspection.sourcePath, savedInspection.sourceType, raw);
    const inspection = inspectCard(loaded);
    return {
        root,
        workspaceRoot,
        manifest: await loadGeneratedManifest(root),
        inspection,
        loaded,
    };
}

async function importWorldbookEntries(unpacked: UnpackedCard, force: boolean): Promise<{written: string[]; mappingSummary: MappingSummary}> {
    const data = readObject(unpacked.loaded.card.data);
    const characterBook = readObject(data.character_book ?? unpacked.loaded.card.character_book);
    const entries = readArray(characterBook.entries);
    const written: string[] = [];
    const importedEntries: EntryClassification[] = [];
    for (const item of sortWorldbookEntries(entries)) {
        const entry = item.entry;
        const raw = readObject(entry);
        const classified = classifyEntry(entry, item.originalIndex);
        importedEntries.push(classified);
        if (classified.structuralMarker) {
            continue;
        }
        if (DYNAMIC_CATEGORIES.has(classified.primaryCategory)) {
            const archivePath = path.join(unpacked.root, "dynamic-worldbook", `${formatInsertionOrder(entry)}-${slugify(classified.comment) || "entry"}.md`);
            written.push(await writeGeneratedText(unpacked, archivePath, renderWorldbookEntryArchive(entry, classified), force));
            continue;
        }
        const importTarget = resolveLorebookImportTarget(classified);
        const fileSlug = slugify(`${formatInsertionOrder(entry)}-${unpacked.inspection.slug}-${classified.comment}`);
        const target = resolveLorebookImportPath(unpacked.workspaceRoot, importTarget.root, fileSlug, classified);
        written.push(await writeGeneratedText(unpacked, target, renderMarkdown({
            title: classified.comment,
            type: importTarget.type,
            subtype: importTarget.subtype,
            status: importTarget.status,
            icon: null,
            aliases: [classified.comment],
            tags: ["SillyTavern", "worldbook", classified.primaryCategory],
            summary: `从 SillyTavern 角色卡 ${unpacked.inspection.name} 导入的 ${classified.primaryCategory} 世界书条目。`,
            refs: [],
            retrieval: {
                enabled: classified.enabled,
                trigger: classified.constant ? "该世界书条目是 constant 条目，需要长期参考。" : `需要参考 ${classified.comment} 时。`,
            },
            inject: {
                profiles: [],
                always: false,
            },
            governance: {
                source: "silly-tavern-import",
                review: "proposed",
            },
            classification: {
                categories: classified.categories,
                primaryCategory: classified.primaryCategory,
                confidence: classified.confidence,
                markerKeys: classified.markerKeys,
                reviewFlags: classified.reviewFlags,
            },
            import: {
                source: "silly-tavern-worldbook",
                uid: classified.uid,
                enabled: classified.enabled,
                constant: classified.constant,
                reason: classified.reason,
                insertion_order: readInsertionOrder(raw, item.originalIndex),
            },
        }, renderWorldbookEntryBody(entry, classified)), force));
    }
    const mappingSummary = buildMappingSummary(importedEntries);
    mappingSummary.cardBodyMaterials = collectCardBodyMaterials(unpacked.loaded.card).length;
    return {
        written,
        mappingSummary,
    };
}

function resolveLorebookImportPath(workspaceRoot: string, root: string, fileSlug: string, classified: EntryClassification): string {
    if (classified.primaryCategory !== "location") {
        return path.join(workspaceRoot, root, fileSlug, "index.md");
    }
    const nested = locationPathSegments(classified.comment);
    if (nested.length === 0) {
        return path.join(workspaceRoot, root, fileSlug, "index.md");
    }
    return path.join(workspaceRoot, root, ...nested.map((segment) => slugify(segment)), "index.md");
}

function locationPathSegments(comment: string): string[] {
    const normalized = comment
        .replace(/^[【\[]|[】\]]$/gu, "")
        .replace(/\([^)]*\)\s*$/u, "")
        .trim();
    const parts = normalized.split("-").map((part) => part.trim()).filter(Boolean);
    const markerIndex = parts.findIndex((part) => /^(?:城镇|地块|冒险区域|封印区|内城区|中城区|外环区|圣都|地点|地区|区域|城市|建筑|房间)$/u.test(part));
    if (markerIndex < 0 || parts.length <= markerIndex + 1) {
        return [];
    }
    const prefix = parts.slice(0, markerIndex).filter((part) => !/^DLC$/iu.test(part));
    const suffix = parts.slice(markerIndex + 1);
    return [...prefix, ...suffix].filter((part) => part.length > 0);
}

function collectCardBodyMaterials(card: Record<string, unknown>): CardBodyMaterial[] {
    const data = readObject(card.data);
    const materials: CardBodyMaterial[] = [];
    const description = readString(data.description);
    if (description) {
        materials.push({filePath: "description.md", title: "Description", content: description});
    }
    const scenario = readString(data.scenario);
    if (scenario) {
        materials.push({filePath: "scenario.md", title: "Scenario", content: scenario});
    }
    const firstMessage = readString(data.first_mes);
    if (firstMessage) {
        materials.push({filePath: "first-message.md", title: "First Message", content: firstMessage});
    }
    const alternateGreetings = readStringArray(data.alternate_greetings);
    for (const [index, greeting] of alternateGreetings.entries()) {
        materials.push({
            filePath: path.join("alternate-greetings", `${String(index + 1).padStart(3, "0")}.md`),
            title: `Alternate Greeting ${index + 1}`,
            content: greeting,
        });
    }
    const messageExamples = readString(data.mes_example);
    if (messageExamples) {
        materials.push({filePath: "message-examples.md", title: "Message Examples", content: messageExamples});
    }
    return materials;
}

function renderCardBodyMaterial(material: CardBodyMaterial): string {
    return `# ${markdownHeadingText(material.title)}

${material.content}
`;
}

async function writeRpExtension(unpacked: UnpackedCard, force: boolean): Promise<string[]> {
    const rpRoot = path.join(unpacked.root, "simulation-migration");
    const written: string[] = [];
    const files: Array<[string, string]> = [
        ["README.md", renderSimulationMigrationReadme(unpacked.inspection)],
        ["simulator-candidates.md", renderSimulatorCandidates(unpacked.inspection, unpacked.loaded)],
        ["writer-candidates.md", renderWriterCandidates(unpacked.inspection, unpacked.loaded)],
        ["subject-candidates.md", renderSubjectCandidates(unpacked.inspection)],
        ["entity-candidates.md", renderEntityCandidates(unpacked.inspection)],
        ["unsupported-runtime.md", renderUnsupportedRuntimeArchive(unpacked.inspection, unpacked.loaded)],
    ];
    for (const [fileName, content] of files) {
        written.push(await writeGeneratedText(unpacked, path.join(rpRoot, fileName), content, force));
    }
    return written;
}

async function writeGeneratedText(unpacked: Pick<UnpackedCard, "root" | "workspaceRoot" | "manifest">, filePath: string, content: string, force: boolean): Promise<string> {
    await assertCanWriteGenerated(unpacked, filePath, content, "text", force);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, content, "utf-8");
    recordGenerated(unpacked, filePath, content, "text");
    return filePath;
}

async function writeGeneratedBinary(unpacked: Pick<UnpackedCard, "root" | "workspaceRoot" | "manifest">, filePath: string, content: Buffer, force: boolean): Promise<string> {
    await assertCanWriteGenerated(unpacked, filePath, content, "binary", force);
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, content);
    recordGenerated(unpacked, filePath, content, "binary");
    return filePath;
}

async function assertCanWriteGenerated(unpacked: Pick<UnpackedCard, "workspaceRoot" | "manifest">, filePath: string, nextContent: string | Buffer, kind: "text" | "binary", force: boolean): Promise<void> {
    const key = toProjectRelativePath(unpacked.workspaceRoot, filePath);
    try {
        const current = kind === "text" ? await fs.readFile(filePath, "utf-8") : await fs.readFile(filePath);
        if (!force) {
            throw new Error(`文件已存在，使用 --force 覆盖：${filePath}`);
        }
        const previous = unpacked.manifest.files[key];
        if (!previous || previous.hash !== sha256(current)) {
            throw new Error(`拒绝覆盖可能被用户修改的文件：${filePath}`);
        }
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return;
        }
        throw error;
    }
    void nextContent;
}

function recordGenerated(unpacked: Pick<UnpackedCard, "workspaceRoot" | "manifest">, filePath: string, content: string | Buffer, kind: "text" | "binary"): void {
    unpacked.manifest.files[toProjectRelativePath(unpacked.workspaceRoot, filePath)] = {
        hash: sha256(content),
        kind,
    };
}

async function loadGeneratedManifest(root: string): Promise<GeneratedManifest> {
    try {
        const parsed = JSON.parse(await fs.readFile(path.join(root, "generated.json"), "utf-8")) as unknown;
        if (!isRecord(parsed) || parsed.marker !== GENERATED_MARKER || parsed.version !== 1 || !isRecord(parsed.files)) {
            throw new Error(`generated.json 格式不正确：${path.join(root, "generated.json")}`);
        }
        return {
            marker: GENERATED_MARKER,
            version: 1,
            files: parsed.files as Record<string, {hash: string; kind: "text" | "binary"}>,
        };
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return {marker: GENERATED_MARKER, version: 1, files: {}};
        }
        throw error;
    }
}

async function saveGeneratedManifest(root: string, manifest: GeneratedManifest): Promise<void> {
    await fs.mkdir(root, {recursive: true});
    await fs.writeFile(path.join(root, "generated.json"), JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

function renderInspectMarkdown(inspection: CardInspection): string {
    const markerLines = Object.entries(inspection.markers).map(([key, value]) => `- ${key}: ${value}`).join("\n");
    const categoryLines = ENTRY_CATEGORIES
        .filter((category) => inspection.mappingSummary.categories[category] > 0)
        .map((category) => `- ${category}: ${inspection.mappingSummary.categories[category]}`)
        .join("\n");
    const targetLines = Object.entries(inspection.mappingSummary.lorebookTargets)
        .map(([target, count]) => `- ${target}: ${count}`)
        .join("\n");
    const entryLines = inspection.entries.slice(0, 200)
        .map((entry) => `| ${escapeTable(entry.uid)} | ${escapeTable(entry.comment)} | ${entry.enabled ? "yes" : "no"} | ${entry.constant ? "yes" : "no"} | ${escapeTable(entry.primaryCategory)} | ${entry.confidence} | ${escapeTable(entry.categories.join(", "))} | ${escapeTable(entry.reason)} | ${escapeTable(entry.reviewFlags.join(", ")) || "-"} |`)
        .join("\n");
    return `# ${markdownHeadingText(inspection.name)} Overview

## Summary

- kind: ${inspection.kind}
- source: ${inspection.sourcePath}
- spec: ${inspection.spec ?? "unknown"}
- spec_version: ${inspection.specVersion ?? "unknown"}
- slug: ${inspection.slug}

## Counts

- worldbook entries: ${inspection.counts.worldbookEntries}
- enabled entries: ${inspection.counts.enabledEntries}
- constant entries: ${inspection.counts.constantEntries}
- regex scripts: ${inspection.counts.regexScripts}
- tavern helper scripts: ${inspection.counts.tavernHelperScripts}
- tavern helper variables: ${inspection.counts.tavernHelperVariables}
- card body materials: ${inspection.mappingSummary.cardBodyMaterials}

## Dynamic Markers

${markerLines}

## Classification Mapping

### Categories

${categoryLines || "- none"}

### Lorebook Targets

${targetLines || "- none"}

- dynamic archived entries: ${inspection.mappingSummary.dynamicArchived}
- structural markers: ${inspection.mappingSummary.structuralMarkers}
- needs review: ${inspection.mappingSummary.needsReview}

## Entries

| uid | comment | enabled | constant | primary | confidence | categories | reason | review flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${entryLines || "| - | - | - | - | - | - | - | - | - |"}

## Warnings

${inspection.warnings.map((warning) => `- ${warning}`).join("\n") || "- none"}
`;
}

function renderUnpackReport(inspection: CardInspection, written: string[]): string {
    return `# ${markdownHeadingText(inspection.name)} Unpack Report

## Result

- kind: ${inspection.kind}
- dynamic runtime executed: no
- worldbook entries: ${inspection.counts.worldbookEntries}
- card body materials: ${inspection.mappingSummary.cardBodyMaterials}

## Written Files

${written.map((filePath) => `- ${filePath}`).join("\n") || "- none"}
`;
}

function renderImportReport(inspection: CardInspection, written: string[], mappingSummary: MappingSummary): string {
    const targetLines = Object.entries(mappingSummary.lorebookTargets)
        .map(([target, count]) => `- ${target}: ${count}`)
        .join("\n");
    const categoryLines = ENTRY_CATEGORIES
        .filter((category) => mappingSummary.categories[category] > 0)
        .map((category) => `- ${category}: ${mappingSummary.categories[category]}`)
        .join("\n");
    const affectedRootLines = Object.keys(mappingSummary.lorebookTargets)
        .sort()
        .map((target) => `- ${target}`)
        .join("\n");
    const dynamicEntries = inspection.entries
        .filter((entry) => DYNAMIC_CATEGORIES.has(entry.primaryCategory))
        .slice(0, 100)
        .map((entry) => `- ${entry.uid}: ${entry.comment} (${entry.primaryCategory}; ${entry.markerKeys.join(", ") || "no marker key"})`)
        .join("\n");
    const structuralEntries = inspection.entries
        .filter((entry) => entry.structuralMarker)
        .slice(0, 100)
        .map((entry) => `- ${entry.uid}: ${entry.comment}`)
        .join("\n");
    const reviewEntries = inspection.entries
        .filter((entry) => needsClassificationReview(entry))
        .slice(0, 100)
        .map((entry) => `- ${entry.uid}: ${entry.comment} (${entry.primaryCategory}; confidence=${entry.confidence}; categories=${entry.categories.join(", ")}; flags=${entry.reviewFlags.join(", ") || "none"}; reason=${entry.reason})`)
        .join("\n");
    const pendingEntries = inspection.entries
        .filter((entry) => !DYNAMIC_CATEGORIES.has(entry.primaryCategory) && resolveLorebookImportTarget(entry).status === "pending")
        .slice(0, 100)
        .map((entry) => `- ${entry.uid}: ${entry.comment} -> lorebook/note (pending)`)
        .join("\n");
    return `# ${markdownHeadingText(inspection.name)} Import Report

## Result

- kind: ${inspection.kind}
- worldbook imported: ${inspection.kind === "character-card" ? "yes" : "no"}
- dynamic runtime executed: no
- subject knowledge generated: no
- simulation entities generated: no

## Import Mapping

${targetLines || "- none"}

- dynamic archived entries: ${mappingSummary.dynamicArchived}
- structural markers: ${mappingSummary.structuralMarkers}
- needs review: ${mappingSummary.needsReview}
- card body materials: ${mappingSummary.cardBodyMaterials}

### Classification Stats

${categoryLines || "- none"}

### Affected Lorebook Roots

${affectedRootLines || "- none"}

## Written Files

${written.map((filePath) => `- ${filePath}`).join("\n") || "- none"}

## Dynamic Migration Summary

- MVU update markers: ${inspection.markers.updateVariable ?? 0}
- JSON Patch markers: ${inspection.markers.jsonPatch ?? 0}
- EJS markers: ${inspection.markers.ejs ?? 0}
- prompt injection markers: ${inspection.markers.inject ?? 0}
- render/UI markers: ${inspection.markers.render ?? 0}
- regex scripts: ${inspection.counts.regexScripts}
- tavern helper scripts: ${inspection.counts.tavernHelperScripts}
- tavern helper variables: ${inspection.counts.tavernHelperVariables}

## Dynamic Worldbook Archive

${dynamicEntries || "- none"}

## Structural Markers

${structuralEntries || "- none"}

## Card Body Materials

- files generated during unpack: ${mappingSummary.cardBodyMaterials}
- target root: reference/silly-tavern/{slug}/card-body/
- note: alternate_greetings are opening materials, not stable lorebook canon.

## Classification Review Queue

${reviewEntries || "- none"}

## Pending Lorebook Notes

${pendingEntries || "- none"}

## Recommended Next Steps

- Run \`workspace node validate\` on the affected lorebook roots above.
- Review the classification queue before treating pending notes as canon.
- Do not copy god-view worldbook content directly into \`simulation/subjects/*/memory.jsonl\`.
- For normal writing mode, initialize dynamic state with \`novel-setup\` phase 4 (World Engine init), then use \`novel-writing\` for plot/state progression.
- Legacy RP / simulation skills are archived under docs/archived/skills/; do not route normal writing mode through them.
`;
}

function renderWorldbookEntryArchive(entry: unknown, classified: EntryClassification): string {
    const raw = readObject(entry);
    return renderMarkdown({
        title: classified.comment,
        uid: classified.uid,
        enabled: classified.enabled,
        constant: classified.constant,
        categories: classified.categories,
        primaryCategory: classified.primaryCategory,
        confidence: classified.confidence,
        reason: classified.reason,
        markerKeys: classified.markerKeys,
        reviewFlags: classified.reviewFlags,
        source: "silly-tavern-worldbook",
        st: worldbookEntryMetadata(raw),
    }, `# ${markdownHeadingText(classified.comment)}

${readString(raw.content) || "（空）"}`);
}

function renderWorldbookEntryBody(entry: unknown, classified: EntryClassification): string {
    const raw = readObject(entry);
    const content = readString(raw.content);
    return `# ${markdownHeadingText(classified.comment)}

${content}
`;
}

function worldbookEntryMetadata(entry: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
        if (key === "content") {
            continue;
        }
        metadata[key] = value;
    }
    return metadata;
}

function renderSimulationMigrationReadme(inspection: CardInspection): string {
    return `# ${markdownHeadingText(inspection.name)} Simulation Migration

本目录是 SillyTavern 动态机制迁移参考，不是可直接运行的 NeuroBook simulation。

- 不创建 \`simulation/subjects/\`、\`simulation/entities/\` 或 \`simulation/runs/\`。
- 不执行 JavaScript、regex、EJS、MVU、Tavern Helper 或外部请求。
- 只把候选材料按迁移目标分组，后续由 Agent / 作者人工过滤。
- subject-facing \`memory.jsonl\` 必须从角色可知信息重写，不能直接复制上帝视角 worldbook。

## Files

- \`simulator-candidates.md\`: 可转写给 simulator leader 的规则、状态更新和玩法候选。
- \`writer-candidates.md\`: 只影响用户可见正文的风格、格式或文风候选。
- \`subject-candidates.md\`: 可能转成 subject events / memory / mind 的角色视角候选。
- \`entity-candidates.md\`: 可能需要实例化为 \`simulation/entities/\` 的状态对象候选。
- \`unsupported-runtime.md\`: 暂不迁移的 ST runtime、脚本、regex 和 UI 状态栏材料。

## Source Summary

- worldbook entries: ${inspection.counts.worldbookEntries}
- dynamic archived entries: ${inspection.mappingSummary.dynamicArchived}
- regex scripts: ${inspection.counts.regexScripts}
- tavern helper scripts: ${inspection.counts.tavernHelperScripts}
- tavern helper variables: ${inspection.counts.tavernHelperVariables}
`;
}

function renderSimulatorCandidates(inspection: CardInspection, loaded: RawCardInput): string {
    return `# ${markdownHeadingText(inspection.name)} Simulator Candidates

这些材料可能转写到 \`agents/simulator.leader/context.md\`、system lorebook 或后续 emulation bootstrap。不要直接复制动态指令。

## System / Rule Entries

${renderEntryArchive(loaded, (entry) => entry.categories.some((category) => category === "system" || category === "rule"))}

## MVU / State Update Entries

${renderEntryArchive(loaded, (entry) => entry.categories.includes("dynamic-mvu"))}
`;
}

function renderWriterCandidates(inspection: CardInspection, loaded: RawCardInput): string {
    return `# ${markdownHeadingText(inspection.name)} Writer Candidates

这些材料只在确认为作品级、静态、可复用的写作说明后，才考虑转写到 \`lorebook/instruction/\` 或 \`agents/rp.writer/context.md\`。

${renderEntryArchive(loaded, (entry) => entry.categories.some((category) => category === "formatting" || category === "dynamic-prompt"))}
`;
}

function renderSubjectCandidates(inspection: CardInspection): string {
    const lines = inspection.entries
        .filter((entry) => entry.primaryCategory === "character" || entry.categories.includes("character"))
        .slice(0, 100)
        .map((entry) => `- ${entry.uid}: ${entry.comment} (${entry.primaryCategory}; confidence=${entry.confidence})`)
        .join("\n");
    return `# ${markdownHeadingText(inspection.name)} Subject Candidates

这些条目可能帮助后续创建 \`simulation/subjects/\`，但必须按角色可知边界重写。

## Candidate Entries

${lines || "- none"}

## Migration Notes

- \`subject.md\`: 可写稳定人格、行动原则和语气。
- \`events.jsonl\`: 只记录 subject 亲历、看到或被告知的事件。
- \`memory.jsonl\`: 只写 subject 知道、相信、误解、态度或关系判断，不复制上帝视角秘密。
- \`mind.md\`: 写当前心理、动机和疑虑。
- \`state.md\`: 由 simulator leader 裁决后维护。
`;
}

function renderEntityCandidates(inspection: CardInspection): string {
    const lines = inspection.entries
        .filter((entry) => entry.primaryCategory === "item" || entry.categories.includes("item") || entry.categories.includes("system"))
        .slice(0, 100)
        .map((entry) => `- ${entry.uid}: ${entry.comment} (${entry.primaryCategory}; confidence=${entry.confidence})`)
        .join("\n");
    return `# ${markdownHeadingText(inspection.name)} Entity Candidates

这些材料可能涉及需要状态追踪的唯一物品、隐藏状态、变量化道具或系统对象。

## Candidate Entries

${lines || "- none"}

## Instance Rule

普通原型留在 \`lorebook/\`。只有存在独立状态、隐藏真相、唯一性、损坏、激活、位置或持有人差异时，才在 \`simulation/entities/\` 建立实例。
`;
}

function renderUnsupportedRuntimeArchive(inspection: CardInspection, loaded: RawCardInput): string {
    const data = readObject(loaded.card.data);
    const extensions = readObject(data.extensions ?? loaded.card.extensions);
    return `# ${markdownHeadingText(inspection.name)} Unsupported Runtime

这些内容不会被第一版导入器执行，也不会自动进入稳定 lorebook。

## Dynamic Prompt / Template Entries

${renderEntryArchive(loaded, (entry) => entry.categories.includes("dynamic-prompt"))}

## MVU / Variable Update Entries

${renderEntryArchive(loaded, (entry) => entry.categories.includes("dynamic-mvu"))}

## Scripts And Extensions

- regex_scripts: ${inspection.counts.regexScripts}
- tavern_helper.scripts: ${inspection.counts.tavernHelperScripts}
- tavern_helper.variables: ${inspection.counts.tavernHelperVariables}

\`\`\`json
${JSON.stringify({
        regex_scripts: extensions.regex_scripts ?? [],
        tavern_helper: readObject(extensions.tavern_helper),
    }, null, 2)}
\`\`\`
`;
}

function renderEntryArchive(loaded: RawCardInput, predicate: (entry: EntryClassification) => boolean): string {
    const data = readObject(loaded.card.data);
    const characterBook = readObject(data.character_book ?? loaded.card.character_book);
    const entries = readArray(characterBook.entries);
    const matched = entries
        .map((entry, index) => ({raw: readObject(entry), classified: classifyEntry(entry, index)}))
        .filter((item) => predicate(item.classified));
    return matched.map((item) => {
        const content = readString(item.raw.content);
        const fence = markdownFence(content);
        return `## ${markdownHeadingText(item.classified.comment)}

- uid: ${item.classified.uid}
- primary: ${item.classified.primaryCategory}
- confidence: ${item.classified.confidence}
- categories: ${item.classified.categories.join(", ")}
- review flags: ${item.classified.reviewFlags.join(", ") || "none"}
- reason: ${item.classified.reason}

${fence}text
${content}
${fence}
`;
    }).join("\n") || "暂无匹配条目。\n";
}

function renderMarkdown(frontmatter: Record<string, unknown>, body: string): string {
    return `---\n${toYaml(frontmatter)}---\n\n${body.trim()}\n`;
}

function toYaml(value: Record<string, unknown>): string {
    return Object.entries(value).map(([key, item]) => `${key}: ${yamlValue(item, 0)}`).join("\n") + "\n";
}

function yamlValue(value: unknown, indent: number): string {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return "[]";
        }
        const prefix = " ".repeat(indent + 2);
        return `\n${value.map((item) => `${prefix}- ${yamlValue(item, indent + 2).trimStart()}`).join("\n")}`;
    }
    if (isRecord(value)) {
        if (Object.keys(value).length === 0) {
            return "{}";
        }
        const prefix = " ".repeat(indent + 2);
        return `\n${Object.entries(value).map(([key, item]) => `${prefix}${key}: ${yamlValue(item, indent + 2)}`).join("\n")}`;
    }
    return JSON.stringify(value);
}

function printUnpackSummary(inspection: CardInspection, target: {workspaceRoot: string; cardRoot: string}, written: string[], json: boolean): void {
    const unpackDir = toProjectRelativePath(target.workspaceRoot, target.cardRoot);
    if (json) {
        console.log(JSON.stringify({ok: true, inspection, unpackDir, written: written.map((item) => toProjectRelativePath(target.workspaceRoot, item))}, null, 2));
        return;
    }
    console.log(`unpack wrote: ${unpackDir}`);
    console.log(`${inspection.kind}: ${inspection.name}`);
}

function printImportSummary(inspection: CardInspection, workspaceRoot: string, written: string[], json: boolean, mappingSummary: MappingSummary): void {
    const relativeWritten = written.map((item) => toProjectRelativePath(workspaceRoot, item));
    if (json) {
        console.log(JSON.stringify({ok: true, inspection, written: relativeWritten, mappingSummary}, null, 2));
        return;
    }
    console.log(`import finished: ${inspection.name}`);
    for (const [target, count] of Object.entries(mappingSummary.lorebookTargets)) {
        console.log(`mapping: ${target} (${count})`);
    }
    if (mappingSummary.dynamicArchived > 0) {
        console.log(`dynamic archived entries: ${mappingSummary.dynamicArchived}`);
    }
    if (mappingSummary.structuralMarkers > 0) {
        console.log(`structural markers: ${mappingSummary.structuralMarkers}`);
    }
    if (mappingSummary.needsReview > 0) {
        console.log(`needs review: ${mappingSummary.needsReview}`);
    }
    for (const item of relativeWritten) {
        console.log(`- ${item}`);
    }
}

function resolveUnpackTarget(workspaceRoot: string, out: string, slug: string): {workspaceRoot: string; cardRoot: string} {
    return {
        workspaceRoot,
        cardRoot: path.join(workspaceRoot, toSafeRelativePath(out), slug),
    };
}

function resolveUnpackRoot(workspaceRoot: string, unpackDir: string): string {
    const root = path.isAbsolute(unpackDir) ? path.resolve(unpackDir) : path.resolve(workspaceRoot, toSafeRelativePath(unpackDir));
    const relative = path.relative(workspaceRoot, root);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`解包目录必须位于 Project Workspace 内：${unpackDir}`);
    }
    return root;
}

async function assertProjectWorkspace(workspaceInput: string): Promise<string> {
    const workspaceRoot = path.resolve(workspaceInput);
    try {
        const stats = await fs.stat(workspaceRoot);
        if (!stats.isDirectory()) {
            throw new Error("not-directory");
        }
        await fs.access(path.join(workspaceRoot, "project.yaml"));
        return workspaceRoot;
    } catch {
        throw new Error(`--project 必须指向当前小说 Project Workspace，且目录下需要存在 project.yaml：${workspaceRoot}`);
    }
}

function requiredProject(options: CliOptions): string {
    if (!options.project) {
        throw new Error("缺少 --project");
    }
    return options.project;
}

export function slugify(input: string): string {
    const normalized = input.trim()
        .replace(/[\\/:*?"<>|#%{}^~[\]`;]+/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
    return normalized.slice(0, 80) || "silly-tavern-card";
}

function toSafeRelativePath(input: string): string {
    const normalized = input.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized.split("/").some((segment) => segment === ".." || segment === "")) {
        throw new Error(`路径必须是 Project Workspace 内的相对路径，且不能包含 ..：${input}`);
    }
    return normalized;
}

function toProjectRelativePath(workspaceRoot: string, absolutePath: string): string {
    const relativePath = path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath)).split(path.sep).join("/");
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return absolutePath;
    }
    return relativePath;
}

function inferNameFromPath(sourcePath: string): string {
    return path.basename(sourcePath, path.extname(sourcePath));
}

function readExtensionName(value: unknown, fallback: string): string {
    const item = readObject(value);
    return readString(item.scriptName)
        || readString(item.name)
        || readString(item.id)
        || readString(item.uid)
        || fallback;
}

function sortWorldbookEntries(entries: unknown[]): Array<{entry: unknown; originalIndex: number; insertionOrder: number}> {
    return entries
        .map((entry, originalIndex) => ({
            entry,
            originalIndex,
            insertionOrder: readInsertionOrder(entry, originalIndex),
        }))
        .sort((left, right) => left.insertionOrder - right.insertionOrder || left.originalIndex - right.originalIndex);
}

function formatInsertionOrder(entry: unknown): string {
    const order = readInsertionOrder(entry, 0);
    const normalized = Number.isFinite(order) ? order : 0;
    return String(normalized).padStart(6, "0");
}

function readInsertionOrder(entry: unknown, fallback: number): number {
    const raw = readObject(entry);
    const value = raw.insertion_order;
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
        return Number(value);
    }
    return fallback;
}

function markdownHeadingText(value: string): string {
    return value.replace(/\r?\n/g, " ").replace(/^#+\s*/u, "").trim() || "未命名条目";
}

function markdownFence(content: string): string {
    const longest = [...content.matchAll(/`+/g)].reduce((max, match) => Math.max(max, match[0].length), 2);
    return "`".repeat(longest + 1);
}

function sha256(content: string | Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

function readObject(value: unknown): Record<string, unknown> {
    return isRecord(value) ? value : {};
}

function readArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
    return isRecord(error) && error.code === code;
}

function escapeTable(value: string): string {
    return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function isCliEntry(): boolean {
    const entry = process.argv[1];
    return Boolean(entry && path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url)));
}
