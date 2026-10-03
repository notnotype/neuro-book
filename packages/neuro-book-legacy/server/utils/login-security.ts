type LoginThrottleBucket = {
    windowStartedAt: number;
    failureCount: number;
    blockedUntil: number;
};

const loginThrottleBuckets = new Map<string, LoginThrottleBucket>();
const loginThrottleWindowMs = 10 * 60 * 1000;
const loginThrottleMaxFailures = 8;
const loginThrottleBlockMs = 5 * 60 * 1000;

/**
 * 登录失败统一提示，避免区分用户名不存在、用户禁用和密码错误。
 */
export const loginFailureMessage = "用户名或密码错误";

/**
 * 被限流后的统一提示。
 */
export const loginRateLimitedMessage = "登录尝试过于频繁，请稍后再试";

/**
 * 登录失败时使用的假密码哈希，用于降低用户名枚举的时序差异。
 */
export const loginDummyPasswordHash = `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`;

/**
 * 标准化登录限流键。
 */
function loginThrottleKeys(requestIp: string, username: string): string[] {
    const normalizedIp = requestIp.trim() || "unknown";
    const normalizedUsername = username.trim().toLocaleLowerCase();
    return [
        `ip:${normalizedIp}`,
        `account:${normalizedIp}:${normalizedUsername}`,
    ];
}

/**
 * 读取或重置限流窗口。
 */
function getLoginThrottleBucket(key: string, now: number): LoginThrottleBucket {
    const bucket = loginThrottleBuckets.get(key);
    if (!bucket || now - bucket.windowStartedAt > loginThrottleWindowMs) {
        const nextBucket = {
            windowStartedAt: now,
            failureCount: 0,
            blockedUntil: 0,
        };
        loginThrottleBuckets.set(key, nextBucket);
        return nextBucket;
    }
    return bucket;
}

/**
 * 检查当前登录请求是否已经被限流。
 */
export function assertLoginAttemptAllowed(requestIp: string, username: string, now = Date.now()): void {
    for (const key of loginThrottleKeys(requestIp, username)) {
        const bucket = getLoginThrottleBucket(key, now);
        if (bucket.blockedUntil > now) {
            throw createError({
                statusCode: 429,
                message: loginRateLimitedMessage,
            });
        }
    }
}

/**
 * 记录一次登录失败，达到阈值后短时间阻断同 IP 或同账号尝试。
 */
export function recordLoginFailure(requestIp: string, username: string, now = Date.now()): void {
    for (const key of loginThrottleKeys(requestIp, username)) {
        const bucket = getLoginThrottleBucket(key, now);
        bucket.failureCount += 1;
        if (bucket.failureCount >= loginThrottleMaxFailures) {
            bucket.blockedUntil = now + loginThrottleBlockMs;
        }
    }
}

/**
 * 登录成功后清理对应限流状态。
 */
export function clearLoginFailures(requestIp: string, username: string): void {
    for (const key of loginThrottleKeys(requestIp, username)) {
        loginThrottleBuckets.delete(key);
    }
}

/**
 * 测试用：清空内存限流状态。
 */
export function resetLoginSecurityState(): void {
    loginThrottleBuckets.clear();
}
