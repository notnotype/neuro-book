/**
 * Ctrl+滚轮的两种用途共用的零件：把滚轮累积成“换一档”的判定（桌面界面缩放、编辑器字号），与整数设置的防抖写回（编辑器字号）。
 * 这个文件在后端的类型检查范围里，没有 DOM 类型，只取用到的成员。
 */

import {shallowRef} from "@vue/reactivity";

import type {SettingDefinition, SettingsService} from "./settings";

/**
 * 滚轮累积满这么多才换一档，换档后清零（一次事件最多一档）：触控板的捏合会合成大量细小的 Ctrl+滚轮事件。`deltaY` 是 CSS 像素，
 * 页面缩放不是 100% 时一格普通滚轮小于 100（200% 时是 50），所以阈值取一格在页面最大缩放（200%）下的像素数：任何缩放下一格都换一档，
 * 又不会因为阈值更低而在 100% 时一格换两档（清零保证）。
 */
export const WHEEL_STEP = 50;

/** 滚轮换档的方向：向上滚（`deltaY` 为负）是 `in`（放大）。 */
export type WheelDirection = "in" | "out";

/** Ctrl+滚轮的累积：交回这次要换的方向，没满一档时为 null。换了方向先清零。 */
export function createWheelAccumulator(): (deltaY: number) => WheelDirection | null {
    let total = 0;
    return (deltaY) => {
        if (deltaY === 0) return null;
        if (Math.sign(deltaY) !== Math.sign(total)) total = 0;
        total += deltaY;
        if (Math.abs(total) < WHEEL_STEP) return null;
        total = 0;
        return deltaY < 0 ? "in" : "out";
    };
}

/** 写回的防抖时长。 */
export const STEPPED_WRITE_DELAY_MS = 300;

export interface SteppedSettingOptions {
    readonly settings: SettingsService;
    /** 只允许用户层的整数设置：写回用户层，项目层有值时有效值不会变，所以声明必须是 `layers: ["user"]`。 */
    readonly setting: SettingDefinition<number>;
    /** 缺省值：写回的值等于它时删掉用户层的键。 */
    readonly defaultValue: number;
    readonly min: number;
    readonly max: number;
    readonly schedule: (callback: () => void, ms: number) => () => void;
    /** 写回失败：`detail` 是原因。目标值已清掉，有效值回到配置服务里的值。 */
    readonly failed: (detail: string) => void;
    readonly delayMs?: number;
}

export interface SteppedSetting {
    /**
     * 防抖期间是目标值，其余是配置服务里的有效值。目标值是响应式的：在 `computed` 里读它，改一档立即重算，不必等写回。
     */
    current(): number;
    /** 从 `current()` 起算走 `delta` 档（不是从配置服务里的值：连滚几档不丢档），夹在范围内；没变就不动。 */
    step(delta: number): void;
    /** 还没写回的目标立即写，不等防抖。 */
    flush(): void;
    /** 先写回再取消计时；不再使用时调用。 */
    dispose(): void;
}

/**
 * 整数设置的“按档改、防抖写回”：同桌面界面缩放（`plugins/desktop/web/zoom.ts` 的 `createZoomController`）的做法，档位表换成
 * 一个整数范围。两处各留一份没有合并：缩放的档位表不是等距的、每次改档还要把目标值交给壳（`report`），合并要给这个函数加
 * 两个钩子，收益小于代价；改防抖里的竞态（写在途时又改档）时两处一起看。值等于缺省值时写 `undefined`（删掉用户层的键，回到缺省，而不是把缺省值写进文件）；写入不带 `expect`，别处在
 * 防抖期间改了同一项，以本窗口的目标为准（最后写者赢）。写成功时配置服务已同步应用，清掉目标不会让值回跳。
 */
export function createSteppedSetting(options: SteppedSettingOptions): SteppedSetting {
    const {settings, setting} = options;
    const target = shallowRef<number | null>(null);
    let cancel: (() => void) | null = null;
    const current = (): number => target.value ?? settings.get(setting);
    const write = async (): Promise<void> => {
        cancel = null;
        const wanted = target.value;
        if (wanted === null) return;
        let failure: string | null = null;
        try {
            const result = await settings.update(setting, wanted === options.defaultValue ? undefined : wanted, {layer: "user"});
            if (!result.ok) failure = result.detail;
        } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
        }
        // 写的过程中又改了档：那一次的防抖会再写，这次的结果不动目标。
        if (target.value !== wanted) return;
        target.value = null;
        if (failure !== null) options.failed(failure);
    };
    return {
        current,
        step(delta) {
            const from = current();
            const next = Math.min(options.max, Math.max(options.min, from + delta));
            if (next === from) return;
            target.value = next;
            cancel?.();
            cancel = options.schedule(() => void write(), options.delayMs ?? STEPPED_WRITE_DELAY_MS);
        },
        flush() {
            if (cancel === null) return;
            cancel();
            void write();
        },
        dispose() {
            if (cancel === null) return;
            cancel();
            cancel = null;
            void write();
        },
    };
}
