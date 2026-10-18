import { Link } from "react-router-dom";
import { Icon, TopBar } from "../components/ui";
import { EmptyArt } from "../components/home/Kit";
import "../styles/home.css";

export default function NotFound() {
  return (
    <div className="page">
      <TopBar title="Not found" />
      <div className="card" style={{ margin: "auto 0" }}>
        <EmptyArt icon="compass" tone="sky" title="Page not found">
          <span className="small">The link may be old or mistyped.</span>
          <Link to="/" className="btn green small"><Icon name="home" size={16} />Home</Link>
        </EmptyArt>
      </div>
    </div>
  );
}
