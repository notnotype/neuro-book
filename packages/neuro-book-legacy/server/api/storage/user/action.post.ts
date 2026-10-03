import {STORAGE_ACTION_BODY_LIMIT_BYTES} from "nbook/shared/storage/action";
import {withStorageHttpError} from "nbook/server/storage/http-error";
import {performStorageUserAction} from "nbook/server/storage/host";
import {readStorageActionRequest} from "nbook/server/storage/storage-actions";

/**
 * 在已核验的 user 访问下执行一次值动作：读取、条件保存、条件删除、显式迁移/修复与选定墓碑回收。
 *
 * 请求只提交动作、owner/key 与该操作的值或条件凭据；主体、客户端、存储根、scope 与校验策略
 * 由服务端拥有，请求体有界读取后按共享 DTO 解析。
 */
export default defineEventHandler(async (event) => withStorageHttpError(async () => {
    const action = await readStorageActionRequest(event, STORAGE_ACTION_BODY_LIMIT_BYTES);
    return await performStorageUserAction(event, action);
}));
