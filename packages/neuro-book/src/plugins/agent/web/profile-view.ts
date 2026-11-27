/**
 * Profile 设置页的视图模型（docs/specs/agent/profile-settings.md）：把目录、Profile 设置与模型快照算成页面要显示的，页面组件只吃算好的
 * 东西，能在 Lab 里直接摆。文字在这里按界面语言翻好。
 */

import {builtinRoleNameKey, modelsText, roleOfReference, roleReference} from "nbook/plugins/models/shared/contracts";
import type {ModelRow, ModelsSnapshot, SelectionRow, SnapshotRole} from "nbook/plugins/models/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";

import type {ProfileEntry, ProfileProblem, ToolCatalogEntry} from "../shared/contracts";
import {modelNeedGaps} from "../shared/model-needs";
import type {ModelCapabilities, ModelNeedGap} from "../shared/model-needs";
import {profileToolIds, sameNameTool, visibleToolIds} from "../shared/profile-tools";
import type {MethodsOf, ToolBinding, ToolChange} from "../shared/profile-tools";
import {profileAgents} from "../shared/profile-agents";
import {declaredAllowlist, profileAllowlist} from "../shared/profile-allowlist";
import type {DeclaredAllowlist} from "../shared/profile-allowlist";
import {groupSkills} from "../shared/skills";
import {skillProblemText} from "./skill-problem";
import type {SkillEntry, SkillGroup} from "../shared/skills";
import type {StickerPackSummary} from "nbook/plugins/stickers/shared/contracts";
import type {ProfileSetting} from "../shared/settings";
import {agentText} from "../shared/text";
import {FOLLOW_APPROVAL, FOLLOW_MODEL, modelChoiceOf} from "./profile-edits";

/** 没写角色时模型服务用它（models/service.md 输出 8）。 */
const DEFAULT_ROLE = "main";
const USER_SOURCE = "user";
const BUILTIN_PLUGIN = "nbook.agent";

export interface ProfileNotice {
    /** 头部一行里的话，放不下时截断。 */
    readonly text: string;
    /** 悬停里的全文。 */
    readonly lines: readonly string[];
    readonly tone: "warning" | "danger";
}

export interface ProfileOption {
    readonly value: string;
    readonly label: string;
    readonly description?: string;
    readonly iconClass?: string;
    readonly disabled?: boolean;
}

export interface ProfileModelField {
    readonly value: string;
    readonly options: readonly ProfileOption[];
    readonly disabled: boolean;
    /** 说明行：有问题时换成问题。 */
    readonly hint: string;
    readonly warning: boolean;
}

export interface ProfileApprovalField {
    readonly value: string;
    readonly options: readonly ProfileOption[];
    readonly hint: string;
}

export const GONE_GROUP = "gone";

export interface ProfileToolRow {
    readonly id: string;
    /** 交给模型的名字；已卸载的写 id：名字已经查不到。 */
    readonly name: string;
    readonly effect: string;
    readonly danger: boolean;
    /** 一句话，放不下时截断；`detail` 是悬停里的全文。 */
    readonly summary: string;
    readonly detail: string;
    readonly required: boolean;
    readonly gone: boolean;
    /** 用户去掉的（Skill、表情包两节有）：行尾是“加回”，不是去掉。 */
    readonly restorable?: boolean;
    /** 表情包一节：第一个常用表情的缩略图地址。 */
    readonly thumbnail?: string;
    /** 工具一节：这一行是一个全局对象，合了它的方法（profile-settings.md 输出 28）；去掉、加回按对象写绑定。 */
    readonly object?: string;
    /** 读屏名字与搜索里跟在名字后面的标识：工具行是工具 id；对象行的 `id` 是页面内部用的，这里写 `ui.*`。不写时用 `id`。 */
    readonly label?: string;
    /** 这一行有问题（对象要先加入 eval）：说明换成原因，带警示图标。 */
    readonly warning?: boolean;
}

export interface ProfileToolGroup {
    /**
     * 身份。工具一节：插件 id，已卸载的一组是 `GONE_GROUP`。Skill 一节：`user`、`plugin:<插件 id>`、`builtin`（`groupSkills` 的 key），
     * 另有 `GONE_GROUP` 与 `REMOVED_GROUP`。显示名可能重复、随界面语言变，不作身份。
     */
    readonly id: string;
    readonly provider: string;
    readonly tools: readonly ProfileToolRow[];
}

export interface ProfileToolCandidate extends ProfileToolRow {
    /** 交给模型的名字：对话框里同名的只能选一个。 */
    readonly providerName: string;
    /** 加入时一起去掉的已开的同名工具。 */
    readonly replaces?: string;
    /** 同名的工具是必需的，加不了。 */
    readonly blocked: boolean;
}

export interface ProfileToolCandidateGroup {
    readonly id: string;
    readonly provider: string;
    readonly tools: readonly ProfileToolCandidate[];
}

export interface ProfileToolsField {
    readonly groups: readonly ProfileToolGroup[];
    /** 模型看到的工具数（不算已卸载的）。 */
    readonly count: number;
    /** 这个 Profile 在绑定里有项：显示“恢复默认”。 */
    readonly modified: boolean;
    readonly candidates: readonly ProfileToolCandidateGroup[];
}

