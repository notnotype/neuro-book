const lowerChars = "abcdefghijkmnopqrstuvwxyz";
const upperChars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const digitChars = "23456789";
const symbolChars = "!@#$%^&*_-+=?";
const passwordPools = [lowerChars, upperChars, digitChars, symbolChars];
const combinedPasswordChars = passwordPools.join("");

/**
 * 从浏览器安全随机源里取一个整数。
 */
function randomIndex(maxExclusive: number): number {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return (values[0] ?? 0) % maxExclusive;
}

/**
 * 从指定字符池里取一个随机字符。
 */
function pickChar(chars: string): string {
    return chars[randomIndex(chars.length)] ?? chars[0] ?? "";
}

/**
 * 生成包含大小写、数字和符号的复杂密码。
 */
export function generateComplexPassword(length = 20): string {
    const safeLength = Math.max(length, passwordPools.length);
    const chars = passwordPools.map((pool) => pickChar(pool));
    while (chars.length < safeLength) {
        chars.push(pickChar(combinedPasswordChars));
    }

    for (let index = chars.length - 1; index > 0; index -= 1) {
        const swapIndex = randomIndex(index + 1);
        [chars[index], chars[swapIndex]] = [chars[swapIndex] ?? "", chars[index] ?? ""];
    }

    return chars.join("");
}
