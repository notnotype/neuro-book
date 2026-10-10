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
    /** 偏好放进界面之后按窗口宽度重新收起侧栏：窄屏打开时，偏好里展开的侧栏不能盖掉自动收起。 */
    readonly applyResponsiveLayout: () => void;
};

export function useLabPreferences(options: UseLabPreferencesOptions) {
    const {store, state, defaults, catalog} = options;
    const field = store.state.preferences;
    /** 记录读到结果或失败已定：在此之前界面只显示占位，不先用默认主题画一帧。 */
    const ready = computed(() => field.ready);
    /** 第一次读到之前为 true：界面只显示占位。 */
    const hydrating = ref(true);
    /** 正在把记录、默认值或地址里的主题放进界面状态：期间的变化不是使用者的修改，不写回，也不触发“主题跟随配色”。 */
    let applying = false;
    const problem = computed(() => fieldProblem(field));
    const allowed = (value: string | undefined, ids: readonly string[]): string | undefined => (value !== undefined && ids.includes(value) ? value : undefined);

    /** 地址里此刻的主题与配色（认识的才算）；在界面上换过之后清空，地址里的已经作废。 */
    let addressLook: {themeId?: string; colorwayId?: string} = {
        ...(allowed(options.requested.themeId, catalog.themeIds) === undefined ? {} : {themeId: options.requested.themeId}),
        ...(allowed(options.requested.colorwayId, catalog.colorwayIds) === undefined ? {} : {colorwayId: options.requested.colorwayId}),
    };
    const lookFromAddress = (): boolean => addressLook.themeId !== undefined || addressLook.colorwayId !== undefined;

    function applyLook(saved: LabPreferences): void {
        state.themeId.value = addressLook.themeId ?? saved.themeId ?? defaults.themeId;
        state.colorwayId.value = addressLook.colorwayId ?? saved.colorwayId ?? defaults.colorwayId;
    }

    function apply(saved: LabPreferences): void {
        applyLook(saved);
        // 选了自定义桌面却没有图片（换了浏览器来源、被清掉）时回到默认桌面，不自动弹文件选择器。
        state.pageBackdropId.value = saved.pageBackdropId === "custom" && !options.hasCustomWallpaper() ? defaults.pageBackdropId : saved.pageBackdropId ?? defaults.pageBackdropId;
        state.canvasBackdropId.value = saved.canvasBackdropId ?? defaults.canvasBackdropId;
        state.preferredLeftCollapsed.value = saved.leftCollapsed ?? false;
        state.preferredRightCollapsed.value = saved.rightCollapsed ?? false;
        state.leftCollapsed.value = state.preferredLeftCollapsed.value;
        state.rightCollapsed.value = state.preferredRightCollapsed.value;
        state.leftPanelWidth.value = saved.leftPanelWidth ?? defaults.leftPanelWidth;
        state.rightPanelWidth.value = saved.rightPanelWidth ?? defaults.rightPanelWidth;
        options.applyResponsiveLayout();
    }

    /** 改界面状态但不写回：等这一轮 watch 跑过再放开。 */
    async function quietly(change: () => void): Promise<void> {
        applying = true;
        change();
        await nextTick();
        applying = false;
    }

    let loaded = false;
    watch(ready, async (isReady) => {
        if (!isReady || loaded) return;
        loaded = true;
        await quietly(() => apply(validLabPreferences(field.display, catalog)));
        hydrating.value = false;
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
            if (hydrating.value || applying) return;
            if ((key === "leftPanelWidth" || key === "rightPanelWidth") && options.dragging()) return;
            if ((key === "themeId" || key === "colorwayId") && lookFromAddress()) {
                addressLook = {};
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
        /** 正在把记录或地址放进界面：调用方据此跳过只该响应使用者修改的 watch。 */
        isApplying: (): boolean => hydrating.value || applying,
        /** 恢复默认：记录写成空对象，界面回到默认值（地址里的主题配色仍然优先），再按窗口宽度收起侧栏。 */
        reset: async (): Promise<void> => {
            await quietly(() => apply({}));
            await store.actions.resetDefaults();
        },
        /** 别处带来的地址（前进、后退、链接）：主题与配色按地址来、不写偏好；地址里没有时回到偏好。 */
        followAddress: async (look: {readonly themeId?: string; readonly colorwayId?: string}): Promise<void> => {
            addressLook = {
                ...(allowed(look.themeId, catalog.themeIds) === undefined ? {} : {themeId: look.themeId}),
                ...(allowed(look.colorwayId, catalog.colorwayIds) === undefined ? {} : {colorwayId: look.colorwayId}),
            };
            // 还没读到记录时，第一次读到会按这份地址处理。
            if (!loaded) return;
            await quietly(() => applyLook(validLabPreferences(field.display, catalog)));
        },
        /** 读取失败的重试成功后，把读到的偏好放进界面；保存失败的重试只补写，不改界面。 */
        retry: async (): Promise<void> => {
            const unread = problem.value?.kind === "unread";
            await store.actions.retry();
            if (unread && field.failure === null) await quietly(() => apply(validLabPreferences(field.display, catalog)));
        },
        discard: async (): Promise<void> => {
            store.actions.discard();
            await quietly(() => apply(validLabPreferences(field.display, catalog)));
        },
    };
}
