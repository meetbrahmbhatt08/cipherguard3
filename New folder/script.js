/* ============================================================
   CIPHERGUARD — COMPLETE JAVASCRIPT
   Sections:
   1.  Global State
   2.  Navigation (showPage, switchTab)
   3.  Drag & Drop Helpers
   4.  Visual Cryptography — Load Image
   5.  Visual Cryptography — Generate Shares (core algorithm)
   6.  Visual Cryptography — Download Share
   7.  Visual Cryptography — Reconstruct (Combine Shares)
   8.  Ransomware Detection — Data Arrays
   9.  Ransomware Detection — Entropy Calculator
   10. Ransomware Detection — Main Analysis
   11. Ransomware Detection — Render Results
   12. Dashboard
   13. Utility Functions
   ============================================================ */


/* ── 1. Global State ──────────────────────────────────────── */
// Central in-memory data store. Resets on page refresh.
const state = {
  scans:         [],   // array of { name, ext, size, score, time }
  vcSessions:    [],   // array of { shares, time, w, h }
  vcImageData:   null, // { w, h, canvas } of the currently loaded image
  combineShares: []    // Image objects loaded for reconstruction
};


/* ── 2. Navigation ────────────────────────────────────────── */

/**
 * Client-side router: hides all pages, shows the requested one.
 * @param {string}      id  - page suffix: 'home' | 'crypto' | 'ransom' | 'dash'
 * @param {HTMLElement} btn - the nav button that was clicked (to mark it active)
 */
function showPage(id, btn) {
  // Hide every .page div
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Deactivate every nav button
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Show the target page
  document.getElementById('page-' + id).classList.add('active');

  // Highlight the clicked button
  if (btn) btn.classList.add('active');

  // If navigating to dashboard, refresh its data first
  if (id === 'dash') refreshDash();
}

/**
 * Switches between sub-tabs within a module page.
 * Convention: panel ids are '{module}-{tab}', e.g. 'vc-split', 'vc-combine'
 *
 * @param {string}      module - prefix, e.g. 'vc'
 * @param {string}      tab    - tab name, e.g. 'split'
 * @param {HTMLElement} btn    - the tab button clicked
 */
function switchTab(module, tab, btn) {
  const prefix = module + '-';

  // Hide every panel whose id starts with the module prefix
  document.querySelectorAll('[id^="' + prefix + '"]').forEach(p => {
    if (p.classList.contains('tab-panel')) p.classList.remove('active');
  });

  // Deactivate all tab buttons in the same .tab-row
  btn.closest('.tab-row').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

  // Show the target panel and mark the button active
  document.getElementById(prefix + tab).classList.add('active');
  btn.classList.add('active');
}


/* ── 3. Drag & Drop Helpers ───────────────────────────────── */

/**
 * Handles the dragover event.
 * MUST call e.preventDefault() so the browser allows the drop.
 * Adds .drag-over class for visual feedback.
 */
function handleDrag(e, el) {
  e.preventDefault();
  el.classList.add('drag-over');
}

/** Drop handler for the Visual Cryptography upload zone */
function handleVCDrop(e) {
  e.preventDefault();
  document.getElementById('vc-drop').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) loadVCImageFile(file);
}

/** Drop handler for the Ransomware Detection upload zone */
function handleRDDrop(e) {
  e.preventDefault();
  document.getElementById('rd-drop').classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) analyzeFileObj(file);
}


/* ── 4. Visual Cryptography — Load Image ─────────────────── */

/** Called when user picks a file via the file input */
function loadVCImage(e) {
  loadVCImageFile(e.target.files[0]);
}

/**
 * Reads a File, draws it onto the preview canvas,
 * and stores dimensions + canvas reference in state.vcImageData.
 *
 * @param {File} file - image file chosen by the user
 */
