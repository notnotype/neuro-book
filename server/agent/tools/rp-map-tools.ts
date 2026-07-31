import {Type} from "typebox";
import type {Static} from "typebox";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import type {JsonValue} from "nbook/server/agent/messages/types";
import {defineAgentTool} from "nbook/server/agent/tools/types";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import type {ToolAuthorizationContext, ToolExecutionContext, UserInputFormSpec, UserInputRequestContext} from "nbook/server/agent/tools/types";
import {readRpIntake, type RpBootstrapProgress, type RpIntakePhase} from "nbook/server/rp/intake-store";
import {
    approveRpLocationConflict,
    arriveRpLocation,
    confirmRpLocationImports,
    discardRpBootstrapLocation,
    discoverRpMapRoute,
    proposeRpLocation,
    readRpMapState,
    readRpPlayerMap,
    registerRpMapRoute,
    replaceRpLocationProposal,
    reviewRpLocationProposal,
    setRpLocationStatus,
    setRpMapRouteStatus,
    stageRpLocationImports,
} from "nbook/server/rp/map-store";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import {assertProjectOpen, markProjectActivity} from "nbook/server/workspace-files/project-session";

const ProjectPath = Type.String({minLength: 1});
const MapLevel = Type.Union([Type.Literal("world"), Type.Literal("region"), Type.Literal("town"), Type.Literal("district"), Type.Literal("building"), Type.Literal("sub_location")]);
const LocationStatus = Type.Union([Type.Literal("rumored"), Type.Literal("discovered"), Type.Literal("familiar"), Type.Literal("unavailable"), Type.Literal("destroyed")]);
const LocationBasis = Type.Union([Type.Literal("world_structure"), Type.Literal("event"), Type.Literal("npc"), Type.Literal("resource"), Type.Literal("special_connection")]);
const LocationOrigin = Type.Union([Type.Literal("bootstrap"), Type.Literal("screenwriter"), Type.Literal("player")]);

const ProposalFields = {
    requestedId: Type.String({minLength: 1}),
    parentId: Type.Optional(Type.Union([Type.String({minLength: 1}), Type.Null()])),
    level: MapLevel,
    canonicalName: Type.String({minLength: 1}),
    playerSummary: Type.String({minLength: 1}),
    rumorLabel: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    approximateDirection: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    initialStatus: LocationStatus,
    persistenceBasis: Type.Array(LocationBasis, {minItems: 1}),
    sourceRefs: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    completeness: Type.Optional(Type.Union([Type.Literal("complete"), Type.Literal("partial"), Type.Literal("vague")])),
};

const Schema = Type.Union([
    Type.Object({op: Type.Literal("get"), projectPath: ProjectPath, view: Type.Union([Type.Literal("player"), Type.Literal("gm")])}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("propose"), projectPath: ProjectPath, origin: LocationOrigin, ...ProposalFields}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("replace_proposal"), projectPath: ProjectPath, proposalId: Type.String({minLength: 1}), origin: LocationOrigin, ...ProposalFields,
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("stage_import"), projectPath: ProjectPath,
        candidates: Type.Array(Type.Object(ProposalFields, {additionalProperties: false}), {minItems: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("confirm_import"), projectPath: ProjectPath,
        decisions: Type.Array(Type.Object({proposalId: Type.String({minLength: 1}), include: Type.Boolean()}, {additionalProperties: false}), {minItems: 1}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("review"), projectPath: ProjectPath, proposalId: Type.String({minLength: 1}), accepted: Type.Boolean(),
        conflictReasons: Type.Optional(Type.Array(Type.String({minLength: 1}))),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("approve_conflict"), projectPath: ProjectPath, proposalId: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("discard_bootstrap_location"), projectPath: ProjectPath,
        locationId: Type.String({minLength: 1}), reason: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("arrive"), projectPath: ProjectPath, locationId: Type.String({minLength: 1}), tick: Type.Integer({minimum: 0})}, {additionalProperties: false}),
    Type.Object({op: Type.Literal("set_status"), projectPath: ProjectPath, locationId: Type.String({minLength: 1}), status: LocationStatus, reason: Type.String({minLength: 1})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("register_route"), projectPath: ProjectPath, id: Type.String({minLength: 1}), fromId: Type.String({minLength: 1}), toId: Type.String({minLength: 1}),
        label: Type.String({minLength: 1}), direction: Type.Optional(Type.Union([Type.String(), Type.Null()])), distance: Type.Optional(Type.Union([Type.String(), Type.Null()])), secret: Type.Boolean(),
    }, {additionalProperties: false}),
    Type.Object({op: Type.Literal("discover_route"), projectPath: ProjectPath, routeId: Type.String({minLength: 1}), tick: Type.Integer({minimum: 0})}, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("set_route_status"), projectPath: ProjectPath, routeId: Type.String({minLength: 1}),
        status: Type.Union([Type.Literal("active"), Type.Literal("unavailable"), Type.Literal("destroyed")]), reason: Type.String({minLength: 1}),
    }, {additionalProperties: false}),
]);
type Input = Static<typeof Schema>;

