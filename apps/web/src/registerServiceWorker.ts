import { useStore } from "@pns/editor";

const UPDATE_TEXT = "A new version of Donwinne is ready. Click here to reload.";

/**
 * Registers the service worker that keeps the app available offline. Only for the built web app
 * served over http(s): not in development and not in the desktop app, which loads from disk.
 */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol) || window.pnsDesktop) return;
  /** Set when the user agrees to switch to a new version; only then does a change of worker reload the page. */
  let switching = false;
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => {
        let offered = false;
        const reload = () => {
          // Cancelling keeps the offer on screen, so the user can accept it later.
          if (useStore.getState().dirty && !window.confirm("Reload now? Unsaved changes are kept in this browser, but not in your file.")) return;
          offered = false;
          useStore.setState({ toast: null });
          const waiting = reg.waiting;
          if (waiting) {
            switching = true;
            waiting.postMessage("skip-waiting");
          } else {
            // The new version already took over (from another tab, say): just load it.
            location.reload();
          }
        };
        const offer = () => {
          offered = true;
          useStore.setState({ toast: { text: UPDATE_TEXT, kind: "info", onClick: reload } });
        };
        // Another message may replace or clear the offer; bring it back until the user accepts it.
        useStore.subscribe((s) => {
          if (offered && !s.toast) offer();
        });
        // A new version was installed while this one is open: offer to switch.
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) offer();
          });
        });
      })
      .catch(() => {
        /* offline use is optional */
      });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!switching) return; // the first install taking control needs no reload
      switching = false;
      location.reload();
    });
  });
}
