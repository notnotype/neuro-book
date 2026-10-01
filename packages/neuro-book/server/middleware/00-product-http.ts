import {defineEventHandler} from "h3";
import {currentProductRuntime} from "nbook/server/runtime/product-startup";

/** 首个中间件只借用宿主已建立的 HTTP 准入，不在请求或模块加载时启动产品。 */
export default defineEventHandler((event) => currentProductRuntime().http.admit(event));
