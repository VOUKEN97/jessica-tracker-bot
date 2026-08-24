require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cron = require('node-cron');
const db = require('./database');

const token = process.env.TELEGRAM_BOT_TOKEN;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!token) {
    console.error("Error: TELEGRAM_BOT_TOKEN is missing.");
    process.exit(1);
}

const bot = new Telegraf(token);
const genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;

// State management
const userStates = {};

// Helper: Main Menu Keyboard
const mainMenu = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Tambah Jadwal', 'action_tambah')],
    [Markup.button.callback('📅 Jadwal Hari Ini', 'action_hariini'), Markup.button.callback('📋 Semua Jadwal', 'action_semua')],
    [Markup.button.callback('💰 Laporan Pendapatan', 'action_laporan')]
]);

bot.start((ctx) => {
    ctx.reply(
        `Halo Dokter Jessica! 🩺👩‍⚕️\n\nSaya Asisten Jadwal Jaga siap membantu!\n` +
        (genAI ? `✨ *AI Aktif*: Kamu bisa langsung chat kalimat seperti: *"Besok aku jaga di Medika jam 8-14, fee 500rb, bawa stetoskop"*\n\n` : `\n`) +
        `Gunakan menu di bawah ini untuk memulai:`,
        { parse_mode: 'Markdown', ...mainMenu }
    );
});

// Callback Handlers
bot.action('action_tambah', (ctx) => {
    ctx.answerCbQuery();
    const chatId = ctx.chat.id;
    userStates[chatId] = { step: 'LOCATION' };
    ctx.reply("📍 *Di mana lokasi jaganya?*\nContoh: Klinik Sehat", { parse_mode: 'Markdown' });
});

bot.action('action_hariini', (ctx) => {
    ctx.answerCbQuery();
    handleHariIni(ctx);
});

bot.action('action_semua', (ctx) => {
    ctx.answerCbQuery();
    handleSemuaJadwal(ctx);
});

bot.action('action_laporan', (ctx) => {
    ctx.answerCbQuery();
    handleLaporan(ctx);
});

bot.action(/detail_(.+)/, async (ctx) => {
    ctx.answerCbQuery();
    const id = ctx.match[1];
    
    try {
        const res = await db.query(`SELECT * FROM shifts WHERE id = $1`, [id]);
        const row = res.rows[0];
        
        if (!row) return ctx.reply("Jadwal tidak ditemukan.");
        
        const detail = `📌 *Detail Jadwal*\n\n` +
            `📍 Lokasi: ${row.location}\n` +
            `📅 Tanggal: ${row.date}\n` +
            `⏰ Waktu: ${row.start_time} - ${row.end_time}\n` +
            `💰 Fee: Rp ${(row.fee || 0).toLocaleString('id-ID')}\n` +
            `📝 Catatan: ${row.notes}`;
            
        const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback('❌ Hapus Jadwal', `hapus_${id}`)],
            [Markup.button.callback('⬅️ Kembali ke Daftar', 'action_semua')]
        ]);
        
        ctx.reply(detail, { parse_mode: 'Markdown', ...keyboard });
    } catch (err) {
        ctx.reply("Terjadi kesalahan.");
    }
});

bot.action(/hapus_(.+)/, async (ctx) => {
    ctx.answerCbQuery();
    const id = ctx.match[1];
    
    try {
        await db.query(`DELETE FROM shifts WHERE id = $1`, [id]);
        ctx.reply("✅ Jadwal berhasil dihapus!", mainMenu);
    } catch (err) {
        ctx.reply("Gagal menghapus jadwal.");
    }
});

