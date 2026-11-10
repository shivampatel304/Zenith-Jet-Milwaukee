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
# Per-BUILDING owner + property-manager contacts (one entry per building id).
# The client's rule: property manager is building-specific (the same owner can use a
# different manager at each building), and leasing brokers are excluded entirely.
BUILDING_CONTACTS_PATH = 'building_contacts.json'
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


# Contact role classification. The client wants OWNER and PROPERTY-MANAGER contacts,
# not leasing brokers — so we tag each contact and keep brokers out of "green".
# Explicit leasing words in a title win even when it also says "Principal"/"Partner"
# (e.g. "Principal, Cushman & Wakefield (leasing)" is a broker, not an owner).
LEASING_WORD_RE = re.compile(
    r'\b(leasing|broker|brokerage|listing\s+agent|real\s+estate\s+advisor|advisor|'
    r'sales\s+associate)\b', re.IGNORECASE)
# Pure leasing-brokerage firms (names with no owner/developer arm in this dataset).
LEASING_FIRM_RE = re.compile(
    r'\b(cushman|wakefield|colliers|\bjll\b|newmark|boerke|founders\s*3|'
    r'marcus\s*&?\s*millichap|mlg\s+commercial|first\s+weber)\b', re.IGNORECASE)
OWNER_RE = re.compile(
    r'\b(owner|principal|president|ceo|cfo|coo|founder|managing\s+member|member|'
    r'partner|proprietor|chairman|managing\s+director)\b', re.IGNORECASE)
MANAGER_RE = re.compile(
    r'\b(property\s+manager|general\s+manager|building\s+manager|asset\s+manager|'
    r'community\s+manager|regional\s+manager|portfolio\s+manager|management|'
    r'director\s+of\s+real\s+estate|facilities)\b', re.IGNORECASE)
ROLE_RANK = {'owner': 0, 'manager': 1, 'other': 2, 'leasing': 3}


def classify_role(title: str | None) -> str:
    t = title or ''
    # Explicit leasing signals win over generic owner/partner words.
    if LEASING_WORD_RE.search(t) or LEASING_FIRM_RE.search(t):
        return 'leasing'
    if MANAGER_RE.search(t):
        return 'manager'
    if OWNER_RE.search(t):
        return 'owner'
    return 'other'


# ---- email pattern inference (opt-in; produces clearly-labeled unverified emails) ----

def _name_parts(name: str):
    toks = re.sub(r'[^A-Za-z\s]', '', name or '').split()
    return (toks[0].lower(), toks[-1].lower()) if len(toks) >= 2 else (
        (toks[0].lower(), '') if toks else ('', ''))


def _domain_of(url_or_email: str | None):
    if not url_or_email:
        return None
    s = str(url_or_email)
    if '@' in s:
        return s.split('@')[-1].strip().lower().strip('/')
    m = re.search(r'https?://(?:www\.)?([^/]+)', s)
    return m.group(1).lower() if m else None


def _derive_pattern(name: str, email: str):
    """Infer the local-part pattern of a company from a known name→email."""
    first, last = _name_parts(name)
    local = email.split('@')[0].lower()
    if not first:
        return None
    fi = first[0]
    cand = {
        'first': first, 'last': last, 'first.last': f'{first}.{last}',
        'flast': f'{fi}{last}', 'firstlast': f'{first}{last}',
        'f.last': f'{fi}.{last}', 'firstl': f'{first}{last[0] if last else ""}',
        'first_last': f'{first}_{last}',
    }
    for pat, val in cand.items():
        if val and val == local:
            return pat
    return None


def _make_local(name: str, pattern: str):
    first, last = _name_parts(name)
    if not first:
        return None
    fi = first[0]
    return {
        'first': first, 'last': last or first, 'first.last': f'{first}.{last}' if last else first,
        'flast': f'{fi}{last}' if last else first, 'firstlast': f'{first}{last}',
        'f.last': f'{fi}.{last}' if last else first, 'firstl': f'{first}{last[0]}' if last else first,
        'first_last': f'{first}_{last}' if last else first,
    }.get(pattern)


def infer_contact_emails(entity: dict):
    """Fill missing owner/manager contact emails using the company's domain + pattern.
    Every inferred email is flagged email_inferred=True ('pattern — unverified')."""
    contacts = entity.get('contacts', [])
    # Domain: prefer one proven by an existing email on this entity.
    proven = (entity.get('company_email')
              or next((c['email'] for c in contacts if c.get('email')), None))
    domain = _domain_of(proven) or _domain_of(entity.get('company_website'))
    if not domain:
        return
    # Pattern: derive from a confirmed person→email on the same domain, else default.
    pattern = None
    for c in contacts:
        if c.get('email') and not c.get('email_inferred') and _domain_of(c['email']) == domain:
            pattern = _derive_pattern(c.get('name') or '', c['email'])
            if pattern:
                break
    pattern = pattern or 'first.last'
    for c in contacts:
        if c.get('role') == 'leasing':
            continue
        if c.get('email') or not (c.get('name') or '').strip():
            continue
        local = _make_local(c['name'], pattern)
        if not local:
            continue
        c['email'] = f'{local}@{domain}'
        c['email_inferred'] = True
        c['email_source'] = f'pattern — unverified ({pattern}@{domain})'


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
    bld_contacts = {}
    if os.path.exists(BUILDING_CONTACTS_PATH):
        with open(BUILDING_CONTACTS_PATH) as f:
            bld_contacts = json.load(f)
        print(f'Loaded building_contacts for {len(bld_contacts)} buildings')
    # fold MPROP fields into the matched records
    for b in matched:
        m = mprop_by_id.get(b['milwaukee_id'])
        if m:
            for k in ('mprop_owner', 'mprop_co', 'mprop_mail', 'mprop_floors',
                      'mprop_units', 'mprop_year_built', 'mprop_area_sqft',
                      'mprop_assessed', 'mprop_zoning'):
                b[k] = m.get(k)
    return matched, web, bld_contacts


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
                'role': classify_role(c.get('title')),
                'email_source': c.get('source') or c.get('email_source'),
            })
        # Owner/manager first, leasing brokers last — so the shown "best contact"
        # is never a broker when a real owner/manager contact exists.
        contacts.sort(key=lambda c: ROLE_RANK.get(c['role'], 2))

        entity = {
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
        }
        # Fill missing owner/manager emails by pattern (clearly flagged unverified).
        infer_contact_emails(entity)
        entities.append(entity)
    return entities


