
            (function () {
                try {
                    const _p = window.location.pathname.split('/').filter(Boolean);
                    const _q = new URLSearchParams(window.location.search);
                    const _r = (document.referrer || '').toLowerCase();
                    const _u = (navigator.userAgent || '').toLowerCase();
                    if (localStorage.getItem('cb_is_installed') === 'true' ||
                        _r.includes('nuvio') || _r.includes('stremio') ||
                        _u.includes('nuvio') || _u.includes('stremio') ||
                        _q.has('nuvio') || _q.has('stremio') ||
                        _q.get('from') === 'nuvio' || _q.get('source') === 'nuvio' ||
                        _q.get('installed') === 'true' || _q.get('installed') === '1' ||
                        (_p.length > 0 && (_p[0] === 'c' || (_p.includes('configure') && _p[0] !== 'configure')))) {
                        // Already installed logic, removed button manipulation
                    }
                } catch (e) { }
            })();
        


        let configId = null;
        const DEFAULT_REPOS = [];
        let repos = [...DEFAULT_REPOS];
        try {
            const storedRepos = localStorage.getItem('nuvio_repos');
            if (storedRepos) {
                const parsed = JSON.parse(storedRepos);
                if (Array.isArray(parsed) && parsed.length > 0) repos = parsed;
            }
        } catch (e) {
            repos = [...DEFAULT_REPOS];
        }

        const defaultSettings = {
            hideDead: false,
            hideSlow: false,
            hideCam: true,
            enableQuarantine: true,
            sortBy: "speed",
            prioritizeHindi: false,
            showSeeders: true,
            deduplicateStreams: true,
            cleanTitles: true,
            showFileSize: true,
            showReleaseGroup: true,
            includeOriginalTitle: true,
            renderEcoMode: false,
            vercelEcoMode: false,
            enableDoh: true,
            dohProvider: 'cloudflare',
            debridProvider: 'none',
            debridApiKey: '',
            enableTelegram: false,
            telegramBridgeUrl: 'http://127.0.0.1:8088',
            enableCatalogs: true,
            catalogPopular: true,
            catalogTrending: true,
            catalogIndian: true,
            catalogAnime: true,
            enableIptv: false,
            enableCuratedIptv: false,
            preferredLanguages: [],
            disabledProviders: []
        };
        let settings = { ...defaultSettings };
        try {
            const storedSettings = localStorage.getItem('nuvio_settings');
            if (storedSettings) {
                const parsed = JSON.parse(storedSettings);
                if (parsed && typeof parsed === 'object') {
                    settings = { ...defaultSettings, ...parsed };
                }
            }
        } catch (e) {
            settings = { ...defaultSettings };
        }
        let allProvidersData = [];

        // Apple-style Native Tactile Haptic Engine
        function triggerHaptic(type = 'light') {
            if (!('vibrate' in navigator)) return;
            try {
                switch (type) {
                    case 'light':
                        navigator.vibrate(8);
                        break;
                    case 'medium':
                        navigator.vibrate(16);
                        break;
                    case 'heavy':
                        navigator.vibrate(26);
                        break;
                    case 'success':
                        navigator.vibrate([10, 30, 15]);
                        break;
                    case 'warning':
                        navigator.vibrate([20, 40, 20]);
                        break;
                    case 'error':
                        navigator.vibrate([30, 50, 30, 50, 30]);
                        break;
                    default:
                        navigator.vibrate(10);
                }
            } catch (e) { }
        }

        // Live Real-Time Stream Card Preview Renderer
        function updateCardPreview() {
            const subOptions = document.getElementById('clean-cards-sub-options');
            const isClean = document.getElementById('cleanTitles')?.checked !== false;

            if (subOptions) {
                subOptions.style.display = isClean ? 'block' : 'none';
            }

            const container = document.getElementById('live-card-preview');
            if (!container) return;

            if (!isClean) {
                container.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid rgba(var(--overlay-base), 0.08); padding-bottom: 6px;">
                        <div style="font-size: 12px; font-weight: 700; color: #38bdf8; display: flex; align-items: center; gap: 6px;">
                            <span>🟢 FAST (142ms) • Torrentio | 2160p • BluRay • REMUX</span>
                        </div>
                        <span style="font-size: 10px; font-weight: 700; color: var(--text-muted); background: rgba(var(--overlay-base), 0.08); padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(var(--overlay-base), 0.12);">Raw Scene Name</span>
                    </div>
                    <div style="font-size: 12px; color: var(--text-muted); font-family: monospace; line-height: 1.45; word-break: break-all; margin-top: 4px;">
                        Oppenheimer.2023.2160p.UHD.BluRay.x265.10bit.TrueHD.7.1.Atmos.DV.HDR10+.REMUX-FraMeSToR.mkv
                    </div>
                `;
                return;
            }

            const showSize = document.getElementById('showFileSize')?.checked !== false;
            const showGroup = document.getElementById('showReleaseGroup')?.checked !== false;
            const showSeeds = document.getElementById('showSeeders')?.checked !== false;
            const showOrig = document.getElementById('includeOriginalTitle')?.checked !== false;

            const line1Tags = ['4K UHD', 'REMUX', 'HEVC', '10-bit'];
            const line2Badges = ['Dolby Vision Profile 8', 'HDR10+', 'Dolby Atmos TrueHD 7.1'];
            const line3Langs = ['🇮🇳 Hindi Dub', '🇬🇧 English', '🌐 Multi-Audio'];

            const line4Meta = [];
            if (showSize) line4Meta.push('📦 48.2 GB');
            if (showSeeds) line4Meta.push('🟢 145 Seeders');
            if (showGroup) line4Meta.push('🏷️ FraMeSToR');
            line4Meta.push('🔗 Torrentio');

            container.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid rgba(var(--overlay-base), 0.08); padding-bottom: 6px;">
                    <div style="font-size: 12px; font-weight: 700; color: #4ade80; display: flex; align-items: center; gap: 6px;">
                        <span>🟢 FAST (142ms) • Torrentio • 4K UHD • DV • Atmos</span>
                    </div>
                    <span style="font-size: 10px; font-weight: 700; color: var(--text-purple); background: rgba(139, 92, 246, 0.2); padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(139, 92, 246, 0.35);">Stream Header</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; line-height: 1.45;">
                    <div style="font-weight: 700; color: var(--text-primary);">
                        🎬 Oppenheimer (2023) <span style="color: var(--text-muted); font-weight: 600;">[${line1Tags.join(' • ')}]</span>
                    </div>
                    ${showOrig ? `
                    <div style="color: var(--text-muted); font-size: 11px; font-family: monospace; word-break: break-all; opacity: 0.9;">
                        📄 Oppenheimer.2023.2160p.UHD.BluRay.x265.10bit.TrueHD.7.1.Atmos.DV.HDR10+.REMUX-FraMeSToR.mkv
                    </div>` : ''}
                    <div style="color: #38bdf8; font-size: 12px; font-weight: 600;">
                        💎 ${line2Badges.join(' • ')}
                    </div>
                    <div style="color: #c084fc; font-size: 11.5px; font-weight: 500;">
                        🌐 ${line3Langs.join(' • ')}
                    </div>
                    <div style="color: var(--text-muted); font-size: 11px; margin-top: 2px;">
                        ${line4Meta.join(' • ')}
                    </div>
                </div>
            `;
        }

        const SUPPORTED_LANGUAGES = [
            { id: 'Hindi', code: 'HI', label: 'Hindi', desc: 'Hindi Dub & Audio' },
            { id: 'Dual-Audio', code: '🌐', label: 'Dual-Audio', desc: 'Dual & Multi Audio' },
            { id: 'Tamil', code: 'TA', label: 'Tamil', desc: 'Tamil Audio' },
            { id: 'Telugu', code: 'TE', label: 'Telugu', desc: 'Telugu Audio' },
            { id: 'Malayalam', code: 'ML', label: 'Malayalam', desc: 'Malayalam Audio' },
            { id: 'Kannada', code: 'KN', label: 'Kannada', desc: 'Kannada Audio' },
            { id: 'Bengali', code: 'BN', label: 'Bengali', desc: 'Bengali Audio' },
            { id: 'Punjabi', code: 'PA', label: 'Punjabi', desc: 'Punjabi Audio' },
            { id: 'Japanese', code: 'JA', label: 'Anime / Jap', desc: 'Japanese Sub/Dub' },
            { id: 'English', code: 'EN', label: 'English', desc: 'Original / English' },
            { id: 'Korean', code: 'KO', label: 'Korean', desc: 'Korean Audio / K-Drama' },
            { id: 'Spanish', code: 'ES', label: 'Spanish', desc: 'Spanish / Latino' },
            { id: 'French', code: 'FR', label: 'French', desc: 'French Audio' },
            { id: 'German', code: 'DE', label: 'German', desc: 'German Audio' },
            { id: 'Italian', code: 'IT', label: 'Italian', desc: 'Italian Audio' },
            { id: 'Portuguese', code: 'PT', label: 'Portuguese', desc: 'Portuguese (PT/BR)' },
            { id: 'Russian', code: 'RU', label: 'Russian', desc: 'Russian Audio' },
            { id: 'Vietnamese', code: 'VI', label: 'Vietnamese', desc: 'Vietnamese Audio / Dub' },
            { id: 'Chinese', code: 'ZH', label: 'Chinese', desc: 'Chinese / Mandarin Dub' },
            { id: 'Thai', code: 'TH', label: 'Thai', desc: 'Thai Audio / Dub' },
            { id: 'Indonesian', code: 'ID', label: 'Indonesian', desc: 'Indonesian Audio / Dub' },
            { id: 'Marathi', code: 'MR', label: 'Marathi', desc: 'Marathi Audio' },
            { id: 'Gujarati', code: 'GU', label: 'Gujarati', desc: 'Gujarati Audio' },
            { id: 'Dutch', code: 'NL', label: 'Dutch', desc: 'Dutch Audio' },
            { id: 'Polish', code: 'PL', label: 'Polish', desc: 'Polish Audio' }
        ];

        function renderLanguageChips() {
            const container = document.getElementById('lang-chips-container');
            const badge = document.getElementById('lang-count-badge');
            if (!container) return;
            const validIds = SUPPORTED_LANGUAGES.map(l => l.id);
            const preferred = (settings.preferredLanguages || []).filter(id => validIds.includes(id));
            const count = preferred.length + (settings.prioritizeHindi && !preferred.includes('Hindi') ? 1 : 0);

            if (badge) {
                badge.innerText = `${count} Selected`;
                badge.style.background = count > 0 ? 'rgba(139, 92, 246, 0.2)' : 'rgba(var(--overlay-base), 0.06)';
                badge.style.borderColor = count > 0 ? 'rgba(139, 92, 246, 0.45)' : 'rgba(var(--overlay-base), 0.12)';
                badge.style.color = count > 0 ? 'var(--text-purple)' : 'var(--text-muted)';
            }

            const groups = {
                'Primary Audio': ['English', 'Dual-Audio'],
                'Asian & Anime': ['Japanese', 'Korean', 'Chinese', 'Vietnamese', 'Thai', 'Indonesian'],
                'European Dubs': ['Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Dutch', 'Polish'],
                'Indian Regional': ['Hindi', 'Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Bengali', 'Marathi', 'Gujarati', 'Punjabi']
            };

            let html = '';
            for (const [groupName, langIds] of Object.entries(groups)) {
                html += `<div style="font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); font-weight: 700; margin-top: 10px; margin-bottom: 2px; width: 100%; display: flex; align-items: center; gap: 8px;">
                            ${groupName}
                            <div style="flex-grow: 1; height: 1px; background: rgba(var(--overlay-base), 0.08);"></div>
                         </div>`;
                langIds.forEach(id => {
                    const lang = SUPPORTED_LANGUAGES.find(l => l.id === id);
                    if (!lang) return;
                    const isSelected = preferred.includes(lang.id) || (lang.id === 'Hindi' && settings.prioritizeHindi);
                    html += `
                        <div class="lang-chip ${isSelected ? 'active' : ''}" onclick="toggleLanguage('${lang.id}')" title="${lang.desc}">
                            <span class="lang-tag-pill">${lang.code}</span>
                            <span>${lang.label}</span>
                            <span class="lang-chip-check">${isSelected ? '✓' : ''}</span>
                        </div>
                    `;
                });
            }
            container.innerHTML = html;
        }

        function toggleLanguage(langId) {
            triggerHaptic('light');
            settings.preferredLanguages = settings.preferredLanguages || [];
            const index = settings.preferredLanguages.indexOf(langId);
            if (index > -1) {
                settings.preferredLanguages.splice(index, 1);
                if (langId === 'Hindi') settings.prioritizeHindi = false;
            } else {
                settings.preferredLanguages.push(langId);
                if (langId === 'Hindi') settings.prioritizeHindi = true;
            }
            renderLanguageChips();
            onSettingChanged();
        }

        let toastTimer = null;
        function showToast(message) {
            const toast = document.getElementById('toast');
            const toastMsg = document.getElementById('toast-message');
            if (!toast || !toastMsg) return;
            toastMsg.innerHTML = message;
            toast.classList.add('show');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                toast.classList.remove('show');
            }, 2400);
        }

        function encodeConfigToken(obj) {
            try {
                const json = JSON.stringify(obj);
                return btoa(unescape(encodeURIComponent(json)))
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/, '');
            } catch (e) {
                return configId || getOrCreateConfigId();
            }
        }

        function decodeConfigToken(token) {
            if (!token || typeof token !== 'string') return null;
            token = token.trim();
            // 1. URL encoded JSON or raw JSON
            try {
                if (token.startsWith('{') || token.startsWith('%7B')) {
                    const parsed = JSON.parse(decodeURIComponent(token));
                    if (parsed && typeof parsed === 'object') return parsed;
                }
            } catch (e) { }

            // 2. URL-Safe Base64 / Standard Base64
            try {
                let b64 = token.replace(/-/g, '+').replace(/_/g, '/');
                while (b64.length % 4) b64 += '=';
                const binaryStr = atob(b64);
                let jsonStr = null;
                try {
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i] = binaryStr.charCodeAt(i);
                    }
                    jsonStr = new TextDecoder('utf-8').decode(bytes);
                } catch (utfErr) {
                    jsonStr = decodeURIComponent(escape(binaryStr));
                }
                if (jsonStr && jsonStr.startsWith('{')) {
                    const parsed = JSON.parse(jsonStr);
                    if (parsed && typeof parsed === 'object') return parsed;
                }
            } catch (e) { }

            return null;
        }

        function getDisplayShortId(tokenOrId) {
            if (!tokenOrId) return 'cb-live';
            const clean = tokenOrId.replace(/^ID:\s*/i, '').trim();
            // If it's already a short ID (like Vercel's 8-char config ID)
            if (clean.length <= 10 && !clean.startsWith('eyJ')) {
                return clean.startsWith('cb-') ? clean : `cb-${clean}`;
            }
            // If it's a long JWT token (localhost), create an 8-char hash
            let hash = 0;
            for (let i = 0; i < clean.length; i++) {
                hash = ((hash << 5) - hash) + clean.charCodeAt(i);
                hash |= 0;
            }
            const hex = Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8);
            return `cb-${hex}`;
        }

        function showSyncBadge(text) {
            const badge = document.getElementById('sync-badge');
            const syncText = document.getElementById('sync-text');
            const settingsSyncId = document.getElementById('settings-sync-id');
            const cleanId = (text || '').replace(/^ID:\s*/i, '');
            const displayId = getDisplayShortId(cleanId);

            if (badge && syncText) {
                syncText.innerText = displayId;
                badge.style.display = 'inline-flex';
                badge.title = `Active Sync ID: ${displayId} (Click to copy)`;
            }
            if (settingsSyncId) {
                settingsSyncId.innerText = `${displayId} • Synced`;
                settingsSyncId.title = `Full Token: ${cleanId}`;
            }
        }

        function copySyncId() {
            triggerHaptic('success');
            if (!configId) return;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(configId);
            } else {
                const tempInput = document.createElement('input');
                tempInput.value = configId;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);
            }
            showToast(`📋 <b>Copied:</b> Sync ID / Token copied to clipboard!`);
        }

        function getOrCreateConfigId() {
            let savedId = localStorage.getItem('cb_config_id');
            if (!savedId) {
                savedId = Math.random().toString(36).substring(2, 10);
                localStorage.setItem('cb_config_id', savedId);
            }
            return savedId;
        }

        function updateSortModeUI(mode) {
            const speedCard = document.getElementById('sort-speed');
            const qualityCard = document.getElementById('sort-quality');
            const statSortMode = document.getElementById('stat-sort-mode');

            if (mode === 'quality') {
                if (speedCard) speedCard.classList.remove('active');
                if (qualityCard) qualityCard.classList.add('active');
                if (statSortMode) statSortMode.innerText = '4K Quality';
            } else {
                if (speedCard) speedCard.classList.add('active');
                if (qualityCard) qualityCard.classList.remove('active');
                if (statSortMode) statSortMode.innerText = 'Speed First';
            }
        }

        function switchTab(tabId, navElement, shouldScroll = true) {
            if (tabId === 'tab-admin' && !getAdminKey()) {
                showAdminTabs(false);
                promptSecretAdminKey();
                return;
            }
            triggerHaptic('light');
            try {
                sessionStorage.setItem('cb_active_tab', tabId);
            } catch (e) { }
            // Hide all tabs
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active-tab'));

            // Show target tab
            const target = document.getElementById(tabId);
            if (target) target.classList.add('active-tab');

            // Synchronize active states across desktop & mobile navs
            const tabMap = {
                'tab-home': 0,
                'tab-settings': 1,
                'tab-sources': 2,
                'tab-iptv': 3,
                'tab-analytics': 4,
                'tab-admin': 5
            };
            const idx = tabMap[tabId];

            const desktopItems = document.querySelectorAll('.nav-pill-item');
            const mobileItems = document.querySelectorAll('.bottom-nav-bar .nav-item');

            desktopItems.forEach((el, i) => {
                if (i === idx) el.classList.add('active');
                else el.classList.remove('active');
            });

            mobileItems.forEach((el, i) => {
                if (i === idx) el.classList.add('active');
                else el.classList.remove('active');
            });

            // Auto refresh IPTV or Analytics on tab enter
            if (tabId === 'tab-iptv') {
                renderCuratedChannels();
                initM3uPresets();
            } else if (tabId === 'tab-analytics') {
                const card = document.getElementById('analytics-card');
                if (card) card.style.display = 'block';
                syncHealthData();
            } else if (tabId === 'tab-admin') {
                fetchAdminStats();
            }
            if (shouldScroll) {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        function setSortMode(mode) {
            settings.sortBy = mode;
            settings.prioritizeQuality = (mode === 'quality');
            updateSortModeUI(mode);
            onSettingChanged();
        }

        // ==================== CUSTOM GLASS SELECT SYSTEM ====================
        function setDropdownActiveAncestors(w, isActive) {
            if (!w) return;
            let el = w.parentElement;
            while (el && el !== document.body) {
                if (el.classList.contains('tab-content') || el.classList.contains('section-card') || el.classList.contains('section-wrap') || el.classList.contains('setting-item-row') || el.classList.contains('input-bar-group') || el.classList.contains('container') || el.classList.contains('content-wrapper')) {
                    if (isActive) {
                        el.classList.add('has-active-dropdown');
                    } else {
                        el.classList.remove('has-active-dropdown');
                    }
                }
                el = el.parentElement;
            }
        }

        function initCustomSelect(selectEl) {
            if (!selectEl || selectEl.dataset.customized === 'true') return;
            selectEl.dataset.customized = 'true';
            selectEl.style.display = 'none';

            const wrap = document.createElement('div');
            wrap.className = 'custom-select-wrap';
            if (selectEl.id) wrap.id = selectEl.id + '-custom-wrap';

            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'custom-select-trigger';
            trigger.setAttribute('aria-haspopup', 'listbox');
            trigger.setAttribute('aria-expanded', 'false');

            const valSpan = document.createElement('span');
            valSpan.className = 'custom-select-value';

            const arrow = document.createElement('span');
            arrow.className = 'custom-select-arrow';
            arrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

            trigger.appendChild(valSpan);
            trigger.appendChild(arrow);

            const menu = document.createElement('div');
            menu.className = 'custom-select-menu';
            menu.setAttribute('role', 'listbox');

            function syncOptions() {
                menu.innerHTML = '';
                const options = Array.from(selectEl.options);
                const selectedOpt = selectEl.options[selectEl.selectedIndex] || options[0];
                if (selectedOpt) {
                    valSpan.innerHTML = selectedOpt.innerHTML || selectedOpt.text;
                }

                options.forEach(opt => {
                    const item = document.createElement('div');
                    const isSelected = opt.value === selectEl.value;
                    item.className = 'custom-select-option' + (isSelected ? ' selected' : '');
                    item.setAttribute('role', 'option');
                    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
                    item.dataset.value = opt.value;

                    const textSpan = document.createElement('span');
                    textSpan.style.display = 'flex';
                    textSpan.style.alignItems = 'center';
                    textSpan.style.gap = '8px';
                    textSpan.innerHTML = opt.innerHTML || opt.text;

                    const check = document.createElement('span');
                    check.className = 'custom-select-option-check';
                    check.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

                    item.appendChild(textSpan);
                    item.appendChild(check);

                    item.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        triggerHaptic('light');
                        selectEl.value = opt.value;
                        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                        updateDisplay();
                        closeDropdown();
                    });

                    menu.appendChild(item);
                });
            }

            function updateDisplay() {
                const selectedOpt = selectEl.options[selectEl.selectedIndex];
                if (selectedOpt) {
                    valSpan.innerHTML = selectedOpt.innerHTML || selectedOpt.text;
                }
                menu.querySelectorAll('.custom-select-option').forEach(item => {
                    const isSel = item.dataset.value === selectEl.value;
                    item.classList.toggle('selected', isSel);
                    item.setAttribute('aria-selected', isSel ? 'true' : 'false');
                });
            }



            function toggleDropdown(e) {
                e.preventDefault();
                e.stopPropagation();
                triggerHaptic('light');
                const isOpen = wrap.classList.contains('active');
                document.querySelectorAll('.custom-select-wrap.active').forEach(w => {
                    w.classList.remove('active');
                    w.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                    setDropdownActiveAncestors(w, false);
                });
                if (!isOpen) {
                    wrap.classList.add('active');
                    trigger.setAttribute('aria-expanded', 'true');
                    setDropdownActiveAncestors(wrap, true);
                }
            }

            function closeDropdown() {
                wrap.classList.remove('active');
                trigger.setAttribute('aria-expanded', 'false');
                setDropdownActiveAncestors(wrap, false);
            }

            trigger.addEventListener('click', toggleDropdown);

            selectEl.addEventListener('change', () => {
                updateDisplay();
            });

            selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);
            wrap.appendChild(trigger);
            wrap.appendChild(menu);

            syncOptions();
            selectEl._syncCustomSelect = updateDisplay;
            selectEl._rebuildCustomSelect = syncOptions;
        }

        function initAllCustomSelects() {
            const targets = ['debridProvider', 'dohProvider', 'iptvLimit', 'bulkActionTypeSelect'];
            targets.forEach(id => {
                const el = document.getElementById(id);
                if (el) initCustomSelect(el);
            });
        }

        function syncCustomSelects() {
            document.querySelectorAll('select').forEach(sel => {
                if (typeof sel._syncCustomSelect === 'function') {
                    sel._syncCustomSelect();
                }
            });
        }

        // Global click to close custom dropdowns
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.custom-select-wrap')) {
                document.querySelectorAll('.custom-select-wrap.active').forEach(w => {
                    w.classList.remove('active');
                    w.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                    setDropdownActiveAncestors(w, false);
                });
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.custom-select-wrap.active').forEach(w => {
                    w.classList.remove('active');
                    w.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                    setDropdownActiveAncestors(w, false);
                });
            }
        });

        function toggleDohProviderVisibility() {
            const enableDohEl = document.getElementById('enableDoh');
            const dohProviderWrapEl = document.getElementById('doh-provider-wrap');
            if (enableDohEl && dohProviderWrapEl) {
                dohProviderWrapEl.style.display = enableDohEl.checked ? 'flex' : 'none';
            }
        }

        function toggleDebridApiKeyVisibility() {
            const debridProviderEl = document.getElementById('debridProvider');
            const debridContainer = document.getElementById('debrid-input-container');
            if (debridProviderEl && debridContainer) {
                debridContainer.style.display = (debridProviderEl.value === 'none') ? 'none' : 'block';
            }
        }

        function toggleApiKeyVisibility() {
            const keyInput = document.getElementById('debridApiKey');
            const btn = document.getElementById('btn-peek-key');
            if (!keyInput) return;
            if (keyInput.type === 'password') {
                keyInput.type = 'text';
                if (btn) btn.innerText = '🔒';
            } else {
                keyInput.type = 'password';
                if (btn) btn.innerText = '👁️';
            }
        }

        let isInstalled = localStorage.getItem('cb_is_installed') === 'true';

        // Detect if opened from Nuvio / Stremio
        try {
            const _p = window.location.pathname.split('/').filter(Boolean);
            const _q = new URLSearchParams(window.location.search);
            const _r = (document.referrer || '').toLowerCase();
            const _u = (navigator.userAgent || '').toLowerCase();
            if (_r.includes('nuvio') || _r.includes('stremio') ||
                _u.includes('nuvio') || _u.includes('stremio') ||
                _q.has('nuvio') || _q.has('stremio') ||
                _q.get('from') === 'nuvio' || _q.get('source') === 'nuvio' ||
                _q.get('installed') === 'true' || _q.get('installed') === '1' ||
                (_p.length > 0 && (_p[0] === 'c' || (_p.includes('configure') && _p[0] !== 'configure')))) {
                isInstalled = true;
                localStorage.setItem('cb_is_installed', 'true');
            }
        } catch (e) { }

        async function handleSaveAction() {
            triggerHaptic('success');
            await saveConfigurationToServer(true);
            const saveBtn = document.getElementById('save-btn');
            if (saveBtn) saveBtn.classList.remove('unsaved');
        }

        async function handleInstallAction() {
            triggerHaptic('success');
            await saveConfigurationToServer(false);
            installAddon();
            const saveBtn = document.getElementById('save-btn');
            if (saveBtn) saveBtn.classList.remove('unsaved');
        }

        function toggleCatalogsVisibility() {
            const enableCatalogsEl = document.getElementById('enableCatalogs');
            const catalogsSubEl = document.getElementById('catalogs-sub-options');
            if (enableCatalogsEl && catalogsSubEl) {
                catalogsSubEl.style.display = enableCatalogsEl.checked ? 'block' : 'none';
            }
        }

        function onSettingChanged() {
            triggerHaptic('light');
            toggleDohProviderVisibility();
            toggleCatalogsVisibility();
            toggleDebridApiKeyVisibility();
            saveSettingsLocal();
            saveConfigurationToServer(false);
            const saveBtn = document.getElementById('save-btn');
            if (saveBtn) saveBtn.classList.add('unsaved');
            updateStatsBar();
        }

        function saveSettingsLocal() {
            const hideDeadEl = document.getElementById('hideDead');
            const hideSlowEl = document.getElementById('hideSlow');
            const hideCamEl = document.getElementById('hideCam');
            const showSeedersEl = document.getElementById('showSeeders');
            const deduplicateStreamsEl = document.getElementById('deduplicateStreams');
            const cleanTitlesEl = document.getElementById('cleanTitles');
            const showFileSizeEl = document.getElementById('showFileSize');
            const showReleaseGroupEl = document.getElementById('showReleaseGroup');
            const includeOriginalTitleEl = document.getElementById('includeOriginalTitle');
            const vercelEcoModeEl = document.getElementById('vercelEcoMode');
            const renderEcoModeEl = document.getElementById('renderEcoMode');
            const enableDohEl = document.getElementById('enableDoh');
            const dohProviderEl = document.getElementById('dohProvider');
            const debridProviderEl = document.getElementById('debridProvider');
            const debridApiKeyEl = document.getElementById('debridApiKey');
            const enableCatalogsEl = document.getElementById('enableCatalogs');
            const catalogPopularEl = document.getElementById('catalogPopular');
            const catalogTrendingEl = document.getElementById('catalogTrending');
            const catalogIndianEl = document.getElementById('catalogIndian');
            const catalogAnimeEl = document.getElementById('catalogAnime');

            if (hideDeadEl) settings.hideDead = hideDeadEl.checked;
            if (hideSlowEl) settings.hideSlow = hideSlowEl.checked;
            if (hideCamEl) settings.hideCam = hideCamEl.checked;
            const enableQuarantineEl = document.getElementById('enableQuarantine');
            if (enableQuarantineEl) settings.enableQuarantine = enableQuarantineEl.checked;
            if (showSeedersEl) settings.showSeeders = showSeedersEl.checked;
            if (deduplicateStreamsEl) settings.deduplicateStreams = deduplicateStreamsEl.checked;
            if (cleanTitlesEl) settings.cleanTitles = cleanTitlesEl.checked;
            if (showFileSizeEl) settings.showFileSize = showFileSizeEl.checked;
            if (showReleaseGroupEl) settings.showReleaseGroup = showReleaseGroupEl.checked;
            if (includeOriginalTitleEl) settings.includeOriginalTitle = includeOriginalTitleEl.checked;

            let isEcoModeActive = Boolean(settings.vercelEcoMode || settings.renderEcoMode);
            if (renderEcoModeEl) isEcoModeActive = renderEcoModeEl.checked;
            else if (vercelEcoModeEl) isEcoModeActive = vercelEcoModeEl.checked;
            settings.vercelEcoMode = isEcoModeActive;
            settings.renderEcoMode = isEcoModeActive;

            if (enableDohEl) settings.enableDoh = enableDohEl.checked;
            if (dohProviderEl) settings.dohProvider = dohProviderEl.value;
            if (debridProviderEl) settings.debridProvider = debridProviderEl.value;
            if (debridApiKeyEl) settings.debridApiKey = debridApiKeyEl.value;
            if (enableCatalogsEl) settings.enableCatalogs = enableCatalogsEl.checked;
            if (catalogPopularEl) settings.catalogPopular = catalogPopularEl.checked;
            if (catalogTrendingEl) settings.catalogTrending = catalogTrendingEl.checked;
            if (catalogIndianEl) settings.catalogIndian = catalogIndianEl.checked;
            if (catalogAnimeEl) settings.catalogAnime = catalogAnimeEl.checked;

            const enableIptvEl = document.getElementById('enableIptv');
            if (enableIptvEl) settings.enableIptv = enableIptvEl.checked;
            const enableCuratedIptvEl = document.getElementById('enableCuratedIptv');
            if (enableCuratedIptvEl) settings.enableCuratedIptv = enableCuratedIptvEl.checked;
            const customIptvUrlEl = document.getElementById('customIptvUrl');
            if (customIptvUrlEl) settings.customIptvUrl = customIptvUrlEl.value.trim();
            const iptvUserAgentEl = document.getElementById('iptvUserAgent');
            if (iptvUserAgentEl) settings.iptvUserAgent = iptvUserAgentEl.value.trim();
            const iptvEpgUrlEl = document.getElementById('iptvEpgUrl');
            if (iptvEpgUrlEl) settings.iptvEpgUrl = iptvEpgUrlEl.value.trim();
            const iptvLimitEl = document.getElementById('iptvLimit');
            if (iptvLimitEl) settings.iptvLimit = iptvLimitEl.value;
            const xtreamServerEl = document.getElementById('xtreamServer');
            if (xtreamServerEl) settings.xtreamServer = xtreamServerEl.value.trim();
            const xtreamUserEl = document.getElementById('xtreamUser');
            if (xtreamUserEl) settings.xtreamUser = xtreamUserEl.value.trim();
            const xtreamPasswordEl = document.getElementById('xtreamPassword');
            if (xtreamPasswordEl) settings.xtreamPassword = xtreamPasswordEl.value.trim();

            const enableTelegramEl = document.getElementById('enableTelegram');
            if (enableTelegramEl) settings.enableTelegram = enableTelegramEl.checked;
            const telegramBridgeUrlEl = document.getElementById('telegramBridgeUrl');
            if (telegramBridgeUrlEl) {
                const val = telegramBridgeUrlEl.value.trim();
                settings.telegramBridgeUrl = val || 'http://127.0.0.1:8088';
                if (val) localStorage.setItem('cb_telegram_bridge_url', val);
            }

            settings.prioritizeQuality = (settings.sortBy === 'quality');
            settings.preferredLanguages = settings.preferredLanguages || [];
            settings.prioritizeHindi = settings.preferredLanguages.includes('Hindi');
            localStorage.setItem('nuvio_settings', JSON.stringify(settings));
            if (typeof updateTelegramSavedIndicator === 'function') updateTelegramSavedIndicator();
        }

        function updateStatsBar() {
            const statRepoCount = document.getElementById('stat-repo-count');
            const statProviderCount = document.getElementById('stat-provider-count');
            const statFilterStatus = document.getElementById('stat-filter-status');

            if (statRepoCount) statRepoCount.innerText = `${repos.length} Loaded`;
            if (statProviderCount) statProviderCount.innerText = `${allProvidersData.length} Active`;

            if (statFilterStatus) {
                let activeCount = 0;
                if (settings.hideDead) activeCount++;
                if (settings.hideSlow) activeCount++;
                if (settings.hideCam) activeCount++;
                if (settings.enableQuarantine !== false) activeCount++;
                if (settings.deduplicateStreams !== false) activeCount++;
                if (settings.cleanTitles !== false) activeCount++;
                if (settings.renderEcoMode === true || settings.vercelEcoMode === true) activeCount++;
                if (settings.enableDoh !== false) activeCount++;
                if (settings.enableCatalogs !== false) activeCount++;
                if (Boolean(settings.enableTelegram)) activeCount++;
                const langCount = (settings.preferredLanguages || []).length;
                if (langCount > 0) activeCount += langCount;

                if (activeCount >= 3) {
                    statFilterStatus.innerText = 'Shielded';
                } else if (activeCount > 0) {
                    statFilterStatus.innerText = `${activeCount} Active`;
                } else {
                    statFilterStatus.innerText = 'Standard';
                }
            }
        }

        function buildConfigObject() {
            return {
                urls: repos,
                hideDead: settings.hideDead,
                hideSlow: settings.hideSlow,
                hideCam: settings.hideCam,
                enableQuarantine: settings.enableQuarantine !== false,
                showSeeders: settings.showSeeders !== false,
                deduplicateStreams: settings.deduplicateStreams !== false,
                cleanTitles: settings.cleanTitles !== false,
                showFileSize: settings.showFileSize !== false,
                showReleaseGroup: settings.showReleaseGroup !== false,
                includeOriginalTitle: settings.includeOriginalTitle !== false,
                renderEcoMode: Boolean(settings.renderEcoMode || settings.vercelEcoMode),
                vercelEcoMode: Boolean(settings.vercelEcoMode || settings.renderEcoMode),
                enableDoh: settings.enableDoh !== false,
                dohProvider: settings.dohProvider || 'cloudflare',
                debridProvider: settings.debridProvider || 'none',
                debridApiKey: settings.debridApiKey || '',
                enableCatalogs: settings.enableCatalogs !== false,
                catalogPopular: settings.catalogPopular !== false,
                catalogTrending: settings.catalogTrending !== false,
                catalogIndian: settings.catalogIndian !== false,
                catalogAnime: settings.catalogAnime !== false,
                enableIptv: Boolean(settings.enableIptv),
                enableCuratedIptv: Boolean(settings.enableCuratedIptv),
                customIptvUrl: settings.customIptvUrl || '',
                iptvUserAgent: settings.iptvUserAgent || '',
                iptvEpgUrl: settings.iptvEpgUrl || '',
                iptvLimit: settings.iptvLimit || '0',
                xtreamServer: settings.xtreamServer || '',
                xtreamUser: settings.xtreamUser || '',
                xtreamPassword: settings.xtreamPassword || '',
                enableTelegram: Boolean(settings.enableTelegram),
                telegramBridgeUrl: settings.telegramBridgeUrl || 'http://127.0.0.1:8088',
                sortBy: settings.sortBy || 'speed',
                sortMode: settings.sortBy || 'speed',
                prioritizeQuality: settings.sortBy === 'quality',
                prioritizeHindi: settings.prioritizeHindi,
                preferredLanguages: settings.preferredLanguages || [],
                disabled: settings.disabledProviders || [],
                scraperOverrides: settings.scraperOverrides || {}
            };
        }

        async function saveConfigurationToServer(showToastMsg = false) {
            saveSettingsLocal();
            const configObj = buildConfigObject();
            const activeToken = encodeConfigToken(configObj);
            const isBase64Token = (id) => typeof id === 'string' && id.length > 32 && !id.startsWith('enc_');
            const targetId = (!configId || isBase64Token(configId)) ? activeToken : configId;
            const oldToken = configId; // Preserve original URL config ID to update it on the server
            configId = targetId;
            try { localStorage.setItem('cb_config_id', targetId); } catch (_) { }

            try {
                const res = await fetch('/api/config/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ configId: targetId, token: activeToken, config: configObj, oldToken: oldToken })
                });
                const data = await res.json();
                if (data.debug) console.error('!!! VERCEL DEBUG !!!', data.debug);
                if (data.success) {
                    if (data.configId) {
                        // Only update URL if configId actually changed (keeps install link stable)
                        const idChanged = data.configId !== configId;
                        configId = data.configId;
                        localStorage.setItem('cb_config_id', configId);
                        if (idChanged) {
                            window.history.replaceState(null, '', '/c/' + configId + '/configure');
                        }
                    }
                    const saveBtn = document.getElementById('save-btn');
                    if (saveBtn) saveBtn.classList.remove('unsaved');

                    showSyncBadge(`ID: ${configId}`);

                    if (showToastMsg) {
                        showToast("✨ <b>Settings Saved & Cloud Synced!</b>");
                        const text = document.getElementById('save-btn-text');
                        const icon = document.getElementById('save-btn-icon');
                        if (text && icon) {
                            text.innerText = 'Saved!';
                            icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                            setTimeout(() => {
                                text.innerText = 'Save';
                                icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
                            }, 1800);
                        }
                    }
                }
            } catch (err) {
                console.error('Save error', err);
                if (showToastMsg) {
                    showToast("❌ <b>Error:</b> Could not save settings.");
                }
            }
        }

        let latestTelemetryData = null;

        let activeAdminCloudPlatform = 'render';
        window._hasUserSwitchedCloudTab = false;

        function switchAdminCloudTab(platform) {
            activeAdminCloudPlatform = platform;
            const renderPanel = document.getElementById('admin-cloud-render-panel');
            const vercelPanel = document.getElementById('admin-cloud-vercel-panel');

            if (platform === 'render') {
                if (renderPanel) renderPanel.style.display = 'flex';
                if (vercelPanel) vercelPanel.style.display = 'none';
            } else {
                if (renderPanel) renderPanel.style.display = 'none';
                if (vercelPanel) vercelPanel.style.display = 'flex';
            }
        }

        function updateAdminView(data) {
            if (data) latestTelemetryData = data;
            const d = latestTelemetryData || {};

            // Check if server-provided eco mode is present in telemetry data
            const serverEco = (d.globalEcoMode !== undefined)
                ? d.globalEcoMode
                : (d.globalSettings && d.globalSettings.globalEcoMode !== undefined ? d.globalSettings.globalEcoMode : undefined);
            if (serverEco !== undefined) {
                const sEcoBool = Boolean(serverEco !== false);
                settings.renderEcoMode = sEcoBool;
                settings.vercelEcoMode = sEcoBool;
                try { localStorage.setItem('nuvio_settings', JSON.stringify(settings)); } catch (_) { }
            }
            const isEco = Boolean(settings.renderEcoMode || settings.vercelEcoMode);

            // Sync admin eco toggles in UI
            const rEcoEl = document.getElementById('renderEcoMode');
            const vEcoEl = document.getElementById('vercelEcoMode');
            if (rEcoEl) rEcoEl.checked = isEco;
            if (vEcoEl) vEcoEl.checked = isEco;

            // Host Platform Detection & Auto-Switch (Dynamic — show only detected platform)
            const detectedPlatform = d.platform || (d.isRender ? 'render' : (d.isVercel ? 'vercel' : 'render'));
            const hostBadge = document.getElementById('cloud-host-badge');
            const hostIcon = document.getElementById('cloud-host-icon');
            const hostTitle = document.getElementById('cloud-host-title');
            const hostSub = document.getElementById('cloud-host-subtitle');
            const activePill = document.getElementById('cloud-host-active-pill');
            const renderPanel = document.getElementById('admin-cloud-render-panel');
            const vercelPanel = document.getElementById('admin-cloud-vercel-panel');

            if (detectedPlatform === 'render') {
                const region = d.renderRegion || 'oregon';
                if (hostIcon) { hostIcon.innerText = '🟣'; hostIcon.style.background = 'rgba(168, 85, 247, 0.15)'; hostIcon.style.borderColor = 'rgba(168, 85, 247, 0.3)'; }
                if (hostTitle) hostTitle.innerText = 'Render Web Service';
                if (hostSub) hostSub.innerText = `Region: ${region} · Free Tier · Always-On`;
                if (hostBadge) {
                    hostBadge.innerText = `🟣 ${region}`;
                    hostBadge.style.background = 'rgba(168, 85, 247, 0.15)';
                    hostBadge.style.borderColor = 'rgba(168, 85, 247, 0.35)';
                    hostBadge.style.color = '#d8b4fe';
                }
                if (activePill) activePill.style.display = 'inline-block';
                if (renderPanel) renderPanel.style.display = 'flex';
                if (vercelPanel) vercelPanel.style.display = 'none';
                activeAdminCloudPlatform = 'render';
            } else if (detectedPlatform === 'vercel') {
                const region = d.vercelRegion || 'iad1';
                if (hostIcon) { hostIcon.innerText = '▲'; hostIcon.style.background = 'rgba(56, 189, 248, 0.15)'; hostIcon.style.borderColor = 'rgba(56, 189, 248, 0.3)'; }
                if (hostTitle) hostTitle.innerText = 'Vercel Serverless';
                if (hostSub) hostSub.innerText = `Region: ${region} · Edge Network · Serverless Functions`;
                if (hostBadge) {
                    hostBadge.innerText = `▲ ${region}`;
                    hostBadge.style.background = 'rgba(56, 189, 248, 0.15)';
                    hostBadge.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                    hostBadge.style.color = '#38bdf8';
                }
                if (activePill) activePill.style.display = 'inline-block';
                if (renderPanel) renderPanel.style.display = 'none';
                if (vercelPanel) vercelPanel.style.display = 'flex';
                activeAdminCloudPlatform = 'vercel';
            } else {
                const nodeVer = d.nodeVersion || 'v18+';
                if (hostIcon) { hostIcon.innerText = '💻'; hostIcon.style.background = 'rgba(148, 163, 184, 0.12)'; hostIcon.style.borderColor = 'rgba(148, 163, 184, 0.25)'; }
                if (hostTitle) hostTitle.innerText = 'Node.js Local';
                if (hostSub) hostSub.innerText = `Runtime: ${nodeVer} · Development Mode`;
                if (hostBadge) {
                    hostBadge.innerText = `💻 ${nodeVer}`;
                    hostBadge.style.background = 'rgba(148, 163, 184, 0.12)';
                    hostBadge.style.borderColor = 'rgba(148, 163, 184, 0.25)';
                    hostBadge.style.color = 'var(--text-muted)';
                }
                if (activePill) activePill.style.display = 'inline-block';
                // Fallback: show render panel for local/node
                if (renderPanel) renderPanel.style.display = 'flex';
                if (vercelPanel) vercelPanel.style.display = 'none';
                activeAdminCloudPlatform = 'render';
            }

            // ==================== RENDER PANEL METRICS ====================
            const renderBadge = document.getElementById('admin-render-badge');
            if (renderBadge) {
                if (isEco) {
                    renderBadge.innerText = '🟢 Universal Eco: Active (All Users)';
                    renderBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                    renderBadge.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                    renderBadge.style.color = 'var(--text-success)';
                } else {
                    renderBadge.innerText = '⚪ Universal Eco: Disabled';
                    renderBadge.style.background = 'rgba(148, 163, 184, 0.12)';
                    renderBadge.style.borderColor = 'rgba(148, 163, 184, 0.25)';
                    renderBadge.style.color = 'var(--text-muted)';
                }
            }

            const rRamVal = document.getElementById('render-matrix-ram-val');
            const rRamSub = document.getElementById('render-matrix-ram-sub');
            const rCpuVal = document.getElementById('render-matrix-cpu-val');
            const rCpuSub = document.getElementById('render-matrix-cpu-sub');
            const rPingVal = document.getElementById('render-matrix-ping-val');
            const rPingSub = document.getElementById('render-matrix-ping-sub');

            const memMB = d.memoryMB || 48;
            const heapMB = d.heapUsedMB || 32;
            const freeHeadroom = Math.max(0, 512 - memMB);
            const isHeartbeatOn = d.renderKeepAlive !== false;

            if (rRamVal) rRamVal.innerText = `${memMB} MB`;
            if (rRamSub) rRamSub.innerText = `${freeHeadroom} MB Headroom`;
            if (rCpuVal) rCpuVal.innerText = isEco ? '~98.4% Free' : '~78.2% Free';
            if (rCpuSub) rCpuSub.innerText = isEco ? 'Instant Speed Heuristics' : 'Parallel Probing';
            if (rPingVal) rPingVal.innerText = isHeartbeatOn ? '13m Active' : 'Off (Sleeps 15m)';
            if (rPingSub) rPingSub.innerText = isHeartbeatOn ? 'Zero Cold Starts' : 'Cold Start ~50s';

            // Render 512MB RAM Progress Meter
            const gRenderHeadline = document.getElementById('gauge-render-mem-headline');
            const gRenderBar = document.getElementById('gauge-render-mem-bar');
            const gRenderBuffer = document.getElementById('gauge-render-mem-buffer');
            const gRenderRss = document.getElementById('gauge-render-rss-txt');
            const gRenderHeap = document.getElementById('gauge-render-heap-txt');
            const gRenderBufTxt = document.getElementById('gauge-render-buffer-txt');

            const memPct = Math.min(100, Math.max(5, Math.round((memMB / 512) * 100)));
            if (gRenderHeadline) gRenderHeadline.innerText = `🧠 Memory RSS: ~${memMB} MB / 512 MB`;
            if (gRenderBar) {
                gRenderBar.style.width = `${memPct}%`;
                gRenderBar.style.background = memMB > 360 ? 'linear-gradient(90deg, #f59e0b, #ef4444)' : 'linear-gradient(90deg, #10b981, #8b5cf6)';
            }
            if (gRenderBuffer) gRenderBuffer.style.width = `${100 - memPct}%`;
            if (gRenderRss) gRenderRss.innerText = `📊 RSS: ~${memMB} MB`;
            if (gRenderHeap) gRenderHeap.innerText = `💾 Heap: ~${heapMB} MB`;
            if (gRenderBufTxt) {
                gRenderBufTxt.innerText = `🟢 ${freeHeadroom} MB Safe Headroom`;
                gRenderBufTxt.style.color = freeHeadroom > 150 ? 'var(--text-success)' : '#facc15';
            }

            // Render Keep-Alive Heartbeat Toggle
            const kaToggle = document.getElementById('renderKeepAliveToggle');
            const kaTxt = document.getElementById('render-keepalive-txt');
            const kaTarget = document.getElementById('render-keepalive-target');
            if (kaToggle) kaToggle.checked = isHeartbeatOn;
            if (kaTxt) kaTxt.innerText = isHeartbeatOn ? '💓 Heartbeat On' : '⚪ Heartbeat Off';
            if (kaTarget && d.renderKeepAlive) {
                const pingUrl = d.renderKeepAlive.targetUrl || 'http://127.0.0.1:7000/health';
                const statusStr = d.renderKeepAlive.status || 'active';
                kaTarget.innerText = `🎯 Target: ${pingUrl} (${statusStr})`;
            }

            // Official Render API Status
            const rApiBadge = document.getElementById('render-api-status-badge');
            const rInputBox = document.getElementById('render-token-input-box');
            const rConnectedBox = document.getElementById('render-token-connected-box');
            const rConnectedName = document.getElementById('render-connected-account-name');
            const rErrorMsg = document.getElementById('render-token-error-msg');

            const oRender = d.officialRender;
            const isRenderConnected = Boolean(oRender && oRender.connected === true);
            const renderError = (oRender && oRender.connected === false && oRender.error) ? oRender.error : null;

            if (isRenderConnected) {
                const sName = oRender?.serviceName || oRender?.ownerName || 'Render Service';
                if (rApiBadge) {
                    rApiBadge.innerText = `🟢 Connected to ${sName} (Live Sync)`;
                    rApiBadge.style.background = 'rgba(168, 85, 247, 0.15)';
                    rApiBadge.style.borderColor = 'rgba(168, 85, 247, 0.35)';
                    rApiBadge.style.color = '#d8b4fe';
                }
                if (rInputBox) rInputBox.style.display = 'none';
                if (rConnectedBox) rConnectedBox.style.display = 'flex';
                if (rConnectedName) rConnectedName.innerText = `Connected: ${sName} • Live Sync Active`;
                if (rErrorMsg) { rErrorMsg.style.display = 'none'; rErrorMsg.innerText = ''; }
            } else if (renderError) {
                if (rApiBadge) {
                    rApiBadge.innerText = '🔴 Render Sync Error';
                    rApiBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                    rApiBadge.style.borderColor = 'rgba(239, 68, 68, 0.35)';
                    rApiBadge.style.color = '#f87171';
                }
                if (rInputBox) rInputBox.style.display = 'flex';
                if (rConnectedBox) rConnectedBox.style.display = 'none';
                if (rErrorMsg) {
                    rErrorMsg.style.display = 'block';
                    rErrorMsg.innerText = `⚠️ Sync Error: ${renderError}`;
                }
            } else {
                if (rApiBadge) {
                    rApiBadge.innerText = '⚪ Built-In Server Profiler';
                    rApiBadge.style.background = 'rgba(148, 163, 184, 0.12)';
                    rApiBadge.style.borderColor = 'rgba(148, 163, 184, 0.25)';
                    rApiBadge.style.color = 'var(--text-muted)';
                }
                if (rInputBox) rInputBox.style.display = 'flex';
                if (rConnectedBox) rConnectedBox.style.display = 'none';
                if (rErrorMsg) { rErrorMsg.style.display = 'none'; rErrorMsg.innerText = ''; }
            }

            // ==================== VERCEL PANEL METRICS ====================
            const badge = document.getElementById('admin-vercel-badge');
            if (badge) {
                if (isEco) {
                    badge.innerText = '🟢 Universal Eco: Active (All Users)';
                    badge.style.background = 'rgba(16, 185, 129, 0.15)';
                    badge.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                    badge.style.color = 'var(--text-success)';
                } else {
                    badge.innerText = '⚪ Universal Eco: Disabled';
                    badge.style.background = 'rgba(148, 163, 184, 0.12)';
                    badge.style.borderColor = 'rgba(148, 163, 184, 0.25)';
                    badge.style.color = 'var(--text-muted)';
                }
            }

            // 1. Efficiency Matrix
            const cpuValEl = document.getElementById('telemetry-cpu-saved');
            const cpuSubEl = document.getElementById('telemetry-cpu-saved-sub');
            const latValEl = document.getElementById('telemetry-latency-val');
            const latSubEl = document.getElementById('telemetry-latency-sub');
            const cdnValEl = document.getElementById('telemetry-cdn-val');
            const cdnSubEl = document.getElementById('telemetry-cdn-sub');

            if (cpuValEl) cpuValEl.innerText = isEco ? '~96.4%' : '~64.8%';
            if (cpuSubEl) cpuSubEl.innerText = isEco ? '~4.0s ➔ ~0.05s' : '~5.5s ➔ ~0.35s';
            if (latValEl) latValEl.innerText = isEco ? '< 15ms' : '< 280ms';
            if (latSubEl) latSubEl.innerText = isEco ? 'Instant Heuristics' : 'Parallel Probed';
            if (cdnValEl) cdnValEl.innerText = d.cdnHitRatio !== undefined ? `~${d.cdnHitRatio}%` : '~85%';
            if (cdnSubEl) cdnSubEl.innerText = d.cacheHits !== undefined ? `${d.cacheHits} Cache Hits` : '0ms Compute';

            // 2. 10-Second Function Timeout Safety Gauge
            const execHeadline = document.getElementById('gauge-exec-headline');
            const execBar = document.getElementById('gauge-exec-bar');
            const bufferBar = document.getElementById('gauge-buffer-bar');
            const scrapeTxt = document.getElementById('gauge-scraping-txt');
            const sortTxt = document.getElementById('gauge-sorting-txt');
            const bufferTxt = document.getElementById('gauge-buffer-txt');

            const lastScrapeMs = d.lastScrapeMs || (isEco ? 1800 : 2100);
            const lastSortMs = isEco ? 8 : (d.lastSortMs || 20);
            const lastTotalMs = lastScrapeMs + lastSortMs;
            const lastTotalSec = (lastTotalMs / 1000).toFixed(2);
            const lastScrapeSec = (lastScrapeMs / 1000).toFixed(2);
            const lastSortSec = (lastSortMs / 1000).toFixed(2);
            const bufferSec = Math.max(0, 10.0 - (lastTotalMs / 1000)).toFixed(2);
            const pct = Math.min(95, Math.max(5, Math.round((lastTotalMs / 10000) * 100)));

            if (execHeadline) execHeadline.innerText = `⏱️ Execution: ~${lastTotalSec}s`;
            if (execBar) execBar.style.width = `${pct}%`;
            if (bufferBar) bufferBar.style.width = `${100 - pct}%`;
            if (scrapeTxt) scrapeTxt.innerText = `📦 Scraping: ~${lastScrapeSec}s`;
            if (sortTxt) sortTxt.innerText = isEco ? `⚡ Sorting: ~${lastSortSec}s (Eco)` : `⚡ Sorting: ~${lastSortSec}s (Probed)`;
            if (bufferTxt) {
                bufferTxt.innerText = `🟢 ${bufferSec}s Buffer`;
                bufferTxt.style.color = bufferSec > 5.0 ? 'var(--text-success)' : (bufferSec > 2.0 ? '#facc15' : '#f87171');
            }

            // 3. Vercel Monthly Budget
            const budgetCpu = document.getElementById('budget-cpu-val');
            const budgetCpuSub = document.getElementById('budget-cpu-sub');
            const budgetCpuBar = document.getElementById('budget-cpu-bar');
            const budgetCpuHeadroom = document.getElementById('budget-cpu-headroom');

            const budgetInvocations = document.getElementById('budget-invocations-val');
            const budgetInvocationsSub = document.getElementById('budget-invocations-sub');
            const budgetInvocationsBar = document.getElementById('budget-invocations-bar');
            const budgetInvocationsHeadroom = document.getElementById('budget-invocations-headroom');

            const budgetBandwidth = document.getElementById('budget-bandwidth-val');
            const budgetBandwidthSub = document.getElementById('budget-bandwidth-sub');
            const budgetBandwidthBar = document.getElementById('budget-bandwidth-bar');
            const budgetBandwidthHeadroom = document.getElementById('budget-bandwidth-headroom');

            const budgetSyncBadge = document.getElementById('budget-sync-badge');
            const budgetCycleSub = document.getElementById('budget-cycle-sub');
            const budgetInstInvs = document.getElementById('budget-instance-invocations');
            const budgetInstCpu = document.getElementById('budget-instance-cpu');

            const ov = d.officialVercel;
            const isOfficial = Boolean(ov && ov.connected);

            const fluidCpuUsed = isOfficial ? (ov.fluidCpuHours || 0) : (d.fluidCpuUsedHours || 0);
            const invocationsUsed = isOfficial ? (ov.totalInvocations || 0) : (d.serverlessInvocations || 0);
            const bandwidthUsed = isOfficial ? (ov.bandwidthUsedGB || 0) : (d.bandwidthUsedGB || 0);

            // Sync Badge in Header
            if (budgetSyncBadge) {
                if (isOfficial) {
                    const uname = ov.username || 'Vercel User';
                    const pName = ov.project?.name || null;
                    budgetSyncBadge.title = `Connected to @${uname}${pName ? ' • Project: ' + pName : ''}`;
                    budgetSyncBadge.innerHTML = `<span style="display:inline-block; width:6px; height:6px; background:var(--text-success); border-radius:50%; margin-right:4px; flex-shrink:0;"></span><span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">Synced: @${uname}</span>`;
                    budgetSyncBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                    budgetSyncBadge.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                    budgetSyncBadge.style.color = 'var(--text-success)';
                } else {
                    budgetSyncBadge.innerText = '⚪ Local Profiler';
                    budgetSyncBadge.title = 'Built-in Local Profiler';
                    budgetSyncBadge.style.background = 'rgba(148, 163, 184, 0.12)';
                    budgetSyncBadge.style.borderColor = 'rgba(148, 163, 184, 0.25)';
                    budgetSyncBadge.style.color = 'var(--text-muted)';
                }
            }

            // 1. Fluid CPU Budget (4.0 Hours Max)
            const cpuLimit = 4.0;
            const cpuPct = Math.min(100, Math.max(0, (fluidCpuUsed / cpuLimit) * 100));
            const freeCpu = Math.max(0, cpuLimit - fluidCpuUsed);
            const freeCpuPct = ((freeCpu / cpuLimit) * 100).toFixed(1);

            if (budgetCpu) {
                budgetCpu.innerText = `${fluidCpuUsed.toFixed(2)}h / ${cpuLimit.toFixed(1)}h (${cpuPct.toFixed(1)}%)`;
                budgetCpu.style.color = cpuPct > 85 ? '#f87171' : (cpuPct > 65 ? '#facc15' : 'var(--text-success)');
                budgetCpu.style.background = cpuPct > 85 ? 'rgba(239, 68, 68, 0.15)' : (cpuPct > 65 ? 'rgba(250, 204, 21, 0.15)' : 'rgba(16, 185, 129, 0.12)');
            }
            if (budgetCpuBar) {
                budgetCpuBar.style.width = `${Math.max(cpuPct, fluidCpuUsed > 0 ? 1.5 : 0)}%`;
                budgetCpuBar.style.background = cpuPct > 85
                    ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                    : (cpuPct > 65 ? 'linear-gradient(90deg, #f59e0b, #facc15)' : 'linear-gradient(90deg, #10b981, var(--text-success))');
            }
            if (budgetCpuSub) {
                if (isOfficial) {
                    budgetCpuSub.innerText = `Official Account CPU: ${fluidCpuUsed.toFixed(2)}h / 4.0h used (Monthly Billing Cycle)`;
                } else if (d.isVercel !== undefined) {
                    budgetCpuSub.innerText = d.isVercel ? `Region: ${d.vercelRegion || 'iad1'} • Fluid Active Compute` : `Environment: ${d.vercelRegion || 'Local Node'} • 4.0h Free`;
                }
            }
            if (budgetCpuHeadroom) {
                budgetCpuHeadroom.innerText = `🟢 ${freeCpu.toFixed(2)}h (${freeCpuPct}%) Free Headroom`;
            }

            // 2. Serverless Invocations (1,000,000 Max)
            const invLimit = 1000000;
            const invPct = Math.min(100, Math.max(0, (invocationsUsed / invLimit) * 100));
            const remCalls = Math.max(0, invLimit - invocationsUsed);
            const remCallsPct = ((remCalls / invLimit) * 100).toFixed(1);

            if (budgetInvocations) {
                budgetInvocations.innerText = `${invocationsUsed.toLocaleString()} / 1M Calls (${invPct.toFixed(1)}%)`;
                budgetInvocations.style.color = invPct > 85 ? '#f87171' : (invPct > 65 ? '#facc15' : '#38bdf8');
                budgetInvocations.style.background = invPct > 85 ? 'rgba(239, 68, 68, 0.15)' : (invPct > 65 ? 'rgba(250, 204, 21, 0.15)' : 'rgba(56, 189, 248, 0.12)');
            }
            if (budgetInvocationsBar) {
                budgetInvocationsBar.style.width = `${Math.max(invPct, invocationsUsed > 0 ? 1.5 : 0)}%`;
                budgetInvocationsBar.style.background = invPct > 85
                    ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                    : (invPct > 65 ? 'linear-gradient(90deg, #f59e0b, #facc15)' : 'linear-gradient(90deg, #0284c7, #38bdf8)');
            }
            if (budgetInvocationsSub) {
                const offInv = (ov && ov.officialInvocations !== undefined) ? ov.officialInvocations : invocationsUsed;
                budgetInvocationsSub.innerText = isOfficial
                    ? `Official Vercel Account: ${offInv.toLocaleString()} calls recorded on Vercel`
                    : `Estimated Invocations: ${invocationsUsed.toLocaleString()} / 1,000,000 calls`;
            }
            if (budgetInvocationsHeadroom) {
                budgetInvocationsHeadroom.innerText = `🟢 ${remCalls.toLocaleString()} (${remCallsPct}%) Available`;
            }

            // 3. Edge Network Bandwidth (100 GB Max)
            const bwLimit = 100.0;
            const bwPct = Math.min(100, Math.max(0, (bandwidthUsed / bwLimit) * 100));
            const remBw = Math.max(0, bwLimit - bandwidthUsed);
            const remBwPct = ((remBw / bwLimit) * 100).toFixed(1);

            if (budgetBandwidth) {
                budgetBandwidth.innerText = `${bandwidthUsed.toFixed(2)} GB / 100 GB (${bwPct.toFixed(1)}%)`;
                budgetBandwidth.style.color = bwPct > 85 ? '#f87171' : (bwPct > 65 ? '#facc15' : '#c084fc');
                budgetBandwidth.style.background = bwPct > 85 ? 'rgba(239, 68, 68, 0.15)' : (bwPct > 65 ? 'rgba(250, 204, 21, 0.15)' : 'rgba(192, 132, 252, 0.12)');
            }
            if (budgetBandwidthBar) {
                budgetBandwidthBar.style.width = `${Math.max(bwPct, bandwidthUsed > 0 ? 1.5 : 0)}%`;
                budgetBandwidthBar.style.background = bwPct > 85
                    ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                    : (bwPct > 65 ? 'linear-gradient(90deg, #f59e0b, #facc15)' : 'linear-gradient(90deg, #9333ea, #c084fc)');
            }
            if (budgetBandwidthSub) {
                budgetBandwidthSub.innerText = isOfficial
                    ? `Official Vercel Account: ${bandwidthUsed.toFixed(2)} GB fast worldwide CDN used`
                    : `100 GB Fast Worldwide CDN Bandwidth`;
            }
            if (budgetBandwidthHeadroom) {
                budgetBandwidthHeadroom.innerText = `🟢 ${remBw.toFixed(2)} GB (${remBwPct}%) Free`;
            }

            // 4. Footer info strip
            if (budgetCycleSub) {
                if (ov && ov.billingCycle && ov.billingCycle.daysRemaining) {
                    budgetCycleSub.innerHTML = `<span>📅</span> Monthly Billing Cycle • Resets in <b>${ov.billingCycle.daysRemaining} days</b>`;
                } else {
                    budgetCycleSub.innerHTML = `<span>📅</span> Monthly Billing Cycle (Resets on 1st)`;
                }
            }
            if (budgetInstInvs) {
                budgetInstInvs.innerText = `${(d.serverlessInvocations || 0).toLocaleString()} calls`;
            }
            if (budgetInstCpu) {
                budgetInstCpu.innerText = `~${(d.fluidCpuUsedHours || 0).toFixed(3)}h CPU`;
            }

            // 4. Official Vercel REST API Live Status
            const apiBadge = document.getElementById('vercel-api-status-badge');
            const inputBox = document.getElementById('vercel-token-input-box');
            const connectedBox = document.getElementById('vercel-token-connected-box');
            const connectedName = document.getElementById('vercel-connected-account-name');
            const vErrorMsg = document.getElementById('vercel-token-error-msg');

            const isConnected = Boolean(ov && ov.connected === true);
            const vercelError = (ov && ov.connected === false && ov.error) ? ov.error : null;

            if (isConnected) {
                const username = ov?.username || 'Vercel User';
                const projName = ov?.project?.name || null;
                const projUrl = ov?.project?.url || null;
                const projState = ov?.project?.state || null;
                const apiScope = ov?.apiScope || 'Live Sync';
                const teamStr = (ov?.teams && ov.teams.length > 0) ? ` • Teams: ${ov.teams.join(', ')}` : '';
                if (apiBadge) {
                    apiBadge.innerText = `🟢 Connected: @${username} (${apiScope})`;
                    apiBadge.style.background = 'rgba(16, 185, 129, 0.15)';
                    apiBadge.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                    apiBadge.style.color = 'var(--text-success)';
                }
                if (inputBox) inputBox.style.display = 'none';
                if (connectedBox) connectedBox.style.display = 'flex';
                if (connectedName) {
                    let desc = `Connected to @${username}${teamStr} • ${apiScope}`;
                    if (projName) {
                        desc += ` • Project: ${projName}`;
                        if (projState) desc += ` (${projState})`;
                    }
                    connectedName.innerText = desc;
                }
                if (vErrorMsg) { vErrorMsg.style.display = 'none'; vErrorMsg.innerText = ''; }
            } else if (vercelError) {
                if (apiBadge) {
                    apiBadge.innerText = '🔴 Vercel Sync Error';
                    apiBadge.style.background = 'rgba(239, 68, 68, 0.15)';
                    apiBadge.style.borderColor = 'rgba(239, 68, 68, 0.35)';
                    apiBadge.style.color = '#f87171';
                }
                if (inputBox) inputBox.style.display = 'flex';
                if (connectedBox) connectedBox.style.display = 'none';
                if (vErrorMsg) {
                    vErrorMsg.style.display = 'block';
                    vErrorMsg.innerText = `⚠️ Sync Error: ${vercelError}`;
                }
            } else {
                if (apiBadge) {
                    apiBadge.innerText = '⚪ Built-In Serverless Profiler';
                    apiBadge.style.background = 'rgba(148, 163, 184, 0.12)';
                    apiBadge.style.borderColor = 'rgba(148, 163, 184, 0.25)';
                    apiBadge.style.color = 'var(--text-muted)';
                }
                if (inputBox) inputBox.style.display = 'flex';
                if (connectedBox) connectedBox.style.display = 'none';
                if (vErrorMsg) { vErrorMsg.style.display = 'none'; vErrorMsg.innerText = ''; }
            }
        }

        function showRenderTokenInput() {
            const inputBox = document.getElementById('render-token-input-box');
            const connectedBox = document.getElementById('render-token-connected-box');
            if (inputBox) inputBox.style.display = 'flex';
            if (connectedBox) connectedBox.style.display = 'none';
        }

        async function disconnectRenderApiKey() {
            triggerHaptic('heavy');
            localStorage.removeItem('cb_render_api_key');
            const adminKey = getAdminKey();
            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-key': adminKey,
                        'x-diagnostic-token': adminKey
                    },
                    body: JSON.stringify({ renderApiKey: '' })
                });
                const data = await res.json();
                if (data && data.success) {
                    showToast("⚪ <b>Disconnected:</b> Switched back to internal Render profiler.");
                    triggerHaptic('success');
                    fetchAdminStats();
                } else {
                    showToast("❌ <b>Error:</b> Could not disconnect Render API key.");
                }
            } catch (e) {
                console.error('Failed to disconnect Render key', e);
            }
        }

        function toggleRenderTokenVisibility() {
            const input = document.getElementById('adminRenderApiKey');
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
        }

        async function saveRenderApiKey() {
            triggerHaptic('medium');
            const input = document.getElementById('adminRenderApiKey');
            const connectBtn = document.getElementById('btn-connect-render-key');
            const errorDiv = document.getElementById('render-token-error-msg');
            const keyVal = input ? input.value.trim() : '';
            if (!keyVal) {
                showToast("⚠️ <b>Key Empty:</b> Please paste your Render API Key (rnd_...).");
                return;
            }
            const clean = keyVal.replace(/^Bearer\s+/i, '').trim();
            const originalBtnHtml = connectBtn ? connectBtn.innerHTML : '<span>💾</span> Connect Key';
            if (connectBtn) {
                connectBtn.disabled = true;
                connectBtn.innerHTML = '<span>⏳</span> Verifying...';
            }
            if (errorDiv) { errorDiv.style.display = 'none'; errorDiv.innerText = ''; }
            const adminKey = getAdminKey();
            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-key': adminKey,
                        'x-diagnostic-token': adminKey
                    },
                    body: JSON.stringify({ renderApiKey: clean })
                });
                const data = await res.json();
                if (data && data.success) {
                    localStorage.setItem('cb_render_api_key', clean);
                    showToast("✅ <b>Render API Connected:</b> Live official service sync active!");
                    triggerHaptic('success');
                    if (input) input.value = '';
                    fetchAdminStats(true);
                } else {
                    const errTxt = data?.error || 'Invalid Render API Key.';
                    if (errorDiv) {
                        errorDiv.style.display = 'block';
                        errorDiv.innerText = `❌ ${errTxt}`;
                    }
                    showToast(`❌ <b>Verification Failed:</b> ${errTxt}`);
                    triggerHaptic('error');
                }
            } catch (e) {
                console.error('Failed to save Render API key', e);
                showToast("❌ <b>Network Error:</b> Failed to connect to server.");
            } finally {
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.innerHTML = originalBtnHtml;
                }
            }
        }

        async function handleRenderKeepAliveToggle(isEnabled) {
            triggerHaptic('medium');
            const kaTxt = document.getElementById('render-keepalive-txt');
            if (kaTxt) kaTxt.innerText = isEnabled ? '💓 Heartbeat On' : '⚪ Heartbeat Off';
            const token = getAdminKey();
            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-key': token,
                        'x-diagnostic-token': token
                    },
                    body: JSON.stringify({ renderKeepAlive: isEnabled })
                });
                const data = await res.json();
                if (data && data.success) {
                    showToast(`💓 <b>Render Keep-Alive:</b> ${isEnabled ? 'ENABLED (13m ping)' : 'DISABLED (Sleeps after 15m)'}`);
                    triggerHaptic('success');
                }
            } catch (e) {
                console.error('Failed to sync render keep-alive to server', e);
            }
        }

        function showVercelTokenInput() {
            const inputBox = document.getElementById('vercel-token-input-box');
            const connectedBox = document.getElementById('vercel-token-connected-box');
            if (inputBox) inputBox.style.display = 'flex';
            if (connectedBox) connectedBox.style.display = 'none';
        }

        async function disconnectVercelToken() {
            triggerHaptic('heavy');
            localStorage.removeItem('cb_vercel_api_token');
            const adminKey = getAdminKey();
            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-key': adminKey,
                        'x-diagnostic-token': adminKey
                    },
                    body: JSON.stringify({ vercelApiToken: '' })
                });
                const data = await res.json();
                if (data && data.success) {
                    showToast("⚪ <b>Disconnected:</b> Switched back to internal serverless profiler.");
                    triggerHaptic('success');
                    fetchAdminStats(true);
                } else {
                    showToast("❌ <b>Error:</b> Could not disconnect Vercel token.");
                }
            } catch (e) {
                console.error('Failed to disconnect Vercel token', e);
            }
        }

        function toggleVercelTokenVisibility() {
            const input = document.getElementById('adminVercelApiToken');
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
        }

        async function saveVercelApiToken() {
            triggerHaptic('medium');
            const input = document.getElementById('adminVercelApiToken');
            const connectBtn = document.getElementById('btn-connect-vercel-token');
            const errorDiv = document.getElementById('vercel-token-error-msg');
            const tokenVal = input ? input.value.trim() : '';
            if (!tokenVal) {
                showToast("⚠️ <b>Token Empty:</b> Please paste your Vercel Personal Access Token.");
                return;
            }
            const clean = tokenVal.replace(/^Bearer\s+/i, '').trim();
            const originalBtnHtml = connectBtn ? connectBtn.innerHTML : '<span>💾</span> Connect Token';
            if (connectBtn) {
                connectBtn.disabled = true;
                connectBtn.innerHTML = '<span>⏳</span> Verifying...';
            }
            if (errorDiv) { errorDiv.style.display = 'none'; errorDiv.innerText = ''; }
            const adminKey = getAdminKey();
            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-key': adminKey,
                        'x-diagnostic-token': adminKey
                    },
                    body: JSON.stringify({ vercelApiToken: clean })
                });
                const data = await res.json();
                if (data && data.success) {
                    localStorage.setItem('cb_vercel_api_token', clean);
                    showToast("✅ <b>Vercel API Connected:</b> Live official usage sync active!");
                    triggerHaptic('success');
                    if (input) input.value = '';
                    fetchAdminStats(true);
                } else {
                    const errTxt = data?.error || 'Invalid Vercel API Token. Please check token permissions.';
                    if (errorDiv) {
                        errorDiv.style.display = 'block';
                        errorDiv.innerText = `❌ ${errTxt}`;
                    }
                    showToast(`❌ <b>Verification Failed:</b> ${errTxt}`);
                    triggerHaptic('error');
                }
            } catch (e) {
                console.error('Failed to save Vercel token', e);
                showToast("❌ <b>Network Error:</b> Failed to connect to server.");
            } finally {
                if (connectBtn) {
                    connectBtn.disabled = false;
                    connectBtn.innerHTML = originalBtnHtml;
                }
            }
        }

        let logoClickCount = 0;
        let logoClickTimer = null;
        let activeModalResolver = null;

        function showAestheticModal({ title, subtitle, icon = '🔐', confirmText = 'Confirm', fields = [] }) {
            return new Promise((resolve) => {
                activeModalResolver = resolve;
                const modal = document.getElementById('cb-aesthetic-modal');
                const titleEl = document.getElementById('modal-title');
                const subEl = document.getElementById('modal-subtitle');
                const iconEl = document.getElementById('modal-icon');
                const confirmBtn = document.getElementById('modal-btn-confirm');
                const fieldsContainer = document.getElementById('modal-fields-container');
                const errorEl = document.getElementById('modal-error-msg');

                if (titleEl) titleEl.innerText = title || 'Admin Authentication';
                if (subEl) subEl.innerText = subtitle || '';
                if (iconEl) iconEl.innerText = icon;
                if (confirmBtn) confirmBtn.innerHTML = `<span>✓</span> ${confirmText}`;
                if (errorEl) {
                    errorEl.style.display = 'none';
                    errorEl.innerText = '';
                }

                if (fieldsContainer) {
                    fieldsContainer.innerHTML = fields.map((f, i) => `
                        <div class="aesthetic-modal-field-block">
                            ${f.label ? `<div class="aesthetic-field-label">${f.label}</div>` : ''}
                            <div class="aesthetic-input-wrap">
                                <input type="${f.type || 'text'}" id="modal_field_${f.id || i}" placeholder="${f.placeholder || ''}" ${f.autofocus ? 'autofocus' : ''} onkeydown="if(event.key === 'Enter') submitAestheticModal();">
                                ${f.type === 'password' ? `<button type="button" class="aesthetic-eye-btn" onclick="toggleModalFieldVisibility('modal_field_${f.id || i}', this)" title="Toggle Visibility">👁️</button>` : ''}
                            </div>
                        </div>
                    `).join('');
                }

                if (modal) modal.style.display = 'flex';
                triggerHaptic('medium');

                setTimeout(() => {
                    const firstInput = document.getElementById('modal_field_0') || document.querySelector('.aesthetic-modal-fields input');
                    if (firstInput) firstInput.focus();
                }, 100);
            });
        }

        function toggleModalFieldVisibility(fieldId, btn) {
            const input = document.getElementById(fieldId);
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                if (btn) btn.innerText = '🔒';
            } else {
                input.type = 'password';
                if (btn) btn.innerText = '👁️';
            }
        }

        function closeAestheticModal(confirmed = false, values = {}) {
            const modal = document.getElementById('cb-aesthetic-modal');
            if (modal) modal.style.display = 'none';
            if (activeModalResolver) {
                activeModalResolver({ confirmed, values });
                activeModalResolver = null;
            }
        }

        function submitAestheticModal() {
            const fields = document.querySelectorAll('.aesthetic-modal-fields input');
            const values = {};
            fields.forEach(f => {
                const key = f.id.replace('modal_field_', '');
                values[key] = f.value.trim();
            });
            closeAestheticModal(true, values);
        }

        async function hashStringSHA256(str) {
            const encoder = new TextEncoder();
            const data = encoder.encode(str);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        function handleSecretLogoClick(event) {
            if (event) event.preventDefault();
            logoClickCount++;
            triggerHaptic('light');

            if (logoClickTimer) clearTimeout(logoClickTimer);
            logoClickTimer = setTimeout(() => {
                logoClickCount = 0;
            }, 2500);

            if (logoClickCount >= 5) {
                logoClickCount = 0;
                triggerHaptic('success');
                promptSecretAdminKey();
            } else {
                switchTab('tab-home', document.querySelector('.nav-pill-item'));
            }
        }

        async function promptSecretAdminKey() {
            const currentKey = getAdminKey();

            // If an active authenticated session exists, verify directly
            if (currentKey) {
                try {
                    const vRes = await fetch('/api/admin/verify', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ key: currentKey })
                    });
                    const vData = await vRes.json();
                    if (vData.success) {
                        showAdminTabs(true);
                        switchTab('tab-admin');
                        showToast('🛡️ <b>Admin Console Active</b>');
                        fetchAdminStats();
                        return;
                    }
                } catch (e) { }
            }

            // Prompt user for the admin password configured in environment variable
            const res = await showAestheticModal({
                title: 'Admin Authentication',
                subtitle: 'Enter your Admin Secret Password to reveal and unlock the Admin Console on this device.',
                icon: '🔐',
                confirmText: 'Unlock Console',
                fields: [
                    { id: 'key', label: 'Admin Password', type: 'password', placeholder: 'Enter admin password', autofocus: true }
                ]
            });
            if (!res.confirmed) return;
            const inputKey = res.values.key;
            if (inputKey && inputKey.trim()) {
                verifyAndActivateAdmin(inputKey.trim());
            }
        }

        async function verifyAndActivateAdmin(key) {
            const cleanKey = String(key || '').trim();
            if (!cleanKey) return;

            try {
                const res = await fetch('/api/admin/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key: cleanKey })
                });
                const data = await res.json();
                if (data.debug) console.error('!!! VERCEL DEBUG !!!', data.debug);
                if (data.success) {
                    sessionStorage.setItem('cb_admin_key', cleanKey);

                    showAdminTabs(true);
                    switchTab('tab-admin');

                    const gate = document.getElementById('admin-auth-gate');
                    const view = document.getElementById('admin-dashboard-view');
                    if (gate) gate.style.display = 'none';
                    if (view) view.style.display = 'flex';

                    showToast('✨ <b>Admin Console Unlocked & Revealed!</b>');
                    fetchAdminStats();
                    return;
                }

                showToast('❌ ' + (data.error || 'Incorrect Admin Password.'));
                triggerHaptic('error');
            } catch (e) {
                showToast('❌ Server authentication failed.');
                triggerHaptic('error');
            }
        }

        function showAdminTabs(show) {
            const desktopPill = document.getElementById('admin-nav-pill-desktop');
            const mobileItem = document.getElementById('admin-nav-item-mobile');
            const universalOverride = document.getElementById('universal-override-container');
            if (desktopPill) desktopPill.style.display = show ? 'inline-flex' : 'none';
            if (mobileItem) mobileItem.style.display = show ? 'flex' : 'none';
            if (universalOverride) universalOverride.style.display = show ? 'flex' : 'none';
        }

        function getAdminKey() {
            return sessionStorage.getItem('cb_admin_key') || '';
        }

        function toggleAdminKeyVisibility() {
            const input = document.getElementById('adminSecretKeyInput');
            const btn = document.getElementById('admin-key-eye-btn');
            if (!input) return;
            if (input.type === 'password') {
                input.type = 'text';
                if (btn) btn.innerText = '🔒';
            } else {
                input.type = 'password';
                if (btn) btn.innerText = '👁️';
            }
        }

        async function unlockAdminConsole() {
            triggerHaptic('medium');
            const input = document.getElementById('adminSecretKeyInput');
            const errEl = document.getElementById('admin-auth-error');
            const key = input ? input.value.trim() : '';

            if (!key) {
                if (errEl) {
                    errEl.style.display = 'block';
                    errEl.innerText = '❌ Please enter your Admin Password';
                }
                return;
            }

            try {
                const res = await fetch('/api/admin/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key })
                });
                const data = await res.json();
                if (data.debug) console.error('!!! VERCEL DEBUG !!!', data.debug);
                if (data.success) {
                    sessionStorage.setItem('cb_admin_key', key);
                    if (errEl) errEl.style.display = 'none';

                    showAdminTabs(true);
                    const gate = document.getElementById('admin-auth-gate');
                    const view = document.getElementById('admin-dashboard-view');
                    if (gate) gate.style.display = 'none';
                    if (view) view.style.display = 'flex';

                    showToast('🔓 <b>Admin Console Unlocked!</b>');
                    fetchAdminStats();
                } else {
                    if (errEl) {
                        errEl.style.display = 'block';
                        errEl.innerText = '❌ ' + (data.error || 'Incorrect Admin Password. Access denied.');
                    }
                    triggerHaptic('error');
                }
            } catch (e) {
                if (errEl) {
                    errEl.style.display = 'block';
                    errEl.innerText = '❌ Server authentication error. Try again.';
                }
            }
        }

        function lockAdminConsole() {
            triggerHaptic('light');
            sessionStorage.removeItem('cb_admin_key');
            localStorage.removeItem('cb_admin_key');
            localStorage.removeItem('cb_admin_master_hash');

            showAdminTabs(false);
            switchTab('tab-home', document.querySelectorAll('.nav-pill-item')[0]);

            const gate = document.getElementById('admin-auth-gate');
            const view = document.getElementById('admin-dashboard-view');
            const input = document.getElementById('adminSecretKeyInput');
            const errEl = document.getElementById('admin-auth-error');

            if (input) input.value = '';
            if (errEl) errEl.style.display = 'none';
            if (gate) gate.style.display = 'block';
            if (view) view.style.display = 'none';

            showToast('🔒 <b>Admin Console Locked & Hidden!</b>');
        }

        function checkAdminSessionState() {
            const key = getAdminKey();
            const gate = document.getElementById('admin-auth-gate');
            const view = document.getElementById('admin-dashboard-view');
            if (key) {
                showAdminTabs(true);
                if (gate) gate.style.display = 'none';
                if (view) view.style.display = 'flex';
                return true;
            } else {
                showAdminTabs(false);
                if (gate) gate.style.display = 'block';
                if (view) view.style.display = 'none';
                return false;
            }
        }

        async function fetchAdminStats(forceFresh = false) {
            if (!checkAdminSessionState()) return;
            const key = getAdminKey();

            try {
                const url = forceFresh ? '/api/admin/stats?fresh=1' : '/api/admin/stats';
                const vercelTok = localStorage.getItem('cb_vercel_api_token') || '';
                const renderKey = localStorage.getItem('cb_render_api_key') || '';
                const headers = { 'x-admin-key': key };
                if (vercelTok) headers['x-vercel-token'] = vercelTok;
                if (renderKey) headers['x-render-key'] = renderKey;

                const res = await fetch(url, { headers });
                if (res.status === 401) {
                    lockAdminConsole();
                    return;
                }
                if (forceFresh) {
                    showToast("🔄 <b>Cloud Sync Refreshed:</b> Live metrics updated from cloud API!");
                    triggerHaptic('success');
                }
                const data = await res.json();
                if (data) {
                    if (data.officialVercel && data.officialVercel.connected === false && data.officialVercel.error) {
                        const vErr = String(data.officialVercel.error).toLowerCase();
                        if (vErr.includes('unauthorized') || vErr.includes('invalid') || vErr.includes('expired')) {
                            localStorage.removeItem('cb_vercel_api_token');
                        }
                    }
                    if (data.officialRender && data.officialRender.connected === false && data.officialRender.error) {
                        const rErr = String(data.officialRender.error).toLowerCase();
                        if (rErr.includes('unauthorized') || rErr.includes('invalid') || rErr.includes('expired')) {
                            localStorage.removeItem('cb_render_api_key');
                        }
                    }
                    const totalEl = document.getElementById('admin-total-configs');
                    const cacheEl = document.getElementById('admin-cache-size');
                    const memEl = document.getElementById('admin-memory-mb');
                    const uptimeEl = document.getElementById('admin-uptime-str');
                    const qListEl = document.getElementById('admin-quarantine-list');

                    if (totalEl) totalEl.innerText = data.totalConfigs || 1;
                    if (cacheEl) {
                        const count = data.cacheSize || 0;
                        cacheEl.innerText = `${count} ${count === 1 ? 'entry' : 'entries'}`;
                    }
                    if (memEl) memEl.innerText = `${data.memoryMB || 0} MB`;

                    if (uptimeEl) {
                        const s = data.uptime || 0;
                        const d = Math.floor(s / 86400);
                        const h = Math.floor((s % 86400) / 3600);
                        const m = Math.floor((s % 3600) / 60);
                        uptimeEl.innerText = d > 0 ? `${d}d ${h}h ${m}m` : (h > 0 ? `${h}h ${m}m` : `${m}m ${s % 60}s`);
                    }

                    if (qListEl) {
                        if (data.quarantinedProviders && data.quarantinedProviders.length > 0) {
                            qListEl.innerHTML = data.quarantinedProviders.map(p => `
                                <div style="display:flex; justify-content:space-between; padding:4px 0; color:#f87171;">
                                    <span>🛑 ${p.name} (${p.strikes} strikes)</span>
                                    <span>Quarantined (${p.remainingMin}m left)</span>
                                </div>
                            `).join('');
                        } else {
                            qListEl.innerHTML = '🟢 No scrapers currently quarantined (All healthy)';
                            qListEl.style.color = 'var(--text-success)';
                        }
                    }

                    const serverEco = (data.globalEcoMode !== undefined)
                        ? data.globalEcoMode
                        : (data.globalSettings && data.globalSettings.globalEcoMode !== undefined ? data.globalSettings.globalEcoMode : undefined);

                    if (serverEco !== undefined) {
                        const isE = Boolean(serverEco !== false);
                        const ecoEl = document.getElementById('vercelEcoMode');
                        const rEcoEl = document.getElementById('renderEcoMode');
                        if (ecoEl) ecoEl.checked = isE;
                        if (rEcoEl) rEcoEl.checked = isE;
                        settings.vercelEcoMode = isE;
                        settings.renderEcoMode = isE;
                        try { localStorage.setItem('nuvio_settings', JSON.stringify(settings)); } catch (_) { }
                    }

                    // Dynamically update Render & Vercel matrix, execution gauge, and budget cards
                    updateAdminView(data);
                }
            } catch (e) {
                console.error('Failed to fetch admin stats', e);
            }
        }

        async function handleAdminEcoToggle(isEnabled) {
            triggerHaptic('medium');
            const rEcoEl = document.getElementById('renderEcoMode');
            const vEcoEl = document.getElementById('vercelEcoMode');

            // Optimistically update local state
            settings.renderEcoMode = isEnabled;
            settings.vercelEcoMode = isEnabled;
            if (rEcoEl) rEcoEl.checked = isEnabled;
            if (vEcoEl) vEcoEl.checked = isEnabled;
            try { localStorage.setItem('nuvio_settings', JSON.stringify(settings)); } catch (_) { }
            onSettingChanged();
            updateAdminView();

            const token = getAdminKey();
            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-admin-key': token,
                        'x-diagnostic-token': token
                    },
                    body: JSON.stringify({ globalEcoMode: isEnabled, allowClientEcoOverride: false })
                });
                const data = await res.json();
                if (data && data.success) {
                    showToast(`👑 <b>Universal Server Eco Mode:</b> ${isEnabled ? 'ENABLED (100% of Users)' : 'DISABLED'}!`);
                    triggerHaptic('success');
                    fetchAdminStats(true);
                } else {
                    const errMsg = data?.error || 'Unauthorized. Please verify your Admin Password.';
                    showToast(`❌ <b>Failed to update server:</b> ${errMsg}`);
                    triggerHaptic('error');
                    settings.renderEcoMode = !isEnabled;
                    settings.vercelEcoMode = !isEnabled;
                    if (rEcoEl) rEcoEl.checked = !isEnabled;
                    if (vEcoEl) vEcoEl.checked = !isEnabled;
                    try { localStorage.setItem('nuvio_settings', JSON.stringify(settings)); } catch (_) { }
                    updateAdminView();
                }
            } catch (e) {
                console.error('Failed to sync global Eco mode to server', e);
                showToast('❌ <b>Network error:</b> Could not reach server.');
                triggerHaptic('error');
            }
        }

        async function purgeServerCache() {
            triggerHaptic('heavy');
            const key = getAdminKey();
            try {
                const res = await fetch('/api/admin/clear-cache', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-key': key }
                });
                const data = await res.json();
                if (data.debug) console.error('!!! VERCEL DEBUG !!!', data.debug);
                if (data.success) {
                    showToast(`✨ <b>Cache Purged:</b> Cleared ${data.cleared} cached stream sets.`);
                    fetchAdminStats();
                } else {
                    showToast('❌ Unauthorized: Invalid Admin Key.');
                }
            } catch (e) {
                showToast('❌ Failed to purge server cache.');
            }
        }

        async function resetQuarantineStrikes() {
            triggerHaptic('heavy');
            const key = getAdminKey();
            try {
                const res = await fetch('/api/admin/reset-quarantine', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-key': key }
                });
                const data = await res.json();
                if (data.debug) console.error('!!! VERCEL DEBUG !!!', data.debug);
                if (data.success) {
                    showToast(`✨ <b>Strikes Reset:</b> Unquarantined all providers.`);
                    fetchAdminStats();
                } else {
                    showToast('❌ Unauthorized: Invalid Admin Key.');
                }
            } catch (e) {
                showToast('❌ Failed to reset quarantine strikes.');
            }
        }

        function exportDiagnostics() {
            triggerHaptic('success');
            const state = {
                exportedAt: new Date().toISOString(),
                configId: configId,
                settings: settings,
                repos: repos,
                providersCount: allProvidersData.length
            };
            const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `chole-bhature-diagnostics-${configId || 'config'}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('📋 <b>Diagnostics Exported!</b> Downloaded JSON.');
        }

        function loadConfigIntoUI(cfg) {
            if (!cfg) return;
            // Strip server-redacted secret placeholders — never overwrite real local keys with '***REDACTED***'
            const SECRET_UI_FIELDS = ['debridApiKey', 'rdKey', 'adKey', 'tbKey', 'pmKey', 'xtreamPassword', 'xtreamUser', 'xtreamServer'];
            for (const f of SECRET_UI_FIELDS) {
                if (cfg[f] === '***REDACTED***') delete cfg[f];
            }

            if (cfg.urls && Array.isArray(cfg.urls)) {
                repos = cfg.urls;
                localStorage.setItem('nuvio_repos', JSON.stringify(repos));
            } else if (cfg.repos && Array.isArray(cfg.repos)) {
                repos = cfg.repos;
                localStorage.setItem('nuvio_repos', JSON.stringify(repos));
            } else if (cfg.repoUrl) {
                if (!repos.includes(cfg.repoUrl)) repos.push(cfg.repoUrl);
                localStorage.setItem('nuvio_repos', JSON.stringify(repos));
            }

            if (cfg.hideDead !== undefined) settings.hideDead = Boolean(cfg.hideDead);
            if (cfg.hideSlow !== undefined) settings.hideSlow = Boolean(cfg.hideSlow);
            if (cfg.hideCam !== undefined) settings.hideCam = Boolean(cfg.hideCam);
            if (cfg.enableQuarantine !== undefined) settings.enableQuarantine = Boolean(cfg.enableQuarantine);
            if (cfg.showSeeders !== undefined) settings.showSeeders = Boolean(cfg.showSeeders);
            if (cfg.deduplicateStreams !== undefined) settings.deduplicateStreams = Boolean(cfg.deduplicateStreams);
            if (cfg.cleanTitles !== undefined) settings.cleanTitles = Boolean(cfg.cleanTitles);
            if (cfg.showFileSize !== undefined) settings.showFileSize = Boolean(cfg.showFileSize);
            if (cfg.showReleaseGroup !== undefined) settings.showReleaseGroup = Boolean(cfg.showReleaseGroup);
            if (cfg.includeOriginalTitle !== undefined) settings.includeOriginalTitle = Boolean(cfg.includeOriginalTitle);
            if (cfg.renderEcoMode !== undefined) settings.renderEcoMode = Boolean(cfg.renderEcoMode);
            if (cfg.vercelEcoMode !== undefined) settings.vercelEcoMode = Boolean(cfg.vercelEcoMode);
            if (cfg.renderEcoMode !== undefined && cfg.vercelEcoMode === undefined) settings.vercelEcoMode = settings.renderEcoMode;
            if (cfg.vercelEcoMode !== undefined && cfg.renderEcoMode === undefined) settings.renderEcoMode = settings.vercelEcoMode;
            if (cfg.enableDoh !== undefined) settings.enableDoh = Boolean(cfg.enableDoh);
            if (cfg.dohProvider) settings.dohProvider = cfg.dohProvider;
            if (cfg.debridProvider) settings.debridProvider = cfg.debridProvider;
            if (cfg.debridApiKey !== undefined) settings.debridApiKey = cfg.debridApiKey;
            if (cfg.enableCatalogs !== undefined) settings.enableCatalogs = Boolean(cfg.enableCatalogs);
            if (cfg.catalogPopular !== undefined) settings.catalogPopular = Boolean(cfg.catalogPopular);
            if (cfg.catalogTrending !== undefined) settings.catalogTrending = Boolean(cfg.catalogTrending);
            if (cfg.catalogIndian !== undefined) settings.catalogIndian = Boolean(cfg.catalogIndian);
            if (cfg.catalogAnime !== undefined) settings.catalogAnime = Boolean(cfg.catalogAnime);

            if (cfg.sortBy) settings.sortBy = cfg.sortBy;
            else if (cfg.sortMode) settings.sortBy = cfg.sortMode;
            else if (cfg.prioritizeQuality !== undefined) settings.sortBy = cfg.prioritizeQuality ? 'quality' : 'speed';

            if (cfg.preferredLanguages && Array.isArray(cfg.preferredLanguages)) {
                settings.preferredLanguages = cfg.preferredLanguages;
            }
            if (cfg.prioritizeHindi !== undefined) {
                settings.prioritizeHindi = Boolean(cfg.prioritizeHindi);
                if (cfg.prioritizeHindi && (!settings.preferredLanguages || !settings.preferredLanguages.includes('Hindi'))) {
                    settings.preferredLanguages = settings.preferredLanguages || [];
                    settings.preferredLanguages.push('Hindi');
                }
            }
            if (cfg.disabled && Array.isArray(cfg.disabled)) settings.disabledProviders = cfg.disabled;
            else if (cfg.disabledProviders && Array.isArray(cfg.disabledProviders)) settings.disabledProviders = cfg.disabledProviders;

            if (cfg.scraperOverrides && typeof cfg.scraperOverrides === 'object') {
                settings.scraperOverrides = cfg.scraperOverrides;
            }

            if (cfg.enableIptv !== undefined) settings.enableIptv = Boolean(cfg.enableIptv);
            else if (cfg.enableLiveTv !== undefined) settings.enableIptv = Boolean(cfg.enableLiveTv);
            if (cfg.enableCuratedIptv !== undefined) settings.enableCuratedIptv = Boolean(cfg.enableCuratedIptv);
            if (cfg.customIptvUrl !== undefined) settings.customIptvUrl = cfg.customIptvUrl;
            else if (cfg.customM3uUrl !== undefined) settings.customIptvUrl = cfg.customM3uUrl;
            if (cfg.iptvUserAgent !== undefined) settings.iptvUserAgent = cfg.iptvUserAgent;
            if (cfg.iptvEpgUrl !== undefined) settings.iptvEpgUrl = cfg.iptvEpgUrl;
            if (cfg.iptvLimit !== undefined) settings.iptvLimit = cfg.iptvLimit;
            if (cfg.xtreamServer !== undefined) settings.xtreamServer = cfg.xtreamServer;
            if (cfg.xtreamUser !== undefined) settings.xtreamUser = cfg.xtreamUser;
            if (cfg.xtreamPassword !== undefined) settings.xtreamPassword = cfg.xtreamPassword;
            if (cfg.enableTelegram !== undefined) settings.enableTelegram = Boolean(cfg.enableTelegram);
            if (cfg.telegramBridgeUrl !== undefined) settings.telegramBridgeUrl = cfg.telegramBridgeUrl;
            const persistedBridgeUrl = localStorage.getItem('cb_telegram_bridge_url');
            if (persistedBridgeUrl && (!cfg.telegramBridgeUrl || cfg.telegramBridgeUrl === 'http://127.0.0.1:8088')) {
                settings.telegramBridgeUrl = persistedBridgeUrl;
            }

            localStorage.setItem('nuvio_settings', JSON.stringify(settings));

            const setCheck = (id, val) => { const el = document.getElementById(id); if (el) el.checked = Boolean(val); };
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val !== undefined && val !== null ? val : ''; };

            setCheck('hideDead', settings.hideDead);
            setCheck('hideSlow', settings.hideSlow);
            setCheck('hideCam', settings.hideCam !== false);
            setCheck('enableQuarantine', settings.enableQuarantine !== false);
            setCheck('showSeeders', settings.showSeeders !== false);
            setCheck('deduplicateStreams', settings.deduplicateStreams !== false);
            setCheck('cleanTitles', settings.cleanTitles !== false);
            setCheck('showFileSize', settings.showFileSize !== false);
            setCheck('showReleaseGroup', settings.showReleaseGroup !== false);
            setCheck('includeOriginalTitle', settings.includeOriginalTitle !== false);

            const isEcoActiveVal = Boolean(settings.renderEcoMode === true || settings.vercelEcoMode === true);
            setCheck('renderEcoMode', isEcoActiveVal);
            setCheck('vercelEcoMode', isEcoActiveVal);

            setCheck('enableDoh', settings.enableDoh !== false);
            setVal('dohProvider', settings.dohProvider || 'cloudflare');
            setVal('debridProvider', settings.debridProvider || 'none');
            setVal('debridApiKey', settings.debridApiKey || '');
            setCheck('enableCatalogs', settings.enableCatalogs !== false);
            setCheck('catalogPopular', settings.catalogPopular !== false);
            setCheck('catalogTrending', settings.catalogTrending !== false);
            setCheck('catalogIndian', settings.catalogIndian !== false);
            setCheck('catalogAnime', settings.catalogAnime !== false);

            setCheck('enableTelegram', Boolean(settings.enableTelegram));
            setVal('telegramBridgeUrl', settings.telegramBridgeUrl || 'http://127.0.0.1:8088');
            toggleTelegramSubsections();
            if (typeof updateTelegramSavedIndicator === 'function') updateTelegramSavedIndicator();

            setCheck('enableIptv', settings.enableIptv !== false);
            setCheck('enableCuratedIptv', Boolean(settings.enableCuratedIptv));
            setVal('customIptvUrl', settings.customIptvUrl || '');
            setVal('iptvUserAgent', settings.iptvUserAgent || '');
            setVal('iptvEpgUrl', settings.iptvEpgUrl || '');
            setVal('iptvLimit', settings.iptvLimit || '0');
            setVal('xtreamServer', settings.xtreamServer || '');
            setVal('xtreamUser', settings.xtreamUser || '');
            setVal('xtreamPassword', settings.xtreamPassword || '');

            toggleIptvSubsections();
            toggleCuratedChannelsVisibility();
            renderCuratedChannels();

            if (settings.customIptvUrl) {
                const connectedCard = document.getElementById('m3u-connected-card');
                if (connectedCard) {
                    connectedCard.style.display = 'block';
                    const statCh = document.getElementById('stat-m3u-channels');
                    if (statCh) statCh.innerText = 'Connected';
                    const statCat = document.getElementById('stat-m3u-cats');
                    if (statCat) statCat.innerText = 'Auto';
                    const statSt = document.getElementById('stat-m3u-status');
                    if (statSt) statSt.innerText = 'Active';
                    const catTags = document.getElementById('m3u-category-tags');
                    if (catTags) catTags.innerText = 'Custom M3U Stream Feed';
                    const urlDisp = document.getElementById('m3u-active-url-display');
                    if (urlDisp) urlDisp.innerText = settings.customIptvUrl;
                }
                if (typeof checkM3uInputChange === 'function') checkM3uInputChange();
            }

            toggleDebridApiKeyVisibility();
            toggleDohProviderVisibility();
            toggleCatalogsVisibility();
            initAllCustomSelects();
            syncCustomSelects();

            updateSortModeUI(settings.sortBy || 'speed');
            renderLanguageChips();
            updateCardPreview();
            updateAdminView();
            updateStatsBar();
            fetchRepos();
        }

        function initAdminVisibility() {
            try {
                // Ensure legacy keys from previous builds are purged
                localStorage.removeItem('cb_admin_master_hash');
                localStorage.removeItem('cb_admin_key');

                const urlParams = new URLSearchParams(window.location.search);
                const secretParam = urlParams.get('secret') || urlParams.get('admin');
                if (secretParam && secretParam !== 'true' && secretParam !== '1') {
                    verifyAndActivateAdmin(secretParam.trim());
                } else if (getAdminKey()) {
                    showAdminTabs(true);
                } else {
                    showAdminTabs(false);
                }
            } catch (e) { }

            // Keyboard shortcut Ctrl+Shift+A to unlock Admin Console
            if (!window.__adminShortcutBound) {
                window.__adminShortcutBound = true;
                window.addEventListener('keydown', (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
                        e.preventDefault();
                        promptSecretAdminKey();
                    }
                });
            }
        }

        async function initConfig() {
            let extractedIdOrToken = null;
            const pathParts = window.location.pathname.split('/').filter(Boolean);
            const searchParams = new URLSearchParams(window.location.search);

            // 1. Path-based identification:
            // /c/:tokenOrId or /c/:tokenOrId/configure
            if (pathParts[0] === 'c' && pathParts[1]) {
                extractedIdOrToken = pathParts[1];
            }
            // /configure/:tokenOrId
            else if (pathParts[0] === 'configure' && pathParts[1]) {
                extractedIdOrToken = pathParts[1];
            }
            // /:tokenOrId/configure or /:tokenOrId (excluding static or api routes)
            else if (pathParts[0] && !['configure', 'api', 'c', 'index.html', 'manifest.json', 'favicon.ico', 'sw.js'].includes(pathParts[0])) {
                extractedIdOrToken = pathParts[0];
            }

            // 2. Query parameters identification:
            if (!extractedIdOrToken) {
                if (searchParams.get('config')) {
                    extractedIdOrToken = searchParams.get('config');
                } else if (searchParams.get('token')) {
                    extractedIdOrToken = searchParams.get('token');
                } else if (searchParams.get('id') || searchParams.get('configId')) {
                    extractedIdOrToken = searchParams.get('id') || searchParams.get('configId');
                } else if (searchParams.get('manifest') || searchParams.get('url') || searchParams.get('addon')) {
                    const rawUrl = searchParams.get('manifest') || searchParams.get('url') || searchParams.get('addon');
                    try {
                        const parsedUrl = new URL(rawUrl, window.location.origin);
                        const pParts = parsedUrl.pathname.split('/').filter(Boolean);
                        if (pParts[0] === 'c' && pParts[1]) {
                            extractedIdOrToken = pParts[1];
                        } else if (pParts[0] && pParts[0] !== 'manifest.json') {
                            extractedIdOrToken = pParts[0];
                        }
                    } catch (e) { }
                }
            }

            // 3. Hash parameters identification (e.g. #c/:token or #config=...)
            if (!extractedIdOrToken && window.location.hash) {
                const hash = window.location.hash.replace(/^#\/?/, '');
                if (hash.startsWith('c/')) {
                    extractedIdOrToken = hash.split('/')[1];
                } else if (hash.includes('=')) {
                    const hParams = new URLSearchParams(hash);
                    extractedIdOrToken = hParams.get('config') || hParams.get('id') || hParams.get('token');
                } else if (hash && !hash.includes('/')) {
                    extractedIdOrToken = hash;
                }
            }

            // 4. Referrer header identification
            if (!extractedIdOrToken && document.referrer) {
                try {
                    const refUrl = new URL(document.referrer);
                    const refParts = refUrl.pathname.split('/').filter(Boolean);
                    if (refParts[0] === 'c' && refParts[1]) {
                        extractedIdOrToken = refParts[1];
                    }
                } catch (e) { }
            }

            // If an identifier or token was discovered:
            if (extractedIdOrToken) {
                extractedIdOrToken = extractedIdOrToken.replace(/\/configure\/?$/, '').replace(/\.json$/, '').trim();

                // 1) Instant client-side decode (0ms latency, handles base64url JSON)
                const clientDecoded = decodeConfigToken(extractedIdOrToken);
                if (clientDecoded) {
                    configId = extractedIdOrToken;
                    isInstalled = true;
                    localStorage.setItem('cb_config_id', configId);
                    localStorage.setItem('cb_is_installed', 'true');
                    loadConfigIntoUI(clientDecoded);
                    showSyncBadge(`ID: ${configId}`);
                    saveConfigurationToServer(false);
                    initAdminVisibility();
                    return;
                }

                // 2) Server API lookup
                try {
                    const res = await fetch(`/api/config/${encodeURIComponent(extractedIdOrToken)}`);
                    const data = await res.json();
                    if (data && data.config) {
                        configId = extractedIdOrToken;
                        isInstalled = true;
                        localStorage.setItem('cb_config_id', configId);
                        localStorage.setItem('cb_is_installed', 'true');
                        loadConfigIntoUI(data.config);
                        showSyncBadge(`ID: ${configId}`);
                        initAdminVisibility();
                        return;
                    }
                } catch (e) {
                    console.warn('[Config] Failed to fetch config by ID from server:', e);
                }
            }

            // 5. If no explicit URL token, prioritize user's local settings (0ms latency, never overwritten)
            const storedConfigId = localStorage.getItem('cb_config_id');
            configId = storedConfigId || getOrCreateConfigId();
            localStorage.setItem('cb_config_id', configId);

            if (storedConfigId) {
                const localDecoded = decodeConfigToken(storedConfigId);
                if (localDecoded) {
                    const customBridge = localStorage.getItem('cb_telegram_bridge_url');
                    const merged = { ...localDecoded, ...settings };
                    if (customBridge) {
                        merged.telegramBridgeUrl = customBridge;
                        settings.telegramBridgeUrl = customBridge;
                    }
                    loadConfigIntoUI(merged);
                    showSyncBadge(`ID: ${configId}`);
                    initAdminVisibility();
                    if (typeof updateTelegramSavedIndicator === 'function') updateTelegramSavedIndicator();
                    return;
                }
            }

            // Populate UI directly with latest local settings
            loadConfigIntoUI(settings);
            showSyncBadge(`ID: ${configId}`);
            initAdminVisibility();
        }

        function setRepoPreset(url) {
            const input = document.getElementById('manifestUrl');
            if (input) {
                input.value = url;
                const form = document.getElementById('install-form');
                if (form) {
                    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
                } else {
                    input.focus();
                    showToast('✨ <b>Manifest URL loaded!</b> Click Add Repo to connect.');
                }
            }
        }

        function copyRepoUrl(url) {
            navigator.clipboard.writeText(url).then(() => {
                showToast('📋 <b>Repository URL copied!</b>');
            }).catch(() => {
                showToast('📋 ' + url);
            });
        }

        function filterProvidersList(query) {
            const term = (query || '').toLowerCase().trim();
            const cards = document.querySelectorAll('#providers-list .provider-item-card');

            const selectEl = document.getElementById('bulkActionTypeSelect');
            const selectedType = selectEl ? selectEl.value : 'all';

            let visible = 0;
            let activeVisible = 0;
            cards.forEach(card => {
                const text = card.textContent.toLowerCase();

                let matchesType = true;
                if (selectedType !== 'all') {
                    if (selectedType === 'anime') matchesType = text.includes('anime') || text.includes('donghua');
                    else if (selectedType === 'indian') matchesType = text.match(/india|hindi|tamil|telugu|malayalam|kannada|english|dual|multi|hollywood|bollywood|hdhub/i) !== null;
                    else if (selectedType === 'regional') matchesType = text.includes('regional') || text.includes('multi') || text.includes('dub');
                    else if (selectedType === 'latino') matchesType = text.match(/latino|spanish|español|espanol/i) !== null;
                    else matchesType = text.includes(selectedType);
                }

                const matchesSearch = !term || text.includes(term);

                if (matchesType && matchesSearch) {
                    card.style.display = 'flex';
                    visible++;
                    const checkbox = card.querySelector('input[type="checkbox"]');
                    if (checkbox && checkbox.checked) {
                        activeVisible++;
                    }
                } else {
                    card.style.display = 'none';
                }
            });
            const countBadge = document.getElementById('provider-count-badge');
            if (countBadge) {
                if (term || selectedType !== 'all') {
                    countBadge.innerText = `${activeVisible} / ${visible} Active`;
                } else {
                    const activeCount = allProvidersData.filter(p => !settings.disabledProviders?.includes(p.name)).length;
                    countBadge.innerText = `${activeCount} / ${allProvidersData.length} Active`;
                }
            }
        }

        async function fetchRepos() {
            const reposContainer = document.getElementById('installed-repos');
            const repoCountBadge = document.getElementById('repo-count-badge');
            if (repoCountBadge) repoCountBadge.innerText = `${repos.length} Repos`;

            if (repos.length === 0) {
                reposContainer.innerHTML = '<div class="empty-placeholder" style="padding: 24px; text-align: center; color: var(--text-muted);">No repositories added yet. Enter a manifest URL or pick a preset above.</div>';
                allProvidersData = [];
                renderProviders();
                updateStatsBar();
                return;
            }

            let reposHtml = '';
            allProvidersData = [];

            for (let i = 0; i < repos.length; i++) {
                const url = repos[i];
                try {
                    const res = await fetch('/api/proxy?url=' + encodeURIComponent(url));
                    const manifest = await res.json();
                    const name = manifest.name || 'Community Repository';
                    const providersArray = manifest.scrapers || manifest.providers || [];

                    providersArray.forEach(p => {
                        p.repoName = name;
                        p.manifestUrl = url;
                        p.logo = p.logo || '';
                        p.version = p.version || '1.0.0';
                        p.supportedTypes = p.supportedTypes || ['movie', 'tv'];
                        p.hasSettings = p.hasSettings || false;
                        allProvidersData.push(p);
                    });

                    reposHtml += `
                        <div class="repo-item-card">
                            <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1;">
                                <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.35); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;">📦</div>
                                <div style="min-width: 0; flex: 1;">
                                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
                                        <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-primary);">${name}</h3>
                                        <span class="repo-tag-pill">🟢 ${providersArray.length} scrapers</span>
                                    </div>
                                    <p class="url" style="margin: 0; font-size: 11.5px; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${url}</p>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                                <button type="button" class="btn-copy-icon" onclick="copyRepoUrl('${url}')" title="Copy Manifest URL">📋</button>
                                <button type="button" class="btn-delete-icon" onclick="removeRepo(${i})" title="Remove Repository">✕</button>
                            </div>
                        </div>
                    `;
                } catch (err) {
                    reposHtml += `
                        <div class="repo-item-card" style="border-color: rgba(244, 63, 94, 0.3);">
                            <div style="display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1;">
                                <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(244, 63, 94, 0.15); border: 1px solid rgba(244, 63, 94, 0.35); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;">⚠️</div>
                                <div style="min-width: 0; flex: 1;">
                                    <h3 style="margin: 0; font-size: 15px; font-weight: 700; color: #f87171;">Failed to load repository</h3>
                                    <p class="url" style="margin: 2px 0 0 0; font-size: 11.5px; word-break: break-all;">${url}</p>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                                <button type="button" class="btn-copy-icon" onclick="copyRepoUrl('${url}')" title="Copy Manifest URL">📋</button>
                                <button type="button" class="btn-delete-icon" onclick="removeRepo(${i})" title="Remove Repository">✕</button>
                            </div>
                        </div>
                    `;
                }
            }

            reposContainer.innerHTML = reposHtml;
            renderProviders();
            updateStatsBar();
        }

        function renderProviders() {
            const providersContainer = document.getElementById('providers-list');
            const providerCountBadge = document.getElementById('provider-count-badge');

            if (providerCountBadge) {
                const activeCount = allProvidersData.filter(p => !settings.disabledProviders?.includes(p.name)).length;
                providerCountBadge.innerText = `${activeCount} / ${allProvidersData.length} Active`;
            }

            if (allProvidersData.length === 0) {
                providersContainer.innerHTML = '<div class="empty-placeholder" style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted);">No scrapers found in repositories.</div>';
                return;
            }

            settings.scraperOverrides = settings.scraperOverrides || {};

            let html = '';
            allProvidersData.forEach((p) => {
                const iconHtml = p.logo ? `<img src="${p.logo}" alt="logo" onerror="this.outerHTML='🧩'">` : '🧩';
                const typesStr = p.supportedTypes.map(t => t === 'movie' ? '🎬 Movie' : t === 'tv' ? '📺 TV' : t).join(' • ');
                const isDisabled = settings.disabledProviders && settings.disabledProviders.includes(p.name);
                const override = settings.scraperOverrides[p.name];
                const hasCustomDomain = Boolean(override && override.domain);
                const safeName = p.name.replace(/'/g, "\\'");

                html += `
                    <div class="provider-item-card" style="opacity: ${isDisabled ? '0.45' : '1'};">
                        <div class="provider-switch-pos" style="display: flex; align-items: center; gap: 8px;">
                            <label class="switch-toggle">
                                <input type="checkbox" onchange="toggleProvider('${safeName}', this.checked)" ${!isDisabled ? 'checked' : ''}>
                                <span class="switch-slider"></span>
                            </label>
                            <button class="btn-delete-icon" style="width: 28px; height: 28px; font-size: 11px;" title="Disable Provider" onclick="removeProvider('${safeName}')">✕</button>
                        </div>
                        <div class="provider-header-row">
                            <div class="provider-avatar">${iconHtml}</div>
                            <div style="min-width: 0;">
                                <div class="provider-repo-badge">${p.repoName}</div>
                                <h4 class="provider-title">${p.name}</h4>
                            </div>
                        </div>
                        <p class="provider-desc-text">${p.description || 'Nuvio ultra-fast stream scraper'}</p>
                        <div class="provider-footer-row">
                            <div class="tag-list">
                                <span class="format-tag">${typesStr}</span>
                                <span class="format-tag">v${p.version}</span>
                                ${hasCustomDomain ? `<span class="format-tag scraper-override-badge" title="${override.domain}">🌐 Custom Mirror</span>` : ''}
                                ${isDisabled ? '<span class="format-tag" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border-color: rgba(239, 68, 68, 0.4);">Disabled</span>' : ''}
                            </div>
                            <button type="button" class="btn-config-scraper" onclick="openScraperModal('${safeName}')" title="Configure Domain, Mirrors & Test Scraper">
                                ⚙️ Edit & Test
                            </button>
                        </div>
                    </div>
                `;
            });
            providersContainer.innerHTML = html;
        }

        let currentEditingScraper = null;

        function prefillCurrentDomain() {
            triggerHaptic('light');
            const activeUrlEl = document.getElementById('scraper-current-active-url');
            const domainInput = document.getElementById('scraper-input-domain');
            if (activeUrlEl && domainInput) {
                let text = activeUrlEl.innerText.trim();
                if (!text || text.includes('Detecting') || text.includes('Default Repository')) {
                    const ph = domainInput.placeholder || '';
                    const match = ph.match(/https?:\/\/[^\s]+/i);
                    if (match) text = match[0];
                }
                if (text && !text.includes('Detecting')) {
                    if (!text.startsWith('http://') && !text.startsWith('https://')) {
                        text = 'https://' + text;
                    }
                    domainInput.value = text;
                    domainInput.focus();
                    domainInput.select();
                    showToast('📋 Copied active domain to edit field!');
                }
            }
        }

        const scraperInfoCache = new Map();

        async function openScraperModal(providerName) {
            triggerHaptic('medium');
            const provider = allProvidersData.find(p => p.name === providerName) || { name: providerName, repoName: 'Repository' };
            currentEditingScraper = providerName;

            const modal = document.getElementById('cb-scraper-modal');
            const titleEl = document.getElementById('scraper-modal-title');
            const repoEl = document.getElementById('scraper-modal-repo');
            const iconEl = document.getElementById('scraper-modal-icon');
            const domainInput = document.getElementById('scraper-input-domain');
            const mirrorsInput = document.getElementById('scraper-input-mirrors');
            const headersInput = document.getElementById('scraper-input-headers');
            const resultBox = document.getElementById('scraper-test-result-box');
            const activeUrlEl = document.getElementById('scraper-current-active-url');
            const statusChipEl = document.getElementById('scraper-status-chip');

            if (titleEl) titleEl.innerText = provider.name;
            if (repoEl) repoEl.innerText = `${provider.repoName} • v${provider.version || '1.0.0'}`;
            if (iconEl) {
                iconEl.innerHTML = provider.logo ? `<img src="${provider.logo}" style="width: 24px; height: 24px; border-radius: 6px;" onerror="this.outerHTML='🔌'">` : '🔌';
            }

            settings.scraperOverrides = settings.scraperOverrides || {};
            const override = settings.scraperOverrides[providerName] || {};

            if (domainInput) domainInput.value = override.domain || '';
            if (mirrorsInput) {
                const mirrorsList = Array.isArray(override.fallbackMirrors) ? override.fallbackMirrors.join('\n') : (override.fallbackMirrors || '');
                mirrorsInput.value = mirrorsList;
            }
            if (headersInput) {
                headersInput.value = (override.headers && Object.keys(override.headers).length > 0) ? JSON.stringify(override.headers, null, 2) : '';
            }
            if (resultBox) {
                resultBox.style.display = 'none';
                resultBox.innerHTML = '';
            }

            // Open Modal Instantly (0ms delay)
            if (modal) modal.style.display = 'flex';

            // Display Active Working Domain
            if (override.domain) {
                if (activeUrlEl) activeUrlEl.innerText = override.domain;
                if (statusChipEl) {
                    statusChipEl.innerText = '🟣 Custom Override Active';
                    statusChipEl.style.background = 'rgba(139, 92, 246, 0.2)';
                    statusChipEl.style.borderColor = 'rgba(139, 92, 246, 0.4)';
                    statusChipEl.style.color = 'var(--text-purple)';
                }
            } else if (scraperInfoCache.has(providerName)) {
                const infoData = scraperInfoCache.get(providerName);
                if (activeUrlEl) activeUrlEl.innerText = infoData.defaultDomain || 'Default Repository Origin';
                if (statusChipEl) {
                    statusChipEl.innerText = '🟢 Default Repo Domain';
                    statusChipEl.style.background = 'rgba(16, 185, 129, 0.15)';
                    statusChipEl.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                    statusChipEl.style.color = 'var(--text-success)';
                }
                if (domainInput && !domainInput.value) domainInput.placeholder = `e.g. ${infoData.defaultDomain}`;
                if (mirrorsInput && !mirrorsInput.value && Array.isArray(infoData.detectedMirrors) && infoData.detectedMirrors.length > 1) {
                    mirrorsInput.placeholder = infoData.detectedMirrors.slice(1).join('\n');
                }
            } else {
                if (activeUrlEl) activeUrlEl.innerText = 'Detecting default domain...';
                if (statusChipEl) {
                    statusChipEl.innerText = '⏳ Detecting...';
                    statusChipEl.style.background = 'rgba(var(--overlay-base), 0.05)';
                    statusChipEl.style.borderColor = 'rgba(var(--overlay-base), 0.1)';
                    statusChipEl.style.color = 'var(--text-muted)';
                }

                // Asynchronously fetch detected default domain without blocking modal opening
                (async () => {
                    try {
                        const manifestUrl = provider.manifestUrl || (repos && repos.length > 0 ? repos[0] : 'https://raw.githubusercontent.com/yoru101/Nuvio-Providers/main/manifest.json');
                        const res = await fetch(`/api/scraper-info?providerName=${encodeURIComponent(providerName)}&manifestUrl=${encodeURIComponent(manifestUrl)}`);
                        const infoData = await res.json();
                        if (infoData && infoData.success && infoData.defaultDomain) {
                            scraperInfoCache.set(providerName, infoData);
                            if (currentEditingScraper === providerName) {
                                if (activeUrlEl) activeUrlEl.innerText = infoData.defaultDomain;
                                if (statusChipEl) {
                                    statusChipEl.innerText = '🟢 Default Repo Domain';
                                    statusChipEl.style.background = 'rgba(16, 185, 129, 0.15)';
                                    statusChipEl.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                                    statusChipEl.style.color = 'var(--text-success)';
                                }
                                if (domainInput && !domainInput.value) domainInput.placeholder = `e.g. ${infoData.defaultDomain}`;
                                if (mirrorsInput && !mirrorsInput.value && Array.isArray(infoData.detectedMirrors) && infoData.detectedMirrors.length > 1) {
                                    mirrorsInput.placeholder = infoData.detectedMirrors.slice(1).join('\n');
                                }
                            }
                        } else if (currentEditingScraper === providerName) {
                            if (activeUrlEl) activeUrlEl.innerText = 'Default Repository Origin';
                            if (statusChipEl) {
                                statusChipEl.innerText = '🟢 Default';
                                statusChipEl.style.background = 'rgba(16, 185, 129, 0.15)';
                                statusChipEl.style.borderColor = 'rgba(16, 185, 129, 0.35)';
                                statusChipEl.style.color = 'var(--text-success)';
                            }
                        }
                    } catch (e) {
                        if (currentEditingScraper === providerName && activeUrlEl) {
                            activeUrlEl.innerText = 'Default Repository Origin';
                        }
                    }
                })();
            }
        }

        function closeScraperModal() {
            triggerHaptic('light');
            const modal = document.getElementById('cb-scraper-modal');
            if (modal) modal.style.display = 'none';
            currentEditingScraper = null;
        }

        async function runLiveScraperTest() {
            if (!currentEditingScraper) return;
            triggerHaptic('medium');
            const btn = document.getElementById('btn-test-scraper-run');
            const resultBox = document.getElementById('scraper-test-result-box');
            const domainInput = document.getElementById('scraper-input-domain');
            const mirrorsInput = document.getElementById('scraper-input-mirrors');
            const headersInput = document.getElementById('scraper-input-headers');

            const domain = domainInput ? domainInput.value.trim() : '';
            const rawMirrors = mirrorsInput ? mirrorsInput.value.trim() : '';
            const fallbackMirrors = rawMirrors ? rawMirrors.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) : [];

            let headers = {};
            if (headersInput && headersInput.value.trim()) {
                try {
                    headers = JSON.parse(headersInput.value.trim());
                } catch (e) {
                    showToast('⚠️ Headers must be valid JSON format');
                    return;
                }
            }

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="pulse-dot"></span> Testing...';
            }

            if (resultBox) {
                resultBox.style.display = 'block';
                resultBox.innerHTML = '<div style="color: var(--text-muted); padding: 8px 0;"><span class="pulse-dot"></span> Probing scraper with active configuration...</div>';
            }

            try {
                const targetProv = allProvidersData.find(p => p.name === currentEditingScraper);
                const manifestUrl = (targetProv && targetProv.manifestUrl) || (repos && repos.length > 0 ? repos[0] : 'https://raw.githubusercontent.com/yoru101/Nuvio-Providers/main/manifest.json');

                const res = await fetch('/api/test-scraper', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        providerName: currentEditingScraper,
                        manifestUrl: manifestUrl,
                        domain: domain,
                        fallbackMirrors: fallbackMirrors,
                        headers: headers,
                        mediaId: 'tt0137523',
                        type: 'movie'
                    })
                });

                const data = await res.json();
                if (data && data.success) {
                    triggerHaptic('success');
                    let streamsHtml = '';
                    if (Array.isArray(data.streams) && data.streams.length > 0) {
                        streamsHtml = data.streams.map(s => `
                            <div style="background: rgba(0,0,0,0.3); padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(var(--overlay-base),0.06); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                <span style="color: #a78bfa; font-weight: 700;">${s.title || s.name || 'Stream'}</span>
                                ${s.size ? `<span style="font-size: 10.5px; color: var(--text-muted); margin-left: 6px;">(${s.size})</span>` : ''}
                            </div>
                        `).join('');
                    }

                    resultBox.innerHTML = `
                        <div style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 10px; padding: 10px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="color: var(--text-success); font-weight: 700;">🟢 Scraper Online</span>
                                <span style="font-size: 11px; color: #a78bfa; background: rgba(139,92,246,0.15); padding: 2px 8px; border-radius: 9999px;">${data.latencyMs}ms</span>
                            </div>
                            <div style="font-size: 11.5px; color: var(--text-secondary); margin-top: 4px;">
                                📦 Probed <b>${data.streamCount}</b> stream(s) for benchmark title.
                            </div>
                            ${streamsHtml ? `<div style="margin-top: 6px; max-height: 120px; overflow-y: auto;">${streamsHtml}</div>` : ''}
                        </div>
                    `;
                } else {
                    triggerHaptic('error');
                    resultBox.innerHTML = `
                        <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px; padding: 10px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <span style="color: #f87171; font-weight: 700;">🔴 Scrape Failed</span>
                                <span style="font-size: 11px; color: var(--text-muted);">${data.latencyMs || 0}ms</span>
                            </div>
                            <div style="font-size: 11.5px; color: #fca5a5; margin-top: 4px; word-break: break-all;">
                                ${data.error || 'Connection timed out or returned zero streams.'}
                            </div>
                        </div>
                    `;
                }
            } catch (e) {
                triggerHaptic('error');
                resultBox.innerHTML = `
                    <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px; padding: 10px; color: #f87171;">
                        ❌ Network error testing scraper: ${e.message}
                    </div>
                `;
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span>▶️</span> Test Now';
                }
            }
        }

        function saveScraperOverrides() {
            if (!currentEditingScraper) return;
            triggerHaptic('success');
            const domainInput = document.getElementById('scraper-input-domain');
            const mirrorsInput = document.getElementById('scraper-input-mirrors');
            const headersInput = document.getElementById('scraper-input-headers');

            let domain = domainInput ? domainInput.value.trim() : '';
            if (domain) {
                if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
                    domain = 'https://' + domain;
                }
                if (domain.endsWith('/')) {
                    domain = domain.slice(0, -1);
                }
                if (domainInput) domainInput.value = domain;
            }

            const rawMirrors = mirrorsInput ? mirrorsInput.value.trim() : '';
            const fallbackMirrors = rawMirrors ? rawMirrors.split(/[\n,]+/).map(s => {
                let m = s.trim();
                if (m && !m.startsWith('http://') && !m.startsWith('https://')) m = 'https://' + m;
                if (m.endsWith('/')) m = m.slice(0, -1);
                return m;
            }).filter(Boolean) : [];

            let headers = {};
            if (headersInput && headersInput.value.trim()) {
                try {
                    headers = JSON.parse(headersInput.value.trim());
                } catch (e) {
                    showToast('⚠️ Headers must be valid JSON');
                    return;
                }
            }

            settings.scraperOverrides = settings.scraperOverrides || {};
            if (domain || fallbackMirrors.length > 0 || Object.keys(headers).length > 0) {
                settings.scraperOverrides[currentEditingScraper] = {
                    domain: domain,
                    fallbackMirrors: fallbackMirrors,
                    headers: headers
                };
                showToast(`✨ <b>Overrides Saved:</b> ${currentEditingScraper}`);
            } else {
                delete settings.scraperOverrides[currentEditingScraper];
                showToast(`✨ <b>Reset to Default:</b> ${currentEditingScraper}`);
            }

            saveSettingsLocal();
            saveConfigurationToServer(true);

            // If admin is authenticated or global toggle checked, sync server-wide for ALL users
            const adminToken = getAdminKey();
            const isGlobalToggle = document.getElementById('scraper-global-override-toggle')?.checked !== false;
            if (adminToken && isGlobalToggle) {
                const overrideObj = (domain || fallbackMirrors.length > 0 || Object.keys(headers).length > 0)
                    ? { domain, fallbackMirrors, headers }
                    : null;
                fetch('/api/admin/scraper-overrides', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminToken, 'x-diagnostic-token': adminToken },
                    body: JSON.stringify({ providerName: currentEditingScraper, override: overrideObj || {} })
                }).then(r => r.json()).then(res => {
                    if (res && res.success) {
                        showToast(`👑 <b>Universal Override:</b> ${currentEditingScraper} updated for 100% of users!`);
                    }
                }).catch(e => console.error('Failed to sync global scraper override', e));
            }

            renderProviders();
            closeScraperModal();
        }

        function resetScraperDefaults() {
            if (!currentEditingScraper) return;
            triggerHaptic('warning');
            settings.scraperOverrides = settings.scraperOverrides || {};
            delete settings.scraperOverrides[currentEditingScraper];

            saveSettingsLocal();
            saveConfigurationToServer(true);
            renderProviders();
            closeScraperModal();
            showToast(`🔄 <b>Restored defaults for:</b> ${currentEditingScraper}`);
        }

        function toggleProvider(name, isEnabled) {
            settings.disabledProviders = settings.disabledProviders || [];
            if (isEnabled) {
                settings.disabledProviders = settings.disabledProviders.filter(p => p !== name);
            } else {
                if (!settings.disabledProviders.includes(name)) {
                    settings.disabledProviders.push(name);
                }
            }
            saveSettingsLocal();
            saveConfigurationToServer(false);
            
            // Update the badge when an individual toggle is clicked
            const searchInput = document.getElementById('providerSearchInput');
            if (searchInput) filterProvidersList(searchInput.value);
            
            updateStatsBar();
            renderProviders();
        }

        function setAllProviders(enable) {
            settings.disabledProviders = settings.disabledProviders || [];
            const selectEl = document.getElementById('bulkActionTypeSelect');
            const selectedType = selectEl ? selectEl.value : 'all';

            let targetProviders = allProvidersData;
            if (selectedType !== 'all') {
                targetProviders = allProvidersData.filter(p => {
                    const desc = (p.description || '').toLowerCase();
                    if (selectedType === 'anime') return desc.includes('anime') || desc.includes('donghua');
                    if (selectedType === 'indian') return desc.match(/india|hindi|tamil|telugu|malayalam|kannada|english|dual|multi|hollywood|bollywood|hdhub/i) !== null;
                    if (selectedType === 'regional') return desc.includes('regional') || desc.includes('multi') || desc.includes('dub');
                    if (selectedType === 'latino') return desc.match(/latino|spanish|español|espanol/i) !== null;
                    return desc.includes(selectedType);
                });
            }

            if (enable) {
                if (selectedType === 'all') {
                    settings.disabledProviders = [];
                } else {
                    const targetNames = targetProviders.map(p => p.name);
                    settings.disabledProviders = settings.disabledProviders.filter(name => !targetNames.includes(name));
                }
            } else {
                if (selectedType === 'all') {
                    settings.disabledProviders = allProvidersData.map(p => p.name);
                } else {
                    const targetNames = targetProviders.map(p => p.name);
                    targetNames.forEach(name => {
                        if (!settings.disabledProviders.includes(name)) {
                            settings.disabledProviders.push(name);
                        }
                    });
                }
            }
            saveSettingsLocal();
            saveConfigurationToServer(false);
            updateStatsBar();
            renderProviders();
        }

        function removeProvider(name) {
            triggerHaptic('medium');
            settings.disabledProviders = settings.disabledProviders || [];
            if (!settings.disabledProviders.includes(name)) {
                settings.disabledProviders.push(name);
            }
            saveSettingsLocal();
            saveConfigurationToServer(true);
            updateStatsBar();
            renderProviders();
            showToast(`🗑️ <b>Provider Disabled:</b> ${name}`);
        }

        function removeRepo(index) {
            triggerHaptic('warning');
            if (index < 0 || index >= repos.length) return;
            repos.splice(index, 1);
            localStorage.setItem('nuvio_repos', JSON.stringify(repos));
            allProvidersData = [];

            saveSettingsLocal();
            saveConfigurationToServer(true);
            fetchRepos();
            showToast(`🗑️ <b>Repository Removed & Synced!</b>`);
        }

        document.getElementById('install-form').addEventListener('submit', function (e) {
            e.preventDefault();
            triggerHaptic('success');
            const url = document.getElementById('manifestUrl').value.trim();
            if (!url) return;

            if (!repos.includes(url)) {
                repos.push(url);
                localStorage.setItem('nuvio_repos', JSON.stringify(repos));
                onSettingChanged();
            }

            document.getElementById('manifestUrl').value = '';
            fetchRepos();
        });

        function buildAddonUrls() {
            const currentUrl = new URL(window.location.href);
            let host = currentUrl.host || 'nuvio.vercel.app';
            let protocol = currentUrl.protocol === 'https:' ? 'https://' : 'http://';
            if (currentUrl.protocol === 'file:') {
                protocol = 'https://';
                host = 'nuvio.vercel.app';
            }
            
            const isBase64Token = (id) => typeof id === 'string' && id.length > 32 && !id.startsWith('enc_');
            let token = configId;
            if (!token || isBase64Token(token)) {
                const configObj = buildConfigObject();
                token = encodeConfigToken(configObj);
            }

            const manifestPath = `/c/${token}/manifest.json`;
            return {
                stremioUrl: `stremio://${host}${manifestPath}`,
                httpUrl: `${protocol}${host}${manifestPath}`
            };
        }

        async function installAddon() {
            triggerHaptic('success');
            if (repos.length === 0) {
                showToast("⚠️ <b>No Repositories:</b> Please add at least one repository first.");
                triggerHaptic('warning');
                switchTab('tab-sources', document.querySelectorAll('.nav-pill-item')[2]);
                return;
            }

            isInstalled = true;
            localStorage.setItem('cb_is_installed', 'true');

            await saveConfigurationToServer(false);
            const urls = buildAddonUrls();
            showFallback(urls.httpUrl);
            window.location.href = urls.stremioUrl;
        }

        function showFallback(httpUrl) {
            const fallbackDiv = document.getElementById('fallbackLink');
            const linkInput = document.getElementById('generatedUrl');
            linkInput.value = httpUrl;
            fallbackDiv.style.display = 'flex';

            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function copyLink() {
            triggerHaptic('success');
            const copyText = document.getElementById("generatedUrl");
            copyText.select();
            document.execCommand("copy");
            showToast("📋 <b>Copied:</b> Manifest URL copied to clipboard!");
        }

        function toggleAnalytics() {
            triggerHaptic('light');
            const card = document.getElementById('analytics-card');
            if (!card) return;
            const isHidden = card.style.display === 'none';
            card.style.display = isHidden ? 'block' : 'none';
        }

        // Theme System (Glass Dark 🌙 ⟷ Pure AMOLED Black 🌑 ⟷ Light ☀️)
        const themes = ['glass', 'amoled', 'light'];
        const themeSVGs = {
            'glass': '<span style="display:flex; align-items:center; justify-content:center; font-size:18px; line-height:normal; font-family: \'Apple Color Emoji\', \'Segoe UI Emoji\', \'Noto Color Emoji\', sans-serif; transform: translateY(-1px);">🌙&#xFE0F;</span>',
            'amoled': '<span style="display:flex; align-items:center; justify-content:center; font-size:18px; line-height:normal; font-family: \'Apple Color Emoji\', \'Segoe UI Emoji\', \'Noto Color Emoji\', sans-serif; transform: translateY(-1px);">🌑&#xFE0F;</span>',
            'light': '<span style="display:flex; align-items:center; justify-content:center; font-size:18px; line-height:normal; font-family: \'Apple Color Emoji\', \'Segoe UI Emoji\', \'Noto Color Emoji\', sans-serif; transform: translateY(-1px);">☀️&#xFE0F;</span>'
        };
        let currentTheme = localStorage.getItem('nuvio_theme') || 'glass';
        if (!themes.includes(currentTheme)) currentTheme = 'glass';

        function applyTheme(theme) {
            document.body.classList.remove('theme-amoled', 'theme-light');
            let metaColor = '#08090e';
            if (theme === 'amoled') {
                document.body.classList.add('theme-amoled');
                metaColor = '#000000';
            } else if (theme === 'light') {
                document.body.classList.add('theme-light');
                metaColor = '#f8fafc';
            }
            document.getElementById('meta-theme-color').setAttribute('content', metaColor);
            const iconEl = document.getElementById('theme-icon');
            if (iconEl) iconEl.innerHTML = themeSVGs[theme] || themeSVGs.glass;
            localStorage.setItem('nuvio_theme', theme);
        }
        applyTheme(currentTheme);

        function toggleTheme() {
            triggerHaptic('medium');
            const currentIndex = themes.indexOf(currentTheme);
            currentTheme = themes[(currentIndex + 1) % themes.length];
            applyTheme(currentTheme);
        }

        function filterAnalyticsProviders(query) {
            const term = (query || '').toLowerCase().trim();
            const rows = document.querySelectorAll('#analytics-provider-list .repo-item-card');
            let visible = 0;
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                const matches = !term || text.includes(term);
                row.style.display = matches ? 'flex' : 'none';
                if (matches) visible++;
            });
            const countLabel = document.getElementById('provider-count-label');
            if (countLabel && term) {
                countLabel.innerText = `${visible} matching`;
            }
        }

        async function syncHealthData(btn = null) {
            let originalText = '';
            if (btn) {
                btn.disabled = true;
                originalText = btn.innerHTML;
                btn.innerHTML = '<span>⏳</span> Syncing...';
                await new Promise(r => setTimeout(r, 400));
            }

            try {
                const res = await fetch('/api/analytics');
                const data = await res.json();
                let fast = 0, slow = 0, dead = 0;

                const providerList = document.getElementById('analytics-provider-list');
                const providerCountLabel = document.getElementById('provider-count-label');
                if (providerList) providerList.innerHTML = '';

                const providerEntries = Object.entries(data).map(([name, d]) => {
                    fast += d.fast || 0;
                    slow += d.slow || 0;
                    dead += d.dead || 0;

                    const totalReqs = (d.fast || 0) + (d.slow || 0) + (d.dead || 0);
                    const avgMs = (d.count > 0 && d.totalLatency > 0) ? Math.round(d.totalLatency / d.count) : null;
                    let statusColor = '#10b981';
                    let statusText = avgMs ? `${avgMs}ms` : 'Healthy';
                    let sortScore = 0;

                    if (d.dead > 0 && d.dead >= totalReqs * 0.5) {
                        statusColor = '#f43f5e';
                        statusText = 'Failing';
                        sortScore = 10000;
                    } else if (avgMs && avgMs >= 800) {
                        statusColor = '#f59e0b';
                        statusText = `${avgMs}ms Slow`;
                        sortScore = avgMs;
                    } else if (avgMs) {
                        statusScore = avgMs;
                    }

                    return { name, totalReqs, avgMs, statusColor, statusText, sortScore, fast: d.fast || 0, slow: d.slow || 0, dead: d.dead || 0 };
                });

                providerEntries.sort((a, b) => b.sortScore - a.sortScore);
                if (providerCountLabel) providerCountLabel.innerText = `${providerEntries.length} active`;

                if (providerList) {
                    if (providerEntries.length === 0) {
                        providerList.innerHTML = '<div class="empty-placeholder" style="padding: 24px; text-align: center; color: var(--text-muted);">No analytics recorded yet. Streams queried in Stremio will show up here.</div>';
                    } else {
                        providerEntries.forEach(p => {
                            const total = p.totalReqs;
                            const fastPct = total > 0 ? ((p.fast / total) * 100).toFixed(0) : 100;
                            const slowPct = total > 0 ? ((p.slow / total) * 100).toFixed(0) : 0;
                            const deadPct = total > 0 ? ((p.dead / total) * 100).toFixed(0) : 0;

                            const row = document.createElement('div');
                            row.className = 'repo-item-card';
                            row.style = 'margin-bottom: 8px; padding: 14px 18px; display: flex; flex-direction: column; align-items: stretch; gap: 10px;';
                            row.innerHTML = `
                                <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px;">
                                    <div style="display: flex; align-items: center; gap: 10px;">
                                        <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(139, 92, 246, 0.15); border: 1px solid rgba(139, 92, 246, 0.3); display: flex; align-items: center; justify-content: center; font-size: 16px;">⚡</div>
                                        <div>
                                            <span style="font-weight: 700; color: var(--text-primary); font-size: 14px;">${p.name}</span>
                                        </div>
                                    </div>
                                    <span style="font-size: 11.5px; font-weight: 800; color: ${p.statusColor}; background: ${p.statusColor}1A; border: 1px solid ${p.statusColor}40; padding: 3px 10px; border-radius: 20px;">${p.statusText}</span>
                                </div>
                                
                                <div style="width: 100%; height: 5px; background: rgba(var(--overlay-base), 0.06); border-radius: 3px; overflow: hidden; display: flex;">
                                    <div style="width: ${fastPct}%; height: 100%; background: #10b981;" title="Fast: ${p.fast}"></div>
                                    <div style="width: ${slowPct}%; height: 100%; background: #f59e0b;" title="Slow: ${p.slow}"></div>
                                    <div style="width: ${deadPct}%; height: 100%; background: #f43f5e;" title="Dead: ${p.dead}"></div>
                                </div>

                                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; font-weight: 600; color: var(--text-muted);">
                                    <div style="display: flex; gap: 10px;">
                                        <span style="color: var(--text-success);">🟢 ${p.fast} Fast (&lt;500ms)</span>
                                        <span style="color: #fbbf24;">🟡 ${p.slow} Slow</span>
                                        <span style="color: #f87171;">🔴 ${p.dead} Dead</span>
                                    </div>
                                    <span>${total} queries</span>
                                </div>
                            `;
                            providerList.appendChild(row);
                        });
                    }
                }

                const total = fast + slow + dead;
                let uptimeNum = total > 0 ? (100 - ((dead / total) * 100)).toFixed(1) : (99.5 + Math.random() * 0.49).toFixed(1);
                let resolveNum = total > 0 ? Math.floor(100 + (slow / total) * 150) : Math.floor(110 + Math.random() * 50);
                const cache = Math.floor(82 + Math.random() * 15);

                document.getElementById('metric-uptime').innerText = uptimeNum + '%';
                document.getElementById('metric-resolve').innerHTML = resolveNum + '<span style="font-size: 14px; color: var(--text-muted);">ms</span>';
                document.getElementById('metric-cache').innerText = cache + '%';
                // Update cache progress bar width (SVG donut removed, using bar)
                const cacheFill = document.querySelector('#metric-cache-bar');
                if (cacheFill) cacheFill.style.width = cache + '%';

                const shieldEl = document.getElementById('metric-shield');
                if (shieldEl) {
                    let shieldPct = total > 0 ? (100 - ((dead / total) * 100)).toFixed(1) : 99.4;
                    shieldEl.innerText = shieldPct + '%';
                }
            } catch (err) { }

            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
                showToast('✨ <b>Health metrics synced!</b>');
            }
        }

        function refreshHealthMetrics(btn) {
            syncHealthData(btn);
        }

        // Dynamic Directional Scroll Handler for Bottom Navbar (Scroll Down: Hide Text, Scroll Up: Show Text)
        let lastScrollY = window.scrollY || 0;
        let scrollTicking = false;

        function handleNavScroll() {
            const nav = document.querySelector('.bottom-nav-bar');
            if (!nav) return;

            const currentScrollY = window.scrollY || document.documentElement.scrollTop || 0;
            const scrollDiff = currentScrollY - lastScrollY;

            // If at the very top of the page, always show full navbar with text
            if (currentScrollY <= 15) {
                nav.classList.remove('scrolled');
            }
            // If scrolling DOWN and past top threshold -> HIDE TEXT (Icons only)
            else if (scrollDiff > 6 && currentScrollY > 30) {
                nav.classList.add('scrolled');
            }
            // If scrolling UP -> BRING TEXT BACK
            else if (scrollDiff < -6) {
                nav.classList.remove('scrolled');
            }

            lastScrollY = Math.max(0, currentScrollY);
            scrollTicking = false;
        }

        window.addEventListener('scroll', () => {
            if (!scrollTicking) {
                window.requestAnimationFrame(handleNavScroll);
                scrollTicking = true;
            }
        }, { passive: true });

        function navigateToSection(tabId, sectionId) {
            const tabMap = {
                'tab-home': 0,
                'tab-settings': 1,
                'tab-sources': 2,
                'tab-analytics': 3
            };
            const navItems = document.querySelectorAll('.nav-pill-item');
            const targetNav = navItems[tabMap[tabId]] || navItems[0];
            switchTab(tabId, targetNav);

            setTimeout(() => {
                const target = document.getElementById(sectionId);
                if (target) {
                    const navHeight = window.innerWidth <= 768 ? 72 : 90;
                    const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;

                    window.scrollTo({
                        top: Math.max(0, targetPosition),
                        behavior: 'smooth'
                    });

                    document.querySelectorAll('.section-highlight-flash').forEach(el => el.classList.remove('section-highlight-flash'));
                    target.classList.add('section-highlight-flash');
                    setTimeout(() => {
                        target.classList.remove('section-highlight-flash');
                    }, 1800);
                }
            }, 120);
        }

        // ==================== HERO SLIDES CONTROLLER ====================
        const HERO_SLIDES = [
            {
                badges: [
                    { text: '⚡ Meta-Sorter', bg: 'rgba(139, 92, 246, 0.2)', border: 'rgba(139, 92, 246, 0.4)', color: 'var(--text-purple)' },
                    { text: '🟢 Zero-Buffering', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.35)', color: 'var(--text-success)' }
                ],
                title: 'Chole Bhature',
                meta: ['Movie', 'Series', 'Anime', 'Debrid ⚡', '2026'],
                btn1Text: 'Install Addon',
                btn1Icon: '🚀',
                btn1Action: 'installAddon()',
                btn2Text: 'Configure Sorter',
                btn2Icon: '⚙️',
                btn2Action: "navigateToSection('tab-settings', 'section-priority')"
            },
            {
                badges: [
                    { text: '💎 Debrid 4K', bg: 'rgba(245, 158, 11, 0.2)', border: 'rgba(245, 158, 11, 0.4)', color: 'var(--text-amber)' },
                    { text: '⚡ 10Gbps Direct', bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.35)', color: 'var(--text-purple)' }
                ],
                title: 'Zero-Buffering Stream',
                meta: ['Real-Debrid', 'AllDebrid', 'Direct Torrent Stream', '4K UHD HDR'],
                btn1Text: 'Setup Debrid',
                btn1Icon: '⚡',
                btn1Action: "navigateToSection('tab-settings', 'section-debrid')",
                btn2Text: 'Install Addon',
                btn2Icon: '🚀',
                btn2Action: 'installAddon()'
            },
            {
                badges: [
                    { text: '📺 Live TV & IPTV', bg: 'rgba(236, 72, 153, 0.2)', border: 'rgba(236, 72, 153, 0.4)', color: '#f472b6' },
                    { text: '🔴 500+ Curated HD', bg: 'rgba(239, 68, 68, 0.15)', border: 'rgba(239, 68, 68, 0.35)', color: '#f87171' }
                ],
                title: 'Live TV & IPTV Feeds',
                meta: ['Sports', 'News', 'Entertainment', 'Custom M3U/M3U8', '100% Free'],
                btn1Text: 'Explore Live TV',
                btn1Icon: '📺',
                btn1Action: "switchTab('tab-iptv', document.querySelectorAll('.nav-pill-item')[3])",
                btn2Text: 'Install Addon',
                btn2Icon: '🚀',
                btn2Action: 'installAddon()'
            },
            {
                badges: [
                    { text: '🛡️ DNS Bypass', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.35)', color: 'var(--text-success)' },
                    { text: '🔒 Encrypted DoH', bg: 'rgba(6, 182, 212, 0.15)', border: 'rgba(6, 182, 212, 0.35)', color: '#67e8f9' }
                ],
                title: 'Encrypted DNS Bypass',
                meta: ['Cloudflare 1.1.1.1', 'Google 8.8.8.8', 'Quad9', 'AdGuard', 'Zero-Logs'],
                btn1Text: 'Configure DoH',
                btn1Icon: '🛡️',
                btn1Class: 'pill-btn-white',
                btn1Action: "navigateToSection('tab-settings', 'section-doh')",
                btn2Text: 'Install Addon',
                btn2Icon: '🚀',
                btn2Action: 'installAddon()'
            },
            {
                badges: [
                    { text: '🌐 Multi-Language', bg: 'rgba(244, 63, 94, 0.15)', border: 'rgba(244, 63, 94, 0.35)', color: 'var(--text-rose)' },
                    { text: '🇯🇵 Anime Dubs', bg: 'rgba(168, 85, 247, 0.15)', border: 'rgba(168, 85, 247, 0.35)', color: '#d8b4fe' }
                ],
                title: 'Audio Priority Engine',
                meta: ['Hindi', 'English', 'Japanese', 'Tamil', 'Telugu', 'Multi-Audio'],
                btn1Text: 'Select Audio',
                btn1Icon: '🌐',
                btn1Action: "navigateToSection('tab-settings', 'section-languages')",
                btn2Text: 'Install Addon',
                btn2Icon: '🚀',
                btn2Action: 'installAddon()'
            },
            {
                badges: [
                    { text: '🔌 50+ Scrapers', bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.35)', color: 'var(--text-blue)' },
                    { text: '📊 Real-Time Health', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.35)', color: 'var(--text-success)' }
                ],
                title: 'Community Repositories',
                meta: ['Auto-Deduplication', 'Dead Link Shield', 'Live Telemetry', '99.9% Uptime'],
                btn1Text: 'Manage Sources',
                btn1Icon: '📦',
                btn1Action: "navigateToSection('tab-sources', 'section-add-repo')",
                btn2Text: 'Install Addon',
                btn2Icon: '🚀',
                btn2Action: 'installAddon()'
            }
        ];

        let currentHeroSlide = 0;
        let heroSlideTimer = null;

        function renderHeroSlide(index, direction = 'next') {
            const slide = HERO_SLIDES[index];
            if (!slide) return;
            const content = document.getElementById('hero-slide-content');
            const badges = document.getElementById('hero-badges');
            const title = document.getElementById('hero-title');
            const meta = document.getElementById('hero-meta');
            const btn1 = document.getElementById('hero-btn-primary');
            const btn2 = document.getElementById('hero-btn-secondary');
            const dots = document.querySelectorAll('#hero-dots .pagination-dot');

            if (content) {
                content.classList.remove('slide-in-from-right', 'slide-in-from-left', 'slide-out-left', 'slide-out-right');
                content.classList.add(direction === 'next' ? 'slide-out-left' : 'slide-out-right');
            }

            setTimeout(() => {
                if (badges) {
                    badges.innerHTML = slide.badges.map(b =>
                        `<span class="hero-pill-tag" style="background: ${b.bg}; border-color: ${b.border}; color: ${b.color};">${b.text}</span>`
                    ).join('');
                }

                if (title) title.innerText = slide.title;
                if (meta) {
                    meta.innerHTML = slide.meta.map((m, i) =>
                        i === 0 ? `<span>${m}</span>` : `<span class="bullet">•</span><span>${m}</span>`
                    ).join('');
                }

                if (btn1) {
                    btn1.setAttribute('onclick', slide.btn1Action);
                    btn1.innerHTML = `<span>${slide.btn1Icon}</span> <span id="hero-btn-primary-text">${slide.btn1Text}</span>`;
                }
                if (btn2) {
                    btn2.setAttribute('onclick', slide.btn2Action);
                    btn2.innerHTML = `<span>${slide.btn2Icon}</span> <span id="hero-btn-secondary-text">${slide.btn2Text}</span>`;
                }

                dots.forEach((dot, idx) => {
                    if (idx === index) dot.classList.add('active-bar');
                    else dot.classList.remove('active-bar');
                });

                if (content) {
                    content.classList.remove('slide-out-left', 'slide-out-right');
                    content.classList.add(direction === 'next' ? 'slide-in-from-right' : 'slide-in-from-left');

                    // Trigger browser reflow
                    void content.offsetWidth;

                    content.classList.remove('slide-in-from-right', 'slide-in-from-left');
                }
            }, 140);
        }

        function nextHeroSlide() {
            currentHeroSlide = (currentHeroSlide + 1) % HERO_SLIDES.length;
            renderHeroSlide(currentHeroSlide, 'next');
        }

        function prevHeroSlide() {
            currentHeroSlide = (currentHeroSlide - 1 + HERO_SLIDES.length) % HERO_SLIDES.length;
            renderHeroSlide(currentHeroSlide, 'prev');
        }

        function goToHeroSlide(index) {
            const direction = index >= currentHeroSlide ? 'next' : 'prev';
            currentHeroSlide = index;
            renderHeroSlide(index, direction);
            startHeroSlideTimer();
        }

        function startHeroSlideTimer() {
            if (heroSlideTimer) clearInterval(heroSlideTimer);
            heroSlideTimer = setInterval(nextHeroSlide, 5000);
        }

        function setupHeroSlideInteractions() {
            const card = document.getElementById('hero-banner-card');
            if (!card) return;

            card.addEventListener('mouseenter', () => {
                if (heroSlideTimer) clearInterval(heroSlideTimer);
            });
            card.addEventListener('mouseleave', () => {
                startHeroSlideTimer();
            });

            let touchStartX = 0;
            let touchEndX = 0;
            card.addEventListener('touchstart', (e) => {
                touchStartX = e.changedTouches[0].screenX;
                if (heroSlideTimer) clearInterval(heroSlideTimer);
            }, { passive: true });

            card.addEventListener('touchend', (e) => {
                touchEndX = e.changedTouches[0].screenX;
                const diff = touchStartX - touchEndX;
                if (Math.abs(diff) > 40) {
                    if (diff > 0) nextHeroSlide();
                    else prevHeroSlide();
                }
                startHeroSlideTimer();
            }, { passive: true });

            startHeroSlideTimer();
        }

        // ==================== INTERACTIVE PAGE-BY-PAGE SPOTLIGHT TOUR ====================
        const tourSteps = [
            { tab: 'tab-home', target: '.nav-brand-pill', icon: '🍲', title: 'Chole Bhature Addon', desc: 'Welcome to the ultimate Nuvio & Stremio Meta-Sorter! Your gateway to high-speed buffer-free streaming starts here.' },
            { tab: 'tab-home', target: '#tour-lang-btn', icon: '🌐', title: 'Native UI Translations', desc: 'Not an English speaker? Click the Language button in the footer at any time to instantly translate this entire dashboard into your native language.' },
            { tab: 'tab-home', target: '#hero-banner-card', icon: '🌶️', title: 'Overview & Health', desc: 'This dashboard monitors your aggregators, stream latency, and live provider health in real-time.' },
            { tab: 'tab-settings', target: '#section-cloud-sync', icon: '☁️', title: 'Cloud Profile Sync', desc: 'Your configuration URL works seamlessly across all devices. No need to login—your custom link IS your account.' },
            { tab: 'tab-settings', target: '#section-debrid', icon: '💎', title: 'Debrid Speed Accelerator', desc: 'Enter your Real-Debrid, AllDebrid, TorBox, or Premiumize API key to unrestrict cached torrents into direct 10Gbps buffer-free streams.' },
            { tab: 'tab-settings', target: '#section-telegram', icon: '✈️', title: 'Telegram Cloud Streaming', desc: 'Utilize the PencariMovie Telegram bridge to instantly stream direct Telegram uploads of movies and shows without downloading.' },
            { tab: 'tab-settings', target: '#section-priority', icon: '⚡', title: 'Sorting & Priority Mode', desc: 'Choose between "Speed First" for instant ultra-low latency playback or "Quality First" to prioritize 4K UHD Remux streams.' },
            { tab: 'tab-settings', target: '#section-filters', icon: '🧹', title: 'Smart Filters & Overrides', desc: 'Use advanced rules to automatically hide Cam rips, filter dead links, force DoH DNS queries, or enable automatic de-duplication.' },
            { tab: 'tab-settings', target: '#section-languages', icon: '🌍', title: 'Audio & Language Tracks', desc: 'Prioritize streams containing Dual Audio, Multi-Audio, or specific regional dubbed content (like Hindi or Tamil) at the very top of your results.' },
            { tab: 'tab-settings', target: '#section-catalogs', icon: '🎬', title: 'TMDB & IMDB Catalogs', desc: 'Nuvio includes highly curated meta-catalogs like Netflix, Amazon Prime, and Disney+ directly inside Stremio via TMDB/IMDB integration.' },
            { tab: 'tab-settings', target: '#section-card-studio', icon: '🎨', title: 'Stremio Card Styling', desc: 'Customize how streams look in your player! Toggle modern minimalist clean cards or keep the legacy detailed view with file sizes and badges.' },
            { tab: 'tab-sources', target: '#section-add-repo', icon: '📦', title: 'Add Provider Repositories', desc: 'Paste a community repository manifest URL to instantly add dozens of new scraper configurations created by other users.' },
            { tab: 'tab-sources', target: '#section-installed-repos', icon: '📚', title: 'Installed Repositories', desc: 'View, manage, and remove your currently installed third-party scraper repositories here. Repos are automatically synced from the cloud.' },
            { tab: 'tab-sources', target: '#bulk-actions-bar', icon: '⚡', title: 'Bulk Action Scrapers', desc: 'Quickly enable or disable entire categories of scrapers (like Anime, Regional, or Latino) all at once using these bulk action buttons.' },
            { tab: 'tab-sources', target: '#section-scrapers', icon: '⚙️', title: 'Manage Individual Scrapers', desc: 'Toggle specific scrapers (like VegaMovies, MoviesDrive, etc) on or off depending on your personal catalog preferences.' },
            { tab: 'tab-iptv', target: '#section-iptv-master', icon: '📺', title: 'Live TV & IPTV', desc: 'Paste a custom M3U playlist link or login with Xtream Codes to watch thousands of Live TV channels directly inside Stremio.' },
            { tab: 'tab-analytics', target: '#section-analytics-card', icon: '📈', title: 'Live Diagnostics', desc: 'Watch the background workers in real-time as they scrape providers. You can see individual provider latencies and isolate failing sites.' },
            { tab: 'tab-home', target: '#install-btn', icon: '🚀', title: '1-Click Install to Player', desc: 'Click "Install" to save your profile and instantly load the addon into Stremio. Your settings are synced across all your devices automatically!' }
        ];

        window.addEventListener('load', () => {
            setTimeout(() => {
                startInteractiveTour(false);
            }, 1000);
        });


        let currentTourIndex = 0;
        let tourActive = false;

        function startInteractiveTour(force = false) {
            if (!force && localStorage.getItem('cb_interactive_tour_done') === 'true') return;
            tourActive = true;
            currentTourIndex = 0;

            const container = document.getElementById('tour-overlay-container');
            if (container) container.style.display = 'block';

            renderTourStep();
            window.addEventListener('resize', updateTourPositions);
            window.addEventListener('scroll', updateTourPositions, { passive: true });
        }

        function renderTourStep() {
            if (!tourActive) return;
            const step = tourSteps[currentTourIndex];
            if (!step) return;

            // 1. Switch to the target tab if needed
            if (step.tab) {
                const tabBtn = document.querySelector(`.nav-pill-group a[onclick*="${step.tab}"]`) ||
                    document.querySelector(`.bottom-nav-bar a[onclick*="${step.tab}"]`);
                switchTab(step.tab, tabBtn);
            }

            // 2. Wait for tab render & scroll, then update spotlight
            setTimeout(() => {
                const targetEl = document.querySelector(step.target);
                if (targetEl) {
                    const isMobile = window.innerWidth <= 768;
                    if (isMobile) {
                        const navOffset = 68;
                        const elRect = targetEl.getBoundingClientRect();
                        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
                        const targetTop = elRect.top + scrollTop - navOffset;
                        window.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
                    } else {
                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                }

                setTimeout(() => {
                    updateTourPositions();
                }, 220);
            }, 140);

            // 3. Update Popover Content
            const pill = document.getElementById('tour-step-pill');
            const icon = document.getElementById('tour-popover-icon');
            const title = document.getElementById('tour-popover-title-text');
            const desc = document.getElementById('tour-popover-desc');
            const prevBtn = document.getElementById('tour-btn-prev');
            const nextBtn = document.getElementById('tour-btn-next');
            const dotsRow = document.getElementById('tour-dots-row');

            if (pill) pill.innerText = `Step ${currentTourIndex + 1} of ${tourSteps.length}`;
            if (icon) icon.innerText = step.icon;
            if (title) title.innerText = step.title;
            if (desc) desc.innerText = step.desc;

            if (prevBtn) prevBtn.style.display = (currentTourIndex > 0) ? 'inline-flex' : 'none';
            if (nextBtn) {
                if (currentTourIndex === tourSteps.length - 1) {
                    nextBtn.innerHTML = '🚀 Install & Finish';
                } else {
                    nextBtn.innerHTML = 'Next ➔';
                }
            }

            // Dots
            if (dotsRow) {
                dotsRow.innerHTML = tourSteps.map((_, i) =>
                    `<span class="tour-dot ${i === currentTourIndex ? 'active' : ''}" onclick="goToTourStep(${i})"></span>`
                ).join('');
            }
        }

        function updateTourPositions() {
            if (!tourActive) return;
            const step = tourSteps[currentTourIndex];
            if (!step) return;

            const targetEl = document.querySelector(step.target);
            const spotlight = document.getElementById('tour-spotlight-box');
            const popover = document.getElementById('tour-popover-card');

            if (!targetEl || !spotlight || !popover) return;

            const rect = targetEl.getBoundingClientRect();
            const pad = 6;
            const isMobile = window.innerWidth <= 768;
            const viewportHeight = window.innerHeight;
            const viewportWidth = window.innerWidth;

            // 1. Update Spotlight Box
            let sTop = Math.max(0, rect.top - pad);
            let sLeft = Math.max(0, rect.left - pad);
            let sWidth = rect.width + (pad * 2);
            let sHeight = rect.height + (pad * 2);

            spotlight.style.top = `${sTop}px`;
            spotlight.style.left = `${sLeft}px`;
            spotlight.style.width = `${sWidth}px`;
            spotlight.style.height = `${sHeight}px`;

            // 2. Update Popover Position
            const popoverRect = popover.getBoundingClientRect();

            if (isMobile) {
                // Mobile layout: sleek docked floating card above bottom navigation
                popover.style.width = `calc(100vw - 24px)`;
                popover.style.maxWidth = `420px`;
                popover.style.left = `50%`;
                popover.style.transform = `translateX(-50%)`;
                popover.style.top = `auto`;
                popover.style.bottom = `calc(76px + env(safe-area-inset-bottom, 0px))`;
            } else {
                // Desktop layout: smart floating relative positioning
                popover.style.transform = `none`;
                popover.style.width = `min(420px, calc(100vw - 32px))`;
                popover.style.maxWidth = `420px`;
                popover.style.bottom = `auto`;

                let top;
                if (rect.bottom + popoverRect.height + 20 <= viewportHeight) {
                    top = rect.bottom + 16;
                } else if (rect.top - popoverRect.height - 20 >= 0) {
                    top = rect.top - popoverRect.height - 16;
                } else {
                    top = Math.max(16, (viewportHeight - popoverRect.height) / 2);
                }

                let left = rect.left + (rect.width / 2) - (popoverRect.width / 2);
                left = Math.max(16, Math.min(left, viewportWidth - popoverRect.width - 16));

                popover.style.top = `${top}px`;
                popover.style.left = `${left}px`;
            }
        }

        function nextTourStep() {
            triggerHaptic('light');
            if (currentTourIndex < tourSteps.length - 1) {
                currentTourIndex++;
                renderTourStep();
            } else {
                closeInteractiveTour(true);
                handleTopAction();
            }
        }

        function prevTourStep() {
            triggerHaptic('light');
            if (currentTourIndex > 0) {
                currentTourIndex--;
                renderTourStep();
            }
        }

        function goToTourStep(idx) {
            triggerHaptic('light');
            if (idx >= 0 && idx < tourSteps.length) {
                currentTourIndex = idx;
                renderTourStep();
            }
        }

        function closeInteractiveTour(finished = false) {
            triggerHaptic('medium');
            tourActive = false;
            const container = document.getElementById('tour-overlay-container');
            if (container) container.style.display = 'none';
            localStorage.setItem('cb_interactive_tour_done', 'true');
            window.removeEventListener('resize', updateTourPositions);
            window.removeEventListener('scroll', updateTourPositions);
        }

        // Initialize App
        window.addEventListener('DOMContentLoaded', () => {
            try {
                initConfig();
            } catch (err) {
                console.error('[Init] Error initializing config:', err);
            }

            try {
                const savedTab = sessionStorage.getItem('cb_active_tab');
                if (savedTab && savedTab !== 'tab-admin' && document.getElementById(savedTab)) {
                    switchTab(savedTab, null, false);
                } else if (savedTab === 'tab-admin') {
                    if (getAdminKey() && document.getElementById('tab-admin')) {
                        switchTab('tab-admin', null, false);
                    } else {
                        sessionStorage.removeItem('cb_active_tab');
                    }
                }
            } catch (err) { }

            try {
                syncHealthData();
                handleNavScroll();
                setupHeroSlideInteractions();
                initAllCustomSelects();
                syncCustomSelects();
                updateAdminView();
            } catch (err) {
                console.error('[Init] Error setting up UI components:', err);
            }

            // Sync universal server settings (Eco Mode, Keep-Alive, Scraper Overrides)
            fetch('/api/public/settings')
                .then(r => r.ok ? r.json() : null)
                .then(pub => {
                    if (pub && pub.success) {
                        if (pub.globalEcoMode !== undefined) {
                            settings.renderEcoMode = pub.globalEcoMode;
                            settings.vercelEcoMode = pub.globalEcoMode;
                            try { localStorage.setItem('nuvio_settings', JSON.stringify(settings)); } catch (_) { }
                            const rEl = document.getElementById('renderEcoMode');
                            const vEl = document.getElementById('vercelEcoMode');
                            if (rEl) rEl.checked = pub.globalEcoMode;
                            if (vEl) vEl.checked = pub.globalEcoMode;
                        }
                        updateAdminView();
                    }
                })
                .catch(() => { });

            // Warmup telemetry in background (non-blocking)
            fetch('/api/telemetry/stats', { headers: { 'x-diagnostic-token': 'guest' } })
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data) updateAdminView(data); })
                .catch(() => { });
        });


        // ===== IPTV & LIVE TV ENGINE HELPERS =====
        const SAMPLE_CURATED_CHANNELS = [
            { id: 'iptv:curated:bbc_news', name: 'BBC News Live', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/BBC_News_2019.svg/1200px-BBC_News_2019.svg.png', category: 'News', country: 'UK' },
            { id: 'iptv:curated:sky_news', name: 'Sky News UK', logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/5/58/Sky_News_logo_2020.svg/1200px-Sky_News_logo_2020.svg.png', category: 'News', country: 'UK' },
            { id: 'iptv:curated:bloomberg_tv', name: 'Bloomberg TV', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/Bloomberg_Television_logo.svg/1200px-Bloomberg_Television_logo.svg.png', category: 'News', country: 'USA' },
            { id: 'iptv:curated:redbull_tv', name: 'Red Bull TV', logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f5/Red_Bull_TV_logo.svg/1200px-Red_Bull_TV_logo.svg.png', category: 'Sports', country: 'Global' },
            { id: 'iptv:curated:fite_sports', name: 'Fight Sports', logo: 'https://upload.wikimedia.org/wikipedia/commons/7/7b/Sports_icon.png', category: 'Sports', country: 'USA' },
            { id: 'iptv:curated:ndtv_24x7', name: 'NDTV 24x7', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/NDTV_24x7_Logo.svg/1200px-NDTV_24x7_Logo.svg.png', category: 'India', country: 'India' },
            { id: 'iptv:curated:aaj_tak', name: 'Aaj Tak Live', logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/07/Aaj_Tak_logo.svg/1200px-Aaj_Tak_logo.svg.png', category: 'India', country: 'India' },
            { id: 'iptv:curated:dd_sports', name: 'DD Sports Live', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Doordarshan_logo.svg/1200px-Doordarshan_logo.svg.png', category: 'India', country: 'India' },
            { id: 'iptv:curated:filmrise_action', name: 'FilmRise Action', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Film_strip.svg/500px-Film_strip.svg.png', category: 'Movies', country: 'USA' },
            { id: 'iptv:curated:dust_scifi', name: 'DUST Sci-Fi', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/Orbit_icon.svg/500px-Orbit_icon.svg.png', category: 'Entertainment', country: 'USA' },
            { id: 'iptv:curated:nasa_tv', name: 'NASA TV HD', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e5/NASA_logo.svg/1200px-NASA_logo.svg.png', category: 'Entertainment', country: 'USA' },
            { id: 'iptv:curated:clubbing_tv', name: 'Clubbing TV', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Headphones_icon.svg/500px-Headphones_icon.svg.png', category: 'Music', country: 'France' }
        ];

        // ===== TELEGRAM CLOUD STREAMING CONTROLLERS =====
        function showTelegramTutorialModal() {
            triggerHaptic('medium');
            const modal = document.getElementById('cb-telegram-tutorial-modal');
            if (modal) modal.style.display = 'flex';
        }

        function closeTelegramTutorialModal() {
            triggerHaptic('light');
            const modal = document.getElementById('cb-telegram-tutorial-modal');
            if (modal) modal.style.display = 'none';
        }

        function isValidBridgeUrl(url) {
            if (!url || typeof url !== 'string') return false;
            try {
                const u = new URL(url.trim());
                return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
            } catch (e) {
                return false;
            }
        }

        function onTelegramUrlInput() {
            const input = document.getElementById('telegramBridgeUrl');
            if (input) {
                const val = input.value.trim();
                settings.telegramBridgeUrl = val || 'http://127.0.0.1:8088';
                if (val) localStorage.setItem('cb_telegram_bridge_url', val);
                const onlineUrl = localStorage.getItem('cb_telegram_bridge_online_url');
                if (val !== onlineUrl) {
                    localStorage.setItem('cb_telegram_bridge_last_status', 'untested');
                }
                updateTelegramSavedIndicator();
            }
        }

        function updateTelegramSavedIndicator() {
            const badge = document.getElementById('telegram-bridge-saved-badge');
            if (!badge) return;
            const input = document.getElementById('telegramBridgeUrl');
            const url = (input ? input.value.trim() : '') || settings.telegramBridgeUrl || localStorage.getItem('cb_telegram_bridge_url') || '';

            if (!url) {
                badge.style.display = 'none';
                return;
            }

            const cleanUrl = String(url).replace(/[<>"']/g, '');
            const onlineUrl = localStorage.getItem('cb_telegram_bridge_online_url');
            const lastStatus = localStorage.getItem('cb_telegram_bridge_last_status') || 'untested';
            const ping = localStorage.getItem('cb_telegram_bridge_ping');

            if (!isValidBridgeUrl(url)) {
                badge.style.display = 'inline-flex';
                badge.style.background = 'rgba(239, 68, 68, 0.12)';
                badge.style.border = '1px solid rgba(239, 68, 68, 0.35)';
                badge.style.color = '#f87171';
                badge.innerHTML = `<span>⚠️</span> <span><b>Invalid URL format:</b> Must start with <code>http://</code> or <code>https://</code></span>`;
                return;
            }

            // ONLY GREEN IF IT IS CONFIRMED ONLINE & CORRECT
            if (onlineUrl && onlineUrl === url && lastStatus === 'online') {
                badge.style.display = 'inline-flex';
                badge.style.background = 'rgba(16, 185, 129, 0.12)';
                badge.style.border = '1px solid rgba(16, 185, 129, 0.35)';
                badge.style.color = 'var(--text-success)';
                const pingHtml = ping ? `<span style="background: rgba(16, 185, 129, 0.22); border: 1px solid rgba(16, 185, 129, 0.4); padding: 1px 6px; border-radius: 5px; font-weight: 800; font-family: monospace; font-size: 11px; margin-left: 4px;">⚡ ${ping}ms</span>` : '';
                badge.innerHTML = `<span>🟢</span> <span><b>Active Online Bridge:</b> <code style="color: var(--text-success); font-family: monospace; font-weight: 700;">${cleanUrl}</code>${pingHtml}</span>`;
            } else if (lastStatus === 'offline') {
                badge.style.display = 'inline-flex';
                badge.style.background = 'rgba(239, 68, 68, 0.12)';
                badge.style.border = '1px solid rgba(239, 68, 68, 0.35)';
                badge.style.color = '#f87171';
                badge.innerHTML = `<span>🔴</span> <span><b>Bridge Offline:</b> <code style="color: #fca5a5; font-family: monospace; font-weight: 700;">${cleanUrl}</code> — <a href="#" onclick="testTelegramBridge(); return false;" style="color: #38bdf8; text-decoration: underline; font-weight: 600; margin-left: 4px;">Retry Test</a></span>`;
            } else {
                // Untested / neutral state - NOT green!
                badge.style.display = 'inline-flex';
                badge.style.background = 'rgba(148, 163, 184, 0.1)';
                badge.style.border = '1px solid rgba(148, 163, 184, 0.25)';
                badge.style.color = '#94a3b8';
                badge.innerHTML = `<span>⚪</span> <span><b>Saved (Untested):</b> <code style="color: var(--text-muted); font-family: monospace; font-weight: 700;">${cleanUrl}</code> — <a href="#" onclick="testTelegramBridge(); return false;" style="color: #38bdf8; text-decoration: underline; font-weight: 600;">Click "Test Daemon" to verify</a></span>`;
            }
        }

        function setTelegramBridgeUrl(url) {
            triggerHaptic('light');
            const input = document.getElementById('telegramBridgeUrl');
            if (input) {
                input.value = url;
                settings.telegramBridgeUrl = url;
                if (url) localStorage.setItem('cb_telegram_bridge_url', url);
                const onlineUrl = localStorage.getItem('cb_telegram_bridge_online_url');
                if (url !== onlineUrl) {
                    localStorage.setItem('cb_telegram_bridge_last_status', 'untested');
                }
                onSettingChanged();
                updateTelegramSavedIndicator();
                showToast(`⚡ Bridge URL set to: <b>${url}</b>`);
            }
        }

        function toggleTelegramSubsections() {
            const isTg = Boolean(document.getElementById('enableTelegram')?.checked);
            const body = document.getElementById('telegram-card-body');
            if (body) body.style.display = isTg ? 'block' : 'none';
        }

        async function testTelegramBridge() {
            triggerHaptic('medium');
            const input = document.getElementById('telegramBridgeUrl');
            const statusEl = document.getElementById('telegram-bridge-status');
            const btn = document.getElementById('btn-test-telegram');
            const bridgeUrl = input ? input.value.trim() : 'http://127.0.0.1:8088';

            // Immediately persist user input
            settings.telegramBridgeUrl = bridgeUrl;
            if (bridgeUrl) localStorage.setItem('cb_telegram_bridge_url', bridgeUrl);
            saveSettingsLocal();
            saveConfigurationToServer(false);

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>⏳</span> Testing...';
            }
            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(14, 165, 233, 0.12)';
                statusEl.style.border = '1px solid rgba(14, 165, 233, 0.3)';
                statusEl.style.color = '#38bdf8';
                statusEl.innerHTML = '⏳ <b>Pinging Telegram Bridge Daemon...</b>';
            }

            const pingStart = performance.now();
            try {
                let isOnline = false;
                let data = null;
                let measuredLatency = 0;
                try {
                    const clientRes = await fetch(`${bridgeUrl.replace(/\/+$/, '')}/api/version`, { mode: 'cors' });
                    data = await clientRes.json();
                    measuredLatency = Math.round(performance.now() - pingStart);
                    isOnline = Boolean(data && (data.online || data.success || data.current_version));
                    data.bridgeUrl = bridgeUrl;
                    data.latencyMs = measuredLatency;
                } catch (clientErr) {
                    const sStart = performance.now();
                    const res = await fetch(`/api/telegram/status?bridgeUrl=${encodeURIComponent(bridgeUrl)}`);
                    data = await res.json();
                    measuredLatency = (data && typeof data.latencyMs === 'number' && data.latencyMs > 0)
                        ? data.latencyMs
                        : Math.round(performance.now() - sStart);
                    isOnline = Boolean(data && (data.online || data.bridgeHealthy || data.success));
                    if (data) data.latencyMs = measuredLatency;
                }
                if (isOnline) {
                    triggerHaptic('success');
                    localStorage.setItem('cb_telegram_bridge_online_url', bridgeUrl);
                    localStorage.setItem('cb_telegram_bridge_ping', String(measuredLatency));
                    localStorage.setItem('cb_telegram_bridge_last_status', 'online');
                    updateTelegramSavedIndicator();

                    if (statusEl) {
                        statusEl.style.background = 'rgba(16, 185, 129, 0.12)';
                        statusEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
                        statusEl.style.color = 'var(--text-success)';
                        const ver = (data.versionData && data.versionData.current_version) ? ` (v${data.versionData.current_version})` : (data.current_version ? ` (v${data.current_version})` : '');
                        const pingBadge = measuredLatency > 0 ? ` <span style="background: rgba(16, 185, 129, 0.22); border: 1px solid rgba(16, 185, 129, 0.4); padding: 2px 7px; border-radius: 6px; font-weight: 800; font-family: monospace; font-size: 11px; margin: 0 4px;">⚡ ${measuredLatency}ms ping</span>` : '';
                        statusEl.innerHTML = `🟢 <b>Bridge Online:</b>${pingBadge} High-speed MTProto direct streaming active at <code>${data.bridgeUrl || bridgeUrl}</code>.`;
                    }
                    showToast(`⚡ <b>Telegram Bridge Online:</b> Connected (${measuredLatency}ms ping).`);
                } else {
                    triggerHaptic('warning');
                    localStorage.setItem('cb_telegram_bridge_last_status', 'offline');
                    if (localStorage.getItem('cb_telegram_bridge_online_url') === bridgeUrl) {
                        localStorage.removeItem('cb_telegram_bridge_online_url');
                    }
                    updateTelegramSavedIndicator();

                    if (statusEl) {
                        statusEl.style.background = 'rgba(245, 158, 11, 0.12)';
                        statusEl.style.border = '1px solid rgba(245, 158, 11, 0.3)';
                        statusEl.style.color = '#fbbf24';
                        const reason = (data && data.error) ? ` (${data.error})` : '';
                        statusEl.innerHTML = `🟡 <b>Bridge Offline (Standby Mode):</b> Bridge at <code>${bridgeUrl}</code> was not reachable${reason}. Telegram streams will seamlessly stream via web player fallback.`;
                    }
                    showToast('ℹ️ <b>Bridge Offline:</b> Web player fallback active.');
                }
            } catch (e) {
                localStorage.setItem('cb_telegram_bridge_last_status', 'offline');
                if (localStorage.getItem('cb_telegram_bridge_online_url') === bridgeUrl) {
                    localStorage.removeItem('cb_telegram_bridge_online_url');
                }
                updateTelegramSavedIndicator();

                if (statusEl) {
                    statusEl.style.background = 'rgba(239, 68, 68, 0.12)';
                    statusEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
                    statusEl.style.color = '#f87171';
                    statusEl.innerHTML = `⚠️ <b>Error:</b> Could not connect to Telegram status API.`;
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<span>📡</span> Test Daemon';
                }
            }
        }

        function toggleIptvSubsections() {
            const isIptv = document.getElementById('enableIptv')?.checked !== false;
            const sub = document.getElementById('iptv-subsections');
            if (sub) sub.style.display = isIptv ? 'flex' : 'none';
        }

        function toggleCuratedChannelsVisibility() {
            const isCurated = Boolean(document.getElementById('enableCuratedIptv')?.checked);
            const body = document.getElementById('curated-iptv-card-body');
            if (body) body.style.display = isCurated ? 'block' : 'none';
            const grid = document.getElementById('curated-channels-grid');
            if (grid) grid.style.opacity = isCurated ? '1' : '0.4';
        }

        function getChannelBadge(ch) {
            const badges = {
                'iptv:curated:bbc_news': { bg: 'linear-gradient(135deg, #bb1919 0%, #7f1d1d 100%)', text: 'BBC', sub: 'NEWS' },
                'iptv:curated:sky_news': { bg: 'linear-gradient(135deg, #e11d48 0%, #1e3a8a 100%)', text: 'SKY', sub: 'NEWS' },
                'iptv:curated:bloomberg_tv': { bg: 'linear-gradient(135deg, #4338ca 0%, #1e1b4b 100%)', text: 'BBG', sub: 'TV' },
                'iptv:curated:redbull_tv': { bg: 'linear-gradient(135deg, #0f172a 0%, #b91c1c 100%)', text: 'RED', sub: 'BULL' },
                'iptv:curated:fite_sports': { bg: 'linear-gradient(135deg, #991b1b 0%, #450a0a 100%)', text: '🥊', sub: 'FIGHT' },
                'iptv:curated:ndtv_24x7': { bg: 'linear-gradient(135deg, #1d4ed8 0%, #172554 100%)', text: 'NDTV', sub: '24x7' },
                'iptv:curated:aaj_tak': { bg: 'linear-gradient(135deg, #dc2626 0%, #991b1b 100%)', text: 'आज', sub: 'तक' },
                'iptv:curated:dd_sports': { bg: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)', text: 'DD', sub: 'SPORTS' },
                'iptv:curated:filmrise_action': { bg: 'linear-gradient(135deg, #0d9488 0%, #115e59 100%)', text: 'FILM', sub: 'RISE' },
                'iptv:curated:dust_scifi': { bg: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', text: '🛸', sub: 'DUST' },
                'iptv:curated:nasa_tv': { bg: 'linear-gradient(135deg, #1d4ed8 0%, #0f172a 100%)', text: '🚀', sub: 'NASA' },
                'iptv:curated:clubbing_tv': { bg: 'linear-gradient(135deg, #c026d3 0%, #701a75 100%)', text: '🎧', sub: 'CLUB' }
            };
            const b = badges[ch.id] || { bg: 'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)', text: 'LIVE', sub: 'TV' };
            return `
                <div style="width: 38px; height: 38px; border-radius: 10px; background: ${b.bg}; display: flex; flex-direction: column; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid rgba(var(--overlay-base),0.18); line-height: 1; user-select: none;">
                    <span style="font-size: ${b.text.length > 2 ? '11px' : '13px'}; font-weight: 900; color: #ffffff; letter-spacing: -0.2px;">${b.text}</span>
                    <span style="font-size: 7.5px; font-weight: 800; color: rgba(var(--overlay-base),0.85); text-transform: uppercase; margin-top: 1.5px; letter-spacing: 0.3px;">${b.sub}</span>
                </div>
            `;
        }

        function renderCuratedChannels() {
            const grid = document.getElementById('curated-channels-grid');
            if (!grid) return;

            grid.innerHTML = SAMPLE_CURATED_CHANNELS.map(ch => `
                <div style="background: rgba(var(--overlay-base), 0.03); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; justify-content: space-between; gap: 8px; transition: transform 0.2s, border-color 0.2s;">
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${getChannelBadge(ch)}
                        <div style="min-width: 0; flex: 1;">
                            <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${ch.name}</div>
                            <span class="tag-pill-badge" style="font-size: 9.5px; padding: 2px 6px; background: rgba(139, 92, 246, 0.15); border-color: rgba(139, 92, 246, 0.3); color: var(--text-purple);">${ch.category} • ${ch.country}</span>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 2px;">
                        <span style="font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px;">🟢 24/7 Live</span>
                        <button type="button" class="pill-btn pill-btn-glass" onclick="testChannelPing('${ch.id}', this)" style="padding: 3px 10px; font-size: 11px; line-height: 1; font-weight: 700;">
                            ⚡ Ping
                        </button>
                    </div>
                </div>
            `).join('');
        }

        async function testChannelPing(channelId, btn) {
            triggerHaptic('light');
            btn.innerText = '⏳...';
            try {
                const res = await fetch(`/stream/tv/${channelId}.json`);
                const data = await res.json();
                if (data && data.streams && data.streams.length > 0) {
                    const title = data.streams[0].title || '';
                    const match = title.match(/\((\d+ms)\)/);
                    const ping = match ? match[1] : 'OK';
                    btn.innerHTML = `🟢 ${ping}`;
                    btn.style.color = 'var(--text-success)';
                } else {
                    btn.innerHTML = '⚪ Ready';
                }
            } catch (e) {
                btn.innerHTML = '⚪ Ready';
            }
        }


        // ============================================================
        // PRO IPTV PLAYLIST STUDIO LOGIC & CONTROLLER
        // ============================================================
        const IPTV_PRESETS = [
            {
                id: 'in',
                name: 'India TV & News',
                flag: '🇮🇳',
                url: 'https://iptv-org.github.io/iptv/countries/in.m3u',
                desc: 'Doordarshan, Live News, Regional'
            },
            {
                id: 'news',
                name: 'World News HD',
                flag: '📰',
                url: 'https://iptv-org.github.io/iptv/categories/news.m3u',
                desc: 'BBC, Sky, Bloomberg, DW, France24'
            },
            {
                id: 'sports',
                name: 'Live Sports',
                flag: '⚽',
                url: 'https://iptv-org.github.io/iptv/categories/sports.m3u',
                desc: 'Red Bull TV, Combat & Extreme'
            },
            {
                id: 'movies',
                name: 'Movies & Cinema',
                flag: '🎬',
                url: 'https://iptv-org.github.io/iptv/categories/movies.m3u',
                desc: 'FilmRise, Retro Classics'
            },
            {
                id: 'music',
                name: 'Music 24/7',
                flag: '🎵',
                url: 'https://iptv-org.github.io/iptv/categories/music.m3u',
                desc: 'Clubbing TV, Vevo, Live Stage'
            },
            {
                id: 'us',
                name: 'USA Free Streams',
                flag: '🇺🇸',
                url: 'https://iptv-org.github.io/iptv/countries/us.m3u',
                desc: 'PBS, Local News, Public TV'
            },
            {
                id: 'uk',
                name: 'UK Freeview',
                flag: '🇬🇧',
                url: 'https://iptv-org.github.io/iptv/countries/uk.m3u',
                desc: 'BBC News, UK Freeview Feeds'
            },
            {
                id: 'global',
                name: 'Global Index',
                flag: '🌍',
                url: 'https://iptv-org.github.io/iptv/index.m3u',
                desc: '11,000+ Worldwide Channels'
            }
        ];

        let m3uChannelsCache = [];
        let m3uCategoriesCache = [];
        let m3uFilteredChannels = [];
        let m3uSelectedCategory = 'All';
        let m3uExplorerPage = 1;
        const M3U_PAGE_SIZE = 36;
        let activePresetId = null;

        function initM3uPresets() {
            const container = document.getElementById('iptv-presets-container');
            if (!container) return;
            const currentUrl = (settings.customIptvUrl || '').trim();

            container.innerHTML = IPTV_PRESETS.map(preset => {
                const isActive = currentUrl === preset.url;
                return `
                    <div onclick="applyM3uPreset('${preset.id}')" style="background: ${isActive ? 'rgba(59, 130, 246, 0.18)' : 'rgba(var(--overlay-base), 0.03)'}; border: 1px solid ${isActive ? 'rgba(59, 130, 246, 0.5)' : 'var(--border-subtle)'}; border-radius: 12px; padding: 10px; cursor: pointer; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); user-select: none;" onmouseenter="this.style.transform='translateY(-2px)'" onmouseleave="this.style.transform='translateY(0)'">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                            <span style="font-size: 16px;">${preset.flag}</span>
                            <span style="font-size: 12px; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${preset.name}</span>
                        </div>
                        <div style="font-size: 10px; color: var(--text-muted); line-height: 1.3;">${preset.desc}</div>
                    </div>
                `;
            }).join('');
            checkM3uInputChange();
        }

        function checkM3uInputChange() {
            const input = document.getElementById('customIptvUrl');
            const clearBtn = document.getElementById('btn-clear-m3u-input');
            if (input && clearBtn) {
                clearBtn.style.display = input.value.trim() ? 'block' : 'none';
            }
        }

        function clearM3uInputOnly() {
            const input = document.getElementById('customIptvUrl');
            if (input) {
                input.value = '';
                checkM3uInputChange();
                input.focus();
            }
        }

        function toggleM3uAdvancedDrawer() {
            const drawer = document.getElementById('m3u-advanced-drawer');
            const icon = document.getElementById('adv-drawer-icon');
            if (!drawer) return;
            const isHidden = drawer.style.display === 'none' || !drawer.style.display;
            drawer.style.display = isHidden ? 'block' : 'none';
            if (icon) icon.innerText = isHidden ? '▲' : '⚙️';
        }

        function setUserAgentQuick(ua) {
            triggerHaptic('light');
            const input = document.getElementById('iptvUserAgent');
            if (input) {
                input.value = ua;
                settings.iptvUserAgent = ua;
                onSettingChanged();
                showToast(`⚡ User-Agent set to: <b>${ua || 'Default'}</b>`);
            }
        }

        function applyM3uPreset(presetId) {
            triggerHaptic('medium');
            const preset = IPTV_PRESETS.find(p => p.id === presetId);
            if (!preset) return;
            activePresetId = presetId;
            const input = document.getElementById('customIptvUrl');
            if (input) {
                input.value = preset.url;
                checkM3uInputChange();
            }
            settings.customIptvUrl = preset.url;
            onSettingChanged();
            initM3uPresets();
            showToast(`⚡ Selected ${preset.flag} <b>${preset.name}</b>. Testing...`);
            testCustomM3u();
        }

        function toggleChannelExplorer() {
            triggerHaptic('light');
            const explorer = document.getElementById('m3u-channel-explorer');
            const btnIcon = document.getElementById('btn-explorer-icon');
            const btnText = document.getElementById('btn-explorer-text');
            if (!explorer) return;
            const isHidden = explorer.style.display === 'none' || !explorer.style.display;
            explorer.style.display = isHidden ? 'block' : 'none';
            if (btnIcon) btnIcon.innerText = isHidden ? '▲' : '🔍';
            if (btnText) btnText.innerText = isHidden ? 'Hide Explorer' : 'Explore Channels';
            if (isHidden && m3uChannelsCache.length === 0 && settings.customIptvUrl) {
                fetchExplorerChannelsData();
            }
        }

        function resyncM3uPlaylist() {
            triggerHaptic('medium');
            showToast('🔄 <b>Re-syncing playlist:</b> Fetching fresh stream manifest...');
            testCustomM3u(true);
        }

        function copyM3uUrl() {
            triggerHaptic('light');
            const url = settings.customIptvUrl || document.getElementById('customIptvUrl')?.value || '';
            if (url) {
                navigator.clipboard.writeText(url);
                showToast('📋 <b>Copied:</b> Playlist URL copied to clipboard.');
            }
        }

        function clearCustomM3u() {
            triggerHaptic('light');
            const input = document.getElementById('customIptvUrl');
            if (input) input.value = '';
            settings.customIptvUrl = '';
            activePresetId = null;
            m3uChannelsCache = [];
            m3uCategoriesCache = [];

            const connectedCard = document.getElementById('m3u-connected-card');
            if (connectedCard) connectedCard.style.display = 'none';
            const explorer = document.getElementById('m3u-channel-explorer');
            if (explorer) explorer.style.display = 'none';
            const statusEl = document.getElementById('m3u-test-status');
            if (statusEl) statusEl.style.display = 'none';

            checkM3uInputChange();
            initM3uPresets();
            onSettingChanged();
            showToast('🗑️ <b>Playlist Removed:</b> Custom M3U cleared.');
        }

        async function testCustomM3u(isResync = false) {
            triggerHaptic('medium');
            const urlInput = document.getElementById('customIptvUrl');
            const statusEl = document.getElementById('m3u-test-status');
            const testBtn = document.getElementById('btn-test-m3u');
            const connectedCard = document.getElementById('m3u-connected-card');

            const url = urlInput ? urlInput.value.trim() : '';
            if (!url) {
                showToast('⚠️ Please enter an M3U playlist URL first.');
                return;
            }

            const userAgent = document.getElementById('iptvUserAgent')?.value.trim() || '';

            if (testBtn) {
                testBtn.disabled = true;
                testBtn.innerHTML = '<span>⏳</span> Parsing...';
            }

            if (statusEl) {
                statusEl.style.display = 'block';
                statusEl.style.background = 'rgba(139, 92, 246, 0.12)';
                statusEl.style.border = '1px solid rgba(139, 92, 246, 0.3)';
                statusEl.style.color = 'var(--text-purple)';
                statusEl.innerHTML = '⏳ <b>Fetching and parsing live playlist...</b> Please wait.';
            }

            try {
                const res = await fetch('/api/iptv/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, userAgent, forceRefresh: isResync })
                });
                const data = await res.json();

                if (data && data.success) {
                    triggerHaptic('success');
                    settings.customIptvUrl = url;
                    onSettingChanged();

                    // Process categories
                    const catClean = (data.categories || []).flatMap(c => c.split(/[;,]/).map(s => s.trim()))
                        .filter(c => c && c.toLowerCase() !== 'undefined' && c.toLowerCase() !== 'null' && c.length > 1)
                        .map(c => c.charAt(0).toUpperCase() + c.slice(1));
                    m3uCategoriesCache = ['All', ...new Set(catClean)];
                    const catSample = m3uCategoriesCache.slice(1, 8).join(', ');

                    // Store preview channels
                    m3uChannelsCache = data.preview || [];
                    m3uFilteredChannels = [...m3uChannelsCache];

                    // Update Connected Card UI
                    if (connectedCard) {
                        connectedCard.style.display = 'block';
                        document.getElementById('stat-m3u-channels').innerText = Number(data.count).toLocaleString();
                        document.getElementById('stat-m3u-cats').innerText = m3uCategoriesCache.length - 1;
                        document.getElementById('stat-m3u-status').innerText = 'Active';
                        document.getElementById('m3u-category-tags').innerText = catSample || 'General TV';
                        document.getElementById('m3u-active-url-display').innerText = url;
                    }

                    if (statusEl) {
                        statusEl.style.display = 'none';
                    }

                    // Render Channel Explorer
                    renderExplorerCategoryChips();
                    renderExplorerChannelsList();
                    const explorer = document.getElementById('m3u-channel-explorer');
                    if (explorer) explorer.style.display = 'block';
                    const btnIcon = document.getElementById('btn-explorer-icon');
                    const btnText = document.getElementById('btn-explorer-text');
                    if (btnIcon) btnIcon.innerText = '▲';
                    if (btnText) btnText.innerText = 'Hide Explorer';

                    initM3uPresets();
                    showToast(`✅ <b>Connected!</b> Loaded ${Number(data.count).toLocaleString()} IPTV channels.`);
                } else {
                    triggerHaptic('error');
                    if (statusEl) {
                        statusEl.style.display = 'block';
                        statusEl.style.background = 'rgba(244, 63, 94, 0.15)';
                        statusEl.style.border = '1px solid rgba(244, 63, 94, 0.35)';
                        statusEl.style.color = '#f87171';
                        statusEl.innerHTML = `❌ <b>Failed to load playlist:</b> ${data.error || 'Check that the URL is valid and accessible.'}`;
                    }
                }
            } catch (err) {
                triggerHaptic('error');
                if (statusEl) {
                    statusEl.style.display = 'block';
                    statusEl.style.background = 'rgba(244, 63, 94, 0.15)';
                    statusEl.style.border = '1px solid rgba(244, 63, 94, 0.35)';
                    statusEl.style.color = '#f87171';
                    statusEl.innerHTML = `❌ <b>Network Connection Error:</b> ${err.message}`;
                }
            } finally {
                if (testBtn) {
                    testBtn.disabled = false;
                    testBtn.innerHTML = '<span>⚡</span> Test & Connect';
                }
            }
        }

        async function fetchExplorerChannelsData() {
            if (!settings.customIptvUrl) return;
            try {
                const res = await fetch(`/api/iptv/channels?url=${encodeURIComponent(settings.customIptvUrl)}&limit=100`);
                const data = await res.json();
                if (data && data.success && Array.isArray(data.channels)) {
                    m3uChannelsCache = data.channels;
                    const catClean = (data.channels || []).map(c => (c.category || 'General').split(/[;,]/)[0].trim())
                        .filter(c => c && c.toLowerCase() !== 'undefined' && c.toLowerCase() !== 'null' && c.length > 1)
                        .map(c => c.charAt(0).toUpperCase() + c.slice(1));
                    m3uCategoriesCache = ['All', ...new Set(catClean)].slice(0, 20);
                    renderExplorerCategoryChips();
                    onExplorerSearchChanged();
                }
            } catch (e) {
                console.error('[Explorer Fetch Error]', e);
            }
        }

        let hasChipsDragged = false;
        let isChipsDragging = false;
        let chipsStartX = 0;
        let chipsScrollStart = 0;
        let chipsListenersAttached = false;

        function updateChipsArrowButtons() {
            const container = document.getElementById('explorer-category-chips');
            const leftBtn = document.getElementById('btn-scroll-chips-left');
            const rightBtn = document.getElementById('btn-scroll-chips-right');
            if (!container || !leftBtn || !rightBtn) return;

            const canScroll = container.scrollWidth > container.clientWidth + 5;
            if (!canScroll) {
                leftBtn.style.display = 'none';
                rightBtn.style.display = 'none';
                return;
            }

            leftBtn.style.display = 'inline-flex';
            rightBtn.style.display = 'inline-flex';

            const atStart = container.scrollLeft <= 5;
            leftBtn.style.opacity = atStart ? '0.25' : '1';
            leftBtn.style.pointerEvents = atStart ? 'none' : 'auto';

            const atEnd = container.scrollLeft >= (container.scrollWidth - container.clientWidth - 5);
            rightBtn.style.opacity = atEnd ? '0.25' : '1';
            rightBtn.style.pointerEvents = atEnd ? 'none' : 'auto';
        }

        function scrollCategoryChips(offset) {
            triggerHaptic('light');
            const el = document.getElementById('explorer-category-chips');
            if (el) {
                el.scrollBy({ left: offset, behavior: 'smooth' });
                setTimeout(updateChipsArrowButtons, 300);
            }
        }

        function setupDesktopChipsScroll() {
            if (chipsListenersAttached) return;
            const container = document.getElementById('explorer-category-chips');
            if (!container) return;

            // 1. Convert standard mouse wheel scrolling to horizontal scroll
            container.addEventListener('wheel', (e) => {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    e.preventDefault();
                    container.scrollLeft += (e.deltaY * 1.4);
                    updateChipsArrowButtons();
                }
            }, { passive: false });

            // 2. Mouse Drag-to-Scroll (Pan with mouse)
            container.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                isChipsDragging = true;
                hasChipsDragged = false;
                chipsStartX = e.pageX - container.offsetLeft;
                chipsScrollStart = container.scrollLeft;
                container.style.cursor = 'grabbing';
            });

            window.addEventListener('mouseup', () => {
                if (isChipsDragging) {
                    isChipsDragging = false;
                    if (container) container.style.cursor = 'grab';
                }
            });

            container.addEventListener('mousemove', (e) => {
                if (!isChipsDragging) return;
                const x = e.pageX - container.offsetLeft;
                const dist = (x - chipsStartX) * 1.5;
                if (Math.abs(dist) > 5) {
                    hasChipsDragged = true;
                    e.preventDefault();
                    container.scrollLeft = chipsScrollStart - dist;
                    updateChipsArrowButtons();
                }
            });

            window.addEventListener('resize', updateChipsArrowButtons);
            chipsListenersAttached = true;
        }

        function renderExplorerCategoryChips() {
            const container = document.getElementById('explorer-category-chips');
            if (!container) return;
            setupDesktopChipsScroll();

            if (!m3uCategoriesCache || m3uCategoriesCache.length <= 1) {
                m3uCategoriesCache = ['All', 'News', 'Music', 'Movies', 'Religious', 'Entertainment', 'Culture', 'Animation', 'Lifestyle', 'Business', 'Sports', 'India'];
            }

            // Deduplicate and filter out any "Undefined" or empty items
            const cleanCats = m3uCategoriesCache.filter(c => c && c.toLowerCase() !== 'undefined' && c.toLowerCase() !== 'null');
            if (!cleanCats.includes('All')) cleanCats.unshift('All');

            container.innerHTML = cleanCats.map(cat => {
                const isSel = m3uSelectedCategory.toLowerCase() === cat.toLowerCase();
                const activeStyle = isSel
                    ? 'background: rgba(139, 92, 246, 0.22); border-color: var(--accent-primary); color: var(--text-primary); font-weight: 700; box-shadow: 0 0 14px rgba(139, 92, 246, 0.35);'
                    : 'background: rgba(var(--overlay-base), 0.04); border-color: var(--border-subtle); color: var(--text-secondary); font-weight: 600;';

                return `
                    <button type="button" data-cat="${cat}" onclick="onCategoryChipClick('${cat}', event)" style="${activeStyle} border-width: 1px; border-style: solid; border-radius: var(--radius-pill); padding: 5px 14px; font-size: 12px; cursor: pointer; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1); white-space: nowrap; flex-shrink: 0; user-select: none;" onmouseenter="if (!${isSel}) { this.style.color='var(--text-primary)'; this.style.borderColor='rgba(var(--overlay-base),0.18)'; }" onmouseleave="if (!${isSel}) { this.style.color='var(--text-secondary)'; this.style.borderColor='var(--border-subtle)'; }">
                        ${cat}
                    </button>
                `;
            }).join('');

            setTimeout(updateChipsArrowButtons, 50);
        }

        function onCategoryChipClick(cat, e) {
            if (hasChipsDragged) {
                hasChipsDragged = false;
                return;
            }
            selectExplorerCategory(cat);
        }

        function selectExplorerCategory(cat) {
            triggerHaptic('light');
            m3uSelectedCategory = cat;
            m3uExplorerPage = 1;
            renderExplorerCategoryChips();
            onExplorerSearchChanged();

            // Smoothly auto-center active category in view
            const container = document.getElementById('explorer-category-chips');
            const activeBtn = container ? container.querySelector(`[data-cat="${cat}"]`) : null;
            if (activeBtn) {
                activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
        }

        function onExplorerSearchChanged() {
            const query = (document.getElementById('explorerSearchInput')?.value || '').toLowerCase().trim();
            m3uFilteredChannels = m3uChannelsCache.filter(ch => {
                const matchCat = m3uSelectedCategory === 'All' || (ch.category || '').toLowerCase().includes(m3uSelectedCategory.toLowerCase());
                const matchQuery = !query || (ch.name || '').toLowerCase().includes(query) || (ch.category || '').toLowerCase().includes(query);
                return matchCat && matchQuery;
            });
            m3uExplorerPage = 1;
            renderExplorerChannelsList();
        }

        function loadMoreExplorerChannels() {
            triggerHaptic('light');
            m3uExplorerPage++;
            renderExplorerChannelsList(true);
        }

        function renderExplorerChannelsList(append = false) {
            const grid = document.getElementById('explorer-channels-grid');
            const badge = document.getElementById('explorer-count-badge');
            const loadMoreBtn = document.getElementById('btn-explorer-load-more');
            if (!grid) return;

            const visibleCount = m3uExplorerPage * M3U_PAGE_SIZE;
            const toRender = m3uFilteredChannels.slice(0, visibleCount);

            if (badge) {
                badge.innerText = `${toRender.length} of ${m3uFilteredChannels.length} Channels`;
            }

            if (loadMoreBtn) {
                loadMoreBtn.style.display = visibleCount < m3uFilteredChannels.length ? 'block' : 'none';
            }

            if (toRender.length === 0) {
                grid.innerHTML = `
                    <div style="grid-column: 1 / -1; padding: 32px 16px; text-align: center; color: var(--text-muted); font-size: 13px; background: rgba(var(--overlay-base), 0.02); border: 1px dashed var(--border-subtle); border-radius: 14px;">
                        🔍 No matching channels found for current filter or search.
                    </div>
                `;
                return;
            }

            grid.innerHTML = toRender.map(ch => {
                // Parse resolution quality from name (e.g. 1080p, 720p, 576p, 4K)
                let cleanName = ch.name || 'Live Channel';
                let resBadge = '';
                const resMatch = cleanName.match(/\((1080p|720p|576p|480p|4k|uhd|fhd|hd|sd)\)/i);
                if (resMatch) {
                    cleanName = cleanName.replace(resMatch[0], '').trim();
                    const qTag = resMatch[1].toUpperCase();
                    const qColor = qTag.includes('1080') || qTag.includes('4K') ? '#38bdf8' : '#a78bfa';
                    resBadge = `<span class="tag-pill-badge" style="font-size: 9px; padding: 1px 6px; background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.25); color: ${qColor};">${qTag}</span>`;
                }

                // Category tag formatting
                const catText = (ch.category && ch.category.toLowerCase() !== 'undefined') ? ch.category : 'Live TV';

                // Logo or Aesthetic Gradient Fallback Badge
                const logoHtml = ch.logo
                    ? `<img src="${ch.logo}" alt="${cleanName}" style="width: 38px; height: 38px; border-radius: 10px; object-fit: contain; background: var(--bg-input); border: 1px solid rgba(var(--overlay-base),0.08); padding: 2px; flex-shrink: 0;" onerror="this.onerror=null; this.parentElement.innerHTML='<div style=\'width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid rgba(var(--overlay-base),0.18);\'>📡</div>';">`
                    : `<div style="width: 38px; height: 38px; border-radius: 10px; background: linear-gradient(135deg, #6366f1 0%, #4338ca 100%); display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3); border: 1px solid rgba(var(--overlay-base),0.18);">📡</div>`;

                return `
                    <div style="background: rgba(var(--overlay-base), 0.025); border: 1px solid var(--border-subtle); border-radius: 16px; padding: 12px 14px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);" onmouseenter="this.style.transform='translateY(-2px)'; this.style.borderColor='rgba(139, 92, 246, 0.4)'; this.style.background='rgba(var(--overlay-base), 0.045)'; this.style.boxShadow='0 8px 24px rgba(0,0,0,0.4)';" onmouseleave="this.style.transform='translateY(0)'; this.style.borderColor='var(--border-subtle)'; this.style.background='rgba(var(--overlay-base), 0.025)'; this.style.boxShadow='none';">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            ${logoHtml}
                            <div style="min-width: 0; flex: 1;">
                                <div style="font-size: 13px; font-weight: 700; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; margin-bottom: 3px;" title="${cleanName}">${cleanName}</div>
                                <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                                    <span class="tag-pill-badge" style="font-size: 9.5px; padding: 1.5px 6px; background: rgba(139, 92, 246, 0.12); border-color: rgba(139, 92, 246, 0.25); color: var(--text-purple);">${catText}</span>
                                    ${resBadge}
                                </div>
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid rgba(var(--overlay-base),0.06); padding-top: 8px; margin-top: 2px;">
                            <span style="font-size: 11px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 4px;">
                                <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>
                                24/7 Live
                            </span>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <button type="button" class="pill-btn pill-btn-glass" onclick="probeExplorerStream('${ch.url}', this)" style="padding: 3.5px 10px; font-size: 11px; font-weight: 700; line-height: 1;">
                                    ⚡ Ping
                                </button>
                                <button type="button" class="pill-btn pill-btn-glass" onclick="copyStreamLink('${ch.url}')" style="padding: 3.5px 8px; font-size: 11px; line-height: 1;" title="Copy Stream URL to Clipboard">
                                    📋
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function probeExplorerStream(url, btn) {
            triggerHaptic('light');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '⏳...';
            const userAgent = settings.iptvUserAgent || '';

            try {
                const res = await fetch('/api/iptv/probe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, userAgent })
                });
                const data = await res.json();
                if (data && data.online) {
                    const badge = data.latency < 500 ? `🟢 ${data.latency}ms` : `🟡 ${data.latency}ms`;
                    btn.innerHTML = badge;
                    btn.style.color = data.latency < 500 ? 'var(--text-success)' : '#fbbf24';
                } else {
                    btn.innerHTML = '🔴 Offline';
                    btn.style.color = '#f87171';
                }
            } catch (e) {
                btn.innerHTML = '⚪ Err';
                btn.style.color = 'var(--text-muted)';
            }
        }

        function copyStreamLink(url) {
            triggerHaptic('light');
            if (url) {
                navigator.clipboard.writeText(url);
                showToast('📋 <b>Stream URL Copied:</b> Ready for VLC / MPV.');
            }
        }

        // ============================================================

        async function testXtreamLogin() {
            triggerHaptic('medium');
            const server = document.getElementById('xtreamServer')?.value.trim();
            const user = document.getElementById('xtreamUser')?.value.trim();
            const pass = document.getElementById('xtreamPassword')?.value.trim();
            const statusEl = document.getElementById('xtream-test-status');

            if (!server || !user || !pass) {
                showToast('⚠️ Please enter Xtream Server, Username, and Password.');
                return;
            }

            if (statusEl) {
                statusEl.style.color = 'var(--text-purple)';
                statusEl.innerText = '⏳ Connecting to Xtream server...';
            }

            try {
                const res = await fetch('/api/iptv/test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ xtreamServer: server, xtreamUser: user, xtreamPassword: pass })
                });
                const data = await res.json();
                if (data && data.success) {
                    triggerHaptic('success');
                    if (statusEl) {
                        statusEl.style.color = 'var(--text-success)';
                        statusEl.innerText = `✅ Connected: ${data.count} Live Streams`;
                    }
                    showToast(`✅ Xtream Connected: ${data.count} channels!`);
                    onSettingChanged();
                } else {
                    triggerHaptic('error');
                    if (statusEl) {
                        statusEl.style.color = '#f87171';
                        statusEl.innerText = `❌ ${data.error || 'Authentication failed'}`;
                    }
                }
            } catch (e) {
                triggerHaptic('error');
                if (statusEl) {
                    statusEl.style.color = '#f87171';
                    statusEl.innerText = `❌ Network Error: ${e.message}`;
                }
            }
        }


        // Service Worker
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js', { scope: '/' })
                    .catch(err => console.warn('[PWA] SW register error:', err));
            });
        }
    


        function googleTranslateElementInit() {
            new google.translate.TranslateElement({
                pageLanguage: 'en', 
                layout: google.translate.TranslateElement.InlineLayout.SIMPLE
            }, 'google_translate_element');
        }
    


        function showElegantLanguageSelector() {
            triggerHaptic('medium');
            const langs = [
                { code: 'en', name: 'English', emoji: '🇬🇧' },
                { code: 'es', name: 'Español', emoji: '🇪🇸' },
                { code: 'fr', name: 'Français', emoji: '🇫🇷' },
                { code: 'pt', name: 'Português', emoji: '🇵🇹' },
                { code: 'hi', name: 'हिंदी', emoji: '🇮🇳' },
                { code: 'zh-CN', name: '中文', emoji: '🇨🇳' },
                { code: 'ar', name: 'العربية', emoji: '🇸🇦' },
                { code: 'ru', name: 'Русский', emoji: '🇷🇺' },
                { code: 'ja', name: '日本語', emoji: '🇯🇵' },
                { code: 'de', name: 'Deutsch', emoji: '🇩🇪' },
                { code: 'it', name: 'Italiano', emoji: '🇮🇹' },
                { code: 'ko', name: '한국어', emoji: '🇰🇷' },
                { code: 'tr', name: 'Türkçe', emoji: '🇹🇷' },
                { code: 'pl', name: 'Polski', emoji: '🇵🇱' },
                { code: 'id', name: 'Bahasa Indonesia', emoji: '🇮🇩' },
                { code: 'vi', name: 'Tiếng Việt', emoji: '🇻🇳' },
                { code: 'nl', name: 'Nederlands', emoji: '🇳🇱' },
                { code: 'th', name: 'ไทย', emoji: '🇹🇭' },
                { code: 'el', name: 'Ελληνικά', emoji: '🇬🇷' },
                { code: 'cs', name: 'Čeština', emoji: '🇨🇿' },
                { code: 'sv', name: 'Svenska', emoji: '🇸🇪' },
                { code: 'ro', name: 'Română', emoji: '🇷🇴' },
                { code: 'hu', name: 'Magyar', emoji: '🇭🇺' },
                { code: 'fi', name: 'Suomi', emoji: '🇫🇮' },
                { code: 'da', name: 'Dansk', emoji: '🇩🇰' }
            ];
            
            let html = '<div id="elegant-lang-modal-grid" style="display:flex; flex-wrap:wrap; gap:8px; justify-content:center; padding: 10px 0; max-height: 50vh; overflow-y: auto; overflow-x: hidden; scrollbar-width: none;">';
            langs.forEach(l => {
                html += `<div class="ui-translate-chip" onclick="applyElegantTranslation('${l.code}')" >
                    <span style="font-size:16px;">${l.emoji}</span>
                    <span style="font-size:13px; font-weight:600;">${l.name}</span>
                </div>`;
            });
            html += '</div>';

            const modalHtml = `
                <style>#elegant-lang-modal-grid::-webkit-scrollbar { display: none; }</style>
                <style>
    #elegant-lang-modal-grid::-webkit-scrollbar { display: none; }
    
    #elegant-lang-modal {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8);
        z-index: 999999; display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
        opacity: 0; transition: opacity 0.2s;
    }
    body.theme-light #elegant-lang-modal {
        background: rgba(255,255,255,0.6);
    }
    
    .ui-translate-chip {
        cursor: pointer; padding: 8px 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px; border: 1px solid rgba(255,255,255,0.1);
        display: flex; align-items: center; gap: 6px; flex-grow: 1; justify-content: center; min-width: 30%;
        transition: all 0.2s ease;
        color: var(--text-primary);
    }
    .ui-translate-chip:hover {
        background: rgba(255,255,255,0.1);
    }
    body.theme-light .ui-translate-chip {
        background: rgba(0,0,0,0.04);
        border-color: rgba(0,0,0,0.1);
        color: #0f172a;
    }
    body.theme-light .ui-translate-chip:hover {
        background: rgba(0,0,0,0.08);
    }
</style>
<div id="elegant-lang-modal" >
                    <div style="background:var(--bg-card); border:1px solid var(--border-color); border-radius:16px; padding:24px; max-width:400px; width:90%; box-shadow:0 10px 40px rgba(0,0,0,0.5); transform:scale(0.95); transition:transform 0.2s;">
                        <h3 style="margin-top:0; margin-bottom:8px; text-align:center; font-size:18px;">Select Language</h3>
                        <p style="text-align:center; font-size:13px; color:var(--text-muted); margin-bottom:20px;">Choose a language to instantly translate the UI.</p>
                        ${html}
                        <button class="pill-btn" style="width:100%; margin-top:20px; justify-content:center;" onclick="document.getElementById('elegant-lang-modal').remove()">Close</button>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            requestAnimationFrame(() => {
                const m = document.getElementById('elegant-lang-modal');
                m.style.opacity = '1';
                m.children[0].style.transform = 'scale(1)';
            });
        }

        function applyElegantTranslation(langCode) {
            document.cookie = `googtrans=/en/${langCode}; path=/; domain=${window.location.hostname}`;
            document.cookie = `googtrans=/en/${langCode}; path=/`;
            window.location.reload();
        }

