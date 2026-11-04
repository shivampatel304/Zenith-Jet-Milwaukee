"""
Step 1 of ETL pipeline: Parse Milwaukee Covered Buildings Excel file.
Outputs: etl/data/buildings_raw.json
"""
import json
import os
import openpyxl


def _priority_tier(area: int) -> str:
    if area >= 200000:
        return 'A'
    elif area >= 50000:
        return 'B'
    else:
        return 'C'


def parse_excel(filepath: str) -> list[dict]:
    wb = openpyxl.load_workbook(filepath, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))

    buildings = []
    for row in rows[1:]:  # skip header
        (mil_id, taxkey, taxkeyaddr, owner, owneraddr,
         seq, bname, baddr, cls, btype, area) = row

        # Use taxkeyaddress as primary address; fall back to buildingaddress
        address = (taxkeyaddr or '').strip() or (baddr or '').strip()

        finished_area = int(area) if area else 0

        buildings.append({
            'milwaukee_id': (mil_id or '').strip(),
            'taxkey': (taxkey or '').strip() or None,
            'address': address,
            'owner_name': (owner or '').strip(),
            'owner_address': (owneraddr or '').strip() or None,
            'building_name': (bname or '').strip() or None,
            'class_': (cls or '').strip() or None,
            'building_type': (btype or '').strip() or None,
            'finished_area_sqft': finished_area,
            'priority_tier': _priority_tier(finished_area),
        })

    wb.close()
    return buildings


if __name__ == '__main__':
    import sys
    filepath = sys.argv[1] if len(sys.argv) > 1 else \
        '/Users/shivam/Downloads/Milwaukee-Covered-Buildings-List.xlsx'

    buildings = parse_excel(filepath)
    print(f"Parsed {len(buildings)} buildings")

    os.makedirs('data', exist_ok=True)
    with open('data/buildings_raw.json', 'w') as f:
        json.dump(buildings, f, indent=2)
    print("Saved to data/buildings_raw.json")
