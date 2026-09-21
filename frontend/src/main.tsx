import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { FrontendApp } from "./FrontendApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <FrontendApp />
  </StrictMode>
);
