const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// ── GET /api/properties ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Cast dates to plain YYYY-MM-DD strings to avoid timezone issues in frontend
    const result = await query(`
      SELECT
        p.id, p.address, p.city, p.state, p.country, p.house_type, p.created_at,
        t.id            AS tenant_id,
        t.name          AS tenant_name,
        t.occupation,
        t.phone         AS tenant_phone,
        t.email         AS tenant_email,
        t.notes,
        l.id            AS lease_id,
        TO_CHAR(l.move_in_date, 'YYYY-MM-DD') AS move_in_date,
        TO_CHAR(l.start_date,   'YYYY-MM-DD') AS start_date,
        TO_CHAR(l.end_date,     'YYYY-MM-DD') AS end_date,
        l.yearly_rent,
        l.duration_months,
        l.status        AS lease_status
      FROM properties p
      LEFT JOIN tenants t ON t.property_id = p.id
      LEFT JOIN leases  l ON l.property_id = p.id AND l.status = 'active'
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
    `, [req.user.id]);

    // Fetch all payments for these properties separately
    const propIds = result.rows.map(r => r.id);
    let payments = [];
    if (propIds.length) {
      const pr = await query(
        `SELECT pay.*, l.property_id
         FROM payments pay
         JOIN leases l ON l.id = pay.lease_id
         WHERE l.property_id = ANY($1::int[])
         ORDER BY pay.paid_date DESC`,
        [propIds]
      );
      payments = pr.rows;
    }

    const props = result.rows.map(p => ({
      ...p,
      payments: payments.filter(x => x.property_id === p.id),
    }));

    res.json({ properties: props });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch properties.' });
  }
});

