import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import "./lib/invite";
import { installImageFallback } from "./lib/demoArt";
import { AuthProvider } from "./lib/auth";
import { configured } from "./lib/supabase";
import { Layout, RequireAuth, ToastProvider } from "./components/ui";
import Discover from "./pages/Discover";
import PlacePage from "./pages/Place";
import SignIn from "./pages/SignIn";
import Check from "./pages/Check";
import QrLanding from "./pages/QrLanding";
import { Contact, Pricing, Privacy, Refunds, Terms } from "./pages/Legal";
import Claim from "./pages/Claim";
import Review from "./pages/Review";
import Saved from "./pages/Saved";
import Person from "./pages/Person";
import Me from "./pages/Me";
import Business from "./pages/Business";
import BusinessSetup from "./pages/BusinessSetup";
import Admin from "./pages/Admin";
import AdminPlace from "./pages/AdminPlace";
import NotFound from "./pages/NotFound";
import Manage from "./pages/Manage";

function Setup() {
  return (
    <div className="app"><div className="page">
      <h1>Almost there</h1>
      <p className="muted">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to your environment (Vercel: Project Settings, Environment Variables), then redeploy.</p>
    </div></div>
  );
}

installImageFallback();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {!configured ? <Setup /> : (
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Layout>
              <Routes>
                <Route path="/" element={<Discover />} />
                <Route path="/p/:id" element={<PlacePage />} />
                <Route path="/q/:token" element={<QrLanding />} />
                <Route path="/r/:token" element={<QrLanding link />} />
                <Route path="/signin" element={<SignIn />} />
                <Route path="/check" element={<Check />} />
                {/* Customers scan table QRs with their phone camera; old in-app links go home. */}
                <Route path="/scan" element={<Navigate to="/" replace />} />
                <Route path="/rate" element={<Navigate to="/" replace />} />
                <Route path="/u/:id" element={<Person />} />
                <Route path="/review/:placeId" element={<Review />} />
                <Route path="/saved/:reviewId" element={<RequireAuth guestOk><Saved /></RequireAuth>} />
                <Route path="/circle" element={<Navigate to="/me" replace />} />
                <Route path="/me" element={<RequireAuth allowGuest><Me /></RequireAuth>} />
                <Route path="/business" element={<Business />} />
                <Route path="/business/setup" element={<RequireAuth><BusinessSetup /></RequireAuth>} />
                <Route path="/manage/:placeId" element={<RequireAuth><Manage /></RequireAuth>} />
                <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
                <Route path="/admin/place/:id" element={<RequireAuth admin><AdminPlace /></RequireAuth>} />
                <Route path="/claim/:placeId" element={<Claim />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/refunds" element={<Refunds />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    )}
  </StrictMode>,
);
