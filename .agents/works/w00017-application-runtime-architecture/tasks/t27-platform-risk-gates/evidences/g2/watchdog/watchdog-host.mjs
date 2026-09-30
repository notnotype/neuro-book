// 主线程卡死看门狗原型（宿主侧）。
// 主线程只做两件事：按固定间隔递增共享内存心跳；在调用插件前后登记/清除在途调用槽位。
// 字符串（插件 id、方法名）经 postMessage 预先送给 worker，共享内存里只放编号，
// 因此主线程卡死后 worker 仍能把编号还原成可读报告。
import {Worker} from "node:worker_threads";

const SLOT_COUNT = 64;
const SLOT_INTS = 6; // state, pluginRef, kindRef, targetRef, callSeq, generation
const HEADER_INTS = 4; // beat, hostPhaseRef, syncOwnerSlot+1, overflow
export const CALL_KINDS = ["activate", "deactivate", "command", "export", "contribution", "channel-call", "channel-subscribe", "event"];

/**
 * @param {{
 *   thresholdMs: number, beatMs: number, checkMs: number, pauseGapMs?: number,
 *   reportPath: string, exitMethod: "ffi-exit" | "sigkill" | "none", exitCode?: number,
 *   leaseLockPath?: string, statsIntervalMs?: number
 * }} options
 */
export function startMainThreadWatchdog(options) {
    const ints = new Int32Array(new SharedArrayBuffer(4 * (HEADER_INTS + SLOT_COUNT * SLOT_INTS)));
    const times = new Float64Array(new SharedArrayBuffer(8 * (1 + SLOT_COUNT))); // [0] 最近心跳 epoch ms；[1+i] 槽位开始时间
    const worker = new Worker(new URL("./watchdog-worker.mjs", import.meta.url), {
        workerData: {
            ints: ints.buffer,
            times: times.buffer,
            slotCount: SLOT_COUNT,
            slotInts: SLOT_INTS,
            headerInts: HEADER_INTS,
            processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
            ...options,
            pauseGapMs: options.pauseGapMs ?? Math.max(3 * options.checkMs, 2_000),
        },
    });
    worker.unref();
    const strings = new Map();
    const intern = (value) => {
        let ref = strings.get(value);
        if (ref === undefined) {
            ref = strings.size + 1;
            strings.set(value, ref);
            worker.postMessage({type: "intern", ref, value});
        }
        return ref;
    };
    const beat = () => {
        times[0] = Date.now();
        Atomics.add(ints, 0, 1);
    };
    beat();
    const timer = setInterval(beat, options.beatMs);
    timer.unref();
    let seq = 0;
    return {
        worker,
        /** 调用插件前登记；返回的 token 交给 endCall。 */
        beginCall(plugin, kind, target) {
            const pluginRef = intern(`${plugin.id}@${plugin.version}`);
            const kindRef = CALL_KINDS.indexOf(kind) + 1;
            const targetRef = intern(target);
            for (let slot = 0; slot < SLOT_COUNT; slot++) {
                const base = HEADER_INTS + slot * SLOT_INTS;
                if (Atomics.compareExchange(ints, base, 0, 2) !== 0) continue; // 2 = 写入中
                ints[base + 1] = pluginRef;
                ints[base + 2] = kindRef;
                ints[base + 3] = targetRef;
                ints[base + 4] = ++seq;
                ints[base + 5] = plugin.generation ?? 0;
                times[1 + slot] = Date.now();
                Atomics.store(ints, base, 1);
                return slot;
            }
            Atomics.add(ints, 3, 1);
            return -1;
        },
        endCall(slot) {
            if (slot < 0) return;
            Atomics.store(ints, HEADER_INTS + slot * SLOT_INTS, 0);
        },
        /** 宿主同步调用插件处理函数期间标记“当前占用主线程的调用”。 */
        enterSync(slot) { Atomics.store(ints, 2, slot + 1); },
        exitSync() { Atomics.store(ints, 2, 0); },
        setHostPhase(phase) { Atomics.store(ints, 1, intern(`phase:${phase}`)); },
        /** 包装一次宿主对插件的调用：登记在途、标记同步段。 */
        async invoke(plugin, kind, target, fn) {
            const slot = this.beginCall(plugin, kind, target);
            let result;
            this.enterSync(slot);
            try {
                result = fn();
            } finally {
                this.exitSync();
            }
            try {
                return await result;
            } finally {
                this.endCall(slot);
            }
        },
        stats() {
            return new Promise((resolve) => {
                worker.once("message", resolve);
                worker.postMessage({type: "stats"});
            });
        },
        async stop() {
            clearInterval(timer);
            await worker.terminate();
        },
    };
}
