import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DetachedApp } from "./DetachedApp";
import { detachedPage } from "./detach";
import "./styles.css";

// "/" is the main page; "/?module=<name>" the page of a module window (Detach module, spec §8.1)
const page = detachedPage(window.location.search);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{page === null ? <App /> : <DetachedApp module={page.module} restored={page.restored} />}</StrictMode>,
);
