"""
Enrichment stage 1: MPROP (Milwaukee Master Property Record).

Looks up every building by taxkey in the City's open assessment data and attaches
owner, owner mailing address, the c/o manager, floors, units, year built, building
area, assessed value and zoning. MPROP carries no coordinates, so lat/lon are left
untouched (geocoding stays on the Nominatim result).

Free, keyless CKAN API. Fetched in bulk via datastore_search_sql (chunked IN clauses).

Usage:  python enrich_mprop.py
Input:  data/out/buildings_raw.json      (or buildings_geocoded.json if present, to keep lat/lon)
Output: data/out/buildings_mprop.json
"""
import json
import os
import re
import time

import requests


RID = '0a2c7f31-cd15-4151-8222-09dd57d5f16d'   # MPROP CSV resource (CKAN datastore)
SQL_URL = 'https://data.milwaukee.gov/api/3/action/datastore_search_sql'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'}

# Prefer the geocoded file so we keep lat/lon; fall back to raw.
IN_CANDIDATES = ['data/out/buildings_geocoded.json', 'data/out/buildings_raw.json']
OUT_PATH = 'data/out/buildings_mprop.json'

FIELDS = ['TAXKEY', 'OWNER_NAME_1', 'OWNER_NAME_2', 'OWNER_NAME_3',
          'OWNER_MAIL_ADDR', 'OWNER_CITY_STATE', 'OWNER_ZIP',
          'NR_STORIES', 'NR_UNITS', 'YR_BUILT', 'BLDG_AREA', 'C_A_TOTAL', 'ZONING']

CO_RE = re.compile(r'\bC[/\\]?O\b[\.\s]*', re.IGNORECASE)


def extract_co(*names) -> str | None:
    """Pull a 'c/o <manager>' name out of any owner string that carries one."""
    for n in names:
        if not n:
            continue
        m = CO_RE.search(n)
        if m:
            mgr = n[m.end():].strip(' .,')
            if mgr:
                return mgr
    return None


def to_int(v):
    try:
        x = int(float(str(v).strip()))
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def to_year(v):
    x = to_int(v)
    return x if x and 1700 <= x <= 2030 else None


def fetch_chunk(session, taxkeys):
    quoted = ','.join("'" + t.replace("'", "''") + "'" for t in taxkeys)
    cols = ','.join(f'"{c}"' for c in FIELDS)
    sql = f'SELECT {cols} FROM "{RID}" WHERE "TAXKEY" IN ({quoted})'
    r = session.get(SQL_URL, params={'sql': sql}, headers=UA, timeout=60)
    r.raise_for_status()
    data = r.json()
    if not data.get('success'):
        raise RuntimeError(f'MPROP SQL error: {data.get("error")}')
    return {row['TAXKEY']: row for row in data['result']['records']}


def main():
    in_path = next((p for p in IN_CANDIDATES if os.path.exists(p)), None)
    if not in_path:
        raise SystemExit('No input file (buildings_geocoded.json or buildings_raw.json)')
    with open(in_path) as f:
        buildings = json.load(f)
    print(f'Loaded {len(buildings)} buildings from {in_path}')

    taxkeys = sorted({b['taxkey'] for b in buildings if b.get('taxkey')})
    print(f'Looking up {len(taxkeys)} taxkeys in MPROP...')

    session = requests.Session()
    mprop = {}
    CHUNK = 100
    for i in range(0, len(taxkeys), CHUNK):
        chunk = taxkeys[i:i + CHUNK]
        for attempt in range(3):
            try:
                mprop.update(fetch_chunk(session, chunk))
                break
            except Exception as e:
                if attempt == 2:
                    print(f'  chunk {i//CHUNK} failed after retries: {e}')
                else:
                    time.sleep(1.5)
        print(f'  {min(i + CHUNK, len(taxkeys))}/{len(taxkeys)} taxkeys fetched')
        time.sleep(0.3)

    matched = 0
    out = []
    for b in buildings:
        rec = mprop.get(b.get('taxkey'))
        e = dict(b)
        if rec:
            matched += 1
            co = extract_co(rec.get('OWNER_NAME_2'), b.get('owner_name'))
            mail_parts = [rec.get('OWNER_MAIL_ADDR'), rec.get('OWNER_CITY_STATE')]
            zip_ = (rec.get('OWNER_ZIP') or '').strip()
            if zip_ and zip_.strip('0'):
                mail_parts.append(zip_[:5])
            e['mprop_owner'] = (rec.get('OWNER_NAME_1') or '').strip() or None
            e['mprop_co'] = co
            e['mprop_mail'] = ' '.join(p.strip() for p in mail_parts if p and p.strip()) or None
            e['mprop_floors'] = to_int(rec.get('NR_STORIES'))
            e['mprop_units'] = to_int(rec.get('NR_UNITS'))
            e['mprop_year_built'] = to_year(rec.get('YR_BUILT'))
            e['mprop_area_sqft'] = to_int(rec.get('BLDG_AREA'))
            e['mprop_assessed'] = to_int(rec.get('C_A_TOTAL'))
            e['mprop_zoning'] = (rec.get('ZONING') or '').strip() or None
        else:
            for k in ('mprop_owner', 'mprop_co', 'mprop_mail', 'mprop_floors',
                      'mprop_units', 'mprop_year_built', 'mprop_area_sqft',
                      'mprop_assessed', 'mprop_zoning'):
                e[k] = None
        out.append(e)

    os.makedirs('data/out', exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, indent=2)

    with_co = sum(1 for b in out if b.get('mprop_co'))
    with_floors = sum(1 for b in out if b.get('mprop_floors'))
    print(f'\nMatched {matched}/{len(out)} buildings to MPROP')
    print(f'  c/o manager found: {with_co}')
    print(f'  floors found: {with_floors}')
    print(f'Saved to {OUT_PATH}')


if __name__ == '__main__':
    main()
