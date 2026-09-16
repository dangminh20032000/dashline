/**
 * Normalize Nuxt Bundle References v2
 *
 * This script removes ONLY the -2, -3, -4 etc. suffixes (NOT -1) from all references
 * in HTML files. The -1 in filenames like C8Qvyr-1.js is part of the original name.
 *
 * Run with: node scripts/normalize-nuxt-bundles.mjs
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT_DIR = resolve(process.cwd(), '..');

// HTML files to process
const HTML_FILES = [
	'index.html',
	'services.html',
	'contact.html',
	'latest.html',
	'work.html',
	'policy.html',
];

function normalizeHtmlFile(filePath) {
	if (!existsSync(filePath)) {
		console.log(`[SKIP] ${filePath} does not exist`);
		return;
	}

	let content = readFileSync(filePath, 'utf-8');
	const originalContent = content;

	// Only remove -2, -3, -4 etc. suffixes (NOT -1)
	// Pattern: match filename-N.ext where N >= 2
	// E.g., C8Qvyr-1.js -> C8Qvyr-1.js
	//       entry.p5EzyP6A-2.css -> entry.p5EzyP6A.css
	//       SuisseIntl-Medium-WebXL.BXqjNbCJ-2.woff2 -> SuisseIntl-Medium-WebXL.BXqjNbCJ.woff2
	// But NOT: C8Qvyr-1.js (keep as is)

	content = content.replace(
		/(-[2-9]|-[1-9]\d+)\.(js|css|woff2?|json)(["'?])/g,
		'.$2$3'
	);

	if (content !== originalContent) {
		writeFileSync(filePath, content);
		console.log(`[UPDATED] ${filePath}`);
	} else {
		console.log(`[OK] ${filePath} - no changes needed`);
	}
}

function ensureBaseFilesExist() {
	const nuxtDir = join(ROOT_DIR, '_nuxt');
	if (!existsSync(nuxtDir)) {
		console.log('[ERROR] _nuxt directory not found');
		return;
	}

	const files = readdirSync(nuxtDir);

	// Find files with -2, -3, etc. suffixes (but NOT -1)
	const suffixedFiles = files.filter(f => /-[2-9]\.(js|css|woff2?|json)$/.test(f) || /-[1-9]\d+\.(js|css|woff2?|json)$/.test(f));

	console.log(`\n[INFO] Found ${suffixedFiles.length} files with -2/-3/etc. suffixes`);

	for (const file of suffixedFiles) {
		// Extract base name: filename-2.js -> filename.js
		const baseName = file.replace(/-[2-9](\.(js|css|woff2?|json))$/, '$1')
			.replace(/-[1-9]\d+(\.(js|css|woff2?|json))$/, '$1');
		const srcPath = join(nuxtDir, file);
		const destPath = join(nuxtDir, baseName);

		// If base file doesn't exist, create it from the suffixed version
		if (!existsSync(destPath)) {
			copyFileSync(srcPath, destPath);
			console.log(`[CREATED] ${baseName} from ${file}`);
		} else {
			console.log(`[EXISTS] ${baseName}`);
		}
	}
}

console.log('=== Normalizing Nuxt Bundle References (v2) ===\n');
console.log('This version only strips -2, -3, etc. suffixes, NOT -1.\n');

// Step 1: Normalize HTML files
console.log('--- Processing HTML files ---');
for (const htmlFile of HTML_FILES) {
	const filePath = join(ROOT_DIR, htmlFile);
	normalizeHtmlFile(filePath);
}

// Step 2: Ensure base _nuxt files exist
console.log('\n--- Verifying _nuxt folder ---');
ensureBaseFilesExist();

console.log('\n=== Done! ===');
console.log('Restart the server and test again.');
