/**
 * 单写者队列（提案第 2 节“单写者”）：一个会话的写入只有一个顺序。
 *
 * 队列的一项是“一个写入批连同它引出的反应”。指令受理（校验加写事件）、`mount` 写的外部事实、反应的输出、
 * 运行循环的每一次写入都是独立的项。运行循环本身在队列之外：它每次要写日志时把写入交给队列并等它完成，
 * 模型流、工具执行、等用户都在队列之外等待，所以运行中的插话、改、删、应答不必等运行结束。
 * 中止不经队列：先触发信号，收口再作为一项写入。会让一项变长的是输入拦截链（在指令受理的那一项里跑）与反应的时限。
 */

export class WriteQueue {
    #tail: Promise<unknown> = Promise.resolve();
    #pending = 0;

    /** 排进队列；前一项（连同它的反应）完成或失败之后才开始。 */
    run<T>(item: () => Promise<T>): Promise<T> {
        this.#pending += 1;
        const result = this.#tail.then(item, item).finally(() => {
            this.#pending -= 1;
        });
        // 一项失败不挡后面的项：失败由 run 的调用方接住。
        this.#tail = result.catch(() => undefined);
        return result;
    }

    get busy(): boolean {
        return this.#pending > 0;
    }

    /** 等队列里此刻已有的项都完成。 */
    async drain(): Promise<void> {
        await this.#tail;
    }
}
