import type { ExamRoute } from './route';

type FetchJson = (url: string) => Promise<unknown>;

const FATAL_ROUTE = 'route-1';
const defaultFetch: FetchJson = async url => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

/** Every route listed in the district's index; one that fails to load is skipped, except route-1. */
export async function loadRoutes(district: string, fetchJson: FetchJson = defaultFetch): Promise<ExamRoute[]> {
  const base = `/districts/${district}/routes`;
  const { routes: ids } = (await fetchJson(`${base}/index.json`)) as { routes: string[] };
  const settled = await Promise.allSettled(ids.map(id => fetchJson(`${base}/${id}.json`)));
  const routes: ExamRoute[] = [];
  const skipped: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') routes.push(r.value as ExamRoute);
    else if (ids[i] === FATAL_ROUTE) throw new Error(`${FATAL_ROUTE} failed to load`, { cause: r.reason });
    else skipped.push(ids[i]);
  });
  if (skipped.length) console.warn(`routes skipped, failed to load: ${skipped.join(', ')}`);
  if (!routes.length) throw new Error(`no routes for ${district}`);
  return routes;
}

export function drawRoute(routes: ExamRoute[], rand: () => number): ExamRoute {
  return routes[Math.min(routes.length - 1, Math.floor(rand() * routes.length))];
}
