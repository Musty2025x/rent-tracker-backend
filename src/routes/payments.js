const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

function genReceiptNo() {
  const ts   = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RCT-${ts}-${rand}`;
}

// GET /api/payments?property_id=X
router.get('/', async (req, res) => {
  const { property_id } = req.query;
  try {
    let sql = `
      SELECT
        pay.id, pay.lease_id, pay.property_id, pay.tenant_id,
        pay.amount, pay.note, pay.receipt_no, pay.created_at,
        TO_CHAR(pay.paid_date, 'YYYY-MM-DD') AS paid_date,
        p.address, p.city,
        t.name AS tenant_name, t.occupation
      FROM payments pay
      JOIN properties p ON p.id = pay.property_id
      JOIN tenants    t ON t.id = pay.tenant_id
      WHERE p.user_id = $1
    `;
    const params = [req.user.id];
    if (property_id) { sql += ' AND pay.property_id = $2'; params.push(property_id); }
    sql += ' ORDER BY pay.paid_date DESC, pay.created_at DESC';
    const result = await query(sql, params);
    res.json({ payments: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch payments.' });
  }
});

// POST /api/payments
router.post('/', [
  body('lease_id').isInt(),
  body('amount').isNumeric(),
  body('paid_date').isDate(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { lease_id, amount, paid_date, note } = req.body;
  try {
    const leaseCheck = await query(`
      SELECT l.id, l.property_id, l.tenant_id
      FROM leases l
      JOIN properties p ON p.id = l.property_id
      WHERE l.id = $1 AND p.user_id = $2
    `, [lease_id, req.user.id]);

    if (!leaseCheck.rows.length)
      return res.status(403).json({ error: 'Lease not found or access denied.' });

    const { property_id, tenant_id } = leaseCheck.rows[0];
    const receipt_no = genReceiptNo();

    const result = await query(
      `INSERT INTO payments (lease_id,property_id,tenant_id,amount,paid_date,note,receipt_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, lease_id, property_id, tenant_id, amount, note, receipt_no, created_at,
                 TO_CHAR(paid_date, 'YYYY-MM-DD') AS paid_date`,
      [lease_id, property_id, tenant_id, amount, paid_date, note || null, receipt_no]
    );
    res.status(201).json({ payment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record payment.' });
  }
});

// GET /api/payments/:id/receipt
router.get('/:id/receipt', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        pay.id, pay.amount, pay.note, pay.receipt_no,
        TO_CHAR(pay.paid_date, 'YYYY-MM-DD') AS paid_date,
        p.address, p.city, p.state, p.country,
        t.name AS tenant_name, t.occupation, t.phone AS tenant_phone,
        TO_CHAR(l.start_date, 'YYYY-MM-DD') AS start_date,
        TO_CHAR(l.end_date,   'YYYY-MM-DD') AS end_date,
        l.yearly_rent
      FROM payments pay
      JOIN properties p ON p.id = pay.property_id
      JOIN tenants    t ON t.id = pay.tenant_id
      JOIN leases     l ON l.id = pay.lease_id
      WHERE pay.id = $1 AND p.user_id = $2
    `, [req.params.id, req.user.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Payment not found.' });
    res.json({ receipt: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/payments/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(`
      DELETE FROM payments pay
      USING properties p
      WHERE pay.property_id = p.id AND pay.id = $1 AND p.user_id = $2
      RETURNING pay.id
    `, [req.params.id, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Payment not found.' });
    res.json({ message: 'Payment deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
