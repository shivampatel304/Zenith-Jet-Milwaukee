import { Router, Request, Response } from 'express';
import { getSupabase } from '../db/supabase';

const router = Router();

// GET /api/search?q= — search buildings by address, owner name, building name
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const q = ((req.query.q as string) || '').trim();

  if (q.length < 2) {
    res.json([]);
    return;
  }

  try {
    const supabase = getSupabase();
    const pattern = `%${q}%`;

    // Search buildings by address or building_name
    const { data: byAddress } = await supabase
      .from('buildings')
      .select('*, owner:owners(*), contact:building_contacts(*)')
      .or(`address.ilike.${pattern},building_name.ilike.${pattern},milwaukee_id.ilike.${pattern}`)
      .limit(20);

    // Search by owner name
    const { data: byOwner } = await supabase
      .from('buildings')
      .select('*, owner:owners(*), contact:building_contacts(*)')
      .filter('owner.name', 'ilike', pattern)
      .limit(20);

    // Merge and deduplicate by building id
    const all = [...(byAddress || []), ...(byOwner || [])];
    const seen = new Set<string>();
    const results = all.filter(b => {
      if (seen.has(b.id)) return false;
      seen.add(b.id);
      return true;
    }).slice(0, 20);

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Database unavailable' });
  }
});

export default router;
