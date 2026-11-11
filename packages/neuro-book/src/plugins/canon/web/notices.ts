/**
 * 保存后的提示（docs/specs/canon/author-ui.md 输出 18）：本窗口每次发布成功给一条，同一时间只有一条，新的顶掉旧的。窗口里一份，
 * 条目页挂着时显示在页面顶上，切到另一个条目页时它跟过去（各页读的是同一份）；点了关闭或有了新的提示之前一直在。
 */

import {shallowRef} from "vue";
import type {ShallowRef} from "vue";

export interface CanonNotice {
    /** 这次修订的 id：“看回执”打开它的回执页。 */
    readonly revision: string;
    readonly title: string;
}

export interface CanonNotices {
    readonly current: Readonly<ShallowRef<CanonNotice | null>>;
    show(notice: CanonNotice): void;
    dismiss(): void;
}

export function createNotices(): CanonNotices {
    const current = shallowRef<CanonNotice | null>(null);
    return {
        current,
        show: (notice) => {
            current.value = notice;
        },
        dismiss: () => {
            current.value = null;
        },
    };
}
