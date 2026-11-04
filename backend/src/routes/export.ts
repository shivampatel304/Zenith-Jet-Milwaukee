import { Router, Request, Response } from 'express';
import { getSupabase } from '../db/supabase';

const router = Router();

function escapeCsv(val: unknown): string {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRow(values: unknown[]): string {
  return values.map(escapeCsv).join(',');
}

// GET /api/export/buildings — download all buildings as CSV
router.get('/buildings', async (_req: Request, res: Response): Promise<void> => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('buildings')
      .select('*, owner:owners(*), contact:building_contacts(*)')
      .order('address');

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const headers = [
      'milwaukee_id', 'taxkey', 'address', 'building_name',
      'class', 'building_type', 'finished_area_sqft', 'floors',
      'year_built', 'priority_tier', 'lat', 'lng',
      'owner_name', 'owner_address',
      'company_email', 'company_phone',
      'contact_name', 'email', 'phone', 'status', 'notes',
    ];

    const rows = (data || []).map(b => buildCsvRow([
      b.milwaukee_id, b.taxkey, b.address, b.building_name,
      b.class, b.building_type, b.finished_area_sqft, b.floors,
      b.year_built, b.priority_tier, b.lat, b.lng,
      b.owner?.name, b.owner?.mailing_address,
      b.owner?.company_email, b.owner?.company_phone,
      b.contact?.contact_name, b.contact?.email, b.contact?.phone,
      b.contact?.status, b.contact?.notes,
    ]));

    const csv = [buildCsvRow(headers), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="milwaukee-buildings.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// GET /api/export/owners — download all owners as CSV
router.get('/owners', async (_req: Request, res: Response): Promise<void> => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('owners')
      .select('*')
      .order('building_count', { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const headers = [
      'name', 'mailing_address', 'building_count',
      'company_email', 'company_phone', 'company_website',
    ];

    const rows = (data || []).map(o => buildCsvRow([
      o.name, o.mailing_address, o.building_count,
      o.company_email, o.company_phone, o.company_website,
    ]));

    const csv = [buildCsvRow(headers), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="milwaukee-owners.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

export default router;
