// REEL.DECK -> Roblox Uploader
// Small backend that receives an audio file from the browser and forwards it
// to the Roblox Open Cloud Assets API. This MUST run server-side because the
// Roblox API key is a secret — it can never be embedded in browser code.

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fetch = require('node-fetch'); // v2
const FormData = require('form-data');

const app = express();

// ---- CONFIG: set these as environment variables, never hardcode secrets ----
const ROBLOX_API_KEY = process.env.ROBLOX_API_KEY; // from Creator Dashboard
const ROBLOX_CREATOR_USER_ID = process.env.ROBLOX_CREATOR_USER_ID; // your Roblox numeric user id
// Optional: if you want assets to belong to a Group instead of your own account
const ROBLOX_CREATOR_GROUP_ID = process.env.ROBLOX_CREATOR_GROUP_ID || null;

// Allow your REEL.DECK web page's origin to call this server.
// Replace '*' with your actual site URL once deployed, e.g. 'https://your-reeldeck.pages.dev'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

app.use(cors({ origin: ALLOWED_ORIGIN }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // Roblox's own limit is 20MB
});

const CONTENT_TYPE_BY_EXT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac'
};

app.post('/upload-to-roblox', upload.single('audio'), async (req, res) => {
  try{
    if(!ROBLOX_API_KEY){
      return res.status(500).json({ error: 'Server belum dikonfigurasi: ROBLOX_API_KEY tidak diset.' });
    }
    if(!ROBLOX_CREATOR_USER_ID && !ROBLOX_CREATOR_GROUP_ID){
      return res.status(500).json({ error: 'Server belum dikonfigurasi: ROBLOX_CREATOR_USER_ID atau ROBLOX_CREATOR_GROUP_ID harus diset.' });
    }
    if(!req.file){
      return res.status(400).json({ error: 'Tidak ada file audio yang dikirim.' });
    }

    const displayName = (req.body.displayName || req.file.originalname || 'REEL.DECK Audio').slice(0, 50);
    const description = (req.body.description || 'Diupload lewat REEL.DECK').slice(0, 1000);

    const ext = (req.file.originalname.split('.').pop() || '').toLowerCase();
    const contentType = CONTENT_TYPE_BY_EXT[ext];
    if(!contentType){
      return res.status(400).json({ error: `Format .${ext} tidak didukung Roblox. Pakai mp3, wav, ogg, atau flac.` });
    }

    // Roblox only allows audio up to 7 minutes and 20MB — fail fast with a clear message.
    if(req.file.size > 20 * 1024 * 1024){
      return res.status(400).json({ error: 'File lebih dari 20MB, melebihi batas Roblox.' });
    }

    const creator = ROBLOX_CREATOR_GROUP_ID
      ? { groupId: String(ROBLOX_CREATOR_GROUP_ID) }
      : { userId: String(ROBLOX_CREATOR_USER_ID) };

    const requestJson = {
      assetType: 'Audio',
      displayName,
      description,
      creationContext: { creator }
    };

    const form = new FormData();
    form.append('request', JSON.stringify(requestJson));
    form.append('fileContent', req.file.buffer, {
      filename: req.file.originalname,
      contentType
    });

    const robloxResp = await fetch('https://apis.roblox.com/assets/v1/assets', {
      method: 'POST',
      headers: {
        'x-api-key': ROBLOX_API_KEY,
        ...form.getHeaders()
      },
      body: form
    });

    const robloxData = await robloxResp.json().catch(()=> ({}));

    if(!robloxResp.ok){
      return res.status(robloxResp.status).json({
        error: 'Roblox menolak upload.',
        detail: robloxData
      });
    }

    // Roblox returns an operation path like "operations/1234567890"
    // The asset still needs to pass Roblox's normal moderation before it's usable.
    return res.json({
      ok: true,
      operation: robloxData.path || null,
      raw: robloxData
    });

  }catch(err){
    console.error('Upload error:', err);
    return res.status(500).json({ error: 'Server error saat upload.', detail: String(err && err.message || err) });
  }
});

// Optional: poll operation status so the frontend can show "sedang dimoderasi Roblox..."
app.get('/operation-status/:operationId', async (req, res) => {
  try{
    if(!ROBLOX_API_KEY){
      return res.status(500).json({ error: 'Server belum dikonfigurasi: ROBLOX_API_KEY tidak diset.' });
    }
    const opResp = await fetch(`https://apis.roblox.com/assets/v1/operations/${req.params.operationId}`, {
      headers: { 'x-api-key': ROBLOX_API_KEY }
    });
    const opData = await opResp.json().catch(()=> ({}));
    if(!opResp.ok){
      return res.status(opResp.status).json({ error: 'Gagal cek status.', detail: opData });
    }
    return res.json(opData);
  }catch(err){
    console.error('Status check error:', err);
    return res.status(500).json({ error: 'Server error saat cek status.', detail: String(err && err.message || err) });
  }
});

app.get('/', (req, res) => {
  res.send('REEL.DECK Roblox Uploader is running.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`REEL.DECK Roblox Uploader listening on port ${PORT}`);
});
