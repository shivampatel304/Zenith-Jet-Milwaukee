"""
Step 3 of ETL pipeline: Match buildings to Microsoft Building Footprints.
Downloads Wisconsin GeoJSON and spatially joins to get 3D polygon shapes.
Outputs: etl/data/buildings_final.json

Microsoft Building Footprints: free, global coverage.
Wisconsin file: ~200MB, downloaded once to etl/data/Wisconsin.geojson
"""
import json
import math
import os
from typing import Optional


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distance in metres between two lat/lng points."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _centroid(polygon: dict) -> tuple[float, float]:
    """Compute centroid of first ring of a GeoJSON Polygon."""
    coords = polygon['coordinates'][0]
    lats = [c[1] for c in coords]
    lngs = [c[0] for c in coords]
    return sum(lats) / len(lats), sum(lngs) / len(lngs)


def load_footprints(geojson_path: str) -> list[tuple[dict, float, float]]:
    """
    Load GeoJSON FeatureCollection and return list of (polygon, centroid_lat, centroid_lng).
    Handles both FeatureCollection format and newline-delimited JSON.
    """
    footprints = []
    with open(geojson_path) as f:
        content = f.read().strip()

    # Try FeatureCollection first
    try:
        data = json.loads(content)
        if data.get('type') == 'FeatureCollection':
            for feature in data.get('features', []):
                polygon = feature.get('geometry')
                if polygon and polygon.get('type') == 'Polygon':
                    lat, lng = _centroid(polygon)
                    footprints.append((polygon, lat, lng))
            return footprints
    except json.JSONDecodeError:
        pass

    # Try newline-delimited JSON (MS format)
    for line in content.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            feature = json.loads(line)
            geometry = feature.get('geometry') or feature
            if geometry.get('type') == 'Polygon':
                lat, lng = _centroid(geometry)
                footprints.append((geometry, lat, lng))
        except (json.JSONDecodeError, KeyError, AttributeError):
            continue

    return footprints


def find_nearest_footprint(
    lat: float,
    lng: float,
    footprints: list[tuple[dict, float, float]],
    threshold_m: float = 50,
) -> Optional[dict]:
    """
    Find the nearest footprint polygon whose centroid is within threshold_m metres.
    Returns the GeoJSON Polygon dict or None.
    """
    best_polygon = None
    best_dist = float('inf')

    for polygon, clat, clng in footprints:
        dist = _haversine_m(lat, lng, clat, clng)
        if dist < best_dist:
            best_dist = dist
            best_polygon = polygon

    if best_dist <= threshold_m:
        return best_polygon
    return None


def match_all_footprints(
    buildings: list[dict],
    footprints: list[tuple[dict, float, float]],
    threshold_m: float = 50,
) -> list[dict]:
    """
    Match each building to its nearest footprint polygon.
    Buildings without valid coords or no match within threshold get footprint=None.
    All buildings are always returned (count preserved).
    """
    result = []
    for b in buildings:
        lat = b.get('lat')
        lng = b.get('lng')
        if lat is not None and lng is not None:
            polygon = find_nearest_footprint(lat, lng, footprints, threshold_m)
        else:
            polygon = None
        result.append({**b, 'footprint': polygon})
    return result


if __name__ == '__main__':
    geojson_path = 'data/Wisconsin.geojson'

    if not os.path.exists(geojson_path):
        print("Wisconsin.geojson not found.")
        print("Download from Microsoft Building Footprints dataset:")
        print("  https://github.com/microsoft/USBuildingFootprints")
        print("Save to etl/data/Wisconsin.geojson then re-run.")
        print()
        print("Running without footprints — all buildings will have footprint=null")
        footprints = []
    else:
        print(f"Loading footprints from {geojson_path}...")
        footprints = load_footprints(geojson_path)
        print(f"Loaded {len(footprints)} footprint polygons")

    with open('data/buildings_geocoded.json') as f:
        buildings = json.load(f)

    print(f"Matching {len(buildings)} buildings to footprints...")
    final = match_all_footprints(buildings, footprints)

    matched = sum(1 for b in final if b['footprint'] is not None)
    print(f"Matched {matched}/{len(final)} buildings to footprint polygons")

    os.makedirs('data', exist_ok=True)
    with open('data/buildings_final.json', 'w') as f:
        json.dump(final, f, indent=2)
    print("Saved to data/buildings_final.json")
