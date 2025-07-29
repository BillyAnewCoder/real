import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { extractionRequestSchema, type ExtractedFile } from "@shared/schema";
import * as cheerio from "cheerio";
import JSZip from "jszip";
import axios from "axios";
import { randomUUID } from "crypto";
import { URL } from "url";

export async function registerRoutes(app: Express): Promise<Server> {
  
  // Start extraction
  app.post("/api/extract", async (req, res) => {
    try {
      const { url, includePayloads, includeSourcePage } = extractionRequestSchema.parse(req.body);
      
      const extraction = await storage.createExtractionResult(url);
      
      // Start extraction process asynchronously
      extractWebsiteFiles(extraction.id, url, includePayloads, includeSourcePage).catch(error => {
        console.error("Extraction failed:", error);
        storage.updateExtractionResult(extraction.id, {
          status: "failed",
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      });
      
      res.json(extraction);
    } catch (error) {
      res.status(400).json({ message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Get extraction status
  app.get("/api/extract/:id", async (req, res) => {
    try {
      const extraction = await storage.getExtractionResult(req.params.id);
      if (!extraction) {
        return res.status(404).json({ message: "Extraction not found" });
      }
      res.json(extraction);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Download ZIP
  app.get("/api/extract/:id/download", async (req, res) => {
    try {
      const extraction = await storage.getExtractionResult(req.params.id);
      if (!extraction) {
        return res.status(404).json({ message: "Extraction not found" });
      }

      if (extraction.status !== "completed") {
        return res.status(400).json({ message: "Extraction not completed" });
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
      res.status(500).json({ message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Download single file
  app.get("/api/extract/:id/file/:fileId", async (req, res) => {
    try {
      const extraction = await storage.getExtractionResult(req.params.id);
      if (!extraction) {
        return res.status(404).json({ message: "Extraction not found" });
      }

      const file = extraction.files.find(f => f.id === req.params.fileId);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${file.name}"`);
      res.send(file.content);
    } catch (error) {
      res.status(500).json({ message: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function extractWebsiteFiles(extractionId: string, url: string, includePayloads: boolean, includeSourcePage: boolean) {
  await storage.updateExtractionResult(extractionId, { status: "processing" });

  try {
    // Download the main page content
    const mainResponse = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const content = mainResponse.data;
    const assets = new Set<string>();
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

    // Extract additional assets like fonts, icons, manifests, etc.
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
        const file: ExtractedFile = {
          id: randomUUID(),
          name: fileName,
          path: `js/${fileName}`,
          type: "js",
          size: Buffer.byteLength(scriptContent, 'utf8'),
          content: scriptContent,
          mimeType: "application/javascript"
        };
        storage.addFileToExtraction(extractionId, file);

        // Look for dynamic imports and require calls in inline scripts
        const dynamicImports = scriptContent.match(/(?:import\(['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]|__webpack_require__\.e\(\d+\)\.then\([^)]*__webpack_require__\.bind\([^,]+,\s*['"]([^'"]+)['"])/g);
        if (dynamicImports) {
          dynamicImports.forEach(match => {
            const importPath = match.replace(/.*['"]([^'"]+)['"].*/, '$1');
            if (importPath && !importPath.startsWith('data:')) {
              assets.add(resolveUrl(url, importPath));
            }
          });
        }
      }
    });

    $('style').each((_, el) => {
      const styleContent = $(el).html();
      if (styleContent && styleContent.trim()) {
        const fileName = `inline-style-${randomUUID().substring(0, 8)}.css`;
        const file: ExtractedFile = {
          id: randomUUID(),
          name: fileName,
          path: `css/${fileName}`,
          type: "css",
          size: Buffer.byteLength(styleContent, 'utf8'),
          content: styleContent,
          mimeType: "text/css"
        };
        storage.addFileToExtraction(extractionId, file);
      }
    });

    // Extract additional media and resources
    $('source[src], video[src], audio[src], embed[src], object[data], iframe[src]').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data');
      if (src) {
        assets.add(resolveUrl(url, src));
      }
    });

    // Extract CSS background images and other URL references
    $('*').each((_, el) => {
      const style = $(el).attr('style');
      if (style) {
        const urlMatches = style.match(/url\(['"]?([^'")]+)['"]?\)/g);
        if (urlMatches) {
          urlMatches.forEach(match => {
            const urlPath = match.replace(/url\(['"]?([^'")]+)['"]?\)/, '$1');
            assets.add(resolveUrl(url, urlPath));
          });
        }
      }
    });

    // Add source page if requested
    if (includeSourcePage) {
      const sourceFile: ExtractedFile = {
        id: randomUUID(),
        name: "index.html",
        path: "index.html",
        type: "html",
        size: Buffer.byteLength(content, 'utf8'),
        content,
        mimeType: "text/html"
      };
      await storage.addFileToExtraction(extractionId, sourceFile);
    }

    // Process assets in batches to improve performance
    const assetArray = Array.from(assets);
    const batchSize = 10;
    
    for (let i = 0; i < assetArray.length; i += batchSize) {
      const batch = assetArray.slice(i, i + batchSize);
      
      await Promise.allSettled(batch.map(async (assetUrl) => {
        try {
          // Validate URL before processing
          if (!assetUrl || assetUrl.length > 2000) {
            return;
          }
          
          // Handle different response types based on file extension
          const urlObj = new URL(assetUrl);
          let fileName = urlObj.pathname.split('/').pop() || 'file';
          
          // Remove query parameters from filename but keep them for the request
          const cleanFileName = fileName.split('?')[0];
          if (!cleanFileName || cleanFileName === '') {
            fileName = `asset-${randomUUID().substring(0, 8)}`;
          } else {
            fileName = cleanFileName;
          }
          
          // Skip data URLs and very long URLs
          if (assetUrl.startsWith('data:') || assetUrl.length > 1000) {
            return;
          }
          
          const fileType = getFileType(fileName);
          const fileExt = fileName.split('.').pop()?.toLowerCase() || '';
          const isBinary = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'woff', 'woff2', 'ttf', 'eot', 'otf', 'mp4', 'webm', 'ogg', 'mp3', 'wav', 'pdf'].includes(fileExt);
          
          const response = await axios.get(assetUrl, { 
            responseType: isBinary ? 'arraybuffer' : 'text',
            timeout: 15000,
            maxContentLength: 10 * 1024 * 1024, // 10MB limit
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': isBinary ? 'application/octet-stream' : 'text/css,application/javascript,text/html,*/*'
            }
          });
          
          const folderPath = getFolderPath(fileType);
          let content: string;
          let size: number;
          
          if (isBinary) {
            // For binary files, store as base64
            content = `data:${response.headers['content-type'] || getMimeType(fileName)};base64,${Buffer.from(response.data).toString('base64')}`;
            size = response.data.byteLength;
          } else {
            // For text files, ensure proper encoding
            content = typeof response.data === 'string' ? response.data : Buffer.from(response.data).toString('utf8');
            size = Buffer.byteLength(content, 'utf8');
          }
        
          const file: ExtractedFile = {
            id: randomUUID(),
            name: fileName,
            path: `${folderPath}/${fileName}`,
            type: fileType,
            size: size,
            content: content,
            mimeType: response.headers['content-type'] || getMimeType(fileName)
          };
        
          await storage.addFileToExtraction(extractionId, file);

          // If this is a CSS file, extract additional assets referenced within it
          if (fileType === 'css' && !isBinary && typeof content === 'string' && !content.startsWith('data:')) {
            try {
              const cssContent = content;
              // Extract @import statements
              const importMatches = cssContent.match(/@import\s+url\(['"]?([^'")]+)['"]?\)|@import\s+['"]([^'"]+)['"]/g);
              if (importMatches) {
                importMatches.forEach((match: string) => {
                  const importPath = match.replace(/@import\s+(?:url\(['"]?([^'")]+)['"]?\)|['"]([^'"]+)['"])/, '$1$2');
                  if (importPath && !importPath.startsWith('data:')) {
                    assets.add(resolveUrl(assetUrl, importPath));
                  }
                });
              }

              // Extract URLs from CSS (background images, fonts, etc.)
              const urlMatches = cssContent.match(/url\(['"]?([^'")]+)['"]?\)/g);
              if (urlMatches) {
                urlMatches.forEach((match: string) => {
                  const urlPath = match.replace(/url\(['"]?([^'")]+)['"]?\)/, '$1');
                  if (urlPath && !urlPath.startsWith('data:')) {
                    assets.add(resolveUrl(assetUrl, urlPath));
                  }
                });
              }
            } catch (cssError) {
              console.log(`Could not parse CSS content from ${assetUrl}`);
            }
          }
        } catch (error) {
          console.error(`Failed to download asset ${assetUrl}:`, error instanceof Error ? error.message : error);
        }
      }));
    }

    // Add payload files if requested (simulate common API responses)
    if (includePayloads) {
      // Try to find and extract potential API endpoints from the HTML
      const potentialApiUrls = new Set<string>();
      
      // Look for fetch calls, XMLHttpRequest, or API URLs in script tags
      $('script').each((_, el) => {
        const scriptContent = $(el).html() || '';
        const apiMatches = scriptContent.match(/["'](\/api\/[^"']*|https?:\/\/[^"']*\/api\/[^"']*|\/graphql|\/v\d+\/[^"']*)['"]/g);
        if (apiMatches) {
          apiMatches.forEach(match => {
            const cleanUrl = match.replace(/['"]/g, '');
            potentialApiUrls.add(resolveUrl(url, cleanUrl));
          });
        }
      });

      // Try to fetch a few common API endpoints
      const commonEndpoints = ['/api/status', '/api/health', '/api/version', '/graphql'];
      commonEndpoints.forEach(endpoint => {
        potentialApiUrls.add(resolveUrl(url, endpoint));
      });

      let payloadCount = 0;
      for (const apiUrl of Array.from(potentialApiUrls).slice(0, 5)) { // Limit to 5 requests
        try {
          const apiResponse = await axios.get(apiUrl, {
            timeout: 5000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Accept': 'application/json'
            }
          });
          
          if (apiResponse.data && apiResponse.headers['content-type']?.includes('json')) {
            payloadCount++;
            const fileName = `api-response-${payloadCount}.json`;
            
            const file: ExtractedFile = {
              id: randomUUID(),
              name: fileName,
              path: `payloads/${fileName}`,
              type: "payload",
              size: Buffer.byteLength(JSON.stringify(apiResponse.data), 'utf8'),
              content: JSON.stringify({
                url: apiUrl,
                status: apiResponse.status,
                headers: apiResponse.headers,
                data: apiResponse.data
              }, null, 2),
              mimeType: "application/json"
            };
            
            await storage.addFileToExtraction(extractionId, file);
          }
        } catch (apiError) {
          // Ignore API request failures
          console.log(`Could not fetch API endpoint ${apiUrl}`);
        }
      }
    }

    await storage.updateExtractionResult(extractionId, { status: "completed" });
  } catch (error) {
    throw error;
  }
}

function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function getFileType(fileName: string): ExtractedFile["type"] {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'css': return 'css';
    case 'js': case 'mjs': case 'ts': case 'jsx': case 'tsx': return 'js';
    case 'html': case 'htm': return 'html';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': case 'webp': case 'ico': case 'bmp': case 'tiff': return 'image';
    case 'json': case 'xml': return 'payload';
    case 'woff': case 'woff2': case 'ttf': case 'eot': case 'otf': return 'other';
    case 'mp4': case 'webm': case 'ogg': case 'avi': case 'mov': return 'other';
    case 'mp3': case 'wav': case 'flac': case 'aac': return 'other';
    case 'pdf': case 'doc': case 'docx': case 'txt': return 'other';
    default: return 'other';
  }
}

function getFolderPath(type: ExtractedFile["type"]): string {
  switch (type) {
    case 'css': return 'css';
    case 'js': return 'js';
    case 'image': return 'images';
    case 'payload': return 'payloads';
    default: return 'assets';
  }
}

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'css': return 'text/css';
    case 'js': return 'application/javascript';
    case 'html': case 'htm': return 'text/html';
    case 'json': return 'application/json';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    default: return 'text/plain';
  }
}
