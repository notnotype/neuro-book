/**
 * Skill 不可用或上次初始化失败的原因写成给人看的文字（docs/specs/agent/skills.md 输出 2、3、32）。Skill 页与 Profile 设置的
 * Skill 一节共用：两处取文字的写法不同，各自把翻译函数交进来。
 */

import type {BoundText} from "nbook/shared/use-plugin-text";

import type zhCN from "../locales/zh-CN.json";
import type {SkillProblem} from "../shared/skills";

export function skillProblemText(problem: SkillProblem, text: BoundText<typeof zhCN>): string {
    switch (problem.code) {
        case "skill-md-missing": return text("skills.page.problem.skillMdMissing");
        case "nested": return text("skills.page.problem.nested", {directory: problem.directory});
        case "frontmatter-unreadable": return text("skills.page.problem.frontmatter", {detail: problem.detail});
        case "field-missing": return text("skills.page.problem.fieldMissing", {field: problem.field});
        case "field-invalid": return text("skills.page.problem.fieldInvalid", {field: problem.field});
        case "name-mismatch": return text("skills.page.problem.nameMismatch", {name: problem.name});
        case "symlink": return text("skills.page.problem.symlink");
        case "plugin-skill-unbuilt": return text("skills.page.problem.pluginSkillUnbuilt");
        case "install-failed": return text("skills.page.problem.installFailed");
        case "interrupted": return text("skills.page.problem.interrupted");
    }
}
