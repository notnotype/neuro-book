/**
 * Lab 的界面偏好（docs/specs/ui/component-lab.md 的“状态与转换”与“副作用与数据”）：`nbook.storage` 的一条记录，
 * 经 store 读写。标签页自己的状态（组件、场景、画布、缩放、检视 tab）在地址栏，不在这里。
 *
 * 记录用 `shared` 而不是 `local`：`local` 按客户端身份分开，而客户端身份存在各浏览器来源自己的 localStorage 里，
 * 开发服务换个端口就是另一个身份、另一份偏好。Lab 是开发工具，同一状态根下共用一份就够。
 *
 * schema 只管结构。主题、配色、背景是否还在当前目录里、侧栏宽度是否在范围内，读出来之后逐字段核对：目录随已装的
 * 主题包变化，写进 schema 会让整条记录因为一个过时的主题 id 被判为损坏。
 */

import {Type} from "typebox";

import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";
import type {CommitResult} from "nbook/shared/store/store";

/**
 * 侧栏宽度的边界：拖拽与恢复共用同一组值，避免两处各夹一次。
 * 上限只守「另一栏与画布还站得住」以外的部分，真正的上限还要看窗口宽度（在 LabShell 里算）。
 */
export const LAB_PANEL_WIDTH_LIMITS = {
    left: {min: 220, max: 560},
    right: {min: 280, max: 720},
} as const;

export type LabPanelSide = keyof typeof LAB_PANEL_WIDTH_LIMITS;

export type LabPreferences = {
    readonly themeId?: string;
    readonly colorwayId?: string;
    readonly pageBackdropId?: string;
    readonly canvasBackdropId?: string;
    readonly leftCollapsed?: boolean;
    readonly rightCollapsed?: boolean;
    /** 左侧栏（组件树）宽度，px */
    readonly leftPanelWidth?: number;
    /** 右侧栏（检视）宽度，px */
    readonly rightPanelWidth?: number;
};

const Id = Type.String({maxLength: 100});
const PreferencesSchema = Type.Object({
    themeId: Type.Optional(Id),
    colorwayId: Type.Optional(Id),
    pageBackdropId: Type.Optional(Id),
    canvasBackdropId: Type.Optional(Id),
    leftCollapsed: Type.Optional(Type.Boolean()),
    rightCollapsed: Type.Optional(Type.Boolean()),
    leftPanelWidth: Type.Optional(Type.Integer()),
    rightPanelWidth: Type.Optional(Type.Integer()),
}, {additionalProperties: false});

export const LAB_PREFERENCES_RECORD = defineRecord({key: "lab.preferences", scope: "user", locality: "shared", version: 1, schema: PreferencesSchema});

export type LabPreferenceCatalog = {
    readonly themeIds: readonly string[];
    readonly colorwayIds: readonly string[];
    readonly canvasBackdropIds: readonly string[];
    readonly pageBackdropIds: readonly string[];
};

/** 只留下当前目录认识、宽度在范围内的字段；其余字段照常生效（验收 9）。 */
export function validLabPreferences(value: LabPreferences, catalog: LabPreferenceCatalog): LabPreferences {
    const within = (width: number | undefined, side: LabPanelSide): boolean =>
        width !== undefined && width >= LAB_PANEL_WIDTH_LIMITS[side].min && width <= LAB_PANEL_WIDTH_LIMITS[side].max;
    return {
        ...(value.themeId !== undefined && catalog.themeIds.includes(value.themeId) ? {themeId: value.themeId} : {}),
        ...(value.colorwayId !== undefined && catalog.colorwayIds.includes(value.colorwayId) ? {colorwayId: value.colorwayId} : {}),
        ...(value.pageBackdropId !== undefined && catalog.pageBackdropIds.includes(value.pageBackdropId) ? {pageBackdropId: value.pageBackdropId} : {}),
        ...(value.canvasBackdropId !== undefined && catalog.canvasBackdropIds.includes(value.canvasBackdropId) ? {canvasBackdropId: value.canvasBackdropId} : {}),
        ...(value.leftCollapsed === undefined ? {} : {leftCollapsed: value.leftCollapsed}),
        ...(value.rightCollapsed === undefined ? {} : {rightCollapsed: value.rightCollapsed}),
        ...(within(value.leftPanelWidth, "left") ? {leftPanelWidth: value.leftPanelWidth} : {}),
        ...(within(value.rightPanelWidth, "right") ? {rightPanelWidth: value.rightPanelWidth} : {}),
    };
}

/**
 * 修改按字段合并进记录：两个窗口同时改不同字段时，条件保存冲突后在新的记录上重放这次的字段，两边都留下（验收 20）。
 * 保存暂停（确定失败、结果未知）期间的修改只改显示、合并成一份，恢复后提交这一份，不在队列里堆一串过时的值。
 */
export const labStore = defineStore("lab", ({persist}) => {
    const preferences = persist(LAB_PREFERENCES_RECORD, {initial: {}});
    const paused = (): boolean => preferences.save.state === "failed" || preferences.save.state === "unknown";
    let held: LabPreferences = {};

    return {
        state: {preferences},
        actions: {
            update: (patch: LabPreferences): void => {
                if (paused()) {
                    held = {...held, ...patch};
                    preferences.show({...preferences.display, ...patch});
                    return;
                }
                void preferences.commit((current) => ({...current, ...patch}));
            },
            /**
             * 写成空对象：记录里没有的字段就是默认值。受保护（损坏、版本不认识）的记录也能这样覆盖，原件由 Storage 保留。
             * 保存暂停时先整条放弃暂停的旧修改：重置排在它们后面会一直等着，之后“放弃修改”还会连重置一起删掉。
             */
            resetDefaults: (): Promise<CommitResult> => {
                held = {};
                if (paused()) preferences.discardAll();
                return preferences.reset({});
            },
            /** 读取失败的先重新打开；暂停的保存重试；之后提交暂停期间合并下来的修改。 */
            retry: async (): Promise<void> => {
                if (preferences.failure !== null) await preferences.reopen();
                if (preferences.failure === null && paused()) await preferences.retry();
                if (paused() || Object.keys(held).length === 0) return;
                const patch = held;
                held = {};
                void preferences.commit((current) => ({...current, ...patch}));
            },
            /** 放弃没保存上的修改：显示回到已保存的值。 */
            discard: (): void => {
                held = {};
                if (paused()) preferences.discardAll();
            },
        },
    };
});

export type LabStore = ReturnType<typeof labStore.create>;
