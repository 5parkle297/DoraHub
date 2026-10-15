/** AppCtx：连接状态 + WS 单例挂载（06 §3）。 */
import React, { createContext, useContext, useEffect, useState } from "react";
import { wsClient, type ConnState } from "../ws.ts";

interface AppCtxValue {
  connState: ConnState;
}

const AppCtx = createContext<AppCtxValue>({ connState: "connecting" });

export function useApp() {
  return useContext(AppCtx);
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [connState, setConnState] = useState<ConnState>(wsClient.state);

  useEffect(() => {
    const unsub = wsClient.subscribe({ onState: setConnState });
    wsClient.connect();
    return unsub;
  }, []);

  return <AppCtx.Provider value={{ connState }}>{children}</AppCtx.Provider>;
}