export interface ProfileView {
    readonly key: string;
    readonly name: string;
    readonly description: string;
    readonly icon: string;
    /** 来源：内置、插件名、“我写的”；写在详情头部的提示里。 */
    readonly source: string;
    /** 有问题时：左栏行尾的图标按 `kind`、颜色按 `tone`，`text` 是悬停提示与读屏描述里的原因。 */
    readonly statusText: {readonly kind: "unavailable" | "error"; readonly text: string; readonly tone: "warning" | "error"} | null;
    readonly hidden: boolean;
    /** 用户级：有“打开文件”“删除”。 */
    readonly user: boolean;
    readonly notice: ProfileNotice | null;
    readonly model: ProfileModelField;
    /** `hidden` 的没有：后台运行没有审批。 */
    readonly approval: ProfileApprovalField | null;
    /** 没有工具一节时为 null：从未打包成功的、什么工具都没有的后台 Profile。 */
    readonly tools: ProfileToolsField | null;
    /** “可派的子代理”一节：Profile 有 `agent_spawn` 时才有（profile-settings.md 输出 25）。形状同工具一节，行的 `effect` 一列写“推荐”“我加的”。 */
    readonly agents: ProfileToolsField | null;
    /** Skill 一节（skills.md 的白名单）：Skill 目录还没取到时为 null。 */
    readonly skills: ProfileToolsField | null;
    /** 表情包一节（stickers.md 输出 19）：表情包列表取不到或没有表情包时为 null。 */
    readonly stickers: ProfileToolsField | null;
}

/** 缺口的一句话；没有缺口时空串。设置页与对话的输入框上方共用。 */
export function modelNeedsText(needs: ProfileEntry["modelNeeds"], model: ModelCapabilities, text: TextResolver): string {
    const line = (gap: ModelNeedGap): string => (gap.kind === "context" ? text.t(agentText("profiles.needs.context", {need: gap.need, have: gap.have})) : text.t(agentText(`profiles.needs.${gap.kind}`)));
    return modelNeedGaps(needs, model).map(line).join(text.t(agentText("profiles.needs.separator")));
}

function roleName(role: SnapshotRole, text: TextResolver): string {
    const key = builtinRoleNameKey(role);
    if (key !== null) return text.t(modelsText(key));
    return role.name === "" ? role.id : role.name;
}

/** 选用数据：能选的模型（有凭据、启用、可用）与按引用取到的行（含用不了的，没有这个模型时为 null）。 */
export interface ProfileModels {
    readonly rows: readonly SelectionRow[];
    readonly lookup: ReadonlyMap<string, ModelRow | null>;
}

function modelField(entry: ProfileEntry, setting: ProfileSetting | undefined, snapshot: ModelsSnapshot | null, selection: ProfileModels, modelsFailed: boolean, text: TextResolver): ProfileModelField {
    const value = modelChoiceOf(setting);
    const follow: ProfileOption = {value: FOLLOW_MODEL, label: text.t(agentText("profiles.model.follow"))};
    if (snapshot === null) {
        // 还在取或模型服务不在：下拉只有当前值，不能选。
        return {
            value,
            options: value === FOLLOW_MODEL ? [follow] : [follow, {value, label: roleOfReference(value) ?? value}],
            disabled: true,
            hint: modelsFailed ? text.t(agentText("profiles.model.serviceUnavailable")) : "",
            warning: modelsFailed,
        };
    }
    const followRole = snapshot.roles.find((role) => role.id === (entry.role ?? DEFAULT_ROLE));
    const followName = followRole === undefined ? (entry.role ?? DEFAULT_ROLE) : roleName(followRole, text);
    /** 按引用取到的行；`undefined` 是还在取（这时不报“模型不在了”，免得一闪而过的误报），null 是确认没有。 */
    const findModel = (reference: string): ModelRow | null | undefined => selection.lookup.get(reference);
    const providerName = new Map(snapshot.providers.map((provider) => [provider.id, provider.name] as const));
    const modelName = (reference: string | null): string | undefined => (reference === null ? undefined : findModel(reference)?.name ?? reference);
    const roles = snapshot.roles.map((role): ProfileOption => ({
        value: roleReference(role.id),
        label: roleName(role, text),
        description: modelName(role.model) ?? text.t(agentText("profiles.model.unbound")),
        iconClass: "i-lucide-layers",
    }));
    const models = selection.rows.map((row): ProfileOption => ({value: `${row.provider}/${row.id}`, label: row.name, description: providerName.get(row.provider) ?? row.provider}));
    const options: ProfileOption[] = [{...follow, ...(followRole === undefined ? {} : {description: followName})}, ...roles, ...models];

    // 解析顺序同服务端（agent.ts 的 `profileDefaults`）：模型，否则设置的角色、声明的角色。用不了的只说用不了，不说缺什么。
    const problem = ((): string | null => {
        const gaps = (found: ModelRow | null | undefined): string | null => (found === null || found === undefined ? null : modelNeedsText(entry.modelNeeds, found, text) || null);
        const direct = setting?.model;
        if (direct !== undefined) {
            const found = findModel(direct);
            if (found === undefined) return null;
            return found !== null && found.usable ? gaps(found) : text.t(agentText("profiles.model.modelGone"));
        }
        const id = setting?.role ?? entry.role ?? DEFAULT_ROLE;
        const role = snapshot.roles.find((candidate) => candidate.id === id);
        if (role === undefined) return text.t(agentText("profiles.model.roleGone"));
        if (role.status === "ok") return gaps(role.model === null ? null : findModel(role.model));
        return text.t(agentText(role.status === "unbound" ? "profiles.model.roleUnbound" : "profiles.model.roleBroken", {role: roleName(role, text)}));
    })();
    // 绑着的现在选不到时补一个停用的项：下拉里还看得到绑的是谁，同模型角色页。
    if (value !== FOLLOW_MODEL && !options.some((option) => option.value === value)) {
        options.push({value, label: roleOfReference(value) ?? value, description: text.t(agentText("profiles.model.unavailable")), disabled: true});
    }
    return {value, options, disabled: false, hint: problem ?? text.t(agentText("profiles.model.followHint", {role: followName})), warning: problem !== null};
}

