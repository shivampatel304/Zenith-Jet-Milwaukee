"""
Step 2 of ETL pipeline: Geocode buildings via Milwaukee MPROP Socrata API.
Enriches buildings with lat/lng, floors, year_built from city property records.
Outputs: etl/data/buildings_geocoded.json

Milwaukee MPROP API: https://data.milwaukee.gov/resource/u2xi-7ncj.json
Coordinates are in Wisconsin State Plane East (EPSG:32054), feet.
We convert to WGS84 (EPSG:4326) lat/lng.
"""
import json
import os
import time
import requests
from pyproj import Transformer

# Wisconsin State Plane East (US feet) → WGS84
_transformer = Transformer.from_crs('EPSG:32054', 'EPSG:4326', always_xy=True)

MPROP_URL = 'https://data.milwaukee.gov/resource/u2xi-7ncj.json'


def _convert_coords(x_str: str, y_str: str) -> tuple[float, float]:
    """Convert Wisconsin State Plane East feet to WGS84 lat/lng."""
    x = float(x_str)
    y = float(y_str)
    lng, lat = _transformer.transform(x, y)
    return lat, lng


def geocode_building(building: dict) -> dict:
    """
    Look up a building in MPROP by taxkey and add lat, lng, floors, year_built.
    Returns the building dict with these keys added (None if not found).
    """
    result = {**building, 'lat': None, 'lng': None, 'floors': None, 'year_built': None}

    taxkey = building.get('taxkey')
    if not taxkey:
        return result

    try:
        resp = requests.get(
            MPROP_URL,
            params={'taxkey': taxkey, '$limit': 1},
            timeout=10
        )
        resp.raise_for_status()
        rows = resp.json()

        if not rows:
            return result

        row = rows[0]
        x = row.get('x_coord')
        y = row.get('y_coord')

        if x and y:
            lat, lng = _convert_coords(x, y)
            result['lat'] = lat
            result['lng'] = lng

        stories = row.get('nr_stories')
        if stories:
            result['floors'] = int(stories)

        yr = row.get('year_built')
        if yr:
            result['year_built'] = int(yr)

    except Exception:
        pass  # network error — leave coords as None

    return result


if __name__ == '__main__':
    with open('data/buildings_raw.json') as f:
        buildings = json.load(f)

    print(f"Geocoding {len(buildings)} buildings...")
    geocoded = []
    for i, b in enumerate(buildings):
        result = geocode_building(b)
        geocoded.append(result)
        if (i + 1) % 50 == 0:
            print(f"  {i + 1}/{len(buildings)} done")
        time.sleep(0.1)  # be polite to the city API

    found = sum(1 for b in geocoded if b['lat'] is not None)
    print(f"Geocoded {found}/{len(geocoded)} buildings with coordinates")

    os.makedirs('data', exist_ok=True)
    with open('data/buildings_geocoded.json', 'w') as f:
        json.dump(geocoded, f, indent=2)
    print("Saved to data/buildings_geocoded.json")
