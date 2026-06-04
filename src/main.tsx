import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Safely suppress benign Dev/HMR/Vite connection or WebSocket closed without opened rejections
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (reason) {
      const reasonStr = String(reason);
      if (
        reasonStr.includes("WebSocket") ||
        reasonStr.includes("websocket") ||
        reasonStr.includes("vite") ||
        reasonStr.includes("closed without opened")
      ) {
        event.preventDefault();
        console.warn("[Global Silenced Rejection]:", reasonStr);
      }
    }
  });

  window.addEventListener("error", (event) => {
    const msg = event.message || "";
    if (
      msg.includes("WebSocket") ||
      msg.includes("websocket") ||
      msg.includes("vite") ||
      msg.includes("closed without opened")
    ) {
      event.preventDefault();
      console.warn("[Global Silenced Error]:", msg);
    }
  }, true);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
