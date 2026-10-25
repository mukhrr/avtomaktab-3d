# M4d traffic

`m4d/traffic` dev build, 1280x720, pixel ratio 1, free orbit camera via `?cam=x,y,z&look=x,z`, HUD and mirror strip hidden.

## Task 2: car models and pedestrians

| Shot | URL params | What |
|---|---|---|
| [classes-side.jpg](classes-side.jpg) | `?cam=-115.4,2.2,-89.6&look=-103.8,-85.2` | all seven classes parked on `542461042:0` lane 4 with `traffic.place`, sim frozen: spark, nexia, cobalt, lacetti, damas, taxi, bus |
| [classes-front.jpg](classes-front.jpg) | `?cam=-111.3,1.8,-83.1&look=-99,-98` | same line-up, front three quarters |
| [classes-rear.jpg](classes-rear.jpg) | `?cam=-99.3,1.8,-112.2&look=-101,-92` | same line-up from behind; nexia and bus braking, cobalt indicator set left, lacetti right |
| [avenue-noon.jpg](avenue-noon.jpg) | `?cam=-86,4,-178&look=-112,-110` | 15 cars placed at 8 m/s on the five lanes, sim running |
| [avenue-evening.jpg](avenue-evening.jpg) | same | same, evening |
| [zebra-noon.jpg](zebra-noon.jpg) | `?cam=-185,2.2,66.5&look=-191,63` | crossers on zebra `130` (centre -191, 63) mid crossing, legs swinging |

Car triangles per class (paint + fixed): spark 428, nexia 432, cobalt 432, lacetti 584, damas 424, taxi 444, bus 460.

## Task 5: before and after at the M4a avenue framing

High preset, noon, `?cam=-25,6,145&look=-52,310`, 1280x720 at pixel ratio 1, HUD hidden (the mirror strip stays), sim 12 s after start, 60 cars active. Before is d35575e (end of M4c).

| Before M4d | After M4d |
|---|---|
| ![before](traffic-before-noon.jpg) | ![after](traffic-after-noon.jpg) |

Cars are small at this distance (the avenue shot looks down 150 m of road); the class models are shown close up in the Task 2 shots above.

## Main-pass cost

`window.__game.lastFrame.mainCalls` in free drive at spawn, noon, after 4 s. Traffic and pedestrians measured by hiding their six scene objects. Main pass includes the shadow cascades.

| Preset | Total calls | Traffic + pedestrians |
|---|---|---|
| high | 96 | 9 |
| low | 70 | 7 |

Traffic is one BatchedMesh (every class's paint and fixed parts, one call per pass on `WEBGL_multi_draw`, which the test browser has) plus one instanced lamp mesh; pedestrians are four instanced meshes (torso, head, arms, legs). On high the car batch also draws once per shadow cascade.
