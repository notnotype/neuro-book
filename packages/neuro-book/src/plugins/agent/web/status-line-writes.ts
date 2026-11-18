/**
 * 状态栏设置的写入（conversation.md 输出 45、46）：右键菜单的勾选和设置页的勾选、排序都写同一个键，走同一个写入队列
 * （`setting-writes.ts`），连点几下也不会互相盖掉；每次对写的那一刻读到的值求改动，别处抢先写了就按新值再求一次。
 */

import {moveStatusItem, shiftStatusItem, toggleStatusItem} from "@notnotype/nb-agent-ui";
import type {StatusLineItem, StatusLineSetting, StatusLineSlot} from "@notnotype/nb-agent-ui";

import type {SettingsService, SettingWriteResult} from "nbook/shared/settings";

import {agentSettings} from "../shared/settings";
import {createSettingWriter} from "./setting-writes";

export interface StatusLineWriter {
    /** 勾选或取消一项。 */
    toggle(id: string): Promise<SettingWriteResult>;
    /** 把一项移到哪一边的第几位（可以换边）。 */
    move(id: string, to: StatusLineSlot): Promise<SettingWriteResult>;
    /** 上移（-1）、下移（+1）：在“左边接右边”这一串里挪一位，位置在写的那一刻按最新的次序算，同一项连点几下每次都挪一格。 */
    shift(id: string, delta: -1 | 1): Promise<SettingWriteResult>;
}

/** `catalog` 在写的那一刻取：插件的项随停用与启用变，不能在这里固定一份。 */
export function createStatusLineWriter(settings: SettingsService, catalog: () => readonly StatusLineItem[]): StatusLineWriter {
    const writer = createSettingWriter(settings, agentSettings.settings.statusLine);
    const edit = (change: (current: StatusLineSetting, items: readonly StatusLineItem[]) => StatusLineSetting) => writer.edit((current) => change(current as StatusLineSetting, catalog()) as never);
    return {
        toggle: (id) => edit((current, items) => toggleStatusItem(items, current, id)),
        move: (id, to) => edit((current, items) => moveStatusItem(items, current, id, to)),
        shift: (id, delta) => edit((current, items) => shiftStatusItem(items, current, id, delta)),
    };
}
