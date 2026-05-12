const express = require('express');
const router = express.Router();
const db = require('../../db/v2Database');
const { requireV2Auth } = require('../../middleware/v2Auth');
const { getOrgEntitlements, getMonthToDateUsage } = require('../../lib/v2Entitlements');

router.get('/me', requireV2Auth, async (req, res) => {
  try {
    const org = await db.get(`SELECT * FROM v2_organizations WHERE id = ?`, [req.v2Auth.orgId]);
    const ent = await getOrgEntitlements(req.v2Auth.orgId);
    const usage = await getMonthToDateUsage(req.v2Auth.orgId);
    res.json({ org, entitlements: ent, usageThisMonth: usage });
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
