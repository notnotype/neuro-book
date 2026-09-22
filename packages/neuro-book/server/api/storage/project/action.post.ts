import {STORAGE_ACTION_BODY_LIMIT_BYTES} from "nbook/shared/storage/action";
import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {withStorageHttpError} from "nbook/server/storage/http-error";
import {performStorageProjectAction} from "nbook/server/storage/host";
import {readStorageActionRequest} from "nbook/server/storage/storage-actions";

/**
 * 在已核验的 project 访问下执行一次值动作。
 *
 * 与 user 动作共用同一 DTO、注册定义与核心句柄；差别只在服务端按精确 ready 的 Project 目录解析分区根，
 * 每次请求都重新核验访问上下文与 Project 目录，动作登记在 Project 数据面内。
 */
export default defineEventHandler(async (event) => withStorageHttpError(async () => {
    const action = await readStorageActionRequest(event, STORAGE_ACTION_BODY_LIMIT_BYTES);
    return await withProjectHttpError(() => performStorageProjectAction(event, action));
}));
