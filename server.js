const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 1. HTTP SORĞULARINI RENDER LOGLARINA YAZDIRAN MIDDLEWARE
app.use((req, res, next) => {
    console.log(`📥 [${new Date().toLocaleTimeString()}] HTTP ${req.method} sorğusu gəldi: ${req.url}`);
    next();
});

// Statik fayllar (Frontend)
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

// 3. AES-256 AÇARI VƏ İLLİK VEKTOR
const AES_SECRET_KEY = crypto.scryptSync('voyage_secret_password', 'salt', 32);
const AES_IV = Buffer.alloc(16, 0);

function encryptAES256(text) {
    if (!text) return '';
    const cipher = crypto.createCipheriv('aes-256-cbc', AES_SECRET_KEY, AES_IV);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
}

function decryptAES256(encryptedHex) {
    if (!encryptedHex) return '';
    try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', AES_SECRET_KEY, AES_IV);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return 'Xəta: Çözülmədi';
    }
}

// 4. MƏKANLAR API-Sİ
app.get('/api/places', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM places ORDER BY id DESC');
        
        const responseData = result.rows.map(place => {
            const encryptedPrice = encryptAES256(place.price_val);
            return {
                ...place,
                encrypted_price: encryptedPrice
            };
        });

        console.log(`📦 Toplam ${responseData.length} məkan bazadan gətirildi və qiymətlər AES-256 ilə şifrələndi.`);
        res.json(responseData);
    } catch (err) {
        console.error('❌ Server xətası:', err.message);
        res.status(500).json({ error: 'Server xətası baş verdi' });
    }
});

// 5. AES-256 DEŞİFRƏ API-Sİ
app.post('/api/decrypt-price', (req, res) => {
    const { encrypted_price } = req.body;
    
    if (!encrypted_price) {
        return res.status(400).json({ error: 'Şifrəli qiymət mətni tələb olunur' });
    }
    
    const originalPrice = decryptAES256(encrypted_price);
    
    console.log(`🔓 [AES-256 DEŞİFRƏ] Şifrəli Mətn: ${encrypted_price} ==> Orijinal Qiymət: ${originalPrice}`);
    
    res.json({ decrypted_price: originalPrice });
});

// Bütün digər yolları index.html-ə yönləndiririk (API yollarına toxunmadan)
app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Server işləyir: port ${PORT}`);
});