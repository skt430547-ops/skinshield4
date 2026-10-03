const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();
const pool = require('./db');
const { initializeDatabase } = require('./database');

const app = express();
app.use(cors());
app.use(express.json({ limit: '6mb' }));

// Serve Static Files (Frontend UI)
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html on root route '/'
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
    if (err) {
      res.sendFile(path.join(__dirname, 'index.html'));
    }
  });
});

const API_HEADERS = {
  'User-Agent': 'SkinShieldApp/1.0 (contact@skinshield.app)'
};

function requireAdmin(req, res, next) {
  const configuredKey = process.env.ADMIN_API_KEY;
  if (!configuredKey || configuredKey.length < 32) {
    return res.status(503).json({
      error: 'Admin approval management is disabled. Configure a strong ADMIN_API_KEY on the server.'
    });
  }

  const suppliedKey = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!suppliedKey) {
    return res.status(401).json({ error: 'Admin authorization is required.' });
  }

  const expected = Buffer.from(configuredKey);
  const supplied = Buffer.from(suppliedKey);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return res.status(403).json({ error: 'Admin authorization failed.' });
  }

  return next();
}

app.get('/api/admin/products/:code', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT serial_number, product_name, brand, is_doctor_approved,
              certificate_id, doctor_name, doctor_license, clinic_name, approval_date
       FROM products
       WHERE serial_number = $1`,
      [req.params.code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product code is not in the SkinShield catalog. Add the product record before recording approval.' });
    }

    return res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Admin product lookup failed:', err.message);
    return res.status(500).json({ error: 'Could not load this product record.' });
  }
});

app.put('/api/admin/products/:code/doctor-approval', requireAdmin, async (req, res) => {
  const {
    certificateId,
    doctorName,
    doctorLicense,
    clinicName,
    approvalDate,
    attested
  } = req.body || {};

  const requiredFields = [
    ['certificateId', certificateId],
    ['doctorName', doctorName],
    ['doctorLicense', doctorLicense],
    ['approvalDate', approvalDate]
  ];
  const missingField = requiredFields.find(([, value]) =>
    typeof value !== 'string' || value.trim().length === 0
  );
  if (missingField) {
    return res.status(400).json({ error: `${missingField[0]} is required.` });
  }
  if (requiredFields.some(([, value]) => value.trim().length > 160)) {
    return res.status(400).json({ error: 'Certificate and doctor details must be 160 characters or fewer.' });
  }
  const parsedApprovalDate = typeof approvalDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(approvalDate)
    ? Date.parse(`${approvalDate}T00:00:00.000Z`)
    : NaN;
  if (
    !Number.isFinite(parsedApprovalDate) ||
    new Date(parsedApprovalDate).toISOString().slice(0, 10) !== approvalDate
  ) {
    return res.status(400).json({ error: 'approvalDate must be a valid date in YYYY-MM-DD format.' });
  }
  if (clinicName !== undefined && (typeof clinicName !== 'string' || clinicName.trim().length > 160)) {
    return res.status(400).json({ error: 'clinicName must be 160 characters or fewer.' });
  }
  if (attested !== true) {
    return res.status(400).json({ error: 'Confirm that this approval is supported by a real doctor-issued record.' });
  }

  try {
    const result = await pool.query(
      `UPDATE products
       SET is_doctor_approved = TRUE,
           certificate_id = $2,
           doctor_name = $3,
           doctor_license = $4,
           clinic_name = $5,
           approval_date = $6
       WHERE serial_number = $1
       RETURNING serial_number, product_name, brand, is_doctor_approved,
                 certificate_id, doctor_name, doctor_license, clinic_name, approval_date`,
      [
        req.params.code,
        certificateId.trim(),
        doctorName.trim(),
        doctorLicense.trim(),
        typeof clinicName === 'string' && clinicName.trim() ? clinicName.trim() : null,
        approvalDate
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Product code is not in the SkinShield catalog. Add the product record before recording approval.' });
    }

    return res.json({
      product: result.rows[0],
      notice: 'Approval details were recorded from the administrator attestation. SkinShield has not independently verified the doctor or certificate.'
    });
  } catch (err) {
    console.error('Could not record doctor approval:', err.message);
    return res.status(500).json({ error: 'Could not record doctor approval.' });
  }
});

app.get('/api/skin-guide/status', (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  return res.json({
    configured: typeof apiKey === 'string' && apiKey.trim().length > 0
  });
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({
      status: 'ok',
      database: 'connected',
      skinGuideConfigured: Boolean(process.env.OPENAI_API_KEY?.trim())
    });
  } catch (err) {
    console.error('Health check database query failed:', err.message);
    return res.status(503).json({
      status: 'error',
      database: 'unavailable',
      skinGuideConfigured: Boolean(process.env.OPENAI_API_KEY?.trim())
    });
  }
});

async function getRatingSummary() {
  const result = await pool.query(
    'SELECT COUNT(*)::int AS count, COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS average FROM app_ratings'
  );
  return {
    count: result.rows[0].count,
    average: Number(result.rows[0].average)
  };
}

app.get('/api/ratings', async (req, res) => {
  try {
    return res.json(await getRatingSummary());
  } catch (err) {
    console.error('Could not load app ratings:', err.message);
    return res.status(500).json({ error: 'Could not load app ratings.' });
  }
});

app.post('/api/ratings', async (req, res) => {
  const { clientId, rating } = req.body || {};
  if (
    typeof clientId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)
  ) {
    return res.status(400).json({ error: 'A valid anonymous rating ID is required.' });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be a whole number from 1 to 5.' });
  }

  try {
    await pool.query(
      `INSERT INTO app_ratings (client_id, rating)
       VALUES ($1, $2)
       ON CONFLICT (client_id)
       DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW()`,
      [clientId, rating]
    );
    return res.json(await getRatingSummary());
  } catch (err) {
    console.error('Could not save app rating:', err.message);
    return res.status(500).json({ error: 'Could not save your rating.' });
  }
});

app.post('/api/skin-guide', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(503).json({
      error: 'Skin photo guidance is not configured. Set OPENAI_API_KEY on the server.'
    });
  }

  const image = req.body && req.body.image;
  if (!req.body || req.body.consent !== true) {
    return res.status(400).json({ error: 'Explicit consent is required before sending a photo for analysis.' });
  }
  const imageMatch = typeof image === 'string'
    ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image)
    : null;

  if (!imageMatch) {
    return res.status(400).json({ error: 'Provide a JPEG, PNG, or WebP image as a base64 data URL.' });
  }

  const imageBytes = Buffer.from(imageMatch[2], 'base64');
  if (imageBytes.length === 0 || imageBytes.length > 4 * 1024 * 1024) {
    return res.status(413).json({ error: 'The image must be smaller than 4 MB after processing.' });
  }

  try {
    const response = await axios.post(
      'https://api.openai.com/v1/responses',
      {
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: [
                'You are a cautious skincare education assistant reviewing one user-submitted face photo.',
                'This is not a medical diagnostic task. Never diagnose, name a disease, or claim a definite skin problem from an image.',
                'Do not infer identity, age, ethnicity, causes, or severity. Do not judge attractiveness.',
                'Describe only clearly visible surface features in tentative language, such as "I can see a few blemish-like spots" or "some areas may look dry". Explain that lighting, camera quality, makeup, and image quality can affect appearance.',
                'If the photo is blurry, poorly lit, not a face, or insufficient to comment, state that clearly and do not guess.',
                'Offer low-risk, general care steps that could help support skin comfort, not a cure: gentle cleanser, fragrance-free moisturizer, broad-spectrum SPF 30+ sunscreen during the day, avoid scrubbing/picking, introduce one new product at a time, and stop products that irritate.',
                'Give a simple morning and evening routine using broad product categories only. Do not recommend brands, prescription medicines, strong active ingredients, procedures, or a treatment plan.',
                'Mention seeking a qualified dermatologist or clinician for persistent, worsening, painful, swollen, spreading, bleeding, infected-looking, or non-healing changes. Recommend urgent medical help for severe allergic reactions or trouble breathing.',
                'Be kind, concise, and practical. Make clear that the suggestions cannot determine what condition a person has.',
                'Use these exact headings: "What I can see (not a diagnosis)", "Gentle steps to try", "Simple morning and evening routine", and "When to contact a clinician".'
              ].join(' ')
            },
            { type: 'input_image', image_url: image, detail: 'high' }
          ]
        }],
        max_output_tokens: 600,
        store: false
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 45000,
        maxBodyLength: 6 * 1024 * 1024
      }
    );

    const guidance = (response.data.output || [])
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();

    if (!guidance) {
      console.error('OpenAI skin guidance returned no text output.');
      return res.status(502).json({ error: 'The AI service did not return guidance. Please try again.' });
    }

    return res.json({ guidance });
  } catch (err) {
    const status = err.response?.status;
    const upstreamMessage = err.response?.data?.error?.message || err.message;
    console.error('OpenAI skin guidance request failed:', {
      status: status || null,
      message: upstreamMessage
    });

    if (status === 401 || status === 403) {
      return res.status(502).json({
        error: 'OpenAI rejected the server API key. Check OPENAI_API_KEY in your server environment, then restart the backend.'
      });
    }
    if (status === 429) {
      return res.status(502).json({
        error: 'OpenAI is rate-limiting this request or the account has no available quota. Check your OpenAI account and try again later.'
      });
    }
    if (status === 400) {
      return res.status(502).json({
        error: 'OpenAI rejected the image request. Check that OPENAI_MODEL is a vision-capable model and the image is a valid JPEG, PNG, or WebP.'
      });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: 'OpenAI took too long to analyze the image. Please try again.'
      });
    }

    return res.status(502).json({
      error: 'Could not connect to the OpenAI skin-analysis service. Check the server internet connection and try again.'
    });
  }
});

// Helper function to format response for all UI keys
function formatResponse(
  success,
  source,
  serial,
  name,
  brand,
  isAuthentic,
  message = '',
  status = isAuthentic ? 'REAL' : 'FAKE',
  isDoctorApproved = null,
  certificate = null,
  doctorApprovalStatus = 'unknown'
) {
  return {
    success: success,
    source: source,
    message: message,
    // Root level keys (for index.html direct access)
    serial_code: serial,
    serial_number: serial,
    product_name: name,
    name: name,
    brand: brand,
    status: status,
    is_authentic: isAuthentic,
    is_doctor_approved: isDoctorApproved,
    doctor_approval_status: doctorApprovalStatus,
    doctor_certificate: certificate,
    // Nested object keys
    product: {
      serial_code: serial,
      serial_number: serial,
      product_name: name,
      name: name,
      brand: brand,
      status: status,
      is_authentic: isAuthentic,
      is_doctor_approved: isDoctorApproved,
      doctor_approval_status: doctorApprovalStatus,
      doctor_certificate: certificate
    }
  };
}

function normalizePublicProduct(product, source) {
  const code = product.code || product.id || '';
  const name =
    product.product_name ||
    product.product_name_en ||
    product.product_name_fr ||
    product.product_name_es ||
    '';

  if (!name && !code) return null;

  return {
    serial_number: String(code),
    product_name: String(name || 'Unnamed product'),
    brand: String(product.brands || 'Brand not listed'),
    image_url: product.image_front_url || product.image_url || null,
    source,
    doctor_approved: null
  };
}

app.get('/api/products/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2 || query.length > 80) {
    return res.status(400).json({ error: 'Search text must be between 2 and 80 characters.' });
  }

  try {
    const localResult = await pool.query(
      `SELECT serial_number, product_name, brand, image_url, is_doctor_approved
       FROM products
       WHERE product_name ILIKE $1 OR brand ILIKE $1 OR serial_number ILIKE $1
       ORDER BY product_name
       LIMIT 10`,
      [`%${query}%`]
    );

    const databases = [
      {
        name: 'Open Beauty Facts',
        url: 'https://world.openbeautyfacts.org/cgi/search.pl'
      },
      {
        name: 'Open Food Facts',
        url: 'https://world.openfoodfacts.org/cgi/search.pl'
      }
    ];

    const searches = await Promise.allSettled(databases.map(async (database) => {
      const response = await axios.get(database.url, {
        params: {
          search_terms: query,
          search_simple: 1,
          action: 'process',
          json: 1,
          page_size: 20,
          fields: 'code,product_name,product_name_en,product_name_fr,product_name_es,brands,image_front_url,image_url'
        },
        headers: API_HEADERS,
        timeout: 8000
      });

      if (!response.data || !Array.isArray(response.data.products)) {
        throw new Error('The product database returned an unexpected response.');
      }

      return {
        name: database.name,
        products: response.data.products
          .map((product) => normalizePublicProduct(product, database.name))
          .filter(Boolean)
      };
    }));

    const sources = searches.map((result, index) => ({
      name: databases[index].name,
      status: result.status === 'fulfilled' ? 'available' : 'unavailable'
    }));
    const products = [
      ...localResult.rows.map((product) => ({
        serial_number: product.serial_number,
        product_name: product.product_name,
        brand: product.brand,
        image_url: product.image_url || null,
        source: 'SkinShield database',
        doctor_approved: product.is_doctor_approved === true
      })),
      ...searches.flatMap((result) => result.status === 'fulfilled' ? result.value.products : [])
    ];

    const uniqueProducts = [];
    const seen = new Set();
    for (const product of products) {
      const key = product.serial_number
        ? `code:${product.serial_number.toLowerCase()}`
        : `name:${product.product_name.toLowerCase()}|brand:${product.brand.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueProducts.push(product);
      if (uniqueProducts.length === 30) break;
    }

    return res.json({
      query,
      count: uniqueProducts.length,
      sources: [
        { name: 'SkinShield database', status: 'available' },
        ...sources
      ],
      products: uniqueProducts,
      message: uniqueProducts.length
        ? 'Search results are catalog listings only; availability and doctor approval are not guaranteed.'
        : 'No matching product was found in the searched catalogs. This does not prove the product does not exist.'
    });
  } catch (err) {
    console.error('Product search failed:', err.message);
    return res.status(500).json({ error: 'Product search failed. Please try again.' });
  }
});

