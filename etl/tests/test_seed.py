import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from seed_supabase import deduplicate_owners, build_blank_contacts


def test_deduplicate_owners_merges_same_name():
    buildings = [
        {'owner_name': 'ACME LLC ', 'owner_address': '123 Main', 'milwaukee_id': 'M00001'},
        {'owner_name': 'ACME LLC',  'owner_address': '123 Main', 'milwaukee_id': 'M00002'},
    ]
    owners = deduplicate_owners(buildings)
    assert len(owners) == 1
    assert owners[0]['name'] == 'ACME LLC'  # trimmed


def test_deduplicate_owners_keeps_distinct_names():
    buildings = [
        {'owner_name': 'ALPHA CORP', 'owner_address': '1 A St', 'milwaukee_id': 'M00001'},
        {'owner_name': 'BETA LLC',   'owner_address': '2 B St', 'milwaukee_id': 'M00002'},
    ]
    owners = deduplicate_owners(buildings)
    assert len(owners) == 2


def test_deduplicate_owners_counts_buildings():
    buildings = [
        {'owner_name': 'ACME LLC', 'owner_address': '123 Main', 'milwaukee_id': 'M00001'},
        {'owner_name': 'ACME LLC', 'owner_address': '123 Main', 'milwaukee_id': 'M00002'},
        {'owner_name': 'ACME LLC', 'owner_address': '123 Main', 'milwaukee_id': 'M00003'},
    ]
    owners = deduplicate_owners(buildings)
    assert owners[0]['building_count'] == 3


def test_blank_contacts_one_per_building():
    buildings = [
        {'milwaukee_id': 'M00001'},
        {'milwaukee_id': 'M00002'},
        {'milwaukee_id': 'M00003'},
    ]
    contacts = build_blank_contacts(buildings)
    assert len(contacts) == 3
    assert all(c['status'] == 'not_researched' for c in contacts)


def test_blank_contacts_all_fields_null():
    buildings = [{'milwaukee_id': 'M00001'}]
    contacts = build_blank_contacts(buildings)
    c = contacts[0]
    assert c['contact_name'] is None
    assert c['email'] is None
    assert c['phone'] is None
    assert c['notes'] is None
    assert c['milwaukee_id'] == 'M00001'
