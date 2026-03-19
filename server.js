// KOSKO Telegram Auth Server — Cloud Deployment Version
// Deploy to Render.com, Railway.app, or any Node.js host

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ─── PERSISTENT STORAGE (PostgreSQL) ─────────────────
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
    : null;

async function initDB() {
    if (!pool) { console.log('⚠️ No DATABASE_URL — using in-memory only'); return; }
    await pool.query(`
        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    console.log('🗄️ PostgreSQL connected, kv_store table ready');
}

async function dbGet(key) {
    if (!pool) return null;
    const { rows } = await pool.query('SELECT value FROM kv_store WHERE key = $1', [key]);
    return rows[0]?.value || null;
}

async function dbSet(key, value) {
    if (!pool) return;
    await pool.query(
        `INSERT INTO kv_store (key, value, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
        [key, JSON.stringify(value)]
    );
}

function persistData() {
    if (!pool) return;
    Promise.all([
        dbSet('storeSettings', storeSettings),
        dbSet('products', Array.from(products.entries())),
        dbSet('productIdCounter', productIdCounter),
        dbSet('banners', banners),
        dbSet('bannerIdCounter', bannerIdCounter),
        dbSet('promocodes', Array.from(promocodes.entries())),
        dbSet('orders', Array.from(orders.entries())),
        dbSet('orderIdCounter', orderIdCounter),
        dbSet('serverRegistry', Array.from(serverRegistry.entries())),
        dbSet('loyaltyCards', Array.from(loyaltyCards.entries())),
        dbSet('loyaltyConfig', loyaltyConfig),
        dbSet('promotions', promotions),
        dbSet('promoIdCounter', promoIdCounter),
        dbSet('integration1cStores', integration1cStores),
    ]).then(() => console.log('💾 Data persisted to PostgreSQL'))
      .catch(e => console.error('❌ Persist error:', e.message));
}

async function loadPersistedData() {
    if (!pool) return null;
    try {
        const keys = ['storeSettings','products','productIdCounter','banners','bannerIdCounter',
                       'promocodes','orders','orderIdCounter','serverRegistry',
                       'loyaltyCards','loyaltyConfig','promotions','promoIdCounter','integration1cStores'];
        const result = {};
        for (const key of keys) {
            result[key] = await dbGet(key);
        }
        if (!result.storeSettings && !result.products) return null;
        console.log('📂 Loaded persisted data from PostgreSQL');
        return result;
    } catch (e) { console.error('❌ DB Load error:', e.message); return null; }
}

const app = express();
app.use(cors());
app.use(express.json());

// Diagnostic: check admin.html content on server
app.get('/api/debug/admin-html', (req, res) => {
    const fs = require('fs');
    const filePath = path.join(__dirname, 'public', 'admin.html');
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        // Find where key sections are
        const tbodyLine = lines.findIndex(l => l.includes('loyalty-cards-tbody'));
        const csvLine = lines.findIndex(l => l.includes('csv-loyalty-file'));
        const addBtnLine = lines.findIndex(l => l.includes('addLoyaltyCard'));
        const secLoyaltyLine = lines.findIndex(l => l.includes('sec-loyalty'));
        // Count div/section tags in loyalty section
        const loyaltyStart = secLoyaltyLine;
        let loyaltyEnd = -1;
        for (let i = loyaltyStart + 1; i < lines.length; i++) {
            if (lines[i].includes('<section') && lines[i].includes('id="sec-')) { loyaltyEnd = i; break; }
        }
        const loyaltyHTML = lines.slice(loyaltyStart, loyaltyEnd >= 0 ? loyaltyEnd : loyaltyStart + 200).join('\n');
        const openDivs = (loyaltyHTML.match(/<div/g) || []).length;
        const closeDivs = (loyaltyHTML.match(/<\/div>/g) || []).length;
        
        res.json({
            fileSize: content.length,
            lines: lines.length,
            secLoyaltyLine: secLoyaltyLine + 1,
            tbodyLine: tbodyLine + 1,
            csvLine: csvLine + 1,
            addBtnLine: addBtnLine + 1,
            loyaltyEndLine: loyaltyEnd + 1,
            loyaltySectionLength: loyaltyEnd >= 0 ? loyaltyEnd - loyaltyStart : 'unknown',
            openDivs, closeDivs, divBalance: openDivs - closeDivs,
            has_loyalty_cards_tbody: tbodyLine >= 0,
            has_csv_loyalty_file: csvLine >= 0,
            has_showToast: content.includes('showToast'),
            // Show the HTML around where content stops rendering
            htmlAroundAddBtn: lines.slice(Math.max(0, addBtnLine - 2), addBtnLine + 15).join('\n'),
        });
    } catch(e) { res.json({ error: e.message }); }
});

// ─── ADMIN AUTH ──────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'kosko2026';
const adminTokens = new Map();

