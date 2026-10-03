import {createError} from "h3";

/**
 * Passport 凭据已失效（refresh 被吊销 / 授权被面板撤销 / 从未关联）。
 * 消费点必须把它转成「请重新关联」的用户可见状态，绝不静默重试（spec §11）。
 */
export class PassportUnlinkedError extends Error {
    constructor(message = "NeuroBook 账号未关联或授权已失效，请重新关联") {
        super(message);
        this.name = "PassportUnlinkedError";
    }
}

/**
 * 路由层包装：把 PassportUnlinkedError 统一转成 409 + code=passport_unlinked，
 * 前端据此清除关联态并提示重新关联。
 */
export async function wrapPassportErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (error) {
        if (error instanceof PassportUnlinkedError) {
            throw createError({statusCode: 409, message: error.message, data: {code: "passport_unlinked"}});
        }
        throw error;
    }
}