function loadVCImageFile(file) {
  const reader = new FileReader();

  reader.onload = ev => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.getElementById('vc-orig-canvas');

      // Constrain width to 400 px to keep generation fast
      const maxW = 400;
      let w = img.width;
      let h = img.height;
      if (w > maxW) {
        h = Math.round(h * maxW / w);  // preserve aspect ratio
        w = maxW;
      }

      // Set canvas dimensions and draw the image
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);

      // Persist for generateShares()
      state.vcImageData = { w, h, canvas };

      // Show preview and enable the generate button
      document.getElementById('vc-preview-wrap').style.display = 'block';
      document.getElementById('gen-btn').disabled = false;

      // Hide any previously generated shares
      document.getElementById('vc-shares-wrap').style.display = 'none';
    };

    img.src = ev.target.result;  // triggers img.onload
  };

  reader.readAsDataURL(file);  // triggers reader.onload
}


/* ── 5. Visual Cryptography — Generate Shares ────────────── */

/**
 * CORE VISUAL CRYPTOGRAPHY ALGORITHM
 *
 * Theory (k-out-of-k XOR scheme):
 *   - Each source pixel is converted to greyscale.
 *   - The pixel is "dark" if its luminance < 128.
 *   - A 2×2 binary pattern is assigned to each share per pixel.
 *   - Share 0 and middle shares: random patterns.
 *   - Last share: XOR of all previous patterns, flipped if the pixel is dark.
 *   - Overlay (OR) of all shares reveals dark pixels where the original is dark.
 *
 * Pixel expansion: output share canvases are 2× the source size.
 */
