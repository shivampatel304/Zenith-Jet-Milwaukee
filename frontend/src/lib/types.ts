// Shared TypeScript types for Milwaukee Building Intelligence Platform

export type ContactStatus =
  | 'named_contact'
  | 'company_only'
  | 'not_researched'
  | 'no_contact_found'
  | 'no_owner_found';

export type PriorityTier = 'A' | 'B' | 'C';

export type ColorMode = 'contact' | 'class' | 'buildingType' | 'owner';

export interface Owner {
  id: string;
  name: string;
  mailing_address: string | null;
  building_count: number;
  company_email: string | null;
  company_phone: string | null;
  company_website: string | null;
}

export interface BuildingContact {
  id: string;
  building_id: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: ContactStatus;
  updated_at: string;
}

export interface Building {
  id: string;
  milwaukee_id: string;
  taxkey: string | null;
  address: string;
  building_name: string | null;
  owner_id: string;
  owner: Owner;
  class: string | null;
  building_type: string | null;
  finished_area_sqft: number;
  floors: number | null;
  year_built: number | null;
  lat: number;
  lng: number;
  footprint: GeoJSON.Polygon | null;
  priority_tier: PriorityTier;
  contact: BuildingContact | null;
}

export interface FilterState {
  classes: string[];
  buildingTypes: string[];
  priorityTiers: PriorityTier[];
  contactStatuses: ContactStatus[];
  minArea: number | null;
  maxArea: number | null;
  ownerId: string | null;
  searchQuery: string;
}

export interface PortfolioData {
  owner: Owner;
  buildings: Building[];
}

// Label maps for display
export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  named_contact: 'Named contact',
  company_only: 'Company only',
  not_researched: 'Not researched',
  no_contact_found: 'No contact found',
  no_owner_found: 'No owner found',
};

export const PRIORITY_TIER_LABELS: Record<PriorityTier, string> = {
  A: 'A — Large (200k+ sq ft)',
  B: 'B — Medium (50k–200k sq ft)',
  C: 'C — Small (<50k sq ft)',
};

export function emptyFilters(): FilterState {
  return {
    classes: [],
    buildingTypes: [],
    priorityTiers: [],
    contactStatuses: [],
    minArea: null,
    maxArea: null,
    ownerId: null,
    searchQuery: '',
  };
}
