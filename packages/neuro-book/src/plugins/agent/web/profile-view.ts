/**
 * Profile 设置页的视图模型（docs/specs/agent/profile-settings.md）：把目录、Profile 设置与模型快照算成页面要显示的，页面组件只吃算好的
 * 东西，能在 Lab 里直接摆。文字在这里按界面语言翻好。
 */

import {builtinRoleNameKey, modelsText, roleOfReference, roleReference} from "nbook/plugins/models/shared/contracts";
import type {ModelsSnapshot, SnapshotModel, SnapshotProvider, SnapshotRole} from "nbook/plugins/models/shared/contracts";
import type {TextResolver} from "nbook/shared/localized-text";

import type {ProfileEntry, ProfileProblem, ToolCatalogEntry} from "../shared/contracts";
import {profileToolIds, sameNameTool, visibleToolIds} from "../shared/profile-tools";
import type {ToolBinding, ToolChange} from "../shared/profile-tools";
import type {ProfileSetting} from "../shared/settings";
import {agentText} from "../shared/text";

/** 跟随默认：模型下拉用空串（`SearchSelect` 收空串），审批模式用哨兵（`Select` 的选项不能是空串）；都不落盘。 */
export const FOLLOW_MODEL = "";
export const FOLLOW_APPROVAL = "default";
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
}

export interface ProfileToolGroup {
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
    /** 第二行的来源：内置、插件名、“我写的”。 */
    readonly source: string;
    /** 有问题时第二行换成这个。 */
    readonly statusText: {readonly text: string; readonly tone: "warning" | "error"} | null;
    readonly hidden: boolean;
    /** 用户级：有“打开文件”“删除”。 */
    readonly user: boolean;
    readonly notice: ProfileNotice | null;
    readonly model: ProfileModelField;
    /** `hidden` 的没有：后台运行没有审批。 */
    readonly approval: ProfileApprovalField | null;
    /** 没有工具一节时为 null：从未打包成功的、什么工具都没有的后台 Profile。 */
    readonly tools: ProfileToolsField | null;
}

export function hasCredentials(provider: SnapshotProvider): boolean {
    return provider.key.kind === "stored" || provider.key.kind === "keyless" || (provider.key.kind === "env" && provider.key.found);
}

const usable = (provider: SnapshotProvider, model: SnapshotModel): boolean => hasCredentials(provider) && model.enabled && model.status === "ok";

/** 模型一行的取值：文件里 `model` 与 `role` 都写时按 `model`（models/service.md 输出 8）。 */
export function modelChoiceOf(setting: ProfileSetting | undefined): string {
    if (setting?.model !== undefined) return setting.model;
    return setting?.role === undefined ? FOLLOW_MODEL : roleReference(setting.role);
}

/** 一个 Profile 的设置写回去：空的字段删掉，都空时不留这个 key；别的 Profile 原样留着。 */
function withSetting(settings: Readonly<Record<string, ProfileSetting>>, profile: string, setting: ProfileSetting): Record<string, ProfileSetting> {
    const next: Record<string, ProfileSetting> = {...settings};
    if (Object.keys(setting).length === 0) delete next[profile];
    else next[profile] = setting;
    return next;
}

export function withModelChoice(settings: Readonly<Record<string, ProfileSetting>>, profile: string, choice: string): Record<string, ProfileSetting> {
    const {model: _model, role: _role, ...rest} = settings[profile] ?? {};
    const role = roleOfReference(choice);
    if (choice === FOLLOW_MODEL) return withSetting(settings, profile, rest);
    return withSetting(settings, profile, role === null ? {...rest, model: choice} : {...rest, role});
}

export function withApprovalChoice(settings: Readonly<Record<string, ProfileSetting>>, profile: string, choice: string): Record<string, ProfileSetting> {
    const {approvalMode: _approvalMode, ...rest} = settings[profile] ?? {};
    return withSetting(settings, profile, choice === FOLLOW_APPROVAL ? rest : {...rest, approvalMode: choice as NonNullable<ProfileSetting["approvalMode"]>});
}

function roleName(role: SnapshotRole, text: TextResolver): string {
    const key = builtinRoleNameKey(role);
    if (key !== null) return text.t(modelsText(key));
    return role.name === "" ? role.id : role.name;
}

function findModel(snapshot: ModelsSnapshot, reference: string): {readonly provider: SnapshotProvider; readonly model: SnapshotModel} | null {
    for (const provider of snapshot.providers) {
        const model = provider.models.find((candidate) => `${provider.id}/${candidate.id}` === reference);
        if (model !== undefined) return {provider, model};
    }
    return null;
}

