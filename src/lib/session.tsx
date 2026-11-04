import { ClerkProvider, useAuth, useClerk } from "@clerk/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Sign-in state for the whole app, with Clerk behind it. Pages talk to this, never to Clerk
 * directly, so the rest of the app reads the same whether Clerk is loading, signed out or in.
 */
export type Session = {
  status: "loading" | "signed-out" | "signed-in" | "unavailable";
  getToken(): Promise<string | null>;
  openSignIn(): void;
  signOut(): Promise<void>;
};

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const unavailable: Session = {
  status: "unavailable",
  getToken: async () => null,
  openSignIn: () => undefined,
  signOut: async () => undefined,
};

const SessionContext = createContext<Session>(unavailable);

export const useSession = () => useContext(SessionContext);

/** Clerk's sign-in screens, dressed in Traffic36's colors. */
const appearance = {
  variables: {
    colorPrimary: "#ff5a1f",
    colorPrimaryForeground: "#20140a",
    colorBackground: "#191919",
    colorForeground: "#f1efea",
    colorMuted: "#242320",
    colorMutedForeground: "#8a909e",
    colorInput: "#141310",
    colorInputForeground: "#f1efea",
    colorBorder: "#38352f",
    colorDanger: "#ff4133",
    colorSuccess: "#41cb8a",
    colorNeutral: "#f1efea",
    colorRing: "#ffc24b",
    colorModalBackdrop: "rgba(6, 7, 9, 0.72)",
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    borderRadius: "10px",
  },
};

function ClerkSession({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const clerk = useClerk();
  const value = useMemo<Session>(
    () => ({
      status: !isLoaded ? "loading" : isSignedIn ? "signed-in" : "signed-out",
      getToken: () => getToken(),
      openSignIn: () => clerk.openSignIn(),
      signOut: () => signOut(),
    }),
    [isLoaded, isSignedIn, getToken, signOut, clerk],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * Local QA only: `VITE_FAKE_SESSION=1 npm run dev` signs in a pretend user so screens can be
 * checked without reaching Clerk. `import.meta.env.DEV` is false in production builds, so this
 * branch is removed from the shipped bundle entirely.
 */
function FakeSession({ children }: { children: ReactNode }) {
  const value = useMemo<Session>(() => {
    const signedIn = localStorage.getItem("qa-signed-out") !== "1";
    return {
      status: signedIn ? "signed-in" : "signed-out",
      getToken: async () => (signedIn ? "qa-token" : null),
      openSignIn: () => {
        localStorage.removeItem("qa-signed-out");
        location.reload();
      },
      signOut: async () => {
        localStorage.setItem("qa-signed-out", "1");
        location.reload();
      },
    };
  }, []);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  if (import.meta.env.DEV && import.meta.env.VITE_FAKE_SESSION === "1") return <FakeSession>{children}</FakeSession>;
  if (!PUBLISHABLE_KEY) return <SessionContext.Provider value={unavailable}>{children}</SessionContext.Provider>;
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      appearance={appearance}
      afterSignOutUrl="/"
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
    >
      <ClerkSession>{children}</ClerkSession>
    </ClerkProvider>
  );
}

/** True when the real Clerk UI (avatar menu and so on) is on the page. */
export const clerkEnabled = () => !!PUBLISHABLE_KEY && !(import.meta.env.DEV && import.meta.env.VITE_FAKE_SESSION === "1");
