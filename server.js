require('dotenv').config();

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const { Transform } = require('stream');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const APIFY_ACTOR_URL =
  'https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items';

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  '/api/fetch',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please wait 15 minutes before trying again.' }
  })
);

app.get('/api/status', (req, res) => {
  res.json({ configured: Boolean(process.env.APIFY_TOKEN) });
});

function isInstagramUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && INSTAGRAM_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function normalizeInstagramUrl(value) {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/^\/reels\//, '/reel/');
  return url.toString();
}

function isMediaUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'cdninstagram.com' ||
        url.hostname.endsWith('.cdninstagram.com') ||
        url.hostname === 'fbcdn.net' ||
        url.hostname.endsWith('.fbcdn.net'))
    );
  } catch {
    return false;
  }
}

async function fetchWithAllowedRedirects(initialUrl, isAllowed) {
  let url = initialUrl;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (!isAllowed(url)) {
      throw new Error('The requested URL is not allowed.');
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
      },
      redirect: 'manual',
      timeout: 15000
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get('location');
    response.body.destroy();
    if (!location || redirects === 3) {
      throw new Error('The requested URL redirected too many times.');
    }
    url = new URL(location, url).toString();
  }
}

app.post('/api/fetch', async (req, res) => {
  const { url } = req.body || {};
  if (typeof url !== 'string' || !isInstagramUrl(url)) {
    return res.status(400).json({ error: 'Please paste a valid Instagram link.' });
  }

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: 'The downloader service is not configured. Set the APIFY_TOKEN environment variable.'
    });
  }

  try {
    const normalizedUrl = normalizeInstagramUrl(url);
    const apiUrl = new URL(APIFY_ACTOR_URL);
    apiUrl.searchParams.set('token', token);
    apiUrl.searchParams.set('timeout', '120');
    apiUrl.searchParams.set('maxItems', '1');
    apiUrl.searchParams.set('maxTotalChargeUsd', '0.5');

    const response = await fetch(apiUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [normalizedUrl],
        resultsType: new URL(normalizedUrl).pathname.startsWith('/reel/') ? 'reels' : 'posts',
        resultsLimit: 1
      }),
      timeout: 130000
    });

    if (!response.ok) {
      console.error(`Apify Instagram scraper returned HTTP ${response.status}.`);
      if (response.status === 401 || response.status === 403) {
        return res.status(502).json({
          error: 'The downloader service rejected its API token. Check APIFY_TOKEN in the server environment.'
        });
      }
      if (response.status === 402) {
        return res.status(402).json({
          error: 'The downloader service has reached its available usage limit. Check your Apify usage and free credits.'
        });
      }
      if (response.status === 408 || response.status === 429) {
        return res.status(503).json({
          error: 'The downloader service timed out or is busy. Please try again shortly.'
        });
      }
      return res.status(502).json({
        error: 'The downloader service could not retrieve this post. It may be unavailable or restricted.'
      });
    }

    const items = await response.json();
    const item = Array.isArray(items) ? items[0] : null;
    if (!item || typeof item !== 'object') {
      return res.status(404).json({
        error: 'The downloader service found no media for this post. It may be unavailable or restricted.'
      });
    }

    const videoUrl =
      typeof item.videoUrl === 'string' ? item.videoUrl : null;
    const imageUrl =
      (typeof item.displayUrl === 'string' && item.displayUrl) ||
      (Array.isArray(item.images) && typeof item.images[0] === 'string' && item.images[0]) ||
      null;

    if (videoUrl && isMediaUrl(videoUrl)) {
      return res.json({ type: 'video', url: videoUrl });
    }
    if (imageUrl && isMediaUrl(imageUrl)) {
      return res.json({ type: 'image', url: imageUrl });
    }

    return res.status(404).json({
      error: 'The downloader service found the post but did not return a downloadable image or video.'
    });
  } catch (err) {
    console.error('Failed to retrieve Instagram media from Apify:', err.message);
    return res.status(500).json({ error: 'Something went wrong fetching that link.' });
  }
});

app.get('/api/download', async (req, res) => {
  const { url, type } = req.query;
  if (typeof url !== 'string' || !isMediaUrl(url)) {
    return res.status(400).send('Invalid media URL');
  }
  if (type !== 'video' && type !== 'image') {
    return res.status(400).send('Invalid media type');
  }

  try {
    const response = await fetchWithAllowedRedirects(url, isMediaUrl);
    if (!response.ok) {
      response.body.destroy();
      return res.status(502).send('Media download failed');
    }

    const contentType = response.headers.get('content-type') || '';
    if (
      (type === 'video' && !contentType.startsWith('video/')) ||
      (type === 'image' && !contentType.startsWith('image/'))
    ) {
      response.body.destroy();
      return res.status(415).send('Unexpected media type');
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > MAX_DOWNLOAD_BYTES) {
      response.body.destroy();
      return res.status(413).send('Media file is too large');
    }

    const extension = type === 'video' ? 'mp4' : 'jpg';
    res.setHeader('Content-Disposition', `attachment; filename="instagram.${extension}"`);
    res.setHeader('Content-Type', contentType);

    let bytesSent = 0;
    const sizeLimit = new Transform({
      transform(chunk, encoding, callback) {
        bytesSent += chunk.length;
        if (bytesSent > MAX_DOWNLOAD_BYTES) {
          callback(new Error('Media file is too large'));
          return;
        }
        callback(null, chunk);
      }
    });

    response.body.on('error', (err) => {
      console.error('Media response stream failed:', err.message);
      if (!res.headersSent) {
        res.status(502).end('Media download failed');
      } else {
        res.destroy();
      }
    });
    sizeLimit.on('error', (err) => {
      console.error('Media download stopped:', err.message);
      response.body.destroy();
      if (!res.headersSent) {
        res.status(413).end('Media file is too large');
      } else {
        res.destroy();
      }
    });

    response.body.pipe(sizeLimit).pipe(res);
  } catch (err) {
    console.error('Failed to download Instagram media:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Download failed');
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