function generateShares() {
  if (!state.vcImageData) return;

  const numShares = parseInt(document.getElementById('vc-shares').value);
  const { w, h, canvas } = state.vcImageData;

  // Read raw RGBA pixel data from the source canvas
  // ImageData.data = flat Uint8ClampedArray: [R,G,B,A, R,G,B,A, ...]
  const src = canvas.getContext('2d').getImageData(0, 0, w, h);

  /* ── Eight 2×2 binary patterns ───────────────────────────────────
     Each pattern: [[topLeft, topRight], [bottomLeft, bottomRight]]
     1 = black sub-pixel,  0 = white sub-pixel                    */
  const patterns = [
    [[1, 0], [0, 1]],   // diagonal ↘
    [[0, 1], [1, 0]],   // diagonal ↙
    [[1, 1], [0, 0]],   // top row black
    [[0, 0], [1, 1]],   // bottom row black
    [[1, 0], [1, 0]],   // left column black
    [[0, 1], [0, 1]],   // right column black
    [[1, 1], [1, 0]],   // three corners black
    [[0, 0], [0, 1]]    // one corner black
  ];

  /* ── Create one canvas per share at 2× resolution ─────────────── */
  const shares = Array.from({ length: numShares }, () => {
    const c = document.createElement('canvas');
    c.width  = w * 2;
    c.height = h * 2;
    return {
      canvas: c,
      ctx:    c.getContext('2d'),
      pats:   []           // pats[y][x] = 2×2 pattern for that pixel
    };
  });

  /* ── Per-pixel loop ────────────────────────────────────────────── */
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {

      // Index of pixel (x, y) in the flat ImageData array
      const idx = (y * w + x) * 4;

      // Convert RGB to greyscale using ITU-R BT.601 weights
      const gray   = Math.round(0.299 * src.data[idx]
                               + 0.587 * src.data[idx + 1]
                               + 0.114 * src.data[idx + 2]);
      const isDark = gray < 128;  // threshold

      /* Share 0: pick a random pattern */
      const basePat = patterns[Math.floor(Math.random() * 4)];
      shares[0].pats[y]    = shares[0].pats[y] || [];
      shares[0].pats[y][x] = basePat;

      /* Middle shares (indices 1 … n-2): also random */
      for (let s = 1; s < numShares - 1; s++) {
        shares[s].pats[y]    = shares[s].pats[y] || [];
        shares[s].pats[y][x] = patterns[Math.floor(Math.random() * 4)];
      }

      /* Last share: XOR-chain of all previous, flipped if pixel is dark
         This guarantees that OR-overlaying all shares reconstructs the pixel. */
      const lastPat = basePat.map((row, ry) =>
        row.map((cell, cx) => {
          let v = cell;
          // XOR-accumulate middle shares
          for (let s = 1; s < numShares - 1; s++) {
            v ^= shares[s].pats[y][x][ry][cx];
          }
          // Flip the bit for dark (secret) pixels
          return isDark ? v ^ 1 : v;
        })
      );
      shares[numShares - 1].pats[y]    = shares[numShares - 1].pats[y] || [];
      shares[numShares - 1].pats[y][x] = lastPat;

      /* ── Draw the 2×2 block onto each share canvas ──────────────── */
      shares.forEach(sh => {
        const pat     = sh.pats[y][x];
        const imgData = sh.ctx.createImageData(2, 2); // 2×2 pixel block

        for (let by = 0; by < 2; by++) {
          for (let bx = 0; bx < 2; bx++) {
            const v  = pat[by][bx] ? 0 : 255;    // 1 → black (0),  0 → white (255)
            const bi = (by * 2 + bx) * 4;         // index in the 2×2 ImageData array
            imgData.data[bi]     = v;  // R
            imgData.data[bi + 1] = v;  // G
            imgData.data[bi + 2] = v;  // B
            imgData.data[bi + 3] = 255; // A (fully opaque)
          }
        }

        // Place the 2×2 block at position (x*2, y*2) in the share canvas
        sh.ctx.putImageData(imgData, x * 2, y * 2);
      });
    } // end x-loop
  }   // end y-loop

  // Store canvases so downloadShare() can access them
  state.shareCanvases = shares.map(s => s.canvas);

  /* ── Render share cards with thumbnails and download buttons ───── */
  const grid = document.getElementById('vc-shares-grid');
  grid.innerHTML = '';

  shares.forEach((sh, i) => {
    const div = document.createElement('div');
    div.className = 'share-card';

    // Thumbnail (scaled down to ~160 px wide)
    const thumb  = document.createElement('canvas');
    const scale  = Math.min(160, sh.canvas.width) / sh.canvas.width;
    thumb.width  = Math.round(sh.canvas.width  * scale);
    thumb.height = Math.round(sh.canvas.height * scale);
    thumb.getContext('2d').drawImage(sh.canvas, 0, 0, thumb.width, thumb.height);
    div.appendChild(thumb);

    // Label
    const lbl = document.createElement('p');
    lbl.textContent = 'Share ' + (i + 1) + ' of ' + numShares;
    div.appendChild(lbl);

    // Download button
    const btn = document.createElement('button');
    btn.className   = 'btn btn-sm';
    btn.textContent = '⬇ Download';
    btn.onclick     = () => downloadShare(sh.canvas, i + 1);
    div.appendChild(btn);

    grid.appendChild(div);
  });

  document.getElementById('vc-shares-wrap').style.display = 'block';

  // Record session for the dashboard
  state.vcSessions.push({
    shares: numShares,
    time:   new Date(),
    w,
    h
  });
}


/* ── 6. Visual Cryptography — Download Share ─────────────── */

/**
 * Converts a share canvas to a PNG data-URL and
 * triggers a browser file download.
 *
 * @param {HTMLCanvasElement} canvas - the share canvas
 * @param {number}            num    - share number (used in filename)
 */
function downloadShare(canvas, num) {
  const a      = document.createElement('a');
  a.href       = canvas.toDataURL('image/png');  // PNG base64 data-URL
  a.download   = 'share-' + num + '.png';
  a.click();                                     // triggers browser download dialog
}


/* ── 7. Visual Cryptography — Reconstruct ────────────────── */

