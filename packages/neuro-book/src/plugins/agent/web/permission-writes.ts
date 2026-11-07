/**
 * 用户规则的写入（permissions.md 输出 22、23）：对话里的“以后都允许”和设置页都写同一个键。配置服务写成功才更新快照，一批审批在同一拍里
 * 追加两条时读到的是同一份旧列表，后写的会盖掉先写的：所以这里排成一个队，每次写都带上读到的值比较（`expect`）。
 */

import type {SettingsService, SettingWriteResult} from "nbook/shared/settings";

import type {Rule} from "../shared/permissions";
import {agentSettings} from "../shared/settings";
import {appendRules} from "./permission-rules";

export interface RulesWriter {
    /** 加到末尾。别处抢先写了（另一个窗口、设置文件）就按新值再合并一次。 */
    append(rules: readonly Rule[]): Promise<SettingWriteResult>;
    /** 设置页交来的整份列表。别处抢先写了就得 `conflict`、不写：这份列表是照着旧值改的，写下去会盖掉别处的改动。 */
    replace(rules: readonly Rule[]): Promise<SettingWriteResult>;
}

export function createRulesWriter(settings: SettingsService): RulesWriter {
    const setting = agentSettings.settings.permissionRules;
    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = (write: () => Promise<SettingWriteResult>): Promise<SettingWriteResult> => {
        const result = queue.then(write);
        queue = result.catch(() => undefined);
        return result;
    };
    const writeOnce = (edit: (current: readonly Rule[]) => readonly Rule[]): Promise<SettingWriteResult> => {
        const {value, user} = settings.inspect(setting);
        return settings.update(setting, edit(value as readonly Rule[]) as Rule[], {expect: {value: user.status === "ok" ? user.value : undefined}});
    };
    return {
        append: (rules) => enqueue(async () => {
            const first = await writeOnce((current) => appendRules(current, rules));
            return first.ok || first.code !== "conflict" ? first : writeOnce((current) => appendRules(current, rules));
        }),
        replace: (rules) => enqueue(() => writeOnce(() => rules)),
    };
}
