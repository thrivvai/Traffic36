import { UserButton } from "@clerk/react";
import { Link, NavLink } from "react-router-dom";
import { useAccount } from "../lib/account.tsx";
import { clerkEnabled, useSession } from "../lib/session.tsx";
import { Wordmark } from "./Wordmark.tsx";

export function Header() {
  const session = useSession();
  const { state } = useAccount();
  const isHost = state.status === "ready" && state.me.role === "host";

  return (
    <header className="topbar">
      <Link to="/" aria-label="Traffic36 home">
        <Wordmark />
      </Link>
      <nav className="topnav" aria-label="Main">
        <Link className="hide-sm" to="/#cars">Cars</Link>
        <Link className="hide-sm" to="/#how">How it works</Link>
        {session.status === "signed-in" && <NavLink to="/trips">Trips</NavLink>}
        {isHost && <NavLink to="/host">Host</NavLink>}
        {session.status === "signed-out" && (
          <button className="btn btn-ghost btn-sm" onClick={session.openSignIn}>Sign in</button>
        )}
        {session.status === "signed-in" &&
          (clerkEnabled() ? (
            <span className="avatar"><UserButton /></span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => void session.signOut()}>Sign out</button>
          ))}
      </nav>
    </header>
  );
}
