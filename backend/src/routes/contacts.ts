import { Router, Request, Response } from 'express';
import { getSupabase } from '../db/supabase';

const router = Router({ mergeParams: true });

const VALID_STATUSES = [
  'named_contact',
  'company_only',
  'not_researched',
  'no_contact_found',
  'no_owner_found',
] as const;

// GET /api/buildings/:id/contact
router.get('/buildings/:id/contact', async (req: Request, res: Response): Promise<void> => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('building_contacts')
      .select('*')
      .eq('building_id', req.params.id)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Contact not found' });
      return;
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// PUT /api/buildings/:id/contact — save individual contact for a building
router.put('/buildings/:id/contact', async (req: Request, res: Response): Promise<void> => {
  try {
    const { contact_name, email, phone, notes, status } = req.body as {
      contact_name?: string;
      email?: string;
      phone?: string;
      notes?: string;
      status?: string;
    };

    if (status && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      return;
    }

    const supabase = getSupabase();

    const payload: Record<string, unknown> = {
      building_id: req.params.id,
      updated_at: new Date().toISOString(),
    };
    if (contact_name !== undefined) payload.contact_name = contact_name;
    if (email !== undefined) payload.email = email;
    if (phone !== undefined) payload.phone = phone;
    if (notes !== undefined) payload.notes = notes;
    if (status !== undefined) payload.status = status;

    const { data, error } = await supabase
      .from('building_contacts')
      .upsert(payload, { onConflict: 'building_id' })
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({ error: error?.message || 'Failed to save contact' });
      return;
    }

    // Return the full saved record (critical for concurrent-edit detection by client)
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// PUT /api/owners/:id/company — save company-level contact for an owner
router.put('/owners/:id/company', async (req: Request, res: Response): Promise<void> => {
  try {
    const { company_email, company_phone, company_website } = req.body as {
      company_email?: string;
      company_phone?: string;
      company_website?: string;
    };

    const supabase = getSupabase();

    const payload: Record<string, unknown> = {};
    if (company_email !== undefined) payload.company_email = company_email;
    if (company_phone !== undefined) payload.company_phone = company_phone;
    if (company_website !== undefined) payload.company_website = company_website;

    const { data, error } = await supabase
      .from('owners')
      .update(payload)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({ error: error?.message || 'Failed to save company contact' });
      return;
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

export default router;
