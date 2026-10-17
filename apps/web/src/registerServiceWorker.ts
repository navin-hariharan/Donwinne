import { useStore } from "@pns/editor";

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
        // A new version was installed while this one is open: offer to switch.
        reg.addEventListener("updatefound", () => {
          const next = reg.installing;
          next?.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) {
              useStore.setState({ toast: { text: "A new version of Donwinne is ready. Click here to reload.", kind: "info" } });
              const reload = () => {
                window.removeEventListener("click", onToast, true);
                if (useStore.getState().dirty && !window.confirm("Reload now? Unsaved changes are kept in this browser, but not in your file.")) return;
                switching = true;
                next.postMessage("skip-waiting");
              };
              const onToast = (e: Event) => (e.target as Element).closest?.(".toast")?.textContent?.startsWith("A new version") && reload();
              window.addEventListener("click", onToast, true);
            }
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
