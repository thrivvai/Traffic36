import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Me, PaymentMethod } from "../../shared/types.ts";
import { accountApi, type AccountApi } from "./api.ts";
import { useSession } from "./session.tsx";

type MeState =
  | { status: "idle" } // signed out, or sign-in unavailable
  | { status: "loading" }
  | { status: "ready"; me: Me; paymentMethods: PaymentMethod[] }
  | { status: "error"; error: Error };

type Account = {
  api: AccountApi;
  state: MeState;
  /** Re-reads the profile. `quiet` keeps the current data on screen while it loads. */
  refresh(opts?: { quiet?: boolean }): Promise<Me | null>;
};

const AccountContext = createContext<Account | null>(null);

export function useAccount(): Account {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside <AccountProvider>");
  return ctx;
}

/** Loads the signed-in renter's profile once per visit, syncing name, email, phone and role from Clerk. */
export function AccountProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const api = useMemo(() => accountApi(session.getToken), [session.getToken]);
  const [state, setState] = useState<MeState>({ status: "idle" });

  const load = useCallback(
    async (opts: { sync?: boolean; quiet?: boolean } = {}) => {
      if (!opts.quiet) setState({ status: "loading" });
      try {
        const r = await api.me({ sync: opts.sync });
        setState({ status: "ready", me: r.me, paymentMethods: r.paymentMethods });
        return r.me;
      } catch (error) {
        if (!opts.quiet) setState({ status: "error", error: error as Error });
        return null;
      }
    },
    [api],
  );

  useEffect(() => {
    if (session.status === "signed-in") void load({ sync: true });
    else setState({ status: "idle" });
  }, [session.status, load]);

  const value = useMemo<Account>(() => ({ api, state, refresh: (opts) => load({ quiet: opts?.quiet }) }), [api, state, load]);
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