// Admin login page
app.get('/admin/login', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KOSKO Admin Login</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#08080f;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh}
.login-box{background:#13131f;border:1px solid rgba(255,255,255,0.07);border-radius:16px;padding:48px;width:380px;text-align:center}
.logo{font-size:28px;font-weight:900;color:#6c63ff;letter-spacing:4px;margin-bottom:8px}
.subtitle{color:rgba(255,255,255,0.4);font-size:13px;margin-bottom:32px}
input{width:100%;background:#1e1e32;border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:14px 16px;color:#fff;font-size:15px;margin-bottom:12px;outline:none}
input:focus{border-color:#6c63ff}
button{width:100%;background:#6c63ff;border:none;border-radius:10px;padding:14px;color:#fff;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}
button:hover{background:#5b54e0}
.error{color:#ff6b6b;font-size:13px;margin-top:12px;display:none}
</style></head><body>
<div class="login-box">
<div class="logo">KOSKO</div>
<div class="subtitle">Вход в панель управления</div>
<form onsubmit="return doLogin(event)">
<input type="text" id="user" placeholder="Логин" autocomplete="username" value="admin">
<input type="password" id="pass" placeholder="Пароль" autocomplete="current-password">
<button type="submit">Войти</button>
</form>
<div class="error" id="err">Неверный логин или пароль</div>
</div>
<script>
async function doLogin(e){e.preventDefault();
const user=document.getElementById('user').value;
const pass=document.getElementById('pass').value;
const res=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:user,password:pass})});
const data=await res.json();
if(data.token){localStorage.setItem('adminToken',data.token);window.location.href='/admin?token='+data.token}
else{document.getElementById('err').style.display='block'}}
</script></body></html>`);
});

// Admin login API
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = crypto.randomBytes(32).toString('hex');
        adminTokens.set(token, { created: Date.now() });
        console.log('🔐 Admin logged in');
        return res.json({ ok: true, token });
    }
    res.status(401).json({ error: 'Wrong credentials' });
});

// Serve admin panel (protected)
app.get('/admin', (req, res) => {
    const token = req.query.token || req.headers['x-admin-token'];
    const session = adminTokens.get(token);
    if (!session || Date.now() - session.created > 86400000) {
        return res.redirect('/admin/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.use('/admin', express.static(path.join(__dirname, 'public')));

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
    { name: 'Стандарт', min: 0, cashback: 3 },
    { name: 'Серебро', min: 1000, cashback: 5 },
    { name: 'Золото', min: 5000, cashback: 7 },
    { name: 'Платинум', min: 15000, cashback: 10 },
];

// Loyalty config (editable from admin panel)
let loyaltyConfig = {
    activationThreshold: 50000,  // Min purchase total (сўм) to auto-activate card
    pointsRate: 100,             // 1 point = 100 сўм
    autoActivate: true,          // Automatically create card after threshold
    autoCashback: true,          // Auto-accrue cashback on order/payment
};

function calcLevel(totalSpent) {
    return [...LEVELS].reverse().find(l => totalSpent >= l.min) || LEVELS[0];
}

// Auto-process loyalty: activate card & accrue cashback
function autoProcessLoyalty(phone, purchaseAmount, reason) {
    if (!phone) return null;
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 9) return null;

    let card = loyaltyCards.get(cleanPhone);
    const amount = Number(purchaseAmount) || 0;

    // --- AUTO-ACTIVATE: Create card if purchase threshold reached ---
    if (!card && loyaltyConfig.autoActivate) {
        // Check cumulative spending from orders
        let totalSpent = 0;
        for (const [, order] of orders) {
            const orderPhone = (order.phone || '').replace(/\D/g, '');
            if (orderPhone === cleanPhone && (order.status === 'delivered' || order.status === 'paid')) {
                totalSpent += Number(order.total) || 0;
            }
        }
        totalSpent += amount; // include current purchase

        if (totalSpent >= loyaltyConfig.activationThreshold) {
            const level = calcLevel(0);
            card = {
                phone: cleanPhone,
                name: '',
                balance: 0,
                level: level.name,
                totalSpent: 0,
                transactions: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                autoActivated: true,
            };
            loyaltyCards.set(cleanPhone, card);
            console.log(`💳 AUTO-ACTIVATED card for ${cleanPhone} (spent: ${totalSpent} сўм, threshold: ${loyaltyConfig.activationThreshold})`);
        }
    }

    if (!card) return null;

    // --- AUTO-CASHBACK: Accrue bonus points ---
    if (loyaltyConfig.autoCashback && amount > 0) {
        const level = calcLevel(card.totalSpent || 0);
        const cashbackPercent = level.cashback;
        const pointsEarned = Math.floor(amount * cashbackPercent / 100);

        if (pointsEarned > 0) {
            card.balance = (card.balance || 0) + pointsEarned;
            card.totalSpent = (card.totalSpent || 0) + amount;
            card.transactions.push({
                type: 'cashback',
                amount: pointsEarned,
                purchaseAmount: amount,
                cashbackPercent,
                reason: reason || 'Авто-кешбек',
                date: Date.now(),
            });

            // Auto-upgrade level
            const newLevel = calcLevel(card.totalSpent);
            if (newLevel.name !== card.level) {
                const oldLevel = card.level;
                card.level = newLevel.name;
                card.transactions.push({
                    type: 'level_up',
                    from: oldLevel,
                    to: newLevel.name,
                    reason: `Повышение уровня: ${oldLevel} → ${newLevel.name}`,
                    date: Date.now(),
                });
                console.log(`🏅 LEVEL UP: ${cleanPhone} ${oldLevel} → ${newLevel.name}`);
            }

            card.updatedAt = Date.now();
            loyaltyCards.set(cleanPhone, card);
            persistData();
            console.log(`⭐ AUTO-CASHBACK: +${pointsEarned} pts for ${cleanPhone} (${cashbackPercent}% of ${amount} сўм)`);
        }
    }

    return card;
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

// ─── SMS OTP (Eskiz.uz) ─────────────────────────────
const ESKIZ_TOKEN = process.env.ESKIZ_TOKEN || '';
const smsCodes = new Map();

app.post('/api/auth/sms/send', async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone required' });
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const sessionId = crypto.randomBytes(16).toString('hex');
    smsCodes.set(phone, { code, sessionId, expires: Date.now() + 300000 });

    // If Eskiz.uz token is set, send real SMS
    if (ESKIZ_TOKEN) {
        try {
            await fetch('https://notify.eskiz.uz/api/message/sms/send', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${ESKIZ_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ mobile_phone: phone.replace(/\D/g, ''), message: `KOSKO: Ваш код: ${code}`, from: '4546' }),
            });
        } catch (err) { console.log('Eskiz error:', err.message); }
    }

    console.log(`📱 SMS OTP for ${phone}: ${code}`);
    res.json({ success: true, sessionId });
});

app.post('/api/auth/sms/verify', (req, res) => {
    const { phone, code } = req.body;
    const stored = smsCodes.get(phone);
    if (!stored) return res.status(400).json({ error: 'Code not found' });
    if (Date.now() > stored.expires) return res.status(400).json({ error: 'Code expired' });
    if (stored.code !== code) return res.status(400).json({ error: 'Wrong code' });
    smsCodes.delete(phone);
    const token = crypto.randomBytes(32).toString('hex');
    res.json({ verified: true, token });
});

// ─── PAYMENT (Click/Payme stubs) ─────────────────────
const payments = new Map();

app.post('/api/payment/click/create', (req, res) => {
    const { amount, transaction_param } = req.body;
    const id = 'click_' + Date.now();
    payments.set(id, { status: 'pending', amount, orderId: transaction_param, provider: 'click' });
    // In production: redirect to Click API
    res.json({ transactionId: id, paymentUrl: `https://my.click.uz/services/pay?amount=${amount}` });
});

app.post('/api/payment/payme/create', (req, res) => {
    const { orderId, amount } = req.body;
    const id = 'payme_' + Date.now();
    payments.set(id, { status: 'pending', amount, orderId, provider: 'payme' });
    res.json({ transactionId: id });
});

app.get('/api/payment/:provider/status/:id', (req, res) => {
    const payment = payments.get(req.params.id);
    if (!payment) return res.status(404).json({ paid: false, status: 'not_found' });
    res.json({ paid: payment.status === 'paid', status: payment.status });
});

// ─── PUSH NOTIFICATIONS ─────────────────────────────
const pushTokens = [];

app.post('/api/push/register', (req, res) => {
    const { token, platform } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });
    if (!pushTokens.find(t => t.token === token)) {
        pushTokens.push({ token, platform, registered: Date.now() });
        console.log(`📲 Push token registered: ${token.slice(0, 20)}...`);
    }
    res.json({ ok: true, total: pushTokens.length });
});

