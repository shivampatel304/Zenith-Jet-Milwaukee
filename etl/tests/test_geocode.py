import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import responses as responses_lib
from geocode_mprop import geocode_building


@responses_lib.activate
def test_geocode_known_taxkey():
    responses_lib.add(
        responses_lib.GET,
        'https://data.milwaukee.gov/resource/u2xi-7ncj.json',
        json=[{
            'taxkey': '0020082000',
            'x_coord': '2524000',
            'y_coord': '389000',
            'nr_stories': '3',
            'year_built': '1985'
        }],
        status=200
    )
    result = geocode_building({'milwaukee_id': 'M00003', 'taxkey': '0020082000'})
    assert result['lat'] is not None
    assert result['lng'] is not None
    # Milwaukee is roughly 42.9–43.3°N, -87.8 to -88.1°W
    assert 42.9 < result['lat'] < 43.3
    assert -88.1 < result['lng'] < -87.8
    assert result['floors'] == 3
    assert result['year_built'] == 1985


def test_geocode_null_taxkey_returns_none_coords():
    result = geocode_building({'milwaukee_id': 'M00001', 'taxkey': None})
    assert result['lat'] is None
    assert result['lng'] is None
    assert result['floors'] is None
    assert result['year_built'] is None


@responses_lib.activate
def test_geocode_empty_mprop_response():
    responses_lib.add(
        responses_lib.GET,
        'https://data.milwaukee.gov/resource/u2xi-7ncj.json',
        json=[],
        status=200
    )
    result = geocode_building({'milwaukee_id': 'M00999', 'taxkey': '9999999999'})
    assert result['lat'] is None
    assert result['lng'] is None
