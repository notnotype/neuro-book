import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {z} from "zod";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {readRpEventState, readRpPlayerEvents} from "nbook/server/rp/event-store";
import {readRpConsistencyReport} from "nbook/server/rp/consistency-store";
import {readRpFocusState, RP_LONG_JUMP_ROOT} from "nbook/server/rp/focus-store";
import {readRpIntake, rpIntakeOverview} from "nbook/server/rp/intake-store";
import {readRpPlayerMap} from "nbook/server/rp/map-store";
import {readRpMechanicsState} from "nbook/server/rp/mechanics-store";
import {readRpPlayerRoster} from "nbook/server/rp/npc-store";
import {readRpPipeline, RP_PIPELINE_STAGES} from "nbook/server/rp/pipeline-store";
import {readRpRelationState} from "nbook/server/rp/relation-store";
import {readCharacterRegistry} from "nbook/server/rp/character-store";
import {listRpTurns, readRpTurn} from "nbook/server/rp/turn-store";
import type {RpPlayerCharacterCategoryDto, RpRuntimeOverviewDto, RpUpdateDetailDto, RpUpdatePageDto} from "nbook/shared/dto/rp-runtime.dto";

const LongJumpSchema = z.object({
    schemaVersion: z.literal(1),
    turnId: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    deterministicSummary: z.string(),
    characterSummary: z.string(),
    worldSummary: z.string(),
    createdAt: z.string(),
});

/** 汇总侧边栏所需玩家投影；不返回事件 hiddenSetup、角色 personaSummary 或 pipeline 提案内心。 */
export async function readRpRuntimeOverview(
    projectRoot: string,
    characterSubjects: Array<{id: string; name: string}> = [],
): Promise<RpRuntimeOverviewDto> {
    const [intake, focus, eventState, playerEvents, map, roster, mechanics, turns, consistency, registry, relations] = await Promise.all([
        readRpIntake(projectRoot),
        readRpFocusState(projectRoot),
        readRpEventState(projectRoot),
        readRpPlayerEvents(projectRoot),
        readRpPlayerMap(projectRoot),
        readRpPlayerRoster(projectRoot),
        readRpMechanicsState(projectRoot),
        listRpTurns(projectRoot),
        readRpConsistencyReport(projectRoot),
        readCharacterRegistry(projectRoot),
        readRpRelationState(projectRoot),
    ]);
    const incomplete = turns.filter((turn) => !["committed", "failed", "cancelled"].includes(turn.status));
    const current = incomplete[0] ?? turns.find((turn) => turn.status === "committed") ?? turns[0] ?? null;
    const pipeline = current ? await readRpPipeline(projectRoot, current.id) : null;
    const resourceById = new Map(mechanics.resources.map((resource) => [resource.id, resource]));
    const npcById = new Map(roster.npcs.map((npc) => [npc.id, npc]));
    const registryById = new Map(registry.map((character) => [character.id, character]));
    const subjectById = new Map(characterSubjects.map((subject) => [subject.id, subject]));
    const characterIds = [...new Set([...subjectById.keys(), ...registryById.keys(), ...npcById.keys()])];
    const characters = characterIds.map((id) => {
        const npc = npcById.get(id);
        const registered = registryById.get(id);
        const category: RpPlayerCharacterCategoryDto = registered?.kind === "player" ? "player" : npc?.tier ?? "other";
        return {
            id,
            name: npc?.name ?? registered?.name ?? subjectById.get(id)?.name ?? id,
            category,
            narrativeRole: category === "player" ? "玩家化身" : npc?.narrativeRole ?? "其他角色",
            playerSummary: category === "player" ? "由玩家完全决定言行、信任与情感的化身。" : npc?.playerSummary ?? "已登记在当前世界中的角色。",
            lastSeenTick: npc?.lastSeenTick ?? null,
            currentLocationId: npc?.currentLocationId ?? null,
        };
    });
    const visibleCharacterIds = new Set(characterIds);
    return {
        intake: rpIntakeOverview(intake),
        intensity: focus.intensity,
        focusObjects: focus.objects.map((object) => ({
            id: object.id, kind: object.kind, level: object.level, pinned: object.pinned, reason: object.reason, updatedTick: object.updatedTick,
        })),
        currentTurn: current ? {
            id: current.id, sequence: current.sequence, status: current.status, inputSummary: current.inputSummary, note: current.note, updatedAt: current.updatedAt,
        } : null,
        pipeline: pipeline ? {
            stage: pipeline.stage,
            stageIndex: RP_PIPELINE_STAGES.indexOf(pipeline.stage) + 1,
            stageCount: RP_PIPELINE_STAGES.length,
            completedAt: pipeline.completedAt,
            stageHistory: pipeline.stageHistory,
            failures: pipeline.failures.map((failure) => ({
                id: failure.id, stage: failure.stage, kind: failure.kind, agent: failure.agent, message: failure.message,
                blocking: failure.blocking, resolved: failure.resolved, recoveryOptions: failure.recoveryOptions, createdAt: failure.createdAt,
            })),
        } : null,
        counts: {
            committedTurns: turns.filter((turn) => turn.status === "committed").length,
            incompleteTurns: incomplete.length,
            failedTurns: turns.filter((turn) => turn.status === "failed").length,
            updates: turns.filter((turn) => turn.status === "committed").length,
        },
        events: {calmTickStreak: eventState.calmTickStreak, candidateGenerationDue: eventState.candidateGenerationDue, items: playerEvents.events},
        map,
        roster: {
            activeMajorLimit: roster.activeMajorLimit,
            npcs: roster.npcs,
            suggestions: roster.suggestions.map((suggestion) => ({
                id: suggestion.id, npcId: suggestion.npcId, targetTier: suggestion.targetTier, reason: suggestion.reason, evidence: suggestion.evidence,
            })),
        },
        characters,
        relations: relations.edges
            .filter((edge) => visibleCharacterIds.has(edge.sourceId) && visibleCharacterIds.has(edge.targetId))
            .map((edge) => ({
                id: edge.id, sourceId: edge.sourceId, targetId: edge.targetId, dimensions: edge.dimensions, tags: edge.tags,
            })),
        resources: mechanics.accounts.map((account) => {
            const resource = resourceById.get(account.resourceId);
            return {
                accountId: account.id,
                subjectId: account.subjectId,
                resourceId: account.resourceId,
                label: resource?.label ?? account.resourceId,
                value: account.value,
                unit: resource?.unit ?? "",
                band: resource?.bands.find((band) => account.value >= band.min && account.value <= band.max)?.label ?? null,
            };
        }),
        consistency,
    };
}

