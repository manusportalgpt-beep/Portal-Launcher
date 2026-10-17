// Client-side script: fetch latest release and enable dynamic download + translations + demo link handling
const owner = 'manusportalgpt-beep';
const repo = 'Portal-Launcher';
const apiLatest = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

async function fetchLatestRelease(){
  try{
    const res = await fetch(apiLatest, {headers:{Accept:'application/vnd.github+json'}});
    if(!res.ok) throw new Error(res.status);
    const data = await res.json();
    return data;
  }catch(e){
    console.warn('fetchLatestRelease failed', e);
    return null;
  }
}

function pickAssetUrl(release){
  if(!release || !release.assets) return null;
  // prefer .exe, then .zip, then any
  const exe = release.assets.find(a => a.name.endsWith('.exe'));
  if(exe) return {url:exe.browser_download_url, name:exe.name};
  const zip = release.assets.find(a => a.name.endsWith('.zip'));
  if(zip) return {url:zip.browser_download_url, name:zip.name};
  if(release.assets.length) return {url:release.assets[0].browser_download_url, name:release.assets[0].name};
  return null;
}

async function init(){
  const btn = document.getElementById('download-latest');
  const dlLink = document.getElementById('download-link');
  const latestTag = document.getElementById('latest-tag');

  const release = await fetchLatestRelease();
  if(release){
    const picked = pickAssetUrl(release);
    latestTag.textContent = release.tag_name || release.name || '—';
    if(picked){
      btn.onclick = ()=>window.open(picked.url, '_blank');
      dlLink.href = picked.url;
      dlLink.setAttribute('download', picked.name);
      dlLink.textContent = `Скачать ${picked.name}`;
    } else {
      btn.onclick = ()=>window.open(release.html_url, '_blank');
      dlLink.href = release.html_url;
    }
  } else {
    latestTag.textContent = '—';
    btn.onclick = ()=>window.open(`https://github.com/${owner}/${repo}/releases`, '_blank');
    dlLink.href = `https://github.com/${owner}/${repo}/releases`;
  }

  // translations
  const i18n = {
    en: {
      'nav.download':'Download', 'nav.features':'Features', 'nav.install':'Install', 'nav.demo':'Open in web',
      'hero.title':'Portal Launcher', 'hero.lead':'A Minecraft launcher with a validating AI assistant and robust modpack management.', 'hero.releases':'All releases', 'hero.small':'Platform: Windows (.exe). For Linux/macOS see Build from source.',
      'hero.card.title':'Why Portal?',
      'features.title':'Key features',
      'install.title':'How to download & install', 'install.step1':'Open releases: Releases › Latest.', 'install.step2':'Find .exe (Windows) or ZIP (portable).', 'install.step3':'Download and run the installer.', 'install.step4':'After install the app will offer required components.',
      'install.direct':'Direct download','install.direct.desc':'Click Download to find .exe or ZIP automatically in the latest release.',
      'build.title':'Build from source','build.note':'Requirements: Node.js 20+, pnpm, Rust and Tauri prerequisites.',
      'gallery.title':'Gallery'
    }
  };

  const lang = document.getElementById('lang');
  function applyLang(code){
    document.documentElement.lang = code;
    const dict = code === 'ru' ? null : i18n[code];
    document.querySelectorAll('[data-i18n]').forEach(el=>{
      const key = el.getAttribute('data-i18n');
      if(!dict){
        // restore default (ru) — no-op
      } else {
        if(dict[key]) el.textContent = dict[key];
      }
    });
  }
  lang.addEventListener('change', ()=>applyLang(lang.value));

  // analytics opt-in
  const opt = document.getElementById('analytics-optin');
  opt.addEventListener('change', ()=>{
    if(opt.checked){
      // placeholder: load analytics (user must opt-in)
      console.log('Analytics enabled (placeholder)');
      // here we could dynamically inject tracking script
    } else {
      console.log('Analytics disabled');
    }
  });
}

window.addEventListener('DOMContentLoaded', init);
