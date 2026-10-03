/**
 * 输入器里支持的 trigger 类型。
 */
export type AgentTriggerKind =
    | "reference-root"
    | "chapter"
    | "volume"
    | "lorebook"
    | "thread"
    | "scene"
    | "skill"
    | "command";

/**
 * 匹配到的 trigger 结果。
 */
export interface AgentTriggerMatch {
    text: string;
    query: string;
    from: number;
    to: number;
    /** true 表示 trigger 之前已经有普通文本内容。 */
    hasPlainTextBeforeTrigger: boolean;
}

const ROOT_REFERENCE_TRIGGER_PATTERN = /(?:^|[\s(])(@(?:<[^>\n]*>?|[^\s)]*))$/u;
const CHAPTER_TRIGGER_PATTERN = /(?:^|[\s(])(@chapter:\/\/[^\s)]*)$/i;
const VOLUME_TRIGGER_PATTERN = /(?:^|[\s(])(@volume:\/\/[^\s)]*)$/i;
const LOREBOOK_TRIGGER_PATTERN = /(?:^|[\s(])(@lorebook:\/\/[^\s)]*)$/i;
const THREAD_TRIGGER_PATTERN = /(?:^|[\s(])(@thread:\/\/[^\s)]*)$/i;
const SCENE_TRIGGER_PATTERN = /(?:^|[\s(])(@scene:\/\/[^\s)]*)$/i;
const SKILL_TRIGGER_PATTERN = /(?:^|[\s(])(\$(?:\{(?:[\p{L}_-][\p{L}\p{N}_-]*)?\}?|[\p{L}_-][\p{L}\p{N}_-]*|)?)$/u;
const SKILL_MENTION_PATTERN = /(?:^|[\s(])(?:\$([\p{L}_-][\p{L}\p{N}_-]*)|\$\{([\p{L}_-][\p{L}\p{N}_-]*)\})/gu;
const COMMAND_TRIGGER_PATTERN = /(?:^|[\s(])(\/[a-z-]*)$/i;

/**
 * 在一段文本末尾查找当前仍然激活的 trigger。
 */
export function findAgentTriggerMatch(text: string, kind: AgentTriggerKind): AgentTriggerMatch | null {
    const pattern = resolvePattern(kind);
    const matched = pattern.exec(text);
    const raw = matched?.[1];
    if (!raw) {
        return null;
    }
    if (kind === "skill" && raw === "${}") {
        return null;
    }

    const from = text.length - raw.length;
    const query = resolveTriggerQuery(kind, raw);
    return {
        text: raw,
        query,
        from,
        to: text.length,
        hasPlainTextBeforeTrigger: text.slice(0, from).trim().length > 0,
    };
}

/**
 * 从任意文本中按出现顺序提取显式 `$skill` 提及。
 */
export function extractSkillMentions(text: string): string[] {
    const uniqueMentions: string[] = [];
    const seenMentions = new Set<string>();

    for (const matched of text.matchAll(SKILL_MENTION_PATTERN)) {
        const skillName = (matched[1] ?? matched[2] ?? "").trim();
        if (!skillName || seenMentions.has(skillName)) {
            continue;
        }
        seenMentions.add(skillName);
        uniqueMentions.push(skillName);
    }

    return uniqueMentions;
}

/**
 * 根据 trigger 类型提取查询文本。
 */
function resolveTriggerQuery(kind: AgentTriggerKind, raw: string): string {
    if (raw.includes("://")) {
        return raw.split("://")[1] ?? "";
    }
    if (kind === "skill" && raw.startsWith("${")) {
        return raw.slice(2, raw.endsWith("}") ? -1 : undefined);
    }
    return raw.slice(1);
}

/**
 * 返回指定类型对应的 trigger 正则。
 */
function resolvePattern(kind: AgentTriggerKind): RegExp {
    if (kind === "chapter") {
        return CHAPTER_TRIGGER_PATTERN;
    }
    if (kind === "volume") {
        return VOLUME_TRIGGER_PATTERN;
    }
    if (kind === "lorebook") {
        return LOREBOOK_TRIGGER_PATTERN;
    }
    if (kind === "thread") {
        return THREAD_TRIGGER_PATTERN;
    }
    if (kind === "scene") {
        return SCENE_TRIGGER_PATTERN;
    }
    if (kind === "skill") {
        return SKILL_TRIGGER_PATTERN;
    }
    if (kind === "command") {
        return COMMAND_TRIGGER_PATTERN;
    }
    return ROOT_REFERENCE_TRIGGER_PATTERN;
}
