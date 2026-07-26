import fs from "node:fs/promises";
import path from "node:path";

/**
 * RP 模式 v2 角色信息与记忆存储（设计见 docs/tasks/100-rp-mode-v2/README.md 第四节）。
 *
 * 目录布局（相对 Project Workspace 根）：
 *
 * ```
 * rp/characters/{characterId}/
 * ├── 人设/
 * │   ├── soul.md          第一人称扮演手册
 * │   └── 心境.md          短期情绪/意图/悬念，每 Tick 更新
 * ├── 已知信息/
 * │   └── knowledge.md     状态性知识（信念非真相），永不老化
 * ├── 未知信息(god-view)/
 * │   ├── ledger.md        未知信息账本：角色不知道但与他相关的事
 * │   └── truth-notes.md   已知条目的属实批注（K 条目为假/存疑时）
 * ├── 记忆/
 * │   ├── 摘要.md          三级粒度滚动（远期段落/中期行/近期每 Tick 一行）
 * │   └── ticks/TickNNNNNN.md  该角色视角的当 Tick 详情
 * ├── events.jsonl         RAG 联想通道（经历流，追加式）
 * └── memory.jsonl         RAG 联想通道（稳定认知）
 * ```
 *
 * 原则：
 * - 「未知信息(god-view)」目录内容绝不注入 actor；仅 screenwriter / rp.leader 可读。
 * - knowledge.md 存角色「相信的」；条目是否属实由 truth-notes.md（god-view）批注。
 * - 摘要压缩内容由调用方 agent 生成，本模块只做机械移动。
 */

export const RP_CHARACTERS_RELATIVE_ROOT = "rp/characters";

const PERSONA_DIR = "人设";
const KNOWLEDGE_DIR = "已知信息";
const GOD_VIEW_DIR = "未知信息(god-view)";
const MEMORY_DIR = "记忆";

const SOUL_FILE = `${PERSONA_DIR}/soul.md`;
const MOOD_FILE = `${PERSONA_DIR}/心境.md`;
const KNOWLEDGE_FILE = `${KNOWLEDGE_DIR}/knowledge.md`;
const LEDGER_FILE = `${GOD_VIEW_DIR}/ledger.md`;
const TRUTH_NOTES_FILE = `${GOD_VIEW_DIR}/truth-notes.md`;
const SUMMARY_FILE = `${MEMORY_DIR}/摘要.md`;
const TICKS_DIR = `${MEMORY_DIR}/ticks`;

/** 近期段超过该条数即建议滚动压缩。 */
export const DEFAULT_RECENT_ROLLUP_THRESHOLD = 20;

// ---- 类型 --------------------------------------------------------------------

export type KnowledgeEntry = {
    id: string;
    topic: string;
    content: string;
    /** 信息来源（听谁说的/亲眼所见/推断）。 */
    source: string;
    /** 得知 Tick。 */
    learnedTick: number;
    /** 最后更新 Tick（首次等于 learnedTick）。 */
    updatedTick: number;
};

export type TruthNote = {
    knowledgeId: string;
    /** 属实性：false = 角色被骗/误解；"unverified" = 尚无定论。 */
    truth: "true" | "false" | "unverified";
    /** god-view 真相说明。 */
    note: string;
};

export type UnknownEntry = {
    id: string;
    topic: string;
    content: string;
    /** 事件实际发生的 Tick。 */
    occurredTick: number;
    /** 可选的揭示时机建议。 */
    revealHint?: string;
};

export type SummarySections = {
    /** 远期：段落列表（每段概括一个时期）。 */
    far: string[];
    /** 中期：`- [Tick a-b] 概括` 行列表。 */
    mid: string[];
    /** 近期：`- [Tick n] 概括` 行列表。 */
    recent: Array<{tick: number; line: string}>;
};

export type CharacterActorView = {
    soul: string;
    mood: string;
    knowledge: KnowledgeEntry[];
    summary: SummarySections;
};

export type CharacterGodView = CharacterActorView & {
    unknown: UnknownEntry[];
    truthNotes: TruthNote[];
};

// ---- 路径与初始化 -------------------------------------------------------------

export function rpCharacterRoot(projectRoot: string, characterId: string): string {
    return path.join(projectRoot, RP_CHARACTERS_RELATIVE_ROOT, safeCharacterId(characterId));
}

