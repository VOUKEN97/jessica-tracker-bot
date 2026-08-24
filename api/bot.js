const bot = require('../index');

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body);
            res.status(200).send('OK');
        } else {
            res.status(200).send('Bot is running on Vercel!');
        }
    } catch (e) {
        console.error("Webhook Error:", e);
        res.status(200).send('Error handled'); // Always return 200 to Telegram so it stops retrying
    }
};
