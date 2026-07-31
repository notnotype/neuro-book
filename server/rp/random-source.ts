import {AsyncLocalStorage} from "node:async_hooks";
import {randomInt as cryptoRandomInt} from "node:crypto";

type RpRandomContext = {
    nextUint32: () => number;
};

const randomContext = new AsyncLocalStorage<RpRandomContext>();

/**
 * 返回 RP 规则层随机整数。正常游玩始终使用服务端 crypto RNG；测试作用域可注入可复现序列。
 * 单参数形式返回 [0, maxExclusive)，双参数形式返回 [minInclusive, maxExclusive)。
 */
export function rpRandomInt(maxExclusive: number): number;
export function rpRandomInt(minInclusive: number, maxExclusive: number): number;
export function rpRandomInt(first: number, second?: number): number {
    const min = second === undefined ? 0 : first;
    const max = second === undefined ? first : second;
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min) throw new Error("RP 随机范围必须是有效的安全整数区间。");
    const context = randomContext.getStore();
    if (!context) return cryptoRandomInt(min, max);
    return min + Math.floor(context.nextUint32() / 0x1_0000_0000 * (max - min));
}

/**
 * 仅供自动化测试建立固定随机作用域。AsyncLocalStorage 保证并发用例不会互相污染随机序列。
 */
export async function withRpTestRandomSeed<T>(seed: number, action: () => Promise<T>): Promise<T> {
    if (process.env.NODE_ENV !== "test") throw new Error("固定 RP 随机种子只允许在测试环境使用。");
    if (!Number.isSafeInteger(seed)) throw new Error("RP 测试随机种子必须是安全整数。");
    let state = seed >>> 0;
    const nextUint32 = (): number => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return (value ^ value >>> 14) >>> 0;
    };
    return randomContext.run({nextUint32}, action);
}