export function safeCharacterId(characterId: string): string {
    const trimmed = characterId.trim();
    if (!trimmed || !/^[\p{L}\p{N}_-]+$/u.test(trimmed)) {
        throw new Error(`非法角色 id（只允许字母/数字/下划线/连字符）：${characterId}`);
    }
    return trimmed;
}

export async function listRpCharacters(projectRoot: string): Promise<string[]> {
    const root = path.join(projectRoot, RP_CHARACTERS_RELATIVE_ROOT);
    try {
        const entries = await fs.readdir(root, {withFileTypes: true});
        return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
    }
}

export async function rpCharacterExists(projectRoot: string, characterId: string): Promise<boolean> {
    try {
        await fs.access(path.join(rpCharacterRoot(projectRoot, characterId), SOUL_FILE));
        return true;
    } catch {
        return false;
    }
}

/** 创建角色目录骨架（幂等；已存在的文件不覆盖）。 */
export async function ensureRpCharacter(projectRoot: string, characterId: string, options: {soul?: string} = {}): Promise<void> {
    const root = rpCharacterRoot(projectRoot, characterId);
    await fs.mkdir(path.join(root, PERSONA_DIR), {recursive: true});
    await fs.mkdir(path.join(root, KNOWLEDGE_DIR), {recursive: true});
    await fs.mkdir(path.join(root, GOD_VIEW_DIR), {recursive: true});
    await fs.mkdir(path.join(root, TICKS_DIR), {recursive: true});
    await writeIfMissing(path.join(root, SOUL_FILE), options.soul ?? "# 我是谁\n\n（第一人称扮演手册，见 subject-creation-guide）\n");
    await writeIfMissing(path.join(root, MOOD_FILE), "# 心境\n\n（当前情绪、短期意图、悬着的疑问；每 Tick 更新）\n");
    await writeIfMissing(path.join(root, KNOWLEDGE_FILE), "# 已知信息\n");
    await writeIfMissing(path.join(root, LEDGER_FILE), "# 未知信息账本(god-view)\n");
    await writeIfMissing(path.join(root, TRUTH_NOTES_FILE), "# 属实批注(god-view)\n");
    await writeIfMissing(path.join(root, SUMMARY_FILE), "# 记忆摘要\n\n## 远期\n\n## 中期\n\n## 近期\n");
    await writeIfMissing(path.join(root, "events.jsonl"), "");
    await writeIfMissing(path.join(root, "memory.jsonl"), "");
}

// ---- 人设与心境 ---------------------------------------------------------------

export async function readSoul(projectRoot: string, characterId: string): Promise<string> {
    return readText(path.join(rpCharacterRoot(projectRoot, characterId), SOUL_FILE));
}

export async function writeSoul(projectRoot: string, characterId: string, content: string): Promise<void> {
    await writeText(path.join(rpCharacterRoot(projectRoot, characterId), SOUL_FILE), content);
}

export async function readMood(projectRoot: string, characterId: string): Promise<string> {
    return readText(path.join(rpCharacterRoot(projectRoot, characterId), MOOD_FILE));
}

export async function writeMood(projectRoot: string, characterId: string, content: string): Promise<void> {
    await writeText(path.join(rpCharacterRoot(projectRoot, characterId), MOOD_FILE), content);
}

// ---- 已知信息（K 条目） --------------------------------------------------------

export async function listKnowledge(projectRoot: string, characterId: string): Promise<KnowledgeEntry[]> {
    const raw = await readText(path.join(rpCharacterRoot(projectRoot, characterId), KNOWLEDGE_FILE));
    return parseKnowledge(raw);
}

export async function addKnowledge(projectRoot: string, characterId: string, input: {
    topic: string;
    content: string;
    source: string;
    tick: number;
}): Promise<KnowledgeEntry> {
    const filePath = path.join(rpCharacterRoot(projectRoot, characterId), KNOWLEDGE_FILE);
    const raw = await readText(filePath);
    const entries = parseKnowledge(raw);
    const entry: KnowledgeEntry = {
        id: nextId("K", entries.map((item) => item.id)),
        topic: input.topic.trim(),
        content: input.content.trim(),
        source: input.source.trim(),
        learnedTick: input.tick,
        updatedTick: input.tick,
    };
    entries.push(entry);
    await writeText(filePath, renderKnowledge(entries));
    return entry;
}

