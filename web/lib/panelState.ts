export type PanelStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const COLLAPSED = "1";
const EXPANDED = "0";

export function readPanelCollapsed(storage: PanelStorage | undefined, key: string): boolean {
  try {
    return storage?.getItem(key) === COLLAPSED;
  } catch {
    return false;
  }
}

export function writePanelCollapsed(storage: PanelStorage | undefined, key: string, collapsed: boolean): void {
  try {
    storage?.setItem(key, collapsed ? COLLAPSED : EXPANDED);
  } catch {
    // Storage can be blocked (private mode, site data disabled): the panel just won't be remembered.
  }
}
