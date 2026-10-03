/**
 * 旧投影协议退役的受管资产路径（相对 `.nbook` 根）。
 *
 * 按 Agent 资产安装协议的迁移要求，这份名单由显式 legacy migration 一次性执行；
 * 迁移未在所有存量实例上完成前不得从代码删除。旧投影同步
 * （`novel-workspace.ts`）继续消费同一份数据，直到三类 Agent 包完全退出旧协议。
 */
export const LEGACY_TOMBSTONED_ASSET_PATHS: readonly string[] = [
    "templates/project-directory-templates/lorebook/context/director.md",
    "templates/project-directory-templates/lorebook/context/generated/.gitkeep",
    "templates/project-directory-templates/lorebook/context/leader.default.md",
    "templates/project-directory-templates/lorebook/context/simulator.leader.md",
    "templates/project-directory-templates/lorebook/context/writer.md",
    "templates/project-directory-templates/agent-context/director.md",
    "templates/project-directory-templates/agent-context/generated/.gitkeep",
    "templates/project-directory-templates/agent-context/leader.default.md",
    "templates/project-directory-templates/agent-context/rp.writer.md",
    "templates/project-directory-templates/agent-context/simulator.leader.md",
    "templates/project-directory-templates/agent-context/writer.md",
    "templates/project-directory-templates/simulation/cast.yaml",
    "templates/project-directory-templates/simulation/config.yaml",
    "templates/project-directory-templates/simulation/simulator.md",
    "templates/project-directory-templates/simulation/writer.md",
    "templates/project-directory-templates/PROJECT-STATUS.md",
    "templates/project-directory-templates/world-engine/calendar.yaml",
    "templates/project-directory-templates/lorebook/rule/writing-style/index.md",
    "templates/project-directory-templates/lorebook/rule/creation-boundaries/index.md",
    "templates/project-directory-templates/lorebook/note/project-positioning/index.md",
    "templates/project-directory-templates/lorebook/note/synopsis/index.md",
    "templates/project-directory-templates/lorebook/note/theme/index.md",
    "templates/project-directory-templates/lorebook/note/initial-plot-seed/index.md",
    "agent/skills/llmlint/src/legacy-import.ts",
    "agent/skills/llmlint/rulesets/builtin/default/rules.json",
];

export const LEGACY_TOMBSTONED_ASSET_PREFIXES: readonly string[] = [
    "agent/skills/anti-ai-slop/",
    "agent/skills/llmlint/.git/",
    "agent/skills/llmlint/evals/",
    "agent/skills/llmlint/presets/",
    "agent/skills/llmlint/rulesets/builtin/anti-ai-slop/",
    "agent/skills/llmlint/rulesets/builtin/cn/",
    "agent/skills/llmlint/rulesets/builtin/cn-light/",
    "agent/skills/llmlint/rulesets/builtin/cn-standard/",
    "agent/skills/llmlint/rulesets/builtin/cn-strong/",
    "agent/skills/llmlint/rulesets/builtin/cn-extreme/",
    "templates/project-directory-templates/simulation/",
];

export const LEGACY_HARD_CUT_TOMBSTONED_PREFIXES: readonly string[] = [
    "agent/skills/llmlint/.git/",
    "agent/skills/llmlint/evals/",
    "agent/skills/llmlint/presets/",
    "agent/skills/llmlint/rulesets/builtin/anti-ai-slop/",
    "agent/skills/llmlint/rulesets/builtin/cn/",
    "agent/skills/llmlint/rulesets/builtin/cn-light/",
    "agent/skills/llmlint/rulesets/builtin/cn-standard/",
    "agent/skills/llmlint/rulesets/builtin/cn-strong/",
    "agent/skills/llmlint/rulesets/builtin/cn-extreme/",
];

export const LEGACY_HARD_CUT_TOMBSTONED_PATHS: readonly string[] = [
    "agent/scripts/profile.ts",
    "agent/scripts/variable.ts",
    "agent/scripts/workspace.ts",
    "agent/skills/llmlint/.gitignore",
];

export const LEGACY_STALE_TOMBSTONED_PREFIXES: readonly string[] = [
    "agent/skills/llmlint/rulesets/builtin/default/rules/",
];
