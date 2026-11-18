/** 协议版本不符的内核入口（backend/eval/kernel.test.ts）：握手时报一个宿主不认的版本，模拟升级后还在用旧入口。 */
process.on("message", (message: {type?: string}) => {
    if (message.type === "hello") process.send!({type: "ready", version: 999});
});