function approvalField(setting: ProfileSetting | undefined, text: TextResolver): ProfileApprovalField {
    const label = (key: "ask" | "allowWrites" | "auto" | "yolo"): string => text.t(agentText(`conversation.approval.${key}.label`));
    const value = setting?.approvalMode ?? FOLLOW_APPROVAL;
    const hint = value === "auto" ? "profiles.approval.auto" : value === "yolo" ? "profiles.approval.yolo" : "profiles.approval.hint";
    return {
        value,
        options: [
            {value: FOLLOW_APPROVAL, label: text.t(agentText("profiles.approval.follow", {mode: label("ask")}))},
            {value: "ask", label: label("ask")},
            {value: "allow-writes", label: label("allowWrites")},
            {value: "auto", label: label("auto")},
            {value: "yolo", label: label("yolo")},
        ],
        hint: text.t(agentText(hint)),
    };
}

function problemNotice(entry: ProfileEntry, problem: ProfileProblem, text: TextResolver): ProfileNotice {
    const tail = entry.status === "error" ? [text.t(agentText("profiles.problem.stale"))] : entry.status === "unavailable" ? [text.t(agentText("profiles.problem.never"))] : [];
    switch (problem.code) {
        case "tools-missing": {
            const tools = problem.tools.join(text.t(agentText("profiles.problem.separator")));
            return {text: text.t(agentText("profiles.problem.toolsMissing", {tools})), lines: [text.t(agentText("profiles.problem.toolsMissingDetail", {tools}))], tone: "warning"};
        }
        case "extensions-missing": {
            const extensions = problem.extensions.join(text.t(agentText("profiles.problem.separator")));
            return {text: text.t(agentText("profiles.problem.extensionsMissing", {extensions})), lines: [text.t(agentText("profiles.problem.extensionsMissingDetail", {extensions}))], tone: "warning"};
        }
        case "key-taken":
            return {text: text.t(agentText("profiles.problem.keyTaken")), lines: [text.t(agentText("profiles.problem.keyTakenDetail", {key: entry.key}))], tone: "warning"};
        case "module-not-shared":
            return {
                text: problem.module === undefined ? text.t(agentText("profiles.problem.moduleNotSharedComputed")) : text.t(agentText("profiles.problem.moduleNotShared", {module: problem.module})),
                lines: [text.t(agentText("profiles.problem.moduleDetail")), ...tail],
                tone: "danger",
            };
        case "invalid-export":
            return problem.expectedId === undefined
                ? {text: text.t(agentText("profiles.problem.invalidExport")), lines: [text.t(agentText("profiles.problem.invalidExport")), ...tail], tone: "danger"}
                : {text: text.t(agentText("profiles.problem.invalidId", {id: problem.expectedId})), lines: [text.t(agentText("profiles.problem.invalidIdDetail", {id: problem.expectedId})), ...tail], tone: "danger"};
        case "build-failed":
            return {
                text: problem.line === undefined
                    ? text.t(agentText("profiles.problem.buildFailed", {message: problem.message}))
                    : text.t(agentText("profiles.problem.buildFailedAt", {line: problem.line, message: problem.message})),
                lines: [
                    problem.line === undefined
                        ? text.t(agentText("profiles.problem.buildDetail", {file: problem.file, message: problem.message}))
                        : text.t(agentText("profiles.problem.buildDetailAt", {file: problem.file, line: problem.line, message: problem.message})),
                    ...tail,
                ],
                tone: "danger",
            };
        case "load-failed":
            return {
                text: text.t(agentText("profiles.problem.loadFailed", {message: problem.message})),
                lines: [text.t(agentText("profiles.problem.buildDetail", {file: problem.file, message: problem.message})), ...tail],
                tone: "danger",
            };
    }
}

