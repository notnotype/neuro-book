/**
 * 用户规则的写入（permissions.md 输出 22、23）：对话里的“以后都允许”和设置页都写同一个键，一批审批在同一拍里追加两条也不能互相盖掉，
 * 所以都走同一个写入队列（`setting-writes.ts`）。
 */

import type {SettingsService, SettingWriteResult} from "nbook/shared/settings";

import type {Rule} from "../shared/permissions";
import {agentSettings} from "../shared/settings";
import {appendRules} from "./permission-rules";
import {createSettingWriter} from "./setting-writes";

export interface RulesWriter {
    /** 加到末尾。别处抢先写了（另一个窗口、设置文件）就按新值再合并一次。 */
    append(rules: readonly Rule[]): Promise<SettingWriteResult>;
    /** 设置页交来的整份列表。别处抢先写了就得 `conflict`、不写：这份列表是照着旧值改的，写下去会盖掉别处的改动。 */
    replace(rules: readonly Rule[]): Promise<SettingWriteResult>;
}

export function createRulesWriter(settings: SettingsService): RulesWriter {
    const writer = createSettingWriter(settings, agentSettings.settings.permissionRules);
    return {
        append: (rules) => writer.edit((current) => appendRules(current, rules) as Rule[]),
        replace: (rules) => writer.replace(rules as Rule[]),
    };
}
