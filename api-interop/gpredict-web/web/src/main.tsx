import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DetachedApp } from "./DetachedApp";
import { detachedPage, detachedUrl } from "./detach";
import "./styles.css";

// "/" is the main page; "/?module=<name>" the page of a module window (Detach module, spec §8.1)
const page = detachedPage(window.location.search);
// what Detach handed the window (handover.ts) is taken once: the address keeps only the module, so an F5 of the window starts as before
if (page !== null && page.handover !== null) window.history.replaceState(window.history.state, "", detachedUrl(page.module, page.restored));

createRoot(document.getElementById("root")!).render(
  <StrictMode>{page === null ? <App /> : <DetachedApp module={page.module} restored={page.restored} handover={page.handover} />}</StrictMode>,
);
