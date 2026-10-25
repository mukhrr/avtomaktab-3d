# M4c landmarks in the world

`m4c/landmarks` dev build, 1280x720, pixel ratio 1, free orbit camera via `?cam=x,y,z&look=x,z`, HUD and mirror strip hidden. Street-level shots on the high preset at noon and evening, plus one on low. Game coordinates: x east, z south, metres from the district origin 41.3111, 69.2797. `models.jpg` is the Task 2 model sheet.

| Landmark (OSM) | URL params | Camera (lat, lon) | Facing | Noon | Evening |
|---|---|---|---|---|---|
| Amir Temur monument (node 377979982) | `?cam=12,3,-30&look=4.6,-8.4` | 41.31137, 69.27984 | 199° (SSW) | [monument-noon.jpg](monument-noon.jpg) | [monument-evening.jpg](monument-evening.jpg) |
| Square fountain, south-east of the monument (way 1368039613) | `?cam=48,3,72&look=36.6,57.2` | 41.31045, 69.28027 | 322° (NW) | [fountain-noon.jpg](fountain-noon.jpg) | [fountain-evening.jpg](fountain-evening.jpg) |
| Hotel Uzbekistan (way 44491343) | `?cam=120,6,-10&look=253,-27` | 41.31119, 69.28114 | 83° (E) | [hotel-noon.jpg](hotel-noon.jpg) | [hotel-evening.jpg](hotel-evening.jpg) |
| Tashkent Chimes, Kuranty (way 83581462) | `?cam=-25,4,120&look=12,165` | 41.31002, 69.27940 | 141° (SE) | [kuranty-noon.jpg](kuranty-noon.jpg) | [kuranty-evening.jpg](kuranty-evening.jpg) |
| Palace of International Forums (way 44351799) | `?cam=150,6,95&look=240,172` | 41.31025, 69.28149 | 131° (SE) | [forums-noon.jpg](forums-noon.jpg) | [forums-evening.jpg](forums-evening.jpg) |
| State Museum of Timurid History (way 31972619) | `?cam=-45,5,-205&look=-60,-285` | 41.31294, 69.27916 | 349° (N) | [museum-noon.jpg](museum-noon.jpg) | [museum-evening.jpg](museum-evening.jpg) |
| Square from the M4a `square` framing, 45 m up | `?cam=-110,45,150&look=0,0` | 41.30974, 69.27838 | 36° (NE) | [square-aerial-noon.jpg](square-aerial-noon.jpg) | [square-aerial-evening.jpg](square-aerial-evening.jpg) |

Low preset: [monument-low-noon.jpg](monument-low-noon.jpg). Before M4c (eab203a, high, noon) from the square framing: [square-aerial-before-noon.jpg](square-aerial-before-noon.jpg).

Maps, to compare with real panoramas:

- Amir Temur monument: [Yandex](https://yandex.uz/maps/?ll=69.27984%2C41.31137&z=18&panorama%5Bpoint%5D=69.27984%2C41.31137&panorama%5Bdirection%5D=199%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.31137,69.27984&heading=199)
- Square fountain: [Yandex](https://yandex.uz/maps/?ll=69.28027%2C41.31045&z=18&panorama%5Bpoint%5D=69.28027%2C41.31045&panorama%5Bdirection%5D=322%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.31045,69.28027&heading=322)
- Hotel Uzbekistan: [Yandex](https://yandex.uz/maps/?ll=69.28114%2C41.31119&z=18&panorama%5Bpoint%5D=69.28114%2C41.31119&panorama%5Bdirection%5D=83%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.31119,69.28114&heading=83)
- Kuranty: [Yandex](https://yandex.uz/maps/?ll=69.27940%2C41.31002&z=18&panorama%5Bpoint%5D=69.27940%2C41.31002&panorama%5Bdirection%5D=141%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.31002,69.27940&heading=141)
- Palace of International Forums: [Yandex](https://yandex.uz/maps/?ll=69.28149%2C41.31025&z=18&panorama%5Bpoint%5D=69.28149%2C41.31025&panorama%5Bdirection%5D=131%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.31025,69.28149&heading=131)
- Timurid museum: [Yandex](https://yandex.uz/maps/?ll=69.27916%2C41.31294&z=18&panorama%5Bpoint%5D=69.27916%2C41.31294&panorama%5Bdirection%5D=349%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.31294,69.27916&heading=349)
- Square, aerial framing: [Yandex](https://yandex.uz/maps/?ll=69.27838%2C41.30974&z=18&panorama%5Bpoint%5D=69.27838%2C41.30974&panorama%5Bdirection%5D=36%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.30974,69.27838&heading=36)

If a link lands with no panorama, the nearest street-level image is a few metres off; drag the pegman onto the same street.

## Main-pass cost

`window.__game.lastFrame` after 4 s, noon. Main pass includes the shadow cascades rendered inside it. Before is eab203a (Task 2, landmarks not in the scene).

| Preset, view | Calls before | Calls after | Triangles before | Triangles after |
|---|---|---|---|---|
| high, chase at spawn | 83 | 95 (+12) | 614,593 | 658,250 (+43,657) |
| high, square framing | 83 | 94 (+11) | 625,216 | 668,552 (+43,336) |
| low, chase at spawn | 63 | 68 (+5) | 374,324 | 391,158 (+16,834) |
| low, square framing | 63 | 68 (+5) | 376,671 | 398,449 (+21,778) |

Budgets: high at most 120 calls, low at most +6. The landmarks are four meshes (solid, lattice, clock, jets); on high the three opaque ones also go into each shadow cascade.
