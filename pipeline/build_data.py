"""
Final ETL stage: build the two static files the map reads.

Merges three inputs by building id:
  - buildings_matched.json : geocode + footprint (from match_footprints.py)
  - buildings_mprop.json   : MPROP enrichment (owner, mailing, c/o manager, floors, year)
  - web_contacts.json      : optional, keyed by entity id (agent-run web research)

and derives each building's contact_status on the confidence model:
  green  = "named contact"        (a named person + email or phone)
  blue   = "company contact only" (a company/mailing/manager lead, no named person)
  red    = "no contact found"     (owner exists, nothing reachable)
  red    = "no owner found"       (no owner at all)
  yellow = "not researched yet"   (backlog — rare after MPROP runs)

Usage:  python build_data.py
Output: ../map/data/milwaukee_data.json , milwaukee_lots.geojson
"""
import json
import os
import re
from collections import Counter, defaultdict
from datetime import date


MATCHED_PATH = 'data/out/buildings_matched.json'
MPROP_PATH = 'data/out/buildings_mprop.json'
WEB_PATH = 'web_contacts.json'      # curated, version-controlled (hand-researched)
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

# c/o values that are tax/accounting handlers, not real property managers.
MANAGER_NOISE = re.compile(
    r'\b(tax|pts|cims|accounts?\s+payable|a/?p|ap\s+dept|attn|'
    r'property\s+tax|real\s+estate\s+tax|dept)\b', re.IGNORECASE)


def clean_manager(co: str | None) -> str | None:
    if not co:
        return None
    return None if MANAGER_NOISE.search(co) else co


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


def load_inputs():
    with open(MATCHED_PATH) as f:
        matched = json.load(f)
    mprop_by_id = {}
    if os.path.exists(MPROP_PATH):
        with open(MPROP_PATH) as f:
            mprop_by_id = {b['milwaukee_id']: b for b in json.load(f)}
    web = {}
    if os.path.exists(WEB_PATH):
        with open(WEB_PATH) as f:
            web = json.load(f)
        print(f'Loaded web_contacts for {len(web)} entities')
    # fold MPROP fields into the matched records
    for b in matched:
        m = mprop_by_id.get(b['milwaukee_id'])
        if m:
            for k in ('mprop_owner', 'mprop_co', 'mprop_mail', 'mprop_floors',
                      'mprop_units', 'mprop_year_built', 'mprop_area_sqft',
                      'mprop_assessed', 'mprop_zoning'):
                b[k] = m.get(k)
    return matched, web


def deduplicate_entities(buildings: list[dict], web: dict) -> list[dict]:
    groups = defaultdict(list)
    for b in buildings:
        groups[slugify(b.get('owner_name'))].append(b)

    entities = []
    for eid, members in groups.items():
        name = next((m.get('owner_name') for m in members if m.get('owner_name')), '(unknown)')
        # Prefer the MPROP taxpayer mailing address; fall back to the Excel owner address.
        mailing = (next((m.get('mprop_mail') for m in members if m.get('mprop_mail')), None)
                   or next((m.get('owner_address') for m in members if m.get('owner_address')), None))
        # Property manager: the most common real c/o across this owner's buildings
        # (tax/accounting-department c/o lines are filtered out as noise).
        co = Counter(clean_manager(m.get('mprop_co')) for m in members if clean_manager(m.get('mprop_co')))
        manager = co.most_common(1)[0][0] if co else None

        w = web.get(eid, {})
        contacts = []
        for c in w.get('contacts', []):
            if not (c.get('name') or c.get('email') or c.get('phone')):
                continue
            contacts.append({
                'name': c.get('name'), 'title': c.get('title'),
                'email': c.get('email'), 'phone': c.get('phone'),
                'email_source': c.get('source') or c.get('email_source'),
            })

        entities.append({
            'id': eid,
            'name': name.strip(),
            'kind': 'building owner',
            'buildings': [m['milwaukee_id'] for m in members],
            'homes': 0,
            'mailing_address': mailing,
            'property_manager': w.get('property_manager') or manager,
            'company_email': w.get('company_email'),
            'company_phone': w.get('company_phone'),
            'company_website': w.get('website') or w.get('company_website'),
            'contacts': contacts,
            'notes': None,
            'research_status': 'partial' if (contacts or w) else 'to do',
        })
    return entities


def best_named_contact(e: dict) -> bool:
    """True when the entity has a named person reachable by email or phone."""
    for c in e.get('contacts', []):
        if (c.get('name') or '').strip() and (c.get('email') or c.get('phone')):
            return True
    return False


def has_company_lead(e: dict) -> bool:
    return bool(e.get('company_email') or e.get('company_phone')
               or e.get('company_website') or e.get('mailing_address')
               or e.get('property_manager'))


def contact_status_for(b: dict, e: dict) -> str:
    """Confidence model: green named / blue company / red none / red no-owner."""
    if not (b.get('owner') or (e and e.get('name') and e['name'] != '(unknown)')):
        return 'no owner found'           # red
    if e and best_named_contact(e):
        return 'named contact'            # green — a person + email or phone
    if e and has_company_lead(e):
        return 'company contact only'     # blue — a lead, no named person
    return 'no contact found'             # red — owner but nothing reachable


def build_buildings(matched: list[dict], entity_by_slug: dict) -> list[dict]:
    out = []
    for b in matched:
        lat, lon = _coord(b)
        sqft = int(b.get('finished_area_sqft') or 0)
        sector = b.get('class_')
        btype = b.get('building_type')
        if btype == '-':
            btype = None
        owner = (b.get('owner_name') or '').strip() or None
        e = entity_by_slug[slugify(b.get('owner_name'))]
        bld = {
            'id': b['milwaukee_id'],
            'address': b.get('address'),
            'building_name': b.get('building_name'),
            'lat': lat,
            'lon': lon,
            'form': derive_form(sector),
            'sector': sector,
            'building_type': btype,
            'priority': b.get('priority_tier'),
            # MPROP floors/year win over the (null) Excel values when present
            'floors': b.get('mprop_floors') or b.get('floors'),
            'floor_area_sqft': sqft,
            'floor_area_m2': round(sqft * SQFT_TO_M2, 1),
            'year_built': b.get('mprop_year_built') or b.get('year_built'),
            'taxkey': b.get('taxkey'),
            'owner': owner,
            'owner_source': 'City covered-buildings list',
            'entity': e['id'],
            'contact_status': None,   # set below
        }
        bld['contact_status'] = contact_status_for(bld, e)
        out.append(bld)
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
    matched, web = load_inputs()
    assert len(matched) == 826, f'expected 826 buildings, got {len(matched)}'

    entities = deduplicate_entities(matched, web)
    entity_by_slug = {e['id']: e for e in entities}

    buildings = build_buildings(matched, entity_by_slug)
    lots = build_lots_geojson(matched)

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

    status_counts = Counter(b['contact_status'] for b in buildings)
    with_mgr = sum(1 for e in entities if e.get('property_manager'))
    print(f'{len(buildings)} buildings · {len(entities)} entities')
    print(f'footprints: {len(lots["features"])} · owners with a manager: {with_mgr}')
    print('contact_status breakdown:')
    for s in CONTACT_STATUS_VALUES:
        print(f'  {s:22} {status_counts.get(s, 0)}')
    print(f'Wrote {MAP_DATA_DIR}/milwaukee_data.json + milwaukee_lots.geojson')


if __name__ == '__main__':
    main()