type MapPermissionRuntimeState = Readonly<{
    phase: RpIntakePhase;
    /** 非 bootstrapping 时为 null；bootstrapping 时表示当前服务端阶段。 */
    bootstrapStage: RpBootstrapProgress | null;
}>;

export const rpMapTools = {
    rpMap: defineAgentTool({
        key: "rp_map",
        name: "rp_map",
        label: "RP Hierarchical Map",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: [
            "Maintain the RP hierarchical location catalog and player visibility. Full objective location facts remain in RP World Engine; this tool stores stable ids, hierarchy, visibility, routes, proposals and import decisions.",
            "screenwriter proposes; rp.world validates/materializes and maintains arrival/status/routes; rp.leader may submit player-authored proposals and must obtain real player approval for novel import decisions or canon-conflict overrides.",
            "op=propose accepts exactly one location in the root fields; never send view, candidates, or decisions with it. Repeat propose for additional locations. During Bootstrap map only, rp.screenwriter uses origin=bootstrap; during active play it uses origin=screenwriter.",
            "If the same requestedId already has a proposed/conflict definition with different fields, use replace_proposal with its proposalId and the complete corrected proposal. The old proposal remains in the audit ledger as superseded; materialized locations cannot be replaced this way.",
            "If a truly wrong Bootstrap node was already materialized, rp.world may use discard_bootstrap_location only during the map stage. It rejects the audited proposal and removes only an unvisited leaf without routes; screenwriter can then propose the corrected stable id.",
            "Rumored nodes expose only vague labels/direction. Secret routes are completely absent from player view until discover_route. Unavailable/destroyed nodes and routes remain indexed.",
        ].join("\n"),
        parameters: providerObjectSchema(Schema),
        validationSchema: Schema,
        async authorize(context, args) {
            await authorizeMap(context, args as Input);
        },
        userInputRequest: {
            when(context: UserInputRequestContext): UserInputFormSpec | null {
                const input = context.args as Input;
                if (input.op !== "confirm_import" && input.op !== "approve_conflict") return null;
                return {
                    prompt: input.op === "confirm_import" ? "确认小说地点盘点的纳入与排除结果" : "确认保留与既有设定冲突的地点提案",
                    layout: "dialog",
                    form: {
                        defaults: {approved: false},
                        fields: [{path: "approved", component: "radio", label: input.op === "confirm_import" ? `${input.decisions.length} 个地点候选` : input.proposalId, required: true, options: [
                            {value: true, label: "确认"}, {value: false, label: "取消"},
                        ], defaultValue: false}],
                    },
                };
            },
        },
        async executeWithContext(context, _toolCallId, params: unknown, userInput?: unknown) {
            const input = params as Input;
            await authorizeMap(context, input);
            const root = resolveProjectRoot(context, input.projectPath);
            switch (input.op) {
                case "get": return result(input.view === "player" ? await readRpPlayerMap(root) : await readRpMapState(root));
                case "propose": return result(await proposeRpLocation(root, input));
                case "replace_proposal": return result(await replaceRpLocationProposal(root, input.proposalId, input));
                case "stage_import": return result({proposals: await stageRpLocationImports(root, input.candidates.map((candidate) => ({...candidate, origin: "novel_import" as const})))});
                case "confirm_import": {
                    if (!(userInput as {approved?: boolean} | undefined)?.approved) return result({approved: false});
                    return result({approved: true, proposals: await confirmRpLocationImports(root, input.decisions)});
                }
                case "review": return result(await reviewRpLocationProposal(root, input.proposalId, input));
                case "approve_conflict": {
                    if (!(userInput as {approved?: boolean} | undefined)?.approved) return result({approved: false, proposalId: input.proposalId});
                    return result(await approveRpLocationConflict(root, input.proposalId, true));
                }
                case "discard_bootstrap_location": return result(await discardRpBootstrapLocation(root, input.locationId, input.reason));
                case "arrive": return result(await arriveRpLocation(root, input.locationId, input.tick));
                case "set_status": return result(await setRpLocationStatus(root, input.locationId, input.status, input.reason));
                case "register_route": return result(await registerRpMapRoute(root, input));
                case "discover_route": return result(await discoverRpMapRoute(root, input.routeId, input.tick));
                case "set_route_status": return result(await setRpMapRouteStatus(root, input.routeId, input.status, input.reason));
            }
        },
    }),
} as const;

