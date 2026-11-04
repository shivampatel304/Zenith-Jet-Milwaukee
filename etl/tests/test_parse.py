import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from parse_excel import parse_excel

EXCEL_PATH = '/Users/shivam/Downloads/Milwaukee-Covered-Buildings-List.xlsx'


def test_parse_returns_826_buildings():
    buildings = parse_excel(EXCEL_PATH)
    assert len(buildings) == 826


def test_parse_building_shape():
    buildings = parse_excel(EXCEL_PATH)
    b = buildings[0]
    assert b['milwaukee_id'] == 'M00001'
    assert 'taxkey' in b
    assert 'address' in b
    assert 'owner_name' in b
    assert 'owner_address' in b
    assert 'building_name' in b
    assert 'class_' in b
    assert 'building_type' in b
    assert 'finished_area_sqft' in b
    assert isinstance(b['finished_area_sqft'], int)


def test_priority_tier_assignment():
    buildings = parse_excel(EXCEL_PATH)
    large = [b for b in buildings if b['finished_area_sqft'] >= 200000]
    assert all(b['priority_tier'] == 'A' for b in large)
    medium = [b for b in buildings if 50000 <= b['finished_area_sqft'] < 200000]
    assert all(b['priority_tier'] == 'B' for b in medium)
    small = [b for b in buildings if b['finished_area_sqft'] < 50000]
    assert all(b['priority_tier'] == 'C' for b in small)


def test_address_always_populated():
    buildings = parse_excel(EXCEL_PATH)
    for b in buildings:
        assert b['address'] and len(b['address'].strip()) > 0, \
            f"Building {b['milwaukee_id']} has no address"


def test_owner_name_stripped():
    buildings = parse_excel(EXCEL_PATH)
    for b in buildings:
        assert b['owner_name'] == b['owner_name'].strip(), \
            f"Owner name has leading/trailing whitespace: '{b['owner_name']}'"
