#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const siteConfig = process.env.SITE_CONFIG || 'security-vendor';
const rootDir = path.resolve(__dirname, '..');
const buildDir = path.join(rootDir, 'out');
const backupDir = path.join(rootDir, '.out-backup');
const tempDir = path.join(rootDir, '.out-temp');

// This script runs in two modes based on the argument:
// "backup"  — called before build, saves existing out/ so Next.js can wipe it
// "restore" — called after build, moves new build into out/<site-name>/ and restores previous sites

const mode = process.argv[2];

if (mode === 'backup') {
  // Save existing out/ before Next.js wipes it
  if (fs.existsSync(buildDir)) {
    fs.renameSync(buildDir, backupDir);
    console.log('Backed up existing out/ folder');
  }
} else if (mode === 'restore') {
  if (!fs.existsSync(buildDir)) {
    console.error('No build output found at out/');
    process.exit(1);
  }

  // Move fresh build to temp
  fs.renameSync(buildDir, tempDir);

  // Restore previous out/ (with other sites' builds)
  if (fs.existsSync(backupDir)) {
    fs.renameSync(backupDir, buildDir);
  } else {
    fs.mkdirSync(buildDir);
  }

  // Remove old version of this site if it exists
  const finalDir = path.join(buildDir, siteConfig);
  if (fs.existsSync(finalDir)) {
    fs.rmSync(finalDir, { recursive: true });
  }

  // Move new build into out/<site-name>/
  fs.renameSync(tempDir, finalDir);

  console.log(`Build output saved to: out/${siteConfig}/`);
} else {
  console.error('Usage: node move-build-output.js <backup|restore>');
  process.exit(1);
}
