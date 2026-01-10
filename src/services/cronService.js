const pool = require('../db');
const UserContext = require('../contexts/UserContext');
const ClientContext = require('../contexts/ClientContext');

const checkExpiredTrials = async () => {
  try {
    const settings = await UserContext.getSettings();
    if (!settings?.user?.free_minutes) {
      return;
    }

    const freeMinutes = settings.user.free_minutes;

    const result = await pool.query(
      `SELECT id, email FROM users WHERE is_verified = true AND is_paid = false AND verified_at < NOW() - INTERVAL '${freeMinutes} minutes'`
    );

    for (const user of result.rows) {
      const clientCount = await ClientContext.countByUser(user.id);
      
      if (clientCount > 0) {
        console.log(`Revoking VPN clients for expired trial user: ${user.email}`);
        await ClientContext.revokeAllByUser(user.id);
      }
    }

    if (result.rows.length > 0) {
      console.log(`Processed ${result.rows.length} expired trial users`);
    }
  } catch (error) {
    console.error('Error checking expired trials:', error);
  }
};

const startCronJobs = () => {
  setInterval(checkExpiredTrials, 60 * 60 * 1000);
  
  console.log('Cron jobs started: checking expired trials every 60 minutes');
};

module.exports = {
  startCronJobs,
  checkExpiredTrials,
};