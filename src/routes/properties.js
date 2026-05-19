const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();
// All routes require auth
router.use(auth);

// GET /api/properties  — list all with tenant + lease summary
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        p.id, p.address, p.city, p.state, p.country, p.created_at,
        t.id          AS tenant_id,
        t.name        AS tenant_name,
        t.occupation,
        t.phone       AS tenant_phone,
        t.email       AS tenant_email,
        t.notes,
        l.id          AS lease_id,
        l.move_in_date,
        l.start_date,
        l.end_date,
        l.yearly_rent,
        l.duration_months,
        l.status      AS lease_status,
        COALESCE(SUM(pay.amount), 0) AS total_paid,
        COUNT(pay.id)                AS payment_count
      FROM properties p
      LEFT JOIN tenants t   ON t.property_id = p.id
      LEFT JOIN leases  l   ON l.property_id = p.id AND l.status = 'active'
      LEFT JOIN payments pay ON pay.lease_id = l.id
      WHERE p.user_id = $1
      GROUP BY p.id, t.id, l.id
      ORDER BY p.created_at DESC
    `, [req.user.id]);
    res.json({ properties: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch properties.' });
  }
});

// POST /api/properties  — create property + tenant + lease in one shot
router.post('/', [
  body('address').trim().notEmpty(),
  body('city').trim().notEmpty(),
  body('state').trim().notEmpty(),
  body('tenant_name').trim().notEmpty(),
  body('move_in_date').isDate(),
  body('start_date').isDate(),
  body('yearly_rent').isNumeric(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    address, city, state, country = 'Nigeria',
    tenant_name, occupation, phone, email, notes,
    move_in_date, start_date, yearly_rent, duration_months = 12,
  } = req.body;

  const client = await require('../db/pool').getClient();
  try {
    await client.query('BEGIN');

    // Check 5-property limit per user
    const count = await client.query('SELECT COUNT(*) FROM properties WHERE user_id=$1', [req.user.id]);
    if (parseInt(count.rows[0].count) >= 5) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Maximum of 5 properties allowed.' });
    }

    const prop = await client.query(
      'INSERT INTO properties (user_id,address,city,state,country) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.id, address, city, state, country]
    );
    const propId = prop.rows[0].id;

    const tenant = await client.query(
      'INSERT INTO tenants (property_id,name,occupation,phone,email,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [propId, tenant_name, occupation || null, phone || null, email || null, notes || null]
    );
    const tenantId = tenant.rows[0].id;

    // Calculate end date
    const endDate = new Date(start_date);
    endDate.setMonth(endDate.getMonth() + parseInt(duration_months));

    const lease = await client.query(
      `INSERT INTO leases (property_id,tenant_id,move_in_date,start_date,end_date,yearly_rent,duration_months)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [propId, tenantId, move_in_date, start_date, endDate.toISOString().slice(0,10), yearly_rent, duration_months]
    );

    await client.query('COMMIT');
    res.status(201).json({ property: prop.rows[0], tenant: tenant.rows[0], lease: lease.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create property.' });
  } finally {
    client.release();
  }
});

// GET /api/properties/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, t.id AS tenant_id, t.name AS tenant_name, t.occupation,
             t.phone AS tenant_phone, t.email AS tenant_email, t.notes,
             l.id AS lease_id, l.move_in_date, l.start_date, l.end_date,
             l.yearly_rent, l.duration_months, l.status AS lease_status
      FROM properties p
      LEFT JOIN tenants t ON t.property_id = p.id
      LEFT JOIN leases  l ON l.property_id = p.id AND l.status = 'active'
      WHERE p.id = $1 AND p.user_id = $2
    `, [req.params.id, req.user.id]);

    if (!result.rows.length) return res.status(404).json({ error: 'Property not found.' });
    res.json({ property: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/properties/:id  — update address / notes
router.put('/:id', async (req, res) => {
  const { address, city, state, country, notes } = req.body;
  try {
    const result = await query(
      `UPDATE properties SET address=COALESCE($1,address), city=COALESCE($2,city),
       state=COALESCE($3,state), country=COALESCE($4,country)
       WHERE id=$5 AND user_id=$6 RETURNING *`,
      [address, city, state, country, req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Property not found.' });

    // update tenant notes if provided
    if (notes !== undefined) {
      await query('UPDATE tenants SET notes=$1 WHERE property_id=$2', [notes, req.params.id]);
    }
    res.json({ property: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/properties/:id
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM properties WHERE id=$1 AND user_id=$2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Property not found.' });
    res.json({ message: 'Property deleted.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