app.post('/api/push/send', async (req, res) => {
    const { title, body } = req.body;
    // Send via Expo Push API
    const messages = pushTokens.map(t => ({ to: t.token, title, body, sound: 'default' }));
    try {
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(messages),
        });
        res.json({ ok: true, sent: messages.length });
    } catch (err) {
        res.json({ ok: false, error: err.message });
    }
});

// ─── STORE SETTINGS (Phase 0.1) ─────────────────────
// Controls delivery toggle, working hours, etc.
let storeSettings = {
    deliveryEnabled: true,
    freeDeliveryThreshold: 150000,
    deliveryFee: 10000,
    minOrderAmount: 20000,
    workingHours: { from: '08:00', to: '22:00' },
    storeName: 'KOSKO',
    storePhone: '+998 XX XXX XX XX',
    updatedAt: Date.now(),
};

app.get('/api/settings', (req, res) => {
    res.json(storeSettings);
});

app.post('/api/settings', (req, res) => {
    Object.assign(storeSettings, req.body, { updatedAt: Date.now() });
    console.log('⚙️ Settings updated:', JSON.stringify(storeSettings));
    persistData();
    res.json({ ok: true, settings: storeSettings });
});

// Convenience toggle for delivery
app.post('/api/settings/delivery/toggle', (req, res) => {
    storeSettings.deliveryEnabled = !storeSettings.deliveryEnabled;
    storeSettings.updatedAt = Date.now();
    console.log(`🚚 Delivery ${storeSettings.deliveryEnabled ? 'ENABLED' : 'DISABLED'}`);
    persistData();
    res.json({ ok: true, deliveryEnabled: storeSettings.deliveryEnabled });
});
// ─── 1C INTEGRATION (MULTI-STORE) ────────────────────
let integration1cStores = [
    { id: 'kosko-3-2', name: 'КОСКО 3/2', server: 'KServer', port: 1541, baseName: 'KOSKO', login: '', password: '', syncInterval: 5, cloudApiKey: crypto.randomUUID(), enabled: false, lastSync: null, lastError: null, syncStatus: 'idle', syncAdded: 0, syncUpdated: 0 },
    { id: 'kosko-koltso', name: 'КОСКО Кольцо', server: '', port: 1541, baseName: '', login: '', password: '', syncInterval: 5, cloudApiKey: crypto.randomUUID(), enabled: false, lastSync: null, lastError: null, syncStatus: 'idle', syncAdded: 0, syncUpdated: 0 },
    { id: 'koltso-trassa', name: 'Кольцо Трасса', server: '', port: 1541, baseName: '', login: '', password: '', syncInterval: 5, cloudApiKey: crypto.randomUUID(), enabled: false, lastSync: null, lastError: null, syncStatus: 'idle', syncAdded: 0, syncUpdated: 0 },
];

// Get all stores config (no passwords)
app.get('/api/1c/stores', (req, res) => {
    res.json(integration1cStores.map(s => {
        const { password, ...safe } = s;
        return { ...safe, hasPassword: !!password };
    }));
});

