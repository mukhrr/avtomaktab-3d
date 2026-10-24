import { createRoot } from 'react-dom/client';
import { Hud, type HudApp } from './Hud';
import type { HudStore } from './hudStore';
import './hud.css';

export function mountHud(store: HudStore, minimap: HTMLCanvasElement, debug: boolean, app: HudApp): void {
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(<Hud store={store} minimap={minimap} debug={debug} app={app} />);
}