function modelField(entry: ProfileEntry, setting: ProfileSetting | undefined, snapshot: ModelsSnapshot | null, modelsFailed: boolean, text: TextResolver): ProfileModelField {
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
    const modelName = (reference: string | null): string | undefined => (reference === null ? undefined : findModel(snapshot, reference)?.model.name ?? reference);
    const roles = snapshot.roles.map((role): ProfileOption => ({
        value: roleReference(role.id),
        label: roleName(role, text),
        description: modelName(role.model) ?? text.t(agentText("profiles.model.unbound")),
        iconClass: "i-lucide-layers",
    }));
    const models = snapshot.providers.flatMap((provider) => provider.models
        .filter((model) => usable(provider, model))
        .map((model): ProfileOption => ({value: `${provider.id}/${model.id}`, label: model.name, description: provider.name})));
    const options: ProfileOption[] = [{...follow, ...(followRole === undefined ? {} : {description: followName})}, ...roles, ...models];

    const problem = ((): string | null => {
        const direct = setting?.model;
        if (direct !== undefined) {
            const found = findModel(snapshot, direct);
            return found !== null && usable(found.provider, found.model) ? null : text.t(agentText("profiles.model.modelGone"));
        }
        const id = setting?.role ?? entry.role ?? DEFAULT_ROLE;
        const role = snapshot.roles.find((candidate) => candidate.id === id);
        if (role === undefined) return text.t(agentText("profiles.model.roleGone"));
        if (role.status === "ok") return null;
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
    "nbook.agent.switch-mode": "profiles.tools.summary.switch-mode",
    "nbook.agent.ask": "profiles.tools.summary.ask",
    "nbook.agent.ask-form": "profiles.tools.summary.ask-form",
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

function byProvider<T extends {readonly id: string}>(tools: readonly T[], pluginOf: (tool: T) => string, input: ProfileViewsInput): {readonly provider: string; readonly tools: readonly T[]}[] {
    const plugins = [...new Set(tools.map(pluginOf))].sort((a, b) => (a === BUILTIN_PLUGIN ? -1 : b === BUILTIN_PLUGIN ? 1 : input.pluginName(a).localeCompare(input.pluginName(b))));
    return plugins.map((plugin) => ({provider: sourceName(plugin, input.pluginName, input.text), tools: tools.filter((tool) => pluginOf(tool) === plugin)}));
}

function toolsField(entry: ProfileEntry, input: ProfileViewsInput): ProfileToolsField | null {
    if (entry.tools === undefined) return null;
    const {text, catalog} = input;
    const byId = new Map(catalog.map((tool) => [tool.id, tool]));
    const nameOf = (id: string): string | undefined => byId.get(id)?.providerName;
    const requirements = {required: entry.tools.required, optional: entry.tools.optional, ...(entry.defaultTools === false ? {defaultTools: false as const} : {})};
    const binding = input.bindings[entry.key];
    const ids = profileToolIds(requirements, catalog.filter((tool) => tool.defaultForAll === true).map((tool) => tool.id), binding);
    const visible = visibleToolIds(ids, nameOf);
    const required = new Set(entry.tools.required);
    const gone = ids.filter((id) => !byId.has(id));
    if (entry.hidden === true && visible.length === 0 && gone.length === 0) return null;
    const rows = visible.map((id) => byId.get(id)!);
    const groups: ProfileToolGroup[] = byProvider(rows, (tool) => tool.plugin, input).map((group) => ({provider: group.provider, tools: group.tools.map((tool) => toolRow(tool, required.has(tool.id), text))}));
    if (gone.length > 0) {
        groups.push({
            provider: text.t(agentText("profiles.tools.gone")),
            tools: gone.map((id) => ({id, name: id, effect: "", danger: false, summary: text.t(agentText("profiles.tools.goneSummary")), detail: text.t(agentText("profiles.tools.goneSummary")), required: required.has(id), gone: true})),
        });
    }
    const shown = new Set(visible);
    const candidates = byProvider(catalog.filter((tool) => !shown.has(tool.id)), (tool) => tool.plugin, input).map((group) => ({
        provider: group.provider,
        tools: group.tools.map((tool): ProfileToolCandidate => {
            const same = sameNameTool(tool.id, visible, nameOf, entry.tools!.required);
            return {...toolRow(tool, false, text), providerName: tool.providerName, ...(same.replaces === undefined ? {} : {replaces: same.replaces}), blocked: same.blockedBy !== undefined};
        }),
    }));
    return {groups, count: visible.length, modified: binding !== undefined, candidates};
}

/** 改绑定用的：这个 Profile 本来就有哪些工具。 */
export function toolChangeContext(entry: ProfileEntry, catalog: readonly ToolCatalogEntry[]): {readonly requirements: {readonly required: readonly string[]; readonly optional: readonly string[]; readonly defaultTools?: false}; readonly defaultForAll: readonly string[]} {
    return {
        requirements: {required: entry.tools?.required ?? [], optional: entry.tools?.optional ?? [], ...(entry.defaultTools === false ? {defaultTools: false as const} : {})},
        defaultForAll: catalog.filter((tool) => tool.defaultForAll === true).map((tool) => tool.id),
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
    readonly modelsFailed: boolean;
    /** 别的插件的显示名。 */
    readonly pluginName: (plugin: string) => string;
    readonly text: TextResolver;
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
                    ? {text: text.t(agentText("profiles.status.error")), tone: "error"}
                    : {text: text.t(agentText("profiles.status.unavailable")), tone: entry.problem?.code === "tools-missing" || entry.problem?.code === "key-taken" ? "warning" : "error"},
            hidden: entry.hidden === true,
            user,
            notice: entry.problem === undefined ? null : problemNotice(entry, entry.problem, text),
            model: modelField(entry, setting, input.snapshot, input.modelsFailed, text),
            approval: entry.hidden === true ? null : approvalField(setting, text),
            tools: toolsField(entry, input),
        };
    });
}
