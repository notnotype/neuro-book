/**
 * 保存后的提示（docs/specs/canon/author-ui.md 输出 18）：本窗口每次发布成功给一条，同一时间只有一条，新的顶掉旧的。
 *
 * 窗口里一份。条目页、回执页、变更详情页挂着时（页面标签只在前台时挂载，所以“挂着”就是“在前台”），提示显示在页面顶上，切到
 * 另一个这样的页面时它跟过去（各页读的是同一份）；点了关闭或有了新的提示之前一直在（“撤销”成功以后就是新的那一条）。没有这样的页面挂着时（例如在
 * 改动记录里还原，编辑区开着章节正文），提示是一条工作台通知，动作是“看回执”：工作台通知只有一个动作，“撤销”从回执页做
 * （与 Spec 的出入记在 t31 的待确认清单里）。窗口里没有工作台通知时，提示照样留在页面顶上那一份。
 */

import {onScopeDispose, shallowRef} from "vue";
import type {ShallowRef} from "vue";

import type {Notifications} from "nbook/plugins/workbench/shared/contracts";

import {canonText} from "../shared/text";
import type {RevertRequests} from "./revert";

export interface CanonNotice {
    /** 这次修订的 id：“看回执”打开它的回执页，“撤销”还原它。 */
    readonly revision: string;
    readonly title: string;
}

export interface CanonNotices {
    readonly current: Readonly<ShallowRef<CanonNotice | null>>;
    /** `page`：调用方随即打开一个条目页（新建条目），提示留给那一页，不看现在有没有页面挂着。 */
    show(notice: CanonNotice, options?: {readonly page?: boolean}): void;
    dismiss(): void;
    /** 三种页面挂上时调用，卸载时调用它返回的函数。 */
    attach(): () => void;
}

export interface NoticeRoutes {
    /** 工作台的通知；窗口里没有时为 null。 */
    readonly workbench: Pick<Notifications, "notify"> | null;
    /** 打开一次修订的回执页（工作台通知的动作）。 */
    readonly receipt: (revision: string) => void;
}

export function createNotices(routes: NoticeRoutes = {workbench: null, receipt: () => undefined}): CanonNotices {
    const current = shallowRef<CanonNotice | null>(null);
    let attached = 0;
    return {
        current,
        show: (notice, options) => {
            if (attached > 0 || routes.workbench === null || options?.page === true) {
                current.value = notice;
                return;
            }
            // 新的提示顶掉旧的：页面顶上那一条也不再留着。
            current.value = null;
            routes.workbench.notify({tone: "success", title: canonText("notice.label"), message: notice.title, action: {label: canonText("notice.receipt"), run: () => routes.receipt(notice.revision)}});
        },
        dismiss: () => {
            current.value = null;
        },
        attach: () => {
            attached += 1;
            let released = false;
            return () => {
                if (released) return;
                released = true;
                attached -= 1;
            };
        },
    };
}

/**
 * 三种页面的宿主在 setup 里调用：挂着就算这个页面在前台（向提示登记，作用域结束时撤掉）。返回页面顶上的提示要的两个动作：
 * “撤销”打开窗口里那一个还原对话框，关闭收起提示。
 *
 * 点“撤销”时提示先留着：还原成功后换成还原的那一条，取消则还在。这样焦点有地方回：对话框关闭时把焦点还给“撤销”按钮，
 * 按钮还在（成功时是同一条提示条换了标题）；先收起提示，键盘用户的焦点会掉到页面外。
 */
export function usePageNotice(notices: CanonNotices, revert: RevertRequests): {undo(notice: CanonNotice): void; close(): void} {
    onScopeDispose(notices.attach());
    return {
        undo: (notice) => revert.open(notice.revision, notice.title),
        close: () => notices.dismiss(),
    };
}