// API Endpoint for Product Verification
app.get('/api/verify/:code', async (req, res) => {
  const { code } = req.params;
  console.log(`\n🔍 Verifying Barcode: ${code}`);

  try {
    // 1. Local PostgreSQL DB Check
    const dbResult = await pool.query(
      'SELECT * FROM products WHERE serial_number = $1',
      [code]
    );

    if (dbResult.rows.length > 0) {
      console.log('✅ Match found in Local Database!');
      const p = dbResult.rows[0];
      return res.json(formatResponse(
        true,
        'local_db',
        p.serial_number,
        p.product_name,
        p.brand,
        p.is_authentic,
        '',
        p.is_authentic ? 'REAL' : 'FAKE',
        p.is_doctor_approved === true,
        p.is_doctor_approved === true
          ? {
              certificate_id: p.certificate_id || p.certificate_number || null,
              doctor_name: p.doctor_name || null,
              doctor_license: p.doctor_license || p.doctor_license_number || null,
              clinic_name: p.clinic_name || null,
              approval_date: p.approval_date || null
            }
          : null,
        p.is_doctor_approved === true ? 'approved' : 'not_approved'
      ));
    }

    // External Open Facts Lookup Helper
    async function fetchExternal(url, sourceName) {
      try {
        console.log(`🌐 Checking ${sourceName}...`);
        const response = await axios.get(url, {
          headers: API_HEADERS,
          timeout: 3500
        });

        if (response.data && response.data.status === 1) {
          const ext = response.data.product;
          return {
            name:
              ext.product_name ||
              ext.product_name_en ||
              ext.product_name_fr ||
              'Verified Skincare Product',
            brand: ext.brands || 'Global Beauty Brand'
          };
        }
      } catch (e) {
        console.log(`⚠️ ${sourceName} lookup skipped/failed.`);
      }

      return null;
    }

    // 2. Open Beauty Facts API
    let extData = await fetchExternal(
      `https://world.openbeautyfacts.org/api/v2/product/${encodeURIComponent(code)}.json`,
      'Open Beauty Facts'
    );

    // 3. Open Food Facts API Fallback
    if (!extData) {
      extData = await fetchExternal(
        `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`,
        'Open Food Facts'
      );
    }

    if (extData) {
      console.log('✅ Found in Global Registry!');
      return res.json(formatResponse(
        true,
        'global_api',
        code,
        extData.name,
        extData.brand,
        false,
        'A public product listing was found; it does not establish authenticity or safety.',
        'LISTED'
      ));
    }

    // A barcode's format alone is not evidence that a product is authentic.
    console.log('❌ Product could not be verified');
    return res.json(formatResponse(
      false,
      'none',
      code,
      'Unknown Product',
      'Unknown Brand',
      false,
      'Product could not be verified. Exercise caution.',
      'UNVERIFIED'
    ));
  } catch (err) {
    console.error('Server error during verification:', err.message);
    res.status(500).json({ error: 'Server error during verification' });
  }
});

const PORT = process.env.PORT || 5000;

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request is too large.' });
  }
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Request body must contain valid JSON.' });
  }

  console.error('Unhandled server error:', err.message);
  return res.status(500).json({ error: 'Internal server error.' });
});

async function startServer() {
  await initializeDatabase();
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`SkinShield server listening on port ${PORT}`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

if (require.main === module) {
  startServer().catch(async (err) => {
    console.error('Backend startup failed:', err.message);
    await pool.end();
    process.exitCode = 1;
  });
}

module.exports = { app, startServer };