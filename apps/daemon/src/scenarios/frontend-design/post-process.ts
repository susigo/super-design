import path from 'node:path';

export interface AssembleWebPageOptions {
  title: string;
  prompt: string;
  sections: string[];
  heroImageAbsPath?: string;
  projectDir: string;
}

export function assembleWebPageHtml(opts: AssembleWebPageOptions): string {
  const { title, prompt, sections, heroImageAbsPath, projectDir } = opts;

  const imgSrc = heroImageAbsPath
    ? path.relative(projectDir, heroImageAbsPath).replace(/\\/g, '/')
    : null;

  const safeTitle = escHtml(title);
  const safePrompt = escHtml(prompt.length > 200 ? prompt.slice(0, 197) + '…' : prompt);

  const heroStyle = imgSrc
    ? `background-image:linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url('${esc(imgSrc)}');background-size:cover;background-position:center`
    : 'background:linear-gradient(135deg,#1a237e,#0d47a1)';

  const sectionCards = sections
    .map(
      (s, i) =>
        `<div class="card"><div class="card-icon">${cardIcon(i)}</div><h3>${escHtml(s)}</h3><p>Learn more about ${escHtml(s.toLowerCase())} and how it can help you.</p></div>`,
    )
    .join('\n      ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;color:#1a1a2e;background:#fafafa;line-height:1.6}
nav{background:#1a1a2e;color:#fff;padding:1rem 2rem;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
nav .brand{font-size:1.25rem;font-weight:700;letter-spacing:-.02em}
nav ul{list-style:none;display:flex;gap:1.5rem}
nav a{color:#ffffffcc;text-decoration:none;font-size:.9rem;transition:color .2s}
nav a:hover{color:#fff}
.hero{${heroStyle};color:#fff;text-align:center;padding:6rem 2rem;min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center}
.hero h1{font-size:clamp(2rem,5vw,3.5rem);font-weight:800;letter-spacing:-.03em;margin-bottom:1rem;text-shadow:0 2px 12px rgba(0,0,0,.3)}
.hero p{font-size:clamp(1rem,2.5vw,1.25rem);max-width:640px;opacity:.9;margin-bottom:2rem}
.hero .cta-btn{display:inline-block;background:#fff;color:#1a1a2e;padding:.75rem 2rem;border-radius:8px;font-weight:600;text-decoration:none;transition:transform .2s,box-shadow .2s}
.hero .cta-btn:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.2)}
.sections{max-width:1100px;margin:0 auto;padding:4rem 2rem}
.sections h2{text-align:center;font-size:2rem;font-weight:700;margin-bottom:2.5rem;color:#1a1a2e}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.5rem}
.card{background:#fff;border-radius:12px;padding:2rem;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .2s,box-shadow .2s}
.card:hover{transform:translateY(-4px);box-shadow:0 8px 24px rgba(0,0,0,.1)}
.card-icon{font-size:2rem;margin-bottom:.75rem}
.card h3{font-size:1.1rem;font-weight:600;margin-bottom:.5rem}
.card p{font-size:.9rem;color:#555;line-height:1.5}
.cta-section{background:#1a1a2e;color:#fff;text-align:center;padding:4rem 2rem;margin-top:4rem}
.cta-section h2{font-size:1.8rem;font-weight:700;margin-bottom:1rem}
.cta-section p{max-width:500px;margin:0 auto 2rem;opacity:.85}
.cta-section .cta-btn{display:inline-block;background:#fff;color:#1a1a2e;padding:.75rem 2rem;border-radius:8px;font-weight:600;text-decoration:none;transition:transform .2s}
.cta-section .cta-btn:hover{transform:translateY(-2px)}
footer{background:#111;color:#ffffff99;text-align:center;padding:2rem;font-size:.85rem}
footer a{color:#ffffffcc;text-decoration:none}
@media(max-width:600px){
  nav{flex-direction:column;gap:.75rem}
  nav ul{gap:1rem}
  .hero{padding:4rem 1.5rem;min-height:50vh}
  .sections{padding:2.5rem 1.5rem}
}
</style>
</head>
<body>
<nav>
  <div class="brand">${safeTitle}</div>
  <ul>
    <li><a href="#features">Features</a></li>
    <li><a href="#cta">Get Started</a></li>
  </ul>
</nav>
<section class="hero">
  <h1>${safeTitle}</h1>
  <p>${safePrompt}</p>
  <a class="cta-btn" href="#cta">Get Started</a>
</section>
<section class="sections" id="features">
  <h2>What We Offer</h2>
  <div class="grid">
      ${sectionCards}
  </div>
</section>
<section class="cta-section" id="cta">
  <h2>Ready to Get Started?</h2>
  <p>Take the next step and see what we can do for you.</p>
  <a class="cta-btn" href="#">Contact Us</a>
</section>
<footer>
  <p>&copy; 2024 ${safeTitle}. All rights reserved.</p>
</footer>
</body>
</html>`;
}

function esc(s: string): string {
  return s.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ICONS = ['🚀', '⭐', '🎯', '💡', '🔧', '📊'];

function cardIcon(index: number): string {
  return ICONS[index % ICONS.length] ?? '✦';
}
