import CONTACTS_DATA from '../../contacts.json';

const SUPABASE_URL = 'https://kmrywngatkxmwfghbazf.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imttcnl3bmdhdGt4bXdmZ2hiYXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2Njk3NDcsImV4cCI6MjA5MTI0NTc0N30.8BuC9RdvNuekTTDyyNdotoZJJU0DozhHul516R0JU5I';

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...opts.headers
    }
  });
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

export async function GET() {
  try {
    const data = await sb('contacts?select=id,company,first_name,last_name,title,phone,email,website,city,state,description,notes,revenue,employees,facebook,linkedin,business_type,status,call_notes,last_contacted,apt_date&order=id.asc&limit=500');
    return Response.json(data);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'update') {
      const { id, ...fields } = body;
      delete fields.action;
      const updates = { updated_at: new Date().toISOString() };
      const allowedFields = [
        'company', 'parent_company', 'first_name', 'last_name', 'title',
        'phone', 'email', 'website', 'city', 'state', 'description', 'notes',
        'revenue', 'employees', 'facebook', 'linkedin', 'business_type',
        'status', 'call_notes', 'last_contacted', 'apt_date'
      ];
      // Also accept camelCase versions for backward compat
      if (fields.callNotes !== undefined) updates.call_notes = fields.callNotes;
      if (fields.aptDate !== undefined) updates.apt_date = fields.aptDate;
      if (fields.lastContacted !== undefined) updates.last_contacted = fields.lastContacted;
      // Accept snake_case fields directly
      for (const key of allowedFields) {
        if (fields[key] !== undefined) updates[key] = fields[key];
      }
      await sb(`contacts?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        headers: { 'Prefer': 'return=minimal' }
      });
      return Response.json({ ok: true });
    }

    if (action === 'seed') {
      const rows = CONTACTS_DATA.map(c => ({
        id: c.id,
        company: c.company || '',
        parent_company: c.parentCompany || '',
        first_name: c.firstName || '',
        last_name: c.lastName || '',
        title: c.title || '',
        phone: c.phone || '',
        email: c.email || '',
        website: c.website || '',
        city: c.city || '',
        state: c.state || '',
        description: (c.description || '').slice(0, 800),
        notes: c.notes || '',
        revenue: c.revenue || '',
        employees: c.employees || '',
        facebook: c.facebook || '',
        linkedin: c.linkedin || '',
        business_type: c.businessType || '',
        status: 'new',
        call_notes: '',
        last_contacted: '',
        apt_date: ''
      }));
      for (let i = 0; i < rows.length; i += 50) {
        await sb('contacts', {
          method: 'POST',
          body: JSON.stringify(rows.slice(i, i + 50)),
          headers: { 'Prefer': 'resolution=ignore-duplicates,return=minimal' }
        });
      }
      return Response.json({ ok: true, seeded: rows.length });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
