import { Router, Request, Response } from 'express';
import { getSupabase } from '../db/supabase';

const router = Router();

const VALID_STATUSES = [
  'named_contact',
  'company_only',
  'not_researched',
  'no_contact_found',
  'no_owner_found',
] as const;

// GET /api/buildings — all buildings with nested owner + contact
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('buildings')
      .select(`*, owner:owners(*), contact:building_contacts(*)`)
      .order('address');

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json(data);
  } catch {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// GET /api/buildings/:id — single building with full detail
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('buildings')
      .select(`*, owner:owners(*), contact:building_contacts(*)`)
      .eq('id', req.params.id)
      .single();

    if (error || !data) {
      res.status(404).json({ error: 'Building not found' });
      return;
    }

    res.json(data);
  } catch {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// GET /api/buildings/:id/contact — individual contact for a building
router.get('/:id/contact', async (req: Request, res: Response): Promise<void> => {
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
  } catch {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// PUT /api/buildings/:id/contact — save individual contact (upsert)
router.put('/:id/contact', async (req: Request, res: Response): Promise<void> => {
  try {
    const { contact_name, email, phone, notes, status } = req.body as {
      contact_name?: string;
      email?: string;
      phone?: string;
      notes?: string;
      status?: string;
    };

    if (status && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      res.status(400).json({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      });
      return;
    }

    const payload: Record<string, unknown> = {
      building_id: req.params.id,
      updated_at: new Date().toISOString(),
    };
    if (contact_name !== undefined) payload.contact_name = contact_name;
    if (email !== undefined) payload.email = email;
    if (phone !== undefined) payload.phone = phone;
    if (notes !== undefined) payload.notes = notes;
    if (status !== undefined) payload.status = status;

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('building_contacts')
      .upsert(payload, { onConflict: 'building_id' })
      .select()
      .single();

    if (error || !data) {
      res.status(500).json({ error: error?.message || 'Failed to save contact' });
      return;
    }

    // Always return the full saved record so clients can confirm persisted state
    res.json(data);
  } catch {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

export default router;