// Save store config by ID
app.post('/api/1c/stores/:storeId/config', (req, res) => {
    const store = integration1cStores.find(s => s.id === req.params.storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const { server, port, baseName, login, password, syncInterval, enabled } = req.body;
    if (server !== undefined) store.server = server;
    if (port !== undefined) store.port = Number(port);
    if (baseName !== undefined) store.baseName = baseName;
    if (login !== undefined) store.login = login;
    if (password !== undefined && password !== '') store.password = password;
    if (syncInterval !== undefined) store.syncInterval = Number(syncInterval);
    if (enabled !== undefined) store.enabled = enabled;
    console.log(`🔗 1C [${store.name}] config: ${store.server}:${store.port}/${store.baseName}`);
    persistData();
    const { password: pw, ...safe } = store;
    res.json({ ok: true, store: { ...safe, hasPassword: !!pw } });
});

// Receive products from store agent
app.post('/api/1c/sync/products', (req, res) => {
    const { apiKey, items, storeId } = req.body;
    const store = integration1cStores.find(s => s.cloudApiKey === apiKey);
    if (!store) return res.status(403).json({ error: 'Invalid API key' });
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items must be array' });
    const sid = store.id;
    store.syncStatus = 'syncing';
    let added = 0, updated = 0;
    for (const item of items) {
        const existing = Array.from(products.values()).find(p => p.barcode === item.barcode && p.storeId === sid);
        if (existing) {
            Object.assign(existing, { name: item.name || existing.name, price: item.price ?? existing.price, category: item.category || existing.category, unit: item.unit || existing.unit, updatedAt: Date.now() });
            updated++;
        } else {
            const id = String(productIdCounter++);
            products.set(id, { id, name: item.name || 'Без названия', price: item.price || 0, barcode: item.barcode || '', category: item.category || 'Товары', unit: item.unit || 'шт', imageUrl: '', description: '', createdAt: Date.now(), updatedAt: Date.now(), source: '1c', storeId: sid });
            added++;
        }
    }
    Object.assign(store, { lastSync: Date.now(), lastError: null, syncStatus: 'success', syncAdded: added, syncUpdated: updated });
    persistData();
    console.log(`📦 1C [${store.name}]: +${added} new, ${updated} updated`);
    res.json({ ok: true, store: store.name, added, updated, total: items.length });
});

// Status per store
app.get('/api/1c/stores/:storeId/status', (req, res) => {
    const store = integration1cStores.find(s => s.id === req.params.storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    res.json({ id: store.id, name: store.name, syncStatus: store.syncStatus, lastSync: store.lastSync, lastError: store.lastError, syncAdded: store.syncAdded, syncUpdated: store.syncUpdated, productsCount: Array.from(products.values()).filter(p => p.storeId === store.id).length });
});

// Products by store
app.get('/api/1c/stores/:storeId/products', (req, res) => {
    const sid = req.params.storeId;
    const from1c = Array.from(products.values()).filter(p => p.source === '1c' && (!sid || sid === 'all' || p.storeId === sid));
    res.json({ total: from1c.length, products: from1c.slice(0, 100) });
});

// All 1C products
app.get('/api/1c/products', (req, res) => {
    const from1c = Array.from(products.values()).filter(p => p.source === '1c');
    res.json({ total: from1c.length, products: from1c.slice(0, 100) });
});

// Test sync for a store
app.post('/api/1c/stores/:storeId/test-sync', (req, res) => {
    const store = integration1cStores.find(s => s.id === req.params.storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const testItems = [
        { barcode: 'TEST-' + store.id + '-001', name: 'Тест ' + store.name + ' #1', price: 15000, unit: 'шт', category: 'Тест' },
        { barcode: 'TEST-' + store.id + '-002', name: 'Тест ' + store.name + ' #2', price: 25000, unit: 'шт', category: 'Тест' },
    ];
    let added = 0, updated = 0;
    for (const item of testItems) {
        const existing = Array.from(products.values()).find(p => p.barcode === item.barcode && p.storeId === store.id);
        if (existing) { Object.assign(existing, { ...item, updatedAt: Date.now() }); updated++; }
        else { const id = String(productIdCounter++); products.set(id, { id, ...item, imageUrl: '', description: '', createdAt: Date.now(), updatedAt: Date.now(), source: '1c', storeId: store.id }); added++; }
    }
    Object.assign(store, { lastSync: Date.now(), lastError: null, syncStatus: 'success', syncAdded: added, syncUpdated: updated });
    persistData();
    res.json({ ok: true, message: `Тест [${store.name}]: +${added} новых, ${updated} обновлённых` });
});

// Backward compat
app.get('/api/1c/config', (req, res) => { res.redirect('/api/1c/stores'); });
app.get('/api/1c/status', (req, res) => { res.json(integration1cStores.map(s => ({ id: s.id, name: s.name, syncStatus: s.syncStatus, lastSync: s.lastSync }))); });

// Download agent for specific store
app.get('/api/1c/stores/:storeId/agent', (req, res) => {
    const store = integration1cStores.find(s => s.id === req.params.storeId);
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const script = generate1CAgentScript(store);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="kosko-agent-' + store.id + '.bat"');
    res.send(script);
});

function generate1CAgentScript(cfg) {
    const lines = [
        '@echo off',
        'chcp 65001 >nul',
        'echo ======================================',
        'echo   KOSKO Agent - ' + cfg.name,
        'echo ======================================',
        '',
        'powershell -ExecutionPolicy Bypass -Command "',
        "$ErrorActionPreference = 'Stop'",
        "$server = '" + cfg.server + "'",
        '$port = ' + cfg.port,
        "$base = '" + cfg.baseName + "'",
        "$login = '" + cfg.login + "'",
        "$password = '" + cfg.password + "'",
        "$cloudUrl = 'https://kosko-auth-server.onrender.com/api/1c/sync/products'",
        "$apiKey = '" + cfg.cloudApiKey + "'",
        "$storeId = '" + cfg.id + "'",
        '',
        "Write-Host 'Connecting to 1C [" + cfg.name + "]...' -ForegroundColor Cyan",
        'try {',
        "    $connector = New-Object -ComObject V83.COMConnector",
        "    $connStr = 'Srvr=' + $server + ';Ref=' + $base + ';Usr=' + $login + ';Pwd=' + $password",
        '    $conn = $connector.Connect($connStr)',
        "    Write-Host 'Connected to 1C' -ForegroundColor Green",
        '',
        "    $query = $conn.NewObject('Query')",
        "    $query.Text = 'SELECT Code, Description AS Name FROM Catalog.Nomenclature WHERE DeletionMark = FALSE AND IsFolder = FALSE'",
        '',
        '    try {',
        '        $result = $query.Execute().Unload()',
        '    } catch {',
        "        Write-Host 'Trying Russian query...' -ForegroundColor Yellow",
        "        $query.Text = 'ВЫБРАТЬ Код, Наименование КАК Name ИЗ Справочник.Номенклатура ГДЕ ПометкаУдаления = ЛОЖЬ И ЭтоГруппа = ЛОЖЬ'",
        '        $result = $query.Execute().Unload()',
        '    }',
        '',
        '    $items = @()',
        '    for ($i = 0; $i -lt $result.Count(); $i++) {',
        '        $row = $result.Get($i)',
        '        $items += @{ barcode = $row.Code; name = $row.Name; price = 0; unit = "sht"; category = "Products" }',
        '    }',
        "    Write-Host ('Found ' + $items.Count + ' products') -ForegroundColor Green",
        '    $conn = $null',
        '',
        '    $body = @{ apiKey = $apiKey; storeId = $storeId; items = $items } | ConvertTo-Json -Depth 5 -Compress',
        "    $resp = Invoke-RestMethod -Uri $cloudUrl -Method POST -Body $body -ContentType 'application/json; charset=utf-8'",
        "    Write-Host ('Synced! Added: ' + $resp.added + ', Updated: ' + $resp.updated) -ForegroundColor Green",
        '} catch {',
        "    Write-Host ('Error: ' + $_.Exception.Message) -ForegroundColor Red",
        '}',
        "Write-Host 'Press any key to close...'",
        "$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')",
        '"',
    ];
    return lines.join('\r\n');
}

// ─── PRODUCTS CRUD (Phase 0.4) ───────────────────────
const products = new Map(); // id → product
let productIdCounter = 1;

app.get('/api/products', (req, res) => {
    const list = Array.from(products.values());
    const { category, q } = req.query;
    const filtered = list
        .filter(p => !category || p.category === category)
        .filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()));
    res.json({ products: filtered, total: filtered.length, updatedAt: Date.now() });
});

app.post('/api/products', (req, res) => {
    const { name, price, barcode, category, unit, imageUrl, description } = req.body;
    if (!name || !price) return res.status(400).json({ error: 'name and price required' });
    const id = 'prod_' + (productIdCounter++);
    const product = { id, name, price: Number(price), barcode: barcode || '', category: category || 'Прочее', unit: unit || 'шт', imageUrl: imageUrl || '', description: description || '', createdAt: Date.now(), updatedAt: Date.now() };
    products.set(id, product);
    persistData();
    res.json({ ok: true, product });
});

app.put('/api/products/:id', (req, res) => {
    const p = products.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    Object.assign(p, req.body, { updatedAt: Date.now() });
    persistData();
    res.json({ ok: true, product: p });
});

app.delete('/api/products/:id', (req, res) => {
    if (!products.has(req.params.id)) return res.status(404).json({ error: 'Not found' });
    products.delete(req.params.id);
    persistData();
    res.json({ ok: true });
});

// Mass import from 1C or Excel parse result
app.post('/api/products/sync', (req, res) => {
    const { products: items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'products array required' });
    let added = 0, updated = 0;
    for (const item of items) {
        const existing = Array.from(products.values()).find(p => p.barcode === item.barcode);
        if (existing) {
            Object.assign(existing, item, { updatedAt: Date.now() });
            updated++;
        } else {
            const id = 'prod_' + (productIdCounter++);
            products.set(id, { id, ...item, createdAt: Date.now(), updatedAt: Date.now() });
            added++;
        }
    }
    console.log(`📦 Products sync: +${added} new, ~${updated} updated`);
    persistData();
    res.json({ ok: true, added, updated, total: products.size });
});

