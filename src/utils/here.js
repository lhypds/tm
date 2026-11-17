import { useSyncExternalStore } from "react";

// Which machine this browser is on, when the page is a server's and the computer in front of the
// user is one of the machines that sync with it: the name of that machine, "" when it is none of
// them or not known. A folder is then opened, and a new event made, on that computer (its taskmgrd
// carries it out, see ai/runner.js) and not on the server, where nobody would see it: the requests
// that do so say `here` (see @utils/api), and the server takes it from there.
//
// It is found by asking the web UI of this computer, http://127.0.0.1:<port>/api/machine, which
// answers only the pages of the server it syncs with (server/index.js); the ports are those the
// machines' daemons told the server (GET /api/ai/machines). A browser may ask the user first (a
// public page reaching a local address), or refuse (Safari, from an https page): the computer is
// then none of the machines, as far as the page knows. The Machines dialog marks the one found.

const ASK_MS = 3000;

let found = ""; // as the web UI of this computer answered
const asked = new Set(); // the ports tried
const listeners = new Set();

// Whether the page is served by this very computer: its folders are then opened here by the server
// itself, and there is no machine to look for.
export const isLocalPage = () => ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

export const getHere = () => (isLocalPage() ? "" : found);

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useHere = () => useSyncExternalStore(subscribe, getHere);

// A page served by this computer has its folders opened here already; a phone is no machine.
const skipped = () => isLocalPage() || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// Look for this computer among `machines` (as GET /api/ai/machines lists them): each port of a
// connected machine is asked once. Nothing is asked once it is found.
export async function findHere(machines) {
  if (found || skipped()) return;
  const ports = [...new Set((machines || []).filter((m) => m.linked && m.port).map((m) => m.port))].filter((p) => !asked.has(p));
  for (const port of ports) {
    asked.add(port);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/machine`, { credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(ASK_MS) });
      const name = res.ok ? (await res.json()).machine : "";
      if (name && machines.some((m) => m.name === name)) {
        found = name;
        listeners.forEach((fn) => fn());
        return;
      }
    } catch (e) {
      /* no web UI on that port here, or the browser does not let the page ask */
    }
  }
}
