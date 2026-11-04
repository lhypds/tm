// clear terminal (works in zsh/bash)
function clearScreen() {
  try { process.stdout.write('\x1b[2J\x1b[H'); } catch (e) { try { console.clear(); } catch (e) { } }
}

module.exports = {
  clearScreen
};