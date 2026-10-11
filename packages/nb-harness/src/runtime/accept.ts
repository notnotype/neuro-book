/**
 * 受理（docs/specs/harness/runtime.md 输出 2）：在写任何条目之前把一次调用需要的东西全部取定；任一失败返回结构化错误。
 * 这里只读不写，所以失败不留痕迹。
 */

import type {Model} from "@oh-my-pi/pi-catalog";
import {resolveCompactionSettings} from "../compaction/compaction";
import type {CompactionSettings} from "../compaction/compaction";
import type {HarnessConfig} from "../config/config";
import {selectionFromProfile} from "../models/models";
import type {Selected} from "../models/models";
import type {Profile} from "../profile/profile";
import {sessionSettings} from "../session/session";
import type {SessionLog} from "../session/session";
import {resolveApprovalMode, visibleTools} from "../tools/tools";
import type {ApprovalMode, ToolDescriptor} from "../tools/tools";
import type {ResolvedDeps, RuntimeResult, UserInput} from "./types";

export type Accepted = {
    config: HarnessConfig;
    profile: Profile;
    model: Model;
    modelRef: string;
    via: Selected["via"];
    role?: string;
    apiKey: string;
    tools: ToolDescriptor[];
    approvalMode: ApprovalMode;
    compaction: CompactionSettings;
};

function inputProblem(input: UserInput | undefined): string | null {
    if (input === undefined) return "缺少输入";
    const {content} = input;
    if (typeof content === "string") return content.trim() === "" ? "输入为空" : null;
    if (!Array.isArray(content) || content.length === 0) return "输入的内容块为空";
    for (const [index, block] of content.entries()) {
        if (typeof block !== "object" || block === null) return `第 ${index} 块不是对象`;
        if (block.type === "text" && typeof block.text === "string") continue;
        if (block.type === "image" && typeof block.mimeType === "string" && typeof block.data === "string") continue;
        return `第 ${index} 块既不是文本也不是图片`;
    }
    return null;
}

const hasImage = (input: UserInput | undefined): boolean => input !== undefined && typeof input.content !== "string" && input.content.some((block) => block.type === "image");

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export type Checked = Omit<Accepted, "apiKey">;
type CheckOptions = {input?: UserInput; model?: string; signal?: AbortSignal; needsInput: boolean};
type Session = {log: SessionLog; profileId: string; sessionMode?: ApprovalMode};
type Chosen = Pick<Accepted, "config" | "profile" | "model" | "modelRef" | "via" | "role"> & {requested: string[]};

/**
 * 受理按输出 2 的顺序分三段：选模型（输入、Profile、配置、模型与能力）→ 凭据 → 收尾（可见工具、审批模式、压缩设置、signal）。
 * 真跑三段都走；预览（输出 17）跳过凭据，其余顺序不变，所以同一个输入两边给同一个失败码。
 */
async function choose(deps: ResolvedDeps, session: Session, options: CheckOptions): Promise<RuntimeResult<Chosen>> {
    if (options.needsInput) {
        const problem = inputProblem(options.input);
        if (problem !== null) return {ok: false, code: "invalid-input", detail: problem};
    }
    const profile = deps.profiles.get(session.profileId);
    if (profile === undefined) return {ok: false, code: "unknown-profile", detail: `Profile 目录里没有 ${session.profileId}`};
    const issue = deps.profiles.issues.find((item) => item.severity === "error" && item.path.endsWith(`:${profile.id}`));
    if (issue !== undefined) return {ok: false, code: "invalid-profile", detail: issue.detail};

    const config = deps.config.current;
    const settings = sessionSettings(session.log.entries);
    const selected = deps.models.select({...(options.model ?? settings.model) === undefined ? {} : {model: (options.model ?? settings.model)!}, profile: selectionFromProfile(profile)});
    if (!selected.ok) return {ok: false, code: "model-unavailable", detail: `${selected.code}: ${selected.detail}`};
    const {model, via, role} = selected.value;
    // 能力按 Profile 要的工具判，不等可见工具算出来：工具来源的冲突排在凭据之后报
    const requested = stringList(profile.fields["harness/tools"]);
    const problems = deps.models.checkCapabilities(model, {...(requested.length > 0 ? {tools: true} : {}), ...(hasImage(options.input) ? {images: true} : {})});
    if (problems.length > 0) return {ok: false, code: "capability-missing", detail: problems.map((problem) => problem.detail).join("；")};
    return {ok: true, value: {config, profile, model, modelRef: `${model.provider}/${model.id}`, via, ...(role === undefined ? {} : {role}), requested}};
}

function finish(deps: ResolvedDeps, session: Session, chosen: Chosen, options: CheckOptions): RuntimeResult<Checked> {
    const {config, profile, requested, ...rest} = chosen;
    const visible = visibleTools({requested, sources: deps.tools});
    if (!visible.ok) return {ok: false, code: "tool-conflict", detail: visible.detail};
    const approvalField = profile.fields["harness/approval"];
    const approvalMode = resolveApprovalMode({
        ...(session.sessionMode === undefined ? {} : {session: session.sessionMode}),
        ...(config.approval.mode === undefined ? {} : {config: config.approval.mode}),
        ...(typeof approvalField === "string" ? {profile: approvalField as ApprovalMode} : {}),
        approvalRoleBound: config.roles.items.some((item) => item.id === "approval" && item.modelKey !== null),
    });
    if (options.signal?.aborted === true) return {ok: false, code: "invalid-state", detail: "开始前已中止"};
    return {ok: true, value: {config, profile, ...rest, tools: visible.value, approvalMode, compaction: resolveCompactionSettings(profile.fields["harness/compaction"])}};
}

/** 受理的检查部分，不取凭据：预览只走到这里，没配 key 也能看模型会收到什么。 */
export async function check(deps: ResolvedDeps, session: Session, options: CheckOptions): Promise<RuntimeResult<Checked>> {
    const chosen = await choose(deps, session, options);
    return chosen.ok ? finish(deps, session, chosen.value, options) : chosen;
}

export async function accept(deps: ResolvedDeps, session: Session, options: CheckOptions): Promise<RuntimeResult<Accepted>> {
    const chosen = await choose(deps, session, options);
    if (!chosen.ok) return chosen;
    const apiKey = await deps.credentials.apiKeyFor(chosen.value.model);
    if (apiKey === undefined) return {ok: false, code: "credentials-missing", detail: `没有 ${chosen.value.model.provider} 的凭据`};
    const checked = finish(deps, session, chosen.value, options);
    return checked.ok ? {ok: true, value: {...checked.value, apiKey}} : checked;
}
