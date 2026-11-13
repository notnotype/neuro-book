/**
 * Skill 白名单的合成（docs/specs/agent/skills.md 的“输入与前置条件”与输出 8、场景 7）。
 */

import {describe, expect, test} from "bun:test";

import {MAIN_DECLARATION} from "./backend/builtin/profiles/main";
import {profileSkills} from "./shared/profile-skills";

const CATALOG = ["user.style-guide", "user.lore-check", "builtin.review"];

describe("Skill 白名单", () => {
    test("不声明、用户也没加：没有可用的 Skill；用户加了的才有", () => {
        expect(profileSkills(undefined, undefined, CATALOG)).toEqual([]);
        expect(profileSkills(undefined, {added: ["user.style-guide"], removed: []}, CATALOG)).toEqual(["user.style-guide"]);
    });

    test("主创声明全部：目录里的都能用，放进新的就多一个；用户去掉的不在里面（场景 7）", () => {
        expect(profileSkills(MAIN_DECLARATION.skills, undefined, CATALOG)).toEqual(CATALOG);
        expect(profileSkills(MAIN_DECLARATION.skills, undefined, [...CATALOG, "user.fresh"])).toContain("user.fresh");
        expect(profileSkills(MAIN_DECLARATION.skills, {added: [], removed: ["user.lore-check"]}, CATALOG)).toEqual(["user.style-guide", "builtin.review"]);
    });

    test("声明了几个：目录里已经没有的 id 照样留着（输出 8，由 $ 菜单与设置页按目录区分）", () => {
        expect(profileSkills({allowed: ["user.gone", "builtin.review"]}, {added: ["user.style-guide"], removed: []}, CATALOG)).toEqual(["user.gone", "builtin.review", "user.style-guide"]);
    });
});
