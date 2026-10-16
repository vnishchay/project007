import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="page">
      <div className="empty">
        <h2>Page not found</h2>
        <p>The link may be old or mistyped.</p>
        <Link to="/" className="btn ghost">Go to Discover</Link>
      </div>
    </div>
  );
}
