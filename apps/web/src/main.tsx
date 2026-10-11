import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ContentPanel } from "@repo/ui/ContentPanel";
import "./index.css";
import { CodeScreen } from "./code/CodeScreen";
import { SessionScreen } from "./session/SessionScreen";
import { Sidebar } from "./sidebar/Sidebar";

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");

createRoot(root).render(
  <StrictMode>
    <div className="flex h-full">
      <Sidebar />
      <ContentPanel>
        <CodeScreen />
      </ContentPanel>
      <ContentPanel size="side">
        <SessionScreen />
      </ContentPanel>
    </div>
  </StrictMode>,
);
