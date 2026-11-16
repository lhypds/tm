import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "ress";
import "./global.css";
import "./i18n/index.js";
import App from "./App.jsx";

// cmd / ctrl + s never opens the browser's "save page" dialog: where there is something to save
// (a task's text, a file being edited) it saves that, and anywhere else it does nothing. The
// window hears the key last, after whatever handles it on the page.
window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") e.preventDefault();
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
