import {withStorageHttpError} from "nbook/server/storage/http-error";
import {releaseStorageUserContext} from "nbook/server/storage/host";

/** 释放当前浏览器客户端的 user 访问上下文；重复释放幂等成功，不删除 data 中的记录。 */
export default defineEventHandler(async (event) => withStorageHttpError(() => releaseStorageUserContext(event)));
