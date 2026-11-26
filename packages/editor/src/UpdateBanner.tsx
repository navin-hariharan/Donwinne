import React, { useEffect, useState } from "react";
import { desktop, type UpdateAction, type UpdateStatus } from "./platform";

/**
 * The desktop app's update banner: a new version to download (when updates ask first), its download
 * progress, "restart to update" once it's ready, or where to get it when installing failed. The web
 * app has no updater (its service worker refreshes it), so nothing shows there.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    const d = desktop();
    if (!d?.onUpdate) return;
    return d.onUpdate((s) => {
      setStatus(s);
      // A new state (or a menu check showing the same one again) brings the banner back.
      setDismissed(null);
    });
  }, []);

  const key = JSON.stringify(status.state === "downloading" ? { ...status, percent: 0 } : status);
  if (status.state === "idle" || (status.state === "downloading" && status.quiet) || dismissed === key) return null;

  const act = (action: UpdateAction) => desktop()?.updateAction?.(action);
  const later = () => {
    act("later");
    setDismissed(key);
  };

  let text: React.ReactNode;
  let buttons: React.ReactNode;
  switch (status.state) {
    case "available":
      text = (
        <>
          <strong>Donwinne {status.version}</strong> is available.
        </>
      );
      buttons = (
        <>
          <button className="primary" onClick={() => act("download")}>
            Download and Install
          </button>
          <button onClick={() => act("open-page")}>What's New</button>
          <button onClick={later}>Later</button>
        </>
      );
      break;
    case "downloading":
      text = (
        <>
          Downloading <strong>Donwinne {status.version}</strong>… {status.percent}%
          <span className="update-progress" aria-hidden="true">
            <span style={{ width: `${status.percent}%` }} />
          </span>
        </>
      );
      buttons = <button onClick={later}>Hide</button>;
      break;
    case "ready":
      text = (
        <>
          <strong>Donwinne {status.version}</strong> is ready. Restart to update, or it installs the next time you quit.
        </>
      );
      buttons = (
        <>
          <button className="primary" onClick={() => act("restart")}>
            Restart Now
          </button>
          <button onClick={later}>Later</button>
        </>
      );
      break;
    case "error":
      text = status.message;
      buttons = (
        <>
          <button className="primary" onClick={() => act("open-page")}>
            Open the Releases Page
          </button>
          <button onClick={later}>Close</button>
        </>
      );
      break;
  }

  return (
    <div className={`update-banner ${status.state}`} role="status" aria-live="polite">
      <span className="update-text">{text}</span>
      <span className="update-buttons">{buttons}</span>
    </div>
  );
}
