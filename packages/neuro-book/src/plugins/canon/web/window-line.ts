/**
 * 窗口在看的线（docs/specs/canon/author-ui.md 输出 34）：整个窗口一个，空串是“按章节自动”（读取位置不写线），缺省按章节自动、不存盘。
 *
 * 本入口一直读着线表（同状态栏的“待处理 N”一直读着待处理）：可选的线是主线加实际模式下存在而且可建的线；选着的线不在了就回到
 * 按章节自动，并记下“丢了”，下一次打开选线时说一句。线表不列主线（主线由内核隐含），这里补在最前面。
 */

import {computed, shallowRef, watch} from "vue";
import type {ComputedRef, ShallowRef} from "vue";

import type {CanonOutputs} from "../shared/contracts";
import {MAIN_LINE} from "../shared/reads";
import type {LineOption} from "../shared/reads";
import type {CanonWorld} from "./world";

export type {LineOption} from "../shared/reads";
export {MAIN_LINE};

export interface WindowLine {
    /** 窗口在看的线的 id；空串是按章节自动。 */
    readonly line: Readonly<ShallowRef<string>>;
    /** 可选的线，主线在最前，其余按线的树先序。 */
    readonly options: ComputedRef<readonly LineOption[]>;
    /** 线表已经读到（状态栏条目据此显示）。 */
    readonly ready: ComputedRef<boolean>;
    /** 选着的线不在了、回到了按章节自动，还没在选线时说过。 */
    readonly lost: Readonly<ShallowRef<boolean>>;
    set(line: string): void;
    /** 选线的列表打开过了：“原来看的那条线已经不在了”说过一次就不再说。 */
    acknowledge(): void;
    release(): void;
}

type LineRow = CanonOutputs["lines"]["lines"][number];

/** 主线加实际模式下存在而且可建的线，按树先序；父线不可选的线也不列（它本来就读不到）。 */
export function lineOptions(lines: readonly LineRow[]): LineOption[] {
    const usable = lines.filter((line) => line.exists.actual && line.unbuildable === null);
    const children = new Map<string, LineRow[]>();
    for (const line of usable) {
        const siblings = children.get(line.parent) ?? [];
        siblings.push(line);
        children.set(line.parent, siblings);
    }
    const options: LineOption[] = [{id: MAIN_LINE, name: null, depth: 0}];
    const visit = (parent: string, depth: number): void => {
        for (const line of children.get(parent) ?? []) {
            options.push({id: line.id, name: line.name, depth});
            visit(line.id, depth + 1);
        }
    };
    visit(MAIN_LINE, 1);
    return options;
}

export function createWindowLine(world: CanonWorld | null): WindowLine {
    const line = shallowRef("");
    const lost = shallowRef(false);
    const read = world?.read("lines", {}) ?? null;
    const ready = computed(() => read?.state.value.data !== undefined);
    const options = computed<readonly LineOption[]>(() => lineOptions(read?.state.value.data?.lines ?? []));
    watch(options, (now) => {
        if (line.value !== "" && ready.value && !now.some((option) => option.id === line.value)) {
            line.value = "";
            lost.value = true;
        }
    });
    return {
        line,
        options,
        ready,
        lost,
        set: (next) => {
            line.value = next;
            lost.value = false;
        },
        acknowledge: () => {
            lost.value = false;
        },
        release: () => read?.release(),
    };
}
