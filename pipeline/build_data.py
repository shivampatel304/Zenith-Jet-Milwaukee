"""
Step 4 of the Milwaukee ETL pipeline.

Transforms the matched building list into the two static files the map reads,
in the same shape as the Montreal dashboard:
    map/data/milwaukee_data.json   { meta, buildings[], entities[] }
    map/data/milwaukee_lots.geojson  FeatureCollection of footprint polygons

Usage:  python build_data.py
Input:  data/out/buildings_matched.json
Output: ../map/data/milwaukee_data.json
        ../map/data/milwaukee_lots.geojson
"""
import json
import os
import re
from collections import defaultdict
from datetime import date


IN_PATH = 'data/out/buildings_matched.json'
MAP_DATA_DIR = '../map/data'

SQFT_TO_M2 = 0.092903

PRIORITY_LABELS = {
    'A': 'A — Large (≥ 200,000 sq ft)',
    'B': 'B — Medium (50,000–199,999 sq ft)',
    'C': 'C — Small (< 50,000 sq ft)',
}
CONTACT_STATUS_VALUES = [
    'named contact', 'company contact only',
    'not researched yet', 'no contact found', 'no owner found',
]


def slugify(name: str) -> str:
    s = (name or '').strip().upper()
    s = re.sub(r'[^A-Z0-9]+', '-', s).strip('-').lower()
    return 'entity-' + (s or 'unknown')


def derive_form(sector: str) -> str:
    s = (sector or '').lower()
    if 'apartment' in s:
        return 'rental'
    if 'exempt' in s:
        return 'institutional'
    return 'commercial'


def _coord(b: dict):
    lon = b.get('lon') if b.get('lon') is not None else b.get('lng')
    return b.get('lat'), lon


def deduplicate_entities(buildings: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for b in buildings:
        groups[slugify(b.get('owner_name'))].append(b)

    entities = []
    for eid, members in groups.items():
        # Representative name/address: the first non-empty owner_name in the group.
        name = next((m.get('owner_name') for m in members if m.get('owner_name')), '(unknown)')
        mailing = next((m.get('owner_address') for m in members if m.get('owner_address')), None)
        entities.append({
            'id': eid,
            'name': name.strip(),
            'kind': 'building owner',
            'buildings': [m['milwaukee_id'] for m in members],
            'homes': 0,
            'mailing_address': mailing,
            'company_email': None,
            'company_phone': None,
            'company_website': None,
            'contacts': [],
            'notes': None,
            'research_status': 'to do',
        })
    return entities


def build_buildings(matched: list[dict], entity_by_slug: dict) -> list[dict]:
    out = []
    for b in matched:
        lat, lon = _coord(b)
        sqft = int(b.get('finished_area_sqft') or 0)
        sector = b.get('class_')
        btype = b.get('building_type')
        if btype == '-':
            btype = None
        out.append({
            'id': b['milwaukee_id'],
            'address': b.get('address'),
            'building_name': b.get('building_name'),
            'lat': lat,
            'lon': lon,
            'form': derive_form(sector),
            'sector': sector,
            'building_type': btype,
            'priority': b.get('priority_tier'),
            'floors': b.get('floors'),
            'floor_area_sqft': sqft,
            'floor_area_m2': round(sqft * SQFT_TO_M2, 1),
            'year_built': b.get('year_built'),
            'taxkey': b.get('taxkey'),
            'owner': (b.get('owner_name') or '').strip() or None,
            'owner_source': 'City covered-buildings list',
            'entity': entity_by_slug[slugify(b.get('owner_name'))]['id'],
            'contact_status': 'not researched yet',
        })
    return out


def build_lots_geojson(matched: list[dict]) -> dict:
    features = []
    for b in matched:
        fp = b.get('footprint')
        if not fp:
            continue
        features.append({
            'type': 'Feature',
            'properties': {'id': b['milwaukee_id']},
            'geometry': fp,
        })
    return {'type': 'FeatureCollection', 'features': features}


def main():
    with open(IN_PATH) as f:
        matched = json.load(f)
    assert len(matched) == 826, f'expected 826 buildings, got {len(matched)}'

    entities = deduplicate_entities(matched)
    entity_by_slug = {e['id']: e for e in entities}

    buildings = build_buildings(matched, entity_by_slug)
    lots = build_lots_geojson(matched)

    # entity.homes is not meaningful for Milwaukee (no unit counts); leave 0.
    generated = date.today().isoformat()
    data = {
        'meta': {
            'project': 'Milwaukee Covered Buildings',
            'generated': generated,
            'private': 'Internal use only — Azzera marketing.',
            'priority_labels': PRIORITY_LABELS,
            'contact_status_values': CONTACT_STATUS_VALUES,
            'counts': {'buildings': len(buildings), 'entities': len(entities)},
        },
        'buildings': buildings,
        'entities': entities,
    }

    os.makedirs(MAP_DATA_DIR, exist_ok=True)
    with open(os.path.join(MAP_DATA_DIR, 'milwaukee_data.json'), 'w') as f:
        json.dump(data, f, ensure_ascii=False)
    with open(os.path.join(MAP_DATA_DIR, 'milwaukee_lots.geojson'), 'w') as f:
        json.dump(lots, f)

    geocoded = sum(1 for b in buildings if b['lat'] is not None)
    matched_fp = len(lots['features'])
    print(f'{len(buildings)} buildings')
    print(f'{len(entities)} entities')
    print(f'{geocoded} geocoded')
    print(f'{matched_fp} footprint-matched')
    print(f'Wrote {MAP_DATA_DIR}/milwaukee_data.json')
    print(f'Wrote {MAP_DATA_DIR}/milwaukee_lots.geojson')


if __name__ == '__main__':
    main()
