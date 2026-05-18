import { StrictMode }  from "react";
import { createRoot }  from "react-dom/client";
import "./index.css";

// Route: /?render=1 loads RenderApp (Python pipeline target)
//        everything else loads the normal dev App
const isRenderMode = new URLSearchParams(window.location.search).get("render") === "1";

if (isRenderMode) {
  const { default: RenderApp } = await import("./RenderApp.jsx");
  createRoot(document.getElementById("root")).render(
    <StrictMode><RenderApp /></StrictMode>
  );
} else {
  const { default: App } = await import("./App.jsx");
  createRoot(document.getElementById("root")).render(
    <StrictMode><App /></StrictMode>
  );
}