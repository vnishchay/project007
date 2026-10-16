import { Link } from "react-router-dom";
import { Icon } from "../components/ui";
import { EmptyArt } from "../components/home/Kit";
import "../styles/home.css";

export default function NotFound() {
  return (
    <div className="page" style={{ justifyContent: "center" }}>
      <div className="card">
        <EmptyArt icon="compass" tone="sky" title="Page not found">
          <span className="small">The link may be old or mistyped.</span>
          <Link to="/" className="btn green small"><Icon name="home" size={16} />Home</Link>
        </EmptyArt>
      </div>
    </div>
  );
}
