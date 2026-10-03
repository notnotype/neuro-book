/**
 * CodeAct 沙箱执行环境。
 *
 * 设计目标：
 * - 超时控制（默认 5s，可由调用方覆盖）
 * - 结果大小限制（10KB）
 * - 只暴露 world API 给查询代码
 *
 * 实现方案：
 * - 使用 Function() 构造安全的执行环境
 * - 使用 Promise.race() 实现超时
 * - 使用 JSON.stringify() 检查结果大小
 *
 * 已知限制（Phase 3 MVP）：
 * - ⚠️ 无法完全隔离全局对象（fetch / Bun / process 仍可访问）
 * - ⚠️ 无法防止死循环消耗 CPU（只能靠超时）
 * - ⚠️ 无法防止内存爆炸（构造巨大数组）
 * - ⚠️ Agent 可以写死循环拖慢系统
 *
 * 降级方案：如果 CodeAct 滥用严重，Phase 3+ 保留旧工具作为 fallback。
 */

export type WorldApi = {
    /** 时间与项目 Calendar 互转。 */
    time: {
        parse(calendarText: string): bigint;
        format(instant: bigint): string;
        now(): bigint;
    };
    /** Subject 状态读取与引用查询。 */
    subject: {
        get(id: string, options?: { deref?: boolean; derefDepth?: number }): Promise<any | null>;
        gets(ids: string[]): Promise<Array<any | null>>;
        list(type?: string): Promise<Array<{ id: string; type: string; name: string }>>;
        findRefs(targetId: string, sourceType?: string): Promise<Array<{ subjectId: string; attr: string }>>;
    };
    /** 语义搜索。 */
    search: {
        text(query: string, options?: { k?: number; threshold?: number; types?: string[]; attrs?: string[]; at?: bigint }): Promise<Array<{ subjectId: string; attr: string; text: string; score: number }>>;
    };
    /** Timeline slice 读取与可选写入能力。readonly 模式不注入写方法。 */
    slice: {
        list(options?: { from?: bigint; to?: bigint; limit?: number; withPatches?: boolean; subjectIds?: string[]; subjectMode?: "any" | "all" }): Promise<any[]>;
        get(id: string): Promise<any>;
        write?: (input: any) => Promise<{sliceId: string; issues: any[]}>;
        editPatches?: (sliceId: string, edits: any[], meta?: any) => Promise<{sliceId: string; issues: any[]}>;
        delete?: (sliceId: string) => Promise<{issues: any[]}>;
    };
};

export type ExecuteCodeActOptions = {
    /** 超时时间（毫秒），默认 5000ms */
    timeout?: number;
    /** 结果大小限制（字节），默认 10KB */
    maxResultSize?: number;
};

/**
 * 在沙箱中执行 CodeAct 查询代码。
 *
 * @param code - JavaScript 代码字符串
 * @param worldApi - World API 实现
 * @param options - 执行选项
 * @returns 执行结果（必须可 JSON 序列化）
 * @throws 如果代码执行失败、超时、或结果超限
 */
export async function executeCodeAct(
    code: string,
    worldApi: WorldApi,
    options: ExecuteCodeActOptions = {},
): Promise<any> {
    const timeout = options.timeout ?? 5000;
    const maxResultSize = options.maxResultSize ?? 10 * 1024;

    // 构造安全的执行函数
    // 不使用 with 语句，直接将 world 和安全对象作为参数传入
    const sandboxFn = new Function(
        "world",
        "Array",
        "Object",
        "String",
        "Number",
        "Boolean",
        "Math",
        "Date",
        "JSON",
        "console",
        `
        "use strict";

        // 检查危险 API 访问
        const checkAccess = (name) => {
            const blocked = ["fetch", "require", "import", "process", "fs", "eval", "Function", "Bun", "globalThis", "global", "window", "self"];
            if (blocked.includes(name)) {
                throw new Error(\`禁止访问: \${name}\`);
            }
        };

        return (async () => {
            ${code}
        })();
    `,
    );

    // 执行代码 + 超时控制
    const executePromise = sandboxFn(
        worldApi,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Math,
        Date,
        JSON,
        console,
    );

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`执行超时（${formatTimeout(timeout)} 限制）`)), timeout),
    );

    try {
        const result = await Promise.race([executePromise, timeoutPromise]);

        // 检查结果大小（BigInt 无法被 JSON.stringify，需 replacer 转字符串；
        // world.time.now() / world.slice.list() 的 instant 都是 BigInt）。返回值交由工具层归一化。
        const resultStr = JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value);
        if (resultStr.length > maxResultSize) {
            throw new Error(
                `查询结果超过 ${maxResultSize / 1024}KB 限制（实际：${(resultStr.length / 1024).toFixed(1)}KB）。` +
                    `考虑使用更具体的查询条件，或只返回需要的字段。`,
            );
        }

        return result;
    } catch (error) {
        // 重新抛出错误，保留原始错误信息
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
}

function formatTimeout(timeout: number): string {
    return timeout % 1000 === 0 ? `${timeout / 1000}s` : `${timeout}ms`;
}
