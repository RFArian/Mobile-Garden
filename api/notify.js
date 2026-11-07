// Vercel function. Supabase calls it when a new row is added to orders, repair_bookings, messages or feedback.
//  orders          -> email to the owner, and an "order placed" confirmation to the customer
//  repair_bookings -> email to the owner
//  messages        -> email to the owner (contact page)
//  feedback        -> thank-you email with the feedback link to the customer (after Collected / Completed)
const crypto = require('crypto');
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function sameSecret(got, want) {
  const a = Buffer.from(String(got || '')), b = Buffer.from('Bearer ' + String(want || ''));
  return want && a.length === b.length && crypto.timingSafeEqual(a, b);
}
const shop = () => process.env.SHOP_NAME || 'our shop';
const site = () => (process.env.SITE_URL || '').replace(/\/$/, '');
const money = (n) => (process.env.CURRENCY || '\u09F3') + ' ' + Number(n || 0).toLocaleString('en-IN');
const owners = () => String(process.env.OWNER_EMAIL || '').split(',').map((x) => x.trim()).filter(Boolean);
const wrap = (inner) => '<div style="font-family:Arial,sans-serif;max-width:540px;line-height:1.5">' + inner + '</div>';
const table = (pairs) => '<table style="border-collapse:collapse">' + pairs.filter((p) => p[1] !== undefined && p[1] !== null && p[1] !== '')
  .map((p) => '<tr><td style="padding:4px 16px 4px 0;vertical-align:top"><b>' + p[0] + '</b></td><td>' + esc(p[1]) + '</td></tr>').join('') + '</table>';
const plain = (pairs) => pairs.filter((p) => p[1] !== undefined && p[1] !== null && p[1] !== '').map((p) => p[0] + ': ' + p[1]).join('\n');
const dash = () => (site() ? '<p><a href="' + esc(site()) + '/#admin">Open the owner dashboard</a></p>' : '');

async function send(payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.FROM_EMAIL, ...payload }),
  });
  if (!r.ok) { console.error('Resend error', r.status, await r.text()); return false; }
  return true;
}
const replyTo = () => (process.env.REPLY_TO ? { reply_to: process.env.REPLY_TO } : {});

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!sameSecret(req.headers.authorization, process.env.WEBHOOK_SECRET)) return res.status(401).end();
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const { type, table: tbl, record: r } = body || {};
  if (type !== 'INSERT' || !r) return res.status(200).json({ skipped: 'not a new row' });
  const sent = [];
  let ok = true;

  if (tbl === 'orders') {
    const ref = String(r.id || '').slice(0, 8).toUpperCase();
    const rows = [['Phone', r.product_name], ['Price', money(r.price)], ['Customer', r.name], ['Phone number', r.phone], ['Email', r.email], ['Note', r.note], ['Reference', ref]];
    if (owners().length) {
      ok = (await send({ to: owners(), subject: 'New order: ' + r.product_name + ' (' + r.name + ')',
        html: wrap('<h2 style="margin:0 0 12px">New order</h2>' + table(rows) + dash() + '<p style="color:#666;font-size:13px">Reply to this email to write to the customer.</p>'),
        text: 'New order\n\n' + plain(rows), ...(r.email ? { reply_to: r.email } : {}) })) && ok;
      sent.push('owner');
    }
    if (r.email) {
      const mine = [['Item', r.product_name], ['Price', money(r.price)], ['Reference', ref]];
      ok = (await send({ to: [r.email], subject: 'Your order has been placed: ' + r.product_name,
        html: wrap('<h2 style="margin:0 0 12px">Your order has been placed</h2><p>Hello ' + esc(String(r.name || '').split(' ')[0]) + ',</p><p>Thank you for your order at ' + esc(shop()) + '.</p>' + table(mine) +
          '<p>We will call you on ' + esc(r.phone) + ' to confirm. You pay in the shop when you collect it.</p><p>If you have a question, just reply to this email.</p><p>Thank you,<br>' + esc(shop()) + '</p>'),
        text: 'Hello ' + String(r.name || '').split(' ')[0] + ',\n\nYour order has been placed at ' + shop() + '.\n\n' + plain(mine) + '\n\nWe will call you on ' + r.phone + ' to confirm. You pay in the shop when you collect it.\n\n' + shop(),
        ...replyTo() })) && ok;
      sent.push('customer');
    }
  } else if (tbl === 'repair_bookings') {
    if (!owners().length) return res.status(200).json({ skipped: 'OWNER_EMAIL is not set' });
    const rows = [['Repair', r.service], ['Phone model', r.device], ['Preferred date', r.date], ['Time', r.time], ['Customer', r.name], ['Phone number', r.phone], ['Email', r.email], ['Notes', r.notes]];
    ok = await send({ to: owners(), subject: 'New repair booking: ' + r.service + ' (' + r.name + ')',
      html: wrap('<h2 style="margin:0 0 12px">New repair booking</h2>' + table(rows) + dash()), text: 'New repair booking\n\n' + plain(rows), ...(r.email ? { reply_to: r.email } : {}) });
    sent.push('owner');
  } else if (tbl === 'messages') {
    if (!owners().length) return res.status(200).json({ skipped: 'OWNER_EMAIL is not set' });
    ok = await send({ to: owners(), subject: 'New message from ' + r.name,
      html: wrap('<h2 style="margin:0 0 12px">New message from the website</h2>' + table([['From', r.name], ['Email', r.email]]) + '<p style="white-space:pre-line;border-left:3px solid #FF7A1F;padding-left:12px">' + esc(r.message) + '</p>' + dash() + '<p style="color:#666;font-size:13px">Reply to this email to answer the customer.</p>'),
      text: 'New message from ' + r.name + ' (' + r.email + ')\n\n' + r.message, reply_to: r.email });
    sent.push('owner');
  } else if (tbl === 'feedback') {
    if (r.status !== 'requested' || !r.customer_email || !site()) return res.status(200).json({ skipped: 'no feedback email needed' });
    const first = String(r.customer_name || '').split(' ')[0] || 'there', what = r.kind === 'repair' ? 'repair' : 'purchase', link = site() + '/#feedback/' + r.token;
    ok = await send({ to: [r.customer_email], subject: 'Thank you from ' + shop(),
      html: wrap('<h2 style="margin:0 0 12px">Thank you</h2><p>Hello ' + esc(first) + ',</p><p>Thank you for your ' + what + (r.item ? ' (' + esc(r.item) + ')' : '') + ' at ' + esc(shop()) + '. We hope you are happy with it.</p><p>Would you tell us how it went? It takes less than a minute.</p>' +
        '<p><a href="' + esc(link) + '" style="display:inline-block;background:#FF7A1F;color:#0E1116;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Leave feedback</a></p><p style="color:#666;font-size:13px">Or open this link: ' + esc(link) + '</p><p>Thank you,<br>' + esc(shop()) + '</p>'),
      text: 'Hello ' + first + ',\n\nThank you for your ' + what + ' at ' + shop() + '. Would you tell us how it went? ' + link + '\n\nThank you,\n' + shop(), ...replyTo() });
    sent.push('customer');
  } else {
    return res.status(200).json({ skipped: 'unknown table' });
  }
  return ok ? res.status(200).json({ sent }) : res.status(502).json({ error: 'email provider refused a request' });
};
