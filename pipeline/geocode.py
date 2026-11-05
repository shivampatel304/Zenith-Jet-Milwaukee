"""
Step 2 of the Milwaukee ETL pipeline.

Geocodes each building by address via Nominatim (OpenStreetMap). Keyless and
free; rate-limited to 1 request/second. Writes a checkpoint every 50 rows so an
interrupted run can resume.

Usage:  python geocode.py
Input:  data/out/buildings_raw.json
Output: data/out/buildings_geocoded.json
"""
import json
import os
import time

import requests


NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
HEADERS = {'User-Agent': 'Milwaukee-Building-Platform/1.0 (shivam.patel@azzera.com)'}

IN_PATH = 'data/out/buildings_raw.json'
OUT_PATH = 'data/out/buildings_geocoded.json'
CHECKPOINT_PATH = 'data/out/buildings_geocoded_checkpoint.json'


def geocode_building(building: dict) -> dict:
    """Return the building with lat/lon added (None if not found).

    floors and year_built stay None — Nominatim does not provide them, and
    the map estimates floor count from building type at render time.
    """
    result = {**building, 'lat': None, 'lon': None, 'floors': None, 'year_built': None}

    address = (building.get('address') or '').strip()
    if not address:
        return result

    query = f'{address}, Milwaukee, WI'
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={'q': query, 'format': 'json', 'limit': 1, 'countrycodes': 'us'},
            headers=HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
        if rows:
            result['lat'] = float(rows[0]['lat'])
            result['lon'] = float(rows[0]['lon'])
    except Exception:
        pass  # network error — leave coords None
    return result


def _load_checkpoint() -> dict:
    if os.path.exists(CHECKPOINT_PATH):
        with open(CHECKPOINT_PATH) as f:
            return {b['milwaukee_id']: b for b in json.load(f)}
    return {}


if __name__ == '__main__':
    with open(IN_PATH) as f:
        buildings = json.load(f)

    done = _load_checkpoint()
    if done:
        print(f'resuming — {len(done)} buildings already geocoded')

    out = []
    for i, b in enumerate(buildings):
        bid = b['milwaukee_id']
        if bid in done:
            out.append(done[bid])
            continue

        out.append(geocode_building(b))
        time.sleep(1.1)  # Nominatim: max 1 req/sec

        if (i + 1) % 50 == 0:
            with open(CHECKPOINT_PATH, 'w') as f:
                json.dump(out, f, indent=2)
            found = sum(1 for x in out if x.get('lat') is not None)
            print(f'  {i + 1}/{len(buildings)} done ({found} geocoded)')

    found = sum(1 for b in out if b.get('lat') is not None)
    print(f'Geocoded {found}/{len(out)} buildings')

    os.makedirs('data/out', exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, indent=2)
    if os.path.exists(CHECKPOINT_PATH):
        os.remove(CHECKPOINT_PATH)
    print(f'Saved to {OUT_PATH}')