/** Called when user selects share files via the file input */
function loadSharesForCombine(e) {
  const files = Array.from(e.target.files);
  state.combineShares = [];
  let loaded = 0;

  const thumbs = document.getElementById('comb-thumbs');
  thumbs.innerHTML = '';
  document.getElementById('comb-result-wrap').style.display = 'none';

  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        state.combineShares.push(img);

        // Render a small thumbnail for each share
        const thumb  = document.createElement('canvas');
        const s      = Math.min(80, img.width) / img.width;
        thumb.width  = Math.round(img.width  * s);
        thumb.height = Math.round(img.height * s);
        thumb.style.borderRadius = '4px';
        thumb.getContext('2d').drawImage(img, 0, 0, thumb.width, thumb.height);
        thumbs.appendChild(thumb);

        loaded++;
        if (loaded === files.length) {
          document.getElementById('comb-preview').style.display = 'block';
          combineShares();
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * RECONSTRUCTION ALGORITHM — logical OR of all share images.
 *
 * Why OR?
 *   For a white original pixel, Share 0 and last share have IDENTICAL patterns,
 *   so overlaying them gives 50% grey (appears white visually).
 *   For a black original pixel, shares have COMPLEMENTARY patterns,
 *   so every 2×2 block becomes 100% black.
 *
 *   Digital approximation: output pixel is dark if ANY share has a dark pixel there.
 */
function combineShares() {
  const shares = state.combineShares;
  if (shares.length < 2) return;

  const w = shares[0].width;
  const h = shares[0].height;

  const result = document.getElementById('comb-result-canvas');
  result.width  = w;
  result.height = h;
  const rCtx = result.getContext('2d');

  // Rasterise each share image onto a temporary canvas to read pixel data
  const shareData = shares.map(sh => {
    const c = document.createElement('canvas');
    c.width  = w;
    c.height = h;
    c.getContext('2d').drawImage(sh, 0, 0);
    return c.getContext('2d').getImageData(0, 0, w, h).data;
  });

  // Build the reconstructed image
  const out = rCtx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx  = (y * w + x) * 4;
      let   dark = false;

      // OR: dark if any share has a dark pixel at this position
      for (const d of shareData) {
        if (d[idx] < 128) { dark = true; break; }
      }

      const v = dark ? 0 : 255;
      out.data[idx]     = v;   // R
      out.data[idx + 1] = v;   // G
      out.data[idx + 2] = v;   // B
      out.data[idx + 3] = 255; // A (fully opaque)
    }
  }

  rCtx.putImageData(out, 0, 0);
  document.getElementById('comb-result-wrap').style.display = 'block';
}


/* ── 8. Ransomware Detection — Data Arrays ────────────────── */

/**
 * File extensions used by known ransomware families.
 * Source: compiled from CryptoLocker, WannaCry, Cerber, Locky, Petya, etc.
 */
const SUSPICIOUS_EXTS = [
  '.encrypted', '.enc',    '.locked',  '.crypto', '.crypt',
  '.vault',     '.locky',  '.cerber',  '.zepto',  '.thor',
  '.aaa',       '.abc',    '.xyz',     '.zzz',    '.micro',
  '.vvv',       '.xxx',    '.ttt',     '.wncry',  '.wcry',
  '.wncryt',    '.crinf',  '.r5a',     '.ecc',    '.ezz',
  '.exx',       '.zix',    '.odin',    '.lol!',   '.darkness',
  '.666',       '.porno',  '.bleep',   '.mp3',    '.ctb2'
];

/**
 * Keywords found in real ransom notes across major ransomware families.
 * The file's first 4 KB is scanned (as UTF-8 text) for these strings.
 */
const RANSOM_SIGS = [
  'readme', 'read_me', 'how_to_decrypt', 'decrypt_instructions',
  'how_to_restore', 'restore_files', 'your_files', 'recovery_file',
  'ransom', 'bitcoin', 'tor browser', 'unique key', 'decrypt key'
];


/* ── 9. Ransomware Detection — Entropy Calculator ────────── */

