import { useEffect } from "react";
import { Link } from "react-router-dom";

export function NotFound({ what = "page" }: { what?: "page" | "car" }) {
  useEffect(() => {
    document.title = "Not found | Traffic36";
  }, []);
  return (
    <div className="page empty">
      <h1>{what === "car" ? "That car isn't available" : "We can't find that page"}</h1>
      <p>{what === "car" ? "It may have been booked out or retired from the fleet." : "The link may be old or mistyped."}</p>
      <Link className="btn btn-heat" to="/#cars">See available cars</Link>
    </div>
  );
}