/** Agent 插件自带的工具的一句话说明的键；别的插件的工具取声明说明的第一行。 */
const BUILTIN_TOOL_SUMMARIES = {
    "nbook.agent.read": "profiles.tools.summary.read",
    "nbook.agent.write": "profiles.tools.summary.write",
    "nbook.agent.edit": "profiles.tools.summary.edit",
    "nbook.agent.edit-replace": "profiles.tools.summary.edit-replace",
    "nbook.agent.grep": "profiles.tools.summary.grep",
    "nbook.agent.glob": "profiles.tools.summary.glob",
    "nbook.agent.shell": "profiles.tools.summary.shell",
    "nbook.agent.eval": "profiles.tools.summary.eval",
    "nbook.agent.switch-mode": "profiles.tools.summary.switch-mode",
    "nbook.agent.ask": "profiles.tools.summary.ask",
    "nbook.agent.ask-form": "profiles.tools.summary.ask-form",
    "nbook.agent.spawn": "profiles.tools.summary.spawn",
    "nbook.agent.send": "profiles.tools.summary.send",
    "nbook.agent.answer": "profiles.tools.summary.answer",
    "nbook.agent.wait": "profiles.tools.summary.wait",
    "nbook.agent.kill": "profiles.tools.summary.kill",
    "nbook.agent.jobs": "profiles.tools.summary.jobs",
} as const;

export const hasBuiltinToolSummary = (id: string): boolean => id in BUILTIN_TOOL_SUMMARIES;

function toolRow(tool: ToolCatalogEntry, required: boolean, text: TextResolver): ProfileToolRow {
    const summaryKey = BUILTIN_TOOL_SUMMARIES[tool.id as keyof typeof BUILTIN_TOOL_SUMMARIES] as (typeof BUILTIN_TOOL_SUMMARIES)[keyof typeof BUILTIN_TOOL_SUMMARIES] | undefined;
    const summary = summaryKey === undefined ? tool.description.split("\n")[0]!.trim() : text.t(agentText(summaryKey));
    return {
        id: tool.id,
        name: tool.providerName,
        effect: text.t(agentText(`profiles.tools.effect.${tool.effect}`)),
        danger: tool.effect === "exec",
        summary,
        detail: summaryKey === undefined ? tool.description : summary,
        required,
        gone: false,
    };
}

function byProvider<T extends {readonly id: string}>(tools: readonly T[], pluginOf: (tool: T) => string, input: ProfileViewsInput): {readonly id: string; readonly provider: string; readonly tools: readonly T[]}[] {
    const plugins = [...new Set(tools.map(pluginOf))].sort((a, b) => (a === BUILTIN_PLUGIN ? -1 : b === BUILTIN_PLUGIN ? 1 : input.pluginName(a).localeCompare(input.pluginName(b))));
    return plugins.map((plugin) => ({id: plugin, provider: sourceName(plugin, input.pluginName, input.text), tools: tools.filter((tool) => pluginOf(tool) === plugin)}));
}

const SPAWN_TOOL = "nbook.agent.spawn";

function agentsField(entry: ProfileEntry, input: ProfileViewsInput): ProfileToolsField | null {
    if (entry.tools === undefined) return null;
    const {text, catalog} = input;
    const requirements = {required: entry.tools.required, optional: entry.tools.optional, ...(entry.defaultTools === false ? {defaultTools: false as const} : {})};
    // 与工具一节、服务端同一份算法（带按对象的增减）：派发工具哪天成了全局对象的方法，这里也对得上。
    const ids = profileToolIds(requirements, catalog.filter((tool) => tool.defaultForAll === true).map((tool) => tool.id), input.bindings[entry.key], catalogMethodsOf(catalog));
    if (!ids.includes(SPAWN_TOOL)) return null;
    const binding = input.settings[entry.key]?.agents;
    const declared = entry.agents?.allowed ?? [];
    const effective = profileAgents(entry.agents, binding);
    const recommended = new Set(effective.recommended);
    const profiles = new Map(input.profiles.map((profile) => [profile.key, profile]));
    const row = (key: string): ProfileToolRow => {
        const profile = profiles.get(key);
        // 白名单里的 Profile 已被删除或不可用：一行警告，能去掉。
        const gone = profile === undefined || profile.status !== "ok";
        const summary = gone ? text.t(agentText("profiles.agents.gone")) : profile.description;
        // 已删除的不再标“推荐”“我加的”：那一行只说它不在了。
        const effect = gone ? "" : recommended.has(key) ? text.t(agentText("profiles.agents.recommended")) : declared.includes(key) ? "" : text.t(agentText("profiles.agents.userAdded"));
        return {id: key, name: profile?.name ?? key, effect, danger: false, summary, detail: summary, required: false, gone};
    };
    const listed = effective.allowed.map((key) => ({key, plugin: profiles.get(key)?.source ?? GONE_GROUP}));
    const groups: ProfileToolGroup[] = byProvider(listed.map((item) => ({id: item.key, plugin: item.plugin})), (item) => item.plugin, input).map((group) => ({id: group.id, provider: group.id === GONE_GROUP ? text.t(agentText("profiles.agents.goneGroup")) : group.provider, tools: group.tools.map((item) => row(item.id))}));
    const allowed = new Set(effective.allowed);
    const candidates = byProvider(input.profiles.filter((profile) => profile.status === "ok" && !allowed.has(profile.key)).map((profile) => ({id: profile.key, plugin: profile.source})), (item) => item.plugin, input).map((group) => ({
        id: group.id,
        provider: group.provider,
        tools: group.tools.map((item): ProfileToolCandidate => ({...row(item.id), providerName: item.id, blocked: false})),
    }));
    return {groups, count: effective.allowed.length, modified: binding !== undefined, candidates};
}

