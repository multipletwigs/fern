import { LiveRpcs } from "@repo/api";
import { Layer } from "effect";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { AtomRpc } from "effect/reactivity";
import { Socket } from "effect/socket";

// The page's one WebSocket to the live streams, at /api/live on the page's origin: the Electron
// app's own server in production, Vite (proxying /api) in dev.
const liveUrl = () => {
  const url = new URL("/api/live", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
};

// Typed client for LiveRpcs. Call it with an RPC's tag and payload to get its stream.
export class LiveClient extends AtomRpc.Service<LiveClient>()(
  "web/LiveClient",
  {
    group: LiveRpcs,
    protocol: RpcClient.layerProtocolSocket({
      retryTransientErrors: true,
    }).pipe(
      Layer.provide([
        Socket.layerWebSocket(liveUrl()).pipe(
          Layer.provide(Socket.layerWebSocketConstructorGlobal),
        ),
        RpcSerialization.layerJson,
      ]),
    ),
  },
) {}