// Export all products as JSON (for CSV generation on client)
app.get('/api/products/export', (req, res) => {
    res.json({ products: Array.from(products.values()) });
});

// ─── BANNERS CRUD (Phase 0.4) ────────────────────────
const banners = [];
let bannerIdCounter = 1;

app.get('/api/banners', (req, res) => {
    res.json({ banners: banners.filter(b => b.active), updatedAt: Date.now() });
});
app.post('/api/banners', (req, res) => {
    const { title, imageUrl, linkScreen, linkParam, color } = req.body;
    const banner = { id: 'ban_' + (bannerIdCounter++), title: title || '', imageUrl: imageUrl || '', linkScreen: linkScreen || '', linkParam: linkParam || '', color: color || '#6C63FF', active: true, createdAt: Date.now() };
    banners.push(banner);
    persistData();
    res.json({ ok: true, banner });
});
app.delete('/api/banners/:id', (req, res) => {
    const idx = banners.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    banners[idx].active = false;
    persistData();
    res.json({ ok: true });
});

// ─── PROMOCODES CRUD (Phase 0.4) ─────────────────────
const promocodes = new Map();

app.get('/api/promocodes', (req, res) => {
    res.json({ promocodes: Array.from(promocodes.values()) });
});
app.post('/api/promocodes', (req, res) => {
    const { code, discountPercent, discountAmount, minOrder, expiresAt, usageLimit } = req.body;
    if (!code) return res.status(400).json({ error: 'code required' });
    const promo = { code: code.toUpperCase(), discountPercent: discountPercent || 0, discountAmount: discountAmount || 0, minOrder: minOrder || 0, expiresAt: expiresAt || null, usageLimit: usageLimit || 999, usageCount: 0, active: true, createdAt: Date.now() };
    promocodes.set(promo.code, promo);
    persistData();
    res.json({ ok: true, promo });
});
app.post('/api/promocodes/verify', (req, res) => {
    const { code, orderAmount } = req.body;
    const promo = promocodes.get((code || '').toUpperCase());
    if (!promo || !promo.active) return res.json({ valid: false, reason: 'Промокод не найден' });
    if (promo.expiresAt && Date.now() > promo.expiresAt) return res.json({ valid: false, reason: 'Промокод истёк' });
    if (promo.usageCount >= promo.usageLimit) return res.json({ valid: false, reason: 'Лимит использований исчерпан' });
    if (orderAmount && orderAmount < promo.minOrder) return res.json({ valid: false, reason: `Минимальная сумма: ${promo.minOrder.toLocaleString('ru')} сўм` });
    promo.usageCount++;
    const discount = promo.discountPercent ? Math.floor(orderAmount * promo.discountPercent / 100) : promo.discountAmount;
    persistData();
    res.json({ valid: true, discount, promo });
});
app.delete('/api/promocodes/:code', (req, res) => {
    const promo = promocodes.get(req.params.code.toUpperCase());
    if (!promo) return res.status(404).json({ error: 'Not found' });
    promo.active = false;
    persistData();
    res.json({ ok: true });
});

