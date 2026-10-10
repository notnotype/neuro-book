/**
 * 把 Lab 的偏好 store 接到界面状态上（docs/specs/ui/component-lab.md 的“状态与转换”）。
 *
 * 记录读到结果（或失败已定）之前界面只显示占位；读到后一次性把记录里认识的字段放进界面状态。地址栏指定的主题与配色
 * 优先，但只作用于这个标签页、不写偏好：截图命令与分享出去的链接不该改掉使用者保存的主题。在界面上换主题或配色时，
 * 把画面上的两项一起写进偏好，地址里的就此作废。之后每个字段单独写：只写这一个字段，两个窗口同时改不同字段时互不
 * 覆盖。拖动侧栏时只改显示，松手才写。
 *
 * 另一个窗口保存的偏好不会改掉这个窗口正在显示的值：刷新或重新进入时才读到。
 */

import {computed, nextTick, ref, watch} from "vue";
import type {Ref} from "vue";

import {fieldProblem} from "nbook/shared/store/problem";

import {validLabPreferences} from "./lab-preferences-store";
import type {LabPanelSide, LabPreferenceCatalog, LabPreferences, LabStore} from "./lab-preferences-store";

type LabPreferenceRefs = {
    readonly themeId: Ref<string>;
    readonly colorwayId: Ref<string>;
    readonly pageBackdropId: Ref<string>;
    readonly canvasBackdropId: Ref<string>;
    readonly leftCollapsed: Ref<boolean>;
    readonly rightCollapsed: Ref<boolean>;
    /** 桌面侧栏的偏好开合；窄屏自动收起只改上面两个，不改这两个。 */
    readonly preferredLeftCollapsed: Ref<boolean>;
    readonly preferredRightCollapsed: Ref<boolean>;
    readonly leftPanelWidth: Ref<number>;
    readonly rightPanelWidth: Ref<number>;
};

type LabPreferenceDefaults = {
    readonly themeId: string;
    readonly colorwayId: string;
    readonly pageBackdropId: string;
    readonly canvasBackdropId: string;
    readonly leftPanelWidth: number;
    readonly rightPanelWidth: number;
};

type UseLabPreferencesOptions = {
    readonly store: LabStore;
    readonly catalog: LabPreferenceCatalog;
    readonly defaults: LabPreferenceDefaults;
    readonly state: LabPreferenceRefs;
    readonly hasCustomWallpaper: () => boolean;
    /** 地址栏指定的主题与配色：只作用于这个标签页。 */
    readonly requested: {readonly themeId?: string; readonly colorwayId?: string};
    /** 地址里的主题配色被界面上的选择取代时调用，由调用方把它们从地址栏去掉。 */
    readonly onLookAdopted?: () => void;
    /** 正在拖动侧栏边：宽度只改显示，松手后由 `commitPanelWidth` 写。 */
    readonly dragging: () => boolean;
};

