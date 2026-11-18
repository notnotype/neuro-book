/**
 * 显示两个底部视图的命令（commands.ts；docs/specs/canon/author-ui.md 命令表、输出 25、33）：`show-pending` 先展开“待处理”一组、
 * 选回它的第一条，再显示视图；`show-revisions` 只显示视图。命令服务换成记下调用的一份（只用到 `execute`），视图状态用真的。
 */

import {describe, expect, it} from "bun:test";

import {OPEN_VIEW_COMMAND} from "nbook/plugins/workbench/shared/contracts";

import {canonCommands, PENDING_VIEW, REVISIONS_VIEW, SHOW_PENDING_COMMAND, SHOW_REVISIONS_COMMAND} from "./commands";
import {pendingViewState, pickFirstPending} from "./pending-view";

function recording() {
    const executed: Array<{readonly id: string; readonly args: unknown}> = [];
    return {executed, commands: {execute: async (id: string, args: unknown) => {
        executed.push({id, args});
        return {ok: true as const, value: null};
    }}};
}

describe("显示底部视图的命令", () => {
    it("show-pending：收起的“待处理”一组展开、下一次读到时选回第一条，再显示待处理视图", async () => {
        const state = pendingViewState();
        state.expanded.value = ["hints"];
        state.pickFirst.value = false;
        state.selected.value = {group: "hints", key: "x", index: 0};
        const {executed, commands} = recording();
        const implementations = canonCommands(commands, {newEntry: () => undefined, pendingShown: () => pickFirstPending(state)});
        expect(await implementations[SHOW_PENDING_COMMAND]!.run({})).toEqual({ok: true, value: null});
        expect(state.expanded.value).toEqual(["pending", "hints"]);
        expect(state.pickFirst.value).toBe(true);
        expect(executed).toEqual([{id: OPEN_VIEW_COMMAND, args: {viewId: PENDING_VIEW}}]);
    });

    it("show-revisions 显示改动记录视图；窗口里没有命令服务时两条都得到 unavailable", async () => {
        const {executed, commands} = recording();
        const implementations = canonCommands(commands, {newEntry: () => undefined, pendingShown: () => undefined});
        await implementations[SHOW_REVISIONS_COMMAND]!.run({});
        expect(executed).toEqual([{id: OPEN_VIEW_COMMAND, args: {viewId: REVISIONS_VIEW}}]);

        const bare = canonCommands(null, {newEntry: () => undefined, pendingShown: () => undefined});
        expect(await bare[SHOW_PENDING_COMMAND]!.run({})).toMatchObject({ok: false, code: "unavailable"});
        expect(await bare[SHOW_REVISIONS_COMMAND]!.run({})).toMatchObject({ok: false, code: "unavailable"});
    });
});
