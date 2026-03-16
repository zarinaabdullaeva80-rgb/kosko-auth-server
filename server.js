// KOSKO Telegram Auth Server — Cloud Deployment Version
// Deploy to Render.com, Railway.app, or any Node.js host

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

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
const storeSettings = {
    deliveryEnabled: true,
    freeDeliveryThreshold: 150000, // сум
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
    res.json({ ok: true, settings: storeSettings });
});

// Convenience toggle for delivery
app.post('/api/settings/delivery/toggle', (req, res) => {
    storeSettings.deliveryEnabled = !storeSettings.deliveryEnabled;
    storeSettings.updatedAt = Date.now();
    console.log(`🚚 Delivery ${storeSettings.deliveryEnabled ? 'ENABLED' : 'DISABLED'}`);
    res.json({ ok: true, deliveryEnabled: storeSettings.deliveryEnabled });
});

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
    res.json({ ok: true, product });
});

app.put('/api/products/:id', (req, res) => {
    const p = products.get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    Object.assign(p, req.body, { updatedAt: Date.now() });
    res.json({ ok: true, product: p });
});

app.delete('/api/products/:id', (req, res) => {
    if (!products.has(req.params.id)) return res.status(404).json({ error: 'Not found' });
    products.delete(req.params.id);
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
    res.json({ ok: true, banner });
});
app.delete('/api/banners/:id', (req, res) => {
    const idx = banners.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    banners[idx].active = false;
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
    res.json({ valid: true, discount, promo });
});
app.delete('/api/promocodes/:code', (req, res) => {
    const promo = promocodes.get(req.params.code.toUpperCase());
    if (!promo) return res.status(404).json({ error: 'Not found' });
    promo.active = false;
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
    res.json({ ok: true, promotion: promo });
});
app.delete('/api/promotions/:id', (req, res) => {
    const p = promotions.find(x => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    p.active = false;
    res.json({ ok: true });
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
    res.json({ ok: true, server });
});

// Reject server (admin action)
app.post('/api/registry/servers/:id/reject', (req, res) => {
    const server = serverRegistry.get(req.params.id);
    if (!server) return res.status(404).json({ error: 'Not found' });
    server.status = 'rejected';
    server.syncEnabled = false;
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
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 KOSKO Auth Server on port ${PORT}`);
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`)
        .then(() => { console.log('🤖 Bot polling started'); pollTelegram(); })
        .catch(() => pollTelegram());
});