export function useLabPreferences(options: UseLabPreferencesOptions) {
    const {store, state, defaults, catalog} = options;
    const field = store.state.preferences;
    /** 记录读到结果或失败已定：在此之前界面只显示占位，不先用默认主题画一帧。 */
    const ready = computed(() => field.ready);
    /** 正在把记录或默认值放进界面状态：期间的变化不是使用者的修改，不写回。 */
    const hydrating = ref(true);
    const problem = computed(() => fieldProblem(field));

    function apply(saved: LabPreferences): void {
        const allowed = (value: string | undefined, ids: readonly string[]): string | undefined => (value !== undefined && ids.includes(value) ? value : undefined);
        state.themeId.value = allowed(options.requested.themeId, catalog.themeIds) ?? saved.themeId ?? defaults.themeId;
        state.colorwayId.value = allowed(options.requested.colorwayId, catalog.colorwayIds) ?? saved.colorwayId ?? defaults.colorwayId;
        // 选了自定义桌面却没有图片（换了浏览器来源、被清掉）时回到默认桌面，不自动弹文件选择器。
        state.pageBackdropId.value = saved.pageBackdropId === "custom" && !options.hasCustomWallpaper() ? defaults.pageBackdropId : saved.pageBackdropId ?? defaults.pageBackdropId;
        state.canvasBackdropId.value = saved.canvasBackdropId ?? defaults.canvasBackdropId;
        state.preferredLeftCollapsed.value = saved.leftCollapsed ?? false;
        state.preferredRightCollapsed.value = saved.rightCollapsed ?? false;
        state.leftCollapsed.value = state.preferredLeftCollapsed.value;
        state.rightCollapsed.value = state.preferredRightCollapsed.value;
        state.leftPanelWidth.value = saved.leftPanelWidth ?? defaults.leftPanelWidth;
        state.rightPanelWidth.value = saved.rightPanelWidth ?? defaults.rightPanelWidth;
    }

    /** 放进界面状态，等这一轮 watch 跑过再放开写回。 */
    async function hydrate(saved: LabPreferences): Promise<void> {
        hydrating.value = true;
        apply(saved);
        await nextTick();
        hydrating.value = false;
    }

    let loaded = false;
    /** 画面上的主题配色来自地址栏，还没写进偏好。 */
    let lookFromAddress = false;
    watch(ready, async (isReady) => {
        if (!isReady || loaded) return;
        loaded = true;
        await hydrate(validLabPreferences(field.display, catalog));
        lookFromAddress = (options.requested.themeId !== undefined && state.themeId.value === options.requested.themeId)
            || (options.requested.colorwayId !== undefined && state.colorwayId.value === options.requested.colorwayId);
    }, {immediate: true});

    const fields: Array<[keyof LabPreferences, Ref<string | number | boolean>]> = [
        ["themeId", state.themeId],
        ["colorwayId", state.colorwayId],
        ["pageBackdropId", state.pageBackdropId],
        ["canvasBackdropId", state.canvasBackdropId],
        ["leftCollapsed", state.preferredLeftCollapsed],
        ["rightCollapsed", state.preferredRightCollapsed],
        ["leftPanelWidth", state.leftPanelWidth],
        ["rightPanelWidth", state.rightPanelWidth],
    ];
    for (const [key, source] of fields) {
        watch(source, (value) => {
            if (hydrating.value) return;
            if ((key === "leftPanelWidth" || key === "rightPanelWidth") && options.dragging()) return;
            if ((key === "themeId" || key === "colorwayId") && lookFromAddress) {
                lookFromAddress = false;
                store.actions.update({themeId: state.themeId.value, colorwayId: state.colorwayId.value});
                options.onLookAdopted?.();
                return;
            }
            store.actions.update({[key]: value});
        });
    }

    return {
        ready,
        hydrating,
        problem,
        /** 拖动侧栏松手时写入这一栏的宽度。 */
        commitPanelWidth: (side: LabPanelSide): void => {
            store.actions.update(side === "left" ? {leftPanelWidth: state.leftPanelWidth.value} : {rightPanelWidth: state.rightPanelWidth.value});
        },
        /** 恢复默认：记录写成空对象，界面回到默认值，再按窗口宽度收起侧栏。 */
        reset: async (applyResponsiveLayout: () => void): Promise<void> => {
            hydrating.value = true;
            apply({});
            applyResponsiveLayout();
            await nextTick();
            hydrating.value = false;
            await store.actions.resetDefaults();
        },
        /** 读取失败的重试成功后，把读到的偏好放进界面；保存失败的重试只补写，不改界面。 */
        retry: async (): Promise<void> => {
            const unread = problem.value?.kind === "unread";
            await store.actions.retry();
            if (unread && field.failure === null) await hydrate(validLabPreferences(field.display, catalog));
        },
        discard: async (): Promise<void> => {
            store.actions.discard();
            await hydrate(validLabPreferences(field.display, catalog));
        },
        setLeftCollapsed: (value: boolean): void => {
            state.leftCollapsed.value = value;
            state.preferredLeftCollapsed.value = value;
        },
        setRightCollapsed: (value: boolean): void => {
            state.rightCollapsed.value = value;
            state.preferredRightCollapsed.value = value;
        },
    };
}
