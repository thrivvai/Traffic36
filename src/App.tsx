import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Footer } from "./components/Footer.tsx";
import { Header } from "./components/Header.tsx";
import { AgreementPage } from "./pages/AgreementPage.tsx";
import { CheckoutPage } from "./pages/CheckoutPage.tsx";
import { Home } from "./pages/Home.tsx";
import { HostArchivePage } from "./pages/HostArchivePage.tsx";
import { HostBookingPage } from "./pages/HostBookingPage.tsx";
import { HostPage } from "./pages/HostPage.tsx";
import { HostRenterPage } from "./pages/HostRenterPage.tsx";
import { HostRentersPage } from "./pages/HostRentersPage.tsx";
import { LicensePage } from "./pages/LicensePage.tsx";
import { NotFound } from "./pages/NotFound.tsx";
import { TripPage } from "./pages/TripPage.tsx";
import { TripsPage } from "./pages/TripsPage.tsx";
import { VehiclePage } from "./pages/VehiclePage.tsx";

export function App() {
  const { pathname, hash } = useLocation();
  // New page, back to the top. In-page anchors (#cars) are left to the browser.
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <Header />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cars/:slug" element={<VehiclePage />} />
          <Route path="/checkout/:slug" element={<CheckoutPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:code" element={<TripPage />} />
          <Route path="/host" element={<HostPage />} />
          <Route path="/host/renters" element={<HostRentersPage />} />
          <Route path="/host/renters/:id" element={<HostRenterPage />} />
          <Route path="/host/bookings/:code" element={<HostBookingPage />} />
          <Route path="/host/archive" element={<HostArchivePage />} />
          <Route path="/license" element={<LicensePage />} />
          <Route path="/agreement" element={<AgreementPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
