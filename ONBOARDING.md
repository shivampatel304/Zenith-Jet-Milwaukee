# Milwaukee Covered Buildings — Project Handoff

> **Starting a new Claude session?** Point Claude at this file: *"Read ONBOARDING.md to get up to speed on this project."* It captures what the project is, how it's built, what's been done, the data, and how to run/deploy it.

**Owner:** Shivam Patel (Azzera) · **Repo:** https://github.com/shivampatel304/Zenith-Jet-Milwaukee (deploy/push as the `shivampatel304` account via the `github-personal` SSH host)
**Local path:** `/Users/shivam/Techiieee/milwaukee-building-platform`

---

## 1. What this is

A 3D interactive map of **826 Milwaukee covered buildings** for Azzera's marketing team. It shows every building color-coded by **contact-research status**, who owns/manages it, which buildings share an owner (portfolio arcs), and lets the team export contact data to load into **Go High Level (GHL)** — their email CRM. The platform does **not** send email; it researches, tracks, and exports.

Built by rewriting the architecture of a reference project ("Zenith 21-042", a Montréal building map) — vanilla JS, no build step, fully keyless, static JSON data.

## 2. Quick start

**Run locally** (must be over HTTP — `file://` won't load the data):
```
cd map && python3 -m http.server 8080
# open http://localhost:8080
```
Note: the 6-digit PIN gate does **not** run locally (it's a Vercel function). Locally you go straight to the map.

**Regenerate the data** (after editing the pipeline or contacts):
```
cd pipeline && python3 build_data.py
# full rebuild from scratch: python3 enrich_mprop.py && python3 build_data.py
```

## 3. Architecture & file map

```
map/                         ← the web app (vanilla JS, no build step)
  index.html                 ← HTML shell
  app.js                     ← the whole app (~2400 lines): deck.gl 9.4.0 + MapLibre 5.24.0 (from unpkg),
                               OpenFreeMap keyless tiles, sun shadows, 3D extrusions, portfolio arcs,
                               filters, search, detail panel, CSV export
  styles.css                 ← UI styles
  middleware.js              ← Vercel edge function: 6-digit PIN gate (site-wide) + export-code gate
  vercel.json                ← Vercel headers config
  .vercelignore              ← ensures data/ IS uploaded to Vercel (it's gitignored for git)
  .env.example               ← env var names for deployment
  data/                      ← GITIGNORED, generated. milwaukee_data.json + milwaukee_lots.geojson

pipeline/                    ← Python ETL (run locally, one-time / on update)
  parse_excel.py             ← Excel → buildings_raw.json (826 buildings)
  geocode.py                 ← Nominatim geocode (free, keyless) → lat/lon
  enrich_mprop.py            ← Milwaukee MPROP open data → owner, mailing addr, c/o manager, floors, year, units
  match_footprints.py        ← Microsoft Building Footprints → 3D polygons
  build_data.py              ← MERGES everything + web_contacts.json → map/data/*.json; derives contact_status
  web_contacts.json          ← CURATED hand/agent-researched contacts, keyed by entity id (VERSION CONTROLLED)
  contact_sources.csv        ← provenance: every value with role, confirmed/unverified status, source URL
  requirements.txt           ← requests, shapely, openpyxl, python-dotenv
  data/                      ← GITIGNORED intermediate JSON (buildings_raw/geocoded/mprop/matched)
```

**Data files are gitignored** (they contain contact data). Present locally; regenerate with the pipeline. The curated research (`web_contacts.json`, `contact_sources.csv`) IS committed.

## 4. Data model (`map/data/milwaukee_data.json`)

`{ meta, buildings[], entities[] }` — one building per row, one entity per owner (deduped by `owner_name.strip().upper()`, 584 unique owners).

- **building:** id (M00001), address, lat/lon, sector (class), building_type, priority (A/B/C), floors, floor_area_sqft/m2, year_built, taxkey, owner, entity (→ id), contact_status
- **entity:** id, name, kind, buildings[], mailing_address, property_manager, company_email/phone/website, contacts[], research_status
- **contact:** name, title, email, phone, role (owner/manager/leasing/other), email_source, email_inferred (bool)

## 5. Contact enrichment — the big effort

Contacts were researched from scratch (nothing pre-existed). All **free** sources (no Apollo/paid, no API keys):

1. **MPROP** (Milwaukee open data, `data.milwaukee.gov`, keyless CKAN API) — the backbone: owner, **mailing address** (every building), the **c/o manager**, floors/year/units/assessed. Matched 805/826. *(Has no coordinates — geocoding stays on Nominatim.)*
2. **Web research** (~65 parallel research agents across all 584 owners) — company website/phone/email + named owner/manager contacts. Web *search* surfaces emails; web *fetch* redacts them.
3. **Business registries** (Bizapedia/OpenCorporates/mailing-address matches) for the anonymous shell LLCs — registered agents + company matches.
4. **Pattern inference** (user-approved) — fills missing owner/manager emails from the company domain + detected local-part pattern; **flagged `email_inferred` / shown amber "unverified"**, and **never counts toward green**.

### Confidence color model (the map colors)
- 🟢 **green** `named contact` = a confirmed OWNER or MANAGER contact with phone or confirmed email
- 🔵 **blue** `company contact only` = a company/mailing/manager lead, no confirmed named person
- 🔴 **red** `no contact found` / `no owner found` = nothing reachable / no owner
- 🟡 **yellow** `not researched yet` = backlog (≈empty after pipeline)

### Role rule (IMPORTANT — client preference)
Client wants **owner + property manager**, NOT leasing brokers. `classify_role()` tags each contact; leasing brokers (Cushman, Colliers, CBRE, JLL, Founders 3, Boerke, etc.) are excluded from green, sorted last, shown dimmed. Explicit leasing words beat generic "Principal/Partner".

### Current coverage (as of last session)
| Metric | Value |
|---|---|
| Buildings reachable (phone or email) | **576 / 826 (69%)** |
| 🟢 Green (confirmed owner/manager contact) | **309** buildings |
| 🔵 Blue | 517 |
| Owners with a property manager resolved | 355 / 584 (60%) |
| Owners with any email (incl. inferred) | 257 |
| Buildings still unreachable (mailing-address only) | 250 (anonymous shell LLCs — no web presence; WI DFI is bot-blocked) |

The remaining ~250 are genuinely unreachable via free search (no website, no named principal, DFI authoritative data is bot-blocked). Only paths left: paid data (ruled out), manual WI DFI lookups (browser, one-by-one), or physical mail (all 826 have a mailing address).

## 6. Deployment (Vercel, free Hobby tier)

The app is a static site + one middleware function → fits Vercel's free plan. **Deploy via CLI from the local `map/` folder** (NOT git integration — the data is gitignored, so git deploys would have no data; also avoids exposing contact data if the repo is public).

```
cd map
npx vercel login                 # browser auth, once
npx vercel link                  # answers: existing project? N · directory? . · connect Git? N
# env vars (interactive — choose "Secret", value, Production):
npx vercel env add ACCESS_CODE production      # the team's 6-digit PIN, e.g. 123456
npx vercel env add EXPORT_CODE production       # 6-digit code to unlock CSV export, e.g. 654321
npx vercel env add SESSION_SECRET production    # a long random hex (openssl/node randomBytes(32))
npx vercel --prod                # prints the live URL
```
(Or set the three env vars in the Vercel dashboard → Project → Settings → Environment Variables → Production.)

**The 6-digit PIN gate (`middleware.js`):**
- Gates EVERY request including the data files. Fails closed (503 "Access is not configured") if `ACCESS_CODE` or `SESSION_SECRET` is missing.
- Session cookie lasts 7 days — refresh won't re-prompt; use `/__logout` to force the PIN again.
- CSV export is behind a SECOND code (`EXPORT_CODE`), unlocks for 8 hours.
- **Only runs on Vercel, never on local `http.server`.**

Env vars: `ACCESS_CODE` (team PIN), `EXPORT_CODE` (export PIN), `SESSION_SECRET` (signs cookies, ≥16 chars).

## 7. Key decisions / conventions

- Vanilla JS, no build step; keyless (OpenFreeMap tiles, AWS terrain). All data-driven.
- Status vocabulary is **space-separated** (`"named contact"`, not `named_contact`) — matches app.js STATUS map.
- Owner dedup by `name.strip().upper()`.
- Building height = floors × 3.5 + 6 m; type-based default when floors unknown.
- Inferred emails are clearly labeled and never flip a building green (green stays trustworthy).
- Email goes out via GHL, not the platform. CSV export carries role + email-status columns for GHL import.

## 8. What's left / possible next steps

- **Deploy** (user doing this now — CLI steps in §6).
- The ~250 unreachable shell LLCs → optional manual WI DFI pass, or accept mailing-only.
- Inferred emails → optional verification pass before loading into GHL.
- Possible future: in-app contact editing (currently read-only; research happens in the pipeline), multi-city support.

## 9. Resuming with Claude

In a new session: **"Read `ONBOARDING.md` in the milwaukee-building-platform repo and continue."** Claude also keeps persistent memory at `~/.claude/projects/-Users-shivam-Techiieee-milwaukee-building-platform/memory/` (project, contact-enrichment, role-preference, working-style). Working-style note: **act and finish, don't ask for permission** on this project; it's legitimate public-records B2B research.
