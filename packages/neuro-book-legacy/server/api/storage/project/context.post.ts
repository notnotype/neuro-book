import {withProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {withStorageHttpError} from "nbook/server/storage/http-error";
import {issueStorageProjectContext} from "nbook/server/storage/host";
import {readStorageProjectContextRequest} from "nbook/server/storage/storage-actions";

/**
 * 为精确 ready 的 Project 签发一次独立的 project 访问上下文。
 *
 * 请求只提交 projectRoot 与 publicId 作为代次定位；主体、客户端、存储根、身份域与 Project 目录有效
 * 都由服务端核验，旧代次与已关闭的 Project 不签发可写访问。
 * 参数读取的失败也经 Storage 投影，因此非法 body 与领域失败共用同一错误入口。
 */
export default defineEventHandler(async (event) => withStorageHttpError(async () => {
    const request = await readStorageProjectContextRequest(event);
    return await withProjectHttpError(() => issueStorageProjectContext(event, request));
}));
