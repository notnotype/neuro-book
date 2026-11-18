/**
 * 等一句话的去向（subagents.md 输出 10、harness/runtime.md 输出 110）：受理时去向是 `later` 的话，由正在收口的运行之后开的那次取走，
 * 或在收口批没开起运行时转成留着。先接上订阅再查 `inputFate`：查询与事件之间到达的结局不会漏掉。
 *
 * 事件只作“该重查了”的信号，结局以 `inputFate` 为准：收口批里推迟的话先随收口写 `inputHeld`、同一批里再被放行（`inputReleased`），
 * 只看事件会把它当成留着。`pending` 不是结局（收口批开的下一次运行先取别的话时，这句话还排着），等到下一次相关事件再查。
 */

import type {HeldCause, InputFate, Issuer} from "@notnotype/nb-harness/kernel/contracts";
import type {SessionTable} from "@notnotype/nb-harness/kit/sessions";

/** 结局：被哪次运行取走、为什么留着、为什么取消。 */
export type SettledFate = {readonly taken: string | null} | {readonly held: HeldCause} | {readonly removed: string};

export interface FateWatch {
    /** 有结局时完成；会话打不开或订阅断了时永不完成（等待方另有中止、超时与插话收口）。 */
    readonly settled: Promise<SettledFate>;
    release(): void;
}

/** 改变一句话去向的事件。 */
const FATE_EVENTS = new Set(["inputConsumed", "inputHeld", "inputReleased", "inputRemoved"]);

const settledOf = (fate: InputFate | null): SettledFate | null => (fate === null || "pending" in fate ? null : fate);

/** `failed`：事件触发的重查失败时调用（记诊断）；这次不定，等下一次事件或等待方的中止、超时与插话。 */
export async function watchFate(table: SessionTable, sessionId: string, inputId: string, issuer: Issuer, failed: (error: unknown) => void): Promise<FateWatch> {
    let settle!: (fate: SettledFate) => void;
    const settled = new Promise<SettledFate>((resolve) => {
        settle = resolve;
    });
    const view = table.view(sessionId, issuer);
    const check = async (): Promise<void> => {
        const now = settledOf(await view.inputFate({inputId}));
        if (now !== null) settle(now);
    };
    const subscribed = await table.subscribeOpened(sessionId, issuer, (frame) => {
        if (frame.type !== "log" || !FATE_EVENTS.has(frame.event.type)) return;
        const data = frame.event.data as {id?: string; ids?: readonly string[]};
        if (data.id !== inputId && data.ids?.includes(inputId) !== true) return;
        // 查询在这一批事件之后执行，看到的是整批写完的结果。
        check().catch(failed);
    });
    if (!subscribed.ok) return {settled, release: () => undefined};
    try {
        await check();
    } catch (error) {
        // 订阅持着会话的引用：查不了时先放掉，否则这个会话再也不会空闲关闭。
        subscribed.release();
        throw error;
    }
    return {settled, release: () => subscribed.release()};
}
