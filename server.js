import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import { randomUUID } from 'crypto';
import axios from 'axios';
import * as cheerio from 'cheerio';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

// In-memory storage
const extractions = new Map();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'website-extractor-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Helper functions
function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return null;
  }
}

function getFileExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    return ext || '';
  } catch {
    return '';
  }
}

function getFileType(url, mimeType) {
  const ext = getFileExtension(url);
  
  if (mimeType) {
    if (mimeType.includes('text/html')) return 'html';
    if (mimeType.includes('text/css')) return 'css';
    if (mimeType.includes('javascript')) return 'js';
    if (mimeType.includes('image/')) return 'image';
    if (mimeType.includes('font/')) return 'font';
  }
  
  switch (ext) {
    case 'html': case 'htm': return 'html';
    case 'css': return 'css';
    case 'js': case 'mjs': case 'jsx': case 'ts': case 'tsx': return 'js';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': case 'ico': return 'image';
    case 'woff': case 'woff2': case 'ttf': case 'eot': case 'otf': return 'font';
    case 'json': return 'json';
    case 'xml': return 'xml';
    default: return 'other';
  }
}

function getMimeType(url, type) {
  const mimeTypes = {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'xml': 'application/xml',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'eot': 'application/vnd.ms-fontobject',
    'otf': 'font/otf'
  };
  
  const ext = getFileExtension(url);
  return mimeTypes[ext] || mimeTypes[type] || 'application/octet-stream';
}

function isValidContent(content, url) {
  if (!content) return false;
  
  const type = getFileType(url);
  if (type === 'image' || type === 'font') {
    return Buffer.isBuffer(content) || (typeof content === 'string' && content.length > 0);
  }
  
  if (typeof content === 'string') {
    return content.trim().length > 0 && !content.includes('<!DOCTYPE html>') || url.includes('.html');
  }
  
  return Buffer.isBuffer(content);
}

// API Routes
app.post('/api/extract', async (req, res) => {
  try {
    const { url, includePayloads = true, includeSourcePage = true } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    const extraction = {
      id: randomUUID(),
      url,
      status: 'pending',
      files: [],
      totalSize: 0,
      totalFiles: 0,
      extractedAt: new Date().toISOString()
    };
    
    extractions.set(extraction.id, extraction);
    
    // Start extraction process asynchronously
    extractWebsiteFiles(extraction.id, url, includePayloads, includeSourcePage).catch(error => {
      console.error("Extraction failed:", error);
      const current = extractions.get(extraction.id);
      if (current) {
        current.status = 'failed';
        current.error = error instanceof Error ? error.message : 'Unknown error';
      }
    });
    
    res.json(extraction);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/extract/:id', async (req, res) => {
  try {
    const extraction = extractions.get(req.params.id);
    if (!extraction) {
      return res.status(404).json({ error: 'Extraction not found' });
    }
    res.json(extraction);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/extract/:id/download', async (req, res) => {
  try {
    const extraction = extractions.get(req.params.id);
    if (!extraction) {
      return res.status(404).json({ error: 'Extraction not found' });
    }

    if (extraction.status !== 'completed') {
      return res.status(400).json({ error: 'Extraction not completed' });
    }

    const zip = new JSZip();
    const domain = new URL(extraction.url).hostname;

    // Add files to ZIP
    for (const file of extraction.files) {
      zip.file(file.path, file.content);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${domain}-sources.zip"`);
    res.send(zipBuffer);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

async function extractWebsiteFiles(extractionId, url, includePayloads, includeSourcePage) {
  const extraction = extractions.get(extractionId);
  if (!extraction) return;
  
  extraction.status = 'processing';

  try {
    // Download the main page content
    const mainResponse = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const content = mainResponse.data;
    const assets = new Set();
    const $ = cheerio.load(content);

    // Extract CSS links
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        assets.add(resolveUrl(url, href));
      }
    });

    // Extract JS scripts
    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        assets.add(resolveUrl(url, src));
      }
    });

    // Extract images
    $('img[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        assets.add(resolveUrl(url, src));
      }
    });

    // Extract additional assets
    $('link[href]').each((_, el) => {
      const href = $(el).attr('href');
      const rel = $(el).attr('rel');
      if (href && (rel === 'icon' || rel === 'shortcut icon' || rel === 'apple-touch-icon' || rel === 'manifest' || rel === 'preload' || rel === 'prefetch' || href.includes('.woff') || href.includes('.ttf') || href.includes('.eot'))) {
        assets.add(resolveUrl(url, href));
      }
    });

    // Extract inline scripts and styles
    $('script:not([src])').each((_, el) => {
      const scriptContent = $(el).html();
      if (scriptContent && scriptContent.trim()) {
        const fileName = `inline-script-${randomUUID().substring(0, 8)}.js`;
        const file = {
          id: randomUUID(),
          name: fileName,
          path: `js/${fileName}`,
          type: "js",
          size: Buffer.byteLength(scriptContent, 'utf8'),
          content: scriptContent,
          mimeType: "application/javascript"
        };
        extraction.files.push(file);
      }
    });

    $('style').each((_, el) => {
      const styleContent = $(el).html();
      if (styleContent && styleContent.trim()) {
        const fileName = `inline-style-${randomUUID().substring(0, 8)}.css`;
        const file = {
          id: randomUUID(),
          name: fileName,
          path: `css/${fileName}`,
          type: "css",
          size: Buffer.byteLength(styleContent, 'utf8'),
          content: styleContent,
          mimeType: "text/css"
        };
        extraction.files.push(file);
      }
    });

    // Include source page if requested
    if (includeSourcePage) {
      const sourceFile = {
        id: randomUUID(),
        name: "index.html",
        path: "index.html",
        type: "html",
        size: Buffer.byteLength(content, 'utf8'),
        content: content,
        mimeType: "text/html"
      };
      extraction.files.push(sourceFile);
    }

    // Download all assets if includePayloads is true
    if (includePayloads) {
      const validAssets = Array.from(assets).filter(asset => asset && !asset.startsWith('data:'));
      
      for (const assetUrl of validAssets) {
        try {
          const assetResponse = await axios.get(assetUrl, {
            timeout: 10000,
            responseType: 'arraybuffer',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
          });

          const assetContent = assetResponse.data;
          const contentType = assetResponse.headers['content-type'] || '';
          
          if (isValidContent(assetContent, assetUrl)) {
            const assetType = getFileType(assetUrl, contentType);
            const fileName = new URL(assetUrl).pathname.split('/').pop() || `asset-${randomUUID().substring(0, 8)}`;
            const folder = assetType === 'css' ? 'css' : assetType === 'js' ? 'js' : assetType === 'image' ? 'images' : assetType === 'font' ? 'fonts' : 'assets';
            
            const file = {
              id: randomUUID(),
              name: fileName,
              path: `${folder}/${fileName}`,
              type: assetType,
              size: assetContent.length || Buffer.byteLength(assetContent, 'utf8'),
              content: assetContent,
              mimeType: getMimeType(assetUrl, assetType)
            };
            
            extraction.files.push(file);
          }
        } catch (error) {
          console.log(`Could not fetch asset: ${assetUrl}`, error.message);
        }
      }
    }

    // Update extraction with results
    extraction.status = 'completed';
    extraction.totalFiles = extraction.files.length;
    extraction.totalSize = extraction.files.reduce((total, file) => total + file.size, 0);
    
  } catch (error) {
    console.error("Extraction failed:", error);
    extraction.status = 'failed';
    extraction.error = error instanceof Error ? error.message : 'Unknown error';
  }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'dist/public')));

// Catch all handler for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist/public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});