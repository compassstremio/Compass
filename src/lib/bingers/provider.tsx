import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { subscribeSecretsReady } from "@/lib/secret-store";
import { checkAccount } from "./account";
import { pollForToken, requestDeviceCode, type PollHandle } from "./auth";
import { flushPendingWatches, recordWatch } from "./scrobble";
import { getAccess, getSession, setSession, subscribeSession } from "./session";
import type { PollResult } from "./tokens";
import type { BingersAccess, BingersSession, BingersTarget, DeviceCode } from "./types";

export type ConnectState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "awaiting"; device: DeviceCode }
  | { kind: "expired" }
  | { kind: "denied" }
  | { kind: "error"; message: string }
  | { kind: "success"; session: BingersSession };

type Value = {
  session: BingersSession | null;
  isConnected: boolean;
  access: BingersAccess;
  connectState: ConnectState;
  beginConnect: () => Promise<void>;
  cancelConnect: () => void;
  disconnect: () => void;
  recordWatch: (target: BingersTarget) => Promise<void>;
  refreshAccount: () => Promise<void>;
};

const Ctx = createContext<Value | null>(null);

export function BingersProvider({ children }: { children: ReactNode }) {
  const [session, setLocalSession] = useState<BingersSession | null>(() => getSession());
  const [access, setLocalAccess] = useState<BingersAccess>(() => getAccess());
  const [connectState, setConnectState] = useState<ConnectState>({ kind: "idle" });
  const pollHandleRef = useRef<PollHandle | null>(null);

  useEffect(() => {
    const sync = () => {
      setLocalSession(getSession());
      setLocalAccess(getAccess());
    };
    const unsubscribe = subscribeSession(sync);
    // The persisted store loads after this mounts; re-read once it is in memory.
    const unsubscribeReady = subscribeSecretsReady(sync);
    return () => {
      unsubscribe();
      unsubscribeReady();
    };
  }, []);

  useEffect(() => () => pollHandleRef.current?.cancel(), []);

  const beginConnect = useCallback(async () => {
    pollHandleRef.current?.cancel();
    setConnectState({ kind: "starting" });
    try {
      const device = await requestDeviceCode();
      setConnectState({ kind: "awaiting", device });
      pollHandleRef.current = pollForToken(device, (result: PollResult) => {
        if (result.kind === "authorized") {
          setSession(result.session);
          setConnectState({ kind: "success", session: result.session });
          void checkAccount();
        } else if (result.kind === "expired" || result.kind === "denied") {
          setConnectState({ kind: result.kind });
        } else if (result.kind === "error") {
          setConnectState({ kind: "error", message: result.message });
        }
      });
    } catch (e) {
      setConnectState({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to start authorization",
      });
    }
  }, []);

  const cancelConnect = useCallback(() => {
    pollHandleRef.current?.cancel();
    pollHandleRef.current = null;
    setConnectState({ kind: "idle" });
  }, []);

  // Bingers only revokes tokens for confidential clients, so a disconnect forgets the
  // grant here; the user removes Compass from their connected apps on bingers.app.
  const disconnect = useCallback(() => {
    pollHandleRef.current?.cancel();
    pollHandleRef.current = null;
    setSession(null);
    setConnectState({ kind: "idle" });
  }, []);

  const record = useCallback((target: BingersTarget) => recordWatch(target), []);
  const refreshAccount = useCallback(() => checkAccount(), []);

  const connectedAt = session?.connectedAt;
  useEffect(() => {
    if (connectedAt == null) return;
    void flushPendingWatches();
    const onOnline = () => void flushPendingWatches();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [connectedAt]);

  const value = useMemo<Value>(
    () => ({
      session,
      isConnected: !!session,
      access,
      connectState,
      beginConnect,
      cancelConnect,
      disconnect,
      recordWatch: record,
      refreshAccount,
    }),
    [
      session,
      access,
      connectState,
      beginConnect,
      cancelConnect,
      disconnect,
      record,
      refreshAccount,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBingers(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBingers outside BingersProvider");
  return v;
}
