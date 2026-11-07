// Vercel function. Supabase calls it when a new feedback request is created.
// It emails the customer their private feedback link.
const crypto = require('crypto');
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function sameSecret(got, want) {
  const a = Buffer.from(String(got || '')), b = Buffer.from('Bearer ' + String(want || ''));
  return want && a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!sameSecret(req.headers.authorization, process.env.WEBHOOK_SECRET)) return res.status(401).end();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { type, record } = body || {};
  if (type !== 'INSERT' || !record || record.status !== 'requested') return res.status(200).json({ skipped: 'not a new request' });
  if (!record.customer_email) return res.status(200).json({ skipped: 'no customer email' });
  const site = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (!site) return res.status(200).json({ skipped: 'SITE_URL is not set' });
  const shop = process.env.SHOP_NAME || 'our shop';
  const first = String(record.customer_name || '').split(' ')[0] || 'there';
  const what = record.kind === 'repair' ? 'repair' : 'purchase';
  const link = site + '/#feedback/' + record.token;
  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;line-height:1.5"><h2 style="margin:0 0 12px">How was your ' + what + '?</h2>' +
    '<p>Hello ' + esc(first) + ',</p><p>Thank you for choosing ' + esc(shop) + (record.item ? ' for your ' + esc(record.item) : '') + '. Would you tell us how it went? It takes less than a minute.</p>' +
    '<p><a href="' + esc(link) + '" style="display:inline-block;background:#FF7A1F;color:#0E1116;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Leave feedback</a></p>' +
    '<p style="color:#666;font-size:13px">Or open this link: ' + esc(link) + '</p><p>Thank you,<br>' + esc(shop) + '</p></div>';
  const text = 'Hello ' + first + ',\n\nThank you for choosing ' + shop + '. Would you tell us how your ' + what + ' went? ' + link + '\n\nThank you,\n' + shop;
  const payload = { from: process.env.FROM_EMAIL, to: [record.customer_email], subject: 'How was your ' + what + ' at ' + shop + '?', html, text };
  if (process.env.REPLY_TO) payload.reply_to = process.env.REPLY_TO;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!r.ok) { console.error('Resend error', r.status, await r.text()); return res.status(502).json({ error: 'email provider refused the request' }); }
  return res.status(200).json({ sent: true });
};
