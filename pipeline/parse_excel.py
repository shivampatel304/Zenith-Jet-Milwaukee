"""
Step 1 of the Milwaukee ETL pipeline.

Reads the City of Milwaukee covered-buildings Excel and emits a flat JSON list.

Usage:  python parse_excel.py
Input:  data/in/Milwaukee-Covered-Buildings-List.xlsx
Output: data/out/buildings_raw.json   (826 objects)
"""
import json
import os

from openpyxl import load_workbook


IN_PATH = 'data/in/Milwaukee-Covered-Buildings-List.xlsx'
OUT_PATH = 'data/out/buildings_raw.json'


# Header text in the sheet -> our field name. Matched case-insensitively.
COLUMN_MAP = {
    'milwaukee building id': 'milwaukee_id',
    'taxkey': 'taxkey',
    'taxkeyaddress': 'address',
    'buildingaddress': '_building_address',   # fallback for address
    'owner': 'owner_name',
    'owneraddress': 'owner_address',
    'buildingname': 'building_name',
    'class': 'class_',
    'buildingtype': 'building_type',
    'finishedarea': 'finished_area_sqft',
}


def _clean(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def priority_tier(sqft: int) -> str:
    """A >= 200,000 | B 50,000-199,999 | C < 50,000."""
    if sqft >= 200_000:
        return 'A'
    if sqft >= 50_000:
        return 'B'
    return 'C'


def parse_excel(path: str) -> list[dict]:
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active

    rows = ws.iter_rows(values_only=True)
    header = next(rows)
    # column index -> field name
    idx_to_field = {}
    for i, cell in enumerate(header):
        key = str(cell or '').strip().lower()
        if key in COLUMN_MAP:
            idx_to_field[i] = COLUMN_MAP[key]

    buildings = []
    for row in rows:
        rec = {}
        for i, field in idx_to_field.items():
            rec[field] = row[i] if i < len(row) else None

        milwaukee_id = _clean(rec.get('milwaukee_id'))
        if not milwaukee_id:
            continue

        address = _clean(rec.get('address')) or _clean(rec.get('_building_address'))
        try:
            sqft = int(float(rec.get('finished_area_sqft') or 0))
        except (TypeError, ValueError):
            sqft = 0

        buildings.append({
            'milwaukee_id': milwaukee_id,
            'taxkey': _clean(rec.get('taxkey')),
            'address': address,
            'owner_name': _clean(rec.get('owner_name')),
            'owner_address': _clean(rec.get('owner_address')),
            'building_name': _clean(rec.get('building_name')),
            'class_': _clean(rec.get('class_')),
            'building_type': _clean(rec.get('building_type')),
            'finished_area_sqft': sqft,
            'priority_tier': priority_tier(sqft),
        })

    wb.close()
    return buildings


if __name__ == '__main__':
    buildings = parse_excel(IN_PATH)
    assert len(buildings) == 826, f'expected 826 buildings, got {len(buildings)}'

    os.makedirs('data/out', exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(buildings, f, indent=2)
    print(f'{len(buildings)} buildings written to {OUT_PATH}')