// ─── PROMOTIONS (Phase 0.4) ──────────────────────────
const promotions = [];
let promoIdCounter = 1;
app.get('/api/promotions', (req, res) => {
    res.json({ promotions: promotions.filter(p => p.active), updatedAt: Date.now() });
});
app.post('/api/promotions', (req, res) => {
    const { title, description, imageUrl, discountPercent, expiresAt } = req.body;
    const promo = { id: 'prom_' + (promoIdCounter++), title, description: description || '', imageUrl: imageUrl || '', discountPercent: discountPercent || 0, expiresAt: expiresAt || null, active: true, createdAt: Date.now() };
    promotions.push(promo);
    persistData();
    res.json({ ok: true, promotion: promo });
});
app.delete('/api/promotions/:id', (req, res) => {
    const p = promotions.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    p.active = false;
    persistData();
    res.json({ ok: true });
});

// ─── ORDERS (delivery tracking) ──────────────────────
const orders = new Map(); // id → order
let orderIdCounter = 1;

// Mobile app creates order
app.post('/api/orders', (req, res) => {
    const { items, delivery, address, phone, payMethod, comment, promoCode, total, deliveryFee } = req.body;
    const id = 'ord_' + (orderIdCounter++);
    const order = {
        id,
        items: items || [],
        delivery: delivery || 'pickup',
        address: address || '',
        phone: phone || '',
        payMethod: payMethod || 'cash',
        comment: comment || '',
        promoCode: promoCode || '',
        total: total || 0,
        deliveryFee: deliveryFee || 0,
        status: 'new', // new → confirmed → preparing → delivering → delivered / cancelled
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    orders.set(id, order);
    console.log(`📦 New order ${id}: ${order.delivery}, ${order.total} сўм, ${order.items.length} items`);
    persistData();
    res.json({ ok: true, order });
});

// Admin gets all orders
app.get('/api/orders', (req, res) => {
    const list = Array.from(orders.values()).sort((a, b) => b.createdAt - a.createdAt);
    const { status } = req.query;
    const filtered = status ? list.filter(o => o.status === status) : list;
    res.json({ orders: filtered, total: filtered.length });
});

// Admin updates order status
app.patch('/api/orders/:id/status', (req, res) => {
    const order = orders.get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const oldStatus = order.status;
    order.status = req.body.status || order.status;
    order.updatedAt = Date.now();
    console.log(`📦 Order ${order.id} → ${order.status}`);

    // AUTO-CASHBACK: when order is delivered or paid
    if ((order.status === 'delivered' || order.status === 'paid') && oldStatus !== order.status) {
        const loyaltyResult = autoProcessLoyalty(order.phone, order.total, `Заказ ${order.id}`);
        if (loyaltyResult) {
            console.log(`⭐ Loyalty processed for order ${order.id}: ${order.phone}`);
        }
    }

    persistData();
    res.json({ ok: true, order });
});

// Payment confirmation (in-store or online) — triggers cashback
app.post('/api/payment/confirm', (req, res) => {
    const { phone, amount, receiptId, source } = req.body;
    if (!phone || !amount) return res.status(400).json({ error: 'phone and amount required' });
    const loyaltyResult = autoProcessLoyalty(phone, amount, `Оплата ${source || 'магазин'}${receiptId ? ' чек ' + receiptId : ''}`);
    if (loyaltyResult) {
        res.json({ ok: true, card: loyaltyResult, message: `Начислено баллов: кешбек от ${amount} сўм` });
    } else {
        // Check if threshold not yet reached
        const cleanPhone = phone.replace(/\D/g, '');
        let totalSpent = Number(amount) || 0;
        for (const [, order] of orders) {
            if ((order.phone || '').replace(/\D/g, '') === cleanPhone && (order.status === 'delivered' || order.status === 'paid')) {
                totalSpent += Number(order.total) || 0;
            }
        }
        res.json({ ok: false, message: `Карта ещё не активирована. Потрачено: ${totalSpent} из ${loyaltyConfig.activationThreshold} сўм` });
    }
});

// Loyalty config API
app.get('/api/loyalty/config', (req, res) => {
    res.json(loyaltyConfig);
});

app.post('/api/loyalty/config', (req, res) => {
    Object.assign(loyaltyConfig, req.body);
    persistData();
    console.log('⚙️ Loyalty config updated:', JSON.stringify(loyaltyConfig));
    res.json({ ok: true, config: loyaltyConfig });
});

// ─── SERVER REGISTRY ─────────────────────────────────
// Stores all servers discovered by mobile apps
// Admin reviews them and approves which ones to sync

const serverRegistry = new Map(); // id → server record

app.post('/api/registry/report', (req, res) => {
    // Mobile app reports a newly discovered server
    const { baseUrl, name, type, networkType, storeId, storeName, scanDuration, scannedIPs, deviceId, appVersion } = req.body;
    if (!baseUrl) return res.status(400).json({ error: 'baseUrl required' });

    const id = crypto.createHash('md5').update(baseUrl).digest('hex').slice(0, 8);
    const existing = serverRegistry.get(id);

    const record = {
        id,
        baseUrl,
        name: name || `Сервер (${new URL(baseUrl).hostname})`,
        type: type || 'local',         // local | cloud | manual
        networkType: networkType || 'ip',
        storeId: storeId || null,
        storeName: storeName || null,
        status: existing?.status || 'new',  // new | approved | rejected | syncing
        firstSeen: existing?.firstSeen || Date.now(),
        lastSeen: Date.now(),
        seenCount: (existing?.seenCount || 0) + 1,
        scanDuration: scanDuration || null,
        scannedIPs: scannedIPs || null,
        deviceId: deviceId || 'unknown',
        appVersion: appVersion || '2.0',
        syncEnabled: existing?.syncEnabled || false,
        notes: existing?.notes || '',
    };

    serverRegistry.set(id, record);
    console.log(`📡 Server reported: ${baseUrl} [${record.status}] (seen ${record.seenCount}x)`);
    persistData();
    res.json({ ok: true, id, status: record.status, syncEnabled: record.syncEnabled });
});

// Get all registered servers (admin view)
app.get('/api/registry/servers', (req, res) => {
    const list = Array.from(serverRegistry.values())
        .sort((a, b) => b.lastSeen - a.lastSeen);
    res.json({ servers: list, total: list.length });
});

// Get single server
app.get('/api/registry/servers/:id', (req, res) => {
    const server = serverRegistry.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'Not found' });
    res.json(server);
});

