import { useEffect } from "react";
import { POLICY } from "../../shared/policy.ts";
import { money } from "../lib/format.ts";

/**
 * The rental agreement renters accept at checkout. DECISION: this is a working draft for a
 * lawyer to review. When the text changes, bump POLICY.agreementVersion so renters accept the
 * new version; each booking records the version it was made under.
 */
export function AgreementPage() {
  useEffect(() => {
    document.title = "Rental agreement | Traffic36";
  }, []);
  return (
    <div className="page narrow prose">
      <h1 className="page-title">Rental agreement</h1>
      <p className="fine left">Version {POLICY.agreementVersion}</p>

      <h2>The basics</h2>
      <p>
        This agreement is between you, the renter named on the booking, and Traffic36. It covers one trip: the car, dates and places
        shown on your booking. By booking, you agree to it.
      </p>

      <h2>Who can drive</h2>
      <ul>
        <li>Only you may drive the car. You must have verified your driver's license with us, and it must stay valid for the whole trip.</li>
        <li>You must meet the minimum age shown for the car on the pickup date.</li>
        <li>Carry your license whenever you drive.</li>
      </ul>

      <h2>Payment and deposit</h2>
      <ul>
        <li>You pay the full trip price, any delivery fee, and a {money(POLICY.depositCents)} refundable deposit before the trip. Your booking is confirmed only after we see your payment arrive.</li>
        <li>We return the deposit after your return check. We may keep part of it for fuel, cleaning or incidentals, and we'll tell you what it covered.</li>
        <li>Pay from an account in your own name, and put your booking code in the payment note.</li>
      </ul>

      <h2>Pickup and return</h2>
      <ul>
        <li>Pick up and return at the places and times on your booking. If you need more time, message us before your return time.</li>
        <li>Return the car with the fuel level you picked it up with, clean of trash, with the keys back in the lockbox or handed to us.</li>
        <li>Delivery is drop-off only. You return a delivered car to the location on your booking.</li>
      </ul>

      <h2>Using the car</h2>
      <ul>
        <li>No smoking or vaping in the car.</li>
        <li>
          You can drive for rideshare apps like Uber and Lyft. While you're logged into a rideshare app, that company's insurance covers the
          trip, and you're responsible for meeting its rules for drivers and vehicles.
        </li>
        <li>No food or package delivery or other paid driving, no racing, towing or off-road driving, and no driving outside the United States.</li>
        <li>Obey traffic laws. You're responsible for tickets, tolls and parking fees during your trip.</li>
      </ul>

      <h2>Insurance, damage and emergencies</h2>
      <ul>
        <li>Insurance is included with every trip through our commercial policy. Coverage terms are set by that policy.</li>
        <li>If there's an accident, theft or breakdown, make sure everyone is safe, call 911 if anyone is hurt, then report it to us right away.</li>
        <li>Report any damage you notice at pickup before you drive, so it isn't charged to you.</li>
      </ul>

      <h2>Cancelling</h2>
      <ul>
        <li>Before you pay, you can release your dates at any time from your trip page.</li>
        <li>After you pay, message us to cancel and we'll send your money back to the account you paid from.</li>
      </ul>

      <h2>Your information</h2>
      <p>
        We check your driver's license from the photos you send. We keep your name, date of birth, license state and expiry date, the
        photos of your license and your selfie, and your payment screenshots. Only Traffic36 can see them, and we use them only to
        check who's driving and to settle your trip.
      </p>

      <p className="fine left">Questions about this agreement: call or text (646) 397-3139</p>
    </div>
  );
}
