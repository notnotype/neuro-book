import {isAbsolute} from "node:path";
import type {ToolExecutionContext} from "nbook/server/agent/tools/types";
import {assertRpBootstrapStage, assertRpRuntimeWritable, type RpBootstrapStage} from "nbook/server/rp/intake-store";
import {findRpTurnByRequest} from "nbook/server/rp/turn-store";
import type {ResolvedFileAddress} from "nbook/server/workspace-files/file-scope";
import {normalizeProjectPath, resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";

/**
 * RP profile 通过通用文件工具写正式 `rp/` 子树时的技术门禁。
 * 引导草案只由 rp_intake 写入 `.nbook`，因此不需要也不允许借通用文件工具绕过确认。
 */
export async function assertRpFormalFileWrite(context: ToolExecutionContext, address: ResolvedFileAddress): Promise<void> {
    if (!context.profileKey.startsWith("rp.")) return;
    if (!("relativePath" in address)) return;
    const relativePath = normalizeRelative(address.relativePath);
    if (relativePath.startsWith(".nbook/rp/intake/")) {
        throw new Error("RP 开团状态只能通过 rp_intake 工具修改，禁止通用文件工具直接写入。");
    }
    if (!relativePath.startsWith("rp/")) return;
    if (!address.projectPath) throw new Error("RP 正式写入必须绑定 Project Workspace。");
    const root = projectRoot(context, address.projectPath);
    const intake = await assertRpRuntimeWritable(root);
    if (intake.phase === "active") return;
    if (relativePath === "rp/world-engine/schema/index.ts" || relativePath === "rp/world-engine/calendar.ts") {
        throw new Error(`Bootstrap 配置 ${relativePath} 由 rp_intake op=initialize_config 生成，禁止 Agent 手写猜测格式。`);
    }
    const allowedStages = bootstrapFileStages(relativePath);
    if (allowedStages.length === 0) throw new Error(`Bootstrap 期间不能写入正式路径 ${relativePath}。`);
    await assertRpBootstrapStage(root, allowedStages);
}

/** RP 子 Agent、World Engine 与角色写工具共用的项目级运行门禁。 */
export async function assertRpRuntimeForProject(context: ToolExecutionContext, projectPath?: string, bootstrapStages: RpBootstrapStage[] = []): Promise<void> {
    if (!context.profileKey.startsWith("rp.")) return;
    const target = projectPath ?? context.projectPath;
    if (!target) throw new Error("RP 运行操作必须绑定 Project Workspace。");
    const root = projectRoot(context, target);
    const intake = await assertRpRuntimeWritable(root);
    if (intake.phase === "bootstrapping") {
        if (bootstrapStages.length === 0) throw new Error(`Bootstrap ${intake.bootstrap.stage} 阶段不允许此运行操作。`);
        await assertRpBootstrapStage(root, bootstrapStages);
    }
}

/**
 * RP 子 Agent 调用门禁：Bootstrap 允许初始化调用；active 后必须绑定当前 invocation 的正式回合。
 * world 可在 running 阶段读状态、committing 阶段写回；其他角色只在 running 阶段运行。
 */
export async function assertRpChildInvocation(context: ToolExecutionContext, targetProfile: string, projectPath?: string): Promise<void> {
    const target = projectPath ?? context.projectPath;
    if (!target) throw new Error("RP 子 Agent 调用必须绑定 Project Workspace。");
    const root = projectRoot(context, target);
    const intake = await assertRpRuntimeWritable(root);
    if (intake.phase === "bootstrapping") {
        await assertRpBootstrapStage(root, bootstrapInvocationStages(targetProfile));
        return;
    }
    if (!context.invocationId) throw new Error("active RP 子 Agent 调用缺少 invocationId，无法绑定回合事务。");
    const turn = await findRpTurnByRequest(root, `${context.sessionId}:${context.invocationId}`);
    if (!turn) throw new Error("active RP 子 Agent 调用被拒绝：当前 invocation 尚未通过 rp_turn start/resume 绑定回合。");
    const allowed = targetProfile === "rp.world" ? ["running", "committing"] : ["running"];
    if (!allowed.includes(turn.status)) {
        throw new Error(`RP 子 Agent ${targetProfile} 调用被拒绝：回合 ${turn.id} 当前为 ${turn.status}。`);
    }
}

/** 需要正式世界状态的 RP 子 profile。rp.leader 自身用于引导，因此不在此列表。 */
export function isRpRuntimeProfile(profileKey: string): boolean {
    return profileKey.startsWith("rp.") && profileKey !== "rp.leader";
}

function projectRoot(context: ToolExecutionContext, projectPath: string): string {
    if (isAbsolute(projectPath)) return projectPath;
    return resolveProjectWorkspaceRoot(context.workspaceFsRoot, normalizeProjectPath(projectPath));
}

function normalizeRelative(path: string): string {
    return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

/** 将 Bootstrap 文件落点绑定到唯一允许阶段。 */
function bootstrapFileStages(relativePath: string): RpBootstrapStage[] {
    if (/^rp\/(?:manual|lorebook|world-engine)\//u.test(relativePath)) return ["config"];
    if (relativePath.startsWith("rp/characters/")) return ["characters"];
    if (relativePath === "rp/bootstrap/staging/opening-prose.md") return ["narrative"];
    return [];
}

/** 将 Bootstrap 子 Agent 绑定到其实际产物阶段，阻止提前生成正文。 */
function bootstrapInvocationStages(targetProfile: string): RpBootstrapStage[] {
    if (targetProfile === "rp.world") return ["world", "map", "characters", "opening_event"];
    if (targetProfile === "rp.screenwriter") return ["map", "opening_event"];
    if (targetProfile === "rp.writer") return ["narrative"];
    throw new Error(`Bootstrap 阶段不允许调用 ${targetProfile}。`);
}
