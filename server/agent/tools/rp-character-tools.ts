import {Type} from "typebox";
import type {Static} from "typebox";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";
import {
    addKnowledge,
    addUnknown,
    commitTickMemory,
    ensureRpCharacter,
    readActorView,
    readCharacterRegistry,
    readGodView,
    readTickMemory,
    resolveCharacterId,
    revealUnknown,
    rollupMidToFar,
    rollupRecentToMid,
    setTruthNote,
    summaryRollupNeeded,
    updateKnowledge,
    writeMood,
    writeSoul,
} from "nbook/server/rp/character-store";
import {assertRpRuntimeForProject} from "nbook/server/rp/intake-guard";

/**
 * RP 模式 v2 角色信息与记忆工具（rp/characters/ 存储，格式见 reference/agent/rp-v2/character-memory.md）。
 *
 * 权限约定（由 P3 各 profile 的 toolset 绑定实施）：
 * - view="god"、add_unknown、reveal_unknown、set_truth_note 仅 rp.screenwriter / rp.leader 持有；
 * - actor 侧只通过 view="actor" 回忆，绝不接触 god-view 内容。
 */

const ProjectPathField = Type.String({minLength: 1, description: "Project Workspace path, e.g. workspace/my-novel."});
const CharacterIdField = Type.String({minLength: 1, description: "Character id, display name, or alias — resolved via the registry (rp/characters/registry.json). Pass the Chinese display name if unsure of the id."});

const RecallSchema = Type.Object({
    projectPath: ProjectPathField,
    characterId: Type.Optional(CharacterIdField),
    view: Type.Optional(Type.Union([Type.Literal("actor"), Type.Literal("god")], {
        description: "actor = 角色可见视图(人设/心境/已知信息/记忆摘要)。god = 附加未知信息账本与属实批注,仅编剧/主持层可用。默认 actor。",
    })),
    ticks: Type.Optional(Type.Array(Type.Integer({minimum: 0}), {
        maxItems: 10,
        description: "按需细读的 Tick 详情列表(渐进式回忆:先看摘要,命中再传 tick 号读详情)。",
    })),
}, {additionalProperties: false});

const UpdateSchema = Type.Object({
    projectPath: ProjectPathField,
    characterId: CharacterIdField,
    op: Type.Union([
        Type.Literal("ensure"),
        Type.Literal("write_soul"),
        Type.Literal("write_mood"),
        Type.Literal("add_knowledge"),
        Type.Literal("update_knowledge"),
        Type.Literal("add_unknown"),
        Type.Literal("reveal_unknown"),
        Type.Literal("set_truth_note"),
    ], {description: "ensure=创建角色骨架并登记注册表(新角色必须带 name 展示名,重名会被拒绝); write_soul/write_mood=覆盖人设/心境; add/update_knowledge=已知信息(角色相信的,允许为假); add_unknown=god-view 未知信息登记; reveal_unknown=揭示并转入已知信息; set_truth_note=god-view 属实批注。"}),
    /** ensure：角色展示名（通常是中文名，注册表唯一键）。新角色必填。 */
    name: Type.Optional(Type.String()),
    /** ensure：别名/称呼列表（如「子爵」「白发女孩」），供其他 agent 按称呼解析 id。 */
    aliases: Type.Optional(Type.Array(Type.String())),
    /** ensure：玩家化身必须为 player，其余角色为 npc。 */
    kind: Type.Optional(Type.Union([Type.Literal("player"), Type.Literal("npc")])),
    /** write_soul / write_mood / add_* / update_knowledge 的正文内容。 */
    content: Type.Optional(Type.String()),
    /** add_knowledge / add_unknown 的主题标题。 */
    topic: Type.Optional(Type.String()),
    /** add_knowledge / update_knowledge / reveal_unknown 的信息来源。 */
    source: Type.Optional(Type.String()),
    /** 当前 Tick 号（知识/揭示类操作必填）。 */
    tick: Type.Optional(Type.Integer({minimum: 0})),
    /** update_knowledge / set_truth_note 的 K 条目 id；reveal_unknown 的 U 条目 id。 */
    entryId: Type.Optional(Type.String()),
    /** add_unknown：事件实际发生的 Tick。 */
    occurredTick: Type.Optional(Type.Integer({minimum: 0})),
    /** add_unknown：揭示时机建议。 */
    revealHint: Type.Optional(Type.String()),
    /** set_truth_note：属实性。 */
    truth: Type.Optional(Type.Union([Type.Literal("true"), Type.Literal("false"), Type.Literal("unverified")])),
}, {additionalProperties: false});

