import {readAppLogStatus, type AppLogStatus} from "nbook/server/app-logs/logger";

/**
 * 返回错误报告日志目录状态。
 */
export default defineEventHandler(async (): Promise<AppLogStatus> => {
    return await readAppLogStatus();
});