// ── POST /api/properties ──────────────────────────────────────────────────────
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
    address, city, state, country = 'Nigeria', house_type = null,
    tenant_name, occupation, phone, email, notes,
    move_in_date, start_date, yearly_rent, duration_months = 12,
  } = req.body;

  const client = await require('../db/pool').getClient();
  try {
    await client.query('BEGIN');

    const count = await client.query(
      'SELECT COUNT(*) FROM properties WHERE user_id=$1', [req.user.id]
    );
    if (parseInt(count.rows[0].count) >= 5) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Maximum of 5 properties allowed.' });
    }

    const prop = await client.query(
      `INSERT INTO properties (user_id,address,city,state,country,house_type)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, address, city, state, country, house_type]
    );
    const propId = prop.rows[0].id;

    const tenant = await client.query(
      `INSERT INTO tenants (property_id,name,occupation,phone,email,notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [propId, tenant_name, occupation || null, phone || null, email || null, notes || null]
    );
    const tenantId = tenant.rows[0].id;

    const endDate = new Date(start_date);
    endDate.setMonth(endDate.getMonth() + parseInt(duration_months));

    const lease = await client.query(
      `INSERT INTO leases (property_id,tenant_id,move_in_date,start_date,end_date,yearly_rent,duration_months)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [propId, tenantId, move_in_date, start_date,
       endDate.toISOString().slice(0, 10), yearly_rent, duration_months]
    );

    await client.query('COMMIT');
    res.status(201).json({
      property: prop.rows[0],
      tenant: tenant.rows[0],
      lease: lease.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create property.' });
  } finally {
    client.release();
  }
});

// ── GET /api/properties/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        p.id, p.address, p.city, p.state, p.country, p.house_type,
        t.id AS tenant_id, t.name AS tenant_name, t.occupation,
        t.phone AS tenant_phone, t.email AS tenant_email, t.notes,
        l.id AS lease_id,
        TO_CHAR(l.move_in_date, 'YYYY-MM-DD') AS move_in_date,
        TO_CHAR(l.start_date,   'YYYY-MM-DD') AS start_date,
        TO_CHAR(l.end_date,     'YYYY-MM-DD') AS end_date,
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

// ── PUT /api/properties/:id ───────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const {
    address, city, state, country, house_type,
    tenant_name, occupation, phone, email, notes,
    move_in_date, start_date, yearly_rent, duration_months,
  } = req.body;

  const client = await require('../db/pool').getClient();
  try {
    await client.query('BEGIN');

    const own = await client.query(
      'SELECT id FROM properties WHERE id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    if (!own.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Property not found.' });
    }

    // Update property
    const propFields = []; const propVals = []; let pi = 1;
    if (address    !== undefined) { propFields.push(`address=$${pi++}`);    propVals.push(address); }
    if (city       !== undefined) { propFields.push(`city=$${pi++}`);       propVals.push(city); }
    if (state      !== undefined) { propFields.push(`state=$${pi++}`);      propVals.push(state); }
    if (country    !== undefined) { propFields.push(`country=$${pi++}`);    propVals.push(country); }
    if (house_type !== undefined) { propFields.push(`house_type=$${pi++}`); propVals.push(house_type); }
    if (propFields.length) {
      propVals.push(req.params.id);
      await client.query(`UPDATE properties SET ${propFields.join(',')} WHERE id=$${pi}`, propVals);
    }

    // Update tenant
    const tenFields = []; const tenVals = []; let ti = 1;
    if (tenant_name !== undefined) { tenFields.push(`name=$${ti++}`);       tenVals.push(tenant_name); }
    if (occupation  !== undefined) { tenFields.push(`occupation=$${ti++}`); tenVals.push(occupation); }
    if (phone       !== undefined) { tenFields.push(`phone=$${ti++}`);      tenVals.push(phone || null); }
    if (email       !== undefined) { tenFields.push(`email=$${ti++}`);      tenVals.push(email || null); }
    if (notes       !== undefined) { tenFields.push(`notes=$${ti++}`);      tenVals.push(notes); }
    if (tenFields.length) {
      tenVals.push(req.params.id);
      await client.query(`UPDATE tenants SET ${tenFields.join(',')} WHERE property_id=$${ti}`, tenVals);
    }

    // Update lease
    const leFields = []; const leVals = []; let li = 1;
    if (move_in_date    !== undefined) { leFields.push(`move_in_date=$${li++}`);    leVals.push(move_in_date); }
    if (start_date      !== undefined) { leFields.push(`start_date=$${li++}`);      leVals.push(start_date); }
    if (yearly_rent     !== undefined) { leFields.push(`yearly_rent=$${li++}`);     leVals.push(yearly_rent); }
    if (duration_months !== undefined) { leFields.push(`duration_months=$${li++}`); leVals.push(duration_months); }

    if (leFields.length) {
      const leaseRow = await client.query(
        `SELECT id, start_date, duration_months FROM leases
         WHERE property_id=$1 AND status='active'`,
        [req.params.id]
      );
      if (leaseRow.rows.length) {
        const newStart    = start_date      || leaseRow.rows[0].start_date;
        const newDuration = duration_months || leaseRow.rows[0].duration_months;
        const newEnd      = new Date(newStart);
        newEnd.setMonth(newEnd.getMonth() + parseInt(newDuration));
        leFields.push(`end_date=$${li++}`);
        leVals.push(newEnd.toISOString().slice(0, 10));
        leVals.push(leaseRow.rows[0].id);
        await client.query(
          `UPDATE leases SET ${leFields.join(',')} WHERE id=$${li}`, leVals
        );
      } else if (move_in_date && start_date && yearly_rent) {
        // No lease yet — create one
        const tenRow = await client.query(
          'SELECT id FROM tenants WHERE property_id=$1', [req.params.id]
        );
        if (tenRow.rows.length) {
          const endDate = new Date(start_date);
          endDate.setMonth(endDate.getMonth() + parseInt(duration_months || 12));
          await client.query(
            `INSERT INTO leases (property_id,tenant_id,move_in_date,start_date,end_date,yearly_rent,duration_months)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [req.params.id, tenRow.rows[0].id, move_in_date, start_date,
             endDate.toISOString().slice(0, 10), yearly_rent, duration_months || 12]
          );
        }
      }
    }

    await client.query('COMMIT');

    // Return fresh data
    const fresh = await query(`
      SELECT
        p.id, p.address, p.city, p.state, p.country, p.house_type,
        t.id AS tenant_id, t.name AS tenant_name, t.occupation,
        t.phone AS tenant_phone, t.email AS tenant_email, t.notes,
        l.id AS lease_id,
        TO_CHAR(l.move_in_date, 'YYYY-MM-DD') AS move_in_date,
        TO_CHAR(l.start_date,   'YYYY-MM-DD') AS start_date,
        TO_CHAR(l.end_date,     'YYYY-MM-DD') AS end_date,
        l.yearly_rent, l.duration_months, l.status AS lease_status
      FROM properties p
      LEFT JOIN tenants t ON t.property_id = p.id
      LEFT JOIN leases  l ON l.property_id = p.id AND l.status = 'active'
      WHERE p.id = $1
    `, [req.params.id]);

    res.json({ property: fresh.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('PUT error:', err);
    res.status(500).json({ error: 'Server error: ' + err.message });
  } finally {
    client.release();
  }
});

// ── DELETE /api/properties/:id ────────────────────────────────────────────────
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