const MemoryCommitSchema = Type.Object({
    projectPath: ProjectPathField,
    characterId: CharacterIdField,
    op: Type.Optional(Type.Union([
        Type.Literal("commit"),
        Type.Literal("rollup_recent_to_mid"),
        Type.Literal("rollup_mid_to_far"),
    ], {description: "commit(默认)=写入本 Tick 记忆; rollup_*=摘要滚动压缩(压缩内容由你生成)。"})),
    /** commit：Tick 号。 */
    tick: Type.Optional(Type.Integer({minimum: 0})),
    /** commit：该角色视角的详情正文。非化身角色不得粘贴 prose 原文，必须用该角色视角改写。 */
    detail: Type.Optional(Type.String()),
    /** commit：摘要近期行，「在本 Tick 与谁经历了什么」一句话。 */
    summaryLine: Type.Optional(Type.String()),
    /** commit：项目日历时间字符串。 */
    time: Type.Optional(Type.String()),
    /** commit：在场角色 id 列表。 */
    participants: Type.Optional(Type.Array(Type.String())),
    /** commit：心境更新（整体覆盖 心境.md）。 */
    mood: Type.Optional(Type.String()),
    /** rollup_recent_to_mid：压缩区间起止 Tick。 */
    fromTick: Type.Optional(Type.Integer({minimum: 0})),
    toTick: Type.Optional(Type.Integer({minimum: 0})),
    /** rollup：压缩后的概括（一行或一段，由你按被压缩内容生成）。 */
    merged: Type.Optional(Type.String()),
    /** rollup_mid_to_far：压缩最旧的 N 条中期行。 */
    count: Type.Optional(Type.Integer({minimum: 1})),
}, {additionalProperties: false});

type RecallInput = Static<typeof RecallSchema>;
type UpdateInput = Static<typeof UpdateSchema>;
type MemoryCommitInput = Static<typeof MemoryCommitSchema>;

