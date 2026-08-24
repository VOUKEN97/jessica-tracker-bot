const bot = require('../index');

module.exports = async (req, res) => {
    try {
        const url = `https://${req.headers.host}/api/bot`;
        await bot.telegram.setWebhook(url);
        res.status(200).send(`Webhook set successfully to ${url}`);
    } catch (e) {
        console.error(e);
        res.status(500).send('Failed to set webhook: ' + e.message);
    }
};
