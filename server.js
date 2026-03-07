// KOSKO Telegram Auth Server — Cloud Deployment Version
// Deploy to Render.com, Railway.app, or any Node.js host

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve admin panel at /admin
app.use('/admin', express.static(path.join(__dirname, 'public')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ═══════════════════════════════════════════════════
const BOT_TOKEN = process.env.BOT_TOKEN || '8578668373:AAFxAxJplTY6YE6ej-BUuImhmIrs8-_2AT8';
const BOT_USERNAME = process.env.BOT_USERNAME || 'kosko_auth_bot';
const PORT = process.env.PORT || 3001;
// ═══════════════════════════════════════════════════

// Storage (in-memory, for production use Redis)
const authCodes = new Map();
const pendingLogins = new Map();

// ─── 1. Generate Telegram auth deeplink ──────────────
app.post('/api/auth/telegram/start', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const sessionId = crypto.randomBytes(16).toString('hex');
    const code = String(Math.floor(1000 + Math.random() * 9000));

    authCodes.set(phone, { code, expires: Date.now() + 300000, sessionId });
    pendingLogins.set(sessionId, { phone, verified: false });

    const deeplink = `https://t.me/${BOT_USERNAME}?start=auth_${sessionId}_${code}`;
    res.json({ sessionId, deeplink, botUsername: BOT_USERNAME });
});

// ─── 2. Check auth status ────────────────────────────
app.get('/api/auth/telegram/status/:sessionId', (req, res) => {
    const session = pendingLogins.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    if (session.verified) {
        const token = crypto.randomBytes(32).toString('hex');
        pendingLogins.delete(req.params.sessionId);
        return res.json({ verified: true, token, phone: session.phone });
    }
    res.json({ verified: false });
});

// ─── 3. OTP via Telegram ─────────────────────────────
app.post('/api/auth/otp/telegram', (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });

    const code = String(Math.floor(1000 + Math.random() * 9000));
    authCodes.set(phone, { code, expires: Date.now() + 300000 });
    console.log(`📱 OTP for ${phone}: ${code}`);
    res.json({ sent: true, message: 'Code sent via Telegram' });
});

// ─── 4. Verify OTP ───────────────────────────────────
app.post('/api/auth/otp/verify', (req, res) => {
    const { phone, code } = req.body;
    const stored = authCodes.get(phone);

    if (!stored) return res.status(400).json({ error: 'Code not found' });
    if (Date.now() > stored.expires) return res.status(400).json({ error: 'Code expired' });
    if (stored.code !== code) return res.status(400).json({ error: 'Wrong code' });

    authCodes.delete(phone);
    const token = crypto.randomBytes(32).toString('hex');
    res.json({ verified: true, token });
});

// ─── 5. Mock verify (for testing without Telegram) ───
app.post('/api/auth/mock/verify', (req, res) => {
    const { phone, code } = req.body;
    if (code === '1234') {
        const token = crypto.randomBytes(32).toString('hex');
        return res.json({ verified: true, token, phone });
    }
    res.status(400).json({ error: 'Wrong code' });
});

// ─── Telegram API Helper ─────────────────────────────
async function sendTelegramMessage(chatId, text) {
    try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        });
    } catch (err) {
        console.error('Telegram send error:', err.message);
    }
}

// ─── Telegram Long Polling ───────────────────────────
let lastUpdateId = 0;

async function pollTelegram() {
    try {
        const res = await fetch(
            `https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`
        );
        const data = await res.json();

        if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
                lastUpdateId = update.update_id;
                if (update.message) handleTelegramMessage(update.message);
            }
        }
    } catch (err) {
        console.error('Polling error:', err.message);
    }
    setTimeout(pollTelegram, 1000);
}

function handleTelegramMessage(message) {
    const chatId = message.chat.id;
    const text = message.text || '';
    const userName = message.from?.first_name || 'User';

    console.log(`📩 Telegram: ${userName} → "${text}"`);

    if (text.startsWith('/start auth_')) {
        const parts = text.replace('/start auth_', '').split('_');
        const sessionId = parts[0];
        const session = pendingLogins.get(sessionId);

        if (session) {
            session.verified = true;
            session.telegramChatId = chatId;
            sendTelegramMessage(chatId,
                `✅ ${userName}, вы авторизованы в KOSKO!\n📱 ${session.phone}\nВернитесь в приложение.`
            );
            console.log(`✅ Auth confirmed for ${session.phone}`);
        } else {
            sendTelegramMessage(chatId, '❌ Сессия истекла. Попробуйте заново.');
        }
    } else if (text === '/start') {
        sendTelegramMessage(chatId,
            `👋 Привет, ${userName}! Я бот KOSKO.\n\n1️⃣ Откройте KOSKO\n2️⃣ «Войти через Telegram»\n3️⃣ Подтвердите здесь`
        );
    }
}

