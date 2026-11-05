import { Link } from "react-router-dom";
import { SUPPORT } from "../../shared/contact.ts";
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
          <h2>Customer service</h2>
          <ul>
            <li><a href={`tel:${SUPPORT.e164}`}>Call {SUPPORT.phone}</a></li>
            <li><a href={`sms:${SUPPORT.e164}`}>Text us</a></li>
          </ul>
        </div>
      </div>
      <div className="foot-bar">© {new Date().getFullYear()} Traffic36</div>
    </footer>
  );
}
