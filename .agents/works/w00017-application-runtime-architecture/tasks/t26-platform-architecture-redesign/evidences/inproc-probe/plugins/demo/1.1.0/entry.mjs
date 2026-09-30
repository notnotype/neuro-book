export async function activate(host) {
  const {payload, version} = await import("./chunk.mjs");            // 插件自己的懒加载分块
  host.register(() => `${version}:${payload.length}`);                 // 把实现交给宿主注册表
}
