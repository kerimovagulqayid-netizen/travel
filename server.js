const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. HƏR BİR HTTP SORĞUSUNU VƏ STATUSUNU LOGA YAZAN MIDDLEWARE
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`📡 [${new Date().toLocaleTimeString()}] ${req.method} ${req.originalUrl} ==> Status: ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Statik fayllar (Frontend qovluğu)
app.use(express.static(path.join(__dirname, 'public')));

// 2. POSTGRESQL BAĞLANTISI (Render / Local)
const pool = new Pool(
    process.env.DATABASE_URL
        ? {
              connectionString: process.env.DATABASE_URL,
              ssl: { rejectUnauthorized: false }
          }
        : {
              user: process.env.DB_USER || 'postgres',
              host: process.env.DB_HOST || 'localhost',
              database: process.env.DB_NAME || 'travel_db',
              password: process.env.DB_PASSWORD || '12345',
              port: process.env.DB_PORT || 5432,
          }
);

pool.connect()
    .then(() => console.log('✅ PostgreSQL Verilənlər bazasına uğurla bağlandı.'))
    .catch(err => console.error('❌ Database bağlantı xətası:', err.stack));

// 3. AES-256 ŞİFRƏLƏMƏ VƏ DEŞİFRƏ MEXANİZMİ
const AES_SECRET_KEY = crypto.scryptSync('voyage_secret_password', 'salt', 32);
const AES_IV = Buffer.alloc(16, 0);

function encryptAES256(text) {
    if (!text) return '';
    try {
        const cipher = crypto.createCipheriv('aes-256-cbc', AES_SECRET_KEY, AES_IV);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    } catch (e) {
        console.error('❌ Şifrələmə xətası:', e.message);
        return '';
    }
}

function decryptAES256(encryptedHex) {
    if (!encryptedHex) return '';
    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', AES_SECRET_KEY, AES_IV);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('❌ Deşifrə xətası (Yanlış şifrəli mətn):', e.message);
        return 'Xəta: Çözülmədi';
    }
}

// 4. MƏKANLAR API-Sİ (GET)
app.get('/api/places', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM places ORDER BY id DESC');
        
        const responseData = result.rows.map(place => {
            const priceValue = place.price || place.price_val || '0';
            const encryptedPrice = encryptAES256(String(priceValue));
            return {
                ...place,
                encrypted_price: encryptedPrice
            };
        });

        console.log(`📦 Bazadan ${responseData.length} məkan uğurla gətirildi və qiymətlər şifrələndi.`);
        res.json(responseData);
    } catch (err) {
        console.error('❌ API Xətası [/api/places]:', err.message);
        res.status(500).json({ error: 'Məlumatlar gətirilərkən server xətası baş verdi' });
    }
});

// 5. AES-256 DEŞİFRƏ API-Sİ (POST)
app.post('/api/decrypt-price', (req, res) => {
    const { encrypted_price } = req.body;
    
    if (!encrypted_price) {
        console.warn('⚠️ Xəbərdarlıq: /api/decrypt-price ünvanına boş məlumat göndərildi.');
        return res.status(400).json({ error: 'Şifrəli qiymət mətni tələb olunur' });
    }
    
    const originalPrice = decryptAES256(encrypted_price);
    console.log(`🔓 [DEŞİFRƏ UĞURLU] Şifrəli Mətn: ${encrypted_price} ==> Orijinal Qiymət: ${originalPrice}`);
    
    res.json({ decrypted_price: originalPrice });
});

// Qlobal Xəta Tutucu (Serverin çökmesinin qarşısını alır və loga yazır)
app.use((err, req, res, next) => {
    console.error('🔥 Kritik Server Xətası:', err.stack);
    res.status(500).json({ error: 'Daxili server xətası baş verdi' });
});

// Bütün səhifə sorğularını index.html-ə yönləndiririk (API yollarına toxunmadan)
app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server uğurla işə düşdü: http://localhost:${PORT}`);
});