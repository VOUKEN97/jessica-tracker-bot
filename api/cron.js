const bot = require('../index');
const db = require('../database');

module.exports = async (req, res) => {
    try {
        const now = new Date();
        const today = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        
        const result = await db.query(`SELECT * FROM shifts WHERE date = $1`, [today]);
        const rows = result.rows;
        
        for (const row of rows) {
            const message = `🔔 *Reminder Pagi!*\n\nHari ini ada jadwal jaga di *${row.location}*.\n⏰ Waktu: ${row.start_time} - ${row.end_time}\n📝 Jangan lupa: ${row.notes}\n\nSemangat Dok! 💪`;
            await bot.telegram.sendMessage(row.user_id, message, { parse_mode: "Markdown" });
        }
        
        res.status(200).send('Cron job executed successfully');
    } catch (e) {
        console.error(e);
        res.status(500).send('Error running cron');
    }
};
