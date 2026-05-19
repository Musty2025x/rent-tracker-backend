const express = require('express');
const { query } = require('../db/pool');
const auth = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// GET /api/leases?property_id=X  — lease history for a property
router.get('/', async (req, res) => {
  const { property_id } = req.query;
  if (!property_id) return res.status(400).json({ error: 'property_id required.' });
  try {
    // Verify ownership
    const own = await query('SELECT id FROM properties WHERE id=$1 AND user_id=$2', [property_id, req.user.id]);
    if (!own.rows.length) return res.status(403).json({ error: 'Access denied.' });

    const result = await query(
      'SELECT * FROM leases WHERE property_id=$1 ORDER BY start_date DESC',
      [property_id]
    );
    res.json({ leases: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/leases/:id/renew  — renew a lease (extends by same duration)
router.post('/:id/renew', async (req, res) => {
  const client = await require('../db/pool').getClient();
  try {
    await client.query('BEGIN');

    const leaseRes = await client.query(`
      SELECT l.*, p.user_id FROM leases l
      JOIN properties p ON p.id = l.property_id
      WHERE l.id = $1
    `, [req.params.id]);

    if (!leaseRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lease not found.' });
    }
    const lease = leaseRes.rows[0];
    if (lease.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Access denied.' });
    }

    // New start = max(today, old end_date)
    const today = new Date();
    const oldEnd = new Date(lease.end_date);
    const newStart = oldEnd > today ? oldEnd : today;
    const newEnd = new Date(newStart);
    newEnd.setMonth(newEnd.getMonth() + lease.duration_months);

    // Mark old lease as renewed
    await client.query('UPDATE leases SET status=$1 WHERE id=$2', ['renewed', lease.id]);

    // Create new lease
    const yearly_rent = req.body.yearly_rent || lease.yearly_rent;
    const newLease = await client.query(
      `INSERT INTO leases (property_id,tenant_id,move_in_date,start_date,end_date,yearly_rent,duration_months,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active') RETURNING *`,
      [lease.property_id, lease.tenant_id, lease.move_in_date,
       newStart.toISOString().slice(0,10), newEnd.toISOString().slice(0,10),
       yearly_rent, lease.duration_months]
    );

    await client.query('COMMIT');
    res.status(201).json({ lease: newLease.rows[0], message: 'Lease renewed successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to renew lease.' });
  } finally {
    client.release();
  }
});

// POST /api/leases/:id/terminate
router.post('/:id/terminate', async (req, res) => {
  try {
    const result = await query(`
      UPDATE leases SET status='terminated'
      WHERE id=$1 AND property_id IN (SELECT id FROM properties WHERE user_id=$2)
      RETURNING *
    `, [req.params.id, req.user.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Lease not found.' });
    res.json({ lease: result.rows[0], message: 'Lease terminated.' });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
