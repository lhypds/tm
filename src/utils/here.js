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
// public page reaching a local address), or refuse (Safari, from an https page): the machine can
// then be said by hand, in the Machines dialog, and that is kept for this browser. By hand wins.

const KEY = "machine.here"; // said by hand: a machine's name, or NONE
const NONE = "-"; // by hand: this computer is none of the machines
const ASK_MS = 3000;

let found = ""; // as the web UI of this computer answered
const asked = new Set(); // the ports tried
const listeners = new Set();

function byHand() {
  try {
    return localStorage.getItem(KEY) || "";
  } catch (e) {
    return "";
  }
}

export function getHere() {
  const hand = byHand();
  return hand === NONE ? "" : hand || found;
}

// Say it by hand: `name`, or "" for none of the machines. Saying what was found anyway forgets the
// hand, so what is found later is followed again.
export function setHere(name) {
  try {
    if (name === found) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, name || NONE);
  } catch (e) {
    /* not kept, then */
  }
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const useHere = () => useSyncExternalStore(subscribe, getHere);

// A page served by this computer has its folders opened here already; a phone is no machine.
const skipped = () => ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

// Look for this computer among `machines` (as GET /api/ai/machines lists them): each port of a
// connected machine is asked once. Nothing is asked once it is found, or said by hand.
export async function findHere(machines) {
  if (found || byHand() || skipped()) return;
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
