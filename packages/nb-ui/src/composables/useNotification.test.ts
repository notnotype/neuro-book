/**
 * 通知队列（`createNotificationQueue`）：自建队列互不干扰；进度与文字可更新；时长改变后重新计时；常驻不自动消失；
 * 详情原文的有无、截断与清除。
 * 计时用真实的短时长，等可观察的状态，不用假计时器。
 */

import {describe, expect, it, vi} from "vitest";

import {createNotificationQueue, hasNotificationDetail, NOTIFICATION_DETAIL_MAX_CHARS, useNotification} from "./useNotification";

const ids = (queue: ReturnType<typeof createNotificationQueue>): string[] => queue.notifications.value.map((item) => item.id);

describe("createNotificationQueue", () => {
    it("自建的队列与缺省队列互不干扰；缺省队列每次拿到同一份", () => {
        const own = createNotificationQueue();
        const shared = useNotification();
        const id = own.info("只在这份队列里");
        expect(ids(own)).toEqual([id]);
        expect(shared.notifications.value.some((item) => item.id === id)).toBe(false);
        expect(useNotification()).toBe(shared);
        own.clearAll();
    });

    it("update 改进度与文字；不存在的 id 忽略；不给 duration 时仍是常驻", () => {
        const queue = createNotificationQueue();
        const id = queue.notify({message: "正在统计", progress: null, duration: 0});
        queue.update(id, {progress: 40, message: "已统计 2 部"});
        expect(queue.notifications.value[0]).toMatchObject({id, progress: 40, message: "已统计 2 部", duration: 0});
        queue.update("nope", {progress: 100});
        expect(ids(queue)).toEqual([id]);
        queue.clearAll();
    });

    it("常驻通知改成限时后自动消失；限时通知改成常驻后留下", async () => {
        const queue = createNotificationQueue();
        const sticky = queue.notify({message: "任务进行中", duration: 0});
        // 它原来的时长比下面那条改出来的短：等那条消失时它早该到期了，还在就说明改成常驻真的取消了计时。
        const timed = queue.notify({message: "即将出错", duration: 20});
        queue.update(timed, {tone: "danger", duration: 0});
        queue.update(sticky, {message: "任务完成", tone: "success", duration: 40});
        await vi.waitFor(() => {
            expect(ids(queue)).toEqual([timed]);
        });
        queue.clearAll();
    });

    it("悬停中改时长只记到期时间、不到点移除，常驻的悬停中改成限时也一样；离开后按剩余时长继续", async () => {
        const queue = createNotificationQueue();
        const timed = queue.notify({message: "限时", duration: 20});
        const sticky = queue.notify({message: "常驻", duration: 0});
        queue.pause(timed);
        queue.pause(sticky);
        queue.update(timed, {duration: 20});
        queue.update(sticky, {tone: "success", duration: 20});
        // 参照比上面两条的新时长长：它消失时那两条要是在计时，早该没了。
        const witness = queue.notify({message: "参照", duration: 60});
        await vi.waitFor(() => {
            expect(ids(queue)).not.toContain(witness);
        });
        expect(ids(queue)).toEqual([timed, sticky]);
        queue.resume(timed);
        queue.resume(sticky);
        await vi.waitFor(() => {
            expect(ids(queue)).toEqual([]);
        }, {timeout: 3000});
        queue.clearAll();
    });

    it("色调决定缺省时长；error 与 warning 比 info 长", () => {
        const queue = createNotificationQueue();
        queue.info("一");
        queue.warning("二");
        queue.error("三");
        const [info, warning, error] = queue.notifications.value.map((item) => item.duration);
        expect(info).toBeLessThan(warning as number);
        expect(warning).toBeLessThan(error as number);
        queue.clearAll();
    });

    it("详情：空串与全空白等于没有；队列不按详情折算时长", () => {
        expect([undefined, "", "  \n\t ", "x"].map(hasNotificationDetail)).toEqual([false, false, false, true]);
        const queue = createNotificationQueue();
        queue.notify({message: "空白", detail: " \n "});
        queue.notify({message: "有详情", detail: "Error: EACCES"});
        const [blank, withDetail] = queue.notifications.value;
        expect(blank).not.toHaveProperty("detail");
        expect(blank).not.toHaveProperty("detailTruncated");
        expect(withDetail).toMatchObject({detail: "Error: EACCES", detailTruncated: false, duration: 3200});
        queue.clearAll();
    });

    it("超长详情截到上限并置 detailTruncated；不在代理对中间切开", () => {
        const queue = createNotificationQueue();
        const huge = queue.notify({message: "m", detail: "x".repeat(1_000_000), duration: 0});
        // 上限处正好是一个代理对的前半：整个字符往前退，不留孤立的高位代理。
        const emoji = queue.notify({message: "m", detail: `${"y".repeat(NOTIFICATION_DETAIL_MAX_CHARS - 1)}😀tail`, duration: 0});
        const item = (id: string) => queue.notifications.value.find((entry) => entry.id === id)!;
        expect(item(huge).detail).toHaveLength(NOTIFICATION_DETAIL_MAX_CHARS);
        expect(item(huge).detailTruncated).toBe(true);
        expect(item(emoji).detail).toBe("y".repeat(NOTIFICATION_DETAIL_MAX_CHARS - 1));
        expect(item(emoji).detailTruncated).toBe(true);
        // 发出方自己截过的，队列没截也保留标志。
        const upstream = queue.notify({message: "m", detail: "前 100 行", detailTruncated: true});
        expect(item(upstream).detailTruncated).toBe(true);
        queue.clearAll();
    });

    it("update 的详情：给新原文就换掉并重算截断；给空串清除；不给不动", () => {
        const queue = createNotificationQueue();
        const id = queue.notify({message: "m", detail: "x".repeat(NOTIFICATION_DETAIL_MAX_CHARS + 1), duration: 0});
        queue.update(id, {detail: "短原文"});
        expect(queue.notifications.value[0]).toMatchObject({detail: "短原文", detailTruncated: false});
        queue.update(id, {progress: 50});
        expect(queue.notifications.value[0]?.detail).toBe("短原文");
        queue.update(id, {detail: ""});
        expect(queue.notifications.value[0]).not.toHaveProperty("detail");
        expect(queue.notifications.value[0]).not.toHaveProperty("detailTruncated");
        queue.clearAll();
    });
});