// Approve server for sync (admin action)
app.post('/api/registry/servers/:id/approve', (req, res) => {
    const server = serverRegistry.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'Not found' });
    server.status = 'approved';
    server.syncEnabled = true;
    server.notes = req.body.notes || server.notes;
    console.log(`✅ Server approved for sync: ${server.baseUrl}`);
    persistData();
    res.json({ ok: true, server });
});

// Reject server (admin action)
app.post('/api/registry/servers/:id/reject', (req, res) => {
    const server = serverRegistry.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'Not found' });
    server.status = 'rejected';
    server.syncEnabled = false;
    persistData();
    res.json({ ok: true, server });
});

// Update server notes
app.put('/api/registry/servers/:id', (req, res) => {
    const server = serverRegistry.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'Not found' });
    Object.assign(server, req.body);
    res.json({ ok: true, server });
});

// Mobile app asks: which servers are approved for sync?
app.get('/api/registry/approved', (req, res) => {
    const approved = Array.from(serverRegistry.values()).filter(s => s.syncEnabled);
    res.json({ servers: approved });
});

// ─── LOYALTY CARDS ───────────────────────────────────
// Cards stored on cloud, synced with store servers
// loyaltyCards Map is declared above (line ~296)

// List all cards (admin) — MUST be before /:phone route
app.get('/api/loyalty', (req, res) => {
    res.json({ cards: Array.from(loyaltyCards.values()), total: loyaltyCards.size });
});

// Get card by phone
app.get('/api/loyalty/:phone', (req, res) => {
    const phone = req.params.phone.replace(/\D/g, '');
    const card = loyaltyCards.get(phone);
    if (!card) return res.json({ found: false, phone });
    res.json({ found: true, card });
});

// Create or update card
app.post('/api/loyalty', (req, res) => {
    const { phone, name, balance, level } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const cleanPhone = phone.replace(/\D/g, '');
    const existing = loyaltyCards.get(cleanPhone);
    const card = {
        phone: cleanPhone,
        name: name || existing?.name || '',
        balance: balance ?? existing?.balance ?? 0,
        level: level || existing?.level || 'Стандарт',
        totalSpent: existing?.totalSpent || 0,
        transactions: existing?.transactions || [],
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
    };
    loyaltyCards.set(cleanPhone, card);
    persistData();
    res.json({ ok: true, card });
});

// Add points
app.post('/api/loyalty/:phone/add', (req, res) => {
    const phone = req.params.phone.replace(/\D/g, '');
    let card = loyaltyCards.get(phone);
    if (!card) {
        card = { phone, name: '', balance: 0, level: 'Стандарт', totalSpent: 0, transactions: [], createdAt: Date.now(), updatedAt: Date.now() };
    }
    const { amount, reason } = req.body;
    card.balance += Number(amount) || 0;
    card.transactions.push({ type: 'add', amount: Number(amount), reason: reason || 'Начисление', date: Date.now() });
    card.updatedAt = Date.now();
    loyaltyCards.set(phone, card);
    persistData();
    console.log(`⭐ Loyalty +${amount} → ${phone} (balance: ${card.balance})`);
    res.json({ ok: true, card });
});

// Spend points
app.post('/api/loyalty/:phone/spend', (req, res) => {
    const phone = req.params.phone.replace(/\D/g, '');
    const card = loyaltyCards.get(phone);
    if (!card) return res.status(404).json({ error: 'Карта не найдена' });
    const { amount, reason } = req.body;
    if (card.balance < Number(amount)) return res.json({ ok: false, error: 'Недостаточно баллов', balance: card.balance });
    card.balance -= Number(amount) || 0;
    card.totalSpent += Number(amount) || 0;
    card.transactions.push({ type: 'spend', amount: Number(amount), reason: reason || 'Списание', date: Date.now() });
    card.updatedAt = Date.now();
    // Auto level upgrade
    if (card.totalSpent >= 1000000) card.level = 'Платинум';
    else if (card.totalSpent >= 500000) card.level = 'Золото';
    else if (card.totalSpent >= 100000) card.level = 'Серебро';
    persistData();
    console.log(`⭐ Loyalty -${amount} → ${phone} (balance: ${card.balance})`);
    res.json({ ok: true, card });
});


