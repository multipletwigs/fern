import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Sidebar } from "./sidebar/Sidebar";
import { Workspace } from "./workspace/Workspace";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <div className="flex h-full">
      <Sidebar />
      <Workspace />
    </div>
  </StrictMode>,
);
