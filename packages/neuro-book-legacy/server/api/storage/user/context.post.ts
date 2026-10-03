import {withStorageHttpError} from "nbook/server/storage/http-error";
import {issueStorageUserContext} from "nbook/server/storage/host";

/**
 * 为当前浏览器客户端签发一次独立的 user 访问上下文。
 *
 * 定位凭证只从请求头读取；客户端身份不可持久恢复时前端不得调用这里冒充可恢复身份。
 */
export default defineEventHandler(async (event) => withStorageHttpError(() => issueStorageUserContext(event)));
