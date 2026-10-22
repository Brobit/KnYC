// Lets a panel bring itself on screen (expanded, active tab) before a command acts in it.
import { createContext, useContext } from "react";
import type { PanelId } from "./layout";

export interface PanelControls {
  show: (id: PanelId) => void;
}

export const PanelContext = createContext<PanelControls | null>(null);

/** Shows the panel; does nothing outside the workspace (a panel tested on its own). */
export function useShowPanel(id: PanelId): () => void {
  const panels = useContext(PanelContext);
  return () => panels?.show(id);
}