/** 原地更新条目内容（状态性知识变化）。找不到条目时抛错。 */
export async function updateKnowledge(projectRoot: string, characterId: string, id: string, patch: {
    content?: string;
    source?: string;
    tick: number;
}): Promise<KnowledgeEntry> {
    const filePath = path.join(rpCharacterRoot(projectRoot, characterId), KNOWLEDGE_FILE);
    const entries = parseKnowledge(await readText(filePath));
    const entry = entries.find((item) => item.id === id);
    if (!entry) {
        throw new Error(`已知信息条目不存在：${id}`);
    }
    if (patch.content !== undefined) entry.content = patch.content.trim();
    if (patch.source !== undefined) entry.source = patch.source.trim();
    entry.updatedTick = patch.tick;
    await writeText(filePath, renderKnowledge(entries));
    return entry;
}

// ---- 未知信息账本（U 条目，god-view） ------------------------------------------

export async function listUnknown(projectRoot: string, characterId: string): Promise<UnknownEntry[]> {
    const raw = await readText(path.join(rpCharacterRoot(projectRoot, characterId), LEDGER_FILE));
    return parseUnknown(raw);
}

export async function addUnknown(projectRoot: string, characterId: string, input: {
    topic: string;
    content: string;
    occurredTick: number;
    revealHint?: string;
}): Promise<UnknownEntry> {
    const filePath = path.join(rpCharacterRoot(projectRoot, characterId), LEDGER_FILE);
    const entries = parseUnknown(await readText(filePath));
    const entry: UnknownEntry = {
        id: nextId("U", entries.map((item) => item.id)),
        topic: input.topic.trim(),
        content: input.content.trim(),
        occurredTick: input.occurredTick,
        ...(input.revealHint?.trim() ? {revealHint: input.revealHint.trim()} : {}),
    };
    entries.push(entry);
    await writeText(filePath, renderUnknown(entries));
    return entry;
}

/**
 * 揭示：把 U 条目移出账本、生成 K 条目写入已知信息。
 * contentOverride 允许按「角色实际得知的版本」改写内容（可以与真相有偏差）。
 */
export async function revealUnknown(projectRoot: string, characterId: string, unknownId: string, input: {
    source: string;
    tick: number;
    contentOverride?: string;
}): Promise<KnowledgeEntry> {
    const ledgerPath = path.join(rpCharacterRoot(projectRoot, characterId), LEDGER_FILE);
    const entries = parseUnknown(await readText(ledgerPath));
    const index = entries.findIndex((item) => item.id === unknownId);
    if (index < 0) {
        throw new Error(`未知信息条目不存在：${unknownId}`);
    }
    const [removed] = entries.splice(index, 1);
    await writeText(ledgerPath, renderUnknown(entries));
    return addKnowledge(projectRoot, characterId, {
        topic: removed!.topic,
        content: input.contentOverride?.trim() || removed!.content,
        source: input.source,
        tick: input.tick,
    });
}

// ---- 属实批注（god-view） ------------------------------------------------------

export async function listTruthNotes(projectRoot: string, characterId: string): Promise<TruthNote[]> {
    const raw = await readText(path.join(rpCharacterRoot(projectRoot, characterId), TRUTH_NOTES_FILE));
    return parseTruthNotes(raw);
}

export async function setTruthNote(projectRoot: string, characterId: string, note: TruthNote): Promise<void> {
    const filePath = path.join(rpCharacterRoot(projectRoot, characterId), TRUTH_NOTES_FILE);
    const notes = parseTruthNotes(await readText(filePath));
    const existing = notes.findIndex((item) => item.knowledgeId === note.knowledgeId);
    if (existing >= 0) {
        notes[existing] = note;
    } else {
        notes.push(note);
    }
    await writeText(filePath, renderTruthNotes(notes));
}

// ---- 记忆（摘要 + Tick 详情） --------------------------------------------------

export async function readSummary(projectRoot: string, characterId: string): Promise<SummarySections> {
    const raw = await readText(path.join(rpCharacterRoot(projectRoot, characterId), SUMMARY_FILE));
    return parseSummary(raw);
}