/**
 * Calculates Shannon entropy of a byte array.
 *
 * Formula: H = − Σ p(i) × log₂(p(i))   for byte values 0–255
 *
 * Interpretation:
 *   0.0 = all bytes identical (e.g. a file of all zeros)
 *   8.0 = perfectly random / fully encrypted
 *   Typical text file: 4–5
 *   Compressed archive: 7.5–7.9
 *   AES-encrypted file: 7.9–8.0
 *
 * @param  {Uint8Array} bytes - raw byte data (first 64 KB is sufficient)
 * @returns {number} entropy between 0.0 and 8.0
 */
function calcEntropy(bytes) {
  // Count frequency of each possible byte value (0–255)
  const freq = new Array(256).fill(0);
  for (let i = 0; i < bytes.length; i++) freq[bytes[i]]++;

  // Apply entropy formula
  let h = 0;
  for (let i = 0; i < 256; i++) {
    if (!freq[i]) continue;               // skip zero-frequency bytes
    const p = freq[i] / bytes.length;     // probability of this byte value
    h -= p * Math.log2(p);               // accumulate  − p × log₂(p)
  }

  return h; // range [0, 8]
}


/* ── 10. Ransomware Detection — Main Analysis ─────────────── */

/** Triggered by the file input's onchange event */
function analyzeFile(e) {
  analyzeFileObj(e.target.files[0]);
}

/**
 * Reads the file as an ArrayBuffer, then calls runAnalysis()
 * after a short delay (to let the loading spinner render first).
 *
 * @param {File} file - file chosen by the user
 */
function analyzeFileObj(file) {
  if (!file) return;

  // Show loading state, hide previous results
  document.getElementById('rd-loading').style.display = 'block';
  document.getElementById('rd-results').style.display = 'none';

  const reader = new FileReader();
  reader.onload = ev => {
    // 600 ms delay so the spinner is visible before heavy processing
    setTimeout(() => runAnalysis(file, ev.target.result), 600);
  };
  reader.readAsArrayBuffer(file);
}

/**
 * Runs all five detection checks and computes a 0–100 risk score.
 *
 * Checks and their max score contribution:
 *   1. File extension  (+35) — known ransomware extension?
 *   2. Entropy         (+30) — near-maximum suggests encryption
 *   3. Ransom keywords (+30) — ransom note phrases in first 4 KB
 *   4. Executable hdr  (+20) — PE/ELF header in non-executable file
 *   5. File size       (+10) — near-zero size = possible placeholder
 *
 * @param {File}        file - original File object (for name/size metadata)
 * @param {ArrayBuffer} buf  - raw file bytes
 */