/** 用户去掉的那一组的身份。 */
export const REMOVED_GROUP = "removed";

/** 白名单一节里的一项（一个 Skill、一个表情包）：`invalid` 的照样列出，但不算可用、不进候选。 */
interface AllowlistItem {
    readonly id: string;
    readonly status: string;
}

interface AllowlistGroup<T> {
    readonly id: string;
    readonly provider: string;
    readonly items: readonly T[];
}

interface AllowlistSection<T extends AllowlistItem> {
    /** 目录（列表）里的全部项。 */
    readonly items: readonly T[];
    readonly declaration: DeclaredAllowlist | undefined;
    readonly binding: ToolBinding | undefined;
    /** 一行：`declared` 是 Profile 声明的，`restorable` 是用户去掉、能加回的。 */
    readonly row: (item: T, mark: {readonly declared: boolean; readonly restorable: boolean}) => ProfileToolRow;
    readonly groups: (items: readonly T[]) => ReadonlyArray<AllowlistGroup<T>>;
    readonly text: {readonly gone: string; readonly goneGroup: string; readonly removedGroup: string};
}

/**
 * 按白名单列的一节（Skill 与表情包共用，skills.md 输出 8、stickers.md 输出 19）：白名单里的按来源分组；白名单里、目录中已经没有的
 * 一组“已删除或不可用”；用户去掉、目录里还有的收在最后一组“已去掉”，能加回。添加对话框的候选是目录里不在白名单、不是无效的。
 */
function allowlistField<T extends AllowlistItem>(section: AllowlistSection<T>): ProfileToolsField {
    const ids = section.items.map((item) => item.id);
    const declared = new Set(declaredAllowlist(section.declaration, ids));
    const allowed = profileAllowlist(section.declaration, section.binding, ids);
    const allowedSet = new Set(allowed);
    const byId = new Map(section.items.map((item) => [item.id, item]));
    const row = (item: T, restorable = false): ProfileToolRow => ({...section.row(item, {declared: declared.has(item.id), restorable}), ...(restorable ? {restorable: true} : {})});
    const goneRow = (id: string): ProfileToolRow => ({id, name: id, effect: "", danger: false, summary: section.text.gone, detail: section.text.gone, required: false, gone: true});
    const listed = allowed.map((id) => byId.get(id)).filter((item): item is T => item !== undefined);
    const gone = allowed.filter((id) => !byId.has(id));
    const removed = (section.binding?.removed ?? []).map((id) => byId.get(id)).filter((item): item is T => item !== undefined && item.status !== "invalid");
    const groups: ProfileToolGroup[] = [
        ...section.groups(listed).map((group) => ({id: group.id, provider: group.provider, tools: group.items.map((item) => row(item))})),
        ...(gone.length === 0 ? [] : [{id: GONE_GROUP, provider: section.text.goneGroup, tools: gone.map(goneRow)}]),
        ...(removed.length === 0 ? [] : [{id: REMOVED_GROUP, provider: section.text.removedGroup, tools: removed.map((item) => row(item, true))}]),
    ];
    const candidates = section.groups(section.items.filter((item) => item.status !== "invalid" && !allowedSet.has(item.id))).map((group) => ({
        id: group.id,
        provider: group.provider,
        tools: group.items.map((item): ProfileToolCandidate => ({...row(item), providerName: item.id, blocked: false})),
    }));
    return {groups, count: listed.filter((item) => item.status !== "invalid").length, modified: section.binding !== undefined, candidates};
}

/** Skill 一节（skills.md 的“输入与前置条件”、输出 8）：分组同 Skill 页（我的、各插件、内置），行写状态与说明。 */
function skillsField(entry: ProfileEntry, input: ProfileViewsInput): ProfileToolsField | null {
    const catalog = input.skills;
    // 后台的 Profile 没有用户的输入，`$` 到不了它，不给这一节。
    if (catalog === null || catalog === undefined || entry.tools === undefined || entry.hidden === true) return null;
    const {text} = input;
    const groupName = (group: SkillGroup<SkillEntry>): string => group.title ?? text.t(agentText(group.source === "user" ? "profiles.skills.groups.user" : "profiles.skills.groups.builtin"));
    return allowlistField({
        items: catalog,
        declaration: entry.skills,
        binding: input.settings[entry.key]?.skills,
        row: (skill, mark) => ({
            id: skill.id,
            name: skill.name,
            effect: skill.status === "invalid" ? text.t(agentText("profiles.skills.invalid"))
                : skill.status === "needs-init" ? text.t(agentText("profiles.skills.needsInit"))
                : mark.declared || mark.restorable ? "" : text.t(agentText("profiles.skills.userAdded")),
            danger: skill.status === "invalid",
            summary: skill.description,
            // 无效的、上次没装好的：悬停的全文先写原因（同 Skill 页的第二行），再写说明。
            detail: skill.problem === undefined ? skill.description : [skillProblemText(skill.problem, (key, params) => text.t(agentText(key, params))), skill.description].filter((part) => part !== "").join("\n"),
            required: false,
            gone: false,
        }),
        groups: (skills) => groupSkills(skills, (skill) => skill).map((group) => ({id: group.key, provider: groupName(group), items: group.items})),
        text: {gone: text.t(agentText("profiles.skills.gone")), goneGroup: text.t(agentText("profiles.skills.goneGroup")), removedGroup: text.t(agentText("profiles.skills.removedGroup"))},
    });
}

