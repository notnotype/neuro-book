/**
 * `nbook.agent` 默认装上的扩展（docs/specs/agent/run-guards.md）：同样经 `agent.extensions` 交出，没有内部登记表
 * （ADR 0027）。设置是用户级的全局项，工厂闭包现读，不用扩展的 `settings` 字段：归约不读设置，所以不影响重放，也不进 Profile 哈希。
 */

import type {ContributionDeclaration} from "@notnotype/nb-runtime/plugins";
import type {SettingsService} from "nbook/shared/settings";

import {EXTENSIONS_POINT, type AgentExtensionDeclaration, type AgentExtensionImplementation} from "../../shared/points";
import {agentSettings} from "../../shared/settings";
import {costGuard} from "./cost-guard";
import {loopGuard} from "./loop-guard";

const COST_GUARD = "nbook.agent.cost-guard";
const LOOP_GUARD = "nbook.agent.loop-guard";

export const GUARD_CONTRIBUTIONS: ReadonlyArray<ContributionDeclaration<AgentExtensionDeclaration>> = [COST_GUARD, LOOP_GUARD].map((id) => ({capability: EXTENSIONS_POINT, id, declaration: {}}));

export function runGuards(settings: SettingsService): Readonly<Record<string, AgentExtensionImplementation>> {
    return {
        [COST_GUARD]: costGuard(() => ({warnCost: settings.get(agentSettings.settings.warnCost), maxCost: settings.get(agentSettings.settings.maxCost)})),
        [LOOP_GUARD]: loopGuard(() => settings.get(agentSettings.settings.toolLoopThreshold)),
    };
}
