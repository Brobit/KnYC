// Opens a web page in the learner's browser (install links). In the desktop app through Tauri's
// opener plugin, allowed for https only (src-tauri/capabilities/default.json).
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "./settings";

export function openExternal(url: string): void {
  if (!url.startsWith("https://")) throw new Error(`only https links open: ${url}`);
  if (isTauri()) void openUrl(url).catch((error) => console.error("could not open", url, error));
  else window.open(url, "_blank", "noopener");
}