export function tickFileName(tick: number): string {
    if (!Number.isInteger(tick) || tick < 0) {
        throw new Error(`非法 tick：${tick}`);
    }
    return `Tick${String(tick).padStart(6, "0")}.md`;
}

export async function readTickMemory(projectRoot: string, characterId: string, tick: number): Promise<string | null> {
    try {
        return await readText(path.join(rpCharacterRoot(projectRoot, characterId), TICKS_DIR, tickFileName(tick)));
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

/**
 * 提交一个 Tick 的记忆：写入该角色视角的详情文件 + 摘要近期行 + 可选心境更新。
 * 同 tick 重复提交覆盖详情并替换摘要行（幂等重跑安全）。
 */
export async function commitTickMemory(projectRoot: string, characterId: string, input: {
    tick: number;
    /** 该角色视角的详情正文（非化身角色不得使用 prose 原文）。 */
    detail: string;
    /** 摘要近期行：「在本 Tick 与谁经历了什么」的一句话。 */
    summaryLine: string;
    /** 项目日历时间字符串（可选，写入详情 frontmatter）。 */
    time?: string;
    /** 在场角色 id 列表（可选）。 */
    participants?: string[];
    /** 心境更新（可选，整体覆盖 心境.md）。 */
    mood?: string;
}): Promise<void> {
    const root = rpCharacterRoot(projectRoot, characterId);
    await fs.mkdir(path.join(root, TICKS_DIR), {recursive: true});
    const frontmatter = [
        "---",
        `tick: ${input.tick}`,
        ...(input.time ? [`time: "${input.time.replaceAll("\"", "\\\"")}"`] : []),
        ...(input.participants?.length ? [`participants: [${input.participants.join(", ")}]`] : []),
        "---",
        "",
    ].join("\n");
    await writeText(path.join(root, TICKS_DIR, tickFileName(input.tick)), `${frontmatter}${input.detail.trim()}\n`);

    const summaryPath = path.join(root, SUMMARY_FILE);
    const summary = parseSummary(await readText(summaryPath));
    const line = input.summaryLine.trim().replace(/\s+/g, " ");
    const existing = summary.recent.findIndex((item) => item.tick === input.tick);
    if (existing >= 0) {
        summary.recent[existing] = {tick: input.tick, line};
    } else {
        summary.recent.push({tick: input.tick, line});
        summary.recent.sort((left, right) => left.tick - right.tick);
    }
    await writeText(summaryPath, renderSummary(summary));

    if (input.mood !== undefined) {
        await writeMood(projectRoot, characterId, input.mood);
    }
}

/** 近期段是否达到滚动压缩阈值。 */
export async function summaryRollupNeeded(projectRoot: string, characterId: string, threshold = DEFAULT_RECENT_ROLLUP_THRESHOLD): Promise<{needed: boolean; recentCount: number}> {
    const summary = await readSummary(projectRoot, characterId);
    return {needed: summary.recent.length > threshold, recentCount: summary.recent.length};
}

/**
 * 应用近期→中期滚动压缩：移除 [fromTick, toTick] 的近期行，插入一条中期概括行。
 * mergedLine 由调用方 agent 生成（本模块不做摘要）。
 */
export async function rollupRecentToMid(projectRoot: string, characterId: string, input: {
    fromTick: number;
    toTick: number;
    mergedLine: string;
}): Promise<void> {
    const summaryPath = path.join(rpCharacterRoot(projectRoot, characterId), SUMMARY_FILE);
    const summary = parseSummary(await readText(summaryPath));
    const covered = summary.recent.filter((item) => item.tick >= input.fromTick && item.tick <= input.toTick);
    if (!covered.length) {
        throw new Error(`近期段没有 Tick ${input.fromTick}-${input.toTick} 的行可压缩`);
    }
    summary.recent = summary.recent.filter((item) => item.tick < input.fromTick || item.tick > input.toTick);
    summary.mid.push(`- [Tick ${String(input.fromTick).padStart(3, "0")}-${String(input.toTick).padStart(3, "0")}] ${input.mergedLine.trim().replace(/\s+/g, " ")}`);
    await writeText(summaryPath, renderSummary(summary));
}

/** 应用中期→远期滚动压缩：移除指定数量的最旧中期行，追加一段远期概括。 */
export async function rollupMidToFar(projectRoot: string, characterId: string, input: {
    /** 压缩最旧的 N 条中期行。 */
    count: number;
    mergedParagraph: string;
}): Promise<void> {
    const summaryPath = path.join(rpCharacterRoot(projectRoot, characterId), SUMMARY_FILE);
    const summary = parseSummary(await readText(summaryPath));
    if (summary.mid.length < input.count || input.count <= 0) {
        throw new Error(`中期段只有 ${summary.mid.length} 行，无法压缩 ${input.count} 行`);
    }
    summary.mid.splice(0, input.count);
    summary.far.push(input.mergedParagraph.trim());
    await writeText(summaryPath, renderSummary(summary));
}

// ---- 视图组装 -----------------------------------------------------------------

/** actor 可见视图：人设 + 心境 + 已知信息 + 摘要。绝不包含 god-view 内容。 */
export async function readActorView(projectRoot: string, characterId: string): Promise<CharacterActorView> {
    const [soul, mood, knowledge, summary] = await Promise.all([
        readSoul(projectRoot, characterId),
        readMood(projectRoot, characterId),
        listKnowledge(projectRoot, characterId),
        readSummary(projectRoot, characterId),
    ]);
    return {soul, mood, knowledge, summary};
}

/** god-view 视图：actor 视图 + 未知信息账本 + 属实批注。仅 screenwriter / rp.leader 使用。 */
export async function readGodView(projectRoot: string, characterId: string): Promise<CharacterGodView> {
    const [actorView, unknown, truthNotes] = await Promise.all([
        readActorView(projectRoot, characterId),
        listUnknown(projectRoot, characterId),
        listTruthNotes(projectRoot, characterId),
    ]);
    return {...actorView, unknown, truthNotes};
}

// ---- Markdown 解析与渲染 ------------------------------------------------------

function parseKnowledge(raw: string): KnowledgeEntry[] {
    const entries: KnowledgeEntry[] = [];
    for (const section of splitSections(raw, /^## (K\d+)\s+(.*)$/u)) {
        const fields = parseFieldLines(section.body);
        entries.push({
            id: section.id,
            topic: section.title,
            content: fields.get("内容") ?? "",
            source: fields.get("来源") ?? "",
            learnedTick: parseTickNumber(fields.get("得知")),
            updatedTick: parseTickNumber(fields.get("更新") ?? fields.get("得知")),
        });
    }
    return entries;
}

function renderKnowledge(entries: KnowledgeEntry[]): string {
    const sections = entries.map((entry) => [
        `## ${entry.id} ${entry.topic}`,
        `- 内容: ${entry.content}`,
        `- 来源: ${entry.source}`,
        `- 得知: Tick ${entry.learnedTick}`,
        `- 更新: Tick ${entry.updatedTick}`,
    ].join("\n"));
    return ["# 已知信息", "", ...sections].join("\n") + "\n";
}

function parseUnknown(raw: string): UnknownEntry[] {
    const entries: UnknownEntry[] = [];
    for (const section of splitSections(raw, /^## (U\d+)\s+(.*)$/u)) {
        const fields = parseFieldLines(section.body);
        entries.push({
            id: section.id,
            topic: section.title,
            content: fields.get("内容") ?? "",
            occurredTick: parseTickNumber(fields.get("发生")),
            ...(fields.get("揭示建议") ? {revealHint: fields.get("揭示建议")} : {}),
        });
    }
    return entries;
}

function renderUnknown(entries: UnknownEntry[]): string {
    const sections = entries.map((entry) => [
        `## ${entry.id} ${entry.topic}`,
        `- 内容: ${entry.content}`,
        `- 发生: Tick ${entry.occurredTick}`,
        ...(entry.revealHint ? [`- 揭示建议: ${entry.revealHint}`] : []),
    ].join("\n"));
    return ["# 未知信息账本(god-view)", "", ...sections].join("\n") + "\n";
}

function parseTruthNotes(raw: string): TruthNote[] {
    const notes: TruthNote[] = [];
    for (const section of splitSections(raw, /^## (K\d+)\s*(.*)$/u)) {
        const fields = parseFieldLines(section.body);
        const truthRaw = fields.get("属实") ?? "unverified";
        notes.push({
            knowledgeId: section.id,
            truth: truthRaw === "是" || truthRaw === "true" ? "true" : truthRaw === "否" || truthRaw === "false" ? "false" : "unverified",
            note: fields.get("真相") ?? "",
        });
    }
    return notes;
}

function renderTruthNotes(notes: TruthNote[]): string {
    const sections = notes.map((note) => [
        `## ${note.knowledgeId}`,
        `- 属实: ${note.truth === "true" ? "是" : note.truth === "false" ? "否" : "存疑"}`,
        `- 真相: ${note.note}`,
    ].join("\n"));
    return ["# 属实批注(god-view)", "", ...sections].join("\n") + "\n";
}

function parseSummary(raw: string): SummarySections {
    const far: string[] = [];
    const mid: string[] = [];
    const recent: Array<{tick: number; line: string}> = [];
    let current: "far" | "mid" | "recent" | null = null;
    let farBuffer: string[] = [];
    const flushFar = () => {
        const paragraph = farBuffer.join("\n").trim();
        if (paragraph) far.push(paragraph);
        farBuffer = [];
    };
    for (const line of raw.split(/\r?\n/u)) {
        const heading = /^## (远期|中期|近期)\s*$/u.exec(line);
        if (heading) {
            flushFar();
            current = heading[1] === "远期" ? "far" : heading[1] === "中期" ? "mid" : "recent";
            continue;
        }
        if (line.startsWith("# ")) continue;
        if (current === "far") {
            if (line.trim() === "") {
                flushFar();
            } else {
                farBuffer.push(line);
            }
            continue;
        }
        if (current === "mid" && line.trim().startsWith("- ")) {
            mid.push(line.trim());
            continue;
        }
        if (current === "recent") {
            const match = /^- \[Tick (\d+)\]\s*(.*)$/u.exec(line.trim());
            if (match) {
                recent.push({tick: Number(match[1]), line: match[2] ?? ""});
            }
        }
    }
    flushFar();
    recent.sort((left, right) => left.tick - right.tick);
    return {far, mid, recent};
}

function renderSummary(summary: SummarySections): string {
    return [
        "# 记忆摘要",
        "",
        "## 远期",
        "",
        ...summary.far.flatMap((paragraph) => [paragraph, ""]),
        "## 中期",
        "",
        ...summary.mid,
        ...(summary.mid.length ? [""] : []),
        "## 近期",
        "",
        ...summary.recent.map((item) => `- [Tick ${item.tick}] ${item.line}`),
    ].join("\n") + "\n";
}

// ---- 基础工具 -----------------------------------------------------------------

type ParsedSection = {id: string; title: string; body: string};

function splitSections(raw: string, headingPattern: RegExp): ParsedSection[] {
    const lines = raw.split(/\r?\n/u);
    const sections: ParsedSection[] = [];
    let current: ParsedSection | null = null;
    const bodyLines: string[] = [];
    const flush = () => {
        if (current) {
            sections.push({...current, body: bodyLines.join("\n")});
        }
        bodyLines.length = 0;
    };
    for (const line of lines) {
        const match = headingPattern.exec(line);
        if (match) {
            flush();
            current = {id: match[1]!, title: (match[2] ?? "").trim(), body: ""};
            continue;
        }
        if (current) {
            bodyLines.push(line);
        }
    }
    flush();
    return sections;
}

function parseFieldLines(body: string): Map<string, string> {
    const fields = new Map<string, string>();
    for (const line of body.split(/\r?\n/u)) {
        const match = /^- ([^:：]+)[:：]\s*(.*)$/u.exec(line.trim());
        if (match) {
            fields.set(match[1]!.trim(), (match[2] ?? "").trim());
        }
    }
    return fields;
}

function parseTickNumber(value: string | undefined): number {
    const match = /(\d+)/u.exec(value ?? "");
    return match ? Number(match[1]) : 0;
}

function nextId(prefix: "K" | "U", existing: string[]): string {
    const max = existing.reduce((accumulator, id) => {
        const match = new RegExp(`^${prefix}(\\d+)$`, "u").exec(id);
        return match ? Math.max(accumulator, Number(match[1])) : accumulator;
    }, 0);
    return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

async function readText(filePath: string): Promise<string> {
    return fs.readFile(filePath, "utf-8");
}

async function writeText(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true});
    await fs.writeFile(filePath, content, "utf-8");
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
    try {
        await fs.access(filePath);
    } catch {
        await writeText(filePath, content);
    }
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
