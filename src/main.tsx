import { ViewStats } from "./lib/stats";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import "./lib/invite";
import { installImageFallback } from "./lib/demoArt";
import { registerServiceWorker } from "./lib/install";
import { AuthProvider } from "./lib/auth";
import { configured } from "./lib/supabase";
import { Layout, RequireAuth, Spinner, ToastProvider } from "./components/ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { HomeGate } from "./pages/owner/HomeGate";
import { OwnerManifest } from "./lib/ownerManifest";
import "./styles/responsive.css";
import { rememberSource } from "./lib/source";

// Customers download their current experience, rather than every owner/admin tool.
const Discover = lazy(() => import('./pages/Discover'));
const PlacePage = lazy(() => import('./pages/Place'));
const SignIn = lazy(() => import('./pages/SignIn'));
const Check = lazy(() => import('./pages/Check'));
const QrLanding = lazy(() => import('./pages/QrLanding'));
const Claim = lazy(() => import('./pages/Claim'));
const Review = lazy(() => import('./pages/Review'));
const Saved = lazy(() => import('./pages/Saved'));
const Person = lazy(() => import('./pages/Person'));
const Me = lazy(() => import('./pages/Me'));
const Picks = lazy(() => import('./pages/Picks'));
const Pocket = lazy(() => import('./pages/Pocket'));
const Business = lazy(() => import('./pages/Business'));
const BusinessSetup = lazy(() => import('./pages/BusinessSetup'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminPlace = lazy(() => import('./pages/AdminPlace'));
const Demo = lazy(() => import('./pages/Demo'));
const NotFound = lazy(() => import('./pages/NotFound'));
const OwnerApp = lazy(() => import('./pages/owner/OwnerApp'));
const OwnerStart = lazy(() => import('./pages/owner/OwnerStart'));
const ManageRedirect = lazy(() => import('./pages/owner/OwnerStart').then((m) => ({ default: m.ManageRedirect })));
const BestDish = lazy(() => import('./pages/BestDish'));
const Help = lazy(() => import('./pages/Help'));
const Contact = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Contact })));
const Pricing = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Pricing })));
const Privacy = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Privacy })));
const Refunds = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Refunds })));
const Terms = lazy(() => import('./pages/Legal').then((m) => ({ default: m.Terms })));

rememberSource();

function Setup() {
  return (
    <div className="app"><div className="page">
      <h1>Almost there</h1>
      <p className="muted">Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to your environment (Vercel: Project Settings, Environment Variables), then redeploy.</p>
    </div></div>
  );
}

// The app code loaded: the "didn't open" screen in index.html is no longer needed.
clearTimeout((window as Window & { __bootCheck?: number }).__bootCheck);
installImageFallback();
registerServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
    {!configured ? <Setup /> : (
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <ViewStats />
            <OwnerManifest />
            <Layout>
              <Suspense fallback={<div className="page" role="status" aria-label="Opening page"><Spinner /></div>}>
              <Routes>
                <Route path="/" element={<HomeGate><Discover /></HomeGate>} />
                <Route path="/p/:id" element={<PlacePage />} />
                <Route path="/best/:city/:dish" element={<BestDish />} />
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
                <Route path="/picks" element={<RequireAuth allowGuest><Picks /></RequireAuth>} />
                <Route path="/pocket" element={<RequireAuth allowGuest><Pocket /></RequireAuth>} />
                <Route path="/help/:placeId?" element={<RequireAuth guestOk><Help /></RequireAuth>} />
                <Route path="/business" element={<Business />} />
                <Route path="/business/setup" element={<RequireAuth><BusinessSetup /></RequireAuth>} />
                <Route path="/manage/:placeId" element={<ManageRedirect />} />
                <Route path="/owner" element={<RequireAuth><OwnerStart /></RequireAuth>} />
                <Route path="/owner/:placeId/:section?" element={<RequireAuth><OwnerApp /></RequireAuth>} />
                <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
                <Route path="/admin/place/:id" element={<RequireAuth admin><AdminPlace /></RequireAuth>} />
                <Route path="/claim/:placeId" element={<Claim />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/terms" element={<Terms />} />
                <Route path="/refunds" element={<Refunds />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/demo" element={<Demo />} />
                <Route path="/demo/:slug" element={<Demo />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
              </Suspense>
            </Layout>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    )}
    </ErrorBoundary>
  </StrictMode>,
);
