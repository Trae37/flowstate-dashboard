# FlowState Dashboard - License Protection Guide

## 🔒 Protecting Your Commercial Application

This guide explains how to protect FlowState Dashboard if you want to sell it commercially.

---

## 1️⃣ Repository Protection

### Option A: Private Repository (Recommended)
```bash
# Make your GitHub repository private:
# GitHub.com → Your Repo → Settings → General → Danger Zone → Change visibility → Make Private
```

**Cost:** FREE on GitHub
**Protection Level:** ⭐⭐⭐⭐⭐ (Source code completely hidden)

### Option B: Hybrid Open Core Model
- **Public Repo:** Basic/free version with limited features
- **Private Repo:** Premium version with advanced features
- Sell licenses for premium version

---

## 2️⃣ License Key System (Implemented)

I've created a complete license management system at:
- `src/main/licensing/license-manager.ts`

### Features:
✅ Online license validation (via your license server)
✅ Offline validation with 7-day grace period
✅ Trial period (14 days)
✅ Machine-specific activation
✅ License expiration support
✅ Multiple license types (trial/personal/professional/enterprise)

### Database Schema Needed:

Add this to your `src/main/database.ts`:

```sql
-- Licenses table
CREATE TABLE IF NOT EXISTS licenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  license_key TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  activated_at TEXT NOT NULL,
  expires_at TEXT,
  last_validated TEXT,
  license_type TEXT DEFAULT 'personal',
  is_valid INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Trial info table
CREATE TABLE IF NOT EXISTS trial_info (
  id INTEGER PRIMARY KEY,
  started_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### How It Works:

1. **First Launch:** 14-day trial starts automatically
2. **Purchase:** User buys license from your website
3. **Activation:** User enters license key + email
4. **Validation:** App validates with your server
5. **Storage:** License stored locally (encrypted)
6. **Periodic Checks:** Validates every 24 hours online
7. **Offline Mode:** 7-day grace period if no internet

---

## 3️⃣ License Server Setup

You need a backend server to validate licenses. Options:

### Option A: Build Your Own (Node.js Example)

```javascript
// server.js - Simple Express license server
const express = require('express');
const crypto = require('crypto');
const app = express();

const SECRET_KEY = 'your-secret-key-change-this';
const licenses = new Map(); // Use database in production

app.post('/api/validate', async (req, res) => {
  const { licenseKey, email, machineId } = req.body;

  // Check if license exists in your database
  const license = await findLicense(licenseKey);

  if (!license) {
    return res.json({ valid: false, error: 'Invalid license key' });
  }

  if (license.email !== email) {
    return res.json({ valid: false, error: 'Email mismatch' });
  }

  // Check activation limit (e.g., 2 machines max)
  if (license.activations && license.activations.length >= 2) {
    if (!license.activations.includes(machineId)) {
      return res.json({ valid: false, error: 'Maximum activations reached' });
    }
  }

  // Add this machine to activations
  if (!license.activations) license.activations = [];
  if (!license.activations.includes(machineId)) {
    license.activations.push(machineId);
    await updateLicense(license);
  }

  res.json({
    valid: true,
    info: {
      type: license.type,
      activatedAt: license.activatedAt,
      expiresAt: license.expiresAt,
    }
  });
});

app.listen(3000);
```

### Option B: Use SaaS License Services (Easier)

**Recommended Services:**

1. **Gumroad** (https://gumroad.com)
   - ✅ Built-in license key generation
   - ✅ Payment processing included
   - ✅ License API for validation
   - ✅ 10% fee on sales
   - ⭐ Best for: Individual developers

2. **Paddle** (https://paddle.com)
   - ✅ Merchant of record (handles taxes)
   - ✅ License management API
   - ✅ Subscription support
   - ✅ 5% + $0.50 per transaction
   - ⭐ Best for: Growing businesses

3. **Keygen** (https://keygen.sh)
   - ✅ Dedicated license management
   - ✅ Machine fingerprinting
   - ✅ Air-gapped licensing
   - ✅ $29-$299/month
   - ⭐ Best for: Advanced licensing needs

4. **LemonSqueezy** (https://lemonsqueezy.com)
   - ✅ Merchant of record
   - ✅ License keys included
   - ✅ 5% + transaction fees
   - ⭐ Best for: Digital products

---

## 4️⃣ Code Obfuscation (Optional Additional Layer)

### JavaScript Obfuscation

```bash
npm install --save-dev javascript-obfuscator
```

Add to your build process:

```javascript
// obfuscate-build.js
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

function obfuscateFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const obfuscated = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    deadCodeInjection: true,
    stringArray: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    splitStrings: true,
  });

  fs.writeFileSync(filePath, obfuscated.getObfuscatedCode());
}