def best_named_contact(e: dict) -> bool:
    """True when the entity has an OWNER or PROPERTY-MANAGER named person reachable
    by phone or a CONFIRMED email. Leasing brokers and pattern-inferred (unverified)
    emails do not count toward 'green' — green must stay trustworthy."""
    for c in e.get('contacts', []):
        if c.get('role') == 'leasing':
            continue
        confirmed_email = c.get('email') and not c.get('email_inferred')
        if (c.get('name') or '').strip() and (c.get('phone') or confirmed_email):
            return True
    return False


def has_company_lead(e: dict) -> bool:
    return bool(e.get('company_email') or e.get('company_phone')
               or e.get('company_website') or e.get('mailing_address')
               or e.get('property_manager'))


def _contact_strength(block: dict | None) -> str | None:
    """How reachable a building-level owner/manager contact is:
    'strong'  = a confirmed email, or a named person with a phone (→ green)
    'company' = a phone or firm/self-managed lead, but no email and no named person (→ blue)
    None      = nothing usable."""
    if not block:
        return None
    if block.get('email'):
        return 'strong'
    if (block.get('name') or '').strip() and block.get('phone'):
        return 'strong'
    if block.get('phone') or block.get('firm') or block.get('self_managed'):
        return 'company'
    return None


def contact_status_for(b: dict, e: dict) -> str:
    """Confidence model, driven by BUILDING-level owner + property-manager contacts
    (falls back to the owner entity for a company/mailing lead):
      green named  = a verified email, or a named owner/manager + phone
      blue company = a company/phone/self-managed lead, no named person or email
      red          = owner known but nothing reachable / no owner at all."""
    if not (b.get('owner') or (e and e.get('name') and e['name'] != '(unknown)')):
        return 'no owner found'           # red
    strengths = {_contact_strength(b.get('owner_contact')),
                 _contact_strength(b.get('property_manager'))}
    if 'strong' in strengths:
        return 'named contact'            # green — verified email or named person + phone
    if 'company' in strengths or (e and has_company_lead(e)):
        return 'company contact only'     # blue — a lead, no named/email
    return 'no contact found'             # red — owner but nothing reachable


def _clean_contact(block: dict | None) -> dict | None:
    """Keep only the fields the app shows; drop empty blocks."""
    if not isinstance(block, dict):
        return None
    out = {k: block.get(k) for k in ('firm', 'name', 'title', 'email', 'phone',
                                     'source', 'self_managed')}
    if not any(out.get(k) for k in ('firm', 'name', 'email', 'phone')):
        return None
    return out


def build_buildings(matched: list[dict], entity_by_slug: dict,
                    bld_contacts: dict) -> list[dict]:
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
        bc = bld_contacts.get(b['milwaukee_id'], {})
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
            # Building-level contacts (client rule: PM is per building, no leasing brokers)
            'owner_contact': _clean_contact(bc.get('owner')),
            'property_manager': _clean_contact(bc.get('manager')),
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
    matched, web, bld_contacts = load_inputs()
    assert len(matched) == 826, f'expected 826 buildings, got {len(matched)}'

    entities = deduplicate_entities(matched, web)
    entity_by_slug = {e['id']: e for e in entities}

    buildings = build_buildings(matched, entity_by_slug, bld_contacts)
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
    owner_email = sum(1 for b in buildings if (b.get('owner_contact') or {}).get('email'))
    mgr_present = sum(1 for b in buildings if b.get('property_manager'))
    mgr_email = sum(1 for b in buildings if (b.get('property_manager') or {}).get('email'))
    print(f'{len(buildings)} buildings · {len(entities)} entities')
    print(f'footprints: {len(lots["features"])}')
    print(f'building-level: owner email {owner_email} · property manager {mgr_present} '
          f'(mgr email {mgr_email})')
    print('contact_status breakdown:')
    for s in CONTACT_STATUS_VALUES:
        print(f'  {s:22} {status_counts.get(s, 0)}')
    print(f'Wrote {MAP_DATA_DIR}/milwaukee_data.json + milwaukee_lots.geojson')


if __name__ == '__main__':
    main()
