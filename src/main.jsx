import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import SEOAgent from "../seo-agent.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <SEOAgent />
  </StrictMode>
);
