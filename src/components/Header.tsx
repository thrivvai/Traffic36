import { Link } from "react-router-dom";
import { Wordmark } from "./Wordmark.tsx";

export function Header() {
  return (
    <header className="topbar">
      <Link to="/" aria-label="Traffic36 home">
        <Wordmark />
      </Link>
      <nav className="topnav" aria-label="Main">
        <Link to="/#cars">Cars</Link>
        <Link to="/#how">How it works</Link>
      </nav>
    </header>
  );
}