// Obfuscate main process files
obfuscateFile('./dist/main/licensing/license-manager.js');
```

**⚠️ Warning:** Obfuscation only slows down reverse engineering, doesn't prevent it.

---

## 5️⃣ Distribution Strategy

### Don't Distribute Installers Publicly

**❌ Don't:**
- Upload installers to GitHub releases
- Put download links on public website

**✅ Do:**
- Generate unique download links per purchase
- Email download links after payment
- Use authenticated download URLs that expire

### Example: Gumroad Integration

```javascript
// After successful license activation
async function downloadApp(licenseKey) {
  const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
    method: 'POST',
    body: JSON.stringify({
      product_id: 'your_product_id',
      license_key: licenseKey,
    })
  });

  const data = await response.json();

  if (data.success) {
    // Provide authenticated download URL
    return data.purchase.download_url;
  }
}
```

---

## 6️⃣ Legal Protection

### Add to your repository:

1. **Proprietary License** (instead of MIT/GPL)

```markdown
# LICENSE

Copyright (c) 2025 [Your Name/Company]

All rights reserved.

This software and associated documentation files (the "Software")
are proprietary and confidential.

Unauthorized copying, distribution, modification, or use of this
Software, via any medium, is strictly prohibited without express
written permission from the copyright holder.

For licensing inquiries: [your-email@example.com]
```

2. **Terms of Service**
3. **End User License Agreement (EULA)**

---

## 7️⃣ Update Distribution

### Don't Use electron-updater Auto-Update Publicly

Modify `src/main/main.ts`:

```typescript
// Remove or modify auto-update
if (app.isPackaged) {
  // Only check for updates if licensed
  const licenseStatus = await getLicenseStatus();

  if (licenseStatus.licensed) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: 'https://your-server.com/updates', // Authenticated endpoint
      channel: 'latest'
    });

    autoUpdater.checkForUpdates();
  }
}
```

---

## 8️⃣ Recommended Setup (Complete Solution)

### For Solo Developer / Small Team:

1. **Repository:** Make private on GitHub
2. **Licensing:** Use Gumroad or LemonSqueezy
   - Handles payments, taxes, license generation
   - Provides API for validation
3. **Distribution:** Email unique download links after purchase
4. **Updates:** Require active license for updates

### Cost Breakdown:
- GitHub private repo: **FREE**
- Gumroad/LemonSqueezy: **10% of sales** (no upfront cost)
- Total upfront: **$0**

### For Growing Business:

1. **Repository:** Private GitHub or GitLab
2. **Licensing:** Paddle or Keygen
3. **Distribution:** Custom license portal
4. **Backend:** Your own license validation server
5. **Updates:** Authenticated update server

### Cost Breakdown:
- Paddle: **5% + $0.50** per transaction
- Keygen: **$29-299/month**
- Server: **$5-20/month** (DigitalOcean/AWS)

---

## 9️⃣ Implementation Checklist

- [ ] Make repository private
- [ ] Choose licensing service (Gumroad/Paddle/Keygen)
- [ ] Add license tables to database (see SQL above)
- [ ] Integrate license validation in app startup
- [ ] Create activation UI screen
- [ ] Test trial period expiration
- [ ] Test license activation flow
- [ ] Set up payment processing
- [ ] Create license generation endpoint
- [ ] Add license validation to auto-updater
- [ ] Write EULA and Terms of Service
- [ ] Test full purchase → activation → usage flow

---

## 🔟 Quick Start: Gumroad Integration (Easiest)

1. **Create Product on Gumroad:**
   - Go to https://gumroad.com
   - Create new product "FlowState Dashboard"
   - Enable license keys
   - Set price

2. **Get API Keys:**
   - Settings → Advanced → Application access

3. **Update license-manager.ts:**

```typescript
const LICENSE_SERVER_URL = 'https://api.gumroad.com/v2/licenses';

async function validateLicenseOnline(licenseKey: string, email: string) {
  const response = await fetch(`${LICENSE_SERVER_URL}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_id: 'YOUR_GUMROAD_PRODUCT_ID',
      license_key: licenseKey,
    }),
  });

  const data = await response.json();

  if (data.success && data.purchase.email === email) {
    return { valid: true, info: { ... } };
  }

  return { valid: false, error: 'Invalid license' };
}
```

4. **Done!** Gumroad handles:
   - Payment processing
   - License key generation
   - Email delivery
   - Tax calculations

---

## ⚠️ Important Notes

1. **Don't commit secrets to git**
   - Add `.env` to `.gitignore`
   - Use environment variables for API keys

2. **Client-side code is never 100% secure**
   - Always validate on server
   - Obfuscation only slows crackers, doesn't stop them
   - Focus on honest customers, not pirates

3. **Balance security vs. user experience**
   - Too much DRM frustrates legitimate customers
   - Simple license key + online validation is usually enough

4. **Have a refund policy**
   - Makes customers trust you more
   - Reduces piracy (people pirate when they can't try/refund)

---

## 📞 Need Help?

Common questions:

**Q: Can I still keep some parts open source?**
A: Yes! Use the "open core" model - basic version public, premium private.

**Q: What if someone cracks my app?**
A: Focus on providing great value and updates. Most customers will pay for legitimate licenses. Regular updates with license checks help.

**Q: Should I use hardware dongles?**
A: No, for desktop apps license keys are sufficient and more user-friendly.

**Q: Can I use GitHub for private hosting forever?**
A: Yes, GitHub offers unlimited private repos for free!

---

**Recommended Action:** Start with Gumroad + private GitHub repo. It's free to set up, takes 30 minutes, and you can start selling immediately.