// Text input handler (State Machine & AI)
bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    if (text.startsWith('/')) {
        if(text === '/start') return; 
        return ctx.reply("Gunakan tombol menu atau ketik jadwal secara langsung.", mainMenu);
    }

    const state = userStates[chatId];
    
    if (state && state.step) {
        // Manual Entry Flow
        if (state.step === 'LOCATION') {
            state.location = text;
            state.step = 'DATE';
            return ctx.reply(`Sip, Klinik/Tempat: ${text}.\n📅 *Tanggal berapa?*\nFormat: YYYY-MM-DD (contoh: 2026-08-25)`, {parse_mode: 'Markdown'});
        } else if (state.step === 'DATE') {
            state.date = text;
            state.step = 'TIME';
            return ctx.reply(`Tanggal: ${text}.\n⏰ *Jam berapa shift-nya?*\nContoh: 08:00 - 14:00`, {parse_mode: 'Markdown'});
        } else if (state.step === 'TIME') {
            state.time = text;
            state.step = 'FEE';
            return ctx.reply(`Waktu: ${text}.\n💰 *Berapa estimasi fee-nya?*\n(Tulis angka saja, misal: 500000, atau 0 kalau tidak ada)`, {parse_mode: 'Markdown'});
        } else if (state.step === 'FEE') {
            state.fee = parseInt(text.replace(/[^0-9]/g, '')) || 0;
            state.step = 'NOTES';
            return ctx.reply(`Fee: Rp ${state.fee.toLocaleString('id-ID')}.\n📝 *Ada catatan khusus/yang harus diingat?*\n(Ketik '-' kalau tidak ada)`, {parse_mode: 'Markdown'});
        } else if (state.step === 'NOTES') {
            state.notes = text;
            
            const parts = state.time.split('-');
            const start_time = parts[0] ? parts[0].trim() : state.time;
            const end_time = parts[1] ? parts[1].trim() : '';
            
            try {
                await db.query(
                    `INSERT INTO shifts (user_id, location, date, start_time, end_time, notes, fee) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [chatId, state.location, state.date, start_time, end_time, state.notes, state.fee]
                );
                ctx.reply(`✅ *Jadwal berhasil ditambahkan!*\n\n📍 ${state.location}\n📅 ${state.date}\n⏰ ${state.time}\n💰 Rp ${state.fee.toLocaleString('id-ID')}\n📝 ${state.notes}`, {parse_mode: 'Markdown', ...mainMenu});
            } catch (err) {
                console.error(err);
                ctx.reply("Waduh, gagal menyimpan jadwal. Coba lagi ya.", mainMenu);
            }
            delete userStates[chatId];
            return;
        }
    }

    // AI Flow
    if (genAI) {
        ctx.reply("🤖 Sebentar, aku catat jadwalnya...");
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const prompt = `Ekstrak informasi jadwal dari teks ini: "${text}".
            Return ONLY a valid JSON object (no markdown, no code block backticks) with these keys: 
            "location" (string), "date" (YYYY-MM-DD, assume current year is 2026 and current month is August. If user says 'besok', add 1 day to 2026-08-24), "start_time" (HH:MM), "end_time" (HH:MM), "fee" (integer number only), "notes" (string).`;
            
            const result = await model.generateContent(prompt);
            const responseText = result.response.text().trim();
            const jsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            
            const data = JSON.parse(jsonStr);
            
            await db.query(
                `INSERT INTO shifts (user_id, location, date, start_time, end_time, notes, fee) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [chatId, data.location, data.date, data.start_time, data.end_time, data.notes, data.fee || 0]
            );
            ctx.reply(`✅ *Jadwal berhasil ditambahkan oleh AI!*\n\n📍 ${data.location}\n📅 ${data.date}\n⏰ ${data.start_time} - ${data.end_time}\n💰 Rp ${(data.fee||0).toLocaleString('id-ID')}\n📝 ${data.notes}`, {parse_mode: 'Markdown', ...mainMenu});
        } catch (e) {
            console.error(e);
            ctx.reply("Maaf, AI gagal memahami pesannya. Boleh pakai tombol Tambah Jadwal ya! 🙏", mainMenu);
        }
    } else {
        ctx.reply("Gunakan tombol di bawah ini ya dok 👇", mainMenu);
    }
});

// Functions
async function handleHariIni(ctx) {
    const chatId = ctx.chat.id || ctx.from.id;
    const now = new Date();
    const today = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    
    try {
        const res = await db.query(`SELECT * FROM shifts WHERE user_id = $1 AND date = $2`, [chatId, today]);
        const rows = res.rows;
        
        if (rows.length === 0) return ctx.reply("🎉 Tidak ada jadwal jaga hari ini. Waktunya istirahat!", mainMenu);
        
        let response = `🩺 *Jadwal Jaga Hari Ini (${today})*\n\n`;
        rows.forEach((row, index) => {
            response += `${index + 1}. *${row.location}* (${row.start_time} - ${row.end_time})\n📝 ${row.notes}\n\n`;
        });
        ctx.reply(response, { parse_mode: "Markdown", ...mainMenu });
    } catch (err) {
        ctx.reply("Terjadi kesalahan.");
    }
}

async function handleSemuaJadwal(ctx) {
    const chatId = ctx.chat.id || ctx.from.id;
    
    try {
        const res = await db.query(`SELECT * FROM shifts WHERE user_id = $1 ORDER BY date ASC`, [chatId]);
        const rows = res.rows;
        
        if (rows.length === 0) return ctx.reply("Belum ada jadwal jaga.", mainMenu);
        
        const buttons = rows.map(row => {
            return [Markup.button.callback(`📅 ${row.date} - ${row.location}`, `detail_${row.id}`)];
        });
        
        ctx.reply("📅 *Daftar Jadwal Jaga*\nKlik untuk melihat detail atau menghapus:", {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard(buttons)
        });
    } catch (err) {
        ctx.reply("Terjadi kesalahan.");
    }
}

async function handleLaporan(ctx) {
    const chatId = ctx.chat.id || ctx.from.id;
    try {
        const res = await db.query(`SELECT fee FROM shifts WHERE user_id = $1`, [chatId]);
        const rows = res.rows;
        
        const total = rows.reduce((sum, row) => sum + (row.fee || 0), 0);
        ctx.reply(`💰 *Laporan Pendapatan*\n\nTotal estimasi fee dari ${rows.length} jadwal jaga:\n*Rp ${total.toLocaleString('id-ID')}*`, { parse_mode: 'Markdown', ...mainMenu });
    } catch (err) {
        ctx.reply("Gagal mengambil laporan.");
    }
}

// Cron job to run daily at 6 AM
cron.schedule('0 6 * * *', async () => {
    const now = new Date();
    const today = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
    
    try {
        const res = await db.query(`SELECT * FROM shifts WHERE date = $1`, [today]);
        const rows = res.rows;
        
        rows.forEach(row => {
            const message = `🔔 *Reminder Pagi!*\n\nHari ini ada jadwal jaga di *${row.location}*.\n⏰ Waktu: ${row.start_time} - ${row.end_time}\n📝 Jangan lupa: ${row.notes}\n\nSemangat Dok! 💪`;
            bot.telegram.sendMessage(row.user_id, message, { parse_mode: "Markdown" });
        });
    } catch (err) {
        console.error("Cron Error", err);
    }
});

bot.launch().then(() => console.log("Bot V2 (PostgreSQL) is running..."));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
