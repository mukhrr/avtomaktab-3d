import { drawRoute, loadRoutes } from './routes';
import type { ExamRoute } from './route';

const fake = (id: string) => ({ id, lengthM: 4000 }) as ExamRoute;

describe('drawRoute', () => {
  it('draws each route with the right probability', () => {
    const routes = [fake('a'), fake('b'), fake('c')];
    expect([0.1, 0.5, 0.9].map(r => drawRoute(routes, () => r).id)).toEqual(['a', 'b', 'c']);
    expect(drawRoute(routes, () => 0.9999999).id).toBe('c');
    expect(drawRoute(routes, () => 0).id).toBe('a');
  });

  it('starts the exam on route-1 when it is the only route', () => {
    const only = [fake('route-1')];
    for (const r of [0, 0.5, 0.999]) expect(drawRoute(only, () => r).id).toBe('route-1');
  });
});

describe('loadRoutes', () => {
  const files = (broken: string[]) => async (url: string) => {
    if (url.endsWith('/index.json')) return { routes: ['route-1', 'route-2', 'route-3'] };
    const id = url.split('/').pop()!.replace('.json', '');
    if (broken.includes(id)) throw new Error('404');
    return fake(id);
  };

  it('loads every route in the index, in order', async () => {
    const got = await loadRoutes('tashkent-center', files([]));
    expect(got.map(r => r.id)).toEqual(['route-1', 'route-2', 'route-3']);
  });

  it('skips a route that fails to load and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const got = await loadRoutes('tashkent-center', files(['route-2', 'route-3']));
    expect(got.map(r => r.id)).toEqual(['route-1']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it.each([
    ['fails to load', async () => { throw new Error('404'); }],
    ['is not an object with a routes list', async () => ['route-1']],
    ['lists a non-string id', async () => ({ routes: ['route-1', 2] })],
    ['lists no routes', async () => ({ routes: [] })],
  ])('falls back to route-1 and logs one error when the index %s', async (_, index) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchJson = async (url: string) => (url.endsWith('/index.json') ? index() : fake(url.split('/').pop()!.replace('.json', '')));
    const got = await loadRoutes('tashkent-center', fetchJson);
    expect(got.map(r => r.id)).toEqual(['route-1']);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('route-1 failing is fatal', async () => {
    await expect(loadRoutes('tashkent-center', files(['route-1']))).rejects.toThrow();
  });
});
