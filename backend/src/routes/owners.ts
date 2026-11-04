import { Router, Request, Response } from 'express';
import { getSupabase } from '../db/supabase';

const router = Router();

// GET /api/owners — all owners ordered by building_count DESC
router.get('/', async (_req: Request, res: Response): Promise<void> => {
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

    res.json(data);
  } catch {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// GET /api/owners/:id/portfolio — owner + all their buildings with contacts
router.get('/:id/portfolio', async (req: Request, res: Response): Promise<void> => {
  try {
    const supabase = getSupabase();

    const [ownerResult, buildingsResult] = await Promise.all([
      supabase.from('owners').select('*').eq('id', req.params.id).single(),
      supabase
        .from('buildings')
        .select('*, owner:owners(*), contact:building_contacts(*)')
        .eq('owner_id', req.params.id),
    ]);

    if (ownerResult.error || !ownerResult.data) {
      res.status(404).json({ error: 'Owner not found' });
      return;
    }

    res.json({
      owner: ownerResult.data,
      buildings: buildingsResult.data || [],
    });
  } catch {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// PUT /api/owners/:id/company — save company-level contact info
router.put('/:id/company', async (req: Request, res: Response): Promise<void> => {
  try {
    const { company_email, company_phone, company_website } = req.body as {
      company_email?: string;
      company_phone?: string;
      company_website?: string;
    };

    const payload: Record<string, unknown> = {};
    if (company_email !== undefined) payload.company_email = company_email;
    if (company_phone !== undefined) payload.company_phone = company_phone;
    if (company_website !== undefined) payload.company_website = company_website;

    const supabase = getSupabase();
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
  } catch {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

export default router;