// ─── CHAT API ────────────────────────────────────────
const chatMessages = [];

// Send message from mobile app
app.post('/api/chat/send', (req, res) => {
    const { text, from, phone } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const msg = {
        id: Date.now().toString(),
        text,
        from: from || 'user',
        phone: phone || '+998 XX',
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now(),
    };
    chatMessages.push(msg);
    console.log(`💬 Chat [${msg.from}]: ${msg.text}`);
    res.json({ ok: true, message: msg });
});

// Get messages (with optional ?since=timestamp for long-polling)
app.get('/api/chat/messages', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const msgs = since ? chatMessages.filter(m => m.timestamp > since) : chatMessages;
    res.json({ messages: msgs, total: chatMessages.length });
});

// Admin reply
app.post('/api/chat/admin/reply', (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const msg = {
        id: Date.now().toString(),
        text,
        from: 'support',
        phone: 'admin',
        time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now(),
    };
    chatMessages.push(msg);
    console.log(`💬 Admin reply: ${msg.text}`);
    res.json({ ok: true, message: msg });
});
// ─── LOYALTY CARD API ────────────────────────────────
const loyaltyCards = new Map();
const LEVELS = [
    { name: 'bronze', min: 0, cashback: 3 },
    { name: 'silver', min: 1000, cashback: 5 },
    { name: 'gold', min: 5000, cashback: 7 },
    { name: 'platinum', min: 15000, cashback: 10 },
];

function calcLevel(balance) {
    return [...LEVELS].reverse().find(l => balance >= l.min) || LEVELS[0];
}

// Register new loyalty card
app.post('/api/loyalty/register', (req, res) => {
    const { phone, name } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const barcode = '222' + phone.replace(/\D/g, '').slice(-9).padStart(9, '0');
    // Add check digit
    const digits = barcode.split('').map(Number);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += digits[i] * (i % 2 === 0 ? 1 : 3);
    const fullBarcode = barcode + ((10 - (sum % 10)) % 10);

    const card = {
        barcode: fullBarcode,
        ownerName: name || 'Пользователь KOSKO',
        phone,
        balance: 0,
        level: 'bronze',
        cashbackPercent: 3,
        transactions: [],
        createdAt: new Date().toISOString(),
    };
    loyaltyCards.set(fullBarcode, card);
    loyaltyCards.set(phone, card); // also index by phone
    console.log(`💳 New loyalty card: ${fullBarcode} for ${phone}`);
    res.json({ ok: true, card });
});

// Get card by barcode or phone
app.get('/api/loyalty/card/:id', (req, res) => {
    const card = loyaltyCards.get(req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    const level = calcLevel(card.balance);
    card.level = level.name;
    card.cashbackPercent = level.cashback;
    res.json({ card });
});

// Add bonus points
app.post('/api/loyalty/bonus', (req, res) => {
    const { barcode, amount, description } = req.body;
    const card = loyaltyCards.get(barcode);
    if (!card) return res.status(404).json({ error: 'Card not found' });
    card.balance += amount;
    const level = calcLevel(card.balance);
    card.level = level.name;
    card.cashbackPercent = level.cashback;
    card.transactions.unshift({
        id: Date.now().toString(),
        date: new Date().toLocaleDateString('ru-RU'),
        type: amount > 0 ? 'accrual' : 'writeoff',
        amount: Math.abs(amount),
        description: description || (amount > 0 ? 'Начисление баллов' : 'Списание баллов'),
        bonusChange: amount,
    });
    console.log(`💰 Card ${barcode}: ${amount > 0 ? '+' : ''}${amount} points → ${card.balance} total`);
    res.json({ ok: true, card });
});

// ─── SERVER REGISTRATION (for 1C discovery) ─────────
let registeredServer = null;


// 1C server registers itself with cloud
app.post('/api/server/register', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL required' });
    registeredServer = { url, timestamp: Date.now() };
    console.log(`🔗 1C server registered: ${url}`);
    res.json({ ok: true, registered: registeredServer });
});

// Mobile app gets registered 1C server
app.get('/api/server/registered', (req, res) => {
    if (!registeredServer) return res.status(404).json({ error: 'No server registered' });
    // Expire after 24 hours
    if (Date.now() - registeredServer.timestamp > 86400000) {
        registeredServer = null;
        return res.status(404).json({ error: 'Registration expired' });
    }
    res.json(registeredServer);
});

// ─── Health check ────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime(), chatMessages: chatMessages.length, registeredServer: !!registeredServer }));
app.get('/', (req, res) => res.json({ service: 'KOSKO Auth + Chat + Discovery', status: 'running' }));

// ─── Start ───────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KOSKO Auth Server on port ${PORT}`);
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`)
        .then(() => { console.log('🤖 Bot polling started'); pollTelegram(); })
        .catch(() => pollTelegram());
});
