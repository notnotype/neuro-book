import {nextTick, ref} from "vue";
import {createSubmenuScheduler, measureCascadePanel} from "../components/feedback/menu-cascade";

export interface MenuCascadeLevel<T> {
    value: T;
    style: Record<string, string>;
    switching: boolean;
}

/** 三个菜单入口共用的持久子面板状态：同级替换、更深层级截断、关闭清空。 */
export function useMenuCascade<T>(): {
    levels: {value: MenuCascadeLevel<T>[]};
    panels: {value: Array<HTMLElement | null>};
    setPanel(depth: number, element: unknown): void;
    schedule(value: T | null, trigger: HTMLElement, depth: number, immediate: boolean, hasChildren: boolean): void;
    reset(): void;
} {
    const levels = ref<MenuCascadeLevel<T>[]>([]);
    const panels = ref<Array<HTMLElement | null>>([]);
    const openedPanels: Array<HTMLElement | null> = [];
    const scheduler = createSubmenuScheduler();
    async function open(value: T | null, trigger: HTMLElement, depth: number, hasChildren: boolean): Promise<void> {
        if (!hasChildren || value === null) {
            levels.value = levels.value.slice(0, depth);
            openedPanels.length = depth;
            return;
        }
        const switching = Boolean(levels.value[depth]);
        const previous = levels.value[depth]?.style ?? {};
        levels.value = [...levels.value.slice(0, depth), {value, style: previous, switching}];
        openedPanels.length = depth;
        await nextTick();
        const panel = openedPanels[depth];
        const measured = panel ? measureCascadePanel(trigger, panel) : null;

        if (!measured) {
            levels.value = levels.value.slice(0, depth);
            openedPanels.length = depth;
            return;
        }
        levels.value[depth] = {value, switching, style: {top: `${measured.y}px`, left: `${measured.x}px`, width: `${measured.width}px`, height: `${measured.height}px`}};
    }
    return {
        levels,
        panels,
        setPanel(depth, element) {
            const node = element && typeof element === "object" && "$el" in element ? element.$el : element;
            const panel = node && typeof node === "object" && "getBoundingClientRect" in node ? node as HTMLElement : null;
            panels.value[depth] = panel;
            openedPanels[depth] = panel;
        },
        schedule(value, trigger, depth, immediate, hasChildren) {
            scheduler.schedule(() => void open(value, trigger, depth, hasChildren), {immediate, hasOpenSibling: Boolean(levels.value[depth])});
        },
        reset() {
            scheduler.cancel();
            levels.value = [];
        },
    };
}
