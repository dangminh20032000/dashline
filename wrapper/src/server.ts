import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Project root paths
 * Using import.meta.dirname ensures consistent paths during dev and production.
 * In dev: serverDir is like /dist/angular-wrapper/server
 * In prod: similar structure
 */
const serverDir = import.meta.dirname;
// Determine if we are running from source (dev) or dist (prod)
// Dev: .../angular-wrapper/src
// Prod: .../angular-wrapper/dist/angular-wrapper/server
let projectRoot = resolve(serverDir, '../../..');
if (serverDir.endsWith('src') || serverDir.endsWith('src/') || serverDir.endsWith('src\\')) {
  projectRoot = resolve(serverDir, '..');
}
const parentRoot = resolve(projectRoot, '..'); // Goes to climax (where static files are)

/**
 * Dynamically detect section folders from the filesystem
 * These are folders like: about-us, article, blog, case-studies, home, etc.
 * Each section folder contains: css/, fonts/, images/, js/, media/, index.html
 */
const sectionFolders = readdirSync(parentRoot, { withFileTypes: true })
  .filter(
    (dirent) =>
      dirent.isDirectory() &&
      !dirent.name.startsWith('.') &&
      !dirent.name.startsWith('_') &&
      dirent.name !== 'wrapper' &&
      dirent.name !== 'node_modules' &&
      dirent.name !== 'public'
  )
  .map((dirent) => dirent.name);

console.log('[Server] Detected section folders:', sectionFolders.slice(0, 10), '...');

/**
 * STATIC PAGE ROUTES - Serve HTML files directly with Nuxt scripts intact
 * This allows Nuxt interactivity to work
 */
/**
 * DYNAMIC STATIC PAGE HANDLER
 * Supports this project structure:
 * - Root path: / -> index.html (root) or home/index.html
 * - Section pages: /about-us -> about-us/index.html
 * - Nested pages: /work/slug -> work/slug/index.html
 * - Direct HTML: /latest -> latest.html
 */
