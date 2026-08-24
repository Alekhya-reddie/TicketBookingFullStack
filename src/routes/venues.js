const express = require('express');
const router = express.Router();
const { run, get, all } = require('../db');
const { verifyToken, requireRole } = require('./auth');

// Get all venues
router.get('/', async (req, res) => {
  try {
    const venues = await all('SELECT * FROM venues ORDER BY id DESC');
    res.json({ venues });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get venue by ID
router.get('/:id', async (req, res) => {
  try {
    const venue = await get('SELECT * FROM venues WHERE id = ?', [req.params.id]);
    if (!venue) return res.status(404).json({ error: 'Venue not found' });
    res.json({ venue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: Create new venue
router.post('/', verifyToken, requireRole(['admin']), async (req, res) => {
  try {
    const { name, location, rows_count, cols_count } = req.body;
    if (!name || !location || !rows_count || !cols_count) {
      return res.status(400).json({ error: 'Name, location, rows_count, and cols_count are required' });
    }

    const result = await run(
      'INSERT INTO venues (name, location, rows_count, cols_count, created_by) VALUES (?, ?, ?, ?, ?)',
      [name, location, parseInt(rows_count), parseInt(cols_count), req.user.id]
    );

    const newVenue = await get('SELECT * FROM venues WHERE id = ?', [result.lastID]);
    res.status(201).json({ message: 'Venue created successfully', venue: newVenue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
