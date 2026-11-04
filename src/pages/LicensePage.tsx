import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon.tsx";
import { LicenseForm } from "../components/LicenseForm.tsx";
import { useAccount } from "../lib/account.tsx";
import { useSession } from "../lib/session.tsx";
import { SignInPrompt } from "./TripsPage.tsx";

/** Send or resend driver's license photos outside of checkout, for example after the host asks for new ones. */
export function LicensePage() {
  const session = useSession();
  const account = useAccount();
  const [fixing, setFixing] = useState(false);
  const status = account.state.status === "ready" ? account.state.me.identity.status : null;
  useEffect(() => setFixing(false), [status]);
  useEffect(() => {
    document.title = "Your driver's license | Traffic36";
  }, []);

  if (session.status === "signed-out") return <SignInPrompt what="your license" />;
  if (account.state.status !== "ready") return <div className="page narrow" aria-busy="true"><div className="skeleton" style={{ height: 420 }} /></div>;
  const me = account.state.me;
  const id = me.identity;

  return (
    <div className="page narrow">
      <Link className="crumb" to="/trips"><Icon name="arrowLeft" size={16} />Your trips</Link>
      <h1 className="page-title">Your driver's license</h1>
      {id.status === "verified" ? (
        <div className="panel ok"><h2><Icon name="check" size={18} />Approved</h2><p>Your license is approved. You're all set to book.</p></div>
      ) : id.status === "in_review" ? (
        <div className="panel"><h2><Icon name="clock" size={18} />Waiting for review</h2><p>We'll check your license along with your payment.</p>{!fixing && <button className="link muted" onClick={() => setFixing(true)}>Fix a photo or detail</button>}</div>
      ) : id.status === "failed" ? (
        <div className="note bad" role="alert"><Icon name="alert" size={16} /><span><b>We couldn't approve your license.</b> {id.failureReason}</span></div>
      ) : null}
      {(id.status === "none" || id.status === "failed" || id.status === "expired" || fixing) && (
        <div className="panel" style={{ marginTop: 14 }}>
          <LicenseForm me={me} />
        </div>
      )}
    </div>
  );
}