app.use((req, res, next) => {
  // Only handle GET/HEAD requests
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  // Skip known static assets / API calls (handled by other middleware or Angular)
  if (req.path.startsWith('/api') || req.path.includes('.')) {
    // If it has an extension, it might be an asset.
    // However, we want to allow extension-less URLs to map to .html files.
    // If it has an extension that is NOT .html, we skip.
    if (!req.path.endsWith('.html') && req.path.split('/').pop()?.includes('.')) {
      return next();
    }
  }

  // Mock 3rd party scripts to silence console errors
  if (req.path.includes('/gtag/js')) {
    res.status(200).send(''); // Return empty JS
    return;
  }

  // Mock analytics collection endpoints
  if (req.path.includes('/collect')) {
    res.status(204).send(); // No content
    return;
  }

  // Handle missing _nuxt assets - prevent fallthrough to Angular (HTML)
  if (req.path.includes('/_nuxt/')) {
    res.status(404).send('Not Found');
    return;
  }

  // Get the path segment (e.g., '/about-us' -> 'about-us', '/' -> '')
  const pathSegment = req.path.replace(/^\//, '');

  // Helper function to serve and strip HTML
  const serveStrippedHtml = (filePath: string) => {
    try {
      let content = readFileSync(filePath, 'utf-8');

      // Strip Analytics and Tracking Scripts

      // 1. Google Analytics / GTM (src="gtag/js..." or inline containing gtag/googletagmanager)
      content = content.replace(/<script[^>]*src="[^"]*gtag\/js[^"]*"[^>]*><\/script>/gi, '');
      content = content.replace(
        /<script[^>]*>(?:(?!<\/script>)[\s\S])*?(?:googletagmanager|gtag|dataLayer)(?:(?!<\/script>)[\s\S])*?<\/script>/gi,
        ''
      );

      // 2. HubSpot (id="hs-script-loader")
      content = content.replace(/<script[^>]*id="hs-script-loader"[^>]*><\/script>/gi, '');

      // 3. Clarity (inline)
      content = content.replace(
        /<script[^>]*>(?:(?!<\/script>)[\s\S])*?clarity(?:(?!<\/script>)[\s\S])*?<\/script>/gi,
        ''
      );

      // 4. LinkedIn (inline containing linkedin or insight.min.js)
      content = content.replace(
        /<script[^>]*>(?:(?!<\/script>)[\s\S])*?(?:linkedin|insight\.min\.js)(?:(?!<\/script>)[\s\S])*?<\/script>/gi,
        ''
      );

      // 5. Feeder (inline)
      content = content.replace(
        /<script[^>]*>(?:(?!<\/script>)[\s\S])*?lfeeder(?:(?!<\/script>)[\s\S])*?<\/script>/gi,
        ''
      );

      // 6. CookieYes (id="cookieyes")
      content = content.replace(/<script[^>]*id="cookieyes"[^>]*><\/script>/gi, '');

      // 7. Fix Nuxt BASE_URL to match the current request origin
      // This prevents Nuxt router from showing 404 due to URL mismatch
      const requestOrigin = `${req.protocol}://${req.get('host')}`;
      content = content.replace(/BASE_URL:"[^"]*"/g, `BASE_URL:"${requestOrigin}"`);

      console.log(`[Server] Serving stripped static HTML: ${filePath}`);
      res.type('text/html').send(content);
    } catch (err) {
      console.error(`[Server] Error serving file ${filePath}:`, err);
      next();
    }
  };

  // Build list of potential HTML files to check
  // Priority order for route resolution:
  // 1. Root index.html for '/' or '/home'
  // 2. Section folder index.html (e.g., /about-us -> about-us/index.html)
  // 3. Direct .html file (e.g., /latest -> latest.html)
  // 4. Nested folder index.html (e.g., /work/slug -> work/slug/index.html)

  const potentialPaths: string[] = [];

  if (!pathSegment || pathSegment === 'home') {
    // Root path: check root index.html first, then home/index.html
    potentialPaths.push(resolve(parentRoot, 'index.html'));
    potentialPaths.push(resolve(parentRoot, 'home', 'index.html'));
  } else {
    // For other paths: check folder/index.html first (section structure)
    potentialPaths.push(resolve(parentRoot, pathSegment, 'index.html'));
    // Then check direct .html file
    potentialPaths.push(resolve(parentRoot, `${pathSegment}.html`));
  }

  // Try each potential path
  for (const filePath of potentialPaths) {
    if (existsSync(filePath) && statSync(filePath).isFile()) {
      serveStrippedHtml(filePath);
      return;
    }
  }

  // Not found, continue to next middleware (Angular)
  console.log(`[Server] No static HTML found for ${req.path}, passing to Angular`);
  next();
});

/**
 * Fallback static asset handling for section folders and root-level assets.
 * This repository has assets stored within each section folder (about-us/, home/, etc.)
 * Each section folder contains: css/, fonts/, images/, js/, media/
 * Priority: section folder > parent root
 */
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();

  try {
    const decodedPath = decodeURIComponent(req.path);
    const relativePath = decodedPath.replace(/^\//, '');

    // Security checks
    if (basename(relativePath).startsWith('.')) return next();
    if (relativePath.includes('node_modules')) return next();

    // Build list of potential file locations to check
    const potentialPaths: string[] = [];

    // 1. Check parent root directly first (for _nuxt/, _payload.json, etc.)
    const rootPath = resolve(parentRoot, relativePath);
    if (!rootPath.startsWith(projectRoot)) {
      potentialPaths.push(rootPath);
    }

    // 2. Check within each section folder (assets like css/, js/, images/ are here)
    for (const section of sectionFolders) {
      const sectionPath = resolve(parentRoot, section, relativePath);
      if (!sectionPath.startsWith(projectRoot)) {
        potentialPaths.push(sectionPath);
      }
    }

    // Find first existing file
    for (const filePath of potentialPaths) {
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        res.sendFile(filePath, (err) => {
          if (err && !res.headersSent) {
            next();
          }
        });
        return;
      }
    }

    next();
  } catch (err) {
    next();
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  })
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build).
 */
export const reqHandler = createNodeRequestHandler(app);
