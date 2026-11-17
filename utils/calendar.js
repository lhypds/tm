'use strict';

// A new event in Apple's Calendar on this machine (a Mac): what the plus of the web UI's calendar
// does, on the server's machine (server/calendar.js) or, asked by the server, on the machine the
// browser is on (the `calendar` command of taskmgrd, see ai/runner.js).

const { execFile } = require('child_process');

// An event of an hour made in Calendar.app on the day asked (so the day is the right one whatever
// Calendar was showing), in the first calendar that can be written, then shown there and opened
// (its "Edit Event", cmd E), where its time is chosen, and its calendar and title changed. The
// key is pressed by System Events, which macOS allows only once the program that runs tm
// (the terminal, node) is let control the computer (System Settings > Privacy & Security >
// Accessibility); without it the event is still there, chosen in Calendar, and the error says
// what to allow. argv: year, month, day, the minutes of its start in the day, its title.
const NEW_EVENT_SCRIPT = `on run argv
  set d to current date
  set day of d to 1
  set year of d to (item 1 of argv) as integer
  set month of d to (item 2 of argv) as integer
  set day of d to (item 3 of argv) as integer
  set time of d to ((item 4 of argv) as integer) * minutes
  set wasRunning to application "Calendar" is running
  tell application "Calendar"
    activate
    set cal to first calendar whose writable is true
    set ev to make new event at end of events of cal with properties {summary:(item 5 of argv), start date:d, end date:d + 1 * hours}
    show ev
  end tell
  if wasRunning then
    delay 0.5
  else
    delay 2
  end if
  tell application "System Events"
    tell process "Calendar" to set frontmost to true
    keystroke "e" using command down
  end tell
end run`;

// The start (minutes in the day) of an event made on `date`: the next whole hour today (the last
// hour of the day at most), 09:00 on any other day.
function startOf(date, now = new Date()) {
  const p2 = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  return date === today ? Math.min(now.getHours() + 1, 23) * 60 : 9 * 60;
}

// Resolves once the event is made and open; rejects with what to show.
function newEvent(date, title) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'darwin') {
      reject(new Error('Apple Calendar is on macOS only.'));
      return;
    }
    execFile('osascript', ['-e', NEW_EVENT_SCRIPT, ...date.split('-'), String(startOf(date)), title], { timeout: 30 * 1000 }, (err, stdout, stderr) => {
      if (!err) resolve();
      else if (/1002|not allowed to send keystrokes|assistive/i.test(String(stderr))) reject(new Error('The event is in Calendar, but macOS did not let tm open it (cmd E): allow the program that runs it in System Settings > Privacy & Security > Accessibility.'));
      else reject(new Error(String(stderr).trim().split('\n').pop() || err.message));
    });
  });
}

module.exports = { newEvent, startOf };
