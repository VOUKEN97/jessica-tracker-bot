const bot = require('../index');

module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body, res);
        } else {
            res.status(200).send('Bot is running on Vercel!');
        }
    } catch (e) {
        console.error(e);
        res.status(500).send('Error');
    }
};