/**
 * 校验地图工具的职责边界。
 *
 * bootstrap 来源不是常规写权限：只有 rp.screenwriter 能在服务端确认的
 * bootstrapping/map 阶段逐地点提交，避免模型在 active 阶段伪造初始化来源。
 */
export function assertMapPermission(
    profileKey: string,
    input: Pick<Input, "op"> & {origin?: "bootstrap" | "screenwriter" | "player"},
    runtimeState?: MapPermissionRuntimeState,
): void {
    if (input.op === "get" && ["rp.leader", "rp.screenwriter", "rp.world"].includes(profileKey)) return;
    if (input.op === "propose" && profileKey === "rp.screenwriter" && input.origin === "screenwriter") return;
    if (input.op === "propose" && profileKey === "rp.screenwriter" && input.origin === "bootstrap") {
        if (runtimeState?.phase === "bootstrapping" && runtimeState.bootstrapStage === "map") return;
        throw new Error(
            `Bootstrap 地图提案只允许在 bootstrapping/map 阶段执行，当前为 ${runtimeState?.phase ?? "unknown"}/${runtimeState?.bootstrapStage ?? "unknown"}。`,
        );
    }
    if (input.op === "propose" && profileKey === "rp.leader" && input.origin === "player") return;
    if (input.op === "replace_proposal" && profileKey === "rp.screenwriter" && ["bootstrap", "screenwriter"].includes(input.origin ?? "")) return;
    if (input.op === "replace_proposal" && profileKey === "rp.leader" && input.origin === "player") return;
    if (["stage_import", "confirm_import", "approve_conflict"].includes(input.op) && profileKey === "rp.leader") return;
    if (["review", "discard_bootstrap_location", "arrive", "set_status", "register_route", "discover_route", "set_route_status"].includes(input.op) && profileKey === "rp.world") return;
    throw new Error(`RP 地图操作 ${input.op} 不允许由 ${profileKey} 执行。`);
}

/** Bootstrap 地图提案额外读取服务端阶段；其余操作只校验 profile 职责。 */
async function authorizeMap(
    context: Pick<ToolAuthorizationContext, "profileKey" | "workspaceFsRoot">,
    input: Input,
): Promise<void> {
    if ((input.op !== "propose" && input.op !== "replace_proposal") || input.origin !== "bootstrap") {
        assertMapPermission(context.profileKey, input);
        return;
    }
    if (input.op === "replace_proposal") {
        assertMapPermission(context.profileKey, input);
        return;
    }
    const normalized = normalizeProjectPath(input.projectPath);
    assertProjectOpen(normalized);
    const root = resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
    const intake = await readRpIntake(root);
    assertMapPermission(context.profileKey, input, {
        phase: intake.phase,
        bootstrapStage: intake.phase === "bootstrapping" ? intake.bootstrap.stage : null,
    });
}

function resolveProjectRoot(context: ToolExecutionContext, projectPath: string): string {
    const normalized = normalizeProjectPath(projectPath);
    assertProjectOpen(normalized);
    markProjectActivity(normalized);
    return resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalized);
}

function result(value: object) {
    const details = normalizeToolResultDetails(value as unknown as JsonValue);
    return {content: [{type: "text" as const, text: JSON.stringify(details, null, 2)}], details};
}
