import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import json
from match_footprints import find_nearest_footprint, match_all_footprints


# Minimal stub footprints for unit tests (no file download needed)
def make_stub_footprints():
    """Create a small list of (polygon_dict, centroid_lat, centroid_lng) tuples."""
    # A polygon near downtown Milwaukee
    polygon = {
        'type': 'Polygon',
        'coordinates': [[
            [-87.9065, 43.0389],
            [-87.9060, 43.0389],
            [-87.9060, 43.0394],
            [-87.9065, 43.0394],
            [-87.9065, 43.0389],
        ]]
    }
    return [(polygon, 43.03915, -87.90625)]


def test_find_nearest_returns_polygon_within_threshold():
    footprints = make_stub_footprints()
    # Query point very close to the stub centroid
    result = find_nearest_footprint(43.03915, -87.90625, footprints, threshold_m=50)
    assert result is not None
    assert result['type'] == 'Polygon'


def test_find_nearest_returns_none_beyond_threshold():
    footprints = make_stub_footprints()
    # Far away coordinates
    result = find_nearest_footprint(0.0, 0.0, footprints, threshold_m=50)
    assert result is None


def test_match_all_preserves_all_buildings():
    """All 826 buildings must appear in output even if footprint is None."""
    # Use a small mock dataset
    buildings = [
        {'milwaukee_id': f'M{i:05d}', 'lat': 43.039 + i * 0.001, 'lng': -87.906 + i * 0.001}
        for i in range(5)
    ]
    # Empty footprints list — all will be None
    result = match_all_footprints(buildings, footprints=[])
    assert len(result) == 5
    assert all(b['footprint'] is None for b in result)


def test_match_all_null_coords_get_null_footprint():
    buildings = [{'milwaukee_id': 'M00001', 'lat': None, 'lng': None}]
    result = match_all_footprints(buildings, footprints=[])
    assert result[0]['footprint'] is None


def test_find_nearest_prefers_closer_polygon():
    close = {
        'type': 'Polygon',
        'coordinates': [[[-87.906, 43.039], [-87.905, 43.039],
                         [-87.905, 43.040], [-87.906, 43.040], [-87.906, 43.039]]]
    }
    far = {
        'type': 'Polygon',
        'coordinates': [[[-87.900, 43.039], [-87.899, 43.039],
                         [-87.899, 43.040], [-87.900, 43.040], [-87.900, 43.039]]]
    }
    footprints = [(close, 43.0395, -87.9055), (far, 43.0395, -87.8995)]
    result = find_nearest_footprint(43.0395, -87.9055, footprints, threshold_m=100)
    assert result == close
