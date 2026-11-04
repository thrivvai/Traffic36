import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App.tsx";
import { AccountProvider } from "./lib/account.tsx";
import { SessionProvider } from "./lib/session.tsx";
import "./styles/app.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <AccountProvider>
          <App />
        </AccountProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
