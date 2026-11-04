import type { Building, BuildingContact, Owner, PortfolioData } from './types';

const BASE = import.meta.env.VITE_API_URL || '';

async function fetchJson<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include', // send session cookie on every request
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    await fetchJson('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function getBuildings(): Promise<Building[]> {
  return fetchJson<Building[]>('/api/buildings');
}

export async function getBuilding(id: string): Promise<Building> {
  return fetchJson<Building>(`/api/buildings/${id}`);
}

export async function getOwnerPortfolio(ownerId: string): Promise<PortfolioData> {
  return fetchJson<PortfolioData>(`/api/owners/${ownerId}/portfolio`);
}

export async function getOwners(): Promise<Owner[]> {
  return fetchJson<Owner[]>('/api/owners');
}

export async function searchBuildings(q: string): Promise<Building[]> {
  return fetchJson<Building[]>(`/api/search?q=${encodeURIComponent(q)}`);
}

export async function saveContact(
  buildingId: string,
  fields: Partial<BuildingContact>
): Promise<BuildingContact> {
  return fetchJson<BuildingContact>(`/api/buildings/${buildingId}/contact`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

export async function saveCompanyContact(
  ownerId: string,
  fields: Partial<Owner>
): Promise<Owner> {
  return fetchJson<Owner>(`/api/owners/${ownerId}/company`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

export function exportBuildingsUrl(): string {
  return `${BASE}/api/export/buildings`;
}

export function exportOwnersUrl(): string {
  return `${BASE}/api/export/owners`;
}
