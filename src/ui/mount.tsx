import { createRoot } from 'react-dom/client';
import { Hud } from './Hud';
import type { HudStore } from './hudStore';
import './hud.css';

export function mountHud(store: HudStore, minimap: HTMLCanvasElement, debug: boolean): void {
  const host = document.createElement('div');
  document.body.append(host);
  createRoot(host).render(<Hud store={store} minimap={minimap} debug={debug} />);
}
