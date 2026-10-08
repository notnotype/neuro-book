/**
 * 插件描述：插件这个发布单位的身份、版本，以及它在哪些运行位置有入口。宿主按它决定在每个实例里装哪一侧的定义；
 * 内核不读它（docs/specs/runtime/plugins.md）。插件清单文件（docs/specs/runtime/plugin-manifest.md）实现后，这里由
 * 清单生成。
 *
 * 描述只引用内核的类型，不引用任何一侧的实现：产品清单（`src/manifest.ts`）只看这个文件。
 */

import type {PluginDescriptor} from "@notnotype/nb-runtime/plugins";

/** 报时：把宿主给的时钟包成一项共享服务，交给同一实例里的别的插件；只在服务端有入口。 */
export const descriptor: PluginDescriptor = {id: "example.clock", version: "0.1.0", locations: ["server"]};
