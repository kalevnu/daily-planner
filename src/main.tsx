import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import { BriefingWindow, NoteWindow, TodayStickyWindow } from "./ui/windows";
import { startBackground } from "./background";
import "pretendard/dist/web/static/pretendard.css";
import "./styles.css";

// Every window loads this same page; the hash decides what it shows.
//   #/briefing       morning briefing
//   #/today-sticky   today's tasks as a sticky
//   #/note/<id>      one sticky note
//   (anything else)  the main window, which also runs the background jobs
function Root() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash === "/briefing") return <BriefingWindow />;
  if (hash === "/today-sticky") return <TodayStickyWindow />;
  if (hash.startsWith("/note/")) return <NoteWindow id={hash.slice(6)} />;
  return <App />;
}

const hash = window.location.hash;
const isMain = !hash || hash === "#" || hash === "#/";
if (isMain) startBackground();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