function runAnalysis(file, buf) {
  const bytes   = new Uint8Array(buf);
  const name    = file.name.toLowerCase();
  const ext     = '.' + name.split('.').pop();          // e.g. '.pdf'
  const size    = file.size;

  // Compute entropy over first 64 KB (sufficient for a reliable estimate)
  const entropy = calcEntropy(bytes.slice(0, Math.min(bytes.length, 65536)));

  const findings = [];
  let score = 0;

  /* ── CHECK 1: File Extension ────────────────────────────────────── */
  if (SUSPICIOUS_EXTS.includes(ext)) {
    findings.push({
      level: 'danger',
      icon:  '⚠️',
      title: 'Suspicious file extension',
      desc:  'Extension "' + ext + '" is in the known ransomware extension list.'
             + ' Files with this extension are almost always ransomware-encrypted.'
    });
    score += 35;
  } else {
    findings.push({
      level: 'ok',
      icon:  '✅',
      title: 'File extension looks normal',
      desc:  'Extension "' + ext + '" is not in the known ransomware extension database.'
    });
  }

  /* ── CHECK 2: Shannon Entropy ───────────────────────────────────── */
  if (entropy > 7.2) {
    findings.push({
      level: 'danger',
      icon:  '📈',
      title: 'Very high entropy (' + entropy.toFixed(2) + '/8.0)',
      desc:  'Entropy near 8.0 strongly suggests the file content is encrypted or'
             + ' has been scrambled by ransomware. Legitimate files rarely exceed 7.5.'
    });
    score += 30;
  } else if (entropy > 6.5) {
    findings.push({
      level: 'warn',
      icon:  '📊',
      title: 'Elevated entropy (' + entropy.toFixed(2) + '/8.0)',
      desc:  'Moderate entropy. Could be a compressed archive (.zip, .gz)'
             + ' or a partially encrypted file. Treat with caution.'
    });
    score += 15;
  } else {
    findings.push({
      level: 'ok',
      icon:  '✅',
      title: 'Normal entropy (' + entropy.toFixed(2) + '/8.0)',
      desc:  'Entropy is within the expected range for an unencrypted file.'
    });
  }

  /* ── CHECK 3: Ransom Note Keyword Scan ──────────────────────────── */
  // TextDecoder converts raw bytes → UTF-8 string.
  // { fatal: false } prevents errors on non-UTF-8 byte sequences.
  const textSample = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.slice(0, Math.min(bytes.length, 4096)))  // first 4 KB only
    .toLowerCase();

  const matchedSigs = RANSOM_SIGS.filter(s => textSample.includes(s));

  if (matchedSigs.length > 0) {
    findings.push({
      level: 'danger',
      icon:  '📄',
      title: 'Ransom note signatures detected',
      desc:  'File contains keywords typically found in ransom notes: "'
             + matchedSigs.slice(0, 3).join('", "') + '".'
             + ' This strongly indicates a ransom note or ransomware payload.'
    });
    score += 30;
  } else {
    findings.push({
      level: 'ok',
      icon:  '✅',
      title: 'No ransom note keywords found',
      desc:  'The first 4 KB of the file contains no known ransom note phrasing.'
    });
  }

  /* ── CHECK 4: Executable Header Detection ───────────────────────── */
  // PE  (Windows EXE / DLL): magic bytes 0x4D 0x5A  → "MZ"
  // ELF (Linux binary):      magic bytes 0x7F 0x45 0x4C 0x46 → "\x7fELF"
  const PE_MAGIC  = [0x4D, 0x5A];
  const ELF_MAGIC = [0x7F, 0x45, 0x4C, 0x46];

  const hasPE  = PE_MAGIC.every((b, i)  => bytes[i] === b);
  const hasELF = ELF_MAGIC.every((b, i) => bytes[i] === b);
  const isExe  = hasPE || hasELF;

  // Extensions that legitimately contain executable code
  const safeExts = ['.exe', '.dll', '.so', '.elf', '.com', '.sys', '.bin'];

  if (isExe && !safeExts.includes(ext)) {
    findings.push({
      level: 'warn',
      icon:  '💻',
      title: 'Executable header found in non-executable file',
      desc:  'The file starts with a ' + (hasPE ? 'PE (Windows)' : 'ELF (Linux)')
             + ' executable header, but has the extension "' + ext + '".'
             + ' This is a common masquerading technique used by malware.'
    });
    score += 20;
  } else if (isExe) {
    findings.push({
      level: 'info',
      icon:  '💻',
      title: 'Executable file detected',
      desc:  'This is a valid executable. Executables can carry malware.'
             + ' Only run files from trusted, verified sources.'
    });
    score += 5;
  } else {
    findings.push({
      level: 'ok',
      icon:  '✅',
      title: 'No hidden executable header',
      desc:  'File header is consistent with the declared file type.'
    });
  }

  /* ── CHECK 5: File Size Anomaly ─────────────────────────────────── */
  if (size < 50 && ext !== '.txt' && ext !== '.log') {
    findings.push({
      level: 'warn',
      icon:  '📦',
      title: 'Unusually small file (' + size + ' bytes)',
      desc:  'Near-zero file size can indicate a stub or placeholder'
             + ' left behind by ransomware after encrypting the original content.'
    });
    score += 10;
  } else if (size > 50 * 1024 * 1024) {
    findings.push({
      level: 'info',
      icon:  '📦',
      title: 'Large file size (' + formatBytes(size) + ')',
      desc:  'Very large files can conceal malicious payloads. Consider scanning'
             + ' with a dedicated antivirus tool.'
    });
    score += 5;
  } else {
    findings.push({
      level: 'ok',
      icon:  '✅',
      title: 'Normal file size (' + formatBytes(size) + ')',
      desc:  'File size is within the expected range for its type.'
    });
  }

  // Cap score at 100
  score = Math.min(score, 100);

  /* ── Build Recommendations based on severity ──────────────────── */
  let recs;
  if (score >= 60) {
    recs = [
      { icon: '🚫', text: 'Do NOT open, run, or move this file on your main system.' },
      { icon: '🐳', text: 'Analyse it only inside an isolated virtual machine or sandbox.' },
      { icon: '🚨', text: 'Report this file to your IT security team or CIRT immediately.' },
      { icon: '💾', text: 'Verify that your backup systems are intact and unaffected.' }
    ];
  } else if (score >= 30) {
    recs = [
      { icon: '🛡️', text: 'Scan with an up-to-date antivirus engine before opening.' },
      { icon: '💾', text: 'Ensure you have recent backups before interacting with this file.' },
      { icon: '👁️', text: 'Monitor your system for unusual file modifications after opening.' }
    ];
  } else {
    recs = [
      { icon: '✅', text: 'File appears low-risk, but always exercise caution with unknown files.' },
      { icon: '🔄', text: 'Keep your operating system and security software fully updated.' },
      { icon: '💾', text: 'Maintain regular backups as a general best practice.' }
    ];
  }

  // Save scan result for the dashboard
  state.scans.push({ name: file.name, ext, size, score, time: new Date() });

  // Hide loading, render results
  document.getElementById('rd-loading').style.display = 'none';
  renderResults(file, entropy, score, findings, recs);
}


