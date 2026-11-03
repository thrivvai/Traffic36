import { Link } from "react-router-dom";
import { Wordmark } from "./Wordmark.tsx";

export function Footer() {
  return (
    <footer>
      <div className="foot">
        <div>
          <Wordmark />
          <p>Car rental with insurance included, weekly rates and contactless pickup.</p>
        </div>
        <div>
          <h2>Rent</h2>
          <ul>
            <li><Link to="/#cars">Cars</Link></li>
            <li><Link to="/#how">How it works</Link></li>
          </ul>
        </div>
        <div>
          <h2>Contact</h2>
          <ul>
            <li><a href="mailto:admin@traffic36.com">admin@traffic36.com</a></li>
          </ul>
        </div>
      </div>
      <div className="foot-bar">© {new Date().getFullYear()} Traffic36</div>
    </footer>
  );
}
