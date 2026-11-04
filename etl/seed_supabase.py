"""
Step 4 of ETL pipeline: Seed Supabase with owners, buildings, and blank contacts.

Before running:
  1. Create a .env file in etl/ with:
       SUPABASE_URL=https://your-project.supabase.co
       SUPABASE_SERVICE_KEY=your_service_role_key
  2. Run the schema.sql in Supabase SQL Editor
  3. Have data/buildings_final.json from previous steps

Usage:
  python seed_supabase.py
"""
import json
import os
from dotenv import load_dotenv

load_dotenv()


def deduplicate_owners(buildings: list[dict]) -> list[dict]:
    """
    Group buildings by normalized owner name (strip + uppercase).
    Returns one owner dict per unique owner with building_count.
    """
    seen: dict[str, dict] = {}  # normalized_name → owner dict

    for b in buildings:
        raw_name = (b.get('owner_name') or '').strip()
        key = raw_name.upper()
        if key not in seen:
            seen[key] = {
                'name': raw_name,
                'mailing_address': b.get('owner_address'),
                'building_count': 0,
                'company_email': None,
                'company_phone': None,
                'company_website': None,
            }
        seen[key]['building_count'] += 1

    return list(seen.values())


def build_blank_contacts(buildings: list[dict]) -> list[dict]:
    """Create one blank contact record per building (status = not_researched)."""
    return [
        {
            'milwaukee_id': b['milwaukee_id'],  # used to look up building_id after insert
            'contact_name': None,
            'email': None,
            'phone': None,
            'notes': None,
            'status': 'not_researched',
        }
        for b in buildings
    ]


def seed_all(buildings: list[dict]) -> None:
    """Load owners → buildings → blank contacts into Supabase."""
    from supabase import create_client

    url = os.environ['SUPABASE_URL']
    key = os.environ['SUPABASE_SERVICE_KEY']
    supabase = create_client(url, key)

    # 1. Upsert owners
    owners = deduplicate_owners(buildings)
    print(f"Upserting {len(owners)} owners...")
    supabase.table('owners').upsert(owners, on_conflict='name').execute()

    # Fetch inserted owners to get their UUIDs
    owner_rows = supabase.table('owners').select('id,name').execute().data
    owner_map = {row['name'].upper(): row['id'] for row in owner_rows}

    # 2. Upsert buildings
    building_rows = []
    for b in buildings:
        owner_key = (b.get('owner_name') or '').strip().upper()
        building_rows.append({
            'milwaukee_id': b['milwaukee_id'],
            'taxkey': b.get('taxkey'),
            'address': b['address'],
            'building_name': b.get('building_name'),
            'owner_id': owner_map.get(owner_key),
            'class': b.get('class_'),
            'building_type': b.get('building_type'),
            'finished_area_sqft': b.get('finished_area_sqft'),
            'floors': b.get('floors'),
            'year_built': b.get('year_built'),
            'lat': b.get('lat'),
            'lng': b.get('lng'),
            'footprint': b.get('footprint'),
            'priority_tier': b.get('priority_tier'),
        })

    print(f"Upserting {len(building_rows)} buildings...")
    # Batch in chunks of 100 to avoid request size limits
    for i in range(0, len(building_rows), 100):
        chunk = building_rows[i:i + 100]
        supabase.table('buildings').upsert(chunk, on_conflict='milwaukee_id').execute()
        print(f"  Buildings: {min(i + 100, len(building_rows))}/{len(building_rows)}")

    # Fetch building IDs
    bldg_rows = supabase.table('buildings').select('id,milwaukee_id').execute().data
    bldg_map = {row['milwaukee_id']: row['id'] for row in bldg_rows}

    # 3. Upsert blank contacts
    contact_rows = []
    for b in buildings:
        bldg_id = bldg_map.get(b['milwaukee_id'])
        if bldg_id:
            contact_rows.append({
                'building_id': bldg_id,
                'contact_name': None,
                'email': None,
                'phone': None,
                'notes': None,
                'status': 'not_researched',
            })

    print(f"Upserting {len(contact_rows)} blank contacts...")
    for i in range(0, len(contact_rows), 100):
        chunk = contact_rows[i:i + 100]
        supabase.table('building_contacts').upsert(
            chunk, on_conflict='building_id'
        ).execute()

    print("Seed complete!")


if __name__ == '__main__':
    with open('data/buildings_final.json') as f:
        buildings = json.load(f)
    seed_all(buildings)
