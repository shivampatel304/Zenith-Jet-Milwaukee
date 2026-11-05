"""
Step 3 of the Milwaukee ETL pipeline.

Matches each geocoded building to a Microsoft Building Footprint polygon using
a shapely STR-tree nearest-polygon search (100 m threshold). Buildings with no
match keep footprint=None and render as a squircle stand-in on the map.

Usage:  python match_footprints.py
Input:  data/out/buildings_geocoded.json
        data/geo/Milwaukee.geojson  (or data/geo/Wisconsin.geojson)
Output: data/out/buildings_matched.json
"""
import json
import os

try:
    from shapely.geometry import Point, shape
    from shapely.strtree import STRtree
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False


IN_PATH = 'data/out/buildings_geocoded.json'
OUT_PATH = 'data/out/buildings_matched.json'
MATCH_THRESHOLD_M = 100  # accept nearest polygon within 100 m


def load_footprints_geojson(path: str) -> list[dict]:
    with open(path) as f:
        data = json.load(f)
    polys = []
    for feat in data.get('features', []):
        geom = feat.get('geometry', {})
        if geom.get('type') in ('Polygon', 'MultiPolygon'):
            polys.append(geom)
    return polys


def _coord(b: dict) -> tuple:
    """Return (lat, lng) tolerating either 'lon' or 'lng' key."""
    return b.get('lat'), (b.get('lon') if b.get('lon') is not None else b.get('lng'))


def match_all(buildings: list[dict], footprint_geoms: list[dict]) -> list[dict]:
    if HAS_SHAPELY and footprint_geoms:
        print(f'Using shapely nearest-polygon matching ({MATCH_THRESHOLD_M}m threshold)')
        shapely_geoms = [shape(g) for g in footprint_geoms]
        tree = STRtree(shapely_geoms)
        threshold_deg = MATCH_THRESHOLD_M / 111_000

        result = []
        for b in buildings:
            lat, lng = _coord(b)
            fp = None
            if lat is not None and lng is not None:
                pt = Point(lng, lat)
                idx = tree.nearest(pt)
                if idx is not None and shapely_geoms[idx].distance(pt) <= threshold_deg:
                    fp = footprint_geoms[idx]
            result.append({**b, 'footprint': fp})
        return result

    print('shapely or footprints unavailable — all footprints will be null')
    return [{**b, 'footprint': None} for b in buildings]


if __name__ == '__main__':
    geojson_path = None
    for candidate in ('data/geo/Milwaukee.geojson', 'data/geo/Wisconsin.geojson'):
        if os.path.exists(candidate):
            geojson_path = candidate
            break

    if geojson_path:
        print(f'Loading footprints from {geojson_path}...')
        footprint_geoms = load_footprints_geojson(geojson_path)
        print(f'Loaded {len(footprint_geoms)} footprint polygons')
    else:
        print('No footprint file found — footprints will be null')
        footprint_geoms = []

    with open(IN_PATH) as f:
        buildings = json.load(f)
    print(f'Matching {len(buildings)} buildings...')

    final = match_all(buildings, footprint_geoms)
    matched = sum(1 for b in final if b['footprint'] is not None)
    print(f'Matched {matched}/{len(final)} buildings to footprint polygons')

    os.makedirs('data/out', exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(final, f)
    print(f'Saved to {OUT_PATH}')
