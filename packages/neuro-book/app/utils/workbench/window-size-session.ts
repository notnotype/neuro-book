/**
 * 两个普通窗口尺寸（设置窗口、新建作品对话框）的 user/local 记录会话。
 *
 * 归属依据：`persistence.md:97`「书架显示模式、普通设置窗口尺寸」= user/local，与书架模式同 owner
 * （`workbench.layout`），各键独立寻址（定义见 `shared/storage/workbench-window-sizes.ts`）。
 * 旧实现直接在组件里读写裸键（`nbook.settingsDialog.size`、`nbook.projectCreateDialog.size.v2`），
 * 违反 `boundaries.md:103`；本模块是该记录的唯一写者，迁移为一次性（读旧键 → 记录缺失时条件初始化 →
 * 回读验证一致 → 删旧键；记录已有值时不被旧键覆盖）。
 *
 * 显示夹紧（最小尺寸）与存储无关：记录里保留用户拖出来的整数像素，显示按最小尺寸夹紧。
 */

import {computed, type Ref} from "vue";
import {
    createBrowserLegacyValueStore,
    type LegacyValueParse,
    type LegacyValueStore,
} from "nbook/app/utils/workbench/legacy-record-migration";
import type {LayoutRecordCommitResult, LayoutRecordIntent} from "nbook/app/utils/workbench/layout-session";
import {
    useUserRecordSession,
    type UserRecordSessionNotice,
} from "nbook/app/utils/workbench/user-record-session";
import type {WorkbenchStorageAdapters} from "nbook/app/utils/workbench/storage-context";
import type {DefinedStorageState} from "nbook/shared/storage/definition";
import {
    defineWorkbenchCreateProjectWindowSizeState,
    defineWorkbenchSettingsWindowSizeState,
    WORKBENCH_CREATE_PROJECT_WINDOW_MIN_SIZE,
    WORKBENCH_SETTINGS_WINDOW_MIN_SIZE,
    type WorkbenchWindowSize,
} from "nbook/shared/storage/workbench-window-sizes";

/** 旧实现直接读写的裸键；迁入记录并回读验证后删除。 */
export const LEGACY_SETTINGS_WINDOW_SIZE_KEY = "nbook.settingsDialog.size";
export const LEGACY_CREATE_PROJECT_WINDOW_SIZE_KEY = "nbook.projectCreateDialog.size.v2";

export type WorkbenchWindowSizeConsumer = {
    /** 当前显示：未确认意图优先，其次已确认值，再次产品默认；按窗口最小尺寸夹紧。 */
    readonly size: Readonly<Ref<WorkbenchWindowSize>>;
    readonly loading: Readonly<Ref<boolean>>;
    /** 未保存 / 不可写 / 旧键迁移未完成的诊断；`null` 表示当前没有要展示的问题。 */
    readonly notice: Readonly<Ref<UserRecordSessionNotice | null>>;
    commit(size: WorkbenchWindowSize): Promise<LayoutRecordCommitResult>;
    /** 与 `commit` 同一条回执通道：重试也要把真实结果交回调用方，不能只看「还挂着未确认」就当成功。 */
    retry(): Promise<LayoutRecordCommitResult>;
    abandon(): void;
    release(): Promise<void>;
};

export type WorkbenchWindowSizeOptions = {
    /** 测试注入的 Storage 适配器。 */
    readonly adapters?: WorkbenchStorageAdapters;
    /** 测试注入的旧键访问器。 */
    readonly legacy?: LegacyValueStore;
};

type WindowSizeRecord = {
    readonly definition: () => DefinedStorageState<WorkbenchWindowSize>;
    readonly minSize: WorkbenchWindowSize;
    /** 旧键名与旧记录在诊断里的叫法。 */
    readonly legacyKey: string;
    readonly legacyLabel: string;
};

const SETTINGS_WINDOW_SIZE_RECORD: WindowSizeRecord = {
    definition: defineWorkbenchSettingsWindowSizeState,
    minSize: WORKBENCH_SETTINGS_WINDOW_MIN_SIZE,
    legacyKey: LEGACY_SETTINGS_WINDOW_SIZE_KEY,
    legacyLabel: "旧设置窗口尺寸记录",
};

