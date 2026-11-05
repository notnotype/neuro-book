/**
 * `nbook.agent` 自己贡献的内置 Profile（docs/specs/agent/builtin-profiles.md）：同样经 `agent.profiles`，没有内部登记表（ADR 0027）。
 * 提供方是接收者所在的入口：入口活着时实现就已发布，不需要写 `onAgentProfile` 激活事件。
 */

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";

import {MAIN_PROFILE, SESSION_TITLE_PROFILE} from "../../../shared/contracts";
import {PROFILES_POINT} from "../../../shared/points";
import type {AgentProfileDeclaration, AgentProfileImplementation} from "../../../shared/points";

import {MAIN_DECLARATION, mainProfile} from "./main";
import {rulesOpening} from "./rules";
import {SESSION_TITLE_DECLARATION, sessionTitleProfile} from "./session-title";

const DECLARATIONS: Readonly<Record<string, AgentProfileDeclaration>> = {
    [MAIN_PROFILE]: MAIN_DECLARATION,
    [SESSION_TITLE_PROFILE]: SESSION_TITLE_DECLARATION,
};

export const BUILTIN_PROFILE_CONTRIBUTIONS: ReadonlyArray<ContributionDeclaration<AgentProfileDeclaration>> = Object.entries(DECLARATIONS).map(([id, declaration]) => ({capability: PROFILES_POINT, id, declaration}));

export function builtinProfiles(report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void): Readonly<Record<string, AgentProfileImplementation>> {
    return {
        [MAIN_PROFILE]: mainProfile(rulesOpening(report)),
        [SESSION_TITLE_PROFILE]: sessionTitleProfile(),
    };
}
