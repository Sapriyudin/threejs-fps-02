// HUD: health, armor, ammo, money, timer, round score, team counts, crosshair,
// hitmarker, killfeed, damage flash and a live minimap. The buy menu is a
// real DOM panel (pointer events on) shown between rounds; everything else is
// pointer-events none so it never blocks the game.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const els = {
    ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'), ammo: $('ammo'),
    health: $('health-value'), armor: $('armor-value'), money: $('money-value'),
    timer: $('timer-value'), round: $('round-value'),
    scoreUs: $('score-us'), scoreThem: $('score-them'),
    aliveUs: $('alive-us'), aliveThem: $('alive-them'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'),
    killfeed: $('killfeed'), banner: $('banner'), bannerText: $('banner-text'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    play: $('play'), buy: $('buy'), buyList: $('buy-list'), buyMoney: $('buy-money'),
    minimap: $('minimap'), flash: $('flash'), charge: $('charge'), chargeText: $('charge-text'),
    weaponName: $('weapon-name'),
  };
  const minimapCtx = els.minimap ? els.minimap.getContext('2d') : null;
  let hitTimer = null;
  let bannerTimer = null;
  let onBuyChoice = null;
  let onPlayClick = null;

  els.play.addEventListener('click', () => { if (onPlayClick) onPlayClick(); });
  els.buyList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy]');
    if (!btn || !onBuyChoice) return;
    onBuyChoice(btn.getAttribute('data-buy'));
  });

  function setText(el, text) { if (el) el.textContent = text; }

  return {
    setHealth(hp, armor) {
      setText(els.health, String(Math.ceil(hp)));
      setText(els.armor, String(Math.ceil(armor)));
      const bar = $('health-bar');
      if (bar) bar.style.width = `${Math.max(0, hp)}%`;
    },
    setAmmo(mag, reserve, name) {
      setText(els.ammoMag, String(mag));
      setText(els.ammoReserve, `/ ${reserve}`);
      setText(els.weaponName, name || '');
      if (els.ammo) els.ammo.classList.toggle('empty', mag === 0);
    },
    setMoney(m) { setText(els.money, `$${m}`); setText(els.buyMoney, `$${m}`); },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(els.timer, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      if (els.timer) els.timer.classList.toggle('low', s <= 15);
    },
    setRound(r, max) { setText(els.round, `ROUND ${r}/${max}`); },
    setScore(us, them) { setText(els.scoreUs, String(us)); setText(els.scoreThem, String(them)); },
    setAlive(us, them) { setText(els.aliveUs, String(us)); setText(els.aliveThem, String(them)); },
    setSpread(spread) {
      if (!els.crosshair) return;
      const gap = 4 + spread * 260;
      els.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    },
    hitMarker(kill) {
      if (!els.hitmarker) return;
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', !!kill);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => els.hitmarker.classList.remove('on', 'kill'), 140);
    },
    flashDamage() {
      if (!els.flash) return;
      els.flash.classList.add('on');
      setTimeout(() => els.flash.classList.remove('on'), 180);
    },
    killfeed(killer, victim, weapon, headshot) {
      if (!els.killfeed) return;
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.innerHTML = `<span class="killer"></span><span class="weapon"></span><span class="victim"></span>`;
      row.children[0].textContent = killer;
      row.children[1].textContent = headshot ? `${weapon} ⌖` : weapon;
      row.children[2].textContent = victim;
      els.killfeed.prepend(row);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      setTimeout(() => row.remove(), 6000);
    },
    banner(text, sub) {
      if (!els.banner) return;
      setText(els.bannerText, text);
      els.banner.classList.remove('hidden');
      els.banner.dataset.sub = sub || '';
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => els.banner.classList.add('hidden'), 2600);
    },
    hideBanner() {
      if (els.banner) els.banner.classList.add('hidden');
      clearTimeout(bannerTimer);
    },
    setCharge(text) {
      if (!els.charge) return;
      if (text) {
        setText(els.chargeText, text);
        els.charge.classList.remove('hidden');
      } else {
        els.charge.classList.add('hidden');
      }
    },
    showOverlay(kind, data) {
      const o = els.overlay;
      if (!o) return;
      o.hidden = false;
      els.buy.classList.add('hidden');
      if (kind === 'start') {
        setText(els.overlayTitle, 'MERIDIAN YARD');
        setText(els.overlayCopy, 'Tactical FPS: plant the charge at A or B, or eliminate the Crimson team. Earn money, buy guns between rounds. First to 5 rounds wins.');
        els.play.textContent = 'Click to play';
      } else if (kind === 'paused') {
        setText(els.overlayTitle, 'Paused');
        setText(els.overlayCopy, 'Click to resume. Buy menu: B. Grenade: G. Plant/defuse: hold E on the site.');
        els.play.textContent = 'Resume';
      } else if (kind === 'end') {
        setText(els.overlayTitle, data && data.win ? 'VANGUARD WINS' : 'CRIMSON WINS');
        setText(els.overlayCopy, data ? `Final score ${data.us} – ${data.them}. ${data.reason || ''}` : '');
        els.play.textContent = 'Play again';
      } else if (kind === 'round') {
        setText(els.overlayTitle, data && data.win ? 'ROUND WON' : 'ROUND LOST');
        setText(els.overlayCopy, data ? data.reason || '' : '');
        els.play.textContent = 'Continue';
      }
    },
    hideOverlay() {
      if (els.overlay) els.overlay.hidden = true;
    },
    showBuy(money, items) {
      const o = els.overlay;
      if (!o) return;
      o.hidden = false;
      els.buy.classList.remove('hidden');
      setText(els.overlayTitle, 'BUY PHASE');
      setText(els.overlayCopy, 'Spend your round money. Press B or click Continue when ready.');
      els.play.textContent = 'Continue';
      setText(els.buyMoney, `$${money}`);
      els.buyList.innerHTML = '';
      for (const item of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'buy-item';
        btn.setAttribute('data-buy', item.key);
        btn.disabled = money < item.price || !!item.owned;
        btn.innerHTML = `<span class="buy-name"></span><span class="buy-price"></span>`;
        btn.children[0].textContent = item.name + (item.owned ? ' — owned' : '');
        btn.children[1].textContent = item.price === 0 ? 'FREE' : `$${item.price}`;
        els.buyList.appendChild(btn);
      }
    },
    hideBuy() { if (els.buy) els.buy.classList.add('hidden'); },
    onPlay(fn) { onPlayClick = fn; },
    onBuy(fn) { onBuyChoice = fn; },
    drawMinimap(world, player, bots, charge) {
      if (!minimapCtx) return;
      const c = minimapCtx;
      const W = 148;
      const H = 104;
      const sx = (x) => (x + 34) / 68 * W;
      const sz = (z) => (z + 24) / 48 * H;
      c.clearRect(0, 0, W, H);
      c.fillStyle = 'rgba(20,22,26,0.85)';
      c.fillRect(0, 0, W, H);
      c.strokeStyle = 'rgba(233,230,223,0.25)';
      c.strokeRect(0.5, 0.5, W - 1, H - 1);
      for (const col of world.colliders) {
        c.fillStyle = 'rgba(138,143,148,0.5)';
        c.fillRect(sx(col.min.x), sz(col.min.z), Math.max(1, sx(col.max.x) - sx(col.min.x)), Math.max(1, sz(col.max.z) - sz(col.min.z)));
      }
      c.font = 'bold 10px system-ui, sans-serif';
      c.fillStyle = '#f0a830';
      c.fillText('A', sx(-26) - 3, sz(-16) + 3);
      c.fillStyle = '#3a8ad9';
      c.fillText('B', sx(26) - 3, sz(-16) + 3);
      if (charge && charge.state === 'planted') {
        c.fillStyle = '#ff5a3a';
        c.beginPath();
        c.arc(sx(charge.x), sz(charge.z), 4, 0, Math.PI * 2);
        c.fill();
      }
      for (const bot of bots) {
        if (!bot.alive) continue;
        c.fillStyle = bot.team === 'us' ? '#3a8ad9' : '#d94a3a';
        c.beginPath();
        c.arc(sx(bot.position.x), sz(bot.position.z), 3, 0, Math.PI * 2);
        c.fill();
      }
      if (player.alive) {
        c.fillStyle = '#e9e6df';
        c.beginPath();
        c.arc(sx(player.position.x), sz(player.position.z), 3.5, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = '#e9e6df';
        c.beginPath();
        c.moveTo(sx(player.position.x), sz(player.position.z));
        c.lineTo(sx(player.position.x) - Math.sin(player.yaw) * 8, sz(player.position.z) - Math.cos(player.yaw) * 8);
        c.stroke();
      }
    },
  };
}