/** 分页读取 committed 更新摘要；列表不携带完整 settlement，点击后才读取详情。 */
export async function listRpUpdates(projectRoot: string, offset: number, limit: number): Promise<RpUpdatePageDto> {
    if (!Number.isInteger(offset) || offset < 0) throw new Error("offset 必须是非负整数。");
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit 必须是 1-100 的整数。");
    const committed = (await listRpTurns(projectRoot)).filter((turn) => turn.status === "committed");
    return {
        items: committed.slice(offset, offset + limit).map((turn) => ({
            turnId: turn.id,
            sequence: turn.sequence,
            at: turn.committedAt ?? turn.updatedAt,
            inputSummary: turn.inputSummary,
            summary: settlementSummary(turn.settlement),
            prosePath: turn.prosePath,
        })),
        total: committed.length,
        offset,
        limit,
    };
}

/** 按需读取单回合详细更新；只返回公开阶段历史，不返回 plan、actor 内心或 hiddenSetup。 */
export async function readRpUpdateDetail(projectRoot: string, turnId: string): Promise<RpUpdateDetailDto> {
    const [turn, pipeline, mechanics, relations, longJump] = await Promise.all([
        readRpTurn(projectRoot, turnId),
        readRpPipeline(projectRoot, turnId),
        readRpMechanicsState(projectRoot),
        readRpRelationState(projectRoot),
        readLongJump(projectRoot, turnId),
    ]);
    if (turn.status !== "committed") throw new Error(`回合 ${turnId} 尚未 committed，不能作为正式更新查看。`);
    const time = mechanics.timeRecords.find((record) => record.turnId === turnId);
    return {
        turn: {
            id: turn.id, sequence: turn.sequence, status: turn.status, inputSummary: turn.inputSummary,
            prosePath: turn.prosePath, committedAt: turn.committedAt,
        },
        stageHistory: pipeline.stageHistory,
        settlement: turn.settlement,
        time: time ? {startTime: time.startTime, endTime: time.endTime, longJump: time.longJump, summary: time.summary, committedAt: time.committedAt} : null,
        resourceTransactions: mechanics.transactions.filter((transaction) => transaction.turnId === turnId).map((transaction) => ({
            accountId: transaction.accountId, kind: transaction.kind, delta: transaction.delta, balance: transaction.balance,
            reason: transaction.reason, atTime: transaction.atTime,
        })),
        relationChanges: relations.changes.filter((change) => change.turnId === turnId).map((change) => ({
            sourceId: change.sourceId, targetId: change.targetId, deltas: change.deltas, addedTags: change.addedTags,
            removedTags: change.removedTags, reason: change.reason,
        })),
        longJump,
    };
}

function settlementSummary(settlement: JsonValue | null): string {
    if (!settlement || typeof settlement !== "object" || Array.isArray(settlement)) return "回合已完成结算";
    const summary = settlement.summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();
    const events = settlement.events;
    if (Array.isArray(events)) {
        const text = events.filter((event): event is string => typeof event === "string").join("；");
        if (text) return text;
    }
    return "回合已完成结算";
}

async function readLongJump(projectRoot: string, turnId: string): Promise<RpUpdateDetailDto["longJump"]> {
    try {
        const parsed: unknown = JSON.parse(await readFile(join(projectRoot, RP_LONG_JUMP_ROOT, `${turnId}.json`), "utf-8"));
        const value = LongJumpSchema.parse(parsed);
        return {
            startTime: value.startTime, endTime: value.endTime, deterministicSummary: value.deterministicSummary,
            characterSummary: value.characterSummary, worldSummary: value.worldSummary, createdAt: value.createdAt,
        };
    } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
    }
}

function isNotFound(error: unknown): boolean {
    return typeof error === "object" && error !== null && "code" in error && (error as {code?: string}).code === "ENOENT";
}
