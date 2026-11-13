/**
 * Skill 目录的合同（docs/specs/agent/skills.md）：目录条目、状态、原因与认标签的结果，前后端共用。原因是结构化的码，
 * 界面按码给文字；`detail` 只放能原样显示的事实（文件夹名、安装输出的最后几行）。
 */

export type SkillSource = "builtin" | "user";

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

/** 一条目录条目（skills.md 输出 1）。 */
export interface SkillEntry {
    /** `<来源前缀>.<name>`；来源以 `source` 为准，不从前缀推断。 */
    readonly id: string;
    /** 无效的 Skill 读不出 `name` 时是目录名。 */
    readonly name: string;
    /** 无效的 Skill 可能为空串。 */
    readonly description: string;
    readonly whenToUse?: string;
    readonly source: SkillSource;
    /** `skills://<id>/SKILL.md`。 */
    readonly location: string;
    readonly status: SkillStatus;
    readonly problem?: SkillProblem;
    readonly external?: SkillExternal;
    readonly license?: string;
    readonly metadata?: Readonly<Record<string, string>>;
}

/** 初始化之前交给用户确认的内容（skills.md 输出 18）；联网、不运行安装脚本对每个 Skill 都一样，由界面写明。 */
export type SkillInitPlan =
    /** 有 `bun.lock`：要装的包数，读不懂锁文件时为 null（“未知”）；直接依赖给确认框列出来。 */
    | {readonly lock: true; readonly packages: number | null; readonly dependencies: readonly string[]}
    /** 没有 `bun.lock`：直接依赖，安装时按最新版本解析并生成锁文件。 */
    | {readonly lock: false; readonly dependencies: readonly string[]};

/** `$` 标签没带上的原因（skills.md 输出 12）。 */
export type SkillMissingReason = "not-found" | "not-allowed" | "ambiguous" | "invalid" | "unreadable";

/** 各来源的 id 前缀。 */
export const SKILL_ID_PREFIX: Readonly<Record<SkillSource, string>> = {builtin: "builtin", user: "user"};

export const skillId = (source: SkillSource, name: string): string => `${SKILL_ID_PREFIX[source]}.${name}`;
export const skillLocation = (id: string): string => `skills://${id}/SKILL.md`;
