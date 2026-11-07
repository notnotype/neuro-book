/**
 * 层级登记表（z-index.ts，规则见 docs/ui-development-spec.md 的“叠放层级”一节）：各档的先后与区间不重叠；组件里不写整页层级的
 * 字面量，只能从登记表取。组件内部的局部叠放（`z-10` 这类，不超过 50）不算。
 */
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

import {NB_DIALOG_WINDOW_LANE, NB_DIALOG_WINDOW_MAX_LANES, NB_DIALOG_WINDOW_Z_STEP, NB_MODAL_MAX_LAYERS, NB_MODAL_POPOVER_Z_INDEX, NB_MODAL_Z_STEP, NB_WINDOW_POPOVER_Z_INDEX, NB_Z_INDEX} from "./z-index";

function sourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
        else if (/\.(vue|ts|css)$/u.test(name) && !/\.test\.ts$/u.test(name)) files.push(path);
    }
    return files;
}

describe("层级登记表", () => {
    it("落点分区在落点提示之下", () => {
        expect(NB_Z_INDEX.dropSectors).toBeLessThan(NB_Z_INDEX.dropFeedback);
    });

    it("各档从低到高：页面浮层 < 拖影 < 浮动窗口各层（含自己的浮层） < 模态各层 < 模态里的浮层 < 通知 < 右键菜单 < 命令面板 < 检查框", () => {
        /** 最上面一条车道里第 5 层嵌套的窗口。 */
        const highestWindowLane = NB_Z_INDEX.dialogWindow + (NB_DIALOG_WINDOW_MAX_LANES - 1) * NB_DIALOG_WINDOW_LANE + 4 * NB_DIALOG_WINDOW_Z_STEP;
        const highestModal = NB_Z_INDEX.dialog + (NB_MODAL_MAX_LAYERS - 1) * NB_MODAL_Z_STEP;
        const order = [
            Math.max(NB_Z_INDEX.popover, NB_Z_INDEX.tooltip, NB_Z_INDEX.dropFeedback),
            NB_Z_INDEX.dragFeedback,
            NB_Z_INDEX.dialogWindow,
            highestWindowLane,
            NB_WINDOW_POPOVER_Z_INDEX,
            NB_Z_INDEX.dialog,
            highestModal,
            NB_MODAL_POPOVER_Z_INDEX,
            NB_Z_INDEX.notification,
            NB_Z_INDEX.contextMenu,
            NB_Z_INDEX.commandPalette,
            NB_Z_INDEX.inspectorProbe,
        ];
        for (let index = 1; index < order.length; index += 1) expect(order[index]).toBeGreaterThan(order[index - 1] as number);
    });

    it("组件与组合函数里没有大于 50 的 z-index 字面量（整页层级只从登记表取）", () => {
        const root = join(import.meta.dirname, "..");
        const offenders: string[] = [];
        const literal = /z-index:\s*(\d+)|zIndex:\s*(\d+)|\bz-\[(\d+)\]|(?<![-\w])z-(\d+)\b/gu;
        for (const file of [...sourceFiles(join(root, "components")), ...sourceFiles(join(root, "composables"))]) {
            readFileSync(file, "utf8").split("\n").forEach((line, index) => {
                for (const match of line.matchAll(literal)) {
                    const value = Number(match[1] ?? match[2] ?? match[3] ?? match[4]);
                    if (value > 50) offenders.push(`${file.slice(root.length + 1)}:${String(index + 1)} ${match[0]}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});