/**
 * 表情包一节（stickers.md 输出 19、profile-settings.md 输出 27）：分组我的在前、各插件按显示名（没有时插件 id）各一组、内置的在最后；行是显示名、
 * 说明、表情数与第一个常用表情的缩略图。后台的 Profile 没有对话，不给这一节；列表还没取到时也不给。
 */
function stickersField(entry: ProfileEntry, input: ProfileViewsInput): ProfileToolsField | null {
    const packs = input.stickerPacks;
    if (packs === null || packs === undefined || entry.tools === undefined || entry.hidden === true) return null;
    const {text} = input;
    const binding = input.settings[entry.key]?.stickers;
    // 从来没有过表情包、也没有设置过的：整节不画（新用户不看到一节空的）。删光了而白名单里还有的照样画，列在“已删除或不可用”。
    if (packs.length === 0 && binding === undefined && declaredAllowlist(entry.stickers, []).length === 0) return null;
    const grouped = (list: readonly StickerPackSummary[]): Array<AllowlistGroup<StickerPackSummary>> => {
        const groups = new Map<string, {readonly id: string; readonly provider: string; readonly items: StickerPackSummary[]}>();
        for (const pack of list) {
            const key = pack.source === "plugin" ? `plugin:${pack.plugin?.id ?? ""}` : pack.source;
            const provider = pack.source === "plugin" ? pack.plugin?.title ?? pack.plugin?.id ?? "" : text.t(agentText(pack.source === "user" ? "profiles.stickers.groups.user" : "profiles.stickers.groups.builtin"));
            const group = groups.get(key) ?? {id: key, provider, items: []};
            group.items.push(pack);
            groups.set(key, group);
        }
        const rank = (id: string): number => (id === "user" ? 0 : id === "builtin" ? 2 : 1);
        return [...groups.values()].sort((left, right) => rank(left.id) - rank(right.id) || left.provider.localeCompare(right.provider));
    };
    return allowlistField({
        items: packs,
        declaration: entry.stickers,
        binding,
        row: (pack, mark) => {
            const count = text.t(agentText("profiles.stickers.count", {count: pack.count}));
            const summary = pack.description === undefined ? count : `${count} · ${pack.description}`;
            return {
                id: pack.id,
                name: pack.title,
                effect: pack.status === "invalid" ? text.t(agentText("profiles.stickers.invalid")) : mark.declared || mark.restorable ? "" : text.t(agentText("profiles.stickers.userAdded")),
                danger: pack.status === "invalid",
                summary,
                detail: [pack.id, summary].join("\n"),
                required: false,
                gone: false,
                ...(pack.thumbnail === null ? {} : {thumbnail: pack.thumbnail}),
            };
        },
        groups: grouped,
        text: {gone: text.t(agentText("profiles.stickers.gone")), goneGroup: text.t(agentText("profiles.stickers.goneGroup")), removedGroup: text.t(agentText("profiles.stickers.removedGroup"))},
    });
}

/** 对象行的 id：与工具 id 分开，去掉、加回时据此换成按对象改（`objectAwareChange`）。 */
const OBJECT_ROW = "object:";
export const objectRowId = (object: string): string => `${OBJECT_ROW}${object}`;
const EVAL_TOOL = "nbook.agent.eval";
const EFFECT_RANK: Readonly<Record<string, number>> = {read: 0, write: 1, exec: 2};

/** 工具目录里全局对象的方法，按对象名（与服务端 `AgentTools.methodsOf` 同一规则：目录只给有效对象的方法带 `object`）。 */
export function catalogMethodsOf(catalog: readonly ToolCatalogEntry[]): MethodsOf {
    const methods = new Map<string, string[]>();
    for (const tool of catalog) {
        if (tool.object === undefined) continue;
        const list = methods.get(tool.object.name) ?? [];
        list.push(tool.id);
        methods.set(tool.object.name, list);
    }
    return (object) => methods.get(object) ?? [];
}

/**
 * 一个全局对象的一行（输出 28）：等级只写最高的一档，悬停里列出每个方法与它的等级；说明是对象在界面上的说明，Profile 没有
 * `eval` 时换成“要先加入 eval 才用得上”并标警示。必需的方法在里面时这一行不能去掉。
 */