const CREATE_PROJECT_WINDOW_SIZE_RECORD: WindowSizeRecord = {
    definition: defineWorkbenchCreateProjectWindowSizeState,
    minSize: WORKBENCH_CREATE_PROJECT_WINDOW_MIN_SIZE,
    legacyKey: LEGACY_CREATE_PROJECT_WINDOW_SIZE_KEY,
    legacyLabel: "旧新建作品对话框尺寸记录",
};

/** 记录与显示共用的归一：整数像素，且不小于窗口最小尺寸。 */
export function normalizeWindowSize(size: WorkbenchWindowSize, minSize: WorkbenchWindowSize): WorkbenchWindowSize {
    return {
        width: Math.max(Math.round(size.width), minSize.width),
        height: Math.max(Math.round(size.height), minSize.height),
    };
}

/** 旧键原值的解析：非对象、宽高不是有限数字都算不可迁移，不当作"没有旧尺寸"。 */
export function parseLegacyWindowSize(raw: string, minSize: WorkbenchWindowSize): LegacyValueParse<WorkbenchWindowSize> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {value: null, diagnosis: "旧键内容不是合法 JSON"};
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return {value: null, diagnosis: "旧键内容不是窗口尺寸对象"};
    }
    const candidate = parsed as {readonly width?: unknown; readonly height?: unknown};
    const width = Number(candidate.width);
    const height = Number(candidate.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return {value: null, diagnosis: "旧键宽高不是有限数字"};
    }
    return {value: normalizeWindowSize({width, height}, minSize), diagnosis: null};
}

/** 主动尺寸合成到读取时的原件：与已确认值相同就不写盘；没有记录时按创建写。 */
function composeWindowSize(
    minSize: WorkbenchWindowSize,
    base: WorkbenchWindowSize | null,
    size: WorkbenchWindowSize,
): LayoutRecordIntent<WorkbenchWindowSize> {
    const value = normalizeWindowSize(size, minSize);
    const changed = base === null || base.width !== value.width || base.height !== value.height;
    return changed
        ? {value, changed: true, diagnosis: ""}
        : {value, changed: false, diagnosis: "窗口尺寸与已确认值相同，未写盘"};
}

function sameWindowSize(record: WorkbenchWindowSize, size: WorkbenchWindowSize): boolean {
    return record.width === size.width && record.height === size.height;
}

function useWorkbenchWindowSize(
    record: WindowSizeRecord,
    options: WorkbenchWindowSizeOptions,
): WorkbenchWindowSizeConsumer {
    const session = useUserRecordSession<WorkbenchWindowSize, WorkbenchWindowSize>({
        definition: record.definition,
        compose: (base, size) => composeWindowSize(record.minSize, base, size),
        ...(options.adapters === undefined ? {} : {adapters: options.adapters}),
        legacy: {
            store: options.legacy ?? createBrowserLegacyValueStore(record.legacyKey),
            label: record.legacyLabel,
            parse: (raw) => parseLegacyWindowSize(raw, record.minSize),
            // 窗口尺寸没有"空值"这种旧状态：任何旧尺寸都是用户的真实意图。
            isEmpty: () => false,
            same: sameWindowSize,
        },
    });
    return {
        size: computed(() => normalizeWindowSize(session.display.value, record.minSize)),
        loading: session.loading,
        notice: session.notice,
        commit: session.commit,
        retry: session.retry,
        abandon: session.abandon,
        release: session.release,
    };
}

/** 设置窗口尺寸记录会话（`workbench.layout`/`settings-dialog-size`）。 */
export function useSettingsWindowSize(options: WorkbenchWindowSizeOptions = {}): WorkbenchWindowSizeConsumer {
    return useWorkbenchWindowSize(SETTINGS_WINDOW_SIZE_RECORD, options);
}

/** 新建作品对话框尺寸记录会话（`workbench.layout`/`create-project-dialog-size`）。 */
export function useCreateProjectWindowSize(options: WorkbenchWindowSizeOptions = {}): WorkbenchWindowSizeConsumer {
    return useWorkbenchWindowSize(CREATE_PROJECT_WINDOW_SIZE_RECORD, options);
}
