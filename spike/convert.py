import json, math, sys, xml.etree.ElementTree as ET
src, out = sys.argv[1], sys.argv[2]
LAT0, LON0 = 41.3111, 69.2797  # Amir Temur square
KX = 111320 * math.cos(math.radians(LAT0)); KZ = 110540
root = ET.parse(src).getroot()
nodes, signals = {}, []
for n in root.iter('node'):
    x = (float(n.get('lon')) - LON0) * KX; z = -(float(n.get('lat')) - LAT0) * KZ
    nodes[n.get('id')] = (round(x, 2), round(z, 2))
    tags = {t.get('k'): t.get('v') for t in n.findall('tag')}
    if tags.get('highway') == 'traffic_signals': signals.append(nodes[n.get('id')])
    if tags.get('natural') == 'tree': signals and None
roads, buildings, green, water = [], [], [], []
WIDTH = {'motorway':14,'trunk':14,'primary':12,'secondary':10,'tertiary':8,'residential':6,'unclassified':6,'service':4,'living_street':5,
         'primary_link':6,'secondary_link':6,'tertiary_link':5,'trunk_link':6,'pedestrian':4,'footway':2,'path':1.5,'cycleway':2}
for w in root.iter('way'):
    tags = {t.get('k'): t.get('v') for t in w.findall('tag')}
    pts = [nodes[nd.get('ref')] for nd in w.findall('nd') if nd.get('ref') in nodes]
    if len(pts) < 2: continue
    hw = tags.get('highway')
    if hw in WIDTH:
        lanes = tags.get('lanes')
        width = WIDTH[hw]
        try:
            if lanes: width = max(width, int(lanes.split(';')[0]) * 3.5)
        except ValueError: pass
        roads.append({'t': hw, 'w': width, 'o': tags.get('oneway') == 'yes', 'n': tags.get('name:uz') or tags.get('name') or '', 'p': pts})
    elif 'building' in tags and len(pts) > 3:
        h = None
        try:
            if 'height' in tags: h = float(tags['height'].split()[0])
            elif 'building:levels' in tags: h = float(tags['building:levels']) * 3.2
        except ValueError: pass
        buildings.append({'h': h, 'p': pts[:-1]})
    elif (tags.get('leisure') in ('park', 'garden') or tags.get('landuse') in ('grass', 'forest', 'recreation_ground') or tags.get('natural') == 'wood') and len(pts) > 3:
        green.append(pts[:-1])
    elif (tags.get('natural') == 'water' or tags.get('waterway') in ('canal', 'river')):
        water.append({'a': tags.get('natural') == 'water', 'p': pts})
json.dump({'roads': roads, 'buildings': buildings, 'green': green, 'water': water, 'signals': signals}, open(out, 'w'), separators=(',', ':'))
print(len(roads), 'roads', len(buildings), 'buildings', len(green), 'green', len(water), 'water', len(signals), 'signals')