function objectRow(object: string, tools: readonly ToolCatalogEntry[], required: ReadonlySet<string>, hasEval: boolean, text: TextResolver): ProfileToolRow {
    const effectOf = (tool: ToolCatalogEntry): string => text.t(agentText(`profiles.tools.effect.${tool.effect}`));
    const top = [...tools].sort((a, b) => (EFFECT_RANK[b.effect] ?? 0) - (EFFECT_RANK[a.effect] ?? 0))[0]!;
    const methods = [...tools].sort((a, b) => a.object!.method.localeCompare(b.object!.method))
        .map((tool) => text.t(agentText("profiles.tools.objectMethod", {method: `${object}.${tool.object!.method}`, effect: effectOf(tool)})));
    const description = text.t(tools[0]!.object!.description);
    // 悬停里总是对象的说明加方法；没有 eval 时行上的说明换成原因（警示只在行上）。说明末尾的句号去掉，由文字表接上。
    const detail = text.t(agentText("profiles.tools.objectDetail", {summary: description.replace(/[。．.！!？?\s]+$/u, ""), methods: methods.join(text.t(agentText("profiles.tools.listSeparator")))}));
    return {
        id: objectRowId(object),
        name: object,
        label: `${object}.*`,
        effect: effectOf(top),
        danger: top.effect === "exec",
        summary: hasEval ? description : text.t(agentText("profiles.tools.objectNeedsEval")),
        detail,
        required: tools.some((tool) => required.has(tool.id)),
        gone: false,
        object,
        ...(hasEval ? {} : {warning: true}),
    };
}

/** 一组工具排成行：同一对象的方法合成一行，排在它第一个方法的位置。 */
function toolRows(tools: readonly ToolCatalogEntry[], required: ReadonlySet<string>, hasEval: boolean, text: TextResolver): ProfileToolRow[] {
    const rows: ProfileToolRow[] = [];
    const seen = new Set<string>();
    for (const tool of tools) {
        if (tool.object === undefined) {
            rows.push(toolRow(tool, required.has(tool.id), text));
            continue;
        }
        if (seen.has(tool.object.name)) continue;
        seen.add(tool.object.name);
        rows.push(objectRow(tool.object.name, tools.filter((other) => other.object?.name === tool.object!.name), required, hasEval, text));
    }
    return rows;
}

function toolsField(entry: ProfileEntry, input: ProfileViewsInput): ProfileToolsField | null {
    if (entry.tools === undefined) return null;
    const {text, catalog} = input;
    const byId = new Map(catalog.map((tool) => [tool.id, tool]));
    const nameOf = (id: string): string | undefined => byId.get(id)?.providerName;
    const methodsOf = catalogMethodsOf(catalog);
    const requirements = {required: entry.tools.required, optional: entry.tools.optional, ...(entry.defaultTools === false ? {defaultTools: false as const} : {})};
    const binding = input.bindings[entry.key];
    const ids = profileToolIds(requirements, catalog.filter((tool) => tool.defaultForAll === true).map((tool) => tool.id), binding, methodsOf);
    const visible = visibleToolIds(ids, nameOf);
    const required = new Set(entry.tools.required);
    const gone = ids.filter((id) => !byId.has(id));
    // 绑定里加上、但插件已卸载的对象：目录里查不到它的方法，按对象列一行“已卸载”。
    const goneObjects = (binding?.objects?.added ?? []).filter((object) => methodsOf(object).length === 0);
    if (entry.hidden === true && visible.length === 0 && gone.length === 0 && goneObjects.length === 0) return null;
    const hasEval = visible.includes(EVAL_TOOL);
    const rows = visible.map((id) => byId.get(id)!);
    const groups: ProfileToolGroup[] = byProvider(rows, (tool) => tool.plugin, input).map((group) => ({id: group.id, provider: group.provider, tools: toolRows(group.tools, required, hasEval, text)}));
    if (gone.length > 0 || goneObjects.length > 0) {
        const goneSummary = text.t(agentText("profiles.tools.goneSummary"));
        groups.push({
            id: GONE_GROUP,
            provider: text.t(agentText("profiles.tools.gone")),
            tools: [
                ...gone.map((id) => ({id, name: id, effect: "", danger: false, summary: goneSummary, detail: goneSummary, required: required.has(id), gone: true})),
                ...goneObjects.map((object) => ({id: objectRowId(object), name: object, label: `${object}.*`, effect: "", danger: false, summary: goneSummary, detail: goneSummary, required: false, gone: true, object})),
            ],
        });
    }
    const shown = new Set(visible);
    const shownObjects = new Set(rows.flatMap((tool) => (tool.object === undefined ? [] : [tool.object.name])));
    const candidates = byProvider(catalog.filter((tool) => !shown.has(tool.id) && (tool.object === undefined || !shownObjects.has(tool.object.name))), (tool) => tool.plugin, input).map((group) => ({
        id: group.id,
        provider: group.provider,
        tools: toolRows(group.tools, new Set(), hasEval, text).map((row): ProfileToolCandidate => {
            if (row.object !== undefined) return {...row, providerName: row.id, blocked: false};
            const same = sameNameTool(row.id, visible, nameOf, entry.tools!.required);
            return {...row, providerName: byId.get(row.id)!.providerName, ...(same.replaces === undefined ? {} : {replaces: same.replaces}), blocked: same.blockedBy !== undefined};
        }),
    }));
    const modified = binding !== undefined && (binding.added.length > 0 || binding.removed.length > 0 || (binding.objects?.added.length ?? 0) > 0 || (binding.objects?.removed.length ?? 0) > 0);
    // 计数按行：一个对象算一个（输出 28）。
    const count = groups.filter((group) => group.id !== GONE_GROUP).reduce((total, group) => total + group.tools.length, 0);
    return {groups, count, modified, candidates};
}

