import type { ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useOwnerLanding } from "../../lib/ownerMode";
import { Spinner } from "../../components/ui";

/** "/" for a shop owner in owner mode is the owner app. Everyone else gets Discover. */
export function HomeGate({ children }: { children: ReactNode }) {
  const owner = useOwnerLanding();
  const [params] = useSearchParams();
  if (owner === null) return <div className="page"><Spinner /></div>;
  if (owner) return <Navigate to={`/owner${params.get("source") === "pwa" ? "?source=pwa" : ""}`} replace />;
  return <>{children}</>;
}