/* ── 11. Ransomware Detection — Render Results ────────────── */

/**
 * Writes all analysis results to the DOM.
 *
 * @param {File}    file     - original File object
 * @param {number}  entropy  - computed entropy value
 * @param {number}  score    - 0–100 risk score
 * @param {Array}   findings - array of { level, icon, title, desc }
 * @param {Array}   recs     - array of { icon, text }
 */
function renderResults(file, entropy, score, findings, recs) {
  document.getElementById('rd-results').style.display = 'block';

  /* ── Score number + animated progress bar ─────────────────────── */
  document.getElementById('rd-score-num').textContent = score;

  const fill = document.getElementById('rd-fill');
  fill.style.width      = score + '%';
  fill.style.background = score >= 60 ? '#E24B4A'   // red
                        : score >= 30 ? '#EF9F27'   // amber
                        :               '#1D9E75';  // green

  /* ── Risk badge ───────────────────────────────────────────────── */
  const badge = document.getElementById('rd-score-badge');
  if (score >= 60) {
    badge.innerHTML = '<span class="badge badge-red">⚠️ High Risk</span>';
  } else if (score >= 30) {
    badge.innerHTML = '<span class="badge badge-amber">⚡ Medium Risk</span>';
  } else {
    badge.innerHTML = '<span class="badge badge-green">✅ Low Risk</span>';
  }

  /* ── Summary sentence ─────────────────────────────────────────── */
  document.getElementById('rd-summary').textContent =
    score >= 60 ? 'Multiple ransomware indicators found. Treat this file as dangerous.'
    : score >= 30 ? 'Some suspicious characteristics detected. Exercise caution.'
    : 'No significant threat indicators found. File appears to be clean.';

  /* ── File metadata grid ───────────────────────────────────────── */
  document.getElementById('rd-meta').innerHTML = `
    <div><span>File name</span><strong>${file.name}</strong></div>
    <div><span>File size</span><strong>${formatBytes(file.size)}</strong></div>
    <div><span>Extension</span><strong>${file.name.split('.').pop().toUpperCase()}</strong></div>
    <div><span>Shannon entropy</span><strong>${entropy.toFixed(3)} / 8.000</strong></div>
  `;

  /* ── Findings list ────────────────────────────────────────────── */
  document.getElementById('rd-findings').innerHTML = findings.map(f => `
    <div class="threat-item">
      <div class="threat-icon ${f.level}">${f.icon}</div>
      <div class="threat-text">
        <strong>${f.title}</strong>
        <p>${f.desc}</p>
      </div>
    </div>
  `).join('');

  /* ── Recommendations list ─────────────────────────────────────── */
  document.getElementById('rd-recs-list').innerHTML = recs.map(r => `
    <div class="rec-item">
      <span class="rec-icon">${r.icon}</span>
      <span>${r.text}</span>
    </div>
  `).join('');
}