export const rpCharacterTools = {
    rpCharacterRecall: defineAgentTool({
        key: "rp_character_recall",
        name: "rp_character_recall",
        label: "RP Character Recall",
        executionMode: "parallel",
        description: [
            "Read an RP character's profile and memory (rp/characters/ store).",
            "Progressive recall: first call without ticks to get soul/mood/knowledge/memory-summary; if a summary line needs detail, call again with ticks=[n] to read that tick's full record.",
            "view=\"actor\" (default) returns only what the character themselves knows. view=\"god\" additionally returns the unknown-info ledger and truth notes — screenwriter/host layer only; NEVER feed god view to an actor.",
            "Omit characterId to list the character registry (id + display name + aliases). characterId accepts id, display name, or alias — never guess directory names.",
        ].join("\n"),
        parameters: RecallSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as RecallInput;
            const projectRoot = resolveProjectRootForTool(context, input.projectPath);
            if (!input.characterId) {
                return toolResult({characters: await readCharacterRegistry(projectRoot) as unknown as JsonValue});
            }
            const characterId = await resolveCharacterId(projectRoot, input.characterId);
            const view = input.view === "god"
                ? await readGodView(projectRoot, characterId)
                : await readActorView(projectRoot, characterId);
            const tickDetails: Record<string, string | null> = {};
            for (const tick of input.ticks ?? []) {
                tickDetails[String(tick)] = await readTickMemory(projectRoot, characterId, tick);
            }
            return toolResult({
                characterId,
                view: input.view ?? "actor",
                ...view,
                ...(input.ticks?.length ? {tickDetails} : {}),
            });
        },
    }),
    rpCharacterUpdate: defineAgentTool({
        key: "rp_character_update",
        name: "rp_character_update",
        label: "RP Character Update",
        executionMode: "sequential",
        description: [
            "Maintain an RP character's persona, knowledge and god-view ledgers (rp/characters/ store).",
            "op=ensure creates AND registers the character: a NEW character requires name (display name, usually Chinese) and should declare kind=player for the player avatar or kind=npc otherwise; duplicate display names / aliases are rejected with the existing id — never create a second id for the same character. All other ops accept id, display name, or alias.",
            "Knowledge entries record what the character BELIEVES (may be false) with source + learned tick; use set_truth_note (god-view) to annotate false/unverified beliefs.",
            "add_unknown registers events the character does not know yet (god-view dramatic ledger); reveal_unknown moves an entry into knowledge when the character learns it.",
            "god-view ops (add_unknown / reveal_unknown / set_truth_note) are for the screenwriter/host layer only.",
        ].join("\n"),
        parameters: UpdateSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as UpdateInput;
            await assertRpRuntimeForProject(context, input.projectPath, ["characters"]);
            const projectRoot = resolveProjectRootForTool(context, input.projectPath);
            if (input.op === "ensure") {
                await ensureRpCharacter(projectRoot, input.characterId, {soul: input.content, name: input.name, aliases: input.aliases, kind: input.kind});
                return toolResult({op: input.op, characterId: input.characterId, status: "ok"});
            }
            const characterId = await resolveCharacterId(projectRoot, input.characterId);
            switch (input.op) {
                case "write_soul": {
                    await writeSoul(projectRoot, characterId, requireField(input.content, "content"));
                    return toolResult({op: input.op, characterId, status: "ok"});
                }
                case "write_mood": {
                    await writeMood(projectRoot, characterId, requireField(input.content, "content"));
                    return toolResult({op: input.op, characterId, status: "ok"});
                }
                case "add_knowledge": {
                    const entry = await addKnowledge(projectRoot, characterId, {
                        topic: requireField(input.topic, "topic"),
                        content: requireField(input.content, "content"),
                        source: requireField(input.source, "source"),
                        tick: requireNumber(input.tick, "tick"),
                    });
                    return toolResult({op: input.op, characterId, entry: entry as unknown as JsonValue});
                }
                case "update_knowledge": {
                    const entry = await updateKnowledge(projectRoot, characterId, requireField(input.entryId, "entryId"), {
                        content: input.content,
                        source: input.source,
                        tick: requireNumber(input.tick, "tick"),
                    });
                    return toolResult({op: input.op, characterId, entry: entry as unknown as JsonValue});
                }
                case "add_unknown": {
                    const entry = await addUnknown(projectRoot, characterId, {
                        topic: requireField(input.topic, "topic"),
                        content: requireField(input.content, "content"),
                        occurredTick: requireNumber(input.occurredTick, "occurredTick"),
                        revealHint: input.revealHint,
                    });
                    return toolResult({op: input.op, characterId, entry: entry as unknown as JsonValue});
                }
                case "reveal_unknown": {
                    const entry = await revealUnknown(projectRoot, characterId, requireField(input.entryId, "entryId"), {
                        source: requireField(input.source, "source"),
                        tick: requireNumber(input.tick, "tick"),
                        contentOverride: input.content,
                    });
                    return toolResult({op: input.op, characterId, entry: entry as unknown as JsonValue});
                }
                case "set_truth_note": {
                    await setTruthNote(projectRoot, characterId, {
                        knowledgeId: requireField(input.entryId, "entryId"),
                        truth: input.truth ?? "unverified",
                        note: requireField(input.content, "content"),
                    });
                    return toolResult({op: input.op, characterId, status: "ok"});
                }
            }
        },
    }),
    rpMemoryCommit: defineAgentTool({
        key: "rp_memory_commit",
        name: "rp_memory_commit",
        label: "RP Memory Commit",
        executionMode: "sequential",
        description: [
            "Commit one tick of character memory (rp/characters/{id}/记忆/): writes the character-perspective detail file, appends the recent summary line, and optionally updates mood — one call per character per tick, idempotent on re-run.",
            "characterId accepts id, display name, or alias, but the character must already be registered (rp_character_update op=ensure) — unregistered ids fail instead of silently creating a new profile.",
            "detail MUST be written from this character's own perspective (their three-channel output + what they perceived). Never paste omniscient prose for non-avatar characters.",
            "Result includes rollupNeeded; when true, generate a merged line yourself and call again with op=rollup_recent_to_mid (then rollup_mid_to_far when 中期 grows long).",
        ].join("\n"),
        parameters: MemoryCommitSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as MemoryCommitInput;
            await assertRpRuntimeForProject(context, input.projectPath, ["characters"]);
            const projectRoot = resolveProjectRootForTool(context, input.projectPath);
            // 只接受注册表里的角色：不再静默 ensure，防止拼错 id 悄悄裂出第二套档案
            const characterId = await resolveCharacterId(projectRoot, input.characterId);
            const op = input.op ?? "commit";
            if (op === "rollup_recent_to_mid") {
                await rollupRecentToMid(projectRoot, characterId, {
                    fromTick: requireNumber(input.fromTick, "fromTick"),
                    toTick: requireNumber(input.toTick, "toTick"),
                    mergedLine: requireField(input.merged, "merged"),
                });
                return toolResult({op, characterId, status: "ok"});
            }
            if (op === "rollup_mid_to_far") {
                await rollupMidToFar(projectRoot, characterId, {
                    count: requireNumber(input.count, "count"),
                    mergedParagraph: requireField(input.merged, "merged"),
                });
                return toolResult({op, characterId, status: "ok"});
            }
            await commitTickMemory(projectRoot, characterId, {
                tick: requireNumber(input.tick, "tick"),
                detail: requireField(input.detail, "detail"),
                summaryLine: requireField(input.summaryLine, "summaryLine"),
                time: input.time,
                participants: input.participants,
                mood: input.mood,
            });
            const rollup = await summaryRollupNeeded(projectRoot, characterId);
            return toolResult({op, characterId, tick: input.tick ?? null, rollupNeeded: rollup.needed, recentCount: rollup.recentCount});
        },
    }),
} as const;

function resolveProjectRootForTool(context: ToolExecutionContext, projectPath: string): string {
    const normalized = normalizeProjectPath(projectPath);
    assertProjectOpen(normalized);
    markProjectActivity(normalized);
    return resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
}

function requireField(value: string | undefined, name: string): string {
    if (!value?.trim()) {
        throw new Error(`缺少必填字段：${name}`);
    }
    return value;
}

function requireNumber(value: number | undefined, name: string): number {
    if (value === undefined) {
        throw new Error(`缺少必填字段：${name}`);
    }
    return value;
}

function toolResult(details: Record<string, JsonValue | undefined>) {
    const normalized = normalizeToolResultDetails(Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as JsonValue);
    return {
        content: [{type: "text" as const, text: JSON.stringify(normalized, null, 2)}],
        details: normalized,
    };
}
