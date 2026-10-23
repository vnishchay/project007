import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Inside /owner the page points at the owner app's own manifest, so "Add to home screen" there
 * installs a separate "Shop owner" icon that opens straight into the owner app.
 */
export function OwnerManifest() {
  const { pathname } = useLocation();
  const owner = pathname === "/owner" || pathname.startsWith("/owner/");
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const want = owner ? "/owner.webmanifest" : "/manifest.webmanifest";
    if (link && link.getAttribute("href") !== want) link.setAttribute("href", want);
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (theme) {
      if (!theme.dataset.diner) theme.dataset.diner = theme.content;
      theme.content = owner ? "#0f172a" : theme.dataset.diner;
    }
  }, [owner]);
  return null;
}
