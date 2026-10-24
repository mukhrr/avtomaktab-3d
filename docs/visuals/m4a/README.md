# M4a before and after

Before: `main` at 650fa07 (M3 merge plus plan docs), run from a scratch worktree, which has no time of day. After: `m4a/light-materials` production build, high preset. Both at 1280x720, pixel ratio 1, free orbit camera via `?cam=x,y,z&look=x,z`, HUD hidden, same framing. Game coordinates: x east, z south, metres from the district origin 41.3111, 69.2797.

| Spot | URL params | Camera (lat, lon) | Facing | Before | After, noon | After, evening |
|---|---|---|---|---|---|---|
| Amir Temur square, from the south-west corner of the ring, 45 m up | `?cam=-110,45,150&look=0,0` | 41.30974, 69.27838 | 36° (NE, toward the square centre) | [square-before.jpg](square-before.jpg) | [square-after-noon.jpg](square-after-noon.jpg) | [square-after-evening.jpg](square-after-evening.jpg) |
| Wide avenue near the spawn, the edge OSM names Amir Temur shoh ko'chasi, 6 m up | `?cam=-25,6,145&look=-52,310` | 41.30979, 69.27940 | 189° (S) | [avenue-before.jpg](avenue-before.jpg) | [avenue-after-noon.jpg](avenue-after-noon.jpg) | [avenue-after-evening.jpg](avenue-after-evening.jpg) |
| Tree-lined side street, Istiqbol ko'chasi (the densest tree row within 500 m of the centre), 5 m up | `?cam=145,5,185&look=235,305` | 41.30943, 69.28143 | 143° (SE) | [sidestreet-before.jpg](sidestreet-before.jpg) | [sidestreet-after-noon.jpg](sidestreet-after-noon.jpg) | [sidestreet-after-evening.jpg](sidestreet-after-evening.jpg) |

Maps, to compare with real panoramas:

- Amir Temur square: [Yandex](https://yandex.uz/maps/?ll=69.27838%2C41.30974&z=18&panorama%5Bpoint%5D=69.27838%2C41.30974&panorama%5Bdirection%5D=36%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.30974,69.27838&heading=36)
- Avenue: [Yandex](https://yandex.uz/maps/?ll=69.27940%2C41.30979&z=18&panorama%5Bpoint%5D=69.27940%2C41.30979&panorama%5Bdirection%5D=189%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.30979,69.27940&heading=189)
- Istiqbol ko'chasi: [Yandex](https://yandex.uz/maps/?ll=69.28143%2C41.30943&z=18&panorama%5Bpoint%5D=69.28143%2C41.30943&panorama%5Bdirection%5D=143%2C0) / [Google](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=41.30943,69.28143&heading=143)

If a link lands with no panorama, the nearest street-level image is a few metres off; drag the pegman onto the same street.

## Brightness check

`python3 tools/visual/luminance.py IMAGE car=540,430,582,466 asphalt=250,610,550,710 building=870,250,960,310` prints the mean luma (Rec. 709 weights on 0-255 sRGB) of each region. Car is the white AI car that sits at the same spot in every avenue shot (the sim is seeded), asphalt is the near carriageway, building is the west-facing facade on the right. In M3 the sun came from a fixed south-east point, so that facade is sunlit in the before shot and shaded at the real noon sun after M4a.

`avenue-before.jpg` was re-taken in fix round 2 (same framing) so the AI car is in the same place as in the after shots. `avenue-low-noon.jpg` is the low preset.

| Avenue shot | Car | Near asphalt | Building face |
|---|---|---|---|
| before (M3) | 101.7 | 41.9 | 165.2 |
| low, noon | 137.9 (+36%) | 44.4 (+6%) | 136.1 (-18%) |
| high, noon | 138.1 (+36%) | 49.5 (+18%) | 152.8 (-8%) |
| high, evening (fix round 1) | | 24.8 (50% of noon) | 139.2 |
| high, noon, first M4a take (no sky ambient) | | 36.1 | 45.1 |
| high, evening, first M4a take | | 3.1 | 46.7 |

Targets: noon asphalt and building within 20% of before (33.5 to 50.3, 132 to 198), evening asphalt at least 40% of noon. All pass. The AI car reads brighter than in M3 on both presets: its top and back now catch more fill light.