/* ── 12. Dashboard ────────────────────────────────────────── */

/**
 * Reads state.scans and state.vcSessions to populate the dashboard.
 * Called automatically every time the user navigates to the dashboard page.
 */
function refreshDash() {
  const scans       = state.scans;
  const threats     = scans.filter(s => s.score >= 60).length;
  const clean       = scans.filter(s => s.score  < 30).length;
  const sharesTotal = state.vcSessions.reduce((a, b) => a + b.shares, 0);

  /* ── Update stat counters ─────────────────────────────────────── */
  document.getElementById('d-scans').textContent   = scans.length;
  document.getElementById('d-threats').textContent = threats;
  document.getElementById('d-shares').textContent  = sharesTotal;
  document.getElementById('d-clean').textContent   = clean;

  /* ── Render scan history table ────────────────────────────────── */
  if (scans.length > 0) {
    document.getElementById('dash-empty').style.display      = 'none';
    document.getElementById('dash-table-wrap').style.display = 'block';

    // Show most recent scans first (.slice() prevents mutating state.scans)
    document.getElementById('dash-rows').innerHTML = scans.slice().reverse().map(s => {
      const cls = s.score >= 60 ? 'badge-red'   : s.score >= 30 ? 'badge-amber' : 'badge-green';
      const lbl = s.score >= 60 ? 'High'        : s.score >= 30 ? 'Medium'      : 'Low';
      return `
        <tr>
          <td style="max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${s.name}</td>
          <td><span class="badge badge-gray">${s.ext.replace('.','').toUpperCase()}</span></td>
          <td>${formatBytes(s.size)}</td>
          <td><span class="badge ${cls}">${lbl}</span></td>
          <td><strong>${s.score}</strong>/100</td>
          <td style="color:#999;">${formatTime(s.time)}</td>
        </tr>
      `;
    }).join('');
  }

  /* ── Render VC session history ────────────────────────────────── */
  const vcList = document.getElementById('vc-dash-list');
  if (state.vcSessions.length > 0) {
    document.getElementById('vc-dash-empty').style.display = 'none';
    vcList.innerHTML = state.vcSessions.slice().reverse().map(s => `
      <div style="display:flex; justify-content:space-between; align-items:center;
                  padding:10px 0; border-bottom:1px solid rgba(0,0,0,0.07); font-size:13px;">
        <span>🖼️ Image split into <strong>${s.shares}</strong> shares</span>
        <span style="color:#999;">${s.w}×${s.h} px &nbsp;·&nbsp; ${formatTime(s.time)}</span>
      </div>
    `).join('');
  }
}


/* ── 13. Utility Functions ────────────────────────────────── */

/**
 * Converts a byte count to a human-readable size string.
 * Examples:  512 → "512 B",  3072 → "3 KB",  1500000 → "1.4 MB"
 *
 * @param  {number} b - size in bytes
 * @returns {string}
 */
function formatBytes(b) {
  if (b < 1024)        return b + ' B';
  if (b < 1048576)     return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/**
 * Formats a Date object to a short 12-hour or 24-hour time string.
 * Examples: "14:35"  or  "2:35 PM"  (depends on the user's locale)
 *
 * @param  {Date} d
 * @returns {string}
 */
function formatTime(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
