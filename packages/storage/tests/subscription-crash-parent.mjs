import { SubscriptionToolRpc } from "../src/subscription-tool-rpc.ts"

const home = process.argv[2]
if (!home || !process.send) throw new Error("Expected test home and IPC")
const rpc = new SubscriptionToolRpc(home)
await rpc.initialize()
const child = await rpc.request("test/pid", {})
process.send(child)
