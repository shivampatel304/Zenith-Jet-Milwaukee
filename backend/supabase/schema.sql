-- Milwaukee Building Intelligence Platform — Database Schema
-- Run this once in Supabase SQL Editor

create extension if not exists "uuid-ossp";

-- Owners: one record per unique legal owner (deduplicated by name)
create table if not exists owners (
  id                uuid primary key default uuid_generate_v4(),
  name              text not null unique,
  mailing_address   text,
  building_count    integer default 0,
  -- Company-level contact (applies to all buildings owned by this entity)
  company_email     text,
  company_phone     text,
  company_website   text,
  created_at        timestamptz default now()
);

-- Buildings: one record per row in the Milwaukee covered buildings list
create table if not exists buildings (
  id                   uuid primary key default uuid_generate_v4(),
  milwaukee_id         text not null unique,   -- M00001 format
  taxkey               text,                   -- Milwaukee parcel identifier
  address              text not null,          -- taxkeyaddress (primary)
  building_name        text,                   -- named landmarks only
  owner_id             uuid references owners(id),
  class                text,                   -- e.g. "2 - Local Commercial"
  building_type        text,                   -- e.g. "C021 - AP4 ..."
  finished_area_sqft   integer,
  floors               integer,                -- from MPROP enrichment
  year_built           integer,                -- from MPROP enrichment
  lat                  float,
  lng                  float,
  footprint            jsonb,                  -- GeoJSON Polygon for 3D extrusion
  priority_tier        text check (priority_tier in ('A','B','C')),
  created_at           timestamptz default now()
);

-- Building contacts: individual contact per building (on-site manager, agent)
-- Separate from owner company contact above
create table if not exists building_contacts (
  id            uuid primary key default uuid_generate_v4(),
  building_id   uuid references buildings(id) unique,
  contact_name  text,
  email         text,
  phone         text,
  notes         text,
  status        text not null default 'not_researched'
                  check (status in (
                    'named_contact',
                    'company_only',
                    'not_researched',
                    'no_contact_found',
                    'no_owner_found'
                  )),
  updated_at    timestamptz default now()
);

-- Indexes for common query patterns
create index if not exists idx_buildings_owner_id on buildings(owner_id);
create index if not exists idx_building_contacts_building_id on building_contacts(building_id);
create index if not exists idx_buildings_priority on buildings(priority_tier);
create index if not exists idx_building_contacts_status on building_contacts(status);