// ─── STORE SERVER BRIDGE ─────────────────────────────
// Fetches data from approved store servers (1C/Frontol)
app.post('/api/bridge/sync-loyalty', async (req, res) => {
    const approved = Array.from(serverRegistry.values()).filter(s => s.syncEnabled);
    if (!approved.length) return res.json({ ok: false, error: 'Нет одобренных серверов' });

    let synced = 0, errors = 0;
    for (const srv of approved) {
        try {
            // Try common 1C loyalty endpoints
            const endpoints = [
                `${srv.baseUrl}/api/loyalty/cards`,
                `${srv.baseUrl}/loyalty`,
                `${srv.baseUrl}/api/cards`,
                `${srv.baseUrl}/hs/loyalty/cards`,  // 1C HTTP service
            ];
            for (const url of endpoints) {
                try {
                    const controller = new AbortController();
                    setTimeout(() => controller.abort(), 5000);
                    const r = await fetch(url, { signal: controller.signal });
                    if (r.ok) {
                        const data = await r.json();
                        const cards = data.cards || data.data || (Array.isArray(data) ? data : []);
                        for (const c of cards) {
                            const phone = (c.phone || c.tel || c.mobile || '').replace(/\D/g, '');
                            if (!phone) continue;
                            const existing = loyaltyCards.get(phone) || {};
                            loyaltyCards.set(phone, {
                                phone,
                                name: c.name || c.fio || existing.name || '',
                                balance: c.balance ?? c.bonus ?? existing.balance ?? 0,
                                level: c.level || c.category || existing.level || 'Стандарт',
                                totalSpent: c.totalSpent || existing.totalSpent || 0,
                                transactions: existing.transactions || [],
                                createdAt: existing.createdAt || Date.now(),
                                updatedAt: Date.now(),
                                source: srv.baseUrl,
                            });
                            synced++;
                        }
                        console.log(`⭐ Synced ${cards.length} loyalty cards from ${url}`);
                        break; // Found working endpoint, stop trying
                    }
                } catch {}
            }
        } catch { errors++; }
    }
    persistData();
    res.json({ ok: true, synced, errors, total: loyaltyCards.size });
});

// Try to sync products from approved servers
app.post('/api/bridge/sync-products', async (req, res) => {
    const approved = Array.from(serverRegistry.values()).filter(s => s.syncEnabled);
    if (!approved.length) return res.json({ ok: false, error: 'Нет одобренных серверов' });

    let synced = 0;
    for (const srv of approved) {
        const endpoints = [
            `${srv.baseUrl}/api/products`,
            `${srv.baseUrl}/products`,
            `${srv.baseUrl}/hs/products`,
            `${srv.baseUrl}/api/goods`,
        ];
        for (const url of endpoints) {
            try {
                const controller = new AbortController();
                setTimeout(() => controller.abort(), 5000);
                const r = await fetch(url, { signal: controller.signal });
                if (r.ok) {
                    const data = await r.json();
                    const items = data.products || data.goods || data.data || (Array.isArray(data) ? data : []);
                    for (const item of items) {
                        const barcode = item.barcode || item.code || '';
                        const existing = Array.from(products.values()).find(p => p.barcode === barcode);
                        if (existing) {
                            Object.assign(existing, { name: item.name || existing.name, price: item.price || existing.price, updatedAt: Date.now() });
                        } else {
                            const id = 'prod_' + (productIdCounter++);
                            products.set(id, { id, name: item.name || 'Товар', price: item.price || 0, barcode, category: item.category || 'Прочее', unit: item.unit || 'шт', imageUrl: '', createdAt: Date.now(), updatedAt: Date.now(), source: srv.baseUrl });
                        }
                        synced++;
                    }
                    console.log(`📦 Synced ${items.length} products from ${url}`);
                    break;
                }
            } catch {}
        }
    }
    persistData();
    res.json({ ok: true, synced, total: products.size });
});

// ─── Health check ────────────────────────────────────
app.get('/health', (req, res) => res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    chatMessages: chatMessages.length,
    loyaltyCards: loyaltyCards.size,
    pushTokens: pushTokens.length,
    registeredServers: serverRegistry.size,
}));
app.get('/', (req, res) => res.json({ service: 'KOSKO Full Platform', version: '2.1', status: 'running' }));

// ─── Start ───────────────────────────────────────────
async function startServer() {
    // Initialize PostgreSQL and restore data
    await initDB();
    const saved = await loadPersistedData();
    if (saved) {
        if (saved.storeSettings) Object.assign(storeSettings, saved.storeSettings);
        if (saved.products) { products.clear(); saved.products.forEach(([k,v]) => products.set(k,v)); }
        if (saved.productIdCounter) productIdCounter = saved.productIdCounter;
        if (saved.banners) { banners.length = 0; banners.push(...saved.banners); }
        if (saved.bannerIdCounter) bannerIdCounter = saved.bannerIdCounter;
        if (saved.promocodes) { promocodes.clear(); saved.promocodes.forEach(([k,v]) => promocodes.set(k,v)); }
        if (saved.orders) { orders.clear(); saved.orders.forEach(([k,v]) => orders.set(k,v)); }
        if (saved.orderIdCounter) orderIdCounter = saved.orderIdCounter;
        if (saved.serverRegistry) { serverRegistry.clear(); saved.serverRegistry.forEach(([k,v]) => serverRegistry.set(k,v)); }
        if (saved.loyaltyCards) { loyaltyCards.clear(); saved.loyaltyCards.forEach(([k,v]) => loyaltyCards.set(k,v)); }
        if (saved.loyaltyConfig) Object.assign(loyaltyConfig, saved.loyaltyConfig);
        if (saved.promotions) { promotions.length = 0; promotions.push(...saved.promotions); }
        if (saved.promoIdCounter) promoIdCounter = saved.promoIdCounter;
        if (saved.integration1cStores) { saved.integration1cStores.forEach(ss => { const st = integration1cStores.find(s => s.id === ss.id); if (st) Object.assign(st, ss); else integration1cStores.push(ss); }); }
        console.log(`✅ Restored: ${products.size} products, ${orders.size} orders, ${serverRegistry.size} servers, ${loyaltyCards.size} loyalty cards`);
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 KOSKO Auth Server on port ${PORT}`);
        fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`)
            .then(() => { console.log('🤖 Bot polling started'); pollTelegram(); })
            .catch(() => pollTelegram());
    });
}

startServer().catch(e => { console.error('❌ Failed to start:', e); process.exit(1); });
