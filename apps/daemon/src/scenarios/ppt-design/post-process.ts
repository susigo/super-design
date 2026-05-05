import path from 'node:path';

export interface AssembleOptions {
  title: string;
  prompt: string;
  /** Absolute path to the cover image file, or undefined if generation failed. */
  coverImageAbsPath?: string;
  /** Absolute path to the background audio file, or undefined. */
  musicAbsPath?: string;
  /** Absolute project directory — used to compute relative paths for the HTML. */
  projectDir: string;
}

/**
 * Assemble a minimal single-slide HTML presentation from generated assets.
 * Returns the HTML string; the caller is responsible for writing it to disk.
 *
 * The HTML uses embedded CSS and vanilla JS so it works offline and inside the
 * daemon's sandboxed preview iframe without external dependencies.
 */
export function assemblePptHtml(opts: AssembleOptions): string {
  const { title, prompt, coverImageAbsPath, musicAbsPath, projectDir } = opts;

  const imgSrc = coverImageAbsPath
    ? path.relative(projectDir, coverImageAbsPath).replace(/\\/g, '/')
    : null;

  const audioSrc = musicAbsPath
    ? path.relative(projectDir, musicAbsPath).replace(/\\/g, '/')
    : null;

  const coverBlock = imgSrc
    ? `<div class="cover" style="background-image:url('${esc(imgSrc)}')"></div>`
    : `<div class="cover cover-placeholder"></div>`;

  const audioBlock = audioSrc
    ? `<audio id="bg-audio" src="${esc(audioSrc)}" loop></audio>
       <button class="audio-toggle" onclick="toggleAudio()">▶ Play music</button>`
    : '';

  const safeTitle = escHtml(title);
  const safePrompt = escHtml(prompt.length > 200 ? prompt.slice(0, 197) + '…' : prompt);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;background:#111;color:#fff;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}
.slide{width:min(90vw,960px);aspect-ratio:16/9;position:relative;border-radius:12px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.6)}
.cover{position:absolute;inset:0;background-size:cover;background-position:center}
.cover-placeholder{background:linear-gradient(135deg,#1a237e,#283593)}
.overlay{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:2rem;background:rgba(0,0,0,.45);text-align:center}
.slide-title{font-size:clamp(1.4rem,4vw,2.8rem);font-weight:700;letter-spacing:-.02em;line-height:1.2;margin-bottom:1rem;text-shadow:0 2px 8px rgba(0,0,0,.5)}
.slide-subtitle{font-size:clamp(.85rem,2vw,1.2rem);opacity:.8;max-width:70%;line-height:1.5}
.audio-toggle{position:fixed;bottom:1.5rem;right:1.5rem;background:#fff2;border:1px solid #fff4;color:#fff;padding:.5rem 1rem;border-radius:6px;cursor:pointer;font-size:.8rem;backdrop-filter:blur(6px)}
.audio-toggle:hover{background:#fff3}
</style>
</head>
<body>
<div class="slide">
  ${coverBlock}
  <div class="overlay">
    <h1 class="slide-title">${safeTitle}</h1>
    <p class="slide-subtitle">${safePrompt}</p>
  </div>
</div>
${audioBlock}
<script>
function toggleAudio(){
  const a=document.getElementById('bg-audio');
  const b=document.querySelector('.audio-toggle');
  if(!a)return;
  if(a.paused){a.play();b.textContent='⏸ Pause music';}
  else{a.pause();b.textContent='▶ Play music';}
}
</script>
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
