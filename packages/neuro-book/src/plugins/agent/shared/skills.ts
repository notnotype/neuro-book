/**
 * Skill 目录的合同（docs/specs/agent/skills.md）：目录条目、状态、原因与认标签的结果，前后端共用。原因是结构化的码，
 * 界面按码给文字；`detail` 只放能原样显示的事实（文件夹名、安装输出的最后几行）。
 */

/** Skill 从哪来：应用内置、插件经 `agent.skills` 贡献、用户放进 `user://skills/`。 */
export type SkillSource = "builtin" | "plugin" | "user";

/** 插件来源的 Skill 属于哪个插件：插件 id 与清单的显示名（没写时为 null，界面写 id）。 */
export interface SkillPluginRef {
    readonly id: string;
    readonly title: string | null;
}

/** skills.md 的“术语与参与者”：可用、未初始化、正在初始化、无效。 */
export type SkillStatus = "ready" | "needs-init" | "initializing" | "invalid";

/**
 * 不可用或上次初始化失败的原因（skills.md 输出 2、3）。无效的：没有 `SKILL.md`（下一层有的是 `nested`）、frontmatter 读不懂、
 * 必填字段缺或不合规、`name` 与目录名不同、Skill 目录是链接。未初始化的：上次安装失败或被中断。
 */
export type SkillProblem =
    | {readonly code: "skill-md-missing"}
    | {readonly code: "nested"; readonly directory: string}
    | {readonly code: "frontmatter-unreadable"; readonly detail: string}
    | {readonly code: "field-missing" | "field-invalid"; readonly field: "name" | "description"}
    | {readonly code: "name-mismatch"; readonly name: string}
    | {readonly code: "symlink"}
    /** 插件的 Skill 里有 `package.json`：没有经 `nbooke build` 打包，插件的 Skill 又不能初始化。 */
    | {readonly code: "plugin-skill-unbuilt"}
    | {readonly code: "install-failed"; readonly detail: string}
    | {readonly code: "interrupted"};

/** 外部依赖的检测结果（skills.md 输出 4）：只报告，不改变状态。 */
export interface SkillExternal {
    /** Skill 带 Python 依赖，应用不代装。 */
    readonly python?: true;
    /** 带 Python 依赖，而 `PATH` 上没有 `uv`。 */
    readonly uvMissing?: true;
    /** `compatibility` 的原文。 */
    readonly compatibility?: string;
}

/** 一条目录条目的字段（skills.md 输出 1）；来源与所属插件见 `SkillEntry`。 */
interface SkillEntryFields {
    /** `<来源前缀>.<name>`，插件的前缀是插件 id；来源以 `source` 为准，不从前缀推断。 */
    readonly id: string;
    /** 无效的 Skill 读不出 `name` 时是目录名。 */
    readonly name: string;
    /** 无效的 Skill 可能为空串。 */
    readonly description: string;
    readonly whenToUse?: string;
    /** `skills://<id>/SKILL.md`。 */
    readonly location: string;
    readonly status: SkillStatus;
    readonly problem?: SkillProblem;
    readonly external?: SkillExternal;
    readonly license?: string;
    readonly metadata?: Readonly<Record<string, string>>;
}

/** 一条目录条目（skills.md 输出 1、30）：插件来源的必带所属插件，别的来源没有。 */
export type SkillEntry = SkillEntryFields & ({readonly source: "builtin" | "user"; readonly plugin?: undefined} | {readonly source: "plugin"; readonly plugin: SkillPluginRef});

/** 初始化之前交给用户确认的内容（skills.md 输出 18）；联网、不运行安装脚本对每个 Skill 都一样，由界面写明。 */
export type SkillInitPlan =
    /** 有 `bun.lock`：要装的包数，读不懂锁文件时为 null（“未知”）；直接依赖给确认框列出来。 */
    | {readonly lock: true; readonly packages: number | null; readonly dependencies: readonly string[]}
    /** 没有 `bun.lock`：直接依赖，安装时按最新版本解析并生成锁文件。 */
    | {readonly lock: false; readonly dependencies: readonly string[]};

/** `$` 标签没带上的原因（skills.md 输出 12）。 */
export type SkillMissingReason = "not-found" | "not-allowed" | "ambiguous" | "invalid" | "unreadable";

export type SkillTokenMatch<Item> = {readonly ok: true; readonly item: Item} | {readonly ok: false; readonly reason: Exclude<SkillMissingReason, "unreadable">};