/** 页面上的改动换成绑定的改动：对象行的 id 换成按对象改（输出 29）。 */
export function objectAwareChange(change: ToolChange): ToolChange {
    const split = (ids: readonly string[] | undefined): {readonly tools: string[]; readonly objects: string[]} => ({
        tools: (ids ?? []).filter((id) => !id.startsWith(OBJECT_ROW)),
        objects: (ids ?? []).filter((id) => id.startsWith(OBJECT_ROW)).map((id) => id.slice(OBJECT_ROW.length)),
    });
    const add = split(change.add);
    const remove = split(change.remove);
    return {
        add: add.tools,
        remove: remove.tools,
        addObjects: [...(change.addObjects ?? []), ...add.objects],
        removeObjects: [...(change.removeObjects ?? []), ...remove.objects],
    };
}

/** 改绑定用的：这个 Profile 本来就有哪些工具、全局对象各有哪些方法。 */
export function toolChangeContext(entry: ProfileEntry, catalog: readonly ToolCatalogEntry[]): {readonly requirements: {readonly required: readonly string[]; readonly optional: readonly string[]; readonly defaultTools?: false}; readonly defaultForAll: readonly string[]; readonly methodsOf: MethodsOf} {
    return {
        requirements: {required: entry.tools?.required ?? [], optional: entry.tools?.optional ?? [], ...(entry.defaultTools === false ? {defaultTools: false as const} : {})},
        defaultForAll: catalog.filter((tool) => tool.defaultForAll === true).map((tool) => tool.id),
        methodsOf: catalogMethodsOf(catalog),
    };
}

export type {ToolChange};

export interface ProfileViewsInput {
    readonly profiles: readonly ProfileEntry[];
    readonly catalog: readonly ToolCatalogEntry[];
    readonly bindings: Readonly<Record<string, ToolBinding>>;
    readonly settings: Readonly<Record<string, ProfileSetting>>;
    /** 还没取到或模型服务不在时为 null。 */
    readonly snapshot: ModelsSnapshot | null;
    /** 选用数据（见 `ProfileModels`）。 */
    readonly models: ProfileModels;
    readonly modelsFailed: boolean;
    /** 别的插件的显示名。 */
    readonly pluginName: (plugin: string) => string;
    readonly text: TextResolver;
    /** Skill 目录；还没取到时为 null，Skill 一节不画。 */
    readonly skills?: readonly SkillEntry[] | null;
    /** 表情包列表；取不到时为 null，表情包一节不画。 */
    readonly stickerPacks?: readonly StickerPackSummary[] | null;
}

/** 来源的显示名：左栏与工具的提供者用同一套词。 */
export function sourceName(source: string, pluginName: (plugin: string) => string, text: TextResolver): string {
    if (source === USER_SOURCE) return text.t(agentText("profiles.source.user"));
    return source === BUILTIN_PLUGIN ? text.t(agentText("profiles.source.builtin")) : pluginName(source);
}

export function profileViews(input: ProfileViewsInput): ProfileView[] {
    const {text} = input;
    return input.profiles.map((entry): ProfileView => {
        const setting = input.settings[entry.key];
        const user = entry.source === USER_SOURCE;
        return {
            key: entry.key,
            name: entry.name,
            description: entry.description,
            icon: entry.icon ?? (user ? "i-lucide-user-round-pen" : "i-lucide-bot"),
            source: sourceName(entry.source, input.pluginName, text),
            statusText: entry.status === "ok"
                ? null
                : entry.status === "error"
                    ? {kind: "error", text: text.t(agentText("profiles.status.error")), tone: "error"}
                    : {kind: "unavailable", text: text.t(agentText("profiles.status.unavailable")), tone: entry.problem?.code === "tools-missing" || entry.problem?.code === "extensions-missing" || entry.problem?.code === "key-taken" ? "warning" : "error"},
            hidden: entry.hidden === true,
            user,
            notice: entry.problem === undefined ? null : problemNotice(entry, entry.problem, text),
            model: modelField(entry, setting, input.snapshot, input.models, input.modelsFailed, text),
            approval: entry.hidden === true ? null : approvalField(setting, text),
            tools: toolsField(entry, input),
            agents: agentsField(entry, input),
            skills: skillsField(entry, input),
            stickers: stickersField(entry, input),
        };
    });
}