/**
 * 认一个 `$` 标签（skills.md 输出 7）：先按 id，再在整个目录里按 `name`（区分大小写）。`allowed` 是会话的 Profile 的白名单。
 * 服务端带上 Skill、`$` 菜单与点开标签用同一个规则，所以放在两端共用的这里；`entryOf` 从各自的条目里取目录条目。
 */
export function matchSkillToken<Item>(token: string, items: Iterable<Item>, entryOf: (item: Item) => SkillEntry, allowed: ReadonlySet<string>): SkillTokenMatch<Item> {
    const all = [...items];
    const judge = (item: Item): SkillTokenMatch<Item> => {
        const entry = entryOf(item);
        if (!allowed.has(entry.id)) return {ok: false, reason: "not-allowed"};
        if (entry.status === "invalid") return {ok: false, reason: "invalid"};
        return {ok: true, item};
    };
    const byId = all.find((item) => entryOf(item).id === token);
    if (byId !== undefined) return judge(byId);
    const named = all.filter((item) => entryOf(item).name === token);
    if (named.length === 0) return {ok: false, reason: "not-found"};
    const permitted = named.filter((item) => allowed.has(entryOf(item).id));
    if (permitted.length === 0) return {ok: false, reason: "not-allowed"};
    if (permitted.length > 1) return {ok: false, reason: "ambiguous"};
    return judge(permitted[0]!);
}

/**
 * 按来源的一组：用户的、一个插件的、内置的。`key` 是 `user`、`plugin:<插件 id>` 或 `builtin`。插件的组带 `title`：插件的显示名，
 * 没有时是插件 id；两个插件显示名相同时后面加上插件 id 区分。用户与内置的组标题按界面语言由调用方给。
 */
export interface SkillGroup<Item> {
    readonly key: string;
    readonly source: SkillSource;
    /** 插件的组才有。 */
    readonly plugin?: SkillPluginRef;
    readonly title?: string;
    readonly items: readonly Item[];
}

/**
 * 按来源分组（skills.md 输出 25、34）：我的在前，然后每个插件一组（按显示名，没有的按插件 id），内置在后；空组不出。组里保持传入
 * 的先后。Skill 页与 Profile 设置的 Skill 一节共用。
 */
export function groupSkills<Item>(items: readonly Item[], entryOf: (item: Item) => SkillEntry): Array<SkillGroup<Item>> {
    const user: Item[] = [];
    const builtin: Item[] = [];
    const plugins = new Map<string, {readonly plugin: SkillPluginRef; readonly items: Item[]}>();
    for (const item of items) {
        const entry = entryOf(item);
        if (entry.source === "plugin") {
            const group = plugins.get(entry.plugin.id) ?? {plugin: entry.plugin, items: []};
            group.items.push(item);
            plugins.set(entry.plugin.id, group);
        } else if (entry.source === "user") user.push(item);
        else builtin.push(item);
    }
    const sorted = [...plugins.values()].sort((left, right) => skillPluginName(left.plugin).localeCompare(skillPluginName(right.plugin)) || left.plugin.id.localeCompare(right.plugin.id));
    const names = sorted.map(({plugin}) => skillPluginName(plugin));
    return [
        ...(user.length === 0 ? [] : [{key: "user", source: "user" as const, items: user}]),
        ...sorted.map(({plugin, items: grouped}, index) => ({
            key: `plugin:${plugin.id}`,
            source: "plugin" as const,
            plugin,
            title: names.filter((name) => name === names[index]).length > 1 ? `${names[index]!} · ${plugin.id}` : names[index]!,
            items: grouped,
        })),
        ...(builtin.length === 0 ? [] : [{key: "builtin", source: "builtin" as const, items: builtin}]),
    ];
}

/** 插件给人看的名字：显示名，没有时是插件 id（skills.md 输出 34）。服务端目录与界面的分组按它排。 */
export const skillPluginName = (plugin: SkillPluginRef): string => plugin.title ?? plugin.id;

/** 用户与内置来源的 id 前缀；插件来源的前缀是插件 id。 */
export const SKILL_ID_PREFIX: Readonly<Record<"builtin" | "user", string>> = {builtin: "builtin", user: "user"};

export const skillId = (prefix: string, name: string): string => `${prefix}.${name}`;
export const skillLocation = (id: string): string => `skills://${id}/SKILL.md`;
